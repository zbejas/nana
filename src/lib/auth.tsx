import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSetAtom } from 'jotai';
import { pb } from './pocketbase';
import { createUser } from './users';
import { createLogger } from './logger';
import { showToastAtom } from '../state/atoms';

const logger = createLogger('Auth');
import type { RecordModel } from 'pocketbase';
import { ensureAttachmentFileToken } from './documents/attachments';

const SESSION_CHECK_INTERVAL_MS = 5 * 60 * 1000;

function isAuthFailure(error: unknown): boolean {
  const status = typeof (error as { status?: unknown })?.status === 'number'
    ? (error as { status: number }).status
    : 0;
  return status === 401 || status === 403 || status === 404;
}

interface AuthContextType {
  user: RecordModel | null;
  loading: boolean;
  hasUsers: boolean | null;
  checkHasUsers: () => Promise<boolean>;
  signUp: (email: string, password: string, name?: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
  signInWithOAuth2: (provider: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Only treat the stored session as signed in while its token is still valid.
  // An expired token with a leftover record used to keep the UI logged in while
  // PocketBase treated every request as anonymous, leaving the app empty.
  const [user, setUser] = useState<RecordModel | null>(() => {
    if (!pb.authStore.token || !pb.authStore.record || !pb.authStore.isValid) {
      return null;
    }
    return pb.authStore.record;
  });
  const [loading, setLoading] = useState(true);
  const [hasUsers, setHasUsers] = useState<boolean | null>(null);
  const showToast = useSetAtom(showToastAtom);

  const checkHasUsers = useCallback(async (): Promise<boolean> => {
    try {
      // Use PocketBase hook endpoint that runs with admin privileges
      const response = await fetch('/pb/api/check-users');
      
      if (!response.ok) {
        logger.warn('Failed to check users endpoint, assuming users exist');
        setHasUsers(true); // Default to true (sign-in mode) if check fails
        return true;
      }
      
      const data = await response.json();
      const exists = data.hasUsers;
      setHasUsers(exists);
      return exists;
    } catch (error: any) {
      logger.error('Failed to check users', { error: error?.message ?? String(error) });
      // Default to true (sign-in mode) if check fails
      setHasUsers(true);
      return true;
    }
  }, []);

  const clearSession = useCallback((reason: string) => {
    logger.warn('Clearing invalid auth session', { reason });
    pb.authStore.clear();
    setUser(null);
    showToast({ message: 'Your session expired. Please sign in again.', type: 'info' });
  }, [showToast]);

  useEffect(() => {
    // Listen for auth changes
    const unsubscribe = pb.authStore.onChange((token, model) => {
      setUser(model);

      if (token && model) {
        void ensureAttachmentFileToken();
      }
    });

    // Validate existing token on startup
    const validateAuth = async () => {
      const token = pb.authStore.token;
      const record = pb.authStore.record;

      if (!token || !record) {
        // Clean up half-populated stores so they cannot masquerade as a session.
        if (token || record) {
          pb.authStore.clear();
        }
        setUser(null);
        setLoading(false);
        return;
      }

      if (!pb.authStore.isValid) {
        clearSession('auth token expired');
        setLoading(false);
        return;
      }

      try {
        // Try to refresh/validate the token
        await pb.collection('users').authRefresh();
        setUser(pb.authStore.record);
        void ensureAttachmentFileToken();
      } catch (error) {
        if (isAuthFailure(error)) {
          clearSession('session rejected by server');
        } else {
          logger.warn('Could not validate auth session', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      setLoading(false);
    };

    validateAuth();

    return () => {
      unsubscribe();
    };
  }, [clearSession]);

  // Re-check the session while the app is open. PocketBase answers list
  // requests with an empty result (200) for an invalid session, so nothing else
  // would notice that the user was signed out on the backend.
  useEffect(() => {
    if (loading) {
      return;
    }

    let lastValidatedAt = Date.now();
    let isChecking = false;

    const validateSession = async () => {
      if (!pb.authStore.token) {
        return;
      }

      if (!pb.authStore.isValid) {
        clearSession('auth token expired');
        return;
      }

      if (isChecking || Date.now() - lastValidatedAt < SESSION_CHECK_INTERVAL_MS) {
        return;
      }

      isChecking = true;
      try {
        await pb.collection('users').authRefresh();
        setUser(pb.authStore.record);
      } catch (error) {
        if (isAuthFailure(error)) {
          clearSession('session rejected by server');
        }
      } finally {
        // Throttle retries even after a network error so focus events cannot
        // hammer auth-refresh while the backend is unreachable.
        lastValidatedAt = Date.now();
        isChecking = false;
      }
    };

    const intervalId = window.setInterval(() => {
      void validateSession();
    }, SESSION_CHECK_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void validateSession();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', validateSession);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', validateSession);
    };
  }, [clearSession, loading]);

  const signIn = useCallback(async (email: string, password: string) => {
    const authData = await pb.collection('users').authWithPassword(email, password);
    setUser(authData.record);
    void ensureAttachmentFileToken(true);
  }, []);

  const signUp = useCallback(async (email: string, password: string, name?: string) => {
    // Ensure name is always a string (fallback to email username)
    const userName = name || email.split('@')[0] || 'User';

    // Use centralized createUser function.
    // Admin and verified status for the first user are set automatically by the backend hook.
    await createUser({
      email,
      password,
      name: userName,
    });

    // Auto sign-in after signup
    await signIn(email, password);
  }, [signIn]);

  const signOut = useCallback(() => {
    pb.authStore.clear();
    setUser(null);
  }, []);

  const signInWithOAuth2 = useCallback(async (provider: string) => {
    const authData = await pb.collection('users').authWithOAuth2({
      provider,
    });
    setUser(authData.record);
    void ensureAttachmentFileToken(true);
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    await pb.collection('users').requestPasswordReset(email);
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      hasUsers,
      checkHasUsers,
      signUp,
      signIn,
      signOut,
      signInWithOAuth2,
      requestPasswordReset,
    }),
    [
      user,
      loading,
      hasUsers,
      checkHasUsers,
      signUp,
      signIn,
      signOut,
      signInWithOAuth2,
      requestPasswordReset,
    ]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

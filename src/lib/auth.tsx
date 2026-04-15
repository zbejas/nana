import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { pb } from './pocketbase';
import { createUser } from './users';
import { createLogger } from './logger';

const logger = createLogger('Auth');
import type { RecordModel } from 'pocketbase';
import { ensureAttachmentFileToken } from './documents/attachments';

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
  const [user, setUser] = useState<RecordModel | null>(pb.authStore.record);
  const [loading, setLoading] = useState(true);
  const [hasUsers, setHasUsers] = useState<boolean | null>(null);

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
      if (pb.authStore.isValid && pb.authStore.record) {
        try {
          // Try to refresh/validate the token
          await pb.collection('users').authRefresh();
          setUser(pb.authStore.record);
          void ensureAttachmentFileToken();
        } catch (error) {
          // Token is invalid (user doesn't exist in DB), clear it
          logger.warn('Auth token validation failed, clearing auth store', {
            error: error instanceof Error ? error.message : String(error),
          });
          pb.authStore.clear();
          setUser(null);
        }
      }
      setLoading(false);
    };

    validateAuth();

    return () => {
      unsubscribe();
    };
  }, []);

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

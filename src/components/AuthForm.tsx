import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { pb } from '../lib/pocketbase';
import { createLogger } from '../lib/logger';
import { Button, Field, Input } from './ui';

const log = createLogger('AuthForm');

type OAuthProviderInfo = {
  name: string;
  displayName: string;
  state: string;
  authURL: string;
};

export function AuthForm() {
  const [mode, setMode] = useState<'signin' | 'reset'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);
  const [oauthProviders, setOauthProviders] = useState<OAuthProviderInfo[]>([]);
  const [passwordEnabled, setPasswordEnabled] = useState(true);

  const { signIn, signOut, signInWithOAuth2, user, requestPasswordReset } = useAuth();

  useEffect(() => {
    pb.collection('users').listAuthMethods().then(methods => {
      setPasswordEnabled(methods.password?.enabled !== false);
      if (methods.oauth2?.enabled && methods.oauth2.providers?.length) {
        setOauthProviders(
          methods.oauth2.providers.map((provider: any) => ({
            name: provider.name,
            displayName: provider.displayName || provider.name,
            state: provider.state,
            authURL: provider.authURL || provider.authUrl,
          }))
        );
      }
    }).catch(err => {
      log.warn('Failed to fetch auth methods', err);
    });
  }, []);

  const handleOAuth2 = async (providerName: string) => {
    setError('');
    setSuccess('');
    setOauthLoading(providerName);
    try {
      await signInWithOAuth2(providerName);
      setSuccess('Signed in successfully.');
    } catch (err: any) {
      log.error('OAuth2 error', err);
      if (err.message?.includes('canceled') || err.message?.includes('closed')) {
        return;
      }
      setError(err.message || err.data?.message || 'Could not sign in with that provider.');
    } finally {
      setOauthLoading(null);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      if (mode === 'signin') {
        await signIn(email, password);
        setSuccess('Signed in.');
      } else {
        await requestPasswordReset(email);
        setSuccess('If this email is registered, a reset link is on its way.');
        setMode('signin');
        setEmail('');
        setPassword('');
      }
    } catch (err: any) {
      log.error('Auth error', err);
      setError(
        err.message ||
          err.data?.message ||
          (err.status === 0 ? 'Cannot reach the server. Check your connection.' : '') ||
          'Something went wrong. Try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  if (user) {
    return (
      <div className="rounded-panel border border-line bg-surface p-6">
        <h2 className="font-display text-2xl font-semibold tracking-[-0.02em] text-ink">You are signed in</h2>
        <p className="mt-1 text-sm text-ink-secondary">{user.email}</p>
        <Button variant="secondary" className="mt-5 w-full" onClick={signOut}>
          Sign out
        </Button>
      </div>
    );
  }

  const hasOAuth = oauthProviders.length > 0;
  const showPasswordForm = passwordEnabled || mode === 'reset';

  return (
    <div className="rounded-panel border border-line bg-surface p-5 sm:p-6">
      <div className="mb-5">
        <h2 className="font-display text-2xl font-semibold leading-tight tracking-[-0.02em] text-ink">
          {mode === 'signin' ? 'Welcome back' : 'Reset your password'}
        </h2>
        <p className="mt-1.5 text-sm text-ink-secondary">
          {mode === 'signin'
            ? 'Sign in to your notes, boards, and chat.'
            : 'Enter your email and we will send a reset link if the account exists.'}
        </p>
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-control border border-danger/25 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="mb-4 rounded-control border border-success/25 bg-success-soft px-3 py-2 text-sm text-success">
          {success}
        </p>
      )}

      {hasOAuth && mode === 'signin' && (
        <div className="space-y-2">
          {oauthProviders.map((provider) => (
            <Button
              key={provider.name}
              variant="secondary"
              className="w-full"
              onClick={() => void handleOAuth2(provider.name)}
              loading={oauthLoading === provider.name}
              disabled={loading || (oauthLoading !== null && oauthLoading !== provider.name)}
              icon={
                <span className="flex h-5 w-5 items-center justify-center rounded-full border border-line bg-surface-sunken text-[10px] font-semibold uppercase text-ink-secondary">
                  {provider.displayName.charAt(0)}
                </span>
              }
            >
              Sign in with {provider.displayName}
            </Button>
          ))}

          {showPasswordForm && (
            <div className="flex items-center gap-3 py-1">
              <span className="h-px flex-1 bg-line" />
              <span className="font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-ink-muted">or use email</span>
              <span className="h-px flex-1 bg-line" />
            </div>
          )}
        </div>
      )}

      {showPasswordForm && (
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <Field label="Email" htmlFor="auth-email">
            <Input
              id="auth-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              placeholder="you@example.com"
              autoComplete="email"
              autoFocus
            />
          </Field>

          {mode !== 'reset' && (
            <Field label="Password" htmlFor="auth-password">
              <Input
                id="auth-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={6}
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </Field>
          )}

          <Button
            type="submit"
            variant="primary"
            className="w-full"
            loading={loading}
            disabled={oauthLoading !== null}
          >
            {mode === 'signin' ? 'Sign in' : 'Send reset link'}
          </Button>
        </form>
      )}

      {!passwordEnabled && !hasOAuth && mode === 'signin' && (
        <p className="text-center text-sm text-ink-muted">No sign-in methods are configured yet.</p>
      )}

      <div className="mt-5 text-center">
        {mode === 'signin' && passwordEnabled && (
          <button
            type="button"
            onClick={() => {
              setMode('reset');
              setError('');
              setSuccess('');
            }}
            className="text-[13px] text-ink-muted transition-colors hover:text-signal"
          >
            Forgot your password?
          </button>
        )}
        {mode === 'reset' && (
          <button
            type="button"
            onClick={() => {
              setMode('signin');
              setError('');
              setSuccess('');
            }}
            className="text-[13px] text-signal transition-colors hover:text-signal-strong"
          >
            Back to sign in
          </button>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { pb } from '../lib/pocketbase';
import { createLogger } from '../lib/logger';

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

  // Fetch available auth methods on mount
  useEffect(() => {
    pb.collection('users').listAuthMethods().then(methods => {
      setPasswordEnabled(methods.password?.enabled !== false);
      if (methods.oauth2?.enabled && methods.oauth2.providers?.length) {
        setOauthProviders(
          methods.oauth2.providers.map((p: any) => ({
            name: p.name,
            displayName: p.displayName || p.name,
            state: p.state,
            authURL: p.authURL || p.authUrl,
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
      setSuccess('Signed in successfully!');
    } catch (err: any) {
      log.error('OAuth2 error', err);
      if (err.message?.includes('canceled') || err.message?.includes('closed')) {
        // User closed the popup
        return;
      }
      const errorMsg = err.message ||
        err.data?.message ||
        'OAuth2 sign-in failed. Please try again.';
      setError(errorMsg);
    } finally {
      setOauthLoading(null);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      if (mode === 'signin') {
        await signIn(email, password);
        setSuccess('Signed in successfully!');
      } else if (mode === 'reset') {
        await requestPasswordReset(email);
        setSuccess('If this email is registered, a reset email should arrive soon.');
        setMode('signin');
      }
      
      // Clear form on success (except for signin)
      if (mode !== 'signin') {
        setEmail('');
        setPassword('');
      }
    } catch (err: any) {
      log.error('Auth error', err);
      // Provide detailed error message
      const errorMsg = err.message || 
        err.data?.message || 
        (err.status === 0 ? 'Cannot connect to server. Please check your connection.' : '') ||
        'Something went wrong. Please try again.';
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  if (user) {
    return (
      <div className="bg-white/10 backdrop-blur-sm rounded-lg p-5 sm:p-6 max-w-md mx-auto mt-4 sm:mt-6 md:mt-8">
        <h2 className="text-2xl font-bold mb-4">Welcome, {user.name || user.email}!</h2>
        <p className="text-gray-300 mb-4">Email: {user.email}</p>
        <button
          onClick={signOut}
          className="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded transition-colors"
        >
          Sign Out
        </button>
      </div>
    );
  }

  const hasOAuth = oauthProviders.length > 0;
  const showPasswordForm = passwordEnabled && mode !== 'reset' || mode === 'reset';

  return (
    <div className="bg-white/10 backdrop-blur-sm rounded-lg p-5 sm:p-6 max-w-md mx-auto mt-4 sm:mt-6 md:mt-8">
      <h2 className="text-2xl font-bold mb-4">
        {mode === 'signin' && 'Sign In'}
        {mode === 'reset' && 'Reset Password'}
      </h2>

      {error && (
        <div className="bg-red-500/20 border border-red-500 text-red-200 px-4 py-2 rounded mb-4">
          {error}
        </div>
      )}

      {success && (
        <div className="bg-green-500/20 border border-green-500 text-green-200 px-4 py-2 rounded mb-4">
          {success}
        </div>
      )}

      {/* OAuth2 provider buttons */}
      {hasOAuth && mode === 'signin' && (
        <div className="space-y-2 mb-4">
          {oauthProviders.map(provider => (
            <button
              key={provider.name}
              type="button"
              onClick={() => handleOAuth2(provider.name)}
              disabled={oauthLoading !== null || loading}
              className="w-full flex items-center justify-center gap-2 bg-white/5 hover:bg-white/15 border border-white/20 text-white font-medium py-2.5 px-4 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {oauthLoading === provider.name ? (
                <span className="inline-block h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
                </svg>
              )}
              Sign in with {provider.displayName}
            </button>
          ))}

          {/* Divider between OAuth and password form */}
          {showPasswordForm && (
            <div className="flex items-center gap-3 my-3">
              <div className="flex-1 border-t border-white/10" />
              <span className="text-xs text-gray-500 uppercase">or</span>
              <div className="flex-1 border-t border-white/10" />
            </div>
          )}
        </div>
      )}

      {/* Password form (or reset form) */}
      {showPasswordForm && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full bg-white/5 border border-white/20 rounded px-4 py-2 focus:outline-none focus:border-white/40"
              placeholder="you@example.com"
              autoFocus
            />
          </div>

          {mode !== 'reset' && (
            <div>
              <label className="block text-sm font-medium mb-2">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="w-full bg-white/5 border border-white/20 rounded px-4 py-2 focus:outline-none focus:border-white/40"
                placeholder="••••••••"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading || oauthLoading !== null}
            className="w-full bg-white/10 hover:bg-white/20 text-white font-bold py-2 px-4 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Loading...' : mode === 'signin' ? 'Sign In' : 'Send Reset Email'}
          </button>
        </form>
      )}

      {/* If only OAuth is available and password is disabled */}
      {!passwordEnabled && !hasOAuth && mode === 'signin' && (
        <p className="text-gray-400 text-sm text-center">
          No sign-in methods are currently configured.
        </p>
      )}

      <div className="mt-4 text-center space-y-2">
        {mode === 'signin' && passwordEnabled && (
          <>
            <button
              onClick={() => setMode('reset')}
              className="text-sm text-gray-400 hover:text-gray-300"
            >
              Forgot password?
            </button>
          </>
        )}
        {mode === 'reset' && (
          <button
            onClick={() => setMode('signin')}
            className="text-sm text-blue-400 hover:text-blue-300"
          >
            Back to sign in
          </button>
        )}
      </div>
    </div>
  );
}

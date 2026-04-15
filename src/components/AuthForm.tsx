import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { createLogger } from '../lib/logger';

const log = createLogger('AuthForm');

export function AuthForm() {
  const [mode, setMode] = useState<'signin' | 'reset'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const { signIn, signOut, user, requestPasswordReset } = useAuth();

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
          disabled={loading}
          className="w-full bg-white/10 hover:bg-white/20 text-white font-bold py-2 px-4 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Loading...' : mode === 'signin' ? 'Sign In' : 'Send Reset Email'}
        </button>
      </form>

      <div className="mt-4 text-center space-y-2">
        {mode === 'signin' && (
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

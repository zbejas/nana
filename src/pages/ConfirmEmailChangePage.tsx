import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import logo from '../assets/nana.svg';
import { pb } from '../lib/pocketbase';
import { useAuth } from '../lib/auth';
import { createLogger } from '../lib/logger';

const log = createLogger('EmailChange');

export function ConfirmEmailChangePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');

  const token = searchParams.get('token');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!token) {
      setStatus('error');
      setError('No confirmation token provided.');
      return;
    }

    if (!password) {
      setError('Password is required.');
      return;
    }

    setStatus('submitting');

    try {
      // Confirm email change
      await pb.collection('users').confirmEmailChange(token, password);
      setStatus('success');
      
      // Refresh auth to get updated email
      try {
        await pb.collection('users').authRefresh();
      } catch (err) {
        // If refresh fails, sign out
        signOut();
      }
    } catch (err: any) {
      log.error('Email change confirmation error', err);
      setStatus('error');
      
      const errorMsg = err.message || 
        err.data?.message || 
        err.data?.data?.token?.message ||
        err.data?.data?.password?.message ||
        (err.status === 0 ? 'Cannot connect to server. Please check your connection.' : '') ||
        'Failed to confirm email change. The link may be expired or password is incorrect.';
      
      setError(errorMsg);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen overflow-y-auto flex items-center justify-center px-4 py-6 sm:px-8 sm:py-10">
        <div className="w-full max-w-md text-center relative z-10">
          <div className="flex justify-center items-center mb-4 sm:mb-6 md:mb-8">
            <img
              src={logo}
              alt="Nana Logo"
              className="h-24 sm:h-32 md:h-40 p-3 sm:p-5 md:p-6 transition-all duration-300 hover:drop-shadow-[0_0_2em_#646cffaa]"
            />
          </div>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold my-2 sm:my-3 md:my-4 leading-tight">Confirm Email Change</h1>

          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-5 sm:p-8 max-w-md mx-auto mt-4 sm:mt-8">
            <div className="text-red-400 text-5xl mb-4">✕</div>
            <h2 className="text-2xl font-bold mb-4 text-red-400">Invalid Link</h2>
            <div className="bg-red-500/20 border border-red-500 text-red-200 px-4 py-3 rounded mb-6">
              No confirmation token provided. Please use the link from your email.
            </div>
            <button
              onClick={() => navigate('/')}
              className="w-full bg-white/10 hover:bg-white/20 text-white font-bold py-2 px-4 rounded transition-colors"
            >
              Back to Sign In
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-y-auto flex items-center justify-center px-4 py-6 sm:px-8 sm:py-10">
      <div className="w-full max-w-md text-center relative z-10">
        <div className="flex justify-center items-center mb-4 sm:mb-6 md:mb-8">
          <img
            src={logo}
            alt="Nana Logo"
            className="h-24 sm:h-32 md:h-40 p-3 sm:p-5 md:p-6 transition-all duration-300 hover:drop-shadow-[0_0_2em_#646cffaa]"
          />
        </div>
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold my-2 sm:my-3 md:my-4 leading-tight">Confirm Email Change</h1>
        <p className="text-gray-400 mb-4 sm:mb-6 md:mb-8">
          Enter your password to confirm your new email address
        </p>

        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-5 sm:p-8 max-w-md mx-auto">
          {status === 'success' ? (
            <div>
              <div className="text-green-400 text-5xl mb-4">✓</div>
              <h2 className="text-2xl font-bold mb-4 text-green-400">Email Changed!</h2>
              <p className="text-gray-300 mb-6">
                Your email address has been successfully changed. You can now continue using your account.
              </p>
              <button
                onClick={() => navigate('/timeline')}
                className="w-full bg-white/10 hover:bg-white/20 text-white font-bold py-2 px-4 rounded transition-colors"
              >
                Go to Timeline
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="bg-red-500/20 border border-red-500 text-red-200 px-4 py-3 rounded mb-4">
                  {error}
                </div>
              )}

              <div className="bg-blue-500/20 border border-blue-500 text-blue-200 px-4 py-3 rounded mb-4">
                <p className="text-sm">
                  🔒 For security, please enter your current password to confirm this email change.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2 text-left">Your Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={status === 'submitting'}
                  className="w-full bg-white/5 border border-white/20 rounded px-4 py-2 focus:outline-none focus:border-white/40 disabled:opacity-50"
                  placeholder="••••••••"
                  autoFocus
                />
              </div>

              <button
                type="submit"
                disabled={status === 'submitting'}
                className="w-full bg-white/10 hover:bg-white/20 text-white font-bold py-2 px-4 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {status === 'submitting' ? 'Confirming...' : 'Confirm Email Change'}
              </button>

              <button
                type="button"
                onClick={() => navigate('/')}
                disabled={status === 'submitting'}
                className="w-full bg-transparent hover:bg-white/10 text-gray-400 hover:text-white font-medium py-2 px-4 rounded transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

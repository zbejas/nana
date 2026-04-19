import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import logo from '../assets/nana.svg';
import { pb } from '../lib/pocketbase';
import { createLogger } from '../lib/logger';

const log = createLogger('ResetPwd');

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');

  const token = searchParams.get('token');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!token) {
      setStatus('error');
      setError('No reset token provided.');
      return;
    }

    if (password !== passwordConfirm) {
      setError('Passwords do not match.');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setStatus('submitting');

    try {
      // Confirm password reset
      await pb.collection('users').confirmPasswordReset(
        token,
        password,
        passwordConfirm
      );
      setStatus('success');
      
      // Redirect to sign-in after 2 seconds
      setTimeout(() => {
        navigate('/');
      }, 2000);
    } catch (err: any) {
      log.error('Password reset error', err);
      setStatus('error');
      
      const errorMsg = err.message || 
        err.data?.message || 
        err.data?.data?.token?.message ||
        err.data?.data?.password?.message ||
        (err.status === 0 ? 'Cannot connect to server. Please check your connection.' : '') ||
        'Failed to reset password. The link may be expired or invalid.';
      
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
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold my-2 sm:my-3 md:my-4 leading-tight">Reset Password</h1>

          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-5 sm:p-8 max-w-md mx-auto mt-4 sm:mt-8">
            <div className="text-red-400 text-5xl mb-4">✕</div>
            <h2 className="text-2xl font-bold mb-4 text-red-400">Invalid Link</h2>
            <div className="bg-red-500/20 border border-red-500 text-red-200 px-4 py-3 rounded mb-6">
              No reset token provided. Please use the link from your email.
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
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold my-2 sm:my-3 md:my-4 leading-tight">Reset Password</h1>
        <p className="text-gray-400 mb-4 sm:mb-6 md:mb-8">
          Enter your new password below
        </p>

        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-5 sm:p-8 max-w-md mx-auto">
          {status === 'success' ? (
            <div>
              <div className="text-green-400 text-5xl mb-4">✓</div>
              <h2 className="text-2xl font-bold mb-4 text-green-400">Password Reset!</h2>
              <p className="text-gray-300 mb-6">
                Your password has been successfully reset. Redirecting to sign in...
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="bg-red-500/20 border border-red-500 text-red-200 px-4 py-3 rounded mb-4">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium mb-2 text-left">New Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  disabled={status === 'submitting'}
                  className="w-full bg-white/5 border border-white/20 rounded px-4 py-2 focus:outline-none focus:border-white/40 disabled:opacity-50"
                  placeholder="••••••••"
                  autoFocus
                />
                <p className="text-xs text-gray-400 mt-1 text-left">Minimum 8 characters</p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2 text-left">Confirm Password</label>
                <input
                  type="password"
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  required
                  minLength={8}
                  disabled={status === 'submitting'}
                  className="w-full bg-white/5 border border-white/20 rounded px-4 py-2 focus:outline-none focus:border-white/40 disabled:opacity-50"
                  placeholder="••••••••"
                />
              </div>

              <button
                type="submit"
                disabled={status === 'submitting'}
                className="w-full bg-white/10 hover:bg-white/20 text-white font-bold py-2 px-4 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {status === 'submitting' ? 'Resetting Password...' : 'Reset Password'}
              </button>

              <button
                type="button"
                onClick={() => navigate('/')}
                disabled={status === 'submitting'}
                className="w-full bg-transparent hover:bg-white/10 text-gray-400 hover:text-white font-medium py-2 px-4 rounded transition-colors disabled:opacity-50"
              >
                Back to Sign In
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

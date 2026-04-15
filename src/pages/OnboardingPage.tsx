import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import logo from "../assets/nana.svg";
import { useAuth } from '../lib/auth';
import { getDefaultHomepageRoute } from '../lib/settings';
import { createLogger } from '../lib/logger';

const log = createLogger('Onboarding');

export function OnboardingPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { signUp, user, hasUsers, loading: authLoading } = useAuth();

  // Wait for initial auth check
  if (authLoading || hasUsers === null) {
    return (
      <div className="max-w-7xl mx-auto p-8 text-center">
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  // If users already exist, redirect to sign-in
  if (hasUsers === true) {
    return <Navigate to="/" replace />;
  }

  // If user is already signed in, go to home
  if (user) {
    return <Navigate to={getDefaultHomepageRoute()} replace />;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await signUp(email, password, name);
      // Will auto-redirect after successful signup
    } catch (err: any) {
      log.error('Onboarding error', err);
      const errorMsg = err.message || 
        err.data?.message || 
        (err.status === 0 ? 'Cannot connect to server. Please check your connection.' : '') ||
        'Something went wrong. Please try again.';
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-8 text-center relative z-10">
      <div className="flex justify-center items-center mb-8">
        <img
          src={logo}
          alt="Nana Logo"
          className="h-24 p-6 transition-all duration-300 hover:drop-shadow-[0_0_2em_#646cffaa] scale-120"
        />
      </div>
      <h1 className="text-5xl font-bold my-4 leading-tight">Welcome to Nana</h1>
      <p className="text-gray-400 mb-8">
        Let's set up your admin account to get started.
      </p>

      <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 max-w-md mx-auto">
        <h2 className="text-2xl font-bold mb-4">Create Admin Account</h2>

        {error && (
          <div className="bg-red-500/20 border border-red-500 text-red-200 px-4 py-2 rounded mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-white/5 border border-white/20 rounded px-4 py-2 focus:outline-none focus:border-white/40"
              placeholder="John Doe"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full bg-white/5 border border-white/20 rounded px-4 py-2 focus:outline-none focus:border-white/40"
              placeholder="admin@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full bg-white/5 border border-white/20 rounded px-4 py-2 focus:outline-none focus:border-white/40"
              placeholder="••••••••"
            />
            <p className="text-xs text-gray-400 mt-1">Minimum 8 characters</p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-white/10 hover:bg-white/20 text-white font-bold py-2 px-4 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Creating Account...' : 'Create Admin Account'}
          </button>
        </form>
      </div>
    </div>
  );
}

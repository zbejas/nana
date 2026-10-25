import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { getDefaultHomepageRoute } from '../lib/settings';
import { createLogger } from '../lib/logger';
import { AuthCard, AuthShell } from '../components/auth/AuthShell';
import { Button, Field, Input } from '../components/ui';

const log = createLogger('Onboarding');

export function OnboardingPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { signUp, user, hasUsers, loading: authLoading } = useAuth();

  if (authLoading || hasUsers === null) {
    return (
      <div className="flex h-screen items-center justify-center">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-line-strong border-t-signal" />
      </div>
    );
  }

  if (hasUsers === true) {
    return <Navigate to="/" replace />;
  }

  if (user) {
    return <Navigate to={getDefaultHomepageRoute()} replace />;
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      await signUp(email, password, name);
    } catch (err: any) {
      log.error('Onboarding error', err);
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

  return (
    <AuthShell
      footer={
        <p className="mt-4 text-center text-[11.5px] text-ink-muted">
          This first account becomes the instance administrator.
        </p>
      }
    >
      <AuthCard
        eyebrow="First run"
        title="Set up your workspace"
        description="Create the admin account. You can add other people later from Workspace settings."
      >
        {error && (
          <p role="alert" className="mb-4 rounded-control border border-danger/25 bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Your name" htmlFor="onboarding-name">
            <Input
              id="onboarding-name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Your name"
              autoComplete="name"
              autoFocus
            />
          </Field>

          <Field label="Email" htmlFor="onboarding-email">
            <Input
              id="onboarding-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              placeholder="you@example.com"
              autoComplete="email"
            />
          </Field>

          <Field label="Password" htmlFor="onboarding-password" hint="At least 8 characters.">
            <Input
              id="onboarding-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={8}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </Field>

          <Button type="submit" variant="primary" className="w-full" loading={loading}>
            Create admin account
          </Button>
        </form>
      </AuthCard>
    </AuthShell>
  );
}

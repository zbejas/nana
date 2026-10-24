import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { pb } from '../lib/pocketbase';
import { useAuth } from '../lib/auth';
import { createLogger } from '../lib/logger';
import { AuthBackLink, AuthCard, AuthShell } from '../components/auth/AuthShell';
import { Button, Field, Input } from '../components/ui';

const log = createLogger('EmailChange');

export function ConfirmEmailChangePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');

  const token = searchParams.get('token');

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');

    if (!token) {
      setStatus('error');
      setError('No confirmation token provided.');
      return;
    }

    if (!password) {
      setError('Enter your current password.');
      return;
    }

    setStatus('submitting');

    try {
      await pb.collection('users').confirmEmailChange(token, password);
      setStatus('success');

      try {
        await pb.collection('users').authRefresh();
      } catch {
        signOut();
      }
    } catch (err: any) {
      log.error('Email change confirmation error', err);
      setStatus('error');
      setError(
        err.message ||
          err.data?.message ||
          err.data?.data?.token?.message ||
          err.data?.data?.password?.message ||
          (err.status === 0 ? 'Cannot reach the server. Check your connection.' : '') ||
          'Failed to confirm the email change. The link may be expired or the password is incorrect.'
      );
    }
  };

  if (!token) {
    return (
      <AuthShell footer={<span />}>
        <AuthCard eyebrow="Account security" title="This link is not valid" description="The email change link is missing its token. Request a new one from your profile.">
          <p className="rounded-control border border-danger/25 bg-danger-soft px-3 py-2 text-sm text-danger">
            No confirmation token was provided.
          </p>
          <div className="mt-4">
            <Button variant="primary" className="w-full" onClick={() => navigate('/')}>
              Back to sign in
            </Button>
          </div>
        </AuthCard>
      </AuthShell>
    );
  }

  if (status === 'success') {
    return (
      <AuthShell footer={<span />}>
        <AuthCard eyebrow="Account security" title="Email updated" description="Your email address has been changed. Continue to your workspace.">
          <Button variant="primary" className="w-full" onClick={() => navigate('/timeline')}>
            Go to timeline
          </Button>
        </AuthCard>
      </AuthShell>
    );
  }

  return (
    <AuthShell footer={<span />}>
      <AuthCard eyebrow="Account security" title="Confirm the new email" description="For safety, confirm this change with your current password.">
        {error && (
          <p role="alert" className="mb-4 rounded-control border border-danger/25 bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <div className="mb-4 rounded-control border border-brass/25 bg-brass-soft px-3.5 py-3 text-sm leading-relaxed text-brass">
          Only continue if you asked to change the email on this account.
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Current password" htmlFor="confirm-email-password">
            <Input
              id="confirm-email-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              disabled={status === 'submitting'}
              placeholder="••••••••"
              autoComplete="current-password"
              autoFocus
            />
          </Field>

          <Button type="submit" variant="primary" className="w-full" loading={status === 'submitting'}>
            Confirm email change
          </Button>
          <AuthBackLink onClick={() => navigate('/')} label="Cancel" />
        </form>
      </AuthCard>
    </AuthShell>
  );
}

import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { pb } from '../lib/pocketbase';
import { createLogger } from '../lib/logger';
import { AuthBackLink, AuthCard, AuthShell } from '../components/auth/AuthShell';
import { Button, Field, Input } from '../components/ui';

const log = createLogger('ResetPwd');

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');

  const token = searchParams.get('token');

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');

    if (!token) {
      setStatus('error');
      setError('No reset token provided.');
      return;
    }

    if (password !== passwordConfirm) {
      setError('The passwords do not match.');
      return;
    }

    if (password.length < 8) {
      setError('Use at least 8 characters.');
      return;
    }

    setStatus('submitting');

    try {
      await pb.collection('users').confirmPasswordReset(token, password, passwordConfirm);
      setStatus('success');
      window.setTimeout(() => navigate('/'), 2000);
    } catch (err: any) {
      log.error('Password reset error', err);
      setStatus('error');
      setError(
        err.message ||
          err.data?.message ||
          err.data?.data?.token?.message ||
          err.data?.data?.password?.message ||
          (err.status === 0 ? 'Cannot reach the server. Check your connection.' : '') ||
          'Failed to reset the password. The link may be expired or invalid.'
      );
    }
  };

  if (!token) {
    return (
      <AuthShell footer={<span />}>
        <AuthCard eyebrow="Account recovery" title="This link is not valid" description="The reset link is missing its token. Request a new one from the sign-in screen.">
          <p className="rounded-control border border-danger/25 bg-danger-soft px-3 py-2 text-sm text-danger">
            No reset token was provided.
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
        <AuthCard eyebrow="Account recovery" title="Password updated" description="You can sign in with the new password now. Taking you back to the sign-in screen…">
          <Button variant="primary" className="w-full" onClick={() => navigate('/')}>
            Go to sign in
          </Button>
        </AuthCard>
      </AuthShell>
    );
  }

  return (
    <AuthShell footer={<span />}>
      <AuthCard eyebrow="Account recovery" title="Choose a new password" description="Use at least 8 characters. Your password changes immediately, then you return to sign in.">
        {error && (
          <p role="alert" className="mb-4 rounded-control border border-danger/25 bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="New password" htmlFor="reset-password">
            <Input
              id="reset-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={8}
              disabled={status === 'submitting'}
              placeholder="••••••••"
              autoComplete="new-password"
              autoFocus
            />
          </Field>

          <Field label="Confirm new password" htmlFor="reset-confirm">
            <Input
              id="reset-confirm"
              type="password"
              value={passwordConfirm}
              onChange={(event) => setPasswordConfirm(event.target.value)}
              required
              minLength={8}
              disabled={status === 'submitting'}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </Field>

          <Button type="submit" variant="primary" className="w-full" loading={status === 'submitting'}>
            Update password
          </Button>
          <AuthBackLink onClick={() => navigate('/')} />
        </form>
      </AuthCard>
    </AuthShell>
  );
}

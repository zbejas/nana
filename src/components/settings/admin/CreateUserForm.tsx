import { useEffect, useRef, useState } from 'react';
import {
  ArrowPathIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  EyeSlashIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline';
import { Button, Card, Checkbox, Field, IconButton, Input, SectionHeading } from '../../ui';

interface CreateUserFormProps {
  onSubmit: (userData: {
    email: string;
    password: string;
    name: string;
    admin: boolean;
    sendPasswordEmail?: boolean;
  }) => Promise<void>;
  onCancel: () => void;
  isCreating: boolean;
  isClosing?: boolean;
  isCurrentUserVerified?: boolean;
}

export function CreateUserForm({ onSubmit, onCancel, isCreating, isClosing = false, isCurrentUserVerified = false }: CreateUserFormProps) {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    name: '',
    admin: false,
    sendPasswordEmail: true,
  });
  const [showPasswords, setShowPasswords] = useState(false);
  const [temporaryPasswordReveal, setTemporaryPasswordReveal] = useState(false);
  const revealTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (revealTimeoutRef.current) {
        clearTimeout(revealTimeoutRef.current);
      }
    };
  }, []);

  // Generate random password (12 characters with symbols)
  const generatePassword = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < 12; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setFormData((prev) => ({ ...prev, password }));

    if (!showPasswords) {
      setTemporaryPasswordReveal(true);
      if (revealTimeoutRef.current) {
        clearTimeout(revealTimeoutRef.current);
      }
      revealTimeoutRef.current = setTimeout(() => {
        setTemporaryPasswordReveal(false);
      }, 500);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit(formData);
    // Reset form
    setFormData({
      email: '',
      password: '',
      name: '',
      admin: false,
      sendPasswordEmail: true,
    });
    setShowPasswords(false);
    setTemporaryPasswordReveal(false);
  };

  return (
    <div className={`overflow-hidden ${isClosing ? 'animate-slideUp' : 'animate-slideDown'}`}>
      <Card className="p-4 sm:p-5">
        <form onSubmit={handleSubmit}>
          <SectionHeading
            title="Create new user"
            description="Add someone to this workspace and choose how they receive their password."
          />

          <div className="mt-4 space-y-4">
            <Field label="Email address" htmlFor="create-user-email">
              <Input
                id="create-user-email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="user@example.com"
                required
                autoComplete="off"
              />
            </Field>

            <Field label="Full name" htmlFor="create-user-name">
              <Input
                id="create-user-name"
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="John Doe"
                required
                autoComplete="off"
              />
            </Field>

            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <label htmlFor="create-user-password" className="text-[13px] font-medium text-ink">
                  Password
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="[&>svg]:h-3.5 [&>svg]:w-3.5"
                  icon={<ArrowPathIcon />}
                  onClick={generatePassword}
                  disabled={isCreating}
                  title="Generate random password"
                >
                  Generate
                </Button>
              </div>
              <div className="relative">
                <Input
                  id="create-user-password"
                  type={showPasswords || temporaryPasswordReveal ? 'text' : 'password'}
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="pr-11"
                  placeholder="Minimum 8 characters"
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
                <IconButton
                  label={showPasswords ? 'Hide password' : 'Show password'}
                  size="sm"
                  onClick={() => {
                    const nextShow = !showPasswords;
                    setShowPasswords(nextShow);
                    if (nextShow) {
                      setTemporaryPasswordReveal(false);
                      if (revealTimeoutRef.current) {
                        clearTimeout(revealTimeoutRef.current);
                      }
                    }
                  }}
                  disabled={isCreating}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2"
                >
                  {showPasswords ? <EyeSlashIcon /> : <EyeIcon />}
                </IconButton>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
                Must be at least 8 characters long
              </p>
            </div>

            <Checkbox
              id="create-user-send-password-email"
              checked={formData.sendPasswordEmail}
              onChange={(checked) => setFormData({ ...formData, sendPasswordEmail: checked })}
              disabled={isCreating}
              label="Send password to user via email"
              description="User will receive an email with their login credentials"
            />

            {isCurrentUserVerified && (
              <Checkbox
                id="admin-checkbox"
                checked={formData.admin}
                onChange={(checked) => setFormData({ ...formData, admin: checked })}
                label={
                  <span className="flex items-center gap-2">
                    <ShieldCheckIcon className="h-4 w-4 text-signal" aria-hidden="true" />
                    Grant administrator privileges
                  </span>
                }
                description={
                  <>
                    <ExclamationTriangleIcon
                      className="mr-1 inline h-3.5 w-3.5 text-warning"
                      aria-hidden="true"
                    />
                    Admins have full access to manage users, documents, and system settings.
                  </>
                }
              />
            )}

            <div className="flex gap-2 pt-1">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={onCancel}
                disabled={isCreating}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                className="flex-1"
                loading={isCreating}
                disabled={isCreating}
              >
                {isCreating ? 'Creating…' : 'Create user'}
              </Button>
            </div>
          </div>
        </form>
      </Card>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { pb } from '../../../lib/pocketbase';
import { Button, Card, Field, Input, SectionHeading, Select, Switch } from '../../ui';

type SMTPForm = {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  password: string;
  authMethod: 'PLAIN' | 'LOGIN';
  tls: boolean;
  localName: string;
  senderName: string;
  senderAddress: string;
};

const defaults: SMTPForm = {
  enabled: false,
  host: '',
  port: 587,
  username: '',
  password: '',
  authMethod: 'PLAIN',
  tls: true,
  localName: '',
  senderName: '',
  senderAddress: '',
};

export function SMTPSettings() {
  const [form, setForm] = useState<SMTPForm>(defaults);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const senderPreview = form.senderAddress
    ? `${form.senderName || 'Sender'} <${form.senderAddress}>`
    : 'Not set';

  const buildHeaders = (): HeadersInit => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = pb.authStore.token;
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  };

  const isAuthenticated = pb.authStore.isValid;
  const toggleDisabled = !isAuthenticated || loading || saving;
  const formDisabled = toggleDisabled || !form.enabled;
  const saveDisabled = toggleDisabled;

  useEffect(() => {
    const load = async () => {
      if (!isAuthenticated) {
        setError('Admin authentication required to manage SMTP.');
        return;
      }
      setLoading(true);
      setError(null);
      setMessage(null);
      try {
        const res = await fetch('/pb/api/admin/smtp', {
          headers: buildHeaders(),
        });
        if (!res.ok) {
          throw new Error(`Failed to load settings (${res.status})`);
        }
        const data = await res.json();
        if (data?.smtp) {
          setForm({
            enabled: !!data.smtp.enabled,
            host: data.smtp.host || '',
            port: Number(data.smtp.port) || 587,
            username: data.smtp.username || '',
            password: '', // never trust returned password
            authMethod: (data.smtp.authMethod || 'PLAIN').toUpperCase() === 'LOGIN' ? 'LOGIN' : 'PLAIN',
            tls: data.smtp.tls !== false,
            localName: data.smtp.localName || '',
            senderName: data.smtp.senderName || '',
            senderAddress: data.smtp.senderAddress || '',
          });
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load SMTP settings');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [isAuthenticated]);

  const handleChange = (key: keyof SMTPForm, value: SMTPForm[typeof key]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const payload = {
        smtp: {
          enabled: form.enabled,
          host: form.host,
          port: form.port,
          username: form.username,
          password: form.password || undefined,
          authMethod: form.authMethod,
          tls: form.tls,
          localName: form.localName,
          senderName: form.senderName,
          senderAddress: form.senderAddress,
        },
      };

      const res = await fetch('/pb/api/admin/smtp', {
        method: 'PATCH',
        headers: buildHeaders(),
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Failed to save settings (${res.status})`);
      }

      setMessage('SMTP settings updated.');
      // Clear password field after save
      setForm(prev => ({ ...prev, password: '' }));
    } catch (err: any) {
        setError(err.message || 'Failed to save SMTP settings');
    } finally {
      setSaving(false);
    }
  };

  const handleSendTest = async () => {
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      const res = await fetch('/pb/api/admin/smtp/test', {
        method: 'POST',
        headers: buildHeaders(),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Test email failed (${res.status})`);
      }
      setTestResult('Test email sent to your account email.');
    } catch (err: any) {
      setError(err.message || 'Failed to send test email');
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card className="p-5 sm:p-6">
      <SectionHeading
        title="SMTP configuration"
        description="Outgoing mail server for account email."
      />
      <p className="mt-2 text-xs text-ink-muted">
        From: <span className="text-ink-secondary">{senderPreview}</span>
      </p>

      <Switch
        id="smtp-enabled"
        className="mt-5"
        label="Enable SMTP"
        checked={form.enabled}
        onChange={(checked) => handleChange('enabled', checked)}
        disabled={toggleDisabled}
      />

      {error && (
        <p className="mt-4 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="mt-4 text-sm text-success" role="status">
          {message}
        </p>
      )}

      <form className="mt-5 space-y-5" onSubmit={handleSave}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Sender name" htmlFor="smtp-sender-name">
            <Input
              id="smtp-sender-name"
              type="text"
              value={form.senderName}
              onChange={(e) => handleChange('senderName', e.target.value)}
              placeholder="Docs Bot"
              disabled={formDisabled}
            />
          </Field>
          <Field label="Sender address" htmlFor="smtp-sender-address">
            <Input
              id="smtp-sender-address"
              type="email"
              value={form.senderAddress}
              onChange={(e) => handleChange('senderAddress', e.target.value)}
              placeholder="noreply@example.com"
              disabled={formDisabled}
            />
          </Field>
        </div>

        <div className="grid gap-4 border-t border-line pt-5 sm:grid-cols-2">
          <Field
            label="SMTP host"
            hint={!form.host ? 'e.g., smtp.gmail.com' : undefined}
            htmlFor="smtp-host"
          >
            <Input
              id="smtp-host"
              type="text"
              value={form.host}
              onChange={(e) => handleChange('host', e.target.value)}
              placeholder="smtp.example.com"
              required={form.enabled}
              disabled={formDisabled}
            />
          </Field>
          <Field
            label="Port"
            hint={!form.port ? 'Common: 587 (TLS), 465 (SSL), 25' : undefined}
            htmlFor="smtp-port"
          >
            <Input
              id="smtp-port"
              type="number"
              value={form.port}
              onChange={(e) => handleChange('port', Number(e.target.value))}
              placeholder="587"
              min={1}
              max={65535}
              required={form.enabled}
              disabled={formDisabled}
            />
          </Field>
          <Field
            label="Username"
            hint={!form.username ? 'Your SMTP login username' : undefined}
            htmlFor="smtp-username"
          >
            <Input
              id="smtp-username"
              type="text"
              value={form.username}
              onChange={(e) => handleChange('username', e.target.value)}
              placeholder="user@example.com"
              disabled={formDisabled}
            />
          </Field>
          <Field
            label="Password"
            hint={!form.password ? 'Leave blank to keep current' : undefined}
            htmlFor="smtp-password"
          >
            <Input
              id="smtp-password"
              type="password"
              value={form.password}
              onChange={(e) => handleChange('password', e.target.value)}
              placeholder="••••••••"
              disabled={formDisabled}
            />
          </Field>
          <Field label="Auth method" hint="PLAIN is most common" htmlFor="smtp-auth-method">
            <Select
              id="smtp-auth-method"
              value={form.authMethod}
              onChange={(e) => handleChange('authMethod', e.target.value as SMTPForm['authMethod'])}
              disabled={formDisabled}
            >
              <option value="PLAIN">PLAIN (default)</option>
              <option value="LOGIN">LOGIN</option>
            </Select>
          </Field>
          <div>
            <Switch
              id="smtp-tls"
              label="Require TLS"
              description="Auto by default. Enable if your provider requires it."
              checked={form.tls}
              onChange={(checked) => handleChange('tls', checked)}
              disabled={formDisabled}
            />
          </div>
        </div>

        <div className="border-t border-line pt-5">
          <Field
            label="Local name"
            hint={!form.localName ? 'Used for HELO/EHLO command' : undefined}
            optional
            htmlFor="smtp-local-name"
          >
            <Input
              id="smtp-local-name"
              type="text"
              value={form.localName}
              onChange={(e) => handleChange('localName', e.target.value)}
              placeholder="localhost"
              disabled={formDisabled}
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
          <Button
            type="button"
            variant="secondary"
            loading={testing}
            onClick={handleSendTest}
            disabled={formDisabled}
          >
            Send test email
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={saveDisabled}>
            Save SMTP
          </Button>
        </div>

        {testResult && (
          <p className="text-sm text-success" role="status">
            {testResult}
          </p>
        )}
      </form>
    </Card>
  );
}

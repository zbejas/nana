import { useEffect, useState } from 'react';
import { pb } from '../../../lib/pocketbase';

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
    <div className="space-y-4">
      <div className="bg-white/5 rounded-lg p-6 border border-white/10">
        <div className="flex items-center justify-between gap-2 mb-4">
          <div>
            <h3 className="text-lg font-semibold text-white">SMTP Configuration</h3>
            <p className="text-xs text-gray-300 mt-1">From: <span className="text-white">{senderPreview}</span></p>
          </div>
          <label className="inline-flex items-center gap-2.5 text-sm text-gray-300 cursor-pointer hover:text-white transition-colors group">
            <div className="relative inline-flex items-center justify-center flex-shrink-0">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => handleChange('enabled', e.target.checked)}
                className="appearance-none w-5 h-5 rounded border-2 border-white/30 bg-black/40 cursor-pointer transition-all
                           hover:border-white/50 hover:bg-black/60
                           focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:ring-offset-2 focus:ring-offset-black
                           checked:bg-blue-500 checked:border-blue-500 checked:hover:bg-blue-600 checked:hover:border-blue-600
                           disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={toggleDisabled}
              />
              {form.enabled && (
                <svg className="absolute inset-0 w-5 h-5 text-white pointer-events-none" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </div>
            <span className="select-none leading-5">Enable SMTP</span>
          </label>
        </div>

        {error && <div className="mb-4 rounded bg-red-900/30 border border-red-700 text-red-200 px-3 py-2 text-sm">{error}</div>}
        {message && <div className="mb-4 rounded bg-green-900/30 border border-green-700 text-green-200 px-3 py-2 text-sm">{message}</div>}

        <div className="relative">
          <form className="space-y-4" onSubmit={handleSave}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-b border-white/10 pb-4">
            <div>
              <label className="block text-sm text-gray-300 mb-1">
                Sender Name
              </label>
              <input
                type="text"
                value={form.senderName}
                onChange={(e) => handleChange('senderName', e.target.value)}
                className="w-full bg-black/30 border border-white/10 rounded px-3 py-2 text-white placeholder:text-gray-500 disabled:text-gray-400 disabled:placeholder:text-gray-500/70 disabled:border-white/20 disabled:bg-black/20"
                placeholder="Docs Bot"
                disabled={formDisabled}
              />
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1">
                Sender Address
              </label>
              <input
                type="email"
                value={form.senderAddress}
                onChange={(e) => handleChange('senderAddress', e.target.value)}
                  className="w-full bg-black/30 border border-white/10 rounded px-3 py-2 text-white placeholder:text-gray-500 disabled:text-gray-400 disabled:placeholder:text-gray-500/70 disabled:border-white/20 disabled:bg-black/20"
                placeholder="noreply@example.com"
                disabled={formDisabled}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-300 mb-1">
                SMTP Host
                {!form.host && <span className="text-gray-500 ml-2 text-xs">e.g., smtp.gmail.com</span>}
              </label>
              <input
                type="text"
                value={form.host}
                onChange={(e) => handleChange('host', e.target.value)}
                className="w-full bg-black/30 border border-white/10 rounded px-3 py-2 text-white placeholder:text-gray-500 disabled:text-gray-400 disabled:placeholder:text-gray-500/70 disabled:border-white/20 disabled:bg-black/20"
                placeholder="smtp.example.com"
                required={form.enabled}
                disabled={formDisabled}
              />
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1">
                Port
                {!form.port && <span className="text-gray-500 ml-2 text-xs">Common: 587 (TLS), 465 (SSL), 25</span>}
              </label>
              <input
                type="number"
                value={form.port}
                onChange={(e) => handleChange('port', Number(e.target.value))}
                className="w-full bg-black/30 border border-white/10 rounded px-3 py-2 text-white placeholder:text-gray-500 disabled:text-gray-400 disabled:placeholder:text-gray-500/70 disabled:border-white/20 disabled:bg-black/20"
                placeholder="587"
                min={1}
                max={65535}
                required={form.enabled}
                disabled={formDisabled}
              />
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1">
                Username
                {!form.username && <span className="text-gray-500 ml-2 text-xs">Your SMTP login username</span>}
              </label>
              <input
                type="text"
                value={form.username}
                onChange={(e) => handleChange('username', e.target.value)}
                className="w-full bg-black/30 border border-white/10 rounded px-3 py-2 text-white placeholder:text-gray-500 disabled:text-gray-400 disabled:placeholder:text-gray-500/70 disabled:border-white/20 disabled:bg-black/20"
                placeholder="user@example.com"
                disabled={formDisabled}
              />
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1">
                Password
                {!form.password && <span className="text-gray-500 ml-2 text-xs">Leave blank to keep current</span>}
              </label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => handleChange('password', e.target.value)}
                className="w-full bg-black/30 border border-white/10 rounded px-3 py-2 text-white placeholder:text-gray-500 disabled:text-gray-400 disabled:placeholder:text-gray-500/70 disabled:border-white/20 disabled:bg-black/20"
                placeholder="••••••••"
                disabled={formDisabled}
              />
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1">
                Auth Method
                <span className="text-gray-500 ml-2 text-xs">PLAIN is most common</span>
              </label>
              <select
                value={form.authMethod}
                onChange={(e) => handleChange('authMethod', e.target.value as SMTPForm['authMethod'])}
                className="w-full bg-black/30 border border-white/10 rounded px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-white disabled:text-gray-400 disabled:border-white/20 disabled:bg-black/20 [&>option]:bg-gray-900 [&>option]:text-white"
                disabled={formDisabled}
              >
                <option value="PLAIN">PLAIN (default)</option>
                <option value="LOGIN">LOGIN</option>
              </select>
            </div>
            <div className="flex items-center gap-2 pt-6">
              <label className="inline-flex items-center gap-2.5 cursor-pointer hover:text-white transition-colors group">
                <div className="relative inline-flex items-center justify-center flex-shrink-0">
                  <input
                    type="checkbox"
                    checked={form.tls}
                    onChange={(e) => handleChange('tls', e.target.checked)}
                    className="appearance-none w-5 h-5 rounded border-2 border-white/30 bg-black/40 cursor-pointer transition-all
                               hover:border-white/50 hover:bg-black/60
                               focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:ring-offset-2 focus:ring-offset-black
                               checked:bg-blue-500 checked:border-blue-500 checked:hover:bg-blue-600 checked:hover:border-blue-600
                               disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={formDisabled}
                  />
                  {form.tls && (
                    <svg className="absolute inset-0 w-5 h-5 text-white pointer-events-none" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
                <span className="text-sm text-gray-300 group-hover:text-white transition-colors select-none leading-5">
                  Require TLS
                  <span className="text-gray-500 ml-2 text-xs">Auto by default, check if your provider requires it</span>
                </span>
              </label>
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-300 mb-1">
              Local Name (optional)
              {!form.localName && <span className="text-gray-500 ml-2 text-xs">Used for HELO/EHLO command</span>}
            </label>
            <input
              type="text"
              value={form.localName}
              onChange={(e) => handleChange('localName', e.target.value)}
              className="w-full bg-black/30 border border-white/10 rounded px-3 py-2 text-white placeholder:text-gray-500 disabled:text-gray-400 disabled:placeholder:text-gray-500/70 disabled:border-white/20 disabled:bg-black/20"
              placeholder="localhost"
              disabled={formDisabled}
            />
          </div>

          <div className="flex justify-between items-center gap-3 pt-2 flex-wrap">
            <button
              type="button"
              onClick={handleSendTest}
              className="px-4 py-2 rounded bg-white/10 text-white hover:bg-white/20 disabled:opacity-50"
              disabled={formDisabled || testing}
            >
              {testing ? 'Sending...' : 'Send Test to My Email'}
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded bg-white/10 text-white hover:bg-white/20 disabled:opacity-50"
              disabled={saveDisabled}
            >
              {saving ? 'Saving...' : 'Save SMTP'}
            </button>
          </div>
        </form>
        </div>

        {testResult && <p className="text-sm text-gray-300 pt-3">{testResult}</p>}
      </div>
    </div>
  );
}

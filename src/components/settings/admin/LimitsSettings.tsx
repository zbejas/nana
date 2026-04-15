import { useEffect, useState } from 'react';
import { pb } from '../../../lib/pocketbase';

type LimitsForm = {
  maxAttachmentSizeMB: number;
  maxAttachments: number;
};

type RateLimitForm = {
  enabled: boolean;
  pbMaxPerMinute: number;
  appMaxPerMinute: number;
};

const defaults: LimitsForm = {
  maxAttachmentSizeMB: 50,
  maxAttachments: 20,
};

const rateLimitDefaults: RateLimitForm = {
  enabled: false,
  pbMaxPerMinute: 600,
  appMaxPerMinute: 1200,
};

export function LimitsSettings() {
  const [form, setForm] = useState<LimitsForm>(defaults);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Rate limit state
  const [rlForm, setRlForm] = useState<RateLimitForm>(rateLimitDefaults);
  const [rlRecordId, setRlRecordId] = useState<string | null>(null);
  const [rlLoading, setRlLoading] = useState(false);
  const [rlSaving, setRlSaving] = useState(false);
  const [rlError, setRlError] = useState<string | null>(null);
  const [rlMessage, setRlMessage] = useState<string | null>(null);

  const isAuthenticated = pb.authStore.isValid;

  const buildHeaders = (): HeadersInit => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = pb.authStore.token;
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  };

  useEffect(() => {
    const load = async () => {
      if (!isAuthenticated) {
        setError('Admin authentication required to manage limits.');
        return;
      }

      setLoading(true);
      setError(null);
      setMessage(null);

      try {
        const res = await fetch('/pb/api/admin/attachments', {
          headers: buildHeaders(),
        });

        if (!res.ok) {
          throw new Error(`Failed to load limits (${res.status})`);
        }

        const data = await res.json();
        const attachments = data?.attachments;

        if (attachments) {
          setForm({
            maxAttachmentSizeMB: Number(attachments.maxAttachmentSizeMB) || defaults.maxAttachmentSizeMB,
            maxAttachments: Number(attachments.maxAttachments) || defaults.maxAttachments,
          });
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load attachment limits');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [isAuthenticated]);

  // Load rate limit settings directly from PocketBase settings collection
  useEffect(() => {
    const loadRateLimits = async () => {
      if (!isAuthenticated) return;

      setRlLoading(true);
      setRlError(null);
      setRlMessage(null);

      try {
        const record = await pb.collection('settings').getFirstListItem('key="rate_limits"');
        setRlRecordId(record.id);
        const value = record.value as Partial<RateLimitForm> | undefined;

        if (value) {
          setRlForm({
            enabled: !!value.enabled,
            pbMaxPerMinute: Number(value.pbMaxPerMinute) || rateLimitDefaults.pbMaxPerMinute,
            appMaxPerMinute: Number(value.appMaxPerMinute) || rateLimitDefaults.appMaxPerMinute,
          });
        }
      } catch (err: any) {
        // 404 = record doesn't exist yet, use defaults
        if (err?.status !== 404) {
          setRlError(err.message || 'Failed to load rate limit settings');
        }
      } finally {
        setRlLoading(false);
      }
    };

    loadRateLimits();
  }, [isAuthenticated]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const payload = {
        attachments: {
          maxAttachmentSizeMB: Math.floor(form.maxAttachmentSizeMB),
          maxAttachments: Math.floor(form.maxAttachments),
        },
      };

      const res = await fetch('/pb/api/admin/attachments', {
        method: 'PATCH',
        headers: buildHeaders(),
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Failed to save limits (${res.status})`);
      }

      setMessage('Attachment limits updated.');
    } catch (err: any) {
      setError(err.message || 'Failed to save attachment limits');
    } finally {
      setSaving(false);
    }
  };

  const handleRateLimitSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setRlSaving(true);
    setRlError(null);
    setRlMessage(null);

    try {
      const newValue = {
        enabled: rlForm.enabled,
        pbMaxPerMinute: Math.floor(rlForm.pbMaxPerMinute),
        appMaxPerMinute: Math.floor(rlForm.appMaxPerMinute),
      };

      if (rlRecordId) {
        await pb.collection('settings').update(rlRecordId, { value: newValue });
      } else {
        const record = await pb.collection('settings').create({
          key: 'rate_limits',
          value: newValue,
          description: 'Rate limiting configuration for the Bun server (per-IP, in-memory)',
        });
        setRlRecordId(record.id);
      }

      // Tell the Bun server to reload rate limit config
      try {
        await fetch('/api/admin/rate-limits/reload', {
          method: 'POST',
          headers: buildHeaders(),
        });
      } catch {
        // Non-critical: config will be picked up on next server restart
      }

      setRlMessage('Rate limit settings updated.');
    } catch (err: any) {
      setRlError(err.message || 'Failed to save rate limit settings');
    } finally {
      setRlSaving(false);
    }
  };

  const disabled = !isAuthenticated || loading || saving;
  const rlDisabled = !isAuthenticated || rlLoading || rlSaving;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="rounded-xl border border-white/10 bg-white/5 p-6 h-full">
          <div className="mb-6 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-white">Attachments Limits</h3>
              <p className="mt-1 text-sm text-gray-400">
                Configure maximum size and count for document attachments.
              </p>
            </div>
          </div>

          {error && <div className="mb-4 rounded bg-red-900/30 border border-red-700 text-red-200 px-3 py-2 text-sm">{error}</div>}
          {message && <div className="mb-4 rounded bg-green-900/30 border border-green-700 text-green-200 px-3 py-2 text-sm">{message}</div>}

          <form className="space-y-5" onSubmit={handleSave}>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label className="text-sm font-medium text-gray-200">Max attachment size (MB)</label>
                <span className="text-xs text-gray-500">Per file</span>
              </div>
              <input
                type="number"
                min={1}
                step={1}
                value={form.maxAttachmentSizeMB}
                onChange={(e) => setForm((prev) => ({ ...prev, maxAttachmentSizeMB: Number(e.target.value) }))}
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-white placeholder:text-gray-500 disabled:text-gray-400 disabled:border-white/20 disabled:bg-black/20"
                disabled={disabled}
                required
              />
              <p className="text-xs text-gray-500">Maximum size for each uploaded file.</p>
            </div>

            <div className="border-t border-white/10 pt-5 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label className="text-sm font-medium text-gray-200">Max attachments per document</label>
                <span className="text-xs text-gray-500">Per document</span>
              </div>
              <input
                type="number"
                min={1}
                step={1}
                value={form.maxAttachments}
                onChange={(e) => setForm((prev) => ({ ...prev, maxAttachments: Number(e.target.value) }))}
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-white placeholder:text-gray-500 disabled:text-gray-400 disabled:border-white/20 disabled:bg-black/20"
                disabled={disabled}
                required
              />
              <p className="text-xs text-gray-500">Total number of files allowed on one document.</p>
            </div>

            <div className="border-t border-white/10 pt-4 flex justify-end">
              <button
                type="submit"
                disabled={disabled}
                className="px-4 py-2 rounded bg-white/10 text-white hover:bg-white/20 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save attachment limits'}
              </button>
            </div>
          </form>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 p-6 h-full">
          <div className="mb-6 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-white">Rate Limits</h3>
              <p className="mt-1 text-sm text-gray-400">
                Per-IP request rate limiting for server routes.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs font-medium text-gray-400">
                {rlForm.enabled ? 'Enabled' : 'Disabled'}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={rlForm.enabled}
                onClick={() => setRlForm((prev) => ({ ...prev, enabled: !prev.enabled }))}
                disabled={rlDisabled}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 ${
                  rlForm.enabled ? 'bg-green-600' : 'bg-white/10'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    rlForm.enabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          {rlError && <div className="mb-4 rounded bg-red-900/30 border border-red-700 text-red-200 px-3 py-2 text-sm">{rlError}</div>}
          {rlMessage && <div className="mb-4 rounded bg-green-900/30 border border-green-700 text-green-200 px-3 py-2 text-sm">{rlMessage}</div>}

          <form className="space-y-5" onSubmit={handleRateLimitSave}>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label className="text-sm font-medium text-gray-200">PocketBase proxy (/pb/*)</label>
                <span className="text-xs text-gray-500">Requests / min</span>
              </div>
              <input
                type="number"
                min={1}
                step={1}
                value={rlForm.pbMaxPerMinute}
                onChange={(e) => setRlForm((prev) => ({ ...prev, pbMaxPerMinute: Number(e.target.value) }))}
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-white placeholder:text-gray-500 disabled:text-gray-400 disabled:border-white/20 disabled:bg-black/20"
                disabled={rlDisabled || !rlForm.enabled}
                required
              />
              <p className="text-xs text-gray-500">Max requests per minute per IP for PocketBase API routes.</p>
            </div>

            <div className="border-t border-white/10 pt-5 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label className="text-sm font-medium text-gray-200">App routes (/*)</label>
                <span className="text-xs text-gray-500">Requests / min</span>
              </div>
              <input
                type="number"
                min={1}
                step={1}
                value={rlForm.appMaxPerMinute}
                onChange={(e) => setRlForm((prev) => ({ ...prev, appMaxPerMinute: Number(e.target.value) }))}
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-white placeholder:text-gray-500 disabled:text-gray-400 disabled:border-white/20 disabled:bg-black/20"
                disabled={rlDisabled || !rlForm.enabled}
                required
              />
              <p className="text-xs text-gray-500">Max requests per minute per IP for static files, export, and chat routes.</p>
            </div>

            <div className="border-t border-white/10 pt-4 flex justify-end">
              <button
                type="submit"
                disabled={rlDisabled}
                className="px-4 py-2 rounded bg-white/10 text-white hover:bg-white/20 disabled:opacity-50"
              >
                {rlSaving ? 'Saving...' : 'Save rate limits'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

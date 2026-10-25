import { useEffect, useState } from 'react';
import { pb } from '../../../lib/pocketbase';
import { Button, Card, Field, Input, SectionHeading, Switch } from '../../ui';

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
        const response = await fetch('/api/v1/admin/attachments', { headers: buildHeaders() });
        if (!response.ok) {
          throw new Error(`Failed to load limits (${response.status})`);
        }

        const data = await response.json();
        const attachments = data?.attachments;

        if (attachments) {
          setForm({
            maxAttachmentSizeMB: Number(attachments.maxAttachmentSizeMB) || defaults.maxAttachmentSizeMB,
            maxAttachments: Number(attachments.maxAttachments) || defaults.maxAttachments,
          });
        }
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load attachment limits');
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [isAuthenticated]);

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
            enabled: Boolean(value.enabled),
            pbMaxPerMinute: Number(value.pbMaxPerMinute) || rateLimitDefaults.pbMaxPerMinute,
            appMaxPerMinute: Number(value.appMaxPerMinute) || rateLimitDefaults.appMaxPerMinute,
          });
        }
      } catch (loadError) {
        const status = (loadError as { status?: number })?.status;
        if (status !== 404) {
          setRlError(loadError instanceof Error ? loadError.message : 'Failed to load rate limit settings');
        }
      } finally {
        setRlLoading(false);
      }
    };

    void loadRateLimits();
  }, [isAuthenticated]);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
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

      const response = await fetch('/api/v1/admin/attachments', {
        method: 'PATCH',
        headers: buildHeaders(),
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Failed to save limits (${response.status})`);
      }

      setMessage('Attachment limits updated');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save attachment limits');
    } finally {
      setSaving(false);
    }
  };

  const handleRateLimitSave = async (event: React.FormEvent) => {
    event.preventDefault();
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

      try {
        await fetch('/api/admin/rate-limits/reload', { method: 'POST', headers: buildHeaders() });
      } catch {
        // Non-critical: config will be picked up on next server restart.
      }

      setRlMessage('Rate limits updated');
    } catch (saveError) {
      setRlError(saveError instanceof Error ? saveError.message : 'Failed to save rate limit settings');
    } finally {
      setRlSaving(false);
    }
  };

  const disabled = !isAuthenticated || loading || saving;
  const rlDisabled = !isAuthenticated || rlLoading || rlSaving;

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <Card className="flex flex-col p-5 sm:p-6">
        <SectionHeading
          eyebrow="Storage"
          title="Attachment limits"
          description="The ceiling for each file and for a single note."
        />

        <form className="mt-5 flex flex-1 flex-col gap-4" onSubmit={handleSave}>
          <Field
            label="Max file size"
            htmlFor="attachment-size"
            hint="Megabytes per uploaded file."
            error={error}
          >
            <div className="relative">
              <Input
                id="attachment-size"
                type="number"
                min={1}
                step={1}
                value={form.maxAttachmentSizeMB}
                onChange={(event) => setForm((prev) => ({ ...prev, maxAttachmentSizeMB: Number(event.target.value) }))}
                disabled={disabled}
                required
                className="pr-12"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-muted">MB</span>
            </div>
          </Field>

          <Field
            label="Max attachments per note"
            htmlFor="attachment-count"
            hint="Total files allowed on one document."
          >
            <Input
              id="attachment-count"
              type="number"
              min={1}
              step={1}
              value={form.maxAttachments}
              onChange={(event) => setForm((prev) => ({ ...prev, maxAttachments: Number(event.target.value) }))}
              disabled={disabled}
              required
            />
          </Field>

          <div className="mt-auto flex flex-wrap items-center justify-end gap-3 border-t border-line pt-4">
            {message && <p className="mr-auto text-sm text-success">{message}</p>}
            <Button type="submit" variant="primary" loading={saving} disabled={disabled}>
              Save limits
            </Button>
          </div>
        </form>
      </Card>

      <Card className="flex flex-col p-5 sm:p-6">
        <SectionHeading
          eyebrow="Traffic"
          title="Rate limits"
          description="Per-IP request ceilings. Leave off unless you need to slow abuse."
          actions={
            <Switch
              label="Rate limiting"
              checked={rlForm.enabled}
              onChange={(enabled) => setRlForm((prev) => ({ ...prev, enabled }))}
              disabled={rlDisabled}
            />
          }
        />

        <form className="mt-5 flex flex-1 flex-col gap-4" onSubmit={handleRateLimitSave}>
          <Field
            label="API"
            htmlFor="rl-pb"
            hint="Requests per minute per IP for /api/v1 routes."
            error={rlError}
          >
            <div className="relative">
              <Input
                id="rl-pb"
                type="number"
                min={1}
                step={1}
                value={rlForm.pbMaxPerMinute}
                onChange={(event) => setRlForm((prev) => ({ ...prev, pbMaxPerMinute: Number(event.target.value) }))}
                disabled={rlDisabled || !rlForm.enabled}
                required
                className="pr-16"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-muted">req/min</span>
            </div>
          </Field>

          <Field
            label="App routes"
            htmlFor="rl-app"
            hint="Requests per minute per IP for pages, export, and chat."
          >
            <div className="relative">
              <Input
                id="rl-app"
                type="number"
                min={1}
                step={1}
                value={rlForm.appMaxPerMinute}
                onChange={(event) => setRlForm((prev) => ({ ...prev, appMaxPerMinute: Number(event.target.value) }))}
                disabled={rlDisabled || !rlForm.enabled}
                required
                className="pr-16"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-muted">req/min</span>
            </div>
          </Field>

          <div className="mt-auto flex flex-wrap items-center justify-end gap-3 border-t border-line pt-4">
            {rlMessage && <p className="mr-auto text-sm text-success">{rlMessage}</p>}
            {!rlForm.enabled && <p className="mr-auto text-sm text-ink-muted">Rate limiting is off.</p>}
            <Button type="submit" variant="primary" loading={rlSaving} disabled={rlDisabled}>
              Save rate limits
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

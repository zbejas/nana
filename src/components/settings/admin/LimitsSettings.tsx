import { useEffect, useState } from 'react';
import { pb } from '../../../lib/pocketbase';
import { Button, Card, Field, Input, SectionHeading } from '../../ui';
import { RateLimitSettings } from './RateLimitSettings';

type LimitsForm = {
  maxAttachmentSizeMB: number;
  maxAttachments: number;
};

const defaults: LimitsForm = {
  maxAttachmentSizeMB: 50,
  maxAttachments: 20,
};

export function LimitsSettings() {
  const [form, setForm] = useState<LimitsForm>(defaults);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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

  const disabled = !isAuthenticated || loading || saving;

  return (
    <div className="space-y-5">
      <Card className="flex flex-col p-5 sm:p-6">
        <SectionHeading
          eyebrow="Storage"
          title="Attachment limits"
          description="The ceiling for each file and for a single note."
        />

        <form className="mt-5 flex flex-1 flex-col" onSubmit={handleSave}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-end gap-3 border-t border-line pt-4">
            {message && <p className="mr-auto text-sm text-success">{message}</p>}
            <Button type="submit" variant="primary" loading={saving} disabled={disabled}>
              Save limits
            </Button>
          </div>
        </form>
      </Card>

      <RateLimitSettings />
    </div>
  );
}

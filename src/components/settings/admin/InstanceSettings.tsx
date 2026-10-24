import { useEffect, useState } from 'react';
import { pb } from '../../../lib/pocketbase';
import type { RecordModel } from 'pocketbase';
import { createLogger } from '../../../lib/logger';
import { Button, Card, Field, Input, SectionHeading, Select, Spinner } from '../../ui';

const log = createLogger('Instance');

interface SettingRecord extends RecordModel {
  key: string;
  value: { url?: string };
  description: string;
}

export function InstanceSettings() {
  const [siteUrlRecord, setSiteUrlRecord] = useState<SettingRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [siteUrl, setSiteUrl] = useState('');
  const [protocol, setProtocol] = useState<'https://' | 'http://'>('https://');

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setLoading(true);
      setError(null);

      const record = await pb.collection('settings').getFirstListItem<SettingRecord>('key="site_url"');
      setSiteUrlRecord(record);
      const url = record.value?.url || '';
      if (url.startsWith('http://')) {
        setProtocol('http://');
        setSiteUrl(url.replace(/^http:\/\//, ''));
      } else {
        setProtocol('https://');
        setSiteUrl(url.replace(/^https?:\/\//, ''));
      }
    } catch (loadError) {
      log.error('Failed to load settings', loadError);
      setError(loadError instanceof Error ? loadError.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccessMessage(null);

      const host = siteUrl.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
      const normalizedUrl = host ? `${protocol}${host}` : '';

      if (siteUrlRecord) {
        await pb.collection('settings').update(siteUrlRecord.id, { value: { url: normalizedUrl } });
      } else {
        const newRecord = await pb.collection('settings').create<SettingRecord>({
          key: 'site_url',
          value: { url: normalizedUrl },
          description: 'Base URL for the Nana instance (used in SMTP email links)',
        });
        setSiteUrlRecord(newRecord);
      }

      if (normalizedUrl) {
        try {
          await pb.send('/api/admin/app-url', { method: 'PATCH', body: { url: normalizedUrl } });
        } catch (syncError) {
          log.warn('Failed to sync PocketBase appURL', syncError);
        }
      }

      setSiteUrl(host);
      setSuccessMessage('Instance address saved');
      window.setTimeout(() => setSuccessMessage(null), 3000);
    } catch (saveError) {
      log.error('Failed to save settings', saveError);
      setError(saveError instanceof Error ? saveError.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card className="flex items-center justify-center p-6">
        <Spinner />
      </Card>
    );
  }

  return (
    <Card className="p-5 sm:p-6">
      <SectionHeading
        eyebrow="Address"
        title="Where this instance lives"
        description="Used in email links and OAuth redirects. Include the public address people open in a browser."
      />

      <div className="mt-5 max-w-xl space-y-4">
        <Field
          label="Site URL"
          htmlFor="site_url"
          hint="The public origin, without a trailing slash."
          error={error}
        >
          <div className="flex">
            <Select
              aria-label="Protocol"
              value={protocol}
              onChange={(event) => setProtocol(event.target.value as 'https://' | 'http://')}
              className="w-[7.75rem] rounded-r-none border-r-0"
            >
              <option value="https://">https://</option>
              <option value="http://">http://</option>
            </Select>
            <Input
              id="site_url"
              type="text"
              value={siteUrl}
              onChange={(event) => setSiteUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void handleSave();
                }
              }}
              placeholder="nana.example.com"
              className="rounded-l-none"
            />
          </div>
        </Field>

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={() => void handleSave()} loading={saving}>
            Save address
          </Button>
          {successMessage && <p className="text-sm text-sage">{successMessage}</p>}
        </div>
      </div>
    </Card>
  );
}

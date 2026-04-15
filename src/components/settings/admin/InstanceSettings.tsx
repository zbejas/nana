import { useState, useEffect } from 'react';
import { pb } from '../../../lib/pocketbase';
import type { RecordModel } from 'pocketbase';
import { LimitsSettings } from './LimitsSettings';
import { createLogger } from '../../../lib/logger';

const log = createLogger('Instance');

interface SettingRecord extends RecordModel {
  key: string;
  value: any;
  description: string;
}

export function InstanceSettings() {
  const [siteUrlRecord, setSiteUrlRecord] = useState<SettingRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Form state
  const [siteUrl, setSiteUrl] = useState('');

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch site_url setting from the settings collection
      const record = await pb.collection('settings').getFirstListItem<SettingRecord>('key="site_url"');
      setSiteUrlRecord(record);
      setSiteUrl(record.value?.url || '');
    } catch (err: any) {
      log.error('Failed to load settings', err);
      setError(err.message || 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccessMessage(null);

      // Normalize URL (remove trailing slash, ensure https)
      let normalizedUrl = siteUrl.trim();
      if (normalizedUrl) {
        // Remove http:// or https:// if present
        normalizedUrl = normalizedUrl.replace(/^https?:\/\//, '');
        // Always add https://
        normalizedUrl = `https://${normalizedUrl}`;
        // Remove trailing slash
        normalizedUrl = normalizedUrl.replace(/\/$/, '');
      }

      if (siteUrlRecord) {
        // Update existing record
        await pb.collection('settings').update(siteUrlRecord.id, {
          value: { url: normalizedUrl },
        });
      } else {
        // Create new record (shouldn't happen with migration, but handle it)
        const newRecord = await pb.collection('settings').create<SettingRecord>({
          key: 'site_url',
          value: { url: normalizedUrl },
          description: 'Base URL for the Nana instance (used in SMTP email links)',
        });
        setSiteUrlRecord(newRecord);
      }

      setSiteUrl(normalizedUrl);
      setSuccessMessage('Settings saved successfully');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      log.error('Failed to save settings', err);
      setError(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-5 rounded-xl border border-white/10 bg-white/5 p-6">
        <div>
          <h3 className="text-lg font-semibold text-white">Instance Settings</h3>
          <p className="mt-1 text-sm text-gray-400">
            Configure core instance values used across the web app.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {successMessage && (
          <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-3">
            <p className="text-sm text-green-400">{successMessage}</p>
          </div>
        )}

        <div className="space-y-2">
          <label htmlFor="site_url" className="block text-sm font-medium text-gray-300">
            Site URL
          </label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              id="site_url"
              type="text"
              value={siteUrl}
              onChange={(e) => setSiteUrl(e.target.value)}
              placeholder="nana.example.com or https://nana.example.com"
              className="w-full rounded-lg border border-white/20 bg-black/30 px-4 py-2.5 text-sm text-white placeholder-gray-500 transition-colors focus:border-white/30 focus:outline-none focus:ring-2 focus:ring-white/20"
            />
            <button
              onClick={handleSave}
              disabled={saving}
              className="shrink-0 px-4 py-2 rounded bg-white/10 text-white hover:bg-white/20 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
          <p className="text-xs text-gray-500">
            Enter your domain (e.g., <code className="rounded bg-white/10 px-1 py-0.5">nana.example.com</code>). HTTPS will be enforced automatically.
          </p>
        </div>
      </div>

      <LimitsSettings />
    </div>
  );
}

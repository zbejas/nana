import { useState, useEffect } from 'react';
import { pb } from '../../../lib/pocketbase';
import type { RecordModel } from 'pocketbase';
import type { AIConfig, AIProviderKey, AIProviderConfig } from '../../../lib/ai/types';
import { DEFAULT_AI_CONFIG, PROVIDER_META } from '../../../lib/ai/types';
import { ProviderCard } from './ai/ProviderCard';
import { EmbeddingSettings } from './ai/EmbeddingSettings';
import { createLogger } from '../../../lib/logger';

const log = createLogger('AISettings');

interface SettingRecord extends RecordModel {
  key: string;
  value: any;
  description: string;
}

const PROVIDER_KEYS: AIProviderKey[] = ['openai', 'google', 'ollama'];

export function AISettings() {
  const [record, setRecord] = useState<SettingRecord | null>(null);
  const [config, setConfig] = useState<AIConfig>(structuredClone(DEFAULT_AI_CONFIG));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      setLoading(true);
      setError(null);
      const rec = await pb.collection('settings').getFirstListItem<SettingRecord>('key="ai_config"');
      setRecord(rec);
      // Merge with defaults so new fields are always present
      const merged: AIConfig = {
        ...DEFAULT_AI_CONFIG,
        ...rec.value,
        systemPrompt: rec.value?.systemPrompt ?? DEFAULT_AI_CONFIG.systemPrompt,
        titlePrompt: rec.value?.titlePrompt ?? DEFAULT_AI_CONFIG.titlePrompt,
        providers: {
          ...DEFAULT_AI_CONFIG.providers,
          ...(rec.value?.providers ?? {}),
        },
      };
      for (const key of PROVIDER_KEYS) {
        merged.providers[key] = {
          ...DEFAULT_AI_CONFIG.providers[key],
          ...(rec.value?.providers?.[key] ?? {}),
        };
      }
      setConfig(merged);
    } catch (err: any) {
      log.error('Failed to load AI config', err);
      setError(err.message || 'Failed to load AI configuration');
    } finally {
      setLoading(false);
    }
  };

  const handleProviderChange = (provider: AIProviderKey, field: keyof AIProviderConfig, value: string | number | null) => {
    setConfig((prev) => ({
      ...prev,
      providers: {
        ...prev.providers,
        [provider]: {
          ...prev.providers[provider],
          [field]: value,
        },
      },
    }));
  };

  const handleActivate = (provider: AIProviderKey) => {
    setConfig((prev) => ({ ...prev, activeProvider: provider }));
  };

  const handleDeactivate = () => {
    setConfig((prev) => ({ ...prev, activeProvider: null }));
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccessMessage(null);

      if (record) {
        await pb.collection('settings').update(record.id, { value: config });
      } else {
        const newRecord = await pb.collection('settings').create<SettingRecord>({
          key: 'ai_config',
          value: config,
          description: 'AI provider configuration (models, API keys, embedding settings)',
        });
        setRecord(newRecord);
      }

      setSuccessMessage('AI configuration saved successfully');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      log.error('Failed to save AI config', err);
      setError(err.message || 'Failed to save AI configuration');
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
      {/* Header section */}
      <div className="space-y-1">
        <h3 className="text-lg font-semibold text-white">AI</h3>
        <p className="text-sm text-gray-400">
          Configure AI providers for chat and embeddings. Only one provider can be active at a time.
        </p>
      </div>

      {/* Banners */}
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

      {/* Re-embed warning */}
      {config.activeProvider && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <p className="text-sm text-amber-400">
            <span className="font-medium">Active provider:</span>{' '}
            {PROVIDER_META[config.activeProvider].label}.
            Switching providers will require re-embedding all documents.
          </p>
        </div>
      )}

      {/* Provider cards */}
      <div className="space-y-3">
        {PROVIDER_KEYS.map((key) => (
          <ProviderCard
            key={key}
            providerKey={key}
            config={config.providers[key]}
            isActive={config.activeProvider === key}
            onToggleActive={() => {
              if (config.activeProvider === key) {
                handleDeactivate();
              } else {
                handleActivate(key);
              }
            }}
            onChange={(field, value) => handleProviderChange(key, field, value)}
          />
        ))}
      </div>

      {/* System Prompt */}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-gray-300">System Prompt</label>
        <textarea
          value={config.systemPrompt}
          onChange={(e) => setConfig((prev) => ({ ...prev, systemPrompt: e.target.value }))}
          placeholder="Optional — provide a default system instruction for the AI assistant"
          rows={4}
          className="w-full rounded-lg border border-white/20 bg-black/30 px-4 py-2.5 text-sm text-white placeholder-gray-500 transition-colors focus:border-white/30 focus:outline-none focus:ring-2 focus:ring-white/20 resize-y"
        />
        <p className="text-xs text-gray-500">
          A global instruction sent to the AI model at the start of every chat and title generation.
          Leave empty for default behavior.
        </p>
      </div>

      {/* Title Prompt */}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-gray-300">Title Generation Prompt</label>
        <textarea
          value={config.titlePrompt}
          onChange={(e) => setConfig((prev) => ({ ...prev, titlePrompt: e.target.value }))}
          placeholder="Instruction for auto-generating conversation titles"
          rows={4}
          className="w-full rounded-lg border border-white/20 bg-black/30 px-4 py-2.5 text-sm text-white placeholder-gray-500 transition-colors focus:border-white/30 focus:outline-none focus:ring-2 focus:ring-white/20 resize-y"
        />
        <p className="text-xs text-gray-500">
          Controls how the AI generates conversation titles. The default produces an emoji + short name.
        </p>
      </div>

      {/* Save AI config */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-white/10 px-5 py-2.5 text-sm font-medium text-white hover:bg-white/20 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving...' : 'Save Configuration'}
        </button>
      </div>

      {/* Divider */}
      <div className="border-t border-white/10" />

      {/* Embedding settings section */}
      <EmbeddingSettings onSave={async () => { /* saved independently */ }} />
    </div>
  );
}

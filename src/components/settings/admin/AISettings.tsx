import { useState, useEffect } from 'react';
import { pb } from '../../../lib/pocketbase';
import type { RecordModel } from '../../../lib/record-model';
import type { AIConfig, AIProviderKey, AIProviderConfig } from '../../../lib/ai/types';
import { DEFAULT_AI_CONFIG, PROVIDER_META } from '../../../lib/ai/types';
import { ProviderCard } from './ai/ProviderCard';
import { createLogger } from '../../../lib/logger';
import { Button, Card, Field, SectionHeading, Spinner, Textarea } from '../../ui';

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

  const handleProviderChange = (provider: AIProviderKey, field: keyof AIProviderConfig, value: string | number | boolean | null) => {
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
          description: 'AI provider configuration (models, API keys, prompts)',
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
      <div className="flex items-center justify-center py-10">
        <Spinner label="Loading AI configuration" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="p-5 sm:p-6">
        <SectionHeading
          eyebrow="Model access"
          title="AI configuration"
          description="Configure AI providers for chat. Only one provider can be active at a time."
          actions={
            <Button variant="primary" loading={saving} onClick={handleSave}>
              Save configuration
            </Button>
          }
        />

        {error && (
          <p className="mt-4 text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        {successMessage && (
          <p className="mt-4 text-sm text-success" role="status">
            {successMessage}
          </p>
        )}

        <div className="mt-5 space-y-3">
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

        {config.activeProvider && (
          <p className="mt-4 text-xs leading-relaxed text-ink-muted">
            <span className="font-medium text-warning">Active provider:</span>{' '}
            {PROVIDER_META[config.activeProvider].label}.
          </p>
        )}

        <div className="mt-6 space-y-5 border-t border-line pt-5">
          <div>
            <h3 className="text-sm font-medium text-ink">Prompts</h3>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">
              Instructions sent with every conversation and when Nana generates a title.
            </p>
          </div>

          <Field
            label="System Prompt"
            htmlFor="ai-system-prompt"
            hint="A global instruction sent to the AI model at the start of every chat and title generation. Leave empty for default behavior."
          >
            <Textarea
              id="ai-system-prompt"
              value={config.systemPrompt}
              onChange={(e) => setConfig((prev) => ({ ...prev, systemPrompt: e.target.value }))}
              placeholder="Optional — provide a default system instruction for the AI assistant"
              rows={4}
            />
          </Field>

          <Field
            label="Title Generation Prompt"
            htmlFor="ai-title-prompt"
            hint="Controls how the AI generates conversation titles. The default produces an emoji + short name."
          >
            <Textarea
              id="ai-title-prompt"
              value={config.titlePrompt}
              onChange={(e) => setConfig((prev) => ({ ...prev, titlePrompt: e.target.value }))}
              placeholder="Instruction for auto-generating conversation titles"
              rows={4}
            />
          </Field>
        </div>
      </Card>
    </div>
  );
}

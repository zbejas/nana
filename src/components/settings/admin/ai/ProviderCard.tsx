import { useState } from 'react';
import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline';
import type { AIProviderKey, AIProviderConfig } from '../../../../lib/ai/types';
import { PROVIDER_META } from '../../../../lib/ai/types';
import { Badge, cn, Field, IconButton, Input, Switch } from '../../../ui';

interface ProviderCardProps {
  providerKey: AIProviderKey;
  config: AIProviderConfig;
  isActive: boolean;
  onToggleActive: () => void;
  onChange: (field: keyof AIProviderConfig, value: string | number | boolean | null) => void;
}

export function ProviderCard({
  providerKey,
  config,
  isActive,
  onToggleActive,
  onChange,
}: ProviderCardProps) {
  const [expanded, setExpanded] = useState(isActive);
  const meta = PROVIDER_META[providerKey];

  return (
    <div
      className={cn(
        'overflow-hidden rounded-panel border bg-surface-sunken/40 transition-colors',
        isActive ? 'border-signal/35' : 'border-line'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center text-left"
        >
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-ink">{meta.label}</span>
              {isActive && (
                <Badge tone="signal" dot>
                  Active
                </Badge>
              )}
            </span>
            <span className="text-xs leading-relaxed text-ink-muted">{meta.description}</span>
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-2">
          {/* Active toggle */}
          <button
            type="button"
            role="switch"
            aria-checked={isActive}
            aria-label={`${isActive ? 'Deactivate' : 'Activate'} ${meta.label}`}
            onClick={onToggleActive}
            className={cn(
              'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal',
              isActive ? 'border-signal/50 bg-signal' : 'border-line-strong bg-surface-sunken'
            )}
          >
            <span
              className={cn(
                'h-4 w-4 rounded-full transition-transform duration-150',
                isActive ? 'translate-x-[1.45rem] bg-on-signal' : 'translate-x-[0.2rem] bg-ink-muted'
              )}
              aria-hidden="true"
            />
          </button>

          <IconButton
            label={expanded ? `Collapse ${meta.label}` : `Expand ${meta.label}`}
            variant="ghost"
            size="sm"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            {expanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
          </IconButton>
        </div>
      </div>

      {/* Body */}
      {expanded && (
        <div className="space-y-4 border-t border-line px-4 py-4 sm:px-5 sm:py-5">
          <Field
            label="API Key"
            htmlFor={`${providerKey}-api-key`}
            optional={providerKey === 'ollama'}
            hint={
              providerKey === 'ollama'
                ? 'Only needed for remote/authenticated Ollama instances. Local usage works without a key.'
                : undefined
            }
          >
            <Input
              id={`${providerKey}-api-key`}
              type="password"
              value={config.apiKey}
              onChange={(e) => onChange('apiKey', e.target.value)}
              placeholder={
                providerKey === 'ollama'
                  ? 'Optional — leave empty for local access'
                  : `Enter ${meta.label} API key`
              }
            />
          </Field>

          <Field
            label="Base URL"
            htmlFor={`${providerKey}-base-url`}
            hint={
              providerKey === 'ollama'
                ? 'Ollama server address. Default: http://localhost:11434'
                : 'Override the default API endpoint. Leave empty to use the official endpoint.'
            }
          >
            <Input
              id={`${providerKey}-base-url`}
              type="text"
              value={config.baseUrl}
              onChange={(e) => onChange('baseUrl', e.target.value)}
              placeholder={meta.defaultBaseUrl || 'Default (leave empty for official endpoint)'}
            />
          </Field>

          <Field
            label="Chat Model"
            htmlFor={`${providerKey}-chat-model`}
            hint="The model identifier used for chat completions."
          >
            <Input
              id={`${providerKey}-chat-model`}
              type="text"
              value={config.activeModel}
              onChange={(e) => onChange('activeModel', e.target.value)}
              placeholder={
                providerKey === 'openai'
                  ? 'e.g. gpt-4o'
                  : providerKey === 'google'
                    ? 'e.g. gemini-2.0-flash'
                    : 'e.g. llama3'
              }
            />
          </Field>

          {/* Generation Parameters */}
          <div className="space-y-4 border-t border-line pt-4">
            <h3 className="text-sm font-medium text-ink">Generation Parameters</h3>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field
                label="Temperature"
                htmlFor={`${providerKey}-temperature`}
                hint="Controls randomness (0–2). Lower = more focused."
              >
                <Input
                  id={`${providerKey}-temperature`}
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  value={config.temperature ?? ''}
                  onChange={(e) =>
                    onChange('temperature', e.target.value === '' ? null : parseFloat(e.target.value))
                  }
                  placeholder="Default"
                />
              </Field>

              <Field
                label="Max Tokens"
                htmlFor={`${providerKey}-max-tokens`}
                hint="Maximum number of tokens to generate."
              >
                <Input
                  id={`${providerKey}-max-tokens`}
                  type="number"
                  step="1"
                  min="1"
                  value={config.maxTokens ?? ''}
                  onChange={(e) =>
                    onChange('maxTokens', e.target.value === '' ? null : parseInt(e.target.value, 10))
                  }
                  placeholder="Default"
                />
              </Field>

              <Field
                label="Top P"
                htmlFor={`${providerKey}-top-p`}
                hint="Nucleus sampling threshold (0–1)."
              >
                <Input
                  id={`${providerKey}-top-p`}
                  type="number"
                  step="0.05"
                  min="0"
                  max="1"
                  value={config.topP ?? ''}
                  onChange={(e) =>
                    onChange('topP', e.target.value === '' ? null : parseFloat(e.target.value))
                  }
                  placeholder="Default"
                />
              </Field>
            </div>

            {providerKey === 'ollama' && (
              <Switch
                id={`${providerKey}-thinking`}
                checked={config.thinking}
                onChange={(checked) => onChange('thinking', checked)}
                label="Thinking"
                description="Enable chain-of-thought reasoning for supported models (e.g. Gemma 4, DeepSeek R1)."
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

import { useState } from 'react';
import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline';
import type { AIProviderKey, AIProviderConfig } from '../../../../lib/ai/types';
import { PROVIDER_META } from '../../../../lib/ai/types';

interface ProviderCardProps {
  providerKey: AIProviderKey;
  config: AIProviderConfig;
  isActive: boolean;
  onToggleActive: () => void;
  onChange: (field: keyof AIProviderConfig, value: string | number | null) => void;
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

  const inputClass =
    'w-full rounded-lg border border-white/20 bg-black/30 px-4 py-2.5 text-sm text-white placeholder-gray-500 transition-colors focus:border-white/30 focus:outline-none focus:ring-2 focus:ring-white/20';

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
      {/* Header */}
      <div className="flex w-full items-center justify-between px-5 py-4">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex flex-1 items-center gap-3 text-left hover:opacity-80 transition-opacity"
        >
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-white">{meta.label}</span>
            <span className="text-xs text-gray-400">{meta.description}</span>
          </div>
        </button>
        <div className="flex items-center gap-3">
          {/* Active toggle */}
          <button
            type="button"
            onClick={onToggleActive}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-white/20 ${
              isActive ? 'bg-green-500' : 'bg-white/20'
            }`}
            role="switch"
            aria-checked={isActive}
            aria-label={`${isActive ? 'Deactivate' : 'Activate'} ${meta.label}`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition duration-200 ease-in-out ${
                isActive ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="p-0.5 hover:opacity-80 transition-opacity"
          >
            {expanded ? (
              <ChevronUpIcon className="h-4 w-4 text-gray-400" />
            ) : (
              <ChevronDownIcon className="h-4 w-4 text-gray-400" />
            )}
          </button>
        </div>
      </div>

      {/* Body */}
      {expanded && (
        <div className="border-t border-white/10 px-5 py-4 space-y-4">
          {/* API Key */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-300">API Key</label>
            <input
              type="password"
              value={config.apiKey}
              onChange={(e) => onChange('apiKey', e.target.value)}
              placeholder={
                providerKey === 'ollama'
                  ? 'Optional — leave empty for local access'
                  : `Enter ${meta.label} API key`
              }
              className={inputClass}
            />
            {providerKey === 'ollama' && (
              <p className="text-xs text-gray-500">
                Only needed for remote/authenticated Ollama instances. Local usage works without a key.
              </p>
            )}
          </div>

          {/* Base URL */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-300">Base URL</label>
            <input
              type="text"
              value={config.baseUrl}
              onChange={(e) => onChange('baseUrl', e.target.value)}
              placeholder={meta.defaultBaseUrl || 'Default (leave empty for official endpoint)'}
              className={inputClass}
            />
            <p className="text-xs text-gray-500">
              {providerKey === 'ollama'
                ? 'Ollama server address. Default: http://localhost:11434'
                : 'Override the default API endpoint. Leave empty to use the official endpoint.'}
            </p>
          </div>

          {/* Active Model */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-300">Chat Model</label>
            <input
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
              className={inputClass}
            />
            <p className="text-xs text-gray-500">
              The model identifier used for chat completions.
            </p>
          </div>

          {/* Embedding Model */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-300">Embedding Model</label>
            <input
              type="text"
              value={config.embeddingModel}
              onChange={(e) => onChange('embeddingModel', e.target.value)}
              placeholder={
                providerKey === 'openai'
                  ? 'e.g. text-embedding-3-small'
                  : providerKey === 'google'
                    ? 'e.g. text-embedding-004'
                    : 'e.g. nomic-embed-text'
              }
              className={inputClass}
            />
            <p className="text-xs text-gray-500">
              The model identifier used for generating embeddings.
            </p>
          </div>

          {/* Generation Parameters */}
          <div className="border-t border-white/10 pt-4 space-y-4">
            <h4 className="text-sm font-medium text-gray-300">Generation Parameters</h4>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Temperature */}
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-300">Temperature</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  value={config.temperature ?? ''}
                  onChange={(e) =>
                    onChange('temperature', e.target.value === '' ? null : parseFloat(e.target.value))
                  }
                  placeholder="Default"
                  className={inputClass}
                />
                <p className="text-xs text-gray-500">
                  Controls randomness (0–2). Lower = more focused.
                </p>
              </div>

              {/* Max Tokens */}
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-300">Max Tokens</label>
                <input
                  type="number"
                  step="1"
                  min="1"
                  value={config.maxTokens ?? ''}
                  onChange={(e) =>
                    onChange('maxTokens', e.target.value === '' ? null : parseInt(e.target.value, 10))
                  }
                  placeholder="Default"
                  className={inputClass}
                />
                <p className="text-xs text-gray-500">
                  Maximum number of tokens to generate.
                </p>
              </div>

              {/* Top P */}
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-300">Top P</label>
                <input
                  type="number"
                  step="0.05"
                  min="0"
                  max="1"
                  value={config.topP ?? ''}
                  onChange={(e) =>
                    onChange('topP', e.target.value === '' ? null : parseFloat(e.target.value))
                  }
                  placeholder="Default"
                  className={inputClass}
                />
                <p className="text-xs text-gray-500">
                  Nucleus sampling threshold (0–1).
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

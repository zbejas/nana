import { useEffect, useState } from 'react';
import { SidePanel, Button, Field, Input, Select, Switch } from '../../../ui';
import type { AIProviderConnection, AIProviderKind } from '../../../../lib/ai/types';

const KIND_OPTIONS: Array<{ value: AIProviderKind; label: string; hint: string; baseUrl: string }> = [
  {
    value: 'openai',
    label: 'OpenAI-compatible',
    hint: 'OpenAI, a gateway, or another Chat Completions host.',
    baseUrl: 'https://api.openai.com/v1',
  },
  {
    value: 'google',
    label: 'Google Gemini',
    hint: 'Gemini through Google AI Studio or a compatible endpoint.',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  },
  {
    value: 'anthropic',
    label: 'Anthropic',
    hint: 'Claude through the Anthropic Messages API or a proxy.',
    baseUrl: 'https://api.anthropic.com/v1',
  },
  {
    value: 'ollama',
    label: 'Ollama',
    hint: 'A local or remote Ollama server.',
    baseUrl: 'http://localhost:11434',
  },
];

function kindMeta(kind: AIProviderKind) {
  return KIND_OPTIONS.find((option) => option.value === kind) ?? KIND_OPTIONS[0]!;
}

function newConnection(): AIProviderConnection {
  return {
    id: crypto.randomUUID(),
    name: '',
    kind: 'openai',
    baseUrl: '',
    apiKey: '',
    enabled: true,
    catalogProviderId: null,
  };
}

interface ConnectionPanelProps {
  open: boolean;
  connection: AIProviderConnection | null;
  onClose: () => void;
  onSave: (connection: AIProviderConnection) => void;
}

/** Add/edit one endpoint. The connection is a draft until the page is saved. */
export function ConnectionPanel({ open, connection, onClose, onSave }: ConnectionPanelProps) {
  const [draft, setDraft] = useState<AIProviderConnection>(newConnection);

  useEffect(() => {
    if (open) setDraft(connection ? { ...connection } : newConnection());
  }, [open, connection]);

  const meta = kindMeta(draft.kind);
  const kindChanged = (kind: AIProviderKind) => {
    const next = kindMeta(kind);
    setDraft((current) => ({
      ...current,
      kind,
      name: current.name.trim() && current.name !== kindMeta(current.kind).label
        ? current.name
        : next.label,
    }));
  };

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title={connection ? 'Edit connection' : 'Add connection'}
      description="One endpoint and its credentials. Add as many as you need; each can expose several models."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => onSave({
              ...draft,
              name: draft.name.trim() || meta.label,
              baseUrl: draft.baseUrl.trim(),
              apiKey: draft.apiKey.trim(),
              catalogProviderId: draft.catalogProviderId?.trim() || null,
            })}
          >
            Save connection
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Provider type" htmlFor="ai-connection-kind" hint={meta.hint}>
          <Select
            id="ai-connection-kind"
            value={draft.kind}
            onChange={(event) => kindChanged(event.target.value as AIProviderKind)}
          >
            {KIND_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Connection name"
          htmlFor="ai-connection-name"
          hint="Shown in the chat model picker. Use a name that distinguishes this host."
        >
          <Input
            id="ai-connection-name"
            value={draft.name}
            onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
            placeholder={meta.label}
          />
        </Field>

        <Field
          label="Base URL"
          htmlFor="ai-connection-base-url"
          optional
          hint={`Leave empty for ${meta.label}'s default. Chat Completions hosts usually need /v1.`}
        >
          <Input
            id="ai-connection-base-url"
            value={draft.baseUrl}
            onChange={(event) => setDraft((current) => ({ ...current, baseUrl: event.target.value }))}
            placeholder={meta.baseUrl}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>

        <Field
          label="API key"
          htmlFor="ai-connection-api-key"
          optional={draft.kind === 'ollama'}
          hint={draft.kind === 'ollama'
            ? 'Only needed for a remote or authenticated Ollama host.'
            : 'Stored in the admin-only settings record and never returned in chat status.'}
        >
          <Input
            id="ai-connection-api-key"
            type="password"
            value={draft.apiKey}
            onChange={(event) => setDraft((current) => ({ ...current, apiKey: event.target.value }))}
            placeholder={draft.kind === 'ollama' ? 'Optional' : 'Paste the key'}
            autoComplete="new-password"
          />
        </Field>

        <Field
          label="models.dev provider id"
          htmlFor="ai-connection-catalog-id"
          optional
          hint="Optional. Used to narrow catalog searches, for example openai, google, anthropic, openrouter, or ollama-cloud."
        >
          <Input
            id="ai-connection-catalog-id"
            value={draft.catalogProviderId ?? ''}
            onChange={(event) =>
              setDraft((current) => ({ ...current, catalogProviderId: event.target.value }))
            }
            placeholder="e.g. openai"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>

        <div className="rounded-panel border border-line bg-surface-sunken/50 p-4">
          <Switch
            id="ai-connection-enabled"
            checked={draft.enabled}
            onChange={(enabled) => setDraft((current) => ({ ...current, enabled }))}
            label="Connection enabled"
            description="Disabled connections and their models disappear from the chat picker."
          />
        </div>
      </div>
    </SidePanel>
  );
}

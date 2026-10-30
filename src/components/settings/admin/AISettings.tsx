import { useEffect, useState } from 'react';
import { PencilSquareIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { pb } from '../../../lib/pocketbase';
import type { RecordModel } from '../../../lib/record-model';
import {
  DEFAULT_AI_ATTACHMENT_SETTINGS,
  DEFAULT_AI_CONFIG,
  type AIChatAttachmentSettings,
  type AIConfig,
  type AIModelConfig,
  type AIProviderConnection,
  type AIProviderKind,
} from '../../../lib/ai/types';
import { normalizeAIConfig } from '../../../lib/ai/config';
import { ConnectionPanel } from './ai/ConnectionPanel';
import { ModelPanel } from './ai/ModelPanel';
import { createLogger } from '../../../lib/logger';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Field,
  IconButton,
  Input,
  SectionHeading,
  Spinner,
  Switch,
  Textarea,
} from '../../ui';

const log = createLogger('AISettings');

interface SettingRecord extends RecordModel {
  key: string;
  value: any;
  description: string;
}

const KIND_LABELS: Record<AIProviderKind, string> = {
  openai: 'OpenAI-compatible',
  google: 'Gemini',
  anthropic: 'Anthropic',
  ollama: 'Ollama',
};

function blankConfig(): AIConfig {
  return {
    ...structuredClone(DEFAULT_AI_CONFIG),
    version: 2,
    connections: [],
    models: [],
    defaultModelId: null,
    attachments: { ...DEFAULT_AI_ATTACHMENT_SETTINGS },
  };
}

function usableModel(
  model: AIModelConfig,
  connections: AIProviderConnection[],
): boolean {
  return model.enabled && Boolean(connections.find((connection) => connection.id === model.connectionId)?.enabled);
}

function nextDefaultId(
  models: AIModelConfig[],
  connections: AIProviderConnection[],
  preferred?: string | null,
): string | null {
  if (preferred && models.some((model) => model.id === preferred && usableModel(model, connections))) {
    return preferred;
  }
  return models.find((model) => usableModel(model, connections))?.id ?? null;
}

function withDefault(config: AIConfig): AIConfig {
  const connections = config.connections ?? [];
  const models = config.models ?? [];
  return {
    ...config,
    defaultModelId: nextDefaultId(models, connections, config.defaultModelId),
  };
}

function parseConfigValue(value: unknown): AIConfig {
  const normalized = normalizeAIConfig(value);
  const raw = value as Record<string, unknown> | null;
  // A legacy config synthesizes three provider slots. Hide the empty ones so
  // the new connection editor starts from what was actually configured.
  if (!Array.isArray(raw?.connections)) {
    normalized.connections = (normalized.connections ?? []).filter((connection) => {
      const hasModel = (normalized.models ?? []).some((model) => model.connectionId === connection.id);
      const legacy = connection.kind === 'anthropic'
        ? undefined
        : normalized.providers[connection.kind as keyof typeof normalized.providers];
      return hasModel || Boolean(legacy?.apiKey || legacy?.baseUrl);
    });
  }
  return withDefault(normalized);
}

export function AISettings() {
  const [record, setRecord] = useState<SettingRecord | null>(null);
  const [config, setConfig] = useState<AIConfig>(() => blankConfig());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [connectionPanel, setConnectionPanel] = useState<{
    connection: AIProviderConnection | null;
  } | null>(null);
  const [modelPanel, setModelPanel] = useState<{
    connectionId: string;
    model: AIModelConfig | null;
  } | null>(null);
  const [pendingRemoveConnection, setPendingRemoveConnection] = useState<AIProviderConnection | null>(null);

  useEffect(() => {
    void loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      setLoading(true);
      setError(null);
      const rec = await pb.collection('settings').getFirstListItem('key="ai_config"') as SettingRecord;
      setRecord(rec);
      setConfig(parseConfigValue(rec.value));
    } catch (err: any) {
      // A fresh workspace has no ai_config row yet; that is not an error.
      if (err?.status === 404) {
        setConfig(blankConfig());
      } else {
        log.error('Failed to load AI config', err);
        setError(err.message || 'Failed to load AI configuration');
      }
    } finally {
      setLoading(false);
    }
  };

  const connections = config.connections ?? [];
  const models = config.models ?? [];
  const attachments = config.attachments ?? DEFAULT_AI_ATTACHMENT_SETTINGS;

  const selectedConnection = connectionPanel?.connection ?? null;
  const panelModel = modelPanel
    ? models.find((model) => model.id === modelPanel.model?.id) ?? modelPanel.model
    : null;
  const panelConnection = modelPanel
    ? connections.find((connection) => connection.id === modelPanel.connectionId) ?? null
    : null;

  const updateConnections = (next: AIProviderConnection[]) => {
    setConfig((current) => withDefault({
      ...current,
      connections: next,
      models: current.models ?? [],
    }));
  };

  const handleConnectionSave = (connection: AIProviderConnection) => {
    setConfig((current) => {
      const currentConnections = current.connections ?? [];
      const exists = currentConnections.some((entry) => entry.id === connection.id);
      const nextConnections = exists
        ? currentConnections.map((entry) => entry.id === connection.id ? connection : entry)
        : [...currentConnections, connection];
      return withDefault({
        ...current,
        connections: nextConnections,
        models: current.models ?? [],
      });
    });
    setConnectionPanel(null);
  };

  const removeConnection = (connection: AIProviderConnection) => {
    setConfig((current) => {
      const nextConnections = (current.connections ?? []).filter((entry) => entry.id !== connection.id);
      const nextModels = (current.models ?? []).filter((model) => model.connectionId !== connection.id);
      return withDefault({
        ...current,
        connections: nextConnections,
        models: nextModels,
        defaultModelId: current.defaultModelId === null
          ? null
          : nextDefaultId(nextModels, nextConnections, current.defaultModelId),
      });
    });
    setPendingRemoveConnection(null);
    setModelPanel(null);
  };

  const toggleConnection = (connectionId: string, enabled: boolean) => {
    setConfig((current) => {
      const nextConnections = (current.connections ?? []).map((entry) =>
        entry.id === connectionId ? { ...entry, enabled } : entry
      );
      return withDefault({
        ...current,
        connections: nextConnections,
        models: current.models ?? [],
      });
    });
  };

  const handleModelSave = (model: AIModelConfig, makeDefault: boolean) => {
    if (!modelPanel) return;
    const oldId = modelPanel.model?.id ?? null;
    const nextId = `${model.connectionId}:${model.modelId}`;
    setConfig((current) => {
      const currentModels = current.models ?? [];
      const nextModels = currentModels
        .filter((entry) => entry.id !== oldId && entry.id !== nextId)
        .concat({ ...model, id: nextId });
      const nextConnections = current.connections ?? [];
      return withDefault({
        ...current,
        models: nextModels,
        defaultModelId: makeDefault
          ? nextId
          : nextDefaultId(nextModels, nextConnections, current.defaultModelId === oldId ? nextId : current.defaultModelId),
      });
    });
    setModelPanel(null);
  };

  const removeModel = (model: AIModelConfig) => {
    setConfig((current) => {
      const nextModels = (current.models ?? []).filter((entry) => entry.id !== model.id);
      const nextConnections = current.connections ?? [];
      return withDefault({
        ...current,
        models: nextModels,
        defaultModelId: nextDefaultId(nextModels, nextConnections, current.defaultModelId === model.id ? null : current.defaultModelId),
      });
    });
    if (modelPanel?.model?.id === model.id) setModelPanel(null);
  };

  const toggleModel = (model: AIModelConfig, enabled: boolean) => {
    setConfig((current) => {
      const nextModels = (current.models ?? []).map((entry) =>
        entry.id === model.id ? { ...entry, enabled } : entry
      );
      const nextConnections = current.connections ?? [];
      return withDefault({
        ...current,
        models: nextModels,
        defaultModelId: enabled
          ? current.defaultModelId
          : nextDefaultId(nextModels, nextConnections, current.defaultModelId === model.id ? null : current.defaultModelId),
      });
    });
  };

  const setDefaultModel = (model: AIModelConfig) => {
    if (!usableModel(model, connections)) return;
    setConfig((current) => ({ ...current, defaultModelId: model.id }));
  };

  const updateAttachments = (patch: Partial<AIChatAttachmentSettings>) => {
    setConfig((current) => ({
      ...current,
      attachments: { ...(current.attachments ?? DEFAULT_AI_ATTACHMENT_SETTINGS), ...patch },
    }));
  };

  const updateAttachmentMb = (key: 'maxFileBytes' | 'maxTotalBytes', value: string) => {
    const mb = Number(value);
    if (!Number.isFinite(mb) || mb <= 0) return;
    updateAttachments({ [key]: Math.round(mb * 1024 * 1024) });
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccessMessage(null);
      const value = withDefault(normalizeAIConfig(config));

      if (record) {
        await pb.collection('settings').update(record.id, { value });
      } else {
        const newRecord = await pb.collection('settings').create<SettingRecord>({
          key: 'ai_config',
          value,
          description: 'AI connections, models, prompts, and chat attachment limits',
        });
        setRecord(newRecord);
      }

      setConfig(value);
      setSuccessMessage('AI configuration saved');
      window.setTimeout(() => setSuccessMessage(null), 3000);
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
          title="AI connections and models"
          description="Connect any number of OpenAI-compatible, Gemini, Anthropic, or Ollama hosts. Choose which models appear in chat and which one starts a new conversation."
          actions={
            <Button variant="primary" loading={saving} onClick={() => void handleSave()}>
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

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            icon={<PlusIcon />}
            onClick={() => setConnectionPanel({ connection: null })}
          >
            Add connection
          </Button>
          {connections.length === 0 && (
            <p className="text-xs text-ink-muted">No endpoints configured yet.</p>
          )}
        </div>

        <div className="mt-4 space-y-3">
          {connections.map((connection) => (
            <ConnectionCard
              key={connection.id}
              connection={connection}
              models={models.filter((model) => model.connectionId === connection.id)}
              defaultModelId={config.defaultModelId ?? null}
              onEdit={() => setConnectionPanel({ connection })}
              onRemove={() => setPendingRemoveConnection(connection)}
              onToggle={(enabled) => toggleConnection(connection.id, enabled)}
              onAddModel={() => setModelPanel({ connectionId: connection.id, model: null })}
              onEditModel={(model) => setModelPanel({ connectionId: connection.id, model })}
              onRemoveModel={removeModel}
              onToggleModel={toggleModel}
              onSetDefault={setDefaultModel}
            />
          ))}
        </div>

        {connections.length === 0 && (
          <div className="mt-4 rounded-panel border border-dashed border-line bg-surface-sunken/40 p-5 text-sm leading-relaxed text-ink-muted">
            Add a connection to get started. The model id is the exact name the endpoint expects;
            the models.dev search can fill in limits and capabilities.
          </div>
        )}

        <div className="mt-6 space-y-5 border-t border-line pt-5">
          <div>
            <h3 className="text-sm font-medium text-ink">Chat attachments</h3>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">
              Images, PDFs, and text files are uploaded as separate records and referenced by chat
              messages. Per-model capability switches decide what each model accepts.
            </p>
          </div>

          <div className="rounded-panel border border-line bg-surface-sunken/50 p-4">
            <Switch
              id="ai-attachments-enabled"
              checked={attachments.enabled}
              onChange={(enabled) => updateAttachments({ enabled })}
              label="Allow attachments"
              description="Turn this off to hide the attachment control for everyone in chat."
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Files per message" htmlFor="ai-attachments-files" hint="1–20.">
              <Input
                id="ai-attachments-files"
                type="number"
                min="1"
                max="20"
                step="1"
                value={attachments.maxFiles}
                onChange={(event) =>
                  updateAttachments({ maxFiles: Math.max(1, Math.round(Number(event.target.value) || 1)) })
                }
              />
            </Field>
            <Field label="Max file size (MB)" htmlFor="ai-attachments-file-size" hint="Per file.">
              <Input
                id="ai-attachments-file-size"
                type="number"
                min="1"
                max="50"
                step="1"
                value={Math.round(attachments.maxFileBytes / (1024 * 1024))}
                onChange={(event) => updateAttachmentMb('maxFileBytes', event.target.value)}
              />
            </Field>
            <Field label="Max total (MB)" htmlFor="ai-attachments-total" hint="Per message.">
              <Input
                id="ai-attachments-total"
                type="number"
                min="1"
                max="100"
                step="1"
                value={Math.round(attachments.maxTotalBytes / (1024 * 1024))}
                onChange={(event) => updateAttachmentMb('maxTotalBytes', event.target.value)}
              />
            </Field>
            <Field label="Max text chars" htmlFor="ai-attachments-text" hint="Extracted text cap.">
              <Input
                id="ai-attachments-text"
                type="number"
                min="1000"
                max="1000000"
                step="1000"
                value={attachments.maxTextChars}
                onChange={(event) =>
                  updateAttachments({ maxTextChars: Math.max(1000, Math.round(Number(event.target.value) || 1000)) })
                }
              />
            </Field>
          </div>
        </div>

        <div className="mt-6 space-y-5 border-t border-line pt-5">
          <div>
            <h3 className="text-sm font-medium text-ink">Prompts</h3>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">
              Instructions sent with every conversation and when Nana generates a title.
            </p>
          </div>

          <Field
            label="System prompt"
            htmlFor="ai-system-prompt"
            hint="A global instruction sent to the AI model at the start of every chat and title generation. Leave empty for default behavior."
          >
            <Textarea
              id="ai-system-prompt"
              value={config.systemPrompt}
              onChange={(event) => setConfig((current) => ({ ...current, systemPrompt: event.target.value }))}
              placeholder="Optional — provide a default system instruction for the AI assistant"
              rows={4}
            />
          </Field>

          <Field
            label="Title generation prompt"
            htmlFor="ai-title-prompt"
            hint="Controls how the AI generates conversation titles. The default produces a plain, short name without emoji."
          >
            <Textarea
              id="ai-title-prompt"
              value={config.titlePrompt}
              onChange={(event) => setConfig((current) => ({ ...current, titlePrompt: event.target.value }))}
              placeholder="Instruction for auto-generating conversation titles"
              rows={4}
            />
          </Field>
        </div>
      </Card>

      <ConnectionPanel
        open={connectionPanel !== null}
        connection={selectedConnection}
        onClose={() => setConnectionPanel(null)}
        onSave={handleConnectionSave}
      />

      <ModelPanel
        open={modelPanel !== null}
        connection={panelConnection}
        model={panelModel}
        isDefault={Boolean(panelModel && panelModel.id === config.defaultModelId)}
        onClose={() => setModelPanel(null)}
        onSave={handleModelSave}
      />

      <ConfirmDialog
        open={pendingRemoveConnection !== null}
        title={pendingRemoveConnection ? `Remove ${pendingRemoveConnection.name}?` : 'Remove connection?'}
        description="The connection and its models are removed from this draft. Save the configuration to apply it."
        confirmLabel="Remove connection"
        tone="danger"
        onConfirm={() => {
          if (pendingRemoveConnection) removeConnection(pendingRemoveConnection);
        }}
        onCancel={() => setPendingRemoveConnection(null)}
      />
    </div>
  );
}

interface ConnectionCardProps {
  connection: AIProviderConnection;
  models: AIModelConfig[];
  defaultModelId: string | null;
  onEdit: () => void;
  onRemove: () => void;
  onToggle: (enabled: boolean) => void;
  onAddModel: () => void;
  onEditModel: (model: AIModelConfig) => void;
  onRemoveModel: (model: AIModelConfig) => void;
  onToggleModel: (model: AIModelConfig, enabled: boolean) => void;
  onSetDefault: (model: AIModelConfig) => void;
}

function ConnectionCard({
  connection,
  models,
  defaultModelId,
  onEdit,
  onRemove,
  onToggle,
  onAddModel,
  onEditModel,
  onRemoveModel,
  onToggleModel,
  onSetDefault,
}: ConnectionCardProps) {
  return (
    <div className="overflow-hidden rounded-panel border border-line bg-surface-sunken/40">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3.5 sm:px-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium text-ink">{connection.name}</h3>
            <Badge tone="neutral">{KIND_LABELS[connection.kind]}</Badge>
            {connection.enabled ? (
              <Badge tone="success" dot>Enabled</Badge>
            ) : (
              <Badge tone="warning">Disabled</Badge>
            )}
          </div>
          <p className="mt-1 truncate text-xs text-ink-muted">
            {connection.baseUrl || 'Provider default endpoint'}
            {connection.catalogProviderId ? ` · ${connection.catalogProviderId}` : ''}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Switch
            id={`ai-connection-enabled-${connection.id}`}
            checked={connection.enabled}
            onChange={onToggle}
            label="Enabled"
            className="w-auto"
          />
          <IconButton label={`Edit ${connection.name}`} variant="ghost" size="sm" onClick={onEdit}>
            <PencilSquareIcon />
          </IconButton>
          <IconButton label={`Remove ${connection.name}`} variant="ghost" size="sm" onClick={onRemove}>
            <TrashIcon />
          </IconButton>
        </div>
      </div>

      <div className="space-y-3 px-4 py-4 sm:px-5">
        {models.length === 0 ? (
          <p className="text-xs text-ink-muted">No models on this connection yet.</p>
        ) : (
          <div className="space-y-2">
            {models.map((model) => {
              const isDefault = model.id === defaultModelId;
              const caps = model.capabilities;
              return (
                <div
                  key={model.id}
                  className="flex flex-wrap items-center gap-2 rounded-control border border-line bg-surface px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-[12.5px] font-medium text-ink">{model.label}</span>
                      <span className="truncate font-mono text-[10.5px] text-ink-muted">{model.modelId}</span>
                      {isDefault && <Badge tone="signal">Default</Badge>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {model.contextWindow && (
                        <Badge tone="neutral">{Math.round(model.contextWindow / 1000)}k ctx</Badge>
                      )}
                      {caps.vision && <Badge tone="signal">Vision</Badge>}
                      {caps.files && <Badge tone="neutral">PDF</Badge>}
                      {caps.tools && <Badge tone="neutral">Tools</Badge>}
                      {caps.reasoning && <Badge tone="neutral">Reasoning</Badge>}
                      {!caps.vision && !caps.files && !caps.tools && !caps.reasoning && (
                        <Badge tone="neutral">Text</Badge>
                      )}
                      {model.metadataSource === 'models.dev' && <Badge tone="outline">models.dev</Badge>}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <Button
                      variant={isDefault ? 'secondary' : 'ghost'}
                      size="sm"
                      disabled={!model.enabled || !connection.enabled}
                      onClick={() => onSetDefault(model)}
                    >
                      {isDefault ? 'Default' : 'Set default'}
                    </Button>
                    <Switch
                      id={`ai-model-enabled-${model.id}`}
                      checked={model.enabled}
                      onChange={(enabled) => onToggleModel(model, enabled)}
                      label="Chat"
                      className="w-auto"
                    />
                    <IconButton label={`Edit ${model.label}`} variant="ghost" size="sm" onClick={() => onEditModel(model)}>
                      <PencilSquareIcon />
                    </IconButton>
                    <IconButton label={`Remove ${model.label}`} variant="ghost" size="sm" onClick={() => onRemoveModel(model)}>
                      <TrashIcon />
                    </IconButton>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <Button variant="secondary" size="sm" icon={<PlusIcon />} onClick={onAddModel}>
          Add model
        </Button>
      </div>
    </div>
  );
}

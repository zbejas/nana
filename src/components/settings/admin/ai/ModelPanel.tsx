import { useEffect, useState } from 'react';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { pb } from '../../../../lib/pocketbase';
import type {
  AIModelCapabilities,
  AIModelConfig,
  AIProviderConnection,
} from '../../../../lib/ai/types';
import type { CatalogModel } from '../../../../lib/ai/models-dev';
import { formatTokenCount } from '../../../../lib/chat/context-usage';
import {
  Badge,
  Button,
  Checkbox,
  Field,
  Input,
  SidePanel,
  Switch,
} from '../../../ui';

function blankModel(connectionId: string): AIModelConfig {
  return {
    id: '',
    connectionId,
    modelId: '',
    label: '',
    enabled: true,
    capabilities: {
      vision: false,
      files: false,
      tools: true,
      reasoning: false,
    },
    contextWindow: null,
    maxOutputTokens: null,
    temperature: null,
    topP: null,
    thinking: false,
    metadataSource: 'manual',
  };
}

function numberOrNull(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function capabilitiesFromCatalog(model: CatalogModel): AIModelCapabilities {
  return {
    vision: model.capabilities.vision,
    files: model.capabilities.files,
    tools: model.capabilities.tools,
    reasoning: model.capabilities.reasoning,
  };
}

interface ModelPanelProps {
  open: boolean;
  connection: AIProviderConnection | null;
  model: AIModelConfig | null;
  isDefault: boolean;
  onClose: () => void;
  onSave: (model: AIModelConfig, makeDefault: boolean) => void;
}

/** Add/edit one model and its capabilities. Search fills the metadata fields. */
export function ModelPanel({
  open,
  connection,
  model,
  isDefault,
  onClose,
  onSave,
}: ModelPanelProps) {
  const [draft, setDraft] = useState<AIModelConfig>(
    () => model ?? blankModel(connection?.id ?? ''),
  );
  const [makeDefault, setMakeDefault] = useState(isDefault);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CatalogModel[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);

  useEffect(() => {
    if (!open || !connection) return;
    setDraft(model ? { ...model, capabilities: { ...model.capabilities } } : blankModel(connection.id));
    setMakeDefault(isDefault);
    setQuery('');
    setResults([]);
    setSearchError(null);
    setCatalogOpen(false);
  }, [open, connection, model, isDefault]);

  const searchCatalog = async () => {
    setSearching(true);
    setSearchError(null);
    try {
      const params = new URLSearchParams({ q: query.trim() });
      if (connection?.catalogProviderId) params.set('provider', connection.catalogProviderId);
      const data = await pb.request<{ models?: CatalogModel[] }>(
        `/admin/ai/models?${params.toString()}`,
      );
      setResults(Array.isArray(data.models) ? data.models : []);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : 'Could not load models.dev.');
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const applyCatalogModel = (result: CatalogModel) => {
    setDraft((current) => ({
      ...current,
      modelId: result.modelId,
      label: result.name,
      capabilities: capabilitiesFromCatalog(result),
      contextWindow: result.contextWindow,
      maxOutputTokens: result.maxOutputTokens,
      temperature: result.capabilities.temperature ? current.temperature : null,
      metadataSource: 'models.dev',
    }));
    setCatalogOpen(false);
  };

  const setCapability = (key: keyof AIModelCapabilities, value: boolean) => {
    setDraft((current) => ({
      ...current,
      capabilities: { ...current.capabilities, [key]: value },
    }));
  };

  if (!connection) return null;

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      width="lg"
      title={model ? 'Edit model' : 'Add model'}
      description={`Choose one model exposed by ${connection.name}. Metadata is a snapshot; every capability can be overridden.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!draft.modelId.trim()}
            onClick={() =>
              onSave(
                {
                  ...draft,
                  connectionId: connection.id,
                  modelId: draft.modelId.trim(),
                  label: draft.label.trim() || draft.modelId.trim(),
                  id: `${connection.id}:${draft.modelId.trim()}`,
                },
                makeDefault,
              )
            }
          >
            Save model
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="rounded-panel border border-line bg-surface-sunken/50">
          <button
            type="button"
            onClick={() => setCatalogOpen((openState) => !openState)}
            aria-expanded={catalogOpen}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
          >
            <span>
              <span className="block text-sm font-medium text-ink">Find metadata on models.dev</span>
              <span className="mt-0.5 block text-xs text-ink-muted">
                Fills the model id, limits, vision, PDF/file, tools, and reasoning flags.
              </span>
            </span>
            <span className="text-[11.5px] font-medium text-signal">
              {catalogOpen ? 'Hide' : 'Search'}
            </span>
          </button>

          {catalogOpen && (
            <div className="border-t border-line px-4 py-4">
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Search models" htmlFor="ai-model-catalog-search" className="min-w-[12rem] flex-1">
                  <Input
                    id="ai-model-catalog-search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void searchCatalog();
                      }
                    }}
                    placeholder="gpt-5, claude, gemini, llama…"
                  />
                </Field>
                <Button
                  variant="secondary"
                  icon={<MagnifyingGlassIcon />}
                  loading={searching}
                  onClick={() => void searchCatalog()}
                >
                  Search
                </Button>
              </div>

              {searchError && (
                <p className="mt-3 text-xs leading-relaxed text-danger" role="alert">
                  {searchError} You can still enter the model by hand below.
                </p>
              )}

              {results.length > 0 && (
                <ul className="mt-3 max-h-72 overflow-y-auto rounded-control border border-line bg-surface">
                  {results.slice(0, 40).map((result) => (
                    <li key={`${result.providerId}:${result.modelId}`} className="border-b border-line last:border-b-0">
                      <button
                        type="button"
                        onClick={() => applyCatalogModel(result)}
                        className="flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-raised"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-[12.5px] font-medium text-ink">
                            {result.name}
                          </span>
                          <span className="mt-0.5 block truncate font-mono text-[10.5px] text-ink-muted">
                            {result.providerName} · {result.modelId}
                          </span>
                        </span>
                        <span className="flex shrink-0 flex-wrap justify-end gap-1">
                          {result.contextWindow && (
                            <Badge tone="neutral">
                              {formatTokenCount(result.contextWindow)} ctx
                            </Badge>
                          )}
                          {result.capabilities.vision && <Badge tone="signal">Vision</Badge>}
                          {result.capabilities.files && <Badge tone="neutral">PDF</Badge>}
                          {result.deprecated && <Badge tone="warning">Deprecated</Badge>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <Field
          label="Model id"
          htmlFor="ai-model-id"
          hint="The exact id sent to the provider. Slashes are allowed for gateways such as OpenRouter."
        >
          <Input
            id="ai-model-id"
            value={draft.modelId}
            onChange={(event) => setDraft((current) => ({ ...current, modelId: event.target.value }))}
            placeholder="e.g. gpt-5, claude-sonnet-4-5, gemini-2.5-pro"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>

        <Field label="Display label" htmlFor="ai-model-label" hint="Shown in the chat picker.">
          <Input
            id="ai-model-label"
            value={draft.label}
            onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
            placeholder={draft.modelId || 'Model name'}
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Context window" htmlFor="ai-model-context" hint="Tokens. Optional.">
            <Input
              id="ai-model-context"
              type="number"
              min="1"
              step="1"
              value={draft.contextWindow ?? ''}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  contextWindow: numberOrNull(event.target.value),
                }))
              }
              placeholder="Auto"
            />
          </Field>
          <Field label="Max output" htmlFor="ai-model-output" hint="Tokens. Optional.">
            <Input
              id="ai-model-output"
              type="number"
              min="1"
              step="1"
              value={draft.maxOutputTokens ?? ''}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  maxOutputTokens: numberOrNull(event.target.value),
                }))
              }
              placeholder="Provider default"
            />
          </Field>
          <Field label="Temperature" htmlFor="ai-model-temperature" hint="0–2. Optional.">
            <Input
              id="ai-model-temperature"
              type="number"
              min="0"
              max="2"
              step="0.1"
              value={draft.temperature ?? ''}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  temperature: numberOrNull(event.target.value),
                }))
              }
              placeholder="Default"
            />
          </Field>
        </div>

        <Field label="Top P" htmlFor="ai-model-top-p" hint="0–1. Optional.">
          <Input
            id="ai-model-top-p"
            type="number"
            min="0"
            max="1"
            step="0.05"
            value={draft.topP ?? ''}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                topP: numberOrNull(event.target.value),
              }))
            }
            placeholder="Default"
          />
        </Field>

        <div className="space-y-2.5 border-t border-line pt-4">
          <div>
            <h3 className="text-sm font-medium text-ink">Capabilities</h3>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">
              Chat validates attachments against these flags. Disable a capability if the gateway
              does not actually support it.
            </p>
          </div>
          <Checkbox
            id="ai-model-vision"
            checked={draft.capabilities.vision}
            onChange={(checked) => setCapability('vision', checked)}
            label="Images"
            description="Accept PNG, JPEG, WebP, or GIF image attachments."
          />
          <Checkbox
            id="ai-model-files"
            checked={draft.capabilities.files}
            onChange={(checked) => setCapability('files', checked)}
            label="PDF / files"
            description="Send PDFs as native file input. Text files use extracted text regardless."
          />
          <Checkbox
            id="ai-model-tools"
            checked={draft.capabilities.tools}
            onChange={(checked) => setCapability('tools', checked)}
            label="Tool calling"
            description="Required for Nana to read or change the workspace in chat."
          />
          <Checkbox
            id="ai-model-reasoning"
            checked={draft.capabilities.reasoning}
            onChange={(checked) => setCapability('reasoning', checked)}
            label="Reasoning"
            description="The model can return thinking/reasoning traces."
          />
        </div>

        {connection.kind === 'ollama' && (
          <div className="border-t border-line pt-4">
            <Switch
              id="ai-model-thinking"
              checked={draft.thinking}
              onChange={(thinking) => setDraft((current) => ({ ...current, thinking }))}
              label="Thinking"
              description="Ask Ollama to use its thinking mode for this model."
            />
          </div>
        )}

        <div className="rounded-panel border border-line bg-surface-sunken/50 p-4">
          <Switch
            id="ai-model-enabled"
            checked={draft.enabled}
            onChange={(enabled) => setDraft((current) => ({ ...current, enabled }))}
            label="Show in chat"
            description="Disabled models stay configured but are hidden from the picker."
          />
        </div>

        <div className="rounded-panel border border-line bg-surface-sunken/50 p-4">
          <Switch
            id="ai-model-default"
            checked={makeDefault}
            onChange={setMakeDefault}
            label="Default model"
            description="New chats use this model unless another one is selected."
          />
        </div>
      </div>
    </SidePanel>
  );
}

import {
    DEFAULT_AI_ATTACHMENT_SETTINGS,
    DEFAULT_AI_CONFIG,
    DEFAULT_MODEL_CAPABILITIES,
    DEFAULT_TITLE_PROMPT,
    PROVIDER_META,
    type AIChatAttachmentSettings,
    type AIChatModelOption,
    type AIChatStatus,
    type AIConfig,
    type AIModelCapabilities,
    type AIModelConfig,
    type AIProviderConfig,
    type AIProviderConnection,
    type AIProviderKey,
    type AIProviderKind,
} from './types';

const PROVIDER_KEYS: AIProviderKey[] = ['openai', 'google', 'ollama'];
const PROVIDER_KINDS: AIProviderKind[] = ['openai', 'google', 'anthropic', 'ollama'];
const CONNECTION_LABELS: Record<AIProviderKind, string> = {
    openai: PROVIDER_META.openai.label,
    google: PROVIDER_META.google.label,
    anthropic: 'Anthropic',
    ollama: PROVIDER_META.ollama.label,
};

const MAX_CONTEXT_WINDOW = 10_000_000;
const MAX_OUTPUT_TOKENS = 10_000_000;
const MAX_TEMPERATURE = 2;
const MAX_TOP_P = 1;

const MIN_CHAT_FILES = 1;
const MAX_CHAT_FILES = 20;
const MIN_CHAT_FILE_BYTES = 1024;
const MAX_CHAT_FILE_BYTES = 50 * 1024 * 1024;
const MIN_CHAT_TOTAL_BYTES = 1024;
const MAX_CHAT_TOTAL_BYTES = 100 * 1024 * 1024;
const MIN_CHAT_TEXT_CHARS = 1_000;
const MAX_CHAT_TEXT_CHARS = 1_000_000;

/** A model that is enabled and whose connection is enabled too. */
export interface ResolvedChatModel {
    connection: AIProviderConnection;
    model: AIModelConfig;
    isLocal: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}

function stringValue(value: unknown, fallback = ''): string {
    return typeof value === 'string' ? value : fallback;
}

function trimmedString(value: unknown, fallback = ''): string {
    return typeof value === 'string' ? value.trim() : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

function finiteNumber(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function clampNumber(value: unknown, min: number, max: number): number | null {
    const parsed = finiteNumber(value);
    if (parsed === null) return null;
    return Math.min(max, Math.max(min, parsed));
}

function positiveInteger(value: unknown, max: number): number | null {
    const parsed = finiteNumber(value);
    if (parsed === null || parsed <= 0) return null;
    return Math.min(max, Math.max(1, Math.trunc(parsed)));
}

function integerSetting(value: unknown, fallback: number, min: number, max: number): number {
    const parsed = finiteNumber(value);
    if (parsed === null) return fallback;
    return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function isProviderKey(value: unknown): value is AIProviderKey {
    return typeof value === 'string' && (PROVIDER_KEYS as string[]).includes(value);
}

function isProviderKind(value: unknown): value is AIProviderKind {
    return typeof value === 'string' && (PROVIDER_KINDS as string[]).includes(value);
}

function normalizeLegacyProviders(value: unknown): Record<AIProviderKey, AIProviderConfig> {
    const raw = asRecord(value);
    const providers = {} as Record<AIProviderKey, AIProviderConfig>;

    for (const key of PROVIDER_KEYS) {
        const source = asRecord(raw?.[key]);
        const fallback = DEFAULT_AI_CONFIG.providers[key];

        providers[key] = {
            apiKey: trimmedString(source?.apiKey, fallback.apiKey),
            baseUrl: trimmedString(source?.baseUrl, fallback.baseUrl),
            activeModel: trimmedString(source?.activeModel, fallback.activeModel),
            temperature: clampNumber(source?.temperature, 0, MAX_TEMPERATURE),
            maxTokens: positiveInteger(source?.maxTokens, MAX_OUTPUT_TOKENS),
            topP: clampNumber(source?.topP, 0, MAX_TOP_P),
            thinking: booleanValue(source?.thinking, fallback.thinking),
        };
    }

    return providers;
}

function normalizeCapabilities(value: unknown): AIModelCapabilities {
    const source = asRecord(value);
    return {
        vision: booleanValue(source?.vision, DEFAULT_MODEL_CAPABILITIES.vision),
        files: booleanValue(source?.files, DEFAULT_MODEL_CAPABILITIES.files),
        tools: booleanValue(source?.tools, DEFAULT_MODEL_CAPABILITIES.tools),
        reasoning: booleanValue(source?.reasoning, DEFAULT_MODEL_CAPABILITIES.reasoning),
    };
}

function normalizeConnections(value: unknown): AIProviderConnection[] {
    if (!Array.isArray(value)) return [];

    const connections: AIProviderConnection[] = [];
    const seen = new Set<string>();

    for (const entry of value) {
        const source = asRecord(entry);
        if (!source) continue;

        const id = trimmedString(source.id);
        if (!id || seen.has(id)) continue;

        const kind = source.kind;
        if (!isProviderKind(kind)) continue;

        const baseUrl = trimmedString(source.baseUrl)
            || (kind === 'ollama' ? PROVIDER_META.ollama.defaultBaseUrl : '');
        const catalogProviderId = trimmedString(source.catalogProviderId);

        seen.add(id);
        connections.push({
            id,
            name: trimmedString(source.name) || CONNECTION_LABELS[kind],
            kind,
            baseUrl,
            apiKey: trimmedString(source.apiKey),
            enabled: booleanValue(source.enabled, true),
            catalogProviderId: catalogProviderId || null,
        });
    }

    return connections;
}

interface NormalizedModels {
    models: AIModelConfig[];
    /** Maps stored/raw ids and canonical ids to the canonical model id. */
    idMap: Map<string, string>;
}

function normalizeModels(
    value: unknown,
    connections: AIProviderConnection[],
): NormalizedModels {
    if (!Array.isArray(value)) return { models: [], idMap: new Map() };

    const connectionById = new Map(connections.map((connection) => [connection.id, connection]));
    const models: AIModelConfig[] = [];
    const idMap = new Map<string, string>();
    const seen = new Set<string>();

    for (const entry of value) {
        const source = asRecord(entry);
        if (!source) continue;

        const connectionId = trimmedString(source.connectionId);
        const connection = connectionById.get(connectionId);
        if (!connection) continue;

        const modelId = trimmedString(source.modelId);
        if (!modelId) continue;

        const canonicalId = `${connection.id}:${modelId}`;
        const storedId = trimmedString(source.id);

        if (seen.has(canonicalId)) {
            if (storedId && !idMap.has(storedId)) idMap.set(storedId, canonicalId);
            continue;
        }

        const contextWindow = positiveInteger(source.contextWindow, MAX_CONTEXT_WINDOW);
        const requestedMaxOutput = positiveInteger(source.maxOutputTokens, MAX_OUTPUT_TOKENS);
        const maxOutputTokens = contextWindow !== null && requestedMaxOutput !== null
            ? Math.min(contextWindow, requestedMaxOutput)
            : requestedMaxOutput;
        const metadataSource = source.metadataSource === 'models.dev'
            || source.metadataSource === 'manual'
            ? source.metadataSource
            : undefined;

        const model: AIModelConfig = {
            id: canonicalId,
            connectionId: connection.id,
            modelId,
            label: trimmedString(source.label) || modelId,
            enabled: booleanValue(source.enabled, true),
            capabilities: normalizeCapabilities(source.capabilities),
            contextWindow,
            maxOutputTokens,
            temperature: clampNumber(source.temperature, 0, MAX_TEMPERATURE),
            topP: clampNumber(source.topP, 0, MAX_TOP_P),
            thinking: booleanValue(source.thinking, false),
            ...(metadataSource ? { metadataSource } : {}),
        };

        seen.add(canonicalId);
        models.push(model);
        idMap.set(canonicalId, canonicalId);
        if (storedId && !idMap.has(storedId)) idMap.set(storedId, canonicalId);
    }

    return { models, idMap };
}

function hasEnabledModel(
    model: AIModelConfig | undefined,
    connections: Map<string, AIProviderConnection>,
): model is AIModelConfig {
    if (!model || !model.enabled) return false;
    const connection = connections.get(model.connectionId);
    return Boolean(connection?.enabled);
}

function normalizeDefaultModelId(
    value: unknown,
    models: AIModelConfig[],
    idMap: Map<string, string>,
    connections: AIProviderConnection[],
): string | null {
    const requested = trimmedString(value);
    if (!requested) return null;

    const canonicalId = idMap.get(requested) ?? requested;
    const model = models.find((candidate) => candidate.id === canonicalId);
    const connectionById = new Map(connections.map((connection) => [connection.id, connection]));

    return hasEnabledModel(model, connectionById) ? canonicalId : null;
}

function synthesizeLegacyConfig(
    providers: Record<AIProviderKey, AIProviderConfig>,
    activeProvider: AIProviderKey | null,
): { connections: AIProviderConnection[]; models: AIModelConfig[]; defaultModelId: string | null } {
    const connections = PROVIDER_KEYS.map((key): AIProviderConnection => {
        const provider = providers[key];
        return {
            id: key,
            name: PROVIDER_META[key].label,
            kind: key,
            baseUrl: provider.baseUrl,
            apiKey: provider.apiKey,
            enabled: true,
            catalogProviderId: null,
        };
    });

    const models: AIModelConfig[] = [];
    let defaultModelId: string | null = null;

    for (const key of PROVIDER_KEYS) {
        const provider = providers[key];
        if (!provider.activeModel) continue;

        const modelId = `${key}:${provider.activeModel}`;
        const isActive = activeProvider === key;

        models.push({
            id: modelId,
            connectionId: key,
            modelId: provider.activeModel,
            label: provider.activeModel,
            enabled: isActive,
            capabilities: { ...DEFAULT_MODEL_CAPABILITIES },
            contextWindow: null,
            maxOutputTokens: provider.maxTokens,
            temperature: provider.temperature,
            topP: provider.topP,
            thinking: provider.thinking,
            metadataSource: 'manual',
        });

        if (isActive) defaultModelId = modelId;
    }

    return { connections, models, defaultModelId };
}

function normalizeTitlePrompt(value: unknown): string {
    const raw = stringValue(value).trim();
    if (!raw) return DEFAULT_TITLE_PROMPT;
    // Replace the old shipped default that explicitly required an emoji. An
    // admin who wrote a different prompt keeps their text; generated titles
    // are also cleaned server-side/client-side.
    if (raw.includes("MUST start with a single relevant emoji")
        || raw.includes("📊 Sales Report Analysis")) {
        return DEFAULT_TITLE_PROMPT;
    }
    return raw;
}

function normalizeAttachmentSettings(value: unknown): AIChatAttachmentSettings {
    const source = asRecord(value) ?? {};
    const maxFiles = integerSetting(
        source.maxFiles,
        DEFAULT_AI_ATTACHMENT_SETTINGS.maxFiles,
        MIN_CHAT_FILES,
        MAX_CHAT_FILES,
    );
    const maxFileBytes = integerSetting(
        source.maxFileBytes,
        DEFAULT_AI_ATTACHMENT_SETTINGS.maxFileBytes,
        MIN_CHAT_FILE_BYTES,
        MAX_CHAT_FILE_BYTES,
    );
    const requestedTotalBytes = integerSetting(
        source.maxTotalBytes,
        DEFAULT_AI_ATTACHMENT_SETTINGS.maxTotalBytes,
        MIN_CHAT_TOTAL_BYTES,
        MAX_CHAT_TOTAL_BYTES,
    );

    return {
        enabled: booleanValue(source.enabled, DEFAULT_AI_ATTACHMENT_SETTINGS.enabled),
        maxFiles,
        maxFileBytes,
        maxTotalBytes: Math.max(maxFileBytes, requestedTotalBytes),
        maxTextChars: integerSetting(
            source.maxTextChars,
            DEFAULT_AI_ATTACHMENT_SETTINGS.maxTextChars,
            MIN_CHAT_TEXT_CHARS,
            MAX_CHAT_TEXT_CHARS,
        ),
    };
}

function enabledModels(normalized: AIConfig): ResolvedChatModel[] {
    const connections = new Map(
        (normalized.connections ?? []).map((connection) => [connection.id, connection]),
    );
    const result: ResolvedChatModel[] = [];

    for (const model of normalized.models ?? []) {
        if (!hasEnabledModel(model, connections)) continue;
        const connection = connections.get(model.connectionId);
        if (!connection) continue;
        result.push({
            connection,
            model,
            isLocal: connection.kind === 'ollama',
        });
    }

    return result;
}

function selectDefaultModel(
    normalized: AIConfig,
    models: ResolvedChatModel[],
): ResolvedChatModel | null {
    const defaultId = normalized.defaultModelId;
    if (defaultId) {
        const preferred = models.find((entry) => entry.model.id === defaultId);
        if (preferred) return preferred;
    }
    return models[0] ?? null;
}

/**
 * Normalize a stored `ai_config` value into the v2 shape while keeping every
 * legacy field intact. The v1 path synthesizes one connection per legacy
 * provider and one model per non-empty `activeModel`; only the provider that
 * was active keeps an enabled model (and is the default).
 */
export function normalizeAIConfig(raw: unknown): AIConfig {
    const source = asRecord(raw) ?? {};
    const providers = normalizeLegacyProviders(source.providers);
    const activeProvider = isProviderKey(source.activeProvider) ? source.activeProvider : null;
    const attachments = normalizeAttachmentSettings(source.attachments);
    const hasV2Fields = Array.isArray(source.connections) || Array.isArray(source.models);

    let connections: AIProviderConnection[];
    let models: AIModelConfig[];
    let defaultModelId: string | null;

    if (hasV2Fields) {
        connections = normalizeConnections(source.connections);
        const normalizedModels = normalizeModels(source.models, connections);
        models = normalizedModels.models;
        defaultModelId = normalizeDefaultModelId(
            source.defaultModelId,
            models,
            normalizedModels.idMap,
            connections,
        );
    } else {
        const legacy = synthesizeLegacyConfig(providers, activeProvider);
        connections = legacy.connections;
        models = legacy.models;
        defaultModelId = legacy.defaultModelId;
    }

    return {
        activeProvider,
        systemPrompt: stringValue(source.systemPrompt, DEFAULT_AI_CONFIG.systemPrompt),
        titlePrompt: normalizeTitlePrompt(source.titlePrompt),
        providers,
        version: 2,
        connections,
        models,
        defaultModelId,
        attachments,
    };
}

/** Enabled models whose connection is also enabled, in config order. */
export function getEnabledChatModels(config: AIConfig): AIModelConfig[] {
    return enabledModels(normalizeAIConfig(config)).map((entry) => entry.model);
}

/**
 * Resolve a chat model by id. An omitted/empty id uses `defaultModelId`, then
 * the first enabled model. An explicit unknown or disabled id returns null.
 */
export function resolveChatModel(
    config: AIConfig,
    requestedId?: string | null,
): ResolvedChatModel | null {
    const normalized = normalizeAIConfig(config);
    const models = enabledModels(normalized);
    const requested = trimmedString(requestedId);

    if (requested) {
        return models.find((entry) => entry.model.id === requested) ?? null;
    }

    return selectDefaultModel(normalized, models);
}

/** Effective default id, falling back to the first enabled model. */
export function getDefaultChatModelId(config: AIConfig): string | null {
    const normalized = normalizeAIConfig(config);
    return selectDefaultModel(normalized, enabledModels(normalized))?.model.id ?? null;
}

export function getChatAttachmentSettings(config: AIConfig): AIChatAttachmentSettings {
    return normalizeAttachmentSettings(asRecord(config)?.attachments);
}

/** Safe chat status payload: no API keys, base URLs, or other connection internals. */
export function buildChatStatus(config: AIConfig): AIChatStatus {
    const normalized = normalizeAIConfig(config);
    const models = enabledModels(normalized);
    const selected = selectDefaultModel(normalized, models);

    const options: AIChatModelOption[] = models.map(({ connection, model, isLocal }) => ({
        id: model.id,
        label: model.label,
        model: model.modelId,
        provider: connection.name,
        providerKind: connection.kind,
        local: isLocal,
        contextWindow: model.contextWindow,
        maxOutputTokens: model.maxOutputTokens,
        vision: model.capabilities.vision,
        files: model.capabilities.files,
        tools: model.capabilities.tools,
        reasoning: model.capabilities.reasoning,
    }));

    return {
        configured: models.length > 0,
        model: selected?.model.modelId ?? null,
        provider: selected?.connection.kind ?? null,
        local: selected?.isLocal ?? false,
        defaultModelId: selected?.model.id ?? null,
        models: options,
        limits: getChatAttachmentSettings(normalized),
    };
}

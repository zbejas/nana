export type AIProviderKey = 'openai' | 'google' | 'ollama';

/** Provider protocol supported by a v2 connection. */
export type AIProviderKind = AIProviderKey | 'anthropic';

export interface AIProviderConfig {
    apiKey: string;
    baseUrl: string;
    activeModel: string;
    temperature: number | null;
    maxTokens: number | null;
    topP: number | null;
    thinking: boolean;
}

/**
 * One configured provider endpoint. Multiple connections may use the same
 * `kind`, which is how a workspace can mix e.g. two OpenAI-compatible hosts.
 */
export interface AIProviderConnection {
    id: string;
    name: string;
    kind: AIProviderKind;
    baseUrl: string;
    apiKey: string;
    enabled: boolean;
    catalogProviderId?: string | null;
}

export interface AIModelCapabilities {
    vision: boolean;
    files: boolean;
    tools: boolean;
    reasoning: boolean;
}

/** One selectable chat model. Ids are canonical: `connectionId:modelId`. */
export interface AIModelConfig {
    id: string;
    connectionId: string;
    modelId: string;
    label: string;
    enabled: boolean;
    capabilities: AIModelCapabilities;
    contextWindow: number | null;
    maxOutputTokens: number | null;
    temperature: number | null;
    topP: number | null;
    thinking: boolean;
    metadataSource?: 'models.dev' | 'manual';
}

/** Chat attachment limits. Attachments themselves are not implemented yet. */
export interface AIChatAttachmentSettings {
    enabled: boolean;
    maxFiles: number;
    maxFileBytes: number;
    maxTotalBytes: number;
    maxTextChars: number;
}

/** One entry in `GET /api/chat/status.models`. Never contains credentials. */
export interface AIChatModelOption {
    id: string;
    label: string;
    model: string;
    provider: string;
    providerKind: AIProviderKind;
    local: boolean;
    contextWindow: number | null;
    maxOutputTokens: number | null;
    vision: boolean;
    files: boolean;
    tools: boolean;
    reasoning: boolean;
}

/** Full status payload. API types keep the new fields optional for old clients. */
export interface AIChatStatus {
    configured: boolean;
    model: string | null;
    provider: string | null;
    local: boolean;
    defaultModelId: string | null;
    models: AIChatModelOption[];
    limits: AIChatAttachmentSettings;
}

export interface AIConfig {
    activeProvider: AIProviderKey | null;
    systemPrompt: string;
    titlePrompt: string;
    providers: Record<AIProviderKey, AIProviderConfig>;
    /** Present on normalized configs and on settings saved by the v2 UI. */
    version?: 2;
    connections?: AIProviderConnection[];
    models?: AIModelConfig[];
    defaultModelId?: string | null;
    attachments?: AIChatAttachmentSettings;
}

/** Conservative defaults: attachments stay off until an admin opts in. */
export const DEFAULT_AI_ATTACHMENT_SETTINGS: AIChatAttachmentSettings = {
    enabled: false,
    maxFiles: 5,
    maxFileBytes: 10 * 1024 * 1024,
    maxTotalBytes: 25 * 1024 * 1024,
    maxTextChars: 100_000,
};

export const DEFAULT_MODEL_CAPABILITIES: AIModelCapabilities = {
    vision: false,
    files: false,
    tools: true,
    reasoning: false,
};

export const DEFAULT_TITLE_PROMPT =
    'Generate a short title for the following conversation. ' +
    'Use a concise descriptive name (max 5 words). ' +
    'Use plain text only: no emoji, flags, symbols, quotes, or extra text. ' +
    'Output ONLY the title.\n\n' +
    'Examples:\n' +
    'Sales Report Analysis\n' +
    'Fix Login Bug\n' +
    'Trip to Japan Planning';

export const DEFAULT_AI_CONFIG: AIConfig = {
    activeProvider: null,
    systemPrompt: '',
    titlePrompt: DEFAULT_TITLE_PROMPT,
    providers: {
        openai: {
            apiKey: '',
            baseUrl: '',
            activeModel: '',
            temperature: null,
            maxTokens: null,
            topP: null,
            thinking: false,
        },
        google: {
            apiKey: '',
            baseUrl: '',
            activeModel: '',
            temperature: null,
            maxTokens: null,
            topP: null,
            thinking: false,
        },
        ollama: {
            apiKey: '',
            baseUrl: 'http://localhost:11434',
            activeModel: '',
            temperature: null,
            maxTokens: null,
            topP: null,
            thinking: false,
        },
    },
};

export const PROVIDER_META: Record<AIProviderKey, { label: string; description: string; defaultBaseUrl: string }> = {
    openai: {
        label: 'OpenAI',
        description: 'GPT models via OpenAI or compatible API',
        defaultBaseUrl: '',
    },
    google: {
        label: 'Google AI',
        description: 'Gemini models via Google AI Studio',
        defaultBaseUrl: '',
    },
    ollama: {
        label: 'Ollama',
        description: 'Local models via Ollama',
        defaultBaseUrl: 'http://localhost:11434',
    },
};

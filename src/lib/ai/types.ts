export type AIProviderKey = 'openai' | 'google' | 'ollama';

export interface AIProviderConfig {
    apiKey: string;
    baseUrl: string;
    activeModel: string;
    embeddingModel: string;
    temperature: number | null;
    maxTokens: number | null;
    topP: number | null;
    thinking: boolean;
}

export interface AIConfig {
    activeProvider: AIProviderKey | null;
    systemPrompt: string;
    titlePrompt: string;
    providers: Record<AIProviderKey, AIProviderConfig>;
}

export const DEFAULT_TITLE_PROMPT =
    'Generate a short title for the following conversation. ' +
    'The title MUST start with a single relevant emoji, followed by a space and a concise descriptive name (max 5 words). ' +
    'Output ONLY the title — no quotes, no extra text.\n\n' +
    'Examples:\n' +
    '📊 Sales Report Analysis\n' +
    '🐛 Fix Login Bug\n' +
    '✈️ Trip to Japan Planning';

export const DEFAULT_AI_CONFIG: AIConfig = {
    activeProvider: null,
    systemPrompt: '',
    titlePrompt: DEFAULT_TITLE_PROMPT,
    providers: {
        openai: {
            apiKey: '',
            baseUrl: '',
            activeModel: '',
            embeddingModel: '',
            temperature: null,
            maxTokens: null,
            topP: null,
            thinking: false,
        },
        google: {
            apiKey: '',
            baseUrl: '',
            activeModel: '',
            embeddingModel: '',
            temperature: null,
            maxTokens: null,
            topP: null,
            thinking: false,
        },
        ollama: {
            apiKey: '',
            baseUrl: 'http://localhost:11434',
            activeModel: '',
            embeddingModel: '',
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

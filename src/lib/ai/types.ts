export type AIProviderKey = 'openai' | 'google' | 'ollama';

export interface AIProviderConfig {
    apiKey: string;
    baseUrl: string;
    activeModel: string;
    embeddingModel: string;
    temperature: number | null;
    maxTokens: number | null;
    topP: number | null;
}

export interface AIConfig {
    activeProvider: AIProviderKey | null;
    providers: Record<AIProviderKey, AIProviderConfig>;
}

export const DEFAULT_AI_CONFIG: AIConfig = {
    activeProvider: null,
    providers: {
        openai: {
            apiKey: '',
            baseUrl: '',
            activeModel: '',
            embeddingModel: '',
            temperature: null,
            maxTokens: null,
            topP: null,
        },
        google: {
            apiKey: '',
            baseUrl: '',
            activeModel: '',
            embeddingModel: '',
            temperature: null,
            maxTokens: null,
            topP: null,
        },
        ollama: {
            apiKey: '',
            baseUrl: 'http://localhost:11434',
            activeModel: '',
            embeddingModel: '',
            temperature: null,
            maxTokens: null,
            topP: null,
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

import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOllama } from "ai-sdk-ollama";
import type { AIConfig, AIProviderKey } from "../../lib/ai/types";
import type { LanguageModel } from "ai";

/**
 * Create an AI SDK language model instance from the stored AI config.
 * Returns the model for the active provider with the configured activeModel.
 * Throws if no provider is active or no model is configured.
 */
export function getAIModel(config: AIConfig): LanguageModel {
    const { activeProvider } = config;

    if (!activeProvider) {
        throw new Error("No AI provider is active. Configure one in Settings → AI.");
    }

    const providerConfig = config.providers[activeProvider];
    if (!providerConfig.activeModel) {
        throw new Error(`No model configured for ${activeProvider}. Set a model in Settings → AI.`);
    }

    return createModelForProvider(activeProvider, providerConfig.activeModel, providerConfig.apiKey, providerConfig.baseUrl, providerConfig.thinking);
}

function createModelForProvider(
    provider: AIProviderKey,
    model: string,
    apiKey: string,
    baseUrl: string,
    thinking: boolean
): LanguageModel {
    switch (provider) {
        case "openai": {
            const openai = createOpenAI({
                apiKey: apiKey || undefined,
                ...(baseUrl ? { baseURL: baseUrl } : {}),
            });
            return openai(model);
        }

        case "google": {
            const google = createGoogleGenerativeAI({
                apiKey: apiKey || undefined,
                ...(baseUrl ? { baseURL: baseUrl } : {}),
            });
            return google(model);
        }

        case "ollama": {
            const ollama = createOllama({
                baseURL: baseUrl || "http://localhost:11434/api",
                // Only add auth header if API key is set (remote/authenticated Ollama)
                ...(apiKey ? {
                    headers: {
                        Authorization: `Bearer ${apiKey}`,
                    },
                } : {}),
            });
            return ollama(model, { think: thinking });
        }

        default:
            throw new Error(`Unknown AI provider: ${provider}`);
    }
}

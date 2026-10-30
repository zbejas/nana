import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOllama } from "ai-sdk-ollama";
import { normalizeAIConfig, resolveChatModel } from "../../lib/ai/config";
import type {
    AIConfig,
    AIModelConfig,
    AIProviderConnection,
    AIProviderKey,
    AIProviderKind,
} from "../../lib/ai/types";
import type { LanguageModel } from "ai";

/**
 * Create an AI SDK language model instance from the stored AI config.
 *
 * A v2 model id wins when it is enabled and its connection is enabled. Without
 * an id the default model is used, then the first enabled model. If no v2
 * model is usable, the legacy active provider remains the fallback.
 */
export function getAIModel(config: AIConfig, modelId?: string | null): LanguageModel {
    const normalized = normalizeAIConfig(config);
    const resolved = resolveChatModel(normalized, modelId);

    if (resolved) {
        return createModelForConnection(resolved.connection, resolved.model);
    }

    const requested = typeof modelId === "string" ? modelId.trim() : "";
    if (requested) {
        throw new Error(`AI model not found or disabled: ${requested}`);
    }

    const { activeProvider } = normalized;
    if (!activeProvider) {
        throw new Error("No AI provider is active. Configure one in Settings → AI.");
    }

    const providerConfig = normalized.providers[activeProvider];
    if (!providerConfig.activeModel) {
        throw new Error(`No model configured for ${activeProvider}. Set a model in Settings → AI.`);
    }

    return createModelForProvider(
        activeProvider,
        providerConfig.activeModel,
        providerConfig.apiKey,
        providerConfig.baseUrl,
        providerConfig.thinking,
    );
}

/**
 * Provider options shared by chat calls.
 *
 * This is intentionally a single seam for provider-specific request options.
 * Chat Completions, Messages, and generateContent all carry their state in the
 * request, so none are required today. In particular, OpenAI's old Responses
 * `store: false` workaround does not apply to the Chat Completions path.
 * Ollama thinking is applied on the model instance instead.
 */
export function getAIProviderOptions(
    provider: AIProviderKind | AIProviderKey | null,
): undefined {
    void provider;
    return undefined;
}

function createModelForConnection(
    connection: AIProviderConnection,
    model: AIModelConfig,
): LanguageModel {
    return createModelForProvider(
        connection.kind,
        model.modelId,
        connection.apiKey,
        connection.baseUrl,
        model.thinking,
    );
}

function createModelForProvider(
    provider: AIProviderKind,
    model: string,
    apiKey: string,
    baseUrl: string,
    thinking: boolean,
): LanguageModel {
    switch (provider) {
        case "openai": {
            const openai = createOpenAI({
                apiKey: apiKey || undefined,
                ...(baseUrl ? { baseURL: baseUrl } : {}),
            });
            // Chat Completions is the compatible path for custom OpenAI hosts.
            return openai.chat(model);
        }

        case "google": {
            const google = createGoogleGenerativeAI({
                apiKey: apiKey || undefined,
                ...(baseUrl ? { baseURL: baseUrl } : {}),
            });
            return google.chat(model);
        }

        case "anthropic": {
            const anthropic = createAnthropic({
                apiKey: apiKey || undefined,
                ...(baseUrl ? { baseURL: baseUrl } : {}),
            });
            return anthropic.chat(model);
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
            return ollama.chat(model, { think: thinking });
        }

        default:
            throw new Error(`Unknown AI provider: ${provider}`);
    }
}

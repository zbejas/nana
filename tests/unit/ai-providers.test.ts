import { describe, expect, test } from "bun:test";
import { getAIModel, getAIProviderOptions } from "../../src/api/chat/providers";
import { normalizeAIConfig } from "../../src/lib/ai/config";
import { DEFAULT_AI_CONFIG, type AIConfig } from "../../src/lib/ai/types";

function configFor(provider: AIConfig["activeProvider"], model = "test-model"): AIConfig {
    const config = structuredClone(DEFAULT_AI_CONFIG);
    config.activeProvider = provider;
    if (provider) config.providers[provider].activeModel = model;
    return config;
}

function modelIdOf(model: ReturnType<typeof getAIModel>): string {
    return typeof model === "string" ? model : model.modelId;
}

function v2Config(): AIConfig {
    return normalizeAIConfig({
        version: 2,
        connections: [
            {
                id: "work",
                name: "Work OpenAI",
                kind: "openai",
                baseUrl: "https://gateway.example.test/v1",
                apiKey: "secret",
                enabled: true,
            },
            {
                id: "claude",
                name: "Anthropic",
                kind: "anthropic",
                baseUrl: "",
                apiKey: "secret",
                enabled: true,
            },
            {
                id: "local",
                name: "Local Ollama",
                kind: "ollama",
                baseUrl: "",
                apiKey: "",
                enabled: true,
            },
        ],
        models: [
            {
                id: "custom-id",
                connectionId: "work",
                modelId: "gpt-5",
                label: "GPT-5",
                enabled: true,
                capabilities: { vision: true, files: true, tools: true, reasoning: true },
                contextWindow: 400_000,
                maxOutputTokens: 32_000,
                temperature: 0.2,
                topP: 0.9,
                thinking: false,
            },
            {
                id: "claude-sonnet",
                connectionId: "claude",
                modelId: "claude-sonnet-4-5",
                label: "Claude Sonnet",
                enabled: true,
                capabilities: { vision: true, files: true, tools: true, reasoning: true },
                contextWindow: 200_000,
                maxOutputTokens: 8_000,
                temperature: null,
                topP: null,
                thinking: true,
            },
            {
                id: "local-llama",
                connectionId: "local",
                modelId: "llama3.3",
                label: "Llama 3.3",
                enabled: true,
                capabilities: { vision: false, files: false, tools: true, reasoning: false },
                contextWindow: null,
                maxOutputTokens: null,
                temperature: null,
                topP: null,
                thinking: true,
            },
        ],
        defaultModelId: "custom-id",
    });
}

describe("AI providers", () => {
    test("does not add OpenAI Responses options to chat-completions requests", () => {
        expect(getAIProviderOptions("openai")).toBeUndefined();
        expect(getAIProviderOptions("google")).toBeUndefined();
        expect(getAIProviderOptions("anthropic")).toBeUndefined();
        expect(getAIProviderOptions("ollama")).toBeUndefined();
        expect(getAIProviderOptions(null)).toBeUndefined();
    });

    test("builds the legacy active provider model", () => {
        expect(modelIdOf(getAIModel(configFor("openai")))).toBe("test-model");
        expect(modelIdOf(getAIModel(configFor("google")))).toBe("test-model");
        expect(modelIdOf(getAIModel(configFor("ollama")))).toBe("test-model");
    });

    test("builds a v2 model by canonical id", () => {
        const config = v2Config();

        expect(modelIdOf(getAIModel(config))).toBe("gpt-5");
        expect(modelIdOf(getAIModel(config, "claude:claude-sonnet-4-5"))).toBe("claude-sonnet-4-5");
        expect(modelIdOf(getAIModel(config, "local:llama3.3"))).toBe("llama3.3");
    });

    test("rejects unknown or disabled v2 models instead of falling back", () => {
        const config = v2Config();
        const disabled = normalizeAIConfig({
            version: 2,
            connections: [
                {
                    id: "work",
                    name: "Work",
                    kind: "openai",
                    baseUrl: "",
                    apiKey: "",
                    enabled: true,
                },
            ],
            models: [
                {
                    connectionId: "work",
                    modelId: "gpt-5",
                    enabled: false,
                },
            ],
        });

        expect(() => getAIModel(config, "missing-model")).toThrow("AI model not found or disabled");
        expect(() => getAIModel(disabled, "work:gpt-5")).toThrow("AI model not found or disabled");
    });

    test("rejects a missing provider or model", () => {
        expect(() => getAIModel(configFor(null))).toThrow("No AI provider is active");
        expect(() => getAIModel(configFor("openai", ""))).toThrow("No model configured for openai");
    });
});

import { describe, expect, test } from "bun:test";
import { getAIModel, getAIProviderOptions } from "../../src/api/chat/providers";
import { DEFAULT_AI_CONFIG, type AIConfig } from "../../src/lib/ai/types";

function configFor(provider: AIConfig["activeProvider"], model = "test-model"): AIConfig {
    const config = structuredClone(DEFAULT_AI_CONFIG);
    config.activeProvider = provider;
    if (provider) config.providers[provider].activeModel = model;
    return config;
}

describe("AI providers", () => {
    test("keeps OpenAI Responses requests stateless", () => {
        expect(getAIProviderOptions("openai")).toEqual({ openai: { store: false } });
    });

    test("does not apply OpenAI options to other providers", () => {
        expect(getAIProviderOptions("google")).toBeUndefined();
        expect(getAIProviderOptions("ollama")).toBeUndefined();
        expect(getAIProviderOptions(null)).toBeUndefined();
    });

    test("builds the active provider model", () => {
        expect(getAIModel(configFor("openai")).modelId).toBe("test-model");
        expect(getAIModel(configFor("google")).modelId).toBe("test-model");
        expect(getAIModel(configFor("ollama")).modelId).toBe("test-model");
    });

    test("rejects a missing provider or model", () => {
        expect(() => getAIModel(configFor(null))).toThrow("No AI provider is active");
        expect(() => getAIModel(configFor("openai", ""))).toThrow("No model configured for openai");
    });
});

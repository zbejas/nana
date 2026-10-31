import { describe, expect, test } from "bun:test";
import {
    buildChatStatus,
    getChatAttachmentSettings,
    getDefaultChatModelId,
    getEnabledChatModels,
    normalizeAIConfig,
    resolveChatModel,
} from "../../src/lib/ai/config";
import { DEFAULT_AI_CONFIG, DEFAULT_AI_ATTACHMENT_SETTINGS, DEFAULT_TITLE_PROMPT, type AIConfig } from "../../src/lib/ai/types";

function legacyConfig(): AIConfig {
    const config = structuredClone(DEFAULT_AI_CONFIG);
    config.activeProvider = "openai";
    config.providers.openai = {
        ...config.providers.openai,
        apiKey: "sk-legacy-secret",
        baseUrl: "https://legacy.example.test/v1",
        activeModel: " gpt-4o ",
        temperature: 0.4,
        maxTokens: 2048,
        topP: 0.8,
        thinking: true,
    };
    config.providers.google.activeModel = "gemini-2.5-pro";
    return config;
}

const v2Raw = {
    version: 2,
    systemPrompt: "Be useful.",
    titlePrompt: "Title it.",
    connections: [
        {
            id: "work",
            name: "Work Gateway",
            kind: "openai",
            baseUrl: "https://work.example.test/v1",
            apiKey: "super-secret",
            enabled: true,
            catalogProviderId: "openai",
        },
        {
            id: "claude",
            name: "Anthropic",
            kind: "anthropic",
            baseUrl: "",
            apiKey: "anthropic-secret",
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
        {
            id: "off",
            name: "Disabled Google",
            kind: "google",
            baseUrl: "",
            apiKey: "google-secret",
            enabled: false,
        },
        {
            id: "work",
            name: "Duplicate work",
            kind: "openai",
            baseUrl: "",
            apiKey: "",
            enabled: true,
        },
    ],
    models: [
        {
            id: "stored-default",
            connectionId: "work",
            modelId: "gpt-5",
            label: "GPT-5",
            enabled: true,
            capabilities: { vision: true, files: true, tools: true, reasoning: true },
            contextWindow: 400_000,
            maxOutputTokens: 999_999,
            temperature: 3,
            topP: -1,
            thinking: false,
            metadataSource: "models.dev",
        },
        {
            id: "duplicate",
            connectionId: "work",
            modelId: "gpt-5",
            label: "Duplicate GPT-5",
            enabled: false,
        },
        {
            id: "orphan",
            connectionId: "missing",
            modelId: "orphan-model",
            label: "Orphan",
            enabled: true,
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
            thinking: false,
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
        {
            id: "off-gemini",
            connectionId: "off",
            modelId: "gemini-2.5-pro",
            label: "Gemini",
            enabled: true,
        },
        {
            id: "work-mini",
            connectionId: "work",
            modelId: "gpt-5-mini",
            label: "GPT-5 mini",
            enabled: false,
        },
    ],
    defaultModelId: "stored-default",
    attachments: {
        enabled: true,
        maxFiles: 999,
        maxFileBytes: 1,
        maxTotalBytes: 1,
        maxTextChars: 1,
    },
};

describe("AI config normalization", () => {
    test("normalizes v1 config into connections and a single enabled active model", () => {
        const normalized = normalizeAIConfig(legacyConfig());

        expect(normalized.version).toBe(2);
        expect(normalized.activeProvider).toBe("openai");
        expect(normalized.connections?.map((connection) => connection.id)).toEqual([
            "openai",
            "google",
            "ollama",
        ]);
        expect(normalized.connections?.map((connection) => connection.kind)).toEqual([
            "openai",
            "google",
            "ollama",
        ]);
        expect(normalized.models?.map((model) => model.id)).toEqual([
            "openai:gpt-4o",
            "google:gemini-2.5-pro",
        ]);

        const active = normalized.models?.find((model) => model.id === "openai:gpt-4o");
        const inactive = normalized.models?.find((model) => model.id === "google:gemini-2.5-pro");

        expect(active).toMatchObject({
            connectionId: "openai",
            modelId: "gpt-4o",
            label: "gpt-4o",
            enabled: true,
            temperature: 0.4,
            maxOutputTokens: 2048,
            topP: 0.8,
            thinking: true,
            metadataSource: "manual",
        });
        expect(inactive?.enabled).toBe(false);
        expect(normalized.defaultModelId).toBe("openai:gpt-4o");

        const enabled = getEnabledChatModels(normalized);
        expect(enabled.map((model) => model.id)).toEqual(["openai:gpt-4o"]);
        expect(normalized.connections?.find((connection) => connection.id === "openai")?.apiKey)
            .toBe("sk-legacy-secret");

        const resolved = resolveChatModel(normalized);
        expect(resolved?.connection.id).toBe("openai");
        expect(resolved?.isLocal).toBe(false);
        expect(resolveChatModel(normalized, "google:gemini-2.5-pro")).toBeNull();
        expect(getDefaultChatModelId(normalized)).toBe("openai:gpt-4o");
    });

    test("keeps v1 models disabled when no provider is active", () => {
        const config = legacyConfig();
        config.activeProvider = null;

        const normalized = normalizeAIConfig(config);
        expect(normalized.models?.every((model) => !model.enabled)).toBe(true);
        expect(normalized.defaultModelId).toBeNull();
        expect(resolveChatModel(normalized)).toBeNull();
        expect(buildChatStatus(normalized).configured).toBe(false);
    });

    test("sanitizes v2 connections, models, defaults, and attachment limits", () => {
        const normalized = normalizeAIConfig(v2Raw);

        expect(normalized.version).toBe(2);
        expect(normalized.connections?.map((connection) => connection.id)).toEqual([
            "work",
            "claude",
            "local",
            "off",
        ]);
        expect(normalized.connections?.find((connection) => connection.id === "local")?.baseUrl)
            .toBe("http://localhost:11434");
        expect(normalized.connections?.find((connection) => connection.id === "work")?.name)
            .toBe("Work Gateway");

        expect(normalized.models?.map((model) => model.id)).toEqual([
            "work:gpt-5",
            "claude:claude-sonnet-4-5",
            "local:llama3.3",
            "off:gemini-2.5-pro",
            "work:gpt-5-mini",
        ]);

        const primary = normalized.models?.[0];
        expect(primary).toMatchObject({
            id: "work:gpt-5",
            connectionId: "work",
            modelId: "gpt-5",
            label: "GPT-5",
            enabled: true,
            contextWindow: 400_000,
            maxOutputTokens: 400_000,
            temperature: 2,
            topP: 0,
            metadataSource: "models.dev",
        });

        const enabled = getEnabledChatModels(normalized);
        expect(enabled.map((model) => model.id)).toEqual([
            "work:gpt-5",
            "claude:claude-sonnet-4-5",
            "local:llama3.3",
        ]);
        expect(resolveChatModel(normalized, "local:llama3.3")?.isLocal).toBe(true);

        expect(normalized.defaultModelId).toBe("work:gpt-5");
        expect(resolveChatModel(normalized, "stored-default")).toBeNull();
        expect(resolveChatModel(normalized, "work:gpt-5")?.model.modelId).toBe("gpt-5");
        expect(resolveChatModel(normalized, "off:gemini-2.5-pro")).toBeNull();
        expect(resolveChatModel(normalized, "missing")).toBeNull();
        expect(getDefaultChatModelId(normalized)).toBe("work:gpt-5");

        expect(getChatAttachmentSettings(normalized)).toEqual({
            enabled: true,
            maxFiles: 20,
            maxFileBytes: 1024,
            maxTotalBytes: 1024,
            maxTextChars: 1000,
        });
    });

    test("falls back to the first enabled model and ignores disabled defaults", () => {
        const raw = structuredClone(v2Raw);
        raw.defaultModelId = "off-gemini";
        raw.models = raw.models.filter((model) => model.connectionId !== "off");

        const normalized = normalizeAIConfig(raw);
        expect(normalized.defaultModelId).toBeNull();
        expect(getDefaultChatModelId(normalized)).toBe("work:gpt-5");
        expect(resolveChatModel(normalized)?.model.id).toBe("work:gpt-5");

        const allDisabled = normalizeAIConfig({
            version: 2,
            connections: [{ id: "work", name: "Work", kind: "openai", baseUrl: "", apiKey: "", enabled: false }],
            models: [{ connectionId: "work", modelId: "gpt-5", enabled: true }],
        });
        expect(getDefaultChatModelId(allDisabled)).toBeNull();
        expect(getEnabledChatModels(allDisabled)).toEqual([]);
    });

    test("normalizes empty and malformed configs without throwing", () => {
        const normalized = normalizeAIConfig(null);

        expect(normalized.version).toBe(2);
        expect(normalized.connections).toHaveLength(3);
        expect(normalized.models).toEqual([]);
        expect(normalized.defaultModelId).toBeNull();
        expect(normalized.attachments).toEqual(DEFAULT_AI_ATTACHMENT_SETTINGS);
        expect(getEnabledChatModels(normalized)).toEqual([]);

        const malformed = normalizeAIConfig({
            connections: "not-an-array",
            models: [{ web: true }],
            attachments: { maxFiles: Number.NaN },
        });
        expect(malformed.connections).toEqual([]);
        expect(malformed.models).toEqual([]);
        expect(malformed.attachments?.maxFiles).toBe(DEFAULT_AI_ATTACHMENT_SETTINGS.maxFiles);
    });
});

describe("AI chat status", () => {
    test("reports v2 models and legacy fields without secrets", () => {
        const status = buildChatStatus(normalizeAIConfig(v2Raw));

        expect(status.configured).toBe(true);
        expect(status.model).toBe("gpt-5");
        expect(status.provider).toBe("openai");
        expect(status.local).toBe(false);
        expect(status.defaultModelId).toBe("work:gpt-5");
        expect(status.models.map((model) => model.id)).toEqual([
            "work:gpt-5",
            "claude:claude-sonnet-4-5",
            "local:llama3.3",
        ]);
        expect(status.models[0]).toEqual({
            id: "work:gpt-5",
            label: "GPT-5",
            model: "gpt-5",
            provider: "Work Gateway",
            providerKind: "openai",
            local: false,
            contextWindow: 400_000,
            maxOutputTokens: 400_000,
            vision: true,
            files: true,
            tools: true,
            reasoning: true,
        });
        expect(status.models[1]).toMatchObject({
            provider: "Anthropic",
            providerKind: "anthropic",
            local: false,
        });
        expect(status.models[2]).toMatchObject({
            provider: "Local Ollama",
            providerKind: "ollama",
            local: true,
        });
        expect(status.limits).toEqual({
            enabled: true,
            maxFiles: 20,
            maxFileBytes: 1024,
            maxTotalBytes: 1024,
            maxTextChars: 1000,
        });

        const serialized = JSON.stringify(status);
        expect(serialized).not.toContain("super-secret");
        expect(serialized).not.toContain("anthropic-secret");
        expect(serialized).not.toContain("https://work.example.test");
        expect(status.models[0]).not.toHaveProperty("apiKey");
        expect(status.models[0]).not.toHaveProperty("baseUrl");
    });

    test("replaces the old emoji title prompt with plain text", () => {
        const config = legacyConfig();
        config.titlePrompt = "Generate a short title. The title MUST start with a single relevant emoji.\n📊 Sales Report Analysis";
        expect(normalizeAIConfig(config).titlePrompt).toBe(DEFAULT_TITLE_PROMPT);
    });

    test("keeps legacy status fields for a v1 config", () => {
        const status = buildChatStatus(legacyConfig());

        expect(status.configured).toBe(true);
        expect(status.model).toBe("gpt-4o");
        expect(status.provider).toBe("openai");
        expect(status.local).toBe(false);
        expect(status.defaultModelId).toBe("openai:gpt-4o");
        expect(status.models.map((model) => model.model)).toEqual(["gpt-4o"]);
        expect(status.limits).toEqual(DEFAULT_AI_ATTACHMENT_SETTINGS);
    });
});

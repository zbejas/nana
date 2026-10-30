import { beforeEach, describe, expect, test } from "bun:test";
import {
  findCatalogModel,
  listCatalogModels,
  loadModelsDevCatalog,
  parseModelsDevCatalog,
  resetModelsDevCacheForTests,
  toCatalogModel,
  type ModelsDevCatalog,
} from "../../src/lib/ai/models-dev";

const rawCatalog = {
  openai: {
    id: "openai",
    name: "OpenAI",
    npm: "@ai-sdk/openai",
    models: {
      "gpt-vision": {
        id: "gpt-vision",
        name: "GPT Vision",
        type: "chat",
        attachment: true,
        reasoning: true,
        tool_call: true,
        temperature: true,
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
        limit: { context: 400000, output: 128000 },
      },
      "gpt-text": {
        id: "gpt-text",
        name: "GPT Text",
        type: "chat",
        tool_call: false,
        temperature: false,
        modalities: { input: ["text"], output: ["text"] },
        limit: { context: 128000 },
      },
      embedding: {
        id: "embedding",
        name: "Embedding",
        type: "embedding",
        modalities: { input: ["text"], output: ["embedding"] },
      },
    },
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    models: {
      "claude-sonnet": {
        id: "claude-sonnet",
        name: "Claude Sonnet",
        type: "chat",
        reasoning: true,
        tool_call: true,
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
        limit: { context: 200000, output: 64000 },
        status: "deprecated",
      },
    },
  },
};

describe("models.dev catalog", () => {
  beforeEach(() => {
    resetModelsDevCacheForTests();
  });

  test("parses known fields and tolerates missing metadata", () => {
    const catalog = parseModelsDevCatalog(rawCatalog);
    const openai = catalog.openai!;
    const anthropic = catalog.anthropic!;
    const model = openai.models["gpt-vision"]!;

    expect(openai.name).toBe("OpenAI");
    expect(model.modalities).toEqual({ input: ["text", "image", "pdf"], output: ["text"] });
    expect(model.limit).toEqual({ context: 400000, output: 128000 });
    expect(anthropic.models["claude-sonnet"]!.status).toBe("deprecated");
    expect(openai.models["gpt-text"]!.cost).toBeUndefined();
  });

  test("rejects a non-object catalog", () => {
    expect(() => parseModelsDevCatalog([])).toThrow("unexpected catalog");
    expect(() => parseModelsDevCatalog(null)).toThrow("unexpected catalog");
  });

  test("maps capabilities from modalities rather than the broad attachment flag", () => {
    const catalog = parseModelsDevCatalog(rawCatalog);
    const openai = catalog.openai!;
    const vision = toCatalogModel(openai, openai.models["gpt-vision"]!);
    const text = toCatalogModel(openai, openai.models["gpt-text"]!);

    expect(vision.capabilities).toEqual({
      vision: true,
      files: true,
      tools: true,
      reasoning: true,
      temperature: true,
    });
    expect(vision.contextWindow).toBe(400000);
    expect(vision.maxOutputTokens).toBe(128000);

    expect(text.capabilities.vision).toBe(false);
    expect(text.capabilities.files).toBe(false);
    expect(text.capabilities.tools).toBe(false);
    expect(text.capabilities.temperature).toBe(false);
    expect(text.maxOutputTokens).toBeNull();
  });

  test("only lists chat models with text output", () => {
    const catalog = parseModelsDevCatalog(rawCatalog);
    const models = listCatalogModels(catalog);

    expect(models.map((model) => model.modelId).sort()).toEqual([
      "claude-sonnet",
      "gpt-text",
      "gpt-vision",
    ]);
    expect(models.find((model) => model.modelId === "embedding")).toBeUndefined();
  });

  test("searches provider, model label, and id", () => {
    const catalog = parseModelsDevCatalog(rawCatalog);

    expect(listCatalogModels(catalog, "anthropic").map((model) => model.modelId)).toEqual([
      "claude-sonnet",
    ]);
    expect(listCatalogModels(catalog, "vision").map((model) => model.modelId)).toEqual([
      "gpt-vision",
    ]);
    expect(listCatalogModels(catalog, "gpt-text").map((model) => model.modelId)).toEqual([
      "gpt-text",
    ]);
  });

  test("finds a single catalog entry", () => {
    const catalog = parseModelsDevCatalog(rawCatalog);
    expect(findCatalogModel(catalog, "openai", "gpt-vision")?.name).toBe("GPT Vision");
    expect(findCatalogModel(catalog, "openai", "missing")).toBeNull();
    expect(findCatalogModel(catalog, "missing", "gpt-vision")).toBeNull();
  });
});

describe("models.dev cache", () => {
  beforeEach(() => {
    resetModelsDevCacheForTests();
  });

  test("uses an ETag and serves a 304 from cache", async () => {
    let calls = 0;
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      const headers = new Headers(init?.headers);
      if (calls === 1) {
        expect(headers.get("if-none-match")).toBeNull();
        return new Response(JSON.stringify(rawCatalog), {
          status: 200,
          headers: { "content-type": "application/json", etag: 'W/"catalog"' },
        });
      }

      expect(headers.get("if-none-match")).toBe('W/"catalog"');
      return new Response(null, { status: 304 });
    }) as unknown as typeof fetch;

    const first = await loadModelsDevCatalog(fetchImpl);
    expect(calls).toBe(1);
    expect(first.openai!.models["gpt-vision"]!.name).toBe("GPT Vision");

    const cached = await loadModelsDevCatalog(fetchImpl);
    expect(calls).toBe(1);
    expect(cached).toBe(first);

    const refreshed = await loadModelsDevCatalog(fetchImpl, { force: true });
    expect(calls).toBe(2);
    expect(refreshed).toBe(first);
    expect(refreshed.anthropic!.models["claude-sonnet"]!.name).toBe("Claude Sonnet");
  });

  test("keeps the previous snapshot when a refresh fails", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify(rawCatalog), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error("offline");
    }) as unknown as typeof fetch;

    const first = await loadModelsDevCatalog(fetchImpl);
    expect(calls).toBe(1);

    const stale = await loadModelsDevCatalog(fetchImpl, { force: true });
    expect(calls).toBe(2);
    expect(stale).toBe(first);
    expect(stale.openai!.models["gpt-text"]!.name).toBe("GPT Text");
  });

  test("rejects when the first load fails", async () => {
    const fetchImpl = (async () => new Response("offline", { status: 503 })) as unknown as typeof fetch;
    await expect(loadModelsDevCatalog(fetchImpl)).rejects.toThrow("models.dev request failed");
  });
});

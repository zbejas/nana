/**
 * Read-only client for the public models.dev catalog.
 *
 * The catalog is advisory metadata. The admin surface snapshots a model's
 * limits and capabilities into `ai_config`; chat status also reads the cached
 * catalog to fill a missing context window without writing it back. This
 * module keeps a server-side cache so repeated reads do not download the
 * ~6 MB source each time.
 */

export const MODELS_DEV_URL = "https://models.dev/api.json";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export interface ModelsDevModel {
  id: string;
  name: string;
  type?: string;
  attachment?: boolean;
  reasoning?: boolean;
  reasoning_options?: Array<
    | { type: "effort"; values: string[] }
    | { type: "budget_tokens"; min?: number; max?: number }
    | { type: "toggle" }
  >;
  tool_call?: boolean;
  structured_output?: boolean;
  temperature?: boolean;
  knowledge?: string;
  release_date?: string;
  last_updated?: string;
  modalities?: { input?: string[]; output?: string[] };
  open_weights?: boolean;
  limit?: { context?: number; input?: number; output?: number };
  cost?: {
    input?: number;
    output?: number;
    cache_read?: number;
    cache_write?: number;
  };
  status?: "alpha" | "beta" | "deprecated";
  canonical_model_id?: string;
}

export interface ModelsDevProvider {
  id: string;
  name: string;
  env?: string[];
  npm?: string;
  api?: string;
  doc?: string;
  models: Record<string, ModelsDevModel>;
}

export type ModelsDevCatalog = Record<string, ModelsDevProvider>;

export interface CatalogModel {
  providerId: string;
  providerName: string;
  modelId: string;
  name: string;
  capabilities: {
    vision: boolean;
    files: boolean;
    tools: boolean;
    reasoning: boolean;
    temperature: boolean;
  };
  contextWindow: number | null;
  maxOutputTokens: number | null;
  deprecated: boolean;
}

interface CacheEntry {
  data: ModelsDevCatalog;
  etag: string | null;
  at: number;
}

let cache: CacheEntry | null = null;
let inFlight: Promise<ModelsDevCatalog> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate the pieces this app reads and tolerate new fields. */
export function parseModelsDevCatalog(raw: unknown): ModelsDevCatalog {
  if (!isRecord(raw)) {
    throw new Error("models.dev returned an unexpected catalog");
  }

  const catalog: ModelsDevCatalog = {};

  for (const [providerId, rawProvider] of Object.entries(raw)) {
    if (!isRecord(rawProvider) || !isRecord(rawProvider.models)) continue;

    const provider: ModelsDevProvider = {
      id: providerId,
      name: typeof rawProvider.name === "string" ? rawProvider.name : providerId,
      models: {},
    };
    if (typeof rawProvider.npm === "string") provider.npm = rawProvider.npm;
    if (typeof rawProvider.api === "string") provider.api = rawProvider.api;
    if (typeof rawProvider.doc === "string") provider.doc = rawProvider.doc;
    if (Array.isArray(rawProvider.env)) {
      provider.env = rawProvider.env.filter((entry): entry is string => typeof entry === "string");
    }

    for (const [modelKey, rawModel] of Object.entries(rawProvider.models)) {
      if (!isRecord(rawModel)) continue;

      const modalities = isRecord(rawModel.modalities) ? rawModel.modalities : {};
      const limit = isRecord(rawModel.limit) ? rawModel.limit : {};
      const model: ModelsDevModel = {
        id: typeof rawModel.id === "string" ? rawModel.id : modelKey,
        name: typeof rawModel.name === "string" ? rawModel.name : modelKey,
      };
      if (typeof rawModel.type === "string") model.type = rawModel.type;
      if (typeof rawModel.attachment === "boolean") model.attachment = rawModel.attachment;
      if (typeof rawModel.reasoning === "boolean") model.reasoning = rawModel.reasoning;
      if (Array.isArray(rawModel.reasoning_options)) {
        model.reasoning_options = rawModel.reasoning_options as ModelsDevModel["reasoning_options"];
      }
      if (typeof rawModel.tool_call === "boolean") model.tool_call = rawModel.tool_call;
      if (typeof rawModel.structured_output === "boolean") {
        model.structured_output = rawModel.structured_output;
      }
      if (typeof rawModel.temperature === "boolean") model.temperature = rawModel.temperature;
      model.modalities = {
        input: Array.isArray(modalities.input)
          ? modalities.input.filter((entry): entry is string => typeof entry === "string")
          : [],
        output: Array.isArray(modalities.output)
          ? modalities.output.filter((entry): entry is string => typeof entry === "string")
          : [],
      };
      model.limit = {
        ...(typeof limit.context === "number" ? { context: limit.context } : {}),
        ...(typeof limit.input === "number" ? { input: limit.input } : {}),
        ...(typeof limit.output === "number" ? { output: limit.output } : {}),
      };
      if (isRecord(rawModel.cost)) {
        model.cost = {
          ...(typeof rawModel.cost.input === "number" ? { input: rawModel.cost.input } : {}),
          ...(typeof rawModel.cost.output === "number" ? { output: rawModel.cost.output } : {}),
          ...(typeof rawModel.cost.cache_read === "number"
            ? { cache_read: rawModel.cost.cache_read }
            : {}),
          ...(typeof rawModel.cost.cache_write === "number"
            ? { cache_write: rawModel.cost.cache_write }
            : {}),
        };
      }
      if (rawModel.status === "alpha" || rawModel.status === "beta" || rawModel.status === "deprecated") {
        model.status = rawModel.status;
      }
      if (typeof rawModel.canonical_model_id === "string") {
        model.canonical_model_id = rawModel.canonical_model_id;
      }

      provider.models[model.id] = model;
    }

    catalog[provider.id] = provider;
  }

  return catalog;
}

export function isChatModel(model: ModelsDevModel): boolean {
  return (
    (!model.type || model.type === "chat") &&
    Boolean(model.modalities?.output?.includes("text"))
  );
}

export function toCatalogModel(
  provider: ModelsDevProvider,
  model: ModelsDevModel
): CatalogModel {
  const input = model.modalities?.input ?? [];
  return {
    providerId: provider.id,
    providerName: provider.name,
    modelId: model.id,
    name: model.name,
    capabilities: {
      vision: input.includes("image"),
      files: input.includes("pdf"),
      tools: model.tool_call === true,
      reasoning: model.reasoning === true,
      temperature: model.temperature !== false,
    },
    contextWindow: model.limit?.context ?? null,
    maxOutputTokens: model.limit?.output ?? null,
    deprecated: model.status === "deprecated",
  };
}

/** Free-text search over provider name, model name, and id. */
export function listCatalogModels(
  catalog: ModelsDevCatalog,
  query = "",
  limit = 200
): CatalogModel[] {
  const needle = query.trim().toLowerCase();
  const models: CatalogModel[] = [];

  for (const provider of Object.values(catalog)) {
    for (const model of Object.values(provider.models)) {
      if (!isChatModel(model)) continue;
      if (needle) {
        const haystack = `${provider.name} ${provider.id} ${model.name} ${model.id}`.toLowerCase();
        if (!haystack.includes(needle)) continue;
      }
      models.push(toCatalogModel(provider, model));
    }
  }

  models.sort((a, b) => {
    if (a.deprecated !== b.deprecated) return a.deprecated ? 1 : -1;
    return `${a.providerName} ${a.name}`.localeCompare(`${b.providerName} ${b.name}`);
  });

  return models.slice(0, limit);
}

export function findCatalogModel(
  catalog: ModelsDevCatalog,
  providerId: string,
  modelId: string
): CatalogModel | null {
  const provider = catalog[providerId];
  const model = provider?.models[modelId];
  return provider && model ? toCatalogModel(provider, model) : null;
}

/**
 * Context window for a model id that was configured without catalog metadata.
 * When the connection has no catalog provider, use the smallest window offered
 * for that exact model id so a percentage never overstates the available room.
 */
export function catalogContextWindow(
  catalog: ModelsDevCatalog,
  modelId: string,
  providerId?: string | null
): number | null {
  if (providerId) {
    const exact = findCatalogModel(catalog, providerId, modelId);
    if (exact?.contextWindow) return exact.contextWindow;
  }

  let smallest: number | null = null;
  for (const provider of Object.values(catalog)) {
    const model = provider.models[modelId];
    if (!model) continue;
    const window = model.limit?.context;
    if (typeof window !== "number" || !Number.isFinite(window) || window <= 0) continue;
    smallest = smallest === null ? window : Math.min(smallest, window);
  }
  return smallest;
}

async function downloadCatalog(fetchImpl: typeof fetch): Promise<ModelsDevCatalog> {
  const headers: Record<string, string> = {};
  if (cache?.etag) headers["If-None-Match"] = cache.etag;

  const response = await fetchImpl(MODELS_DEV_URL, {
    headers,
    signal: AbortSignal.timeout(10_000),
  });

  if (response.status === 304 && cache) {
    cache.at = Date.now();
    return cache.data;
  }
  if (!response.ok) {
    throw new Error(`models.dev request failed (${response.status})`);
  }

  const data = parseModelsDevCatalog(await response.json());
  cache = {
    data,
    etag: response.headers.get("etag"),
    at: Date.now(),
  };
  return data;
}

/**
 * Load the catalog with a six-hour cache. On a refresh failure, a previously
 * loaded snapshot stays usable; a first-load failure rejects.
 */
export async function loadModelsDevCatalog(
  fetchImpl: typeof fetch = fetch,
  options: { force?: boolean } = {}
): Promise<ModelsDevCatalog> {
  if (!options.force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;
  if (inFlight) return inFlight;

  inFlight = downloadCatalog(fetchImpl)
    .catch((error) => {
      if (cache) return cache.data;
      throw error;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/** Test seam; production code never needs to clear the cache. */
export function resetModelsDevCacheForTests(): void {
  cache = null;
  inFlight = null;
}

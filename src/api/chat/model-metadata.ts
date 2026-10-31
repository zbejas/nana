import { normalizeAIConfig } from '../../lib/ai/config';
import {
  catalogContextWindow,
  loadModelsDevCatalog,
  type ModelsDevCatalog,
} from '../../lib/ai/models-dev';
import type { AIConfig } from '../../lib/ai/types';

type CatalogLoader = () => Promise<ModelsDevCatalog>;

const FAILURE_BACKOFF_MS = 5 * 60 * 1000;
let catalogFailedAt = 0;

/**
 * Fill a missing context window from the models.dev catalog. This is a display
 * fallback for models configured before the v2 metadata fields existed or added
 * by hand without catalog search. Explicit windows always win and nothing is
 * written back to `ai_config`.
 */
export async function enrichModelContextWindows(
  config: AIConfig,
  loadCatalog: CatalogLoader = loadModelsDevCatalog,
): Promise<AIConfig> {
  const normalized = normalizeAIConfig(config);
  const missing = (normalized.models ?? []).filter(
    (model) => model.enabled && model.contextWindow === null,
  );
  if (missing.length === 0) return normalized;
  if (Date.now() - catalogFailedAt < FAILURE_BACKOFF_MS) return normalized;

  let catalog: ModelsDevCatalog;
  try {
    catalog = await loadCatalog();
  } catch {
    catalogFailedAt = Date.now();
    return normalized;
  }
  catalogFailedAt = 0;

  const connectionById = new Map(
    (normalized.connections ?? []).map((connection) => [connection.id, connection]),
  );
  let changed = false;

  const models = (normalized.models ?? []).map((model) => {
    if (!model.enabled || model.contextWindow !== null) return model;
    const providerId = connectionById.get(model.connectionId)?.catalogProviderId;
    const contextWindow = catalogContextWindow(catalog, model.modelId, providerId);
    if (contextWindow === null) return model;
    changed = true;
    return { ...model, contextWindow };
  });

  return changed ? { ...normalized, models } : normalized;
}

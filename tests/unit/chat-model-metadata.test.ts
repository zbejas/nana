import { describe, expect, test } from 'bun:test';
import { enrichModelContextWindows } from '../../src/api/chat/model-metadata';
import { normalizeAIConfig } from '../../src/lib/ai/config';
import { parseModelsDevCatalog } from '../../src/lib/ai/models-dev';

const catalog = parseModelsDevCatalog({
  proxy: {
    id: 'proxy',
    name: 'Proxy',
    models: {
      'deepseek-v4.1-flash': {
        id: 'deepseek-v4.1-flash',
        name: 'DeepSeek V4.1 Flash',
        type: 'chat',
        modalities: { input: ['text'], output: ['text'] },
        limit: { context: 1_000_000 },
      },
    },
  },
});

function legacyConfig() {
  return normalizeAIConfig({
    activeProvider: 'openai',
    providers: {
      openai: { activeModel: 'deepseek-v4.1-flash', apiKey: 'secret', baseUrl: '' },
      google: { activeModel: '', apiKey: '', baseUrl: '' },
      ollama: { activeModel: '', apiKey: '', baseUrl: '' },
    },
  });
}

describe('chat model metadata fallback', () => {
  test('fills only a missing context window from models.dev', async () => {
    const enriched = await enrichModelContextWindows(legacyConfig(), async () => catalog);
    const model = enriched.models?.find((entry) => entry.modelId === 'deepseek-v4.1-flash');
    expect(model?.contextWindow).toBe(1_000_000);
  });

  test('keeps an explicit window and tolerates an unavailable catalog', async () => {
    const config = legacyConfig();
    const explicit = {
      ...config,
      models: config.models?.map((model) => ({ ...model, contextWindow: 64_000 })),
    };
    const kept = await enrichModelContextWindows(explicit, async () => catalog);
    expect(kept.models?.[0]?.contextWindow).toBe(64_000);

    const unavailable = await enrichModelContextWindows(legacyConfig(), async () => {
      throw new Error('offline');
    });
    expect(unavailable.models?.[0]?.contextWindow).toBeNull();
  });
});

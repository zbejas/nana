import { describe, expect, test } from 'bun:test';
import { chatModelCapabilityLabel, chatModelLabel, chatModelOptions, findChatModel } from '../../src/lib/chat/models';
import type { ChatStatusResponse } from '../../src/api/chat/types';

const status: ChatStatusResponse = {
  configured: true,
  model: 'gpt-5',
  provider: 'openai',
  local: false,
  defaultModelId: 'work:gpt-5',
  models: [
    {
      id: 'work:gpt-5',
      label: 'GPT-5',
      model: 'gpt-5',
      provider: 'Work gateway',
      providerKind: 'openai',
      local: false,
      contextWindow: 400_000,
      maxOutputTokens: 128_000,
      vision: true,
      files: true,
      tools: true,
      reasoning: true,
    },
    {
      id: 'local:llama',
      label: 'Llama',
      model: 'llama3.3',
      provider: 'Local',
      providerKind: 'ollama',
      local: true,
      contextWindow: null,
      maxOutputTokens: null,
      vision: false,
      files: false,
      tools: true,
      reasoning: false,
    },
  ],
};

describe('chat model helpers', () => {
  test('returns the enabled model list and tolerates an older status', () => {
    expect(chatModelOptions(status)).toHaveLength(2);
    expect(chatModelOptions(null)).toEqual([]);
    expect(chatModelOptions({ configured: false, model: null, provider: null, local: false })).toEqual([]);
  });

  test('finds the selected model', () => {
    expect(findChatModel(status, 'local:llama')?.label).toBe('Llama');
    expect(findChatModel(status, 'missing')).toBeNull();
    expect(findChatModel(status, null)).toBeNull();
  });

  test('falls back to the server model when no selection exists', () => {
    expect(chatModelLabel(status, 'work:gpt-5')).toBe('GPT-5');
    expect(chatModelLabel(status, null)).toBe('gpt-5');
    expect(chatModelLabel({ configured: false, model: null, provider: null, local: false }, null)).toBe('Default model');
  });

  test('summarizes capabilities', () => {
    expect(chatModelCapabilityLabel(status.models![0]!)).toContain('images');
    expect(chatModelCapabilityLabel(status.models![0]!)).toContain('PDF');
    expect(chatModelCapabilityLabel(status.models![1]!)).toBe('tools · local');
    expect(chatModelCapabilityLabel(null)).toBe('');
  });
});

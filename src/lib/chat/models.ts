import type { AIChatModelOption } from '../ai/types';
import type { ChatStatusResponse } from './types';

/** Enabled models from a status payload. Tolerates older servers. */
export function chatModelOptions(status: ChatStatusResponse | null): AIChatModelOption[] {
  return status?.models ?? [];
}

export function findChatModel(
  status: ChatStatusResponse | null,
  modelId: string | null,
): AIChatModelOption | null {
  if (!modelId) return null;
  return chatModelOptions(status).find((model) => model.id === modelId) ?? null;
}

/** Compact label used in the composer and the chat header. */
export function chatModelLabel(
  status: ChatStatusResponse | null,
  modelId: string | null,
): string {
  const model = findChatModel(status, modelId);
  if (model) return model.label;
  if (status?.model) return status.model;
  return 'Default model';
}

export function chatModelCapabilityLabel(model: AIChatModelOption | null): string {
  if (!model) return '';
  const labels: string[] = [];
  if (model.vision) labels.push('images');
  if (model.files) labels.push('PDF');
  if (model.tools) labels.push('tools');
  if (model.local) labels.push('local');
  return labels.join(' · ');
}

import { atom, getDefaultStore, useAtomValue } from 'jotai';

/**
 * The AI actor is editing a record. The chat dock owns this state; the editor
 * and board surfaces can consume it without knowing anything about the stream.
 *
 * `targetType` is omitted only when a write tool is running but the server has
 * not told us which record it touches yet. A consumer must match both type and
 * id before showing a banner.
 */
export interface AiEditingState {
  targetType?: 'document' | 'board' | 'folder';
  targetId?: string;
  title?: string;
  conversationId?: string;
  startedAt: number;
}

export const aiEditingAtom = atom<AiEditingState | null>(null);

let current: AiEditingState | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function getAiEditing(): AiEditingState | null {
  return current;
}

/** Update the shared AI-editing state. Identical updates are ignored. */
export function setAiEditing(next: AiEditingState | null): void {
  if (
    current === next
    || (
      current
      && next
      && current.targetType === next.targetType
      && current.targetId === next.targetId
      && current.title === next.title
      && current.conversationId === next.conversationId
    )
  ) {
    return;
  }

  current = next;
  getDefaultStore().set(aiEditingAtom, next);
  emit();

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('nana:ai-editing', { detail: next }));
  }
}

export function markAiEditing(state: Omit<AiEditingState, 'startedAt'> & { startedAt?: number }): void {
  setAiEditing({ ...state, startedAt: state.startedAt ?? Date.now() });
}

export function clearAiEditing(target?: { type?: AiEditingState['targetType']; id?: string }): void {
  if (!current) return;
  if (target && current.targetType && target.type && current.targetType !== target.type) return;
  if (target && current.targetId && target.id && current.targetId !== target.id) return;
  setAiEditing(null);
}

export function subscribeAiEditing(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React binding for the editor. */
export function useAiEditing(): AiEditingState | null {
  return useAtomValue(aiEditingAtom);
}

/** True only when Nana is editing this exact record. */
export function useIsAiEditing(type: AiEditingState['targetType'], id: string | undefined): boolean {
  const editing = useAiEditing();
  return Boolean(editing && id && editing.targetType === type && editing.targetId === id);
}

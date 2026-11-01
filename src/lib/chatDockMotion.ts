export type ChatDockExitSide = 'left' | 'right';

export type ChatDockExitPhase = 'closed' | 'closing' | 'open';

export interface ChatDockExitState {
  phase: ChatDockExitPhase;
  side: ChatDockExitSide;
}

/**
 * The exit slide and the delayed visibility transition both settle by 200ms.
 * This bounded fallback leaves a frame of slack for a browser that drops both
 * transition events; a normal entrance clears it before it can fire.
 */
export const CHAT_DOCK_EXIT_FALLBACK_MS = 240;

export function closedChatDockExitState(): ChatDockExitState {
  return { phase: 'closed', side: 'right' };
}

/** The inline closed transform says which edge this close is heading for. */
export function beginChatDockExitState(closedX: string): ChatDockExitState {
  return {
    phase: 'closing',
    side: closedX.trim().startsWith('-') ? 'left' : 'right',
  };
}

export function completedChatDockExitState(): ChatDockExitState {
  return { phase: 'closed', side: 'right' };
}

export function openChatDockExitState(state: ChatDockExitState): ChatDockExitState {
  return { phase: 'open', side: state.side };
}

/**
 * A reopen may reverse an exit that is still running, from either edge. Once
 * the close transition ends - or the bounded fallback settles it - the next
 * entrance always starts on the right so it never slides in from the side the
 * previous close left behind.
 */
export function resolveChatDockEntrance(
  state: ChatDockExitState,
): 'reverse' | 'from-right' {
  return state.phase === 'closing' ? 'reverse' : 'from-right';
}

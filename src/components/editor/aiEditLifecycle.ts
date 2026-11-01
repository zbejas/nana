/**
 * Pure lifecycle decisions for the AI edit flash.
 *
 * The server's chat `edit` event and the Yjs room broadcast are independent
 * streams, so the editor cannot infer the pre-edit body from whichever remote
 * update happened to arrive last. A document body write therefore carries an
 * event-only `contentChange.before/after` pair. This module resolves that pair
 * against the current body, the room connection state, and a bounded ring of
 * recent remote transitions used only as a fallback for older events or an
 * over-cap omission.
 */

import { normalizeMarkdown } from './milkdown/helpers';

export interface AiEditContentChange {
  before: string;
  after: string;
  beforeRevision?: number;
  afterRevision?: number;
}

export interface AiEditRemoteTransition {
  from: string;
  to: string;
}

export type AiEditRoomStatus = 'connected' | 'connecting' | 'offline' | 'absent';

export type AiEditResolution =
  | {
      action: 'paint';
      /** Pre-edit body used for the diff. */
      previousMarkdown: string;
      /** Post-edit body the editor should already hold. */
      markdown: string;
      /** True only on the no-room path when `after` still needs applying. */
      replace: boolean;
      source: 'event' | 'remote';
    }
  | { action: 'wait'; reason: 'room' | 'connection' }
  | {
      action: 'skip';
      reason:
        | 'duplicate'
        | 'wrong-document'
        | 'stale'
        | 'missing-target'
        | 'missing-before'
        | 'diverged';
    };

export interface ResolveAiEditInput {
  eventId: string;
  targetId: string;
  currentDocumentId?: string | null;
  /**
   * The last event id handled by this editor before this event. Passing the
   * current id makes the resolver report `duplicate`, so the caller does not
   * need a second dedupe path in the flash lifecycle.
   */
  lastHandledEventId?: string | null;
  contentChange?: AiEditContentChange | null;
  /** The server omitted over-cap body text but still sent the edit card. */
  contentChangeOmitted?: boolean;
  currentMarkdown: string;
  /** Fetched body used as the target for old/omitted events. */
  fetchedMarkdown?: string | null;
  /** Revision returned with the fetched body, when available. */
  fetchedRevision?: number | null;
  remoteTransitions?: readonly AiEditRemoteTransition[];
  roomStatus: AiEditRoomStatus;
  /** Highest revision the editor knows for this note. */
  currentRevision?: number | null;
  /** The short grace for an existing session to become connected has elapsed. */
  connectionWaitElapsed?: boolean;
  /** The connected-room convergence window has elapsed. */
  roomWaitElapsed?: boolean;
}

function normalized(value: string | null | undefined): string {
  return normalizeMarkdown(value ?? '');
}

function finiteRevision(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

function eventChange(input: ResolveAiEditInput): AiEditContentChange | null {
  const change = input.contentChange;
  if (!change || typeof change.before !== 'string' || typeof change.after !== 'string') {
    return null;
  }
  return change;
}

/**
 * Newest fallback before-image whose transition ends at the target body.
 * Older transitions never win over a later one that produced the same body.
 */
export function findRemoteTransition(
  transitions: readonly AiEditRemoteTransition[],
  target: string,
): AiEditRemoteTransition | null {
  const wanted = normalized(target);
  for (let index = transitions.length - 1; index >= 0; index -= 1) {
    const transition = transitions[index];
    if (transition && normalized(transition.to) === wanted) return transition;
  }
  return null;
}

export const MAX_REMOTE_TRANSITIONS = 12;
export const MAX_REMOTE_TRANSITION_CHARS = 192 * 1024;

/**
 * Append one remote `{from,to}` transition, keeping newest-last order and a
 * hard bound on both count and characters. A transition larger than the whole
 * budget is not useful as a fallback, so it is dropped rather than truncated.
 */
export function appendRemoteTransition(
  transitions: readonly AiEditRemoteTransition[],
  from: string,
  to: string,
): AiEditRemoteTransition[] {
  const nextFrom = normalized(from);
  const nextTo = normalized(to);
  if (nextFrom === nextTo) return [...transitions];

  const last = transitions[transitions.length - 1];
  if (last && normalized(last.from) === nextFrom && normalized(last.to) === nextTo) {
    return [...transitions];
  }

  const next = [...transitions, { from: nextFrom, to: nextTo }];
  if (nextFrom.length + nextTo.length > MAX_REMOTE_TRANSITION_CHARS) {
    next.pop();
  }

  while (next.length > MAX_REMOTE_TRANSITIONS) next.shift();
  let total = next.reduce((sum, entry) => sum + entry.from.length + entry.to.length, 0);
  while (total > MAX_REMOTE_TRANSITION_CHARS && next.length > 1) {
    const removed = next.shift();
    if (!removed) break;
    total -= removed.from.length + removed.to.length;
  }
  return next;
}

/**
 * Decide whether one AI edit event may paint, must wait for the room, or must
 * not touch the editor. The event's own body pair always wins over the remote
 * ring; the ring is a fallback for old events and over-cap omissions.
 *
 * Latest-wins is intentional: each event carries its own bodies, and the
 * caller cancels a previous pending event when a newer id arrives. This
 * resolver never queues edits.
 */
export function resolveAiEdit(input: ResolveAiEditInput): AiEditResolution {
  if (input.currentDocumentId !== input.targetId) {
    return { action: 'skip', reason: 'wrong-document' };
  }
  if (input.eventId && input.lastHandledEventId === input.eventId) {
    return { action: 'skip', reason: 'duplicate' };
  }

  const change = eventChange(input);
  const target = change
    ? normalized(change.after)
    : typeof input.fetchedMarkdown === 'string'
      ? normalized(input.fetchedMarkdown)
      : null;
  if (target === null) {
    return { action: 'skip', reason: 'missing-target' };
  }

  const current = normalized(input.currentMarkdown);
  const afterRevision = finiteRevision(change?.afterRevision);
  const currentRevision = finiteRevision(input.currentRevision);
  const fetchedRevision = finiteRevision(input.fetchedRevision);
  const fetched = typeof input.fetchedMarkdown === 'string'
    ? normalized(input.fetchedMarkdown)
    : null;
  const newerRevision = afterRevision !== null && (
    (currentRevision !== null && currentRevision > afterRevision)
    || (fetchedRevision !== null && fetchedRevision > afterRevision)
  );
  // A revision-only bump (title/tags) does not supersede the body pair. When a
  // newer body is visible, however, this event is stale even if its own body
  // still matches a lagging local copy.
  if (newerRevision && (current !== target || (fetched !== null && fetched !== target))) {
    return { action: 'skip', reason: 'stale' };
  }

  let previous = change ? normalized(change.before) : null;
  let source: 'event' | 'remote' = 'event';
  if (previous === null) {
    const fallback = findRemoteTransition(input.remoteTransitions ?? [], target);
    if (fallback) {
      previous = normalized(fallback.from);
      source = 'remote';
    }
  }

  if (input.roomStatus === 'connected') {
    if (current === target) {
      if (previous === null) return { action: 'skip', reason: 'missing-before' };
      return {
        action: 'paint',
        previousMarkdown: previous,
        markdown: target,
        replace: false,
        source,
      };
    }
    // The room owns content. Never replace it from the event, and do not paint
    // a diff once a merged local body has diverged from the event's after.
    if (input.roomWaitElapsed) return { action: 'skip', reason: 'diverged' };
    return { action: 'wait', reason: 'room' };
  }

  if (
    (input.roomStatus === 'connecting' || input.roomStatus === 'offline')
    && !input.connectionWaitElapsed
  ) {
    return { action: 'wait', reason: 'connection' };
  }

  // No connected room: apply `after` only when the body is still one of the
  // two event images. Local typing that moved elsewhere wins and skips.
  if (current === target) {
    if (previous === null) return { action: 'skip', reason: 'missing-before' };
    return {
      action: 'paint',
      previousMarkdown: previous,
      markdown: target,
      replace: false,
      source,
    };
  }
  if (previous !== null && current === previous) {
    return {
      action: 'paint',
      previousMarkdown: previous,
      markdown: target,
      replace: true,
      source,
    };
  }
  return { action: 'skip', reason: 'diverged' };
}

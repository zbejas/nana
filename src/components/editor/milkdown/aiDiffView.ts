/**
 * Presentation-side helpers for the AI-edit flash. The diff itself lives in
 * `aiDiff.ts`; the pure geometry/copy helpers and the bounded flash token here
 * keep the source and rendered panes in agreement.
 */
import type { AiTextChange } from './aiDiff';

/** The visible animation. Keep below the 1.2s `aiEdit` state in the editor. */
export const AI_DIFF_FLASH_MS = 1_100;
/** Decoration removal. Slightly after the animation so the fade completes. */
export const AI_DIFF_CLEAR_MS = 1_150;
/** Multiple hunks this close together are centered as one viewport target. */
export const AI_DIFF_FIT_VIEWPORTS = 1.4;
/** Deleted text shown inline before a "+N chars" suffix. */
export const AI_DIFF_DELETE_LIMIT = 600;
/** A second pane mounted this soon is part of the same entrance, not a replay. */
export const AI_DIFF_JOIN_ANIMATION_MS = 120;
const MAX_FALLBACK_SPANS = 160;
const MAX_FLASH_CLAIMS = 64;

export interface AiDiffHunk {
  /** Start offset in the new text. */
  start: number;
  /** End offset in the new text; equal to `start` for a pure deletion. */
  end: number;
  changes: AiTextChange[];
  deletedChars: number;
  insertedChars: number;
}

/**
 * Group the raw change stream into places. A replacement arrives as a
 * zero-width delete followed by an insert at the same anchor, so those become
 * one hunk; separated deletions, even one character apart, stay separate.
 */
export function groupAiDiffHunks(changes: readonly AiTextChange[]): AiDiffHunk[] {
  const hunks: AiDiffHunk[] = [];

  for (const change of changes) {
    const previous = hunks[hunks.length - 1];
    const touchesPrevious = previous !== undefined && (
      change.start <= previous.end
      // A replacement can split into two insert runs around one unchanged
      // space ("Section" -> "Updated section"). That is one place, not two.
      // Pure deletions one character apart stay separate.
      || (
        change.start === previous.end + 1
        && (change.type === 'insert' || previous.insertedChars > 0)
      )
    );
    if (touchesPrevious) {
      previous.end = Math.max(previous.end, change.end);
      previous.changes.push(change);
      if (change.type === 'delete') previous.deletedChars += change.text.length;
      else previous.insertedChars += change.text.length;
      continue;
    }

    hunks.push({
      start: change.start,
      end: change.end,
      changes: [change],
      deletedChars: change.type === 'delete' ? change.text.length : 0,
      insertedChars: change.type === 'insert' ? change.text.length : 0,
    });
  }

  return hunks;
}

export interface AiDiffSummary {
  hunkCount: number;
  deletedChars: number;
  insertedChars: number;
}

export function summarizeAiDiff(changes: readonly AiTextChange[]): AiDiffSummary {
  let hunkCount = 0;
  let deletedChars = 0;
  let insertedChars = 0;
  for (const hunk of groupAiDiffHunks(changes)) {
    hunkCount += 1;
    deletedChars += hunk.deletedChars;
    insertedChars += hunk.insertedChars;
  }
  return { hunkCount, deletedChars, insertedChars };
}

/** Copy for the one-line banner that survives while later hunks are offscreen. */
export function aiDiffSummaryLabel(hunkCount: number): string {
  if (hunkCount <= 1) return 'Nana changed this note';
  return `Nana changed ${hunkCount} places`;
}

export interface AiDiffDeleteText {
  display: string;
  truncated: boolean;
  omitted: number;
}

/**
 * Bound a deletion widget without hiding the fact that more was removed. The
 * same string is used by CodeMirror and ProseMirror so both panes agree.
 */
export function formatAiDiffDeleteText(
  text: string,
  limit = AI_DIFF_DELETE_LIMIT,
): AiDiffDeleteText {
  const safeLimit = Math.max(0, Math.floor(limit));
  if (text.length <= safeLimit) {
    return { display: text, truncated: false, omitted: 0 };
  }

  const omitted = text.length - safeLimit;
  const head = text.slice(0, safeLimit);
  return {
    display: `${head}${head ? '… ' : ''}+${omitted} chars`,
    truncated: true,
    omitted,
  };
}

export interface AiDiffScrollHunk {
  /** Top in the scroll container's document coordinates. */
  top: number;
  /** Bottom in the scroll container's document coordinates. */
  bottom: number;
  /**
   * True when this hunk contains inserted text or a structural insertion.
   * Far-apart hunks prefer the first insertion so the green addition is the
   * one the user sees; a deletion-only set keeps the original first hunk.
   */
  hasInsert?: boolean;
}

export interface AiDiffScrollTargetInput {
  hunks: readonly AiDiffScrollHunk[];
  viewportHeight: number;
  maxScrollTop: number;
  fitViewportFactor?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * One hunk centers itself. Nearby hunks that fit in ~1.4 viewports center their
 * union so both are visible. Far-apart hunks keep an addition in view when
 * there is one, because the green side is what the edit produced; a
 * deletion-only set keeps the first hunk. The banner counts the rest.
 */
export function pickAiDiffScrollTarget(input: AiDiffScrollTargetInput): number {
  const viewportHeight = Math.max(1, input.viewportHeight);
  const hunks = input.hunks.filter(
    (hunk) => Number.isFinite(hunk.top) && Number.isFinite(hunk.bottom),
  );
  const first = hunks[0];
  if (!first) return 0;

  let unionTop = first.top;
  let unionBottom = first.bottom;
  for (const hunk of hunks) {
    unionTop = Math.min(unionTop, hunk.top);
    unionBottom = Math.max(unionBottom, hunk.bottom);
  }

  const fitViewports = input.fitViewportFactor ?? AI_DIFF_FIT_VIEWPORTS;
  const unionHeight = Math.max(0, unionBottom - unionTop);
  const target = hunks.length === 1 || unionHeight <= viewportHeight * fitViewports
    ? { top: unionTop, bottom: unionBottom }
    : hunks.find((hunk) => hunk.hasInsert) ?? first;

  const center = (target.top + target.bottom) / 2;
  return clamp(center - viewportHeight / 2, 0, input.maxScrollTop);
}

export interface AiDiffTextSpan {
  start: number;
  end: number;
}

/**
 * Text-level ranges for a diff-derived wash when the server section metadata is
 * absent or the inline diff is too large. Pure deletion hunks expand by one
 * character so they still map to a block; if the change list is empty or very
 * scattered, the whole body is marked (the ProseMirror mapper bounds blocks).
 */
export function aiDiffFallbackSpans(
  changes: readonly AiTextChange[],
  textLength: number,
  maxSpans = MAX_FALLBACK_SPANS,
): AiDiffTextSpan[] {
  const length = Math.max(0, Math.floor(textLength));
  if (length === 0) return [];

  const spans: AiDiffTextSpan[] = [];
  for (const hunk of groupAiDiffHunks(changes)) {
    let start = clamp(hunk.start, 0, length);
    let end = clamp(hunk.end, 0, length);
    if (end <= start) {
      if (start < length) end = start + 1;
      else if (start > 0) start = start - 1;
      else continue;
    }

    const previous = spans[spans.length - 1];
    if (previous && start <= previous.end) {
      previous.end = Math.max(previous.end, end);
    } else {
      spans.push({ start, end });
    }
  }

  if (spans.length === 0 || spans.length > Math.max(1, maxSpans)) {
    return [{ start: 0, end: length }];
  }
  return spans;
}

export type AiDiffPane = 'source' | 'wysiwyg';

export interface AiDiffFlashClaim {
  /** False when the pane is joining a flash that already started. */
  animate: boolean;
  /** Remaining decoration lifespan, in milliseconds. */
  duration: number;
  startedAt: number;
}

const flashStarts = new Map<string, number>();
const paneClaims = new Map<string, number>();

function pruneFlashClaims(now: number): void {
  for (const [key, startedAt] of flashStarts) {
    if (now - startedAt >= AI_DIFF_CLEAR_MS * 4) flashStarts.delete(key);
  }
  for (const [key, claimedAt] of paneClaims) {
    if (now - claimedAt >= AI_DIFF_CLEAR_MS * 4) paneClaims.delete(key);
  }
  while (flashStarts.size >= MAX_FLASH_CLAIMS) {
    const oldest = flashStarts.keys().next().value;
    if (oldest === undefined) break;
    flashStarts.delete(oldest);
  }
  while (paneClaims.size >= MAX_FLASH_CLAIMS * 2) {
    const oldest = paneClaims.keys().next().value;
    if (oldest === undefined) break;
    paneClaims.delete(oldest);
  }
}

/**
 * Shared start time per edit, with per-pane claims. Both panes animate when
 * they mount together in split view. A pane that enters later, or remounts
 * after a view switch, paints the remaining wash without replaying the
 * entrance from zero; after the clear window it paints nothing.
 */
export function claimAiDiffFlash(
  pane: AiDiffPane,
  editId: string,
  now = Date.now(),
): AiDiffFlashClaim | null {
  if (!editId) {
    return { animate: true, duration: AI_DIFF_CLEAR_MS, startedAt: now };
  }

  pruneFlashClaims(now);
  const paneKey = `${pane}\u0000${editId}`;
  const alreadyClaimed = paneClaims.has(paneKey);
  const startedAt = flashStarts.get(editId);

  if (startedAt === undefined) {
    flashStarts.set(editId, now);
    paneClaims.set(paneKey, now);
    return { animate: true, duration: AI_DIFF_CLEAR_MS, startedAt: now };
  }

  const elapsed = Math.max(0, now - startedAt);
  if (elapsed >= AI_DIFF_CLEAR_MS) return null;
  if (!alreadyClaimed) paneClaims.set(paneKey, now);

  return {
    animate: !alreadyClaimed && elapsed <= AI_DIFF_JOIN_ANIMATION_MS,
    duration: AI_DIFF_CLEAR_MS - elapsed,
    startedAt,
  };
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

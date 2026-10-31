/**
 * Canonical Markdown operations for live editor bindings.
 *
 * The canonical document is one `Y.Text` containing Markdown. Native editors
 * (ProseMirror and CodeMirror) publish ordered operations instead of replacing
 * the full snapshot, so a transaction can be applied without diffing the whole
 * document and without moving another writer's caret.
 *
 * Conventions:
 *
 * - Offsets are UTF-16 code-unit indices, matching JavaScript strings,
 *   ProseMirror positions, CodeMirror offsets, and Y.Text indexes.
 * - A list of operations is applied left to right. Every index refers to the
 *   document as it exists after all preceding operations, matching
 *   `Y.Text.insert` / `Y.Text.delete`.
 * - Operations are clamped to the current document. An index inside a
 *   surrogate pair moves to the start of that pair; a deletion boundary inside
 *   a pair widens to include the whole pair. Malformed operations are ignored.
 *
 * This module is pure and must stay importable from both the browser and Bun.
 */

import { minimalTextChange, type TextChange } from './text';

/** One transaction-level edit against the canonical Markdown text. */
export type CanonicalOp =
  | { type: 'insert'; index: number; text: string }
  | { type: 'delete'; index: number; length: number };

/**
 * The slice of `Y.Text` the operation helpers use. Keeping this structural
 * avoids importing Yjs in pure tests and in callers that only need strings.
 */
export interface YTextLike {
  readonly length: number;
  toString(): string;
  insert(index: number, text: string): void;
  delete(index: number, length: number): void;
}

/** One CodeMirror-style change. CodeMirror `Text` insert values stringify. */
export interface CodeMirrorChange {
  from: number;
  to?: number;
  insert?: string | { toString(): string };
}

/** CodeMirror accepts nested arrays of changes; flattening is supported here. */
export type CodeMirrorChangeInput = CodeMirrorChange | readonly CodeMirrorChangeInput[];

const MAX_FLATTEN_DEPTH = 16;

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function splitsSurrogatePair(value: string, index: number): boolean {
  return index > 0
    && index < value.length
    && isHighSurrogate(value.charCodeAt(index - 1))
    && isLowSurrogate(value.charCodeAt(index));
}

/** Move an index that points between two surrogate halves to the pair start. */
function snapIndexBack(value: string, index: number): number {
  let next = index;
  while (splitsSurrogatePair(value, next)) next -= 1;
  return next;
}

/** Move an exclusive end that points between two surrogate halves past the pair. */
function snapIndexForward(value: string, index: number): number {
  let next = index;
  while (splitsSurrogatePair(value, next)) next += 1;
  return next;
}

function clampIndex(value: number, maximum: number): number {
  return Math.max(0, Math.min(Math.trunc(value), maximum));
}

function currentString(value: string | YTextLike): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || typeof value.toString !== 'function') return '';
  const text = value.toString();
  return typeof text === 'string' ? text : '';
}

/** Structural validation without clamping. No-ops are structurally valid. */
export function validateOp(value: unknown): value is CanonicalOp {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as {
    type?: unknown;
    index?: unknown;
    text?: unknown;
    length?: unknown;
  };
  if (candidate.type === 'insert') {
    return isNonNegativeInteger(candidate.index) && typeof candidate.text === 'string';
  }
  if (candidate.type === 'delete') {
    return isNonNegativeInteger(candidate.index) && isNonNegativeInteger(candidate.length);
  }
  return false;
}

/** Runtime guard for the string/Y.Text contract used by `applyOp`. */
export function isYTextLike(value: unknown): value is YTextLike {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<YTextLike>;
  return typeof candidate.length === 'number'
    && typeof candidate.toString === 'function'
    && typeof candidate.insert === 'function'
    && typeof candidate.delete === 'function';
}

/**
 * Clamp one operation to a document of `length` code units.
 *
 * Length-only normalization cannot inspect surrogate pairs; `applyOp`,
 * `applyOps`, `invertOp`, and `invertOps` use the actual text and widen
 * boundaries there. Returns `null` for malformed input and for no-ops.
 */
export function normalizeOp(
  op: CanonicalOp | null | undefined,
  length: number,
): CanonicalOp | null {
  if (!op || typeof op !== 'object') return null;
  const maximum = Number.isFinite(length) ? Math.max(0, Math.trunc(length)) : 0;

  if (op.type === 'insert') {
    if (!Number.isFinite(op.index) || typeof op.text !== 'string' || op.text.length === 0) {
      return null;
    }
    return { type: 'insert', index: clampIndex(op.index, maximum), text: op.text };
  }

  if (op.type === 'delete') {
    if (!Number.isFinite(op.index) || !Number.isFinite(op.length) || op.length <= 0) {
      return null;
    }
    const rawIndex = clampIndex(op.index, maximum);
    const rawEnd = Math.min(maximum, rawIndex + Math.max(0, Math.trunc(op.length)));
    if (rawEnd <= rawIndex) return null;

    // The surrogate helpers need the text, not just its length. Callers that
    // have the string use `normalizeOpAgainst`; this branch only clamps.
    return {
      type: 'delete',
      index: rawIndex,
      length: rawEnd - rawIndex,
    };
  }

  return null;
}

/**
 * Normalize against the actual document so delete boundaries can expand over
 * surrogate pairs. Prefer this over `normalizeOp` when the text is available.
 */
function normalizeOpAgainst(op: CanonicalOp | null | undefined, text: string): CanonicalOp | null {
  if (!op || typeof op !== 'object') return null;

  if (op.type === 'insert') {
    if (!Number.isFinite(op.index) || typeof op.text !== 'string' || op.text.length === 0) {
      return null;
    }
    const index = snapIndexBack(text, clampIndex(op.index, text.length));
    return { type: 'insert', index, text: op.text };
  }

  if (op.type === 'delete') {
    if (!Number.isFinite(op.index) || !Number.isFinite(op.length) || op.length <= 0) {
      return null;
    }
    const start = clampIndex(op.index, text.length);
    if (start >= text.length) return null;
    const end = Math.min(text.length, start + Math.max(0, Math.trunc(op.length)));
    if (end <= start) return null;

    const snappedStart = snapIndexBack(text, start);
    const snappedEnd = Math.max(snappedStart, snapIndexForward(text, end));
    if (snappedEnd <= snappedStart) return null;
    return { type: 'delete', index: snappedStart, length: snappedEnd - snappedStart };
  }

  return null;
}

function applyNormalizedToString(document: string, op: CanonicalOp): string {
  if (op.type === 'insert') {
    return document.slice(0, op.index) + op.text + document.slice(op.index);
  }
  return document.slice(0, op.index) + document.slice(op.index + op.length);
}

/** Apply one canonical operation to a string. */
export function applyOp(document: string, op: CanonicalOp): string;
/** Apply one canonical operation to a Y.Text-like value. */
export function applyOp(target: YTextLike, op: CanonicalOp): void;
export function applyOp(
  target: string | YTextLike | null | undefined,
  op: CanonicalOp | null | undefined,
): string | void {
  if (typeof target === 'string') {
    const normalized = normalizeOpAgainst(op, target);
    return normalized ? applyNormalizedToString(target, normalized) : target;
  }
  if (!isYTextLike(target)) return;

  const current = currentString(target);
  const normalized = normalizeOpAgainst(op, current);
  if (!normalized) return;
  if (normalized.type === 'insert') {
    target.insert(normalized.index, normalized.text);
  } else {
    target.delete(normalized.index, normalized.length);
  }
}

/** Apply ordered canonical operations to a string. */
export function applyOps(document: string, ops: readonly CanonicalOp[]): string;
/** Apply ordered canonical operations to a Y.Text-like value. */
export function applyOps(target: YTextLike, ops: readonly CanonicalOp[]): void;
export function applyOps(
  target: string | YTextLike | null | undefined,
  ops: readonly CanonicalOp[] | null | undefined,
): string | void {
  if (typeof target === 'string') {
    if (!Array.isArray(ops)) return target;
    let next = target;
    for (const op of ops) {
      const normalized = normalizeOpAgainst(op, next);
      if (normalized) next = applyNormalizedToString(next, normalized);
    }
    return next;
  }
  if (!isYTextLike(target) || !Array.isArray(ops)) return;
  for (const op of ops) {
    const current = currentString(target);
    const normalized = normalizeOpAgainst(op, current);
    if (!normalized) continue;
    if (normalized.type === 'insert') {
      target.insert(normalized.index, normalized.text);
    } else {
      target.delete(normalized.index, normalized.length);
    }
  }
}

/**
 * Convert one text splice into the canonical operation sequence.
 *
 * A replacement is a delete followed by an insert at the same index, because
 * `CanonicalOp` deliberately has no combined replace form. Returns an empty
 * array for a no-op or malformed change.
 */
export function opsFromTextChange(change: TextChange | null | undefined): CanonicalOp[] {
  if (!change || typeof change !== 'object' || !Number.isFinite(change.from)) return [];

  const index = Math.max(0, Math.trunc(change.from));
  const end = Number.isFinite(change.to) ? Math.max(index, Math.trunc(change.to)) : index;
  const insert = typeof change.insert === 'string' ? change.insert : '';
  const ops: CanonicalOp[] = [];
  if (end > index) ops.push({ type: 'delete', index, length: end - index });
  if (insert) ops.push({ type: 'insert', index, text: insert });
  return ops;
}

/** Build ordered operations for the smallest splice between two strings. */
export function opsFromMinimalTextChange(current: string, next: string): CanonicalOp[] {
  if (typeof current !== 'string' || typeof next !== 'string' || current === next) return [];
  return opsFromTextChange(minimalTextChange(current, next));
}

function flattenCodeMirrorChanges(
  input: CodeMirrorChangeInput | null | undefined,
  output: CodeMirrorChange[],
  depth: number,
): void {
  if (depth > MAX_FLATTEN_DEPTH || input === null || input === undefined) return;
  if (Array.isArray(input)) {
    for (const item of input) flattenCodeMirrorChanges(item, output, depth + 1);
    return;
  }
  if (typeof input === 'object') output.push(input as CodeMirrorChange);
}

function codeMirrorInsertText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  const candidate = value as { toString?: unknown };
  if (typeof candidate.toString !== 'function') return '';
  try {
    const text = candidate.toString();
    return typeof text === 'string' ? text : '';
  } catch {
    return '';
  }
}

interface PreparedCodeMirrorChange {
  from: number;
  to: number;
  insert: string;
  order: number;
}

/**
 * Convert CodeMirror transaction changes into sequential canonical operations.
 *
 * CodeMirror positions refer to the document before the transaction, while
 * canonical operation indexes refer to the evolving document. This adjusts each
 * later change by the length delta of the earlier ones. Missing `to` values are
 * collapsed insertions, missing `insert` values are deletions, and `insert`
 * objects (CodeMirror `Text`) are accepted through `toString`.
 *
 * Changes are sorted by `from`. Overlapping changes are not guessed at and are
 * skipped; malformed changes are ignored. Pass `documentLength` to clamp ranges
 * that come from an untrusted source.
 */
export function opsFromCodeMirrorChanges(
  changes: CodeMirrorChangeInput | null | undefined,
  documentLength?: number,
): CanonicalOp[] {
  const raw: CodeMirrorChange[] = [];
  flattenCodeMirrorChanges(changes, raw, 0);
  if (raw.length === 0) return [];

  const maximum = typeof documentLength === 'number' && Number.isFinite(documentLength)
    ? Math.max(0, Math.trunc(documentLength))
    : Number.POSITIVE_INFINITY;

  const prepared: PreparedCodeMirrorChange[] = [];
  raw.forEach((change, order) => {
    if (!change || typeof change !== 'object' || !Number.isFinite(change.from)) return;
    const rawFrom = Math.max(0, Math.trunc(change.from));
    const rawTo = Number.isFinite(change.to) ? Math.trunc(change.to as number) : rawFrom;
    const from = Math.min(rawFrom, maximum);
    const to = Math.min(Math.max(from, rawTo), maximum);
    prepared.push({
      from,
      to,
      insert: codeMirrorInsertText(change.insert),
      order,
    });
  });

  prepared.sort((left, right) => left.from - right.from || left.order - right.order);

  const ops: CanonicalOp[] = [];
  let delta = 0;
  let previousEnd = -1;
  for (const change of prepared) {
    if (change.from < previousEnd) continue;
    previousEnd = change.to;

    const index = change.from + delta;
    if (change.to > change.from) {
      ops.push({ type: 'delete', index, length: change.to - change.from });
    }
    if (change.insert) {
      ops.push({ type: 'insert', index, text: change.insert });
    }
    delta += change.insert.length - (change.to - change.from);
  }
  return ops;
}

/**
 * Merge operations that are adjacent in the evolving document.
 *
 * Insertions merge only when the later insertion lands at the insertion point
 * (before the existing text) or immediately after it. Deletions merge when the
 * later deletion starts at the same collapsed point or immediately after the
 * deleted range. Other pairs stay separate because merging would change where
 * untouched text moves.
 */
export function mergeAdjacentOps(ops: readonly CanonicalOp[]): CanonicalOp[] {
  if (!Array.isArray(ops)) return [];
  const merged: CanonicalOp[] = [];

  for (const op of ops) {
    if (!validateOp(op)) continue;
    if (op.type === 'insert' && op.text.length === 0) continue;
    if (op.type === 'delete' && op.length === 0) continue;

    const previous = merged[merged.length - 1];
    if (previous?.type === 'insert' && op.type === 'insert') {
      if (op.index === previous.index + previous.text.length) {
        previous.text += op.text;
        continue;
      }
      if (op.index === previous.index) {
        previous.text = op.text + previous.text;
        continue;
      }
    }
    if (previous?.type === 'delete' && op.type === 'delete') {
      if (op.index === previous.index || op.index === previous.index + previous.length) {
        previous.length += op.length;
        continue;
      }
    }

    merged.push(op.type === 'insert'
      ? { type: 'insert', index: op.index, text: op.text }
      : { type: 'delete', index: op.index, length: op.length });
  }

  return merged;
}

/** Invert one operation against the document it applies to. */
export function invertOp(document: string | YTextLike, op: CanonicalOp): CanonicalOp | null {
  const source = currentString(document);
  const normalized = normalizeOpAgainst(op, source);
  if (!normalized) return null;

  if (normalized.type === 'insert') {
    return { type: 'delete', index: normalized.index, length: normalized.text.length };
  }
  return {
    type: 'insert',
    index: normalized.index,
    text: source.slice(normalized.index, normalized.index + normalized.length),
  };
}

/**
 * Invert an ordered operation list against its starting document.
 *
 * The result is ordered for replay on the final document: later operations are
 * undone first. The input document may be a string or a Y.Text-like snapshot.
 */
export function invertOps(
  document: string | YTextLike,
  ops: readonly CanonicalOp[],
): CanonicalOp[] {
  if (!Array.isArray(ops)) return [];
  let working = currentString(document);
  const inverses: CanonicalOp[] = [];

  for (const op of ops) {
    const normalized = normalizeOpAgainst(op, working);
    if (!normalized) continue;
    if (normalized.type === 'insert') {
      inverses.push({ type: 'delete', index: normalized.index, length: normalized.text.length });
      working = applyNormalizedToString(working, normalized);
      continue;
    }
    inverses.push({
      type: 'insert',
      index: normalized.index,
      text: working.slice(normalized.index, normalized.index + normalized.length),
    });
    working = applyNormalizedToString(working, normalized);
  }

  return inverses.reverse();
}

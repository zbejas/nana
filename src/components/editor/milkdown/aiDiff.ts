/**
 * Small token diff for the AI-edit flash. It intentionally stays local to the
 * editor: the server already knows which sections changed, but the client needs
 * the actual inserted/deleted text to paint a GitHub-style in-place diff.
 */

export interface AiTextChange {
  type: 'insert' | 'delete';
  /** Offset in the new text. Deletions are anchored at the insertion point. */
  start: number;
  /** End offset in the new text for inserts; equal to `start` for deletes. */
  end: number;
  text: string;
}

interface Token {
  text: string;
  start: number;
}

const MAX_DIFF_CHARS = 120_000;
const MAX_DP_CELLS = 250_000;
/**
 * Myers is linear in the number of edits rather than the product of the token
 * counts. These bounds keep a genuinely pathological rewrite (an all-new body)
 * on the one-replacement fallback instead of spending seconds and megabytes on
 * a trace that the flash cannot show meaningfully anyway.
 */
const MAX_MYERS_EDIT_DISTANCE = 1_024;
const MAX_MYERS_TRACE_CELLS = 6_000_000;

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /\s+|\S+/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    tokens.push({ text: match[0], start: match.index });
  }
  return tokens;
}

function trimVisibleText(text: string): { text: string; leading: number; trailing: number } {
  const leading = text.match(/^\s*/)?.[0].length ?? 0;
  const trailing = text.match(/\s*$/)?.[0].length ?? 0;
  if (leading + trailing >= text.length) return { text: '', leading: 0, trailing: 0 };
  return {
    text: text.slice(leading, text.length - trailing),
    leading,
    trailing,
  };
}

function appendChange(changes: AiTextChange[], change: AiTextChange): void {
  if (!change.text) return;
  const previous = changes[changes.length - 1];
  if (
    previous
    && previous.type === change.type
    && (
      (change.type === 'insert' && previous.end === change.start)
      || (change.type === 'delete' && previous.start === change.start)
    )
  ) {
    previous.text += change.text;
    if (change.type === 'insert') previous.end = change.end;
    return;
  }
  changes.push(change);
}

interface TokenOp {
  type: 'equal' | 'insert' | 'delete';
  token: Token;
}

/**
 * Backtrack a Myers trace into token operations. Every snapshot is the full
 * furthest-reaching diagonal array after edit depth `d`; diagonals with the
 * opposite parity still hold their `d - 1` value, which is what the predecessor
 * choice reads.
 */
function opsFromMyersTrace(
  snapshots: readonly Int32Array[],
  left: readonly Token[],
  right: readonly Token[],
  offset: number,
): TokenOp[] {
  const ops: TokenOp[] = [];
  let x = left.length;
  let y = right.length;

  for (let depth = snapshots.length - 1; depth >= 0; depth -= 1) {
    const furthest = snapshots[depth]!;
    const diagonal = x - y;
    let previousDiagonal = 0;

    if (depth > 0) {
      const down = furthest[offset + diagonal + 1] ?? 0;
      const rightward = furthest[offset + diagonal - 1] ?? 0;
      previousDiagonal = diagonal === -depth || (diagonal !== depth && rightward < down)
        ? diagonal + 1
        : diagonal - 1;
    }

    const previousX = depth === 0 ? 0 : (furthest[offset + previousDiagonal] ?? 0);
    const previousY = depth === 0 ? 0 : previousX - previousDiagonal;

    while (x > previousX && y > previousY) {
      x -= 1;
      y -= 1;
      ops.push({ type: 'equal', token: right[y]! });
    }
    if (depth === 0) break;

    if (x === previousX) {
      y -= 1;
      ops.push({ type: 'insert', token: right[y]! });
    } else {
      x -= 1;
      ops.push({ type: 'delete', token: left[x]! });
    }
  }

  ops.reverse();
  return ops;
}

/**
 * Myers O((N + M)D) shortest edit script. Prefix/suffix trimming usually leaves
 * only the changed span, so a 5–10k-character note with a handful of edits
 * needs a few hundred diagonals, not millions of LCS cells. Returns null when
 * the edit distance or the trace budget is exceeded; the caller then uses the
 * last-resort whole-replacement pair.
 */
function myersOps(left: Token[], right: Token[]): TokenOp[] | null {
  const n = left.length;
  const m = right.length;
  const maximum = n + m;
  // Each snapshot is the full furthest-reaching array (2 * maximum + 1 ints).
  const traceBudget = Math.floor(MAX_MYERS_TRACE_CELLS / (maximum * 2 + 1)) - 1;
  const limit = Math.min(maximum, MAX_MYERS_EDIT_DISTANCE, traceBudget);
  if (limit < 1) return null;

  const offset = maximum;
  const furthest = new Int32Array(maximum * 2 + 1);
  const snapshots: Int32Array[] = [];

  for (let depth = 0; depth <= limit; depth += 1) {
    for (let diagonal = -depth; diagonal <= depth; diagonal += 2) {
      const down = furthest[offset + diagonal + 1] ?? 0;
      const rightward = (furthest[offset + diagonal - 1] ?? 0) + 1;
      let x = diagonal === -depth || (diagonal !== depth && (furthest[offset + diagonal - 1] ?? 0) < down)
        ? down
        : rightward;
      let y = x - diagonal;

      while (x < n && y < m && left[x]!.text === right[y]!.text) {
        x += 1;
        y += 1;
      }
      furthest[offset + diagonal] = x;

      if (x >= n && y >= m) {
        snapshots.push(furthest.slice());
        return opsFromMyersTrace(snapshots, left, right, offset);
      }
    }
    snapshots.push(furthest.slice());
  }

  return null;
}

function middleOps(left: Token[], right: Token[]): TokenOp[] {
  const n = left.length;
  const m = right.length;
  if (n === 0) return right.map((token) => ({ type: 'insert', token }));
  if (m === 0) return left.map((token) => ({ type: 'delete', token }));

  // A full LCS is cheap after common prefixes/suffixes are removed and keeps
  // the small-edit tie-breaking stable. Longer middles use Myers; only a
  // rewrite beyond both bounds becomes one red/green replacement block.
  if (n * m > MAX_DP_CELLS) {
    const ops = myersOps(left, right);
    if (ops) return ops;
    return [
      ...left.map((token): TokenOp => ({ type: 'delete', token })),
      ...right.map((token): TokenOp => ({ type: 'insert', token })),
    ];
  }

  const width = m + 1;
  const dp = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i * width + j] = left[i]!.text === right[j]!.text
        ? dp[(i + 1) * width + j + 1]! + 1
        : Math.max(dp[(i + 1) * width + j]!, dp[i * width + j + 1]!);
    }
  }

  const ops: TokenOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && left[i]!.text === right[j]!.text) {
      // Equal tokens must stay in the stream: their right-side offsets move
      // every later hunk forward. Dropping them made every deletion after the
      // first reuse the first hunk's new-text anchor.
      ops.push({ type: 'equal', token: right[j]! });
      i += 1;
      j += 1;
      continue;
    }
    const rightScore = j < m ? dp[i * width + j + 1]! : -1;
    const downScore = i < n ? dp[(i + 1) * width + j]! : -1;
    if (j < m && (i === n || rightScore > downScore)) {
      ops.push({ type: 'insert', token: right[j]! });
      j += 1;
    } else {
      ops.push({ type: 'delete', token: left[i]! });
      i += 1;
    }
  }
  return ops;
}

/**
 * Word/token diff with whitespace-aware offsets. Changes are returned in new
 * text order: inserts carry their range; deletes are zero-width anchors.
 */
export function diffText(previous: string, next: string): AiTextChange[] {
  if (previous === next) return [];
  if (previous.length > MAX_DIFF_CHARS || next.length > MAX_DIFF_CHARS) return [];

  const left = tokenize(previous);
  const right = tokenize(next);
  let prefix = 0;
  while (
    prefix < left.length
    && prefix < right.length
    && left[prefix]!.text === right[prefix]!.text
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < left.length - prefix
    && suffix < right.length - prefix
    && left[left.length - 1 - suffix]!.text === right[right.length - 1 - suffix]!.text
  ) {
    suffix += 1;
  }

  const leftMiddle = left.slice(prefix, left.length - suffix);
  const rightMiddle = right.slice(prefix, right.length - suffix);
  if (leftMiddle.length === 0 && rightMiddle.length === 0) return [];

  const ops = middleOps(leftMiddle, rightMiddle);
  let newOffset = prefix < right.length
    ? right[prefix]!.start
    : next.length;
  const changes: AiTextChange[] = [];

  let index = 0;
  while (index < ops.length) {
    const op = ops[index]!;

    if (op.type === 'equal') {
      // Unchanged text still occupies the new body. Advance to its end so the
      // next hunk is anchored after it, not back at the start of the gap.
      newOffset = op.token.start + op.token.text.length;
      index += 1;
      continue;
    }

    if (op.type === 'insert') {
      // Tokens inside one run are contiguous in the new body. Concatenate
      // before trimming so spaces/newlines between inserted words survive;
      // only the run's outer edges are dropped.
      const runStart = op.token.start;
      let raw = '';
      let runEnd = runStart;
      while (index < ops.length && ops[index]!.type === 'insert') {
        const token = ops[index]!.token;
        raw += token.text;
        runEnd = token.start + token.text.length;
        index += 1;
      }

      const trimmed = trimVisibleText(raw);
      if (trimmed.text) {
        const start = runStart + trimmed.leading;
        appendChange(changes, {
          type: 'insert',
          start,
          end: start + trimmed.text.length,
          text: trimmed.text,
        });
      }
      newOffset = runEnd;
      continue;
    }

    // Deletes are zero-width anchors in the new text. Group the whole run
    // first: a deleted paragraph is several whitespace/word tokens, and
    // trimming each token individually loses the spaces between words.
    const anchor = newOffset;
    let raw = '';
    while (index < ops.length && ops[index]!.type === 'delete') {
      raw += ops[index]!.token.text;
      index += 1;
    }

    const trimmed = trimVisibleText(raw);
    if (trimmed.text) {
      appendChange(changes, {
        type: 'delete',
        start: anchor,
        end: anchor,
        text: trimmed.text,
      });
    }
  }

  return changes;
}

/** Total visible characters changed; used to avoid painting a whole rewrite. */
export function changedCharacterCount(changes: readonly AiTextChange[]): number {
  return changes.reduce((total, change) => total + change.text.length, 0);
}

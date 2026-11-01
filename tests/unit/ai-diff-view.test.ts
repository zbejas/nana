import { describe, expect, test } from 'bun:test';
import type { AiTextChange } from '../../src/components/editor/milkdown/aiDiff';
import {
  AI_DIFF_CLEAR_MS,
  AI_DIFF_DELETE_LIMIT,
  AI_DIFF_FLASH_MS,
  aiDiffFallbackSpans,
  aiDiffSummaryLabel,
  claimAiDiffFlash,
  formatAiDiffDeleteText,
  groupAiDiffHunks,
  pickAiDiffScrollTarget,
  summarizeAiDiff,
} from '../../src/components/editor/milkdown/aiDiffView';

function deleteAt(start: number, text: string): AiTextChange {
  return { type: 'delete', start, end: start, text };
}

function insertAt(start: number, text: string): AiTextChange {
  return { type: 'insert', start, end: start + text.length, text };
}

describe('AI diff hunk presentation', () => {
  test('groups a replacement at one anchor into one hunk', () => {
    const hunks = groupAiDiffHunks([
      deleteAt(10, 'old'),
      insertAt(10, 'new'),
      deleteAt(40, 'later'),
      insertAt(40, 'then'),
    ]);

    expect(hunks).toHaveLength(2);
    expect(hunks[0]).toMatchObject({
      start: 10,
      end: 13,
      deletedChars: 3,
      insertedChars: 3,
    });
    expect(hunks[0]!.changes).toHaveLength(2);
    expect(hunks[1]).toMatchObject({ start: 40, end: 44 });
    expect(summarizeAiDiff([
      deleteAt(10, 'old'),
      insertAt(10, 'new'),
      deleteAt(40, 'later'),
      insertAt(40, 'then'),
    ])).toEqual({ hunkCount: 2, deletedChars: 8, insertedChars: 7 });
  });

  test('keeps deletions one character apart distinct and joins insert runs around one space', () => {
    expect(groupAiDiffHunks([deleteAt(5, 'a'), deleteAt(6, 'b')])).toHaveLength(2);

    const splitInsert = groupAiDiffHunks([
      insertAt(5, 'Updated'),
      insertAt(13, 'section'),
    ]);
    expect(splitInsert).toHaveLength(1);
    expect(splitInsert[0]).toMatchObject({ start: 5, end: 20, insertedChars: 14 });
  });

  test('labels the visible multi-hunk summary', () => {
    expect(aiDiffSummaryLabel(3)).toBe('Nana changed 3 places');
    expect(aiDiffSummaryLabel(1)).toBe('Nana changed this note');
  });
});

describe('AI diff scroll target', () => {
  test('centers a single hunk', () => {
    expect(pickAiDiffScrollTarget({
      hunks: [{ top: 400, bottom: 420 }],
      viewportHeight: 200,
      maxScrollTop: 2_000,
    })).toBe(310);
  });

  test('centers the union of nearby hunks that fit in one view', () => {
    expect(pickAiDiffScrollTarget({
      hunks: [
        { top: 100, bottom: 160 },
        { top: 300, bottom: 400 },
      ],
      viewportHeight: 300,
      maxScrollTop: 2_000,
    })).toBe(100);
  });

  test('targets the first hunk when later hunks are far apart', () => {
    expect(pickAiDiffScrollTarget({
      hunks: [
        { top: 100, bottom: 200 },
        { top: 1_000, bottom: 1_100 },
      ],
      viewportHeight: 300,
      maxScrollTop: 2_000,
    })).toBe(0);
  });

  test('clamps to the scroll range and tolerates an empty change set', () => {
    expect(pickAiDiffScrollTarget({
      hunks: [{ top: 900, bottom: 980 }],
      viewportHeight: 200,
      maxScrollTop: 300,
    })).toBe(300);
    expect(pickAiDiffScrollTarget({
      hunks: [],
      viewportHeight: 200,
      maxScrollTop: 300,
    })).toBe(0);
  });
});

describe('AI diff fallback spans', () => {
  test('covers the whole body when no changes were computed', () => {
    expect(aiDiffFallbackSpans([], 500)).toEqual([{ start: 0, end: 500 }]);
    expect(aiDiffFallbackSpans([], 0)).toEqual([]);
  });

  test('maps separated diff hunks to bounded text spans', () => {
    expect(aiDiffFallbackSpans([
      deleteAt(20, 'remove'),
      insertAt(200, 'new words'),
    ], 500)).toEqual([
      { start: 20, end: 21 },
      { start: 200, end: 209 },
    ]);
  });

  test('expands a deletion at the end back to the last character', () => {
    expect(aiDiffFallbackSpans([deleteAt(100, 'tail')], 100)).toEqual([
      { start: 99, end: 100 },
    ]);
  });

  test('uses one whole-body span when changes are too scattered to bound', () => {
    const changes = [deleteAt(10, 'a'), deleteAt(20, 'b'), deleteAt(30, 'c')];
    expect(aiDiffFallbackSpans(changes, 100, 2)).toEqual([{ start: 0, end: 100 }]);
  });
});

describe('AI diff deletion truncation', () => {
  test('keeps short deletions intact', () => {
    expect(formatAiDiffDeleteText('short')).toEqual({
      display: 'short',
      truncated: false,
      omitted: 0,
    });
  });

  test('marks the omitted characters instead of silently clipping', () => {
    const text = 'a'.repeat(AI_DIFF_DELETE_LIMIT + 50);
    const formatted = formatAiDiffDeleteText(text);

    expect(formatted.truncated).toBe(true);
    expect(formatted.omitted).toBe(50);
    expect(formatted.display.startsWith('a'.repeat(AI_DIFF_DELETE_LIMIT))).toBe(true);
    expect(formatted.display.endsWith('+50 chars')).toBe(true);
  });
});

describe('AI diff flash lifecycle', () => {
  test('keeps the animation inside the 1.2s edit state window', () => {
    expect(AI_DIFF_FLASH_MS).toBe(1_100);
    expect(AI_DIFF_CLEAR_MS).toBe(1_150);
    expect(AI_DIFF_FLASH_MS).toBeLessThan(AI_DIFF_CLEAR_MS);
    expect(AI_DIFF_CLEAR_MS).toBeLessThanOrEqual(1_200);
  });

  test('animates once per pane and paints a static remainder after a remount', () => {
    const editId = `test-flash-${Date.now()}-a`;
    expect(claimAiDiffFlash('source', editId, 1_000)).toEqual({
      animate: true,
      duration: AI_DIFF_CLEAR_MS,
      startedAt: 1_000,
    });
    expect(claimAiDiffFlash('wysiwyg', editId, 1_100)).toMatchObject({
      animate: true,
      duration: AI_DIFF_CLEAR_MS - 100,
    });
    expect(claimAiDiffFlash('source', editId, 1_500)).toMatchObject({
      animate: false,
      duration: 650,
      startedAt: 1_000,
    });
    expect(claimAiDiffFlash('source', editId, 2_200)).toBeNull();
  });

  test('does not replay when a pane is first mounted later in the flash', () => {
    const editId = `test-flash-${Date.now()}-b`;
    expect(claimAiDiffFlash('wysiwyg', editId, 1_000)).toMatchObject({
      animate: true,
      startedAt: 1_000,
    });
    expect(claimAiDiffFlash('source', editId, 1_300)).toMatchObject({
      animate: false,
      duration: AI_DIFF_CLEAR_MS - 300,
      startedAt: 1_000,
    });
  });
});

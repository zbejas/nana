import { describe, expect, test } from 'bun:test';
import {
  changedCharacterCount,
  diffText,
  type AiTextChange,
} from '../../src/components/editor/milkdown/aiDiff';

const SYNTHETIC_PARAGRAPH = (index: number) =>
  `Section ${index}: Nana keeps a calm workspace where notes, folders, and boards stay close at hand. `
  + 'Each paragraph carries enough words to make the token diff realistic without hiding the edit. '
  + 'The second sentence adds detail, and the third gives the body a natural reading rhythm.';

function syntheticLongNote(paragraphCount = 24): string {
  const blocks = [
    '# Project notes',
    '',
    'A short introduction before the changed material.',
    '',
  ];
  for (let index = 0; index < paragraphCount; index += 1) {
    blocks.push(SYNTHETIC_PARAGRAPH(index), '');
  }
  return blocks.join('\n');
}

/** Hunks must stay in new-text order and never overlap. */
function expectOrderedHunks(changes: readonly AiTextChange[], next: string): void {
  let previousEnd = -1;
  for (const change of changes) {
    expect(change.text.length).toBeGreaterThan(0);
    expect(change.start).toBeGreaterThanOrEqual(previousEnd);
    expect(change.start).toBeLessThanOrEqual(next.length);
    expect(change.end).toBeLessThanOrEqual(next.length);

    if (change.type === 'insert') {
      expect(change.end).toBe(change.start + change.text.length);
      expect(next.slice(change.start, change.end)).toBe(change.text);
      previousEnd = change.end;
    } else {
      expect(change.end).toBe(change.start);
      previousEnd = change.start;
    }
  }
}

describe('AI text diff', () => {
  test('finds inserted words in new-text offsets', () => {
    expect(diffText('Hello world', 'Hello brave world')).toEqual([
      { type: 'insert', start: 6, end: 11, text: 'brave' },
    ]);
  });

  test('shows a replacement as a red delete then a green insert', () => {
    expect(diffText('Hello world', 'Hello there')).toEqual([
      { type: 'delete', start: 6, end: 6, text: 'world' },
      { type: 'insert', start: 6, end: 11, text: 'there' },
    ]);
  });

  test('ignores whitespace-only changes', () => {
    expect(diffText('Hello world', 'Hello  world')).toEqual([]);
    expect(changedCharacterCount(diffText('a', 'b'))).toBe(2);
  });

  test('handles a whole rewrite as bounded delete and insert changes', () => {
    const changes = diffText('alpha', 'beta');
    expect(changes.map((change) => change.type)).toEqual(['delete', 'insert']);
    expect(changes[0]?.start).toBe(0);
    expect(changes[1]?.start).toBe(0);
  });

  test('keeps two non-contiguous word deletions as separate hunks', () => {
    const next = 'keep MIDDLE keep';
    expect(diffText('REMOVE keep MIDDLE keep DROP', next)).toEqual([
      { type: 'delete', start: 0, end: 0, text: 'REMOVE' },
      { type: 'delete', start: next.length, end: next.length, text: 'DROP' },
    ]);
  });

  test('anchors start-only, end-only, and both-edge deletions', () => {
    const next = 'keep MIDDLE';
    expect(diffText('START keep MIDDLE', next)).toEqual([
      { type: 'delete', start: 0, end: 0, text: 'START' },
    ]);
    expect(diffText('keep MIDDLE END', next)).toEqual([
      { type: 'delete', start: next.length, end: next.length, text: 'END' },
    ]);
    expect(diffText('START keep MIDDLE END', next)).toEqual([
      { type: 'delete', start: 0, end: 0, text: 'START' },
      { type: 'delete', start: next.length, end: next.length, text: 'END' },
    ]);
  });

  test('keeps internal spaces in one contiguous multi-word deletion', () => {
    const next = 'alpha delta';
    expect(diffText('alpha beta gamma delta', next)).toEqual([
      { type: 'delete', start: next.indexOf('delta'), end: next.indexOf('delta'), text: 'beta gamma' },
    ]);
  });

  test('preserves internal spaces and newlines when only deleting', () => {
    expect(diffText('alpha beta gamma', 'alpha')).toEqual([
      { type: 'delete', start: 5, end: 5, text: 'beta gamma' },
    ]);
    expect(diffText('one\ntwo\nthree\nfour', 'one')).toEqual([
      { type: 'delete', start: 3, end: 3, text: 'two\nthree\nfour' },
    ]);
  });

  test('keeps one contiguous multi-line deletion as one defined hunk', () => {
    const next = 'one\nfour';
    const changes = diffText('one\ntwo\nthree\nfour', next);
    expect(changes).toEqual([
      { type: 'delete', start: next.indexOf('four'), end: next.indexOf('four'), text: 'two\nthree' },
    ]);
    expectOrderedHunks(changes, next);
  });

  test('keeps separated line deletions distinct and monotonic', () => {
    const next = 'one\nthree\nfive';
    const changes = diffText('one\ntwo\nthree\nfour\nfive', next);

    expect(changes.map((change) => change.type)).toEqual(['delete', 'delete']);
    expect(changes.map((change) => change.text)).toEqual(['two', 'four']);
    expect(changes[0]!.start).toBeLessThan(changes[1]!.start);
    expectOrderedHunks(changes, next);

    // A line-deletion anchor sits on a line/word boundary in the new body,
    // never in the middle of unchanged text. Newline ownership at the seam is
    // deliberately not pinned: start of the next word and end of the previous
    // word are both valid zero-width anchors.
    for (const change of changes) {
      const before = next.charAt(change.start - 1);
      const at = next.charAt(change.start);
      expect(
        change.start === 0
        || change.start === next.length
        || /\s/.test(before)
        || /\s/.test(at),
      ).toBe(true);
    }
  });

  test('keeps separated paragraph deletions distinct and preserves their words', () => {
    const next = 'intro\n\nmiddle\n\nend';
    const changes = diffText('intro\n\nremove me\n\nmiddle\n\nremove this too\n\nend', next);

    expect(changes.map((change) => change.type)).toEqual(['delete', 'delete']);
    expect(changes.map((change) => change.text)).toEqual(['remove me', 'remove this too']);
    expect(changes[0]!.start).toBeLessThan(changes[1]!.start);
    expectOrderedHunks(changes, next);
  });

  test('anchors each replacement after the previous unchanged gap', () => {
    const next = 'a X c Y e';
    expect(diffText('a b c d e', next)).toEqual([
      { type: 'delete', start: 2, end: 2, text: 'b' },
      { type: 'insert', start: 2, end: 3, text: 'X' },
      { type: 'delete', start: 6, end: 6, text: 'd' },
      { type: 'insert', start: 6, end: 7, text: 'Y' },
    ]);
  });

  test('keeps multiple word replacements on their later offsets', () => {
    const next = 'one TWO three FOUR five six';
    const changes = diffText('one two three four five six', next);

    expect(changes).toEqual([
      { type: 'delete', start: 4, end: 4, text: 'two' },
      { type: 'insert', start: 4, end: 7, text: 'TWO' },
      { type: 'delete', start: 14, end: 14, text: 'four' },
      { type: 'insert', start: 14, end: 18, text: 'FOUR' },
    ]);
    expectOrderedHunks(changes, next);
  });

  test('keeps internal spaces in a contiguous inserted run', () => {
    const next = 'a hello brave world z';
    expect(diffText('a z', next)).toEqual([
      { type: 'insert', start: 2, end: 19, text: 'hello brave world' },
    ]);
  });

  test('finds both separated deletions in a 6k-character note without the replacement fallback', () => {
    const opening = 'Delete this opening paragraph because it is no longer true.';
    const closing = 'Delete this closing paragraph after the later section.';
    const previous = syntheticLongNote();
    const withBoth = previous
      .replace(
        '\n\nA short introduction',
        `\n\n${opening}\n\nA short introduction`,
      )
      .replace('\n\nSection 17:', `\n\n${closing}\n\nSection 17:`);
    const next = withBoth
      .replace(`${opening}\n\n`, '')
      .replace(`${closing}\n\n`, '');

    expect(previous.length).toBeGreaterThan(5_000);
    expect(next.length).toBeGreaterThan(5_000);

    const startedAt = performance.now();
    const changes = diffText(withBoth, next);
    const elapsed = performance.now() - startedAt;

    expect(elapsed).toBeLessThan(1_000);
    expect(changes.map((change) => change.type)).toEqual(['delete', 'delete']);
    expect(changes.map((change) => change.text)).toEqual([opening, closing]);
    expect(changes).not.toEqual([
      { type: 'delete', start: 0, end: 0, text: withBoth },
      { type: 'insert', start: 0, end: next.length, text: next },
    ]);
    expectOrderedHunks(changes, next);
  });

  test('anchors several long-note replacements independently', () => {
    const previous = syntheticLongNote();
    const next = previous
      .replace('Section 3:', 'Updated section 3:')
      .replace('Section 9:', 'Revised section 9:')
      .replace('Section 17:', 'Changed section 17:');
    const changes = diffText(previous, next);

    expect(previous.length).toBeGreaterThan(6_000);
    expect(changedCharacterCount(changes)).toBeLessThan(200);
    expect(changes.length).toBeGreaterThanOrEqual(6);
    expectOrderedHunks(changes, next);

    const deletionStarts = changes
      .filter((change) => change.type === 'delete')
      .map((change) => change.start);
    expect(deletionStarts).toHaveLength(3);
    expect(deletionStarts[0]).toBeLessThan(deletionStarts[1]!);
    expect(deletionStarts[1]).toBeLessThan(deletionStarts[2]!);
  });

  test('keeps the character guard for bodies that cannot be diffed', () => {
    const tooLong = 'a'.repeat(120_001);
    expect(diffText(tooLong, `${tooLong}b`)).toEqual([]);
  });

  test('keeps the large-token fallback bounded to one delete and one insert', () => {
    const before = Array.from({ length: 600 }, (_, index) => `left${index}`).join(' ');
    const after = Array.from({ length: 600 }, (_, index) => `right${index}`).join(' ');
    const changes = diffText(before, after);

    expect(changes.map((change) => change.type)).toEqual(['delete', 'insert']);
    expect(changes[0]).toEqual({ type: 'delete', start: 0, end: 0, text: before });
    expect(changes[1]).toEqual({ type: 'insert', start: 0, end: after.length, text: after });
  });
});

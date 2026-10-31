import { describe, expect, test } from 'bun:test';
import {
  applyOp,
  applyOps,
  invertOp,
  invertOps,
  mergeAdjacentOps,
  normalizeOp,
  opsFromCodeMirrorChanges,
  opsFromMinimalTextChange,
  opsFromTextChange,
  validateOp,
  type CanonicalOp,
  type YTextLike,
} from '../../src/lib/collaboration/ops';

class FakeYText implements YTextLike {
  private value: string;

  constructor(value: string) {
    this.value = value;
  }

  get length(): number {
    return this.value.length;
  }

  toString(): string {
    return this.value;
  }

  insert(index: number, text: string): void {
    this.value = this.value.slice(0, index) + text + this.value.slice(index);
  }

  delete(index: number, length: number): void {
    this.value = this.value.slice(0, index) + this.value.slice(index + length);
  }
}

describe('applyOp and applyOps', () => {
  test('applies insertions and deletions', () => {
    expect(applyOp('abcdef', { type: 'insert', index: 2, text: 'XY' })).toBe('abXYcdef');
    expect(applyOp('abcdef', { type: 'delete', index: 2, length: 2 })).toBe('abef');
  });

  test('expresses a replacement as a delete followed by an insert', () => {
    const ops: CanonicalOp[] = [
      { type: 'delete', index: 2, length: 2 },
      { type: 'insert', index: 2, text: 'XY' },
    ];
    expect(applyOps('abcdef', ops)).toBe('abXYef');
  });

  test('applies ordered operations against the evolving document', () => {
    expect(applyOps('abc', [
      { type: 'insert', index: 0, text: 'A' },
      { type: 'insert', index: 0, text: 'B' },
    ])).toBe('BAabc');

    expect(applyOps('abc', [
      { type: 'insert', index: 1, text: 'X' },
      { type: 'delete', index: 2, length: 1 },
    ])).toBe('aXc');

    expect(applyOps('hello world', [
      { type: 'delete', index: 5, length: 6 },
      { type: 'insert', index: 5, text: ',' },
    ])).toBe('hello,');
  });

  test('returns the unchanged document for empty or malformed operations', () => {
    expect(applyOps('abc', [])).toBe('abc');
    expect(applyOps('abc', null as unknown as CanonicalOp[])).toBe('abc');
    expect(applyOp('abc', { type: 'insert', index: 1, text: '' })).toBe('abc');
    expect(applyOp('abc', { type: 'delete', index: 1, length: 0 })).toBe('abc');
    expect(applyOp('abc', { type: 'delete', index: 1, length: -2 })).toBe('abc');
    expect(applyOp('abc', { type: 'insert', index: Number.NaN, text: 'X' })).toBe('abc');
    expect(applyOp('abc', null as unknown as CanonicalOp)).toBe('abc');
    expect(applyOp('abc', { type: 'replace', index: 0, text: 'X' } as unknown as CanonicalOp))
      .toBe('abc');
  });

  test('clamps out-of-range indexes', () => {
    expect(applyOp('abc', { type: 'insert', index: 99, text: '!' })).toBe('abc!');
    expect(applyOp('abc', { type: 'insert', index: -99, text: '!' })).toBe('!abc');
    expect(applyOp('abcdef', { type: 'delete', index: 4, length: 99 })).toBe('abcd');
    expect(applyOp('abcdef', { type: 'delete', index: 99, length: 2 })).toBe('abcdef');
  });

  test('keeps surrogate pairs whole', () => {
    expect(applyOp('a😀b', { type: 'insert', index: 2, text: 'X' })).toBe('aX😀b');
    expect(applyOp('a😀b', { type: 'delete', index: 2, length: 1 })).toBe('ab');
    expect(applyOp('😀x', { type: 'delete', index: 0, length: 1 })).toBe('x');
    expect(applyOp('a😀b', { type: 'insert', index: 4, text: '!' })).toBe('a😀b!');
  });

  test('applies ordered operations to a Y.Text-like target', () => {
    const text = new FakeYText('hello world');
    applyOps(text, [
      { type: 'delete', index: 5, length: 6 },
      { type: 'insert', index: 5, text: ', there' },
      { type: 'insert', index: 12, text: '!' },
    ]);
    expect(text.toString()).toBe('hello, there!');

    applyOp(text, { type: 'delete', index: 0, length: 7 });
    expect(text.toString()).toBe('there!');
  });
});

describe('operation conversion', () => {
  test('turns a text change into canonical operations', () => {
    expect(opsFromTextChange({ from: 2, to: 4, insert: 'XY' })).toEqual([
      { type: 'delete', index: 2, length: 2 },
      { type: 'insert', index: 2, text: 'XY' },
    ]);
    expect(opsFromTextChange({ from: 2, to: 2, insert: 'XY' })).toEqual([
      { type: 'insert', index: 2, text: 'XY' },
    ]);
    expect(opsFromTextChange({ from: 2, to: 4, insert: '' })).toEqual([
      { type: 'delete', index: 2, length: 2 },
    ]);
    expect(opsFromTextChange({ from: 2, to: 2, insert: '' })).toEqual([]);
    expect(opsFromTextChange(null)).toEqual([]);
  });

  test('builds operations from minimal text changes', () => {
    expect(opsFromMinimalTextChange('Hello world', 'Hello brave world')).toEqual([
      { type: 'insert', index: 6, text: 'brave ' },
    ]);
    expect(opsFromMinimalTextChange('the quick fox', 'the slow fox')).toEqual([
      { type: 'delete', index: 4, length: 5 },
      { type: 'insert', index: 4, text: 'slow' },
    ]);
    expect(opsFromMinimalTextChange('same', 'same')).toEqual([]);
  });

  test('keeps surrogate pairs in minimal changes', () => {
    const ops = opsFromMinimalTextChange('hello 😀 world', 'hello 😃 world');
    expect(ops).toEqual([
      { type: 'delete', index: 6, length: 2 },
      { type: 'insert', index: 6, text: '😃' },
    ]);
    expect(applyOps('hello 😀 world', ops)).toBe('hello 😃 world');
  });

  test('maps CodeMirror changes from original to evolving positions', () => {
    const replacements = opsFromCodeMirrorChanges([
      { from: 0, to: 1, insert: 'X' },
      { from: 2, to: 3, insert: 'Y' },
    ]);
    expect(replacements).toEqual([
      { type: 'delete', index: 0, length: 1 },
      { type: 'insert', index: 0, text: 'X' },
      { type: 'delete', index: 2, length: 1 },
      { type: 'insert', index: 2, text: 'Y' },
    ]);
    expect(applyOps('abc', replacements)).toBe('XbY');

    const insertions = opsFromCodeMirrorChanges([
      { from: 0, insert: 'X' },
      { from: 3, insert: 'Y' },
    ]);
    expect(insertions).toEqual([
      { type: 'insert', index: 0, text: 'X' },
      { type: 'insert', index: 4, text: 'Y' },
    ]);
    expect(applyOps('abc', insertions)).toBe('XabcY');

    const afterDeletion = opsFromCodeMirrorChanges([
      { from: 0, to: 1 },
      { from: 3, insert: '!' },
    ]);
    expect(applyOps('abcd', afterDeletion)).toBe('bc!d');
  });

  test('flattens, sorts, and stringifies CodeMirror changes', () => {
    expect(opsFromCodeMirrorChanges([
      { from: 3, insert: '!' },
      [{ from: 0, insert: '>' }],
    ])).toEqual([
      { type: 'insert', index: 0, text: '>' },
      { type: 'insert', index: 4, text: '!' },
    ]);

    expect(opsFromCodeMirrorChanges({
      from: 1,
      to: 1,
      insert: { toString: () => 'XY' },
    })).toEqual([{ type: 'insert', index: 1, text: 'XY' }]);
  });

  test('skips overlapping and malformed CodeMirror changes', () => {
    expect(opsFromCodeMirrorChanges([
      { from: 0, to: 3, insert: 'X' },
      { from: 1, to: 2, insert: 'Y' },
    ])).toEqual([
      { type: 'delete', index: 0, length: 3 },
      { type: 'insert', index: 0, text: 'X' },
    ]);

    expect(opsFromCodeMirrorChanges([
      { from: Number.NaN, insert: 'X' },
      { from: 2, to: 1, insert: 'Q' },
    ])).toEqual([{ type: 'insert', index: 2, text: 'Q' }]);

    expect(opsFromCodeMirrorChanges(null)).toEqual([]);
    expect(opsFromCodeMirrorChanges([{ from: 1, insert: '' }])).toEqual([]);
  });

  test('clamps CodeMirror positions when a document length is supplied', () => {
    expect(opsFromCodeMirrorChanges([{ from: 10, to: 12, insert: '!' }], 3)).toEqual([
      { type: 'insert', index: 3, text: '!' },
    ]);
  });
});

describe('validation and normalization', () => {
  test('validates operation shape', () => {
    expect(validateOp({ type: 'insert', index: 0, text: '' })).toBe(true);
    expect(validateOp({ type: 'delete', index: 0, length: 0 })).toBe(true);
    expect(validateOp({ type: 'insert', index: -1, text: 'x' })).toBe(false);
    expect(validateOp({ type: 'insert', index: 0, text: 1 })).toBe(false);
    expect(validateOp({ type: 'delete', index: 0, length: -1 })).toBe(false);
    expect(validateOp({ type: 'delete', index: 0, length: 1.5 })).toBe(false);
    expect(validateOp(null)).toBe(false);
  });

  test('normalizes malformed and no-op operations to null', () => {
    expect(normalizeOp(null, 3)).toBeNull();
    expect(normalizeOp({ type: 'insert', index: 1, text: '' }, 3)).toBeNull();
    expect(normalizeOp({ type: 'delete', index: 1, length: 0 }, 3)).toBeNull();
    expect(normalizeOp({ type: 'delete', index: 9, length: 2 }, 3)).toBeNull();
    expect(normalizeOp({ type: 'insert', index: 9, text: 'x' }, 3)).toEqual({
      type: 'insert',
      index: 3,
      text: 'x',
    });
  });
});

describe('mergeAdjacentOps', () => {
  test('merges adjacent insertions and removes empty ones', () => {
    expect(mergeAdjacentOps([
      { type: 'insert', index: 0, text: 'A' },
      { type: 'insert', index: 1, text: 'B' },
    ])).toEqual([{ type: 'insert', index: 0, text: 'AB' }]);

    expect(mergeAdjacentOps([
      { type: 'insert', index: 1, text: 'A' },
      { type: 'insert', index: 1, text: 'B' },
    ])).toEqual([{ type: 'insert', index: 1, text: 'BA' }]);

    expect(mergeAdjacentOps([
      { type: 'insert', index: 0, text: '' },
      { type: 'insert', index: 1, text: 'A' },
    ])).toEqual([{ type: 'insert', index: 1, text: 'A' }]);
  });

  test('merges contiguous deletions', () => {
    expect(mergeAdjacentOps([
      { type: 'delete', index: 1, length: 2 },
      { type: 'delete', index: 1, length: 3 },
    ])).toEqual([{ type: 'delete', index: 1, length: 5 }]);

    expect(mergeAdjacentOps([
      { type: 'delete', index: 1, length: 2 },
      { type: 'delete', index: 3, length: 4 },
    ])).toEqual([{ type: 'delete', index: 1, length: 6 }]);
  });

  test('leaves separated or different operations alone', () => {
    expect(mergeAdjacentOps([
      { type: 'insert', index: 0, text: 'A' },
      { type: 'insert', index: 5, text: 'B' },
    ])).toEqual([
      { type: 'insert', index: 0, text: 'A' },
      { type: 'insert', index: 5, text: 'B' },
    ]);

    expect(mergeAdjacentOps([
      { type: 'delete', index: 1, length: 2 },
      { type: 'delete', index: 5, length: 2 },
    ])).toEqual([
      { type: 'delete', index: 1, length: 2 },
      { type: 'delete', index: 5, length: 2 },
    ]);

    expect(mergeAdjacentOps([
      { type: 'delete', index: 1, length: 2 },
      { type: 'insert', index: 1, text: 'X' },
    ])).toEqual([
      { type: 'delete', index: 1, length: 2 },
      { type: 'insert', index: 1, text: 'X' },
    ]);
  });

  test('does not mutate the input operations', () => {
    const input: CanonicalOp[] = [
      { type: 'insert', index: 0, text: 'A' },
      { type: 'insert', index: 1, text: 'B' },
    ];
    mergeAdjacentOps(input);
    expect(input[0]).toEqual({ type: 'insert', index: 0, text: 'A' });
  });
});

describe('inversion', () => {
  test('inverts one insertion or deletion', () => {
    expect(invertOp('abc', { type: 'insert', index: 1, text: 'XY' })).toEqual({
      type: 'delete',
      index: 1,
      length: 2,
    });
    expect(invertOp('abc', { type: 'delete', index: 1, length: 1 })).toEqual({
      type: 'insert',
      index: 1,
      text: 'b',
    });
    expect(invertOp('abc', { type: 'insert', index: 1, text: '' })).toBeNull();
  });

  test('restores the original after a replacement', () => {
    const source = 'hello 😀 world';
    const next = 'hello 😃 world';
    const ops = opsFromMinimalTextChange(source, next);
    const inverse = invertOps(source, ops);

    expect(applyOps(next, inverse)).toBe(source);
    expect(applyOps(source, ops)).toBe(next);
  });

  test('inverts ordered operations in reverse order', () => {
    const source = 'abcdef';
    const ops: CanonicalOp[] = [
      { type: 'insert', index: 2, text: 'XY' },
      { type: 'delete', index: 4, length: 2 },
    ];
    const next = applyOps(source, ops);
    const inverse = invertOps(source, ops);

    expect(next).toBe('abXYef');
    expect(inverse).toEqual([
      { type: 'insert', index: 4, text: 'cd' },
      { type: 'delete', index: 2, length: 2 },
    ]);
    expect(applyOps(next, inverse)).toBe(source);
  });

  test('ignores malformed operations and accepts a Y.Text-like snapshot', () => {
    expect(invertOps('abc', [null as unknown as CanonicalOp])).toEqual([]);
    expect(invertOps(new FakeYText('abc'), [
      { type: 'delete', index: 1, length: 1 },
    ])).toEqual([{ type: 'insert', index: 1, text: 'b' }]);
  });
});

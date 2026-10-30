import { describe, expect, test } from 'bun:test';
import { changedCharacterCount, diffText } from '../../src/components/editor/milkdown/aiDiff';

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
});

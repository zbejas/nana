import { describe, expect, test } from 'bun:test';
import {
  EDITOR_ACTIONS,
  SLASH_MENU_ITEMS,
  computeScrollRatio,
  filterSlashMenuItems,
  isSameMarkdown,
  linkTextForHref,
  normalizeMarkdown,
  safeLinkHref,
  scrollTopForRatio,
} from '../../src/components/editor/milkdown/helpers';

describe('normalizeMarkdown', () => {
  test('normalizes CRLF and CR to LF', () => {
    expect(normalizeMarkdown('a\r\nb\rc')).toBe('a\nb\nc');
  });

  test('drops only trailing newlines and keeps inner blank lines', () => {
    expect(normalizeMarkdown('a\n\nb\n\n\n')).toBe('a\n\nb');
    expect(normalizeMarkdown('\n\n')).toBe('');
  });

  test('compares equivalent line endings as the same document', () => {
    expect(isSameMarkdown('one\r\ntwo', 'one\ntwo\n')).toBe(true);
    expect(isSameMarkdown('one', 'one ')).toBe(false);
  });
});

describe('split scroll ratio', () => {
  test('clamps to the scrollable range', () => {
    expect(computeScrollRatio(0, 1000, 400)).toBe(0);
    expect(computeScrollRatio(300, 1000, 400)).toBe(0.5);
    expect(computeScrollRatio(900, 1000, 400)).toBe(1);
  });

  test('returns zero when a pane cannot scroll', () => {
    expect(computeScrollRatio(50, 400, 400)).toBe(0);
    expect(computeScrollRatio(Number.NaN, 1000, 400)).toBe(0);
  });

  test('round-trips a ratio into a target scroll top', () => {
    expect(scrollTopForRatio(0.5, 1000, 400)).toBe(300);
    expect(scrollTopForRatio(-1, 1000, 400)).toBe(0);
    expect(scrollTopForRatio(2, 1000, 400)).toBe(600);
    expect(scrollTopForRatio(0.5, 300, 400)).toBe(0);
  });
});

describe('editor action mapping', () => {
  test('toolbar actions are unique with accessible labels', () => {
    const ids = EDITOR_ACTIONS.map((action) => action.id);
    const labels = EDITOR_ACTIONS.map((action) => action.label);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.every((label) => label.trim().length > 0)).toBe(true);
  });

  test('every slash item maps to a known editor action', () => {
    const known = new Set(EDITOR_ACTIONS.map((action) => action.id));
    for (const item of SLASH_MENU_ITEMS) {
      expect(known.has(item.id) || item.id === 'paragraph' || item.id === 'divider' || item.id === 'table').toBe(true);
    }
  });

  test('slash menu filters on labels, hints, and keywords', () => {
    expect(filterSlashMenuItems('').length).toBe(SLASH_MENU_ITEMS.length);
    expect(filterSlashMenuItems('todo').map((item) => item.id)).toEqual(['task-list']);
    expect(filterSlashMenuItems('h2').map((item) => item.id)).toEqual(['heading-2']);
    expect(filterSlashMenuItems('grid').map((item) => item.id)).toEqual(['table']);
    expect(filterSlashMenuItems('nothing here')).toEqual([]);
  });
});

describe('link helpers', () => {
  test('accepts web, mailto, hash, and same-origin paths', () => {
    expect(safeLinkHref('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(safeLinkHref('mailto:hello@example.com')).toBe('mailto:hello@example.com');
    expect(safeLinkHref('#section')).toBe('#section');
    expect(safeLinkHref('/api/v1/files/token/a.png')).toBe('/api/v1/files/token/a.png');
    expect(safeLinkHref('notes/readme')).toBe('notes/readme');
  });

  test('rejects script and protocol-relative links', () => {
    expect(safeLinkHref('javascript:alert(1)')).toBeNull();
    expect(safeLinkHref('data:text/html;base64,abc')).toBeNull();
    expect(safeLinkHref('//evil.example.com')).toBeNull();
    expect(safeLinkHref('   ')).toBeNull();
  });

  test('derives readable link text from a URL', () => {
    expect(linkTextForHref('https://example.com/docs/')).toBe('example.com/docs');
    expect(linkTextForHref('mailto:hello@example.com')).toBe('hello@example.com');
  });
});

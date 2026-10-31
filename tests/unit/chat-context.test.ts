import { describe, expect, test } from 'bun:test';
import {
  conversationSubtitle,
  filterConversations,
  groupConversationsByDate,
} from '../../src/lib/chat/history';
import type { ChatConversation } from '../../src/lib/chat/types';

// `src/lib/chat/context.ts` reads the shared atoms, whose custom storage
// adapters touch localStorage at module load. Bun tests have no browser, so
// install the smallest possible store before importing it.
const memoryStorage = (() => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
})();
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage, configurable: true });
Object.defineProperty(globalThis, 'sessionStorage', { value: memoryStorage, configurable: true });

const {
  chatContextKey,
  deriveChatContext,
  folderInPrivateBranch,
  toContextInput,
} = await import('../../src/lib/chat/context');
type ChatContextTarget = import('../../src/lib/chat/context').ChatContextTarget;

describe('deriveChatContext', () => {
  test('maps note, board, and folder routes', () => {
    expect(deriveChatContext('/document/note123')).toEqual({ type: 'document', id: 'note123' });
    expect(deriveChatContext('/board/board123')).toEqual({ type: 'board', id: 'board123' });
    expect(deriveChatContext('/folders/folder123')).toEqual({ type: 'folder', id: 'folder123' });
  });

  test('decodes ids and ignores trailing paths', () => {
    expect(deriveChatContext('/document/a%20b')).toEqual({ type: 'document', id: 'a b' });
    expect(deriveChatContext('/document/abc/')).toEqual({ type: 'document', id: 'abc' });
    expect(deriveChatContext('/document/abc/extra')).toBeNull();
  });

  test('ignores surfaces without a page context', () => {
    expect(deriveChatContext('/timeline')).toBeNull();
    expect(deriveChatContext('/chat/abc')).toBeNull();
    expect(deriveChatContext('/settings/account')).toBeNull();
    expect(deriveChatContext('/document/new')).toBeNull();
    expect(deriveChatContext('/board/archive')).toBeNull();
    expect(deriveChatContext('/board/trash')).toBeNull();
    expect(deriveChatContext('/folders/trash/f1')).toBeNull();
    expect(deriveChatContext('/folders/shared')).toBeNull();
  });
});

describe('context payloads', () => {
  const note: ChatContextTarget = {
    type: 'document',
    id: 'n1',
    isPrivate: false,
  };

  test('sends only type and id', () => {
    expect(toContextInput(note)).toEqual({ type: 'document', id: 'n1' });
    expect(chatContextKey(note)).toBe('document:n1');
  });

  test('omits private, loading, and unavailable pages', () => {
    expect(toContextInput({ ...note, isPrivate: true })).toBeUndefined();
    expect(toContextInput({ ...note, loading: true })).toBeUndefined();
    expect(toContextInput({ ...note, unavailable: true })).toBeUndefined();
    expect(toContextInput(null)).toBeUndefined();
  });
});

describe('folderInPrivateBranch', () => {
  const folders = [
    { id: 'root', parent: '', is_private: false },
    { id: 'private', parent: 'root', is_private: true },
    { id: 'child', parent: 'private', is_private: false },
    { id: 'other', parent: 'root', is_private: false },
  ];

  test('inherits privacy from any ancestor', () => {
    expect(folderInPrivateBranch('private', folders)).toBe(true);
    expect(folderInPrivateBranch('child', folders)).toBe(true);
    expect(folderInPrivateBranch('other', folders)).toBe(false);
    expect(folderInPrivateBranch('', folders)).toBe(false);
  });

  test('does not loop on a cyclic parent chain', () => {
    expect(folderInPrivateBranch('a', [
      { id: 'a', parent: 'b', is_private: false },
      { id: 'b', parent: 'a', is_private: false },
    ])).toBe(false);
  });
});

describe('history grouping', () => {
  const now = new Date(2026, 9, 30, 12, 0, 0);
  const conversations: ChatConversation[] = [
    { id: 'today', title: 'Today note', created: '', updated: new Date(2026, 9, 30, 9).toISOString() },
    { id: 'yesterday', title: 'Yesterday note', created: '', updated: new Date(2026, 9, 29, 9).toISOString() },
    { id: 'week', title: 'Week note', created: '', updated: new Date(2026, 9, 25, 9).toISOString() },
    { id: 'old', title: 'Old note', created: '', updated: new Date(2026, 8, 1, 9).toISOString() },
  ];

  test('groups by local relative day, newest first', () => {
    const groups = groupConversationsByDate(conversations, now);
    expect(groups.map((group) => group.label)).toEqual([
      'Today',
      'Yesterday',
      'Previous 7 days',
      'Older',
    ]);
    expect(groups[0]?.conversations[0]?.id).toBe('today');
  });

  test('filters by title', () => {
    expect(filterConversations(conversations, 'week').map((c) => c.id)).toEqual(['week']);
    expect(filterConversations(conversations, '  ').length).toBe(4);
  });

  test('formats a missing timestamp quietly', () => {
    expect(conversationSubtitle({ id: 'x', title: 'X', created: '', updated: '' })).toBe('');
  });
});

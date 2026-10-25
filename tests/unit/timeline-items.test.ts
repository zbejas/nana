import { describe, expect, test } from 'bun:test';
import {
  filterTimelineBoards,
  mergeTimelineItems,
} from '../../src/components/timeline/items';
import type { BoardSummary } from '../../src/lib/boards';
import type { Document } from '../../src/lib/documents';

function board(id: string, overrides: Partial<BoardSummary> = {}): BoardSummary {
  return {
    id,
    name: `Board ${id}`,
    description: '',
    archived: false,
    author: 'user',
    folder: '',
    is_private: false,
    created: '2026-01-01 00:00:00.000Z',
    updated: '2026-01-01 00:00:00.000Z',
    openCount: 0,
    doneCount: 0,
    total: 0,
    lastActivity: '2026-01-01 00:00:00.000Z',
    ...overrides,
  } as BoardSummary;
}

function note(id: string, updated: string): Document {
  return { id, updated } as Document;
}

const NO_FILTERS = {
  searchQuery: '',
  calendarRange: null,
  hasMoreDocuments: false,
  oldestLoadedDocumentUpdated: null,
};

describe('mergeTimelineItems', () => {
  test('merges notes and boards newest first with stable item ids', () => {
    const items = mergeTimelineItems(
      [note('n1', '2026-10-20T09:00:00.000Z')],
      [
        board('older', { lastActivity: '2026-10-19T09:00:00.000Z' }),
        board('newer', { lastActivity: '2026-10-21T09:00:00.000Z' }),
      ]
    );

    expect(items.map((item) => item.id)).toEqual([
      'board:newer',
      'document:n1',
      'board:older',
    ]);
    expect(items.map((item) => item.kind)).toEqual(['board', 'document', 'board']);
  });

  test('keeps notes when there are no boards', () => {
    const items = mergeTimelineItems([note('n1', '2026-10-20T09:00:00.000Z')], []);

    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe('document');
  });
});

describe('filterTimelineBoards', () => {
  test('matches board names and descriptions case-insensitively', () => {
    const boards = [
      board('release', { name: 'Release plan' }),
      board('research', { description: 'Research notes and links' }),
      board('home', { name: 'Home admin' }),
    ];

    expect(
      filterTimelineBoards(boards, { ...NO_FILTERS, searchQuery: 'RELEASE' }).map(
        (item) => item.id
      )
    ).toEqual(['release']);
    expect(
      filterTimelineBoards(boards, { ...NO_FILTERS, searchQuery: 'research' }).map(
        (item) => item.id
      )
    ).toEqual(['research']);
  });

  test('keeps only boards active inside the calendar range, including end of day', () => {
    const boards = [
      board('before', {
        lastActivity: new Date(2026, 9, 19, 23, 59, 59).toISOString(),
      }),
      board('start', { lastActivity: new Date(2026, 9, 20, 0, 0, 0).toISOString() }),
      board('end', { lastActivity: new Date(2026, 9, 21, 23, 59, 59).toISOString() }),
      board('after', { lastActivity: new Date(2026, 9, 22, 0, 0, 0).toISOString() }),
    ];

    const result = filterTimelineBoards(boards, {
      ...NO_FILTERS,
      calendarRange: {
        startDate: new Date(2026, 9, 20),
        endDate: new Date(2026, 9, 21),
      },
    });

    expect(result.map((item) => item.id)).toEqual(['start', 'end']);
  });

  test('uses one selected day as a full-day range', () => {
    const boards = [
      board('morning', {
        lastActivity: new Date(2026, 9, 20, 8, 30, 0).toISOString(),
      }),
      board('nextDay', { lastActivity: new Date(2026, 9, 21, 8, 30, 0).toISOString() }),
    ];

    const result = filterTimelineBoards(boards, {
      ...NO_FILTERS,
      calendarRange: { startDate: new Date(2026, 9, 20), endDate: null },
    });

    expect(result.map((item) => item.id)).toEqual(['morning']);
  });

  test('holds back boards older than the last loaded note while notes are paged', () => {
    const boards = [
      board('newer', { lastActivity: '2026-10-21T09:00:00.000Z' }),
      board('older', { lastActivity: '2026-10-19T09:00:00.000Z' }),
    ];

    expect(
      filterTimelineBoards(boards, {
        ...NO_FILTERS,
        hasMoreDocuments: true,
        oldestLoadedDocumentUpdated: '2026-10-20T09:00:00.000Z',
      }).map((item) => item.id)
    ).toEqual(['newer']);

    expect(
      filterTimelineBoards(boards, {
        ...NO_FILTERS,
        hasMoreDocuments: false,
        oldestLoadedDocumentUpdated: '2026-10-20T09:00:00.000Z',
      }).map((item) => item.id)
    ).toEqual(['newer', 'older']);
  });

  test('search ignores the calendar range and the paging cutoff', () => {
    const boards = [
      board('old', {
        name: 'Release plan',
        lastActivity: '2020-01-01T09:00:00.000Z',
      }),
    ];

    const result = filterTimelineBoards(boards, {
      searchQuery: 'release',
      calendarRange: {
        startDate: new Date(2026, 9, 20),
        endDate: new Date(2026, 9, 21),
      },
      hasMoreDocuments: true,
      oldestLoadedDocumentUpdated: '2026-10-20T09:00:00.000Z',
    });

    expect(result.map((item) => item.id)).toEqual(['old']);
  });
});

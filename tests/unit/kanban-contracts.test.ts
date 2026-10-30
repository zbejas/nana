import { describe, expect, test } from 'bun:test';
import { slugifyColumnName, summarizeTaskCounts } from '../../src/lib/boards';
import { isVirtualStatus, statusLabel } from '../../src/lib/tasks';

describe('kanban status contracts', () => {
  test('identifies only planned and archived as virtual statuses', () => {
    expect(isVirtualStatus('planned')).toBe(true);
    expect(isVirtualStatus('archived')).toBe(true);
    expect(isVirtualStatus('backlog')).toBe(false);
    expect(isVirtualStatus('')).toBe(false);
  });

  test('labels virtual statuses and known columns', () => {
    expect(statusLabel('planned')).toBe('Planned');
    expect(statusLabel('archived')).toBe('Archived');
    expect(statusLabel('in-review', [{ slug: 'in-review', name: 'In review' }])).toBe('In review');
  });

  test('falls back to a readable slug for an unknown column', () => {
    expect(statusLabel('waiting_on_client')).toBe('Waiting on client');
    expect(statusLabel('')).toBe('No status');
  });

  test('slugifies display names for column keys', () => {
    expect(slugifyColumnName('In review')).toBe('in-review');
    expect(slugifyColumnName('  Café / QA  ')).toBe('cafe-qa');
    expect(slugifyColumnName('!!!')).toBe('column');
  });
});

describe('board summary counts', () => {
  test('counts done by final columns, not the literal done slug', () => {
    const columns = [
      { slug: 'todo', is_final: false },
      { slug: 'shipped', is_final: true },
      { slug: 'dropped', is_final: true },
    ];
    const tasks = [
      { status: 'todo' },
      { status: 'shipped' },
      { status: 'dropped' },
      { status: 'planned' },
      { status: 'archived' },
      { status: 'done' },
    ];

    expect(summarizeTaskCounts(tasks, columns)).toEqual({
      open: 4,
      done: 2,
      total: 6,
    });
  });

  test('treats a board with no final column as fully open', () => {
    expect(
      summarizeTaskCounts(
        [{ status: 'todo' }, { status: 'done' }],
        [{ slug: 'todo', is_final: false }],
      ),
    ).toEqual({ open: 2, done: 0, total: 2 });
  });
});

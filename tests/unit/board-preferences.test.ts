import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_BOARD_PREFERENCES,
  canDragTasks,
  dateBarForTask,
  filterChips,
  filterTasks,
  formatShortDate,
  formatTaskNumber,
  ganttWindow,
  loadBoardPreferences,
  monthGridDays,
  saveBoardPreferences,
  searchTasks,
  shiftTaskDates,
  sortTasks,
  startOfWeek,
  taskOccursOn,
  type BoardFilterState,
  type StorageLike,
} from '../../src/lib/board-preferences';
import type { Task } from '../../src/lib/tasks';

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: overrides.id ?? 'task-1',
    title: overrides.title ?? 'Untitled task',
    description: overrides.description ?? '',
    status: overrides.status ?? 'todo',
    priority: overrides.priority ?? '',
    due_date: overrides.due_date ?? '',
    start_date: overrides.start_date ?? '',
    completed_at: overrides.completed_at ?? '',
    board_order: overrides.board_order ?? 0,
    labels: overrides.labels ?? [],
    board: overrides.board ?? 'board-1',
    assignee: overrides.assignee ?? '',
    task_number: overrides.task_number,
    created: overrides.created ?? '2026-10-01 00:00:00.000Z',
    updated: overrides.updated ?? '2026-10-01 00:00:00.000Z',
    ...overrides,
  };
}

function filters(overrides: Partial<BoardFilterState> = {}): BoardFilterState {
  return {
    ...DEFAULT_BOARD_PREFERENCES.filters,
    ...overrides,
    negate: {
      ...DEFAULT_BOARD_PREFERENCES.filters.negate,
      ...(overrides.negate ?? {}),
    },
  };
}

function memoryStorage(): StorageLike {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe('task number display', () => {
  test('formats a positive number and hides missing or invalid ones', () => {
    expect(formatTaskNumber(12)).toBe('#12');
    expect(formatTaskNumber({ task_number: 3 })).toBe('#3');
    expect(formatTaskNumber({ task_number: 0 })).toBe('');
    expect(formatTaskNumber({})).toBe('');
    expect(formatTaskNumber(undefined)).toBe('');
    expect(formatTaskNumber(2.8)).toBe('#2');
  });
});

describe('board preference storage', () => {
  test('round-trips preferences per board', () => {
    const storage = memoryStorage();
    const next = {
      ...DEFAULT_BOARD_PREFERENCES,
      view: 'calendar' as const,
      sort: 'priority' as const,
      sortDirection: 'desc' as const,
      display: { ...DEFAULT_BOARD_PREFERENCES.display, note: false },
      filters: filters({ priority: ['high'], negate: { ...filters().negate, priority: true } }),
    };

    saveBoardPreferences('board-a', next, storage);
    expect(loadBoardPreferences('board-a', storage)).toEqual(next);
    expect(loadBoardPreferences('board-b', storage)).toEqual(DEFAULT_BOARD_PREFERENCES);
  });

  test('sanitizes malformed values instead of throwing', () => {
    const storage = memoryStorage();
    storage.setItem('nana.board.v1.board-a', JSON.stringify({
      view: 'spreadsheet',
      sort: 'sideways',
      sortDirection: 'up',
      filters: { status: ['todo', 5], due: ['overdue', 'decade'], labelMode: 'some' },
      display: { priority: false, labels: 'no' },
      collapsedListGroups: ['todo', null],
      onboardingDismissed: 'yes',
    }));

    const loaded = loadBoardPreferences('board-a', storage);
    expect(loaded.view).toBe('board');
    expect(loaded.sort).toBe('manual');
    expect(loaded.sortDirection).toBe('asc');
    expect(loaded.filters.status).toEqual(['todo']);
    expect(loaded.filters.due).toEqual(['overdue']);
    expect(loaded.filters.labelMode).toBe('any');
    expect(loaded.display.priority).toBe(false);
    expect(loaded.display.labels).toBe(true);
    expect(loaded.collapsedListGroups).toEqual(['todo']);
    expect(loaded.onboardingDismissed).toBe(false);
  });

  test('returns defaults for corrupt JSON', () => {
    const storage = memoryStorage();
    storage.setItem('nana.board.v1.board-a', '{not json');
    expect(loadBoardPreferences('board-a', storage)).toEqual(DEFAULT_BOARD_PREFERENCES);
  });
});

describe('filters', () => {
  const now = new Date(2026, 9, 30, 12);
  const highTodo = task({ id: 'high-todo', priority: 'high', status: 'todo', labels: ['design', 'writing'], assignee: 'user-1' });
  const urgentProgress = task({ id: 'urgent-progress', priority: 'urgent', status: 'progress', labels: ['design'] });
  const lowDone = task({ id: 'low-done', priority: 'low', status: 'done', labels: [] });
  const unassigned = task({ id: 'unassigned', priority: '', status: 'todo', assignee: '' });

  test('ANDs across subjects and ORs within one subject', () => {
    expect(
      filterTasks([highTodo, urgentProgress, lowDone], filters({ status: ['todo', 'progress'], priority: ['urgent'] }), now).map((item) => item.id),
    ).toEqual(['urgent-progress']);

    expect(
      filterTasks([highTodo, urgentProgress, lowDone], filters({ status: ['todo'], priority: ['low', 'urgent'] }), now).map((item) => item.id),
    ).toEqual([]);
  });

  test('applies one negation toggle per subject', () => {
    const result = filterTasks(
      [highTodo, urgentProgress, lowDone],
      filters({ status: ['todo'], negate: { ...filters().negate, status: true } }),
      now,
    );
    expect(result.map((item) => item.id)).toEqual(['urgent-progress', 'low-done']);
  });

  test('matches labels with Any or All', () => {
    expect(
      filterTasks([highTodo, urgentProgress], filters({ labels: ['design', 'writing'], labelMode: 'any' }), now).map((item) => item.id),
    ).toEqual(['high-todo', 'urgent-progress']);
    expect(
      filterTasks([highTodo, urgentProgress], filters({ labels: ['design', 'writing'], labelMode: 'all' }), now).map((item) => item.id),
    ).toEqual(['high-todo']);
  });

  test('handles priority none and unassigned buckets', () => {
    expect(filterTasks([unassigned, highTodo], filters({ priority: ['none'] }), now).map((item) => item.id)).toEqual(['unassigned']);
    expect(filterTasks([unassigned, highTodo], filters({ assignee: ['unassigned'] }), now).map((item) => item.id)).toEqual(['unassigned']);
  });

  test('matches due buckets against a fixed day', () => {
    const overdue = task({ id: 'overdue', due_date: '2026-10-29' });
    const today = task({ id: 'today', due_date: '2026-10-30' });
    const thisWeek = task({ id: 'week', due_date: '2026-11-01' });
    const later = task({ id: 'later', due_date: '2026-11-10' });
    const none = task({ id: 'none', due_date: '' });

    expect(filterTasks([overdue, today, thisWeek, later, none], filters({ due: ['overdue'] }), now).map((item) => item.id)).toEqual(['overdue']);
    expect(filterTasks([overdue, today, thisWeek, later, none], filters({ due: ['today'] }), now).map((item) => item.id)).toEqual(['today']);
    expect(filterTasks([overdue, today, thisWeek, later, none], filters({ due: ['week'] }), now).map((item) => item.id)).toEqual(['today', 'week']);
    expect(filterTasks([overdue, today, thisWeek, later, none], filters({ due: ['none'] }), now).map((item) => item.id)).toEqual(['none']);
  });

  test('searches title, description, labels, and task number', () => {
    const tasks = [
      task({ id: 'a', title: 'Write the launch note', task_number: 14 }),
      task({ id: 'b', description: 'Mentions a lavender sketch', labels: ['design'] }),
      task({ id: 'c', title: 'Something else', task_number: 3 }),
    ];

    expect(searchTasks(tasks, 'launch').map((item) => item.id)).toEqual(['a']);
    expect(searchTasks(tasks, 'lavender').map((item) => item.id)).toEqual(['b']);
    expect(searchTasks(tasks, '#14').map((item) => item.id)).toEqual(['a']);
    expect(searchTasks(tasks, 'design').map((item) => item.id)).toEqual(['b']);
  });

  test('builds chips with the status name and negation', () => {
    const chips = filterChips(filters({ status: ['todo'], priority: ['high'], negate: { ...filters().negate, priority: true } }), [
      { slug: 'todo', name: 'To do' },
    ]);
    expect(chips.map((chip) => chip.label)).toEqual(['To do', 'High']);
    expect(chips[1]?.negated).toBe(true);
  });
});

describe('sorting', () => {
  test('manual order follows board order', () => {
    const tasks = [task({ id: 'b', board_order: 2 }), task({ id: 'a', board_order: 0 })];
    expect(sortTasks(tasks, 'manual').map((item) => item.id)).toEqual(['a', 'b']);
  });

  test('priority order is urgent first and can reverse', () => {
    const tasks = [
      task({ id: 'low', priority: 'low' }),
      task({ id: 'urgent', priority: 'urgent' }),
      task({ id: 'medium', priority: 'medium' }),
    ];
    expect(sortTasks(tasks, 'priority').map((item) => item.id)).toEqual(['urgent', 'medium', 'low']);
    expect(sortTasks(tasks, 'priority', 'desc').map((item) => item.id)).toEqual(['low', 'medium', 'urgent']);
  });

  test('due order keeps undated tasks last in both directions', () => {
    const tasks = [
      task({ id: 'none', due_date: '' }),
      task({ id: 'later', due_date: '2026-11-02' }),
      task({ id: 'sooner', due_date: '2026-10-30' }),
    ];
    expect(sortTasks(tasks, 'due').map((item) => item.id)).toEqual(['sooner', 'later', 'none']);
    expect(sortTasks(tasks, 'due', 'desc').map((item) => item.id)).toEqual(['later', 'sooner', 'none']);
  });

  test('title sort is case insensitive', () => {
    const tasks = [task({ id: 'b', title: 'beta' }), task({ id: 'a', title: 'Alpha' })];
    expect(sortTasks(tasks, 'title').map((item) => item.id)).toEqual(['a', 'b']);
  });

  test('drag is only enabled for manual, unfiltered boards', () => {
    expect(canDragTasks({ sort: 'manual', filters: filters() }, '')).toBe(true);
    expect(canDragTasks({ sort: 'priority', filters: filters() }, '')).toBe(false);
    expect(canDragTasks({ sort: 'manual', filters: filters({ status: ['todo'] }) }, '')).toBe(false);
    expect(canDragTasks({ sort: 'manual', filters: filters() }, 'launch')).toBe(false);
  });
});

describe('calendar and Gantt ranges', () => {
  test('month grid is six Monday-first weeks', () => {
    const days = monthGridDays(2026, 9);
    expect(days).toHaveLength(42);
    expect(days[0]?.getDay()).toBe(1);
    expect(days[0]?.toLocaleDateString('en-US')).toBe('9/28/2026');
    expect(days[41]?.toLocaleDateString('en-US')).toBe('11/8/2026');
  });

  test('week start is Monday', () => {
    expect(startOfWeek(new Date(2026, 9, 30)).getDate()).toBe(26);
  });

  test('Gantt window is 91 days with two weeks of context', () => {
    const window = ganttWindow(new Date(2026, 9, 30));
    expect(window.days).toHaveLength(91);
    expect(window.start.toLocaleDateString('en-US')).toBe('10/16/2026');
    expect(window.days.at(-1)?.toLocaleDateString('en-US')).toBe('1/14/2027');
  });

  test('maps and clips task bars into the Gantt window', () => {
    const start = new Date(2026, 9, 16);
    const bar = dateBarForTask({ start_date: '2026-10-20', due_date: '2026-10-22' }, start);
    expect(bar).toEqual({ startIndex: 4, endIndex: 6, clippedStart: false, clippedEnd: false });

    const clipped = dateBarForTask({ start_date: '2026-10-01', due_date: '2026-10-18' }, start);
    expect(clipped).toEqual({ startIndex: 0, endIndex: 2, clippedStart: true, clippedEnd: false });

    expect(dateBarForTask({ start_date: '2027-02-01', due_date: '2027-02-02' }, start)).toBeNull();
  });

  test('shift preserves missing dates and resizes clamp to the other edge', () => {
    expect(shiftTaskDates({ start_date: '2026-10-30', due_date: '2026-11-02' }, 2)).toEqual({
      start_date: '2026-11-01',
      due_date: '2026-11-04',
    });
    expect(shiftTaskDates({ start_date: '', due_date: '2026-11-02' }, 2)).toEqual({
      start_date: '',
      due_date: '2026-11-04',
    });
  });

  test('multi-day tasks occur on every day of their span', () => {
    const spanning = task({ start_date: '2026-10-30', due_date: '2026-11-02' });
    expect(taskOccursOn(spanning, new Date(2026, 9, 30))).toBe(true);
    expect(taskOccursOn(spanning, new Date(2026, 9, 31))).toBe(true);
    expect(taskOccursOn(spanning, new Date(2026, 10, 2))).toBe(true);
    expect(taskOccursOn(spanning, new Date(2026, 10, 3))).toBe(false);
  });

  test('short dates include a year only outside the current year', () => {
    expect(formatShortDate('2026-10-30', new Date(2026, 9, 30))).not.toContain('2026');
    expect(formatShortDate('2027-01-02', new Date(2026, 9, 30))).toContain('2027');
  });
});

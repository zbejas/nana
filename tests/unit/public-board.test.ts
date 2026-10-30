import { describe, expect, test } from 'bun:test';
import {
  countDoneTasks,
  countOpenTasks,
  groupPublicBoardTasks,
} from '../../src/components/public/board';
import type { PublicBoardTask } from '../../src/lib/public-sharing';

function task(
  id: string,
  status: PublicBoardTask['status'],
  boardOrder: number,
  title = id,
): PublicBoardTask {
  return {
    id,
    title,
    description: '',
    status,
    priority: '',
    due_date: null,
    board_order: boardOrder,
    labels: [],
    created: null,
    updated: null,
  };
}

describe('groupPublicBoardTasks', () => {
  test('groups in board column order and omits empty columns', () => {
    const groups = groupPublicBoardTasks([
      task('done-1', 'done', 1),
      task('backlog-1', 'backlog', 1),
      task('next-1', 'next', 1),
    ]);

    expect(groups.map((group) => group.status)).toEqual(['backlog', 'next', 'done']);
    expect(groups.map((group) => group.label)).toEqual(['Backlog', 'Next up', 'Done']);
  });

  test('sorts tasks by board order within a group', () => {
    const groups = groupPublicBoardTasks([
      task('third', 'backlog', 3),
      task('first', 'backlog', 1),
      task('second', 'backlog', 2),
    ]);

    expect(groups[0]?.tasks.map((item) => item.id)).toEqual(['first', 'second', 'third']);
  });

  test('returns no groups when there are no tasks', () => {
    expect(groupPublicBoardTasks([])).toEqual([]);
  });
});

describe('public board counts', () => {
  test('counts every non-done task as open when columns are missing', () => {
    const tasks = [
      task('backlog', 'backlog', 1),
      task('next', 'next', 2),
      task('progress', 'progress', 3),
      task('done', 'done', 4),
    ];

    expect(countOpenTasks(tasks)).toBe(3);
    expect(countDoneTasks(tasks)).toBe(1);
  });

  test('counts done by final columns when the share includes them', () => {
    const tasks = [
      task('todo', 'todo', 1),
      task('shipped', 'shipped', 2),
      task('dropped', 'dropped', 3),
      task('planned', 'planned', 4),
    ];
    const columns = [
      { slug: 'todo', name: 'To do', position: 0, is_final: false },
      { slug: 'shipped', name: 'Shipped', position: 1, is_final: true },
      { slug: 'dropped', name: 'Dropped', position: 2, is_final: true },
    ];

    expect(countOpenTasks(tasks, columns)).toBe(2);
    expect(countDoneTasks(tasks, columns)).toBe(2);
  });
});

describe('groupPublicBoardTasks with workflow columns', () => {
  test('groups by the shared columns in position order', () => {
    const groups = groupPublicBoardTasks(
      [task('review-1', 'review', 1), task('todo-1', 'todo', 1)],
      [
        { slug: 'review', name: 'In review', position: 1, is_final: true },
        { slug: 'todo', name: 'To do', position: 0, is_final: false },
      ],
    );

    expect(groups.map((group) => group.status)).toEqual(['todo', 'review']);
    expect(groups.map((group) => group.label)).toEqual(['To do', 'In review']);
    expect(groups.map((group) => group.index)).toEqual(['01', '02']);
  });

  test('keeps a task whose status has no column instead of dropping it', () => {
    const groups = groupPublicBoardTasks(
      [task('planned-1', 'planned', 1), task('todo-1', 'todo', 1)],
      [{ slug: 'todo', name: 'To do', position: 0, is_final: false }],
    );

    expect(groups.map((group) => group.status)).toEqual(['todo', 'planned']);
    expect(groups[1]?.label).toBe('Planned');
  });
});

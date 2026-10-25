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
  test('counts every non-done task as open', () => {
    const tasks = [
      task('backlog', 'backlog', 1),
      task('next', 'next', 2),
      task('progress', 'progress', 3),
      task('done', 'done', 4),
    ];

    expect(countOpenTasks(tasks)).toBe(3);
    expect(countDoneTasks(tasks)).toBe(1);
  });
});

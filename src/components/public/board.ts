import { BOARD_COLUMNS } from '../board/board-config';
import type { PublicBoardTask } from '../../lib/public-sharing';

export interface PublicBoardGroup {
    status: PublicBoardTask['status'];
    label: string;
    index: string;
    tasks: PublicBoardTask[];
}

/**
 * Public board groups follow the same column order as the working board.
 * Empty columns are omitted so the shared page reads like a note instead of a
 * mostly empty kanban.
 */
export function groupPublicBoardTasks(tasks: PublicBoardTask[]): PublicBoardGroup[] {
    return BOARD_COLUMNS.map((column) => ({
        status: column.status,
        label: column.label,
        index: column.index,
        tasks: tasks
            .filter((task) => task.status === column.status)
            .sort((a, b) => a.board_order - b.board_order || a.title.localeCompare(b.title)),
    })).filter((group) => group.tasks.length > 0);
}

export function countOpenTasks(tasks: PublicBoardTask[]): number {
    return tasks.filter((task) => task.status !== 'done').length;
}

export function countDoneTasks(tasks: PublicBoardTask[]): number {
    return tasks.filter((task) => task.status === 'done').length;
}

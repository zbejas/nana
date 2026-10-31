import { BOARD_COLUMNS } from '../board/board-config';
import type { PublicBoardColumn, PublicBoardTask } from '../../lib/public-sharing';

export interface PublicBoardGroup {
    status: string;
    label: string;
    index: string;
    tasks: PublicBoardTask[];
}

function sortTasks(tasks: PublicBoardTask[]): PublicBoardTask[] {
    return [...tasks].sort(
        (a, b) => a.board_order - b.board_order || a.title.localeCompare(b.title),
    );
}

function padIndex(index: number): string {
    return String(index + 1).padStart(2, '0');
}

function fallbackLabel(status: string): string {
    if (status === 'planned') return 'Planned';
    if (status === 'archived') return 'Archived';
    const words = (status ?? '').replace(/[-_]+/g, ' ').trim();
    if (!words) return 'No status';
    return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Public board groups follow the board's workflow columns. If the share was
 * cached without columns (or the column query failed), the legacy fixed
 * columns keep the page readable. Statuses that match neither are appended so
 * a task is never silently dropped.
 */
export function groupPublicBoardTasks(
    tasks: PublicBoardTask[],
    columns: PublicBoardColumn[] = [],
): PublicBoardGroup[] {
    const ordered = [...columns].sort(
        (a, b) => a.position - b.position || a.name.localeCompare(b.name),
    );

    if (ordered.length === 0) {
        const groups: PublicBoardGroup[] = BOARD_COLUMNS.map((column, index) => ({
            status: column.status,
            label: column.label,
            index: padIndex(index),
            tasks: sortTasks(tasks.filter((task) => task.status === column.status)),
        }));

        const known = new Set(BOARD_COLUMNS.map((column) => column.status));
        for (const task of tasks) {
            if (known.has(task.status)) continue;
            known.add(task.status);
            groups.push({
                status: task.status,
                label: fallbackLabel(task.status),
                index: padIndex(groups.length),
                tasks: sortTasks(tasks.filter((item) => item.status === task.status)),
            });
        }

        return groups.filter((group) => group.tasks.length > 0);
    }

    const groups: PublicBoardGroup[] = ordered.map((column, index) => ({
        status: column.slug,
        label: column.name || fallbackLabel(column.slug),
        index: padIndex(index),
        tasks: sortTasks(tasks.filter((task) => task.status === column.slug)),
    }));

    const known = new Set(ordered.map((column) => column.slug));
    for (const task of tasks) {
        if (known.has(task.status)) continue;
        known.add(task.status);
        groups.push({
            status: task.status,
            label: fallbackLabel(task.status),
            index: padIndex(groups.length),
            tasks: sortTasks(tasks.filter((item) => item.status === task.status)),
        });
    }

    return groups.filter((group) => group.tasks.length > 0);
}

function finalStatuses(columns: PublicBoardColumn[] = []): Set<string> {
    if (columns.length === 0) return new Set(['done']);
    return new Set(
        columns.filter((column) => column.is_final).map((column) => column.slug),
    );
}

export function countOpenTasks(
    tasks: PublicBoardTask[],
    columns: PublicBoardColumn[] = [],
): number {
    const finals = finalStatuses(columns);
    return tasks.filter((task) => !finals.has(task.status)).length;
}

export function countDoneTasks(
    tasks: PublicBoardTask[],
    columns: PublicBoardColumn[] = [],
): number {
    const finals = finalStatuses(columns);
    return tasks.filter((task) => finals.has(task.status)).length;
}

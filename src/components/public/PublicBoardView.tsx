import { CalendarDaysIcon, CheckCircleIcon, LockClosedIcon } from '@heroicons/react/24/outline';
import type { PublicBoard, PublicBoardTask } from '../../lib/public-sharing';
import { MarkdownPreview } from '../MarkdownPreview';
import { Badge, EmptyState } from '../ui';
import { PRIORITY_CODES, PRIORITY_LABELS } from '../board/board-config';
import { groupPublicBoardTasks } from './board';

interface PublicBoardViewProps {
    board: PublicBoard;
    tasks: PublicBoardTask[];
}

function formatDueDate(value: string | null): string | null {
    if (!value) return null;

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;

    return parsed.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
}

function TaskRow({ task }: { task: PublicBoardTask }) {
    const dueDate = formatDueDate(task.due_date);
    const labels = task.labels.filter(Boolean);

    return (
        <li
            className={`rounded-[10px] border border-line bg-surface px-4 py-3.5 ${
                task.status === 'done' ? 'opacity-75' : ''
            }`}
        >
            <div className="flex items-start gap-2.5">
                {task.status === 'done' ? (
                    <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                ) : (
                    <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-ink-muted" aria-hidden="true" />
                )}
                <div className="min-w-0 flex-1">
                    <h3 className="text-[14px] font-medium leading-snug tracking-[-0.01em] text-ink">
                        {task.title || 'Untitled task'}
                    </h3>

                    {task.description && (
                        <p className="mt-1.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-secondary">
                            {task.description}
                        </p>
                    )}

                    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11.5px] text-ink-muted">
                        {task.priority && (
                            <span className="inline-flex items-center gap-1.5">
                                <span className="font-mono text-[10.5px] font-medium text-ink-secondary">
                                    {PRIORITY_CODES[task.priority]}
                                </span>
                                {PRIORITY_LABELS[task.priority]}
                            </span>
                        )}
                        {dueDate && (
                            <span className="inline-flex items-center gap-1">
                                <CalendarDaysIcon className="h-3 w-3" aria-hidden="true" />
                                {dueDate}
                            </span>
                        )}
                        {labels.map((label) => (
                            <Badge key={label} tone="outline" className="max-w-36 truncate">
                                {label}
                            </Badge>
                        ))}
                    </div>
                </div>
            </div>
        </li>
    );
}

/**
 * The public board surface. It reads top to bottom like a shared note:
 * description, then status sections and task rows. No drag handles, editing,
 * or private relation data.
 */
export function PublicBoardView({ board, tasks }: PublicBoardViewProps) {
    const groups = groupPublicBoardTasks(tasks);

    return (
        <main className="overflow-hidden rounded-panel border border-line bg-surface">
            <div className="public-content-enter px-5 py-8 sm:px-10 sm:py-12">
                {board.description && (
                    <MarkdownPreview content={board.description} className="text-ink-secondary" />
                )}

                {!board.description && (
                    <p className="text-[13px] leading-relaxed text-ink-muted">
                        A shared board of work from Nana.
                    </p>
                )}

                <div className={`${board.description ? 'mt-9' : 'mt-7'} space-y-8`}>
                    {groups.length === 0 ? (
                        <EmptyState
                            compact
                            title="No tasks yet"
                            description="This board is shared, but it has no work items on it yet."
                        />
                    ) : (
                        groups.map((group) => (
                            <section key={group.status} aria-label={`${group.label} tasks`}>
                                <div className="mb-3 flex items-center gap-3">
                                    <span className="font-mono text-[10.5px] font-medium tabular-nums text-ink-muted">
                                        {group.index}
                                    </span>
                                    <h2 className="text-[12.5px] font-semibold tracking-[-0.005em] text-ink-secondary">
                                        {group.label}
                                    </h2>
                                    <span className="text-[11.5px] font-medium tabular-nums text-ink-muted">
                                        {group.tasks.length}
                                    </span>
                                    <span className="h-px flex-1 bg-line" aria-hidden="true" />
                                </div>
                                <ul className="space-y-2">
                                    {group.tasks.map((task) => (
                                        <TaskRow key={task.id} task={task} />
                                    ))}
                                </ul>
                            </section>
                        ))
                    )}
                </div>

                <div className="mt-10 flex items-center gap-2 border-t border-line pt-5 text-[11.5px] text-ink-muted">
                    <LockClosedIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    Shared read-only. Task notes stay private to the owner.
                </div>
            </div>
        </main>
    );
}

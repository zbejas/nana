import { Fragment, useState } from 'react';
import {
  ArchiveBoxIcon,
  BoltIcon,
  CheckCircleIcon,
  EllipsisHorizontalIcon,
  EyeIcon,
  FlagIcon,
  InboxIcon,
  InboxStackIcon,
  PauseCircleIcon,
  PlayCircleIcon,
  PlusIcon,
  QueueListIcon,
} from '@heroicons/react/20/solid';
import type { BoardColumn } from '../../lib/boards';
import type { Task } from '../../lib/tasks';
import { IconButton, MenuItem, MenuSurface, cn } from '../ui';
import type { BoardDisplayPreferences } from '../../lib/board-preferences';
import type { BoardLabel, QuickField } from './board-config';
import { columnDotClass, normalizeColumnIcon } from './board-config';
import type { BoardMember } from './useBoardMetadata';
import { TaskCard } from './TaskCard';
import { TaskComposer } from './TaskComposer';
import type { DropTarget } from './useBoardState';

const COLUMN_GLYPHS = {
  dot: null,
  inbox: InboxIcon,
  queue: QueueListIcon,
  bolt: BoltIcon,
  check: CheckCircleIcon,
  flag: FlagIcon,
  pause: PauseCircleIcon,
  play: PlayCircleIcon,
  review: EyeIcon,
  archive: ArchiveBoxIcon,
} as const;

function ColumnGlyph({ icon }: { icon: string }) {
  const Glyph = COLUMN_GLYPHS[normalizeColumnIcon(icon)];
  if (!Glyph) return null;
  return <Glyph className="h-3.5 w-3.5 shrink-0 text-ink-muted" aria-hidden="true" />;
}

interface BoardViewProps {
  columns: BoardColumn[];
  grouped: Record<string, Task[]>;
  display: BoardDisplayPreferences;
  labels: BoardLabel[];
  members: BoardMember[];
  selection: Set<string>;
  selectionMode: boolean;
  draggingId: string | null;
  dropTarget: DropTarget | null;
  canDrag: boolean;
  canEdit?: boolean;
  composerStatus: string | null;
  filtering: boolean;
  onOpenTask: (task: Task) => void;
  onSelectTask: (task: Task, event: React.MouseEvent<HTMLElement>) => void;
  onOpenMenu: (task: Task, anchor: DOMRect, section?: QuickField) => void;
  onQuickPick: (task: Task, field: QuickField, anchor: DOMRect) => void;
  onOpenNote: (documentId: string) => void;
  onStartDrag: (task: Task) => void;
  onEndDrag: () => void;
  onDragOver: (status: string, index: number) => void;
  onDrop: (status: string, index: number) => void;
  onOpenComposer: (status?: string) => void;
  onCancelComposer: () => void;
  onCreateTask: (draft: Parameters<React.ComponentProps<typeof TaskComposer>['onSubmit']>[0]) => Promise<void>;
  onArchiveLane: (tasks: Task[]) => void;
  onClearFilters: () => void;
}

export function BoardView({
  columns,
  grouped,
  display,
  labels,
  members,
  selection,
  selectionMode,
  draggingId,
  dropTarget,
  canDrag,
  canEdit = true,
  composerStatus,
  filtering,
  onOpenTask,
  onSelectTask,
  onOpenMenu,
  onQuickPick,
  onOpenNote,
  onStartDrag,
  onEndDrag,
  onDragOver,
  onDrop,
  onOpenComposer,
  onCancelComposer,
  onCreateTask,
  onArchiveLane,
  onClearFilters,
}: BoardViewProps) {
  const [finalMenu, setFinalMenu] = useState<{ status: string; anchor: DOMRect } | null>(null);
  const laneCount = Math.max(1, columns.length);
  const laneWidth =
    laneCount <= 4
      ? `clamp(248px, calc((100% - ${(laneCount - 1) * 12}px) / ${laneCount}), 360px)`
      : 'clamp(272px, calc((100% - 36px) / 4), 360px)';

  if (columns.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
        <span className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-[8px] border border-line bg-surface-sunken text-ink-muted">
          <InboxStackIcon className="h-5 w-5" />
        </span>
        <h2 className="text-[17px] font-semibold text-ink">This board has no columns</h2>
        <p className="mt-1.5 max-w-[40ch] text-[13px] leading-relaxed text-ink-secondary">
          Add a workflow column in board settings, then tasks have a place to land.
        </p>
      </div>
    );
  }

  return (
    <div className="board-lane-row scrollbar-autohide" aria-label="Board columns">
      {columns.map((column) => {
        const tasks = grouped[column.slug] ?? [];
        const isDropColumn = dropTarget?.status === column.slug && Boolean(draggingId);
        const open = canEdit && composerStatus === column.slug;
        const finalColumn = column.is_final;

        return (
          <section
            key={column.id || column.slug}
            aria-label={`${column.name} column`}
            className="board-lane"
            data-drop-active={isDropColumn || undefined}
            style={{ width: laneWidth }}
            onDragOver={(event) => {
              if (!canDrag || !draggingId) return;
              event.preventDefault();
              onDragOver(column.slug, tasks.length);
            }}
            onDrop={(event) => {
              if (!canDrag || !draggingId) return;
              event.preventDefault();
              const index =
                dropTarget?.status === column.slug ? dropTarget.index : tasks.length;
              onDrop(column.slug, index);
            }}
          >
            <header className="board-lane-header">
              <span
                className={cn(
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  columnDotClass(finalColumn ? 'success' : column.color),
                )}
                aria-hidden="true"
              />
              <ColumnGlyph icon={column.icon} />
              <h2 className="min-w-0 truncate text-[12px] font-semibold tracking-[-0.005em] text-ink">
                {column.name}
              </h2>
              <span className="shrink-0 text-[11px] font-medium tabular-nums text-ink-muted">
                {tasks.length}
              </span>
              {canEdit && (
                <div className="ml-auto flex items-center gap-0.5">
                  <IconButton
                    label={`Add task to ${column.name}`}
                    size="sm"
                    className="h-8 w-8 text-ink-muted md:h-7 md:w-7 [&>svg]:h-4 [&>svg]:w-4"
                    onClick={() => onOpenComposer(column.slug)}
                  >
                    <PlusIcon />
                  </IconButton>
                  {finalColumn && (
                    <IconButton
                      label={`${column.name} column actions`}
                      size="sm"
                      className="h-8 w-8 text-ink-muted md:h-7 md:w-7 [&>svg]:h-4 [&>svg]:w-4"
                      aria-expanded={finalMenu?.status === column.slug}
                      onClick={(event) =>
                        setFinalMenu({
                          status: column.slug,
                          anchor: event.currentTarget.getBoundingClientRect(),
                        })
                      }
                    >
                      <EllipsisHorizontalIcon />
                    </IconButton>
                  )}
                </div>
              )}
            </header>

            <div className="board-lane-body scrollbar-autohide">
              {open && (
                <TaskComposer
                  status={column.slug}
                  columns={columns}
                  autoFocus
                  onCancel={onCancelComposer}
                  onSubmit={async (draft) => {
                    await onCreateTask(draft);
                    onCancelComposer();
                  }}
                />
              )}

              {tasks.map((task, index) => (
                <Fragment key={task.id}>
                  {isDropColumn && dropTarget?.index === index && (
                    <div className="board-insertion-line" aria-hidden="true" />
                  )}
                  <div className={cn(index > 0 || open ? 'mt-2' : undefined)}>
                    <TaskCard
                      task={task}
                      index={index}
                      isDone={finalColumn}
                      selected={selection.has(task.id)}
                      selectionMode={selectionMode}
                      draggable={canDrag}
                      isDragging={draggingId === task.id}
                      display={display}
                      labels={labels}
                      members={members}
                      onOpen={() => onOpenTask(task)}
                      onSelect={(event) => onSelectTask(task, event)}
                      onMenu={(anchor, section) => onOpenMenu(task, anchor, section)}
                      onQuickPick={(field, anchor) => onQuickPick(task, field, anchor)}
                      onOpenNote={onOpenNote}
                      onLongPress={(anchor) => onOpenMenu(task, anchor)}
                      onDragStart={() => onStartDrag(task)}
                      onDragEnd={onEndDrag}
                      onDragOver={(target) => onDragOver(column.slug, target)}
                    />
                  </div>
                </Fragment>
              ))}

              {isDropColumn && dropTarget?.index === tasks.length && (
                <div className="board-insertion-line" aria-hidden="true" />
              )}

              {tasks.length === 0 && !open && (
                <div className="board-empty-lane">
                  {filtering ? (
                    <>
                      <p>No tasks match these filters.</p>
                      <button
                        type="button"
                        onClick={onClearFilters}
                        className="mt-2 text-[11.5px] font-medium text-signal hover:text-signal-strong"
                      >
                        Clear filters
                      </button>
                    </>
                  ) : (
                    <p>
                      Nothing here yet.
                      {canEdit && (
                        <>
                          <br />
                          Add a task to {column.name.toLowerCase()}.
                        </>
                      )}
                    </p>
                  )}
                </div>
              )}

              {tasks.length === 0 && open && <div className="h-1" aria-hidden="true" />}
            </div>

            {!open && canEdit && (
              <div className="board-lane-footer">
                <button
                  type="button"
                  onClick={() => onOpenComposer(column.slug)}
                  className="flex h-9 w-full items-center gap-1.5 rounded-[6px] px-1.5 text-left text-[12px] font-medium text-ink-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal md:h-8"
                >
                  <PlusIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  Add task
                </button>
              </div>
            )}
          </section>
        );
      })}

      <MenuSurface
        open={finalMenu !== null}
        onClose={() => setFinalMenu(null)}
        position={
          finalMenu
            ? {
                left: Math.max(8, Math.min(finalMenu.anchor.left - 120, window.innerWidth - 216)),
                top: finalMenu.anchor.bottom + 6,
              }
            : { left: 0, top: 0 }
        }
        ariaLabel="Column actions"
      >
        <MenuItem
          label="Archive all tasks"
          disabled={!finalMenu || (grouped[finalMenu.status]?.length ?? 0) === 0}
          onClick={() => {
            if (!finalMenu) return;
            onArchiveLane(grouped[finalMenu.status] ?? []);
            setFinalMenu(null);
          }}
        />
      </MenuSurface>
    </div>
  );
}

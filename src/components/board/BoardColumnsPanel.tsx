import { useEffect, useState } from 'react';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/20/solid';
import {
  createBoardColumn,
  deleteBoardColumn,
  reorderBoardColumns,
  updateBoardColumn,
  type BoardColumn,
} from '../../lib/boards';
import { Button, ConfirmDialog, IconButton, Input, Select, cn } from '../ui';
import {
  COLUMN_COLORS,
  COLUMN_ICONS,
  COLUMN_ICON_LABELS,
  columnDotClass,
  normalizeColumnColor,
  normalizeColumnIcon,
} from './board-config';

interface BoardColumnsPanelProps {
  boardId: string;
  columns: BoardColumn[];
  taskCounts: Record<string, number>;
  onChanged: () => void | Promise<void>;
}

export function BoardColumnsPanel({ boardId, columns, taskCounts, onChanged }: BoardColumnsPanelProps) {
  const [rows, setRows] = useState(columns);
  const [newName, setNewName] = useState('');
  const [newIcon, setNewIcon] = useState('dot');
  const [newColor, setNewColor] = useState('muted');
  const [newFinal, setNewFinal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BoardColumn | null>(null);

  useEffect(() => {
    setRows(columns);
  }, [columns]);

  const replace = (next: BoardColumn) => {
    setRows((current) => current.map((column) => (column.id === next.id ? next : column)));
  };

  const addColumn = async () => {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy('new');
    setError(null);
    try {
      const created = await createBoardColumn(boardId, {
        name,
        icon: newIcon,
        color: newColor,
        is_final: newFinal,
      });
      setRows((current) => [...current, created]);
      setNewName('');
      setNewIcon('dot');
      setNewColor('muted');
      setNewFinal(false);
      await onChanged();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not add the column.');
    } finally {
      setBusy(null);
    }
  };

  const rename = async (column: BoardColumn) => {
    const name = editName.trim();
    if (!name || name === column.name) {
      setEditingId(null);
      return;
    }
    setBusy(column.id);
    setError(null);
    try {
      replace(await updateBoardColumn(column.id, { name }));
      setEditingId(null);
      await onChanged();
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : 'Could not rename the column.');
    } finally {
      setBusy(null);
    }
  };

  const patchColumn = async (column: BoardColumn, patch: { icon?: string; color?: string; is_final?: boolean }) => {
    setBusy(column.id);
    setError(null);
    try {
      replace(await updateBoardColumn(column.id, patch));
      await onChanged();
    } catch (patchError) {
      setError(patchError instanceof Error ? patchError.message : 'Could not update the column.');
    } finally {
      setBusy(null);
    }
  };

  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(target, 0, moved);
    setRows(next);
    setBusy('reorder');
    setError(null);
    try {
      await reorderBoardColumns(boardId, next.map((column) => column.id));
      await onChanged();
    } catch (reorderError) {
      setRows(rows);
      setError(reorderError instanceof Error ? reorderError.message : 'Could not reorder the columns.');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (column: BoardColumn) => {
    setBusy(column.id);
    setError(null);
    try {
      await deleteBoardColumn(column.id);
      setRows((current) => current.filter((candidate) => candidate.id !== column.id));
      setDeleteTarget(null);
      await onChanged();
    } catch (deleteError) {
      setDeleteTarget(null);
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete the column.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-3 border-t border-line pt-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-[13px] font-semibold text-ink">Workflow columns</h3>
          <p className="mt-1 max-w-[54ch] text-[11.5px] leading-relaxed text-ink-muted">
            Columns are the board's statuses. One or more can be final; moving a task into a final column completes it.
          </p>
        </div>
        <span className="shrink-0 text-[11px] tabular-nums text-ink-muted">{rows.length}</span>
      </div>

      <ol className="space-y-1.5">
        {rows.map((column, index) => {
          const used = taskCounts[column.slug] ?? 0;
          const editing = editingId === column.id;
          const canDelete = used === 0 && rows.length > 1;
          return (
            <li
              key={column.id}
              className="flex flex-wrap items-center gap-1.5 rounded-control border border-line bg-surface-sunken px-2 py-1.5"
            >
              <div className="flex flex-col">
                <IconButton
                  label={`Move ${column.name} up`}
                  size="sm"
                  className="h-5 w-6"
                  disabled={index === 0 || busy !== null}
                  onClick={() => void move(index, -1)}
                >
                  <ArrowUpIcon className="h-3 w-3" />
                </IconButton>
                <IconButton
                  label={`Move ${column.name} down`}
                  size="sm"
                  className="h-5 w-6"
                  disabled={index === rows.length - 1 || busy !== null}
                  onClick={() => void move(index, 1)}
                >
                  <ArrowDownIcon className="h-3 w-3" />
                </IconButton>
              </div>

              <span className={cn('h-2 w-2 shrink-0 rounded-full', columnDotClass(column.color))} aria-hidden="true" />

              {editing ? (
                <Input
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void rename(column);
                    }
                    if (event.key === 'Escape') setEditingId(null);
                  }}
                  aria-label={`Rename ${column.name}`}
                  autoFocus
                  className="h-8 min-w-0 flex-1 px-2 text-[12.5px]"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(column.id);
                    setEditName(column.name);
                  }}
                  className="min-w-0 flex-1 truncate text-left text-[12.5px] font-medium text-ink hover:text-signal"
                >
                  {column.name}
                  <span className="ml-2 text-[10.5px] font-normal tabular-nums text-ink-muted">
                    {used} {used === 1 ? 'task' : 'tasks'}
                  </span>
                </button>
              )}

              {editing ? (
                <>
                  <IconButton
                    label="Save column name"
                    size="sm"
                    className="h-8 w-8"
                    disabled={busy !== null}
                    onClick={() => void rename(column)}
                  >
                    <CheckIcon className="h-4 w-4" />
                  </IconButton>
                  <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => setEditingId(null)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Select
                    value={normalizeColumnIcon(column.icon)}
                    onChange={(event) => void patchColumn(column, { icon: event.target.value })}
                    aria-label={`${column.name} icon`}
                    className="h-8 w-[6.5rem] px-2 text-[11.5px]"
                    disabled={busy !== null}
                  >
                    {COLUMN_ICONS.map((icon) => (
                      <option key={icon} value={icon}>
                        {COLUMN_ICON_LABELS[icon]}
                      </option>
                    ))}
                  </Select>
                  <Select
                    value={normalizeColumnColor(column.color)}
                    onChange={(event) => void patchColumn(column, { color: event.target.value })}
                    aria-label={`${column.name} colour`}
                    className="h-8 w-[6.5rem] px-2 text-[11.5px]"
                    disabled={busy !== null}
                  >
                    {COLUMN_COLORS.map((color) => (
                      <option key={color.value} value={color.value}>
                        {color.label}
                      </option>
                    ))}
                  </Select>
                  <button
                    type="button"
                    aria-pressed={column.is_final}
                    onClick={() => void patchColumn(column, { is_final: !column.is_final })}
                    disabled={busy !== null}
                    className={cn(
                      'inline-flex h-8 items-center gap-1.5 rounded-control border px-2 text-[11px] font-medium transition-colors',
                      column.is_final
                        ? 'border-success/35 bg-success-soft text-success'
                        : 'border-line bg-surface text-ink-muted hover:text-ink',
                    )}
                    title="Final columns complete tasks"
                  >
                    <span className={cn('h-1.5 w-1.5 rounded-full', column.is_final ? 'bg-success' : 'bg-ink-muted')} />
                    Final
                  </button>
                  <IconButton
                    label={canDelete ? `Delete ${column.name}` : `${column.name} cannot be deleted while it has tasks`}
                    size="sm"
                    className="h-8 w-8 text-ink-muted hover:bg-danger-soft hover:text-danger"
                    disabled={!canDelete || busy !== null}
                    onClick={() => setDeleteTarget(column)}
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </IconButton>
                  <IconButton
                    label={`Rename ${column.name}`}
                    size="sm"
                    className="h-8 w-8"
                    onClick={() => {
                      setEditingId(column.id);
                      setEditName(column.name);
                    }}
                  >
                    <PencilIcon className="h-3.5 w-3.5" />
                  </IconButton>
                </>
              )}
            </li>
          );
        })}
      </ol>

      <div className="rounded-control border border-dashed border-line p-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void addColumn();
              }
            }}
            placeholder="New column name"
            aria-label="New column name"
            maxLength={80}
            className="h-9 min-w-[9rem] flex-1 px-2.5 text-[12.5px]"
          />
          <Select
            value={newIcon}
            onChange={(event) => setNewIcon(event.target.value)}
            aria-label="New column icon"
            className="h-9 w-[6.5rem] px-2 text-[11.5px]"
          >
            {COLUMN_ICONS.map((icon) => (
              <option key={icon} value={icon}>
                {COLUMN_ICON_LABELS[icon]}
              </option>
            ))}
          </Select>
          <Select
            value={newColor}
            onChange={(event) => setNewColor(event.target.value)}
            aria-label="New column colour"
            className="h-9 w-[6.5rem] px-2 text-[11.5px]"
          >
            {COLUMN_COLORS.map((color) => (
              <option key={color.value} value={color.value}>
                {color.label}
              </option>
            ))}
          </Select>
          <button
            type="button"
            aria-pressed={newFinal}
            onClick={() => setNewFinal((value) => !value)}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-control border px-2 text-[11px] font-medium transition-colors',
              newFinal
                ? 'border-success/35 bg-success-soft text-success'
                : 'border-line bg-surface text-ink-muted hover:text-ink',
            )}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', newFinal ? 'bg-success' : 'bg-ink-muted')} />
            Final
          </button>
          <Button
            variant="secondary"
            size="sm"
            className="h-9 px-2.5"
            icon={<PlusIcon />}
            disabled={!newName.trim() || busy !== null}
            loading={busy === 'new'}
            onClick={() => void addColumn()}
          >
            Add column
          </Button>
        </div>
        <p className="mt-2 text-[10.5px] leading-relaxed text-ink-muted">
          Column keys are fixed once created, so renaming a column never moves its tasks. A column with tasks cannot be deleted until those tasks move.
        </p>
      </div>

      {error && (
        <p className="text-[11.5px] leading-relaxed text-danger" role="alert">
          {error}
        </p>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`Delete “${deleteTarget?.name ?? 'column'}”?`}
        description="The column is removed from the workflow. This is only possible when no tasks reference it."
        confirmLabel="Delete column"
        tone="danger"
        busy={Boolean(deleteTarget && busy === deleteTarget.id)}
        onConfirm={() => {
          if (deleteTarget) void remove(deleteTarget);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}

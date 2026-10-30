import {
  CheckIcon,
  FunnelIcon,
  XMarkIcon,
} from '@heroicons/react/20/solid';
import type { BoardColumn } from '../../lib/boards';
import type { TaskPriority } from '../../lib/tasks';
import {
  BOARD_SORTS,
  DUE_FILTERS,
  FILTER_SUBJECTS,
  activeFilterCount,
  filterChips,
  removeFilterValue,
  type BoardDisplayPreferences,
  type BoardFilterState,
  type BoardSort,
  type BoardView,
  type FilterChip,
  type FilterSubject,
  type SortDirection,
} from '../../lib/board-preferences';
import { Button, SegmentedControl, Switch, cn } from '../ui';
import type { BoardMember } from './useBoardMetadata';
import { PRIORITIES, columnDotClass, labelDotClass, type BoardLabel } from './board-config';

const SUBJECT_LABELS: Record<FilterSubject, string> = {
  status: 'Status',
  priority: 'Priority',
  assignee: 'Assignee',
  due: 'Due date',
  labels: 'Labels',
};

const SORT_LABELS: Record<BoardSort, string> = {
  manual: 'Manual',
  priority: 'Priority',
  due: 'Due date',
  created: 'Created',
  updated: 'Updated',
  title: 'Title',
};

const DUE_LABELS: Record<(typeof DUE_FILTERS)[number], string> = {
  overdue: 'Overdue',
  today: 'Due today',
  week: 'Due this week',
  none: 'No due date',
};

function ToggleOption({
  label,
  checked,
  onClick,
  leading,
}: {
  label: string;
  checked: boolean;
  onClick: () => void;
  leading?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={onClick}
      className={cn(
        'flex min-h-8 w-full items-center gap-2 rounded-[4px] px-2 py-1 text-left text-[12px] transition-colors hover:bg-surface-sunken',
        checked ? 'text-ink' : 'text-ink-secondary',
      )}
    >
      <span
        className={cn(
          'inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border',
          checked ? 'border-signal bg-signal-bright text-on-signal' : 'border-line-strong bg-surface',
        )}
        aria-hidden="true"
      >
        {checked && <CheckIcon className="h-2.5 w-2.5" />}
      </span>
      {leading}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

function SubjectSection({
  subject,
  children,
  filters,
  onNegate,
}: {
  subject: FilterSubject;
  children: React.ReactNode;
  filters: BoardFilterState;
  onNegate: (subject: FilterSubject, value: boolean) => void;
}) {
  return (
    <section>
      <div className="flex items-center justify-between px-2 pb-1 pt-2">
        <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
          {SUBJECT_LABELS[subject]}
        </h3>
        <button
          type="button"
          aria-pressed={filters.negate[subject]}
          onClick={() => onNegate(subject, !filters.negate[subject])}
          className={cn(
            'inline-flex h-5 items-center rounded-[4px] border px-1.5 text-[10px] font-medium transition-colors',
            filters.negate[subject]
              ? 'border-danger/30 bg-danger-soft text-danger'
              : 'border-line bg-surface text-ink-muted hover:text-ink',
          )}
          title={filters.negate[subject] ? 'Matches are excluded' : 'Matches are included'}
        >
          {filters.negate[subject] ? 'Is not' : 'Is'}
        </button>
      </div>
      {children}
    </section>
  );
}

function toggleValue(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
}

interface FilterPanelProps {
  filters: BoardFilterState;
  columns: BoardColumn[];
  members: BoardMember[];
  labels: BoardLabel[];
  onChange: (filters: BoardFilterState) => void;
  onClear: () => void;
}

export function FilterPanel({
  filters,
  columns,
  members,
  labels,
  onChange,
  onClear,
}: FilterPanelProps) {
  const patch = (next: Partial<BoardFilterState>) => onChange({ ...filters, ...next });
  const count = activeFilterCount(filters);

  return (
    <div className="w-full">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-ink">
          <FunnelIcon className="h-3.5 w-3.5 text-ink-muted" />
          Filters
        </span>
        <button
          type="button"
          onClick={onClear}
          disabled={count === 0}
          className="rounded-control px-1.5 py-0.5 text-[11px] font-medium text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink disabled:opacity-40"
        >
          Clear all
        </button>
      </div>

      <div className="max-h-[min(32rem,65vh)] overflow-y-auto p-1.5 scrollbar-autohide">
        <SubjectSection
          subject="status"
          filters={filters}
          onNegate={(subject, value) => patch({ negate: { ...filters.negate, [subject]: value } })}
        >
          {columns.map((column) => (
            <ToggleOption
              key={column.slug}
              label={column.name}
              checked={filters.status.includes(column.slug)}
              onClick={() => patch({ status: toggleValue(filters.status, column.slug) })}
              leading={<span className={cn('h-1.5 w-1.5 rounded-full', columnDotClass(column.color))} />}
            />
          ))}
          <ToggleOption
            label="Planned"
            checked={filters.status.includes('planned')}
            onClick={() => patch({ status: toggleValue(filters.status, 'planned') })}
          />
          <ToggleOption
            label="Archived"
            checked={filters.status.includes('archived')}
            onClick={() => patch({ status: toggleValue(filters.status, 'archived') })}
          />
        </SubjectSection>

        <SubjectSection
          subject="priority"
          filters={filters}
          onNegate={(subject, value) => patch({ negate: { ...filters.negate, [subject]: value } })}
        >
          <ToggleOption
            label="No priority"
            checked={filters.priority.includes('none')}
            onClick={() => patch({ priority: toggleValue(filters.priority, 'none') })}
          />
          {PRIORITIES.map((priority) => (
            <ToggleOption
              key={priority.value}
              label={priority.label}
              checked={filters.priority.includes(priority.value as TaskPriority)}
              onClick={() => patch({ priority: toggleValue(filters.priority, priority.value) })}
            />
          ))}
        </SubjectSection>

        <SubjectSection
          subject="assignee"
          filters={filters}
          onNegate={(subject, value) => patch({ negate: { ...filters.negate, [subject]: value } })}
        >
          <ToggleOption
            label="Unassigned"
            checked={filters.assignee.includes('unassigned')}
            onClick={() => patch({ assignee: toggleValue(filters.assignee, 'unassigned') })}
          />
          {members.map((member) => (
            <ToggleOption
              key={member.id}
              label={member.name}
              checked={filters.assignee.includes(member.id)}
              onClick={() => patch({ assignee: toggleValue(filters.assignee, member.id) })}
            />
          ))}
        </SubjectSection>

        <SubjectSection
          subject="due"
          filters={filters}
          onNegate={(subject, value) => patch({ negate: { ...filters.negate, [subject]: value } })}
        >
          {DUE_FILTERS.map((due) => (
            <ToggleOption
              key={due}
              label={DUE_LABELS[due]}
              checked={filters.due.includes(due)}
              onClick={() => patch({ due: toggleValue(filters.due, due) as BoardFilterState['due'] })}
            />
          ))}
        </SubjectSection>

        <SubjectSection
          subject="labels"
          filters={filters}
          onNegate={(subject, value) => patch({ negate: { ...filters.negate, [subject]: value } })}
        >
          <div className="mb-1.5 px-2">
            <SegmentedControl
              value={filters.labelMode}
              onChange={(value) => patch({ labelMode: value })}
              options={[
                { value: 'any', label: 'Any' },
                { value: 'all', label: 'All' },
              ]}
              label="Label matching"
              size="sm"
            />
          </div>
          {labels.length === 0 && (
            <p className="px-2 pb-2 text-[11px] leading-relaxed text-ink-muted">
              No label definitions yet. Add labels from a task card.
            </p>
          )}
          {labels.map((label) => (
            <ToggleOption
              key={label.id || label.name}
              label={label.name}
              checked={filters.labels.includes(label.name)}
              onClick={() => patch({ labels: toggleValue(filters.labels, label.name) })}
              leading={<span className={cn('h-1.5 w-1.5 rounded-full', labelDotClass(label.color))} />}
            />
          ))}
        </SubjectSection>
      </div>
    </div>
  );
}

export function FilterChipRow({
  filters,
  columns,
  members = [],
  query,
  resultCount,
  totalCount,
  onRemove,
  onClearSearch,
  onClearAll,
}: {
  filters: BoardFilterState;
  columns: BoardColumn[];
  members?: BoardMember[];
  query: string;
  resultCount: number;
  totalCount: number;
  onRemove: (subject: FilterSubject, value: string) => void;
  onClearSearch: () => void;
  onClearAll: () => void;
}) {
  const membersById = new Map(members.map((member) => [member.id, member.name]));
  const chips: FilterChip[] = [
    ...(query.trim()
      ? [
          {
            subject: 'status' as FilterSubject,
            value: '__query__',
            label: `Search: ${query.trim()}`,
            negated: false,
          },
        ]
      : []),
    ...filterChips(filters, columns).map((chip) =>
      chip.subject === 'assignee' && chip.value !== 'unassigned'
        ? { ...chip, label: membersById.get(chip.value) ?? chip.label }
        : chip,
    ),
  ];

  if (chips.length === 0) {
    return (
      <p className="text-[11px] tabular-nums text-ink-muted">
        {resultCount} {resultCount === 1 ? 'task' : 'tasks'}
      </p>
    );
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="text-[11px] tabular-nums text-ink-muted">
        {resultCount} of {totalCount}
      </span>
      {chips.map((chip) => (
        <span key={`${chip.subject}-${chip.value}`} className="board-filter-chip">
          {chip.negated && <span className="font-semibold text-danger">Not</span>}
          <span className="max-w-[12rem] truncate">{chip.label}</span>
          <button
            type="button"
            aria-label={`Remove ${chip.label} filter`}
            onClick={() => {
              if (chip.value === '__query__') onClearSearch();
              else onRemove(chip.subject, chip.value);
            }}
          >
            <XMarkIcon className="h-3 w-3" />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="rounded-control px-1.5 py-0.5 text-[11px] font-medium text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
      >
        Clear all
      </button>
    </div>
  );
}

export function SortPanel({
  sort,
  direction,
  onChange,
  onDirectionChange,
  dragEnabled,
  onResetFilters,
}: {
  sort: BoardSort;
  direction: SortDirection;
  onChange: (sort: BoardSort) => void;
  onDirectionChange: (direction: SortDirection) => void;
  dragEnabled: boolean;
  onResetFilters?: () => void;
}) {
  return (
    <div className="w-full">
      <div className="border-b border-line px-3 py-2">
        <span className="text-[12px] font-semibold text-ink">Sort</span>
      </div>
      <div className="p-1.5">
        {BOARD_SORTS.map((option) => (
          <ToggleOption
            key={option}
            label={SORT_LABELS[option]}
            checked={sort === option}
            onClick={() => onChange(option)}
          />
        ))}
        {sort !== 'manual' && (
          <div className="mt-2 border-t border-line pt-2">
            <SegmentedControl
              value={direction}
              onChange={onDirectionChange}
              options={[
                { value: 'asc', label: 'Ascending' },
                { value: 'desc', label: 'Descending' },
              ]}
              label="Sort direction"
              size="sm"
              className="w-full justify-center"
            />
          </div>
        )}
      </div>
      {!dragEnabled && (
        <div className="border-t border-line px-3 py-2 text-[11px] leading-relaxed text-ink-muted">
          Dragging is paused while filters, search, or another sort are active.
          {onResetFilters && (
            <button
              type="button"
              onClick={onResetFilters}
              className="ml-1 font-medium text-signal hover:text-signal-strong"
            >
              Reset to manual
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const DISPLAY_LABELS: Array<{ key: keyof BoardDisplayPreferences; label: string }> = [
  { key: 'priority', label: 'Priority' },
  { key: 'dates', label: 'Dates' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'labels', label: 'Labels' },
  { key: 'subtasks', label: 'Subtask progress' },
  { key: 'comments', label: 'Comment count' },
  { key: 'note', label: 'Linked note' },
];

export function DisplayPanel({
  display,
  onChange,
}: {
  display: BoardDisplayPreferences;
  onChange: (display: BoardDisplayPreferences) => void;
}) {
  return (
    <div className="w-full">
      <div className="border-b border-line px-3 py-2">
        <span className="text-[12px] font-semibold text-ink">Display</span>
      </div>
      <div className="space-y-3 p-3">
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            className="h-7 px-2"
            onClick={() =>
              onChange({
                priority: true,
                dates: true,
                assignee: true,
                labels: true,
                subtasks: true,
                comments: true,
                note: true,
              })
            }
          >
            Show all
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() =>
              onChange({
                priority: false,
                dates: false,
                assignee: false,
                labels: false,
                subtasks: false,
                comments: false,
                note: false,
              })
            }
          >
            Cards only
          </Button>
        </div>
        {DISPLAY_LABELS.map((item) => (
          <Switch
            key={item.key}
            id={`display-${item.key}`}
            label={item.label}
            checked={display[item.key]}
            onChange={(checked) => onChange({ ...display, [item.key]: checked })}
          />
        ))}
        <p className="text-[10.5px] leading-relaxed text-ink-muted">
          List view keeps its property columns; these toggles control card and row metadata.
        </p>
      </div>
    </div>
  );
}

export function PreferencesSections({
  filters,
  columns,
  members,
  labels,
  onFiltersChange,
  onClearFilters,
  sort,
  direction,
  onSortChange,
  onDirectionChange,
  dragEnabled,
  onResetToManual,
  display,
  onDisplayChange,
}: {
  filters: BoardFilterState;
  columns: BoardColumn[];
  members: BoardMember[];
  labels: BoardLabel[];
  onFiltersChange: (filters: BoardFilterState) => void;
  onClearFilters: () => void;
  sort: BoardSort;
  direction: SortDirection;
  onSortChange: (sort: BoardSort) => void;
  onDirectionChange: (direction: SortDirection) => void;
  dragEnabled: boolean;
  onResetToManual: () => void;
  display: BoardDisplayPreferences;
  onDisplayChange: (display: BoardDisplayPreferences) => void;
}) {
  return (
    <div className="divide-y divide-line">
      <FilterPanel
        filters={filters}
        columns={columns}
        members={members}
        labels={labels}
        onChange={onFiltersChange}
        onClear={onClearFilters}
      />
      <SortPanel
        sort={sort}
        direction={direction}
        onChange={onSortChange}
        onDirectionChange={onDirectionChange}
        dragEnabled={dragEnabled}
        onResetFilters={onResetToManual}
      />
      <DisplayPanel display={display} onChange={onDisplayChange} />
    </div>
  );
}

export function resetToManual(filters: BoardFilterState): BoardFilterState {
  return {
    ...filters,
    status: [],
    priority: [],
    assignee: [],
    due: [],
    labels: [],
  };
}

/** Kept for callers that want to clear one chip without importing the predicate. */
export function withoutFilter(filters: BoardFilterState, subject: FilterSubject, value: string): BoardFilterState {
  return removeFilterValue(filters, subject, value);
}

export const FILTER_SUBJECT_LIST = FILTER_SUBJECTS;

export type { BoardView };

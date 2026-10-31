import { useRef, useState } from 'react';
import {
  AdjustmentsHorizontalIcon,
  ArrowsUpDownIcon,
  CalendarDaysIcon,
  ChartBarIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  FunnelIcon,
  ListBulletIcon,
  MagnifyingGlassIcon,
  QuestionMarkCircleIcon,
  QueueListIcon,
  ViewColumnsIcon,
  XMarkIcon,
} from '@heroicons/react/20/solid';
import type { BoardColumn } from '../../lib/boards';
import {
  activeFilterCount,
  type BoardDisplayPreferences,
  type BoardFilterState,
  type BoardSort,
  type BoardView,
  type FilterSubject,
  type SortDirection,
} from '../../lib/board-preferences';
import { Button, IconButton, Input, MenuSurface, Sheet, cn } from '../ui';
import type { BoardMember } from './useBoardMetadata';
import type { BoardLabel } from './board-config';
import {
  DisplayPanel,
  FilterChipRow,
  FilterPanel,
  SortPanel,
} from './BoardFilters';
import { menuPositionFromRect, useIsMobile } from './TaskQuickPickers';

const VIEW_OPTIONS: Array<{
  value: BoardView;
  label: string;
  icon: React.ReactNode;
}> = [
  { value: 'board', label: 'Board', icon: <ViewColumnsIcon /> },
  { value: 'list', label: 'List', icon: <ListBulletIcon /> },
  { value: 'backlog', label: 'Backlog', icon: <QueueListIcon /> },
  { value: 'calendar', label: 'Calendar', icon: <CalendarDaysIcon /> },
  { value: 'gantt', label: 'Gantt', icon: <ChartBarIcon /> },
];

type Panel = 'filter' | 'sort' | 'display' | null;

interface BoardToolbarProps {
  view: BoardView;
  onViewChange: (view: BoardView) => void;
  query: string;
  onQueryChange: (query: string) => void;
  searchRef?: React.RefObject<HTMLInputElement | null>;
  filters: BoardFilterState;
  columns: BoardColumn[];
  members: BoardMember[];
  labels: BoardLabel[];
  sort: BoardSort;
  direction: SortDirection;
  display: BoardDisplayPreferences;
  resultCount: number;
  totalCount: number;
  dragEnabled: boolean;
  selectionMode: boolean;
  canSelect: boolean;
  onToggleSelectionMode: () => void;
  onFiltersChange: (filters: BoardFilterState) => void;
  onClearFilters: () => void;
  onClearAll: () => void;
  onSortChange: (sort: BoardSort) => void;
  onDirectionChange: (direction: SortDirection) => void;
  onDisplayChange: (display: BoardDisplayPreferences) => void;
  onResetToManual: () => void;
  onRemoveFilter: (subject: FilterSubject, value: string) => void;
  onClearSearch: () => void;
  onOpenShortcuts: () => void;
}

export function BoardToolbar({
  view,
  onViewChange,
  query,
  onQueryChange,
  searchRef,
  filters,
  columns,
  members,
  labels,
  sort,
  direction,
  display,
  resultCount,
  totalCount,
  dragEnabled,
  selectionMode,
  canSelect,
  onToggleSelectionMode,
  onFiltersChange,
  onClearFilters,
  onClearAll,
  onSortChange,
  onDirectionChange,
  onDisplayChange,
  onResetToManual,
  onRemoveFilter,
  onClearSearch,
  onOpenShortcuts,
}: BoardToolbarProps) {
  const isMobile = useIsMobile();
  const [panel, setPanel] = useState<Panel>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetSection, setSheetSection] = useState<'filter' | 'sort' | 'display'>('filter');
  const internalSearchRef = useRef<HTMLInputElement>(null);
  const filterCount = activeFilterCount(filters) + (query.trim() ? 1 : 0);

  const openPanel = (next: Exclude<Panel, null>, element: HTMLElement) => {
    if (isMobile) {
      setSheetSection(next);
      setSheetOpen(true);
      return;
    }
    setAnchor(element.getBoundingClientRect());
    setPanel((current) => (current === next ? null : next));
  };

  return (
    <>
      <div className="board-toolbar">
        <div className="board-view-switcher-shell">
          <div className="board-view-switcher" role="group" aria-label="Board view">
            {VIEW_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={view === option.value}
                onClick={() => onViewChange(option.value)}
                className="[&>svg]:h-3.5 [&>svg]:w-3.5"
              >
                {option.icon}
                <span>{option.label}</span>
              </button>
            ))}
          </div>
          <span className="board-view-switcher-cue" aria-hidden="true">
            <ChevronRightIcon className="h-3.5 w-3.5" />
          </span>
        </div>

        <div className="w-full sm:ml-auto sm:w-auto">
          <Input
            ref={searchRef ?? internalSearchRef}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search tasks"
            aria-label="Search tasks"
            icon={<MagnifyingGlassIcon />}
            className="h-9 bg-surface-sunken text-[12.5px] sm:w-56"
            trailing={
              query ? (
                <IconButton label="Clear search" size="sm" className="h-7 w-7" onClick={onClearSearch}>
                  <XMarkIcon />
                </IconButton>
              ) : undefined
            }
          />
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className={cn('h-9 px-2', panel === 'filter' && 'bg-surface-raised text-ink')}
            icon={<FunnelIcon />}
            aria-label={filterCount > 0 ? `Filter tasks, ${filterCount} active` : 'Filter tasks'}
            aria-expanded={panel === 'filter'}
            onClick={(event) => openPanel('filter', event.currentTarget)}
          >
            <span className="hidden min-[370px]:inline">Filter</span>
            {filterCount > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-signal-soft px-1 text-[10px] font-semibold tabular-nums text-signal">
                {filterCount}
              </span>
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn('h-9 px-2', panel === 'sort' && 'bg-surface-raised text-ink')}
            icon={<ArrowsUpDownIcon />}
            aria-label="Sort tasks"
            aria-expanded={panel === 'sort'}
            onClick={(event) => openPanel('sort', event.currentTarget)}
          >
            <span className="hidden min-[370px]:inline">Sort</span>
          </Button>
          {!isMobile && (
            <Button
              variant="ghost"
              size="sm"
              className={cn('h-9 px-2', panel === 'display' && 'bg-surface-raised text-ink')}
              icon={<AdjustmentsHorizontalIcon />}
              aria-expanded={panel === 'display'}
              onClick={(event) => openPanel('display', event.currentTarget)}
            >
              Display
            </Button>
          )}
          {canSelect && (
            <IconButton
              label={selectionMode ? 'Exit select mode' : 'Select tasks'}
              size="md"
              className={cn(
                'h-9 w-9 md:hidden',
                selectionMode && 'bg-signal-soft text-signal',
              )}
              aria-pressed={selectionMode}
              onClick={onToggleSelectionMode}
            >
              <CheckCircleIcon />
            </IconButton>
          )}
          {!isMobile && (
            <IconButton
              label="Keyboard shortcuts"
              size="md"
              className="h-9 w-9"
              onClick={onOpenShortcuts}
            >
              <QuestionMarkCircleIcon />
            </IconButton>
          )}
        </div>
      </div>

      <div className="board-toolbar-meta mt-2 flex min-w-0 flex-wrap items-center gap-2">
        <FilterChipRow
          filters={filters}
          columns={columns}
          members={members}
          query={query}
          resultCount={resultCount}
          totalCount={totalCount}
          onRemove={onRemoveFilter}
          onClearSearch={onClearSearch}
          onClearAll={onClearAll}
        />
        {!dragEnabled && view === 'board' && (
          <p className="text-[11px] text-ink-muted lg:ml-auto">
            Drag paused · <button type="button" onClick={onResetToManual} className="font-medium text-signal hover:text-signal-strong">Reset filters</button>
          </p>
        )}
      </div>

      <MenuSurface
        open={!isMobile && panel !== null}
        onClose={() => setPanel(null)}
        position={menuPositionFromRect(anchor ?? new DOMRect(16, 16, 0, 0), {
          width: panel === 'filter' ? 320 : 260,
          height: panel === 'filter' ? 520 : 400,
        })}
        ariaLabel={panel === 'filter' ? 'Filters' : panel === 'sort' ? 'Sort' : 'Display'}
        className={panel === 'filter' ? 'w-[320px]' : 'w-[260px]'}
      >
        {panel === 'filter' && (
          <FilterPanel
            filters={filters}
            columns={columns}
            members={members}
            labels={labels}
            onChange={onFiltersChange}
            onClear={onClearFilters}
          />
        )}
        {panel === 'sort' && (
          <SortPanel
            sort={sort}
            direction={direction}
            onChange={(next) => {
              onSortChange(next);
              setPanel(null);
            }}
            onDirectionChange={onDirectionChange}
            dragEnabled={dragEnabled}
            onResetFilters={onResetToManual}
          />
        )}
        {panel === 'display' && <DisplayPanel display={display} onChange={onDisplayChange} />}
      </MenuSurface>

      <Sheet
        open={isMobile && sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="View settings"
        description="Filters, sort, and display stay with this board."
        footer={
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                onClearFilters();
                onClearSearch();
                setSheetOpen(false);
              }}
            >
              Clear all
            </Button>
            <Button variant="primary" onClick={() => setSheetOpen(false)}>
              Done
            </Button>
          </div>
        }
      >
        <div className="sticky top-0 z-10 flex gap-1 border-b border-line bg-surface px-4 pb-3 pt-1">
          {(['filter', 'sort', 'display'] as const).map((section) => (
            <button
              key={section}
              type="button"
              aria-pressed={sheetSection === section}
              onClick={() => setSheetSection(section)}
              className={cn(
                'inline-flex h-9 items-center rounded-control px-3 text-[12.5px] font-medium capitalize transition-colors',
                sheetSection === section
                  ? 'bg-surface-sunken text-ink'
                  : 'text-ink-muted hover:text-ink',
              )}
            >
              {section}
            </button>
          ))}
        </div>
        {sheetSection === 'filter' && (
          <FilterPanel
            filters={filters}
            columns={columns}
            members={members}
            labels={labels}
            onChange={onFiltersChange}
            onClear={onClearFilters}
          />
        )}
        {sheetSection === 'sort' && (
          <SortPanel
            sort={sort}
            direction={direction}
            onChange={onSortChange}
            onDirectionChange={onDirectionChange}
            dragEnabled={dragEnabled}
            onResetFilters={onResetToManual}
          />
        )}
        {sheetSection === 'display' && <DisplayPanel display={display} onChange={onDisplayChange} />}
      </Sheet>
    </>
  );
}

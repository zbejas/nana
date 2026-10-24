import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { Button, IconButton } from '../ui';

const WEEKDAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function toDateString(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isSameDay(a: Date | null, b: Date | null) {
  if (!a || !b) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

type CalendarRange = {
  startDate: Date | null;
  endDate: Date | null;
};

type CalendarFilterPanelProps = {
  visibleMonth: Date;
  calendarDays: Date[];
  selectedRange: CalendarRange;
  hasPendingChanges: boolean;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
  onDayClick: (date: Date) => void;
  onApply: () => void;
  onClear: () => void;
  onResetTimeline?: () => void;
  error: string | null;
};

export function CalendarFilterPanel({
  visibleMonth,
  calendarDays,
  selectedRange,
  hasPendingChanges,
  onPreviousMonth,
  onNextMonth,
  onDayClick,
  onApply,
  onClear,
  onResetTimeline,
  error,
}: CalendarFilterPanelProps) {
  const rangeLabel = selectedRange.startDate
    ? selectedRange.endDate
      ? `${selectedRange.startDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${selectedRange.endDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
      : selectedRange.startDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : 'All time';

  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="eyebrow">Filter</p>
          <p className="mt-1 text-sm text-ink">{rangeLabel}</p>
        </div>
        <div className="flex items-center gap-0.5">
          <IconButton label="Previous month" size="sm" onClick={onPreviousMonth}>
            <ChevronLeftIcon />
          </IconButton>
          <IconButton label="Next month" size="sm" onClick={onNextMonth}>
            <ChevronRightIcon />
          </IconButton>
        </div>
      </div>

      <div className="mb-1 flex items-center justify-between">
        <p className="text-[13px] font-medium text-ink">
          {visibleMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </p>
        {isSameDay(selectedRange.startDate, new Date()) && !selectedRange.endDate && (
          <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-ember">Today</span>
        )}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {WEEKDAY_LABELS.map((weekday, index) => (
          <div key={`${weekday}-${index}`} className="py-1 text-center text-[10px] font-medium text-ink-muted">
            {weekday}
          </div>
        ))}

        {calendarDays.map((day) => {
          const inCurrentMonth = day.getMonth() === visibleMonth.getMonth();
          const isStart = isSameDay(day, selectedRange.startDate);
          const isEnd = isSameDay(day, selectedRange.endDate);
          const inRange = Boolean(
            selectedRange.startDate &&
              selectedRange.endDate &&
              day.getTime() >= selectedRange.startDate.getTime() &&
              day.getTime() <= selectedRange.endDate.getTime()
          );
          const isSelected = isStart || isEnd;
          const isToday = isSameDay(day, new Date());

          return (
            <button
              key={toDateString(day)}
              onClick={() => onDayClick(day)}
              className={`relative h-8 rounded-[6px] text-[12px] tabular-nums transition-colors ${
                isSelected
                  ? 'bg-ember font-semibold text-on-ember'
                  : inRange
                    ? 'bg-ember-soft text-ink'
                    : inCurrentMonth
                      ? 'text-ink-secondary hover:bg-surface-raised hover:text-ink'
                      : 'text-ink-muted/40 hover:bg-surface-raised/60 hover:text-ink-muted'
              }`}
              title={day.toLocaleDateString()}
              aria-label={`Select ${day.toLocaleDateString()}`}
              aria-pressed={isSelected}
            >
              {day.getDate()}
              {isToday && !isSelected && (
                <span className="absolute bottom-1 left-1/2 h-0.5 w-0.5 -translate-x-1/2 rounded-full bg-ember" />
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {hasPendingChanges && (
          <>
            <Button variant="primary" size="sm" onClick={onApply}>
              Apply dates
            </Button>
            {(selectedRange.startDate || selectedRange.endDate) && (
              <Button variant="secondary" size="sm" onClick={onClear}>
                Clear
              </Button>
            )}
          </>
        )}
        {onResetTimeline && (
          <Button variant="ghost" size="sm" onClick={onResetTimeline}>
            Reset timeline
          </Button>
        )}
      </div>

      {error && <p className="mt-3 text-xs text-danger">{error}</p>}
    </div>
  );
}

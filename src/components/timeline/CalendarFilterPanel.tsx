import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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
  return (
    <>
      <div className="mb-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
        <div className="text-[11px] uppercase tracking-wide text-gray-400">Calendar filter</div>
        <div className="text-xs text-gray-300 mt-0.5">
          {selectedRange.startDate
            ? selectedRange.endDate
              ? `${selectedRange.startDate.toLocaleDateString()} – ${selectedRange.endDate.toLocaleDateString()}`
              : selectedRange.startDate.toLocaleDateString()
            : 'Select one day or a date range'}
        </div>
      </div>

      <div className="flex items-center justify-between mb-3">
        <button
          onClick={onPreviousMonth}
          className="inline-flex items-center justify-center rounded-lg border border-white/10 bg-white/5 p-2 text-gray-200 hover:bg-white/10 transition-colors"
          aria-label="Previous month"
          title="Previous month"
        >
          <ChevronLeftIcon className="w-4 h-4" />
        </button>

        <div className="text-sm font-medium text-white">
          {visibleMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </div>

        <button
          onClick={onNextMonth}
          className="inline-flex items-center justify-center rounded-lg border border-white/10 bg-white/5 p-2 text-gray-200 hover:bg-white/10 transition-colors"
          aria-label="Next month"
          title="Next month"
        >
          <ChevronRightIcon className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAY_LABELS.map((weekday) => (
          <div key={weekday} className="text-[11px] text-gray-400 text-center py-1">
            {weekday}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
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

          return (
            <button
              key={toDateString(day)}
              onClick={() => onDayClick(day)}
              className={`h-9 rounded-md text-sm transition-colors ${isSelected
                  ? 'bg-blue-500/35 text-blue-100 border border-blue-400/40'
                  : inRange
                    ? 'bg-blue-500/15 text-blue-100 border border-blue-500/20'
                    : inCurrentMonth
                      ? 'bg-white/5 text-gray-200 border border-white/10 hover:bg-white/10'
                      : 'bg-black/20 text-gray-500 border border-white/5 hover:bg-black/30'
                }`}
              title={day.toLocaleDateString()}
              aria-label={`Select ${day.toLocaleDateString()}`}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {hasPendingChanges && (
          <>
            <button
              onClick={onApply}
              className="inline-flex items-center rounded-lg border border-blue-500/30 bg-blue-500/20 px-3 py-1.5 text-xs font-medium text-blue-100 hover:bg-blue-500/30 transition-colors"
            >
              Apply
            </button>

            {(selectedRange.startDate || selectedRange.endDate) && (
              <button
                onClick={onClear}
                className="inline-flex items-center rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-gray-200 hover:bg-white/10 transition-colors"
              >
                Clear dates
              </button>
            )}
          </>
        )}

        {onResetTimeline && (
          <button
            onClick={onResetTimeline}
            className="inline-flex items-center rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-gray-200 hover:bg-white/10 transition-colors"
          >
            Reset timeline
          </button>
        )}
      </div>

      {error && <p className="mt-3 text-xs text-red-300">{error}</p>}
    </>
  );
}

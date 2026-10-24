import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { useEffect, useMemo, useState } from 'react';
import { IconButton, Input } from '../ui';

interface DateTimePickerProps {
    value: string;
    disabled?: boolean;
    onChange: (value: string) => void;
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;

interface CalendarDay {
    date: number;
    month: number;
    year: number;
    isCurrentMonth: boolean;
}

function getCalendarDays(year: number, month: number): CalendarDay[] {
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const days: CalendarDay[] = [];

    for (let i = firstDay - 1; i >= 0; i--) {
        const prevMonth = month === 0 ? 11 : month - 1;
        const prevYear = month === 0 ? year - 1 : year;
        days.push({ date: daysInPrevMonth - i, month: prevMonth, year: prevYear, isCurrentMonth: false });
    }

    for (let d = 1; d <= daysInMonth; d++) {
        days.push({ date: d, month, year, isCurrentMonth: true });
    }

    const remaining = 7 - (days.length % 7);
    if (remaining < 7) {
        const nextMonth = month === 11 ? 0 : month + 1;
        const nextYear = month === 11 ? year + 1 : year;
        for (let d = 1; d <= remaining; d++) {
            days.push({ date: d, month: nextMonth, year: nextYear, isCurrentMonth: false });
        }
    }

    return days;
}

function parseValue(value: string) {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
    if (!match) {
        const now = new Date();
        return {
            year: now.getFullYear(),
            month: now.getMonth(),
            day: now.getDate(),
            hour: now.getHours(),
            minute: now.getMinutes(),
        };
    }
    return {
        year: Number.parseInt(match[1] ?? '0', 10),
        month: Number.parseInt(match[2] ?? '1', 10) - 1,
        day: Number.parseInt(match[3] ?? '1', 10),
        hour: Number.parseInt(match[4] ?? '0', 10),
        minute: Number.parseInt(match[5] ?? '0', 10),
    };
}

function pad(n: number): string {
    return n.toString().padStart(2, '0');
}

function formatValue(year: number, month: number, day: number, hour: number, minute: number): string {
    return `${year}-${pad(month + 1)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;
}

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
] as const;

export function DateTimePicker({ value, disabled, onChange }: DateTimePickerProps) {
    const parsed = useMemo(() => parseValue(value), [value]);

    const [viewYear, setViewYear] = useState(parsed.year);
    const [viewMonth, setViewMonth] = useState(parsed.month);

    useEffect(() => {
        const next = parseValue(value);
        setViewYear(next.year);
        setViewMonth(next.month);
    }, [value]);

    const today = useMemo(() => {
        const now = new Date();
        return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };
    }, []);

    const calendarDays = useMemo(() => getCalendarDays(viewYear, viewMonth), [viewYear, viewMonth]);

    function goToPrevMonth() {
        if (viewMonth === 0) {
            setViewMonth(11);
            setViewYear((year) => year - 1);
        } else {
            setViewMonth((month) => month - 1);
        }
    }

    function goToNextMonth() {
        if (viewMonth === 11) {
            setViewMonth(0);
            setViewYear((year) => year + 1);
        } else {
            setViewMonth((month) => month + 1);
        }
    }

    function handleDayClick(day: CalendarDay) {
        if (disabled) return;
        onChange(formatValue(day.year, day.month, day.date, parsed.hour, parsed.minute));
    }

    function handleHourChange(event: React.ChangeEvent<HTMLInputElement>) {
        const hour = Math.max(0, Math.min(23, Number.parseInt(event.target.value, 10) || 0));
        onChange(formatValue(parsed.year, parsed.month, parsed.day, hour, parsed.minute));
    }

    function handleMinuteChange(event: React.ChangeEvent<HTMLInputElement>) {
        const minute = Math.max(0, Math.min(59, Number.parseInt(event.target.value, 10) || 0));
        onChange(formatValue(parsed.year, parsed.month, parsed.day, parsed.hour, minute));
    }

    function isSelected(day: CalendarDay) {
        return day.year === parsed.year && day.month === parsed.month && day.date === parsed.day;
    }

    function isToday(day: CalendarDay) {
        return day.year === today.year && day.month === today.month && day.date === today.day;
    }

    function dayClassName(day: CalendarDay) {
        const base = 'flex h-7 w-7 items-center justify-center rounded-[6px] text-xs transition-colors sm:h-8 sm:w-8 sm:text-[13px]';
        if (isSelected(day)) {
            return `${base} bg-ember font-semibold text-on-ember`;
        }
        if (!day.isCurrentMonth) {
            return `${base} text-ink-muted/40`;
        }
        if (isToday(day)) {
            return `${base} border border-ember/40 text-ink hover:bg-surface-raised`;
        }
        return `${base} text-ink-secondary hover:bg-surface-raised hover:text-ink`;
    }

    return (
        <div className={`rounded-control border border-line bg-surface-sunken/60 p-3 ${disabled ? 'pointer-events-none opacity-40' : ''}`}>
            <div className="mb-2 flex items-center justify-between">
                <IconButton label="Previous month" size="sm" onClick={goToPrevMonth}>
                    <ChevronLeftIcon />
                </IconButton>
                <span className="text-[13px] font-medium text-ink">
                    {MONTH_NAMES[viewMonth] ?? ''} {viewYear}
                </span>
                <IconButton label="Next month" size="sm" onClick={goToNextMonth}>
                    <ChevronRightIcon />
                </IconButton>
            </div>

            <div className="grid grid-cols-7">
                {WEEKDAYS.map((weekday) => (
                    <div key={weekday} className="py-1 text-center text-[10px] font-medium text-ink-muted">
                        {weekday}
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-7">
                {calendarDays.map((day, index) => (
                    <button
                        key={`${day.year}-${day.month}-${day.date}-${index}`}
                        type="button"
                        onClick={() => handleDayClick(day)}
                        className={`flex justify-center py-0.5 ${day.isCurrentMonth && !disabled ? 'cursor-pointer' : 'cursor-default'}`}
                    >
                        <span className={dayClassName(day)}>{day.date}</span>
                    </button>
                ))}
            </div>

            <div className="mt-3 flex items-center justify-center gap-2 border-t border-line pt-3">
                <p className="text-[11px] text-ink-muted">Time</p>
                <div className="w-16">
                    <Input
                        type="number"
                        min={0}
                        max={23}
                        value={pad(parsed.hour)}
                        onChange={handleHourChange}
                        disabled={disabled}
                        aria-label="Hour"
                        className="h-8 px-2 text-center"
                    />
                </div>
                <span className="text-sm font-medium text-ink-muted">:</span>
                <div className="w-16">
                    <Input
                        type="number"
                        min={0}
                        max={59}
                        value={pad(parsed.minute)}
                        onChange={handleMinuteChange}
                        disabled={disabled}
                        aria-label="Minute"
                        className="h-8 px-2 text-center"
                    />
                </div>
            </div>
        </div>
    );
}

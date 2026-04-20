import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { useEffect, useMemo, useState } from 'react';

interface DateTimePickerProps {
    value: string; // datetime-local format: "YYYY-MM-DDTHH:mm"
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

    // Previous month padding
    for (let i = firstDay - 1; i >= 0; i--) {
        const prevMonth = month === 0 ? 11 : month - 1;
        const prevYear = month === 0 ? year - 1 : year;
        days.push({ date: daysInPrevMonth - i, month: prevMonth, year: prevYear, isCurrentMonth: false });
    }

    // Current month
    for (let d = 1; d <= daysInMonth; d++) {
        days.push({ date: d, month, year, isCurrentMonth: true });
    }

    // Next month padding to fill remaining cells (complete rows of 7)
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
        year: Number.parseInt(match[1], 10),
        month: Number.parseInt(match[2], 10) - 1,
        day: Number.parseInt(match[3], 10),
        hour: Number.parseInt(match[4], 10),
        minute: Number.parseInt(match[5], 10),
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

    // Sync view when value changes externally
    useEffect(() => {
        const p = parseValue(value);
        setViewYear(p.year);
        setViewMonth(p.month);
    }, [value]);

    const today = useMemo(() => {
        const now = new Date();
        return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };
    }, []);

    const calendarDays = useMemo(() => getCalendarDays(viewYear, viewMonth), [viewYear, viewMonth]);

    function goToPrevMonth() {
        if (viewMonth === 0) {
            setViewMonth(11);
            setViewYear((y) => y - 1);
        } else {
            setViewMonth((m) => m - 1);
        }
    }

    function goToNextMonth() {
        if (viewMonth === 11) {
            setViewMonth(0);
            setViewYear((y) => y + 1);
        } else {
            setViewMonth((m) => m + 1);
        }
    }

    function handleDayClick(day: CalendarDay) {
        if (disabled) return;
        onChange(formatValue(day.year, day.month, day.date, parsed.hour, parsed.minute));
    }

    function handleHourChange(e: React.ChangeEvent<HTMLInputElement>) {
        const h = Math.max(0, Math.min(23, Number.parseInt(e.target.value, 10) || 0));
        onChange(formatValue(parsed.year, parsed.month, parsed.day, h, parsed.minute));
    }

    function handleMinuteChange(e: React.ChangeEvent<HTMLInputElement>) {
        const m = Math.max(0, Math.min(59, Number.parseInt(e.target.value, 10) || 0));
        onChange(formatValue(parsed.year, parsed.month, parsed.day, parsed.hour, m));
    }

    function isSelected(day: CalendarDay) {
        return day.year === parsed.year && day.month === parsed.month && day.date === parsed.day;
    }

    function isToday(day: CalendarDay) {
        return day.year === today.year && day.month === today.month && day.date === today.day;
    }

    function dayClassName(day: CalendarDay) {
        const base = 'flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-lg text-xs sm:text-sm transition-colors';
        if (!day.isCurrentMonth) {
            return `${base} text-stone-600`;
        }
        if (isSelected(day)) {
            return `${base} bg-amber-500/25 text-amber-100 border border-amber-400/40`;
        }
        if (isToday(day)) {
            return `${base} border border-white/20 text-stone-300 hover:bg-white/10`;
        }
        return `${base} text-stone-300 hover:bg-white/10`;
    }

    const disabledClass = disabled ? 'pointer-events-none opacity-40' : '';

    return (
        <div className={`rounded-lg border border-white/10 bg-black/35 p-2.5 sm:p-3 ${disabledClass}`}>
            {/* Month/Year Navigation */}
            <div className="mb-2 flex items-center justify-between">
                <button
                    type="button"
                    onClick={goToPrevMonth}
                    className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-stone-300 transition-colors hover:bg-white/10"
                >
                    <ChevronLeftIcon className="h-4 w-4" />
                </button>
                <span className="text-sm font-medium text-white">
                    {MONTH_NAMES[viewMonth]} {viewYear}
                </span>
                <button
                    type="button"
                    onClick={goToNextMonth}
                    className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-stone-300 transition-colors hover:bg-white/10"
                >
                    <ChevronRightIcon className="h-4 w-4" />
                </button>
            </div>

            {/* Weekday Headers */}
            <div className="grid grid-cols-7">
                {WEEKDAYS.map((wd) => (
                    <div key={wd} className="py-1 text-center text-[11px] text-stone-500">
                        {wd}
                    </div>
                ))}
            </div>

            {/* Day Grid */}
            <div className="grid grid-cols-7">
                {calendarDays.map((day, i) => (
                    <button
                        key={`${day.year}-${day.month}-${day.date}-${i}`}
                        type="button"
                        onClick={() => handleDayClick(day)}
                        className={`flex justify-center py-0.5 ${day.isCurrentMonth && !disabled ? 'cursor-pointer' : 'cursor-default'}`}
                    >
                        <span className={dayClassName(day)}>{day.date}</span>
                    </button>
                ))}
            </div>

            {/* Time Inputs */}
            <div className="mt-2 flex items-center justify-center gap-2 border-t border-white/10 pt-2 sm:mt-3 sm:pt-3">
                <input
                    type="number"
                    min={0}
                    max={23}
                    value={pad(parsed.hour)}
                    onChange={handleHourChange}
                    disabled={disabled}
                    className="w-14 rounded-lg border border-white/10 bg-black/35 px-2 py-1.5 sm:px-3 sm:py-2 text-center text-sm text-white outline-none focus:border-amber-400/40"
                />
                <span className="text-sm font-medium text-stone-400">:</span>
                <input
                    type="number"
                    min={0}
                    max={59}
                    value={pad(parsed.minute)}
                    onChange={handleMinuteChange}
                    disabled={disabled}
                    className="w-14 rounded-lg border border-white/10 bg-black/35 px-2 py-1.5 sm:px-3 sm:py-2 text-center text-sm text-white outline-none focus:border-amber-400/40"
                />
            </div>
        </div>
    );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { getTimelineDocumentsByDateRange, getTimelineDocumentsPage, type Document } from '../../lib/documents';
import { initialLoadDoneAtom, timelineRealtimeTickAtom } from '../../state/atoms';
import { useAuth } from '../../lib/auth';
import { useDocumentSearch } from '../../lib/documents/useDocumentSearch';

const TIMELINE_PAGE_SIZE = 20;

export type TimelineGroup = {
    label: string;
    items: Document[];
};

export type TimelineViewMode = 'timeline' | 'calendar';

type TimelineCacheState = {
    documents: Document[];
    page: number;
    hasMore: boolean;
    lastSyncedTick: number;
};

type CalendarRangeState = {
    startDate: Date | null;
    endDate: Date | null;
};

const timelineCacheByUser = new Map<string, TimelineCacheState>();

function getTimelineCache(userId: string) {
    return timelineCacheByUser.get(userId) ?? null;
}

function setTimelineCache(userId: string, documents: Document[], page: number, hasMore: boolean, tick: number) {
    timelineCacheByUser.set(userId, {
        documents,
        page,
        hasMore,
        lastSyncedTick: tick,
    });
}

function startOfDay(date: Date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function getMonthStart(date: Date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getMonthDays(month: Date) {
    const monthStart = getMonthStart(month);
    const gridStart = new Date(monthStart);
    gridStart.setDate(monthStart.getDate() - monthStart.getDay());

    return Array.from({ length: 42 }, (_, index) => {
        const day = new Date(gridStart);
        day.setDate(gridStart.getDate() + index);
        return day;
    });
}

function toDateString(date: Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function areDateRangesEqual(a: CalendarRangeState, b: CalendarRangeState) {
    const aStart = a.startDate?.getTime() ?? null;
    const aEnd = a.endDate?.getTime() ?? null;
    const bStart = b.startDate?.getTime() ?? null;
    const bEnd = b.endDate?.getTime() ?? null;
    return aStart === bStart && aEnd === bEnd;
}

function getGroupLabel(date: Date) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    if (target.getTime() === today.getTime()) return 'Today';
    if (target.getTime() === yesterday.getTime()) return 'Yesterday';
    return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
}

function getDocumentWordCount(document: Document) {
    if (document.word_count > 0) {
        return document.word_count;
    }

    return document.content.trim().split(/\s+/).filter(Boolean).length;
}

function getDocumentReadingTime(document: Document) {
    if (document.reading_time > 0) {
        return document.reading_time;
    }

    return Math.max(1, Math.ceil(getDocumentWordCount(document) / 200));
}

export function useTimelinePageState() {
    const { user } = useAuth();
    const currentUserId = user?.id ?? 'anonymous';
    const userCache = getTimelineCache(currentUserId);

    const initialLoadDone = useAtomValue(initialLoadDoneAtom);
    const timelineRealtimeTick = useAtomValue(timelineRealtimeTickAtom);
    const hasMountedSyncRef = useRef(false);

    const [documents, setDocuments] = useState<Document[]>(() => userCache?.documents ?? []);
    const [page, setPage] = useState(() => userCache?.page ?? 1);
    const [hasMore, setHasMore] = useState(() => userCache?.hasMore ?? true);
    const [isInitialLoading, setIsInitialLoading] = useState(() => !userCache);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [timelineError, setTimelineError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [viewMode, setViewMode] = useState<TimelineViewMode>('timeline');
    const [isCalendarOpen, setIsCalendarOpen] = useState(false);
    const [isMobile, setIsMobile] = useState(() => {
        if (typeof window === 'undefined') return false;
        return window.innerWidth < 640;
    });
    const [calendarStartDate, setCalendarStartDate] = useState<Date | null>(null);
    const [calendarEndDate, setCalendarEndDate] = useState<Date | null>(null);
    const [appliedCalendarRange, setAppliedCalendarRange] = useState<CalendarRangeState>({
        startDate: null,
        endDate: null,
    });
    const [calendarVisibleMonth, setCalendarVisibleMonth] = useState(() => getMonthStart(new Date()));
    const [isCalendarLoading, setIsCalendarLoading] = useState(false);
    const [calendarError, setCalendarError] = useState<string | null>(null);

    const loadMoreRef = useRef<HTMLDivElement | null>(null);
    const calendarPopupRef = useRef<HTMLDivElement | null>(null);
    const calendarTriggerRef = useRef<HTMLButtonElement | null>(null);
    const isFetchingRef = useRef(false);
    const currentUserIdRef = useRef(currentUserId);
    const timelineRealtimeTickRef = useRef(timelineRealtimeTick);

    useEffect(() => {
        currentUserIdRef.current = currentUserId;
    }, [currentUserId]);

    useEffect(() => {
        timelineRealtimeTickRef.current = timelineRealtimeTick;
    }, [timelineRealtimeTick]);

    useEffect(() => {
        return () => {
            timelineCacheByUser.delete(currentUserIdRef.current);
        };
    }, []);

    const calendarDays = useMemo(() => getMonthDays(calendarVisibleMonth), [calendarVisibleMonth]);
    const hasSearchQuery = searchQuery.trim().length > 0;
    const { results: searchedDocuments, isLoading: isSearchLoading } = useDocumentSearch(searchQuery, {
        enabled: hasSearchQuery,
    });

    const normalizedCalendarRange = useMemo(() => {
        if (!calendarStartDate) {
            return { startDate: null as Date | null, endDate: null as Date | null };
        }

        if (!calendarEndDate) {
            return { startDate: calendarStartDate, endDate: null as Date | null };
        }

        if (calendarStartDate.getTime() <= calendarEndDate.getTime()) {
            return { startDate: calendarStartDate, endDate: calendarEndDate };
        }

        return { startDate: calendarEndDate, endDate: calendarStartDate };
    }, [calendarStartDate, calendarEndDate]);

    const hasPendingCalendarChanges = useMemo(() => {
        return !areDateRangesEqual(normalizedCalendarRange, appliedCalendarRange);
    }, [normalizedCalendarRange, appliedCalendarRange]);

    const loadTimelineFirstPage = useCallback(async (options?: { showLoading?: boolean; syncTick?: number }) => {
        const showLoading = options?.showLoading ?? true;
        const syncTick = options?.syncTick ?? timelineRealtimeTickRef.current;

        if (showLoading) {
            setIsInitialLoading(true);
        }

        setTimelineError(null);
        isFetchingRef.current = true;

        try {
            const result = await getTimelineDocumentsPage(1, TIMELINE_PAGE_SIZE);

            setDocuments(result.items);
            setPage(1);
            setHasMore(result.page < result.totalPages);
            setTimelineCache(currentUserId, result.items, 1, result.page < result.totalPages, syncTick);
        } catch (_error) {
            setTimelineError('Failed to load timeline. Please try again.');
        } finally {
            setIsInitialLoading(false);
            isFetchingRef.current = false;
        }
    }, [currentUserId]);

    useEffect(() => {
        const cache = getTimelineCache(currentUserId);
        hasMountedSyncRef.current = false;
        setDocuments(cache?.documents ?? []);
        setPage(cache?.page ?? 1);
        setHasMore(cache?.hasMore ?? true);
        setIsInitialLoading(!cache);
        setTimelineError(null);
    }, [currentUserId]);

    useEffect(() => {
        if (!initialLoadDone) {
            return;
        }

        const cache = getTimelineCache(currentUserId);
        const hasCache = Boolean(cache);
        const cacheIsStale = !cache || cache.lastSyncedTick !== timelineRealtimeTick;

        if (!hasMountedSyncRef.current) {
            hasMountedSyncRef.current = true;

            if (!hasCache) {
                void loadTimelineFirstPage({ showLoading: true, syncTick: timelineRealtimeTick });
                return;
            }

            if (cacheIsStale) {
                void loadTimelineFirstPage({ showLoading: false, syncTick: timelineRealtimeTick });
            }
            return;
        }

        if (viewMode !== 'timeline' || !cacheIsStale || isFetchingRef.current) {
            return;
        }

        void loadTimelineFirstPage({ showLoading: false, syncTick: timelineRealtimeTick });
    }, [currentUserId, initialLoadDone, timelineRealtimeTick, viewMode, loadTimelineFirstPage]);

    useEffect(() => {
        const handleResize = () => {
            setIsMobile(window.innerWidth < 640);
        };

        window.addEventListener('resize', handleResize);
        return () => {
            window.removeEventListener('resize', handleResize);
        };
    }, []);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsCalendarOpen(false);
            }
        };

        if (isCalendarOpen && isMobile) {
            document.addEventListener('keydown', handleKeyDown);
            return () => {
                document.removeEventListener('keydown', handleKeyDown);
            };
        }
    }, [isCalendarOpen, isMobile]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const targetNode = event.target as Node;
            const clickedInsidePopup = calendarPopupRef.current?.contains(targetNode) ?? false;
            const clickedTrigger = calendarTriggerRef.current?.contains(targetNode) ?? false;

            if (!clickedInsidePopup && !clickedTrigger) {
                setIsCalendarOpen(false);
            }
        };

        if (isCalendarOpen && isMobile) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => {
                document.removeEventListener('mousedown', handleClickOutside);
            };
        }
    }, [isCalendarOpen, isMobile]);

    useEffect(() => {
        if (viewMode !== 'timeline' || !hasMore || isInitialLoading || timelineError) {
            return;
        }

        const target = loadMoreRef.current;
        if (!target) {
            return;
        }

        const observer = new IntersectionObserver(
            async (entries) => {
                const [entry] = entries;
                if (!entry?.isIntersecting || isFetchingRef.current) {
                    return;
                }

                isFetchingRef.current = true;
                setIsLoadingMore(true);

                try {
                    const nextPage = page + 1;
                    const result = await getTimelineDocumentsPage(nextPage, TIMELINE_PAGE_SIZE);

                    setDocuments((prev) => {
                        const merged = [...prev, ...result.items];
                        const uniqueById = new Map<string, Document>();
                        merged.forEach((doc) => uniqueById.set(doc.id, doc));
                        const nextDocuments = Array.from(uniqueById.values());
                        setTimelineCache(
                            currentUserId,
                            nextDocuments,
                            nextPage,
                            result.page < result.totalPages,
                            timelineRealtimeTickRef.current
                        );
                        return nextDocuments;
                    });
                    setPage(nextPage);
                    setHasMore(result.page < result.totalPages);
                } finally {
                    isFetchingRef.current = false;
                    setIsLoadingMore(false);
                }
            },
            { rootMargin: '200px 0px' }
        );

        observer.observe(target);

        return () => {
            observer.disconnect();
        };
    }, [currentUserId, page, hasMore, isInitialLoading, timelineError, viewMode]);

    const filteredDocuments = hasSearchQuery ? searchedDocuments : documents;

    const groups = useMemo<TimelineGroup[]>(() => {
        const grouped = new Map<string, Document[]>();

        filteredDocuments.forEach((document) => {
            const updatedAt = new Date(document.updated);
            const label = getGroupLabel(updatedAt);
            const existing = grouped.get(label) || [];
            existing.push(document);
            grouped.set(label, existing);
        });

        return Array.from(grouped.entries()).map(([label, items]) => ({ label, items }));
    }, [filteredDocuments]);

    const toggleCalendar = () => {
        setIsCalendarOpen((prev) => !prev);
        setCalendarError(null);
    };

    const resetTimeline = () => {
        setIsCalendarOpen(false);
        setViewMode('timeline');
        setCalendarError(null);
        setCalendarStartDate(null);
        setCalendarEndDate(null);
        setAppliedCalendarRange({ startDate: null, endDate: null });
        setCalendarVisibleMonth(getMonthStart(new Date()));
        void loadTimelineFirstPage();
    };

    const selectCalendarDay = (date: Date) => {
        const selectedDay = startOfDay(date);

        if (!calendarStartDate || (calendarStartDate && calendarEndDate)) {
            setCalendarStartDate(selectedDay);
            setCalendarEndDate(null);
            return;
        }

        if (selectedDay.getTime() === calendarStartDate.getTime()) {
            setCalendarEndDate(selectedDay);
            return;
        }

        setCalendarEndDate(selectedDay);
    };

    const applyCalendarFilter = async () => {
        setCalendarError(null);
        setIsCalendarLoading(true);

        const rangeStart = normalizedCalendarRange.startDate;
        const rangeEnd = normalizedCalendarRange.endDate || normalizedCalendarRange.startDate;

        try {
            const items = await getTimelineDocumentsByDateRange({
                startDate: rangeStart ? toDateString(rangeStart) : undefined,
                endDate: rangeEnd ? toDateString(rangeEnd) : undefined,
            });

            setDocuments(items);
            setPage(1);
            setHasMore(false);
            setTimelineCache(currentUserId, items, 1, false, timelineRealtimeTick);
            setViewMode('calendar');
            setIsCalendarOpen(false);
            setAppliedCalendarRange({
                startDate: normalizedCalendarRange.startDate,
                endDate: normalizedCalendarRange.endDate,
            });
        } catch (_error) {
            setCalendarError('Failed to load calendar results. Please try again.');
        } finally {
            setIsCalendarLoading(false);
        }
    };

    const previousMonth = () => {
        const prev = new Date(calendarVisibleMonth);
        prev.setMonth(prev.getMonth() - 1);
        setCalendarVisibleMonth(getMonthStart(prev));
    };

    const nextMonth = () => {
        const next = new Date(calendarVisibleMonth);
        next.setMonth(next.getMonth() + 1);
        setCalendarVisibleMonth(getMonthStart(next));
    };

    const clearCalendarSelection = () => {
        setCalendarStartDate(null);
        setCalendarEndDate(null);
    };

    const getWordCount = (document: Document) => {
        return getDocumentWordCount(document);
    };

    const getReadingTime = (document: Document) => {
        return getDocumentReadingTime(document);
    };

    const removeDocumentFromTimeline = useCallback((documentId: string) => {
        setDocuments((previous) => {
            const nextDocuments = previous.filter((document) => document.id !== documentId);
            setTimelineCache(currentUserId, nextDocuments, page, hasMore, timelineRealtimeTickRef.current);
            return nextDocuments;
        });
    }, [currentUserId, page, hasMore]);

    return {
        groups,
        searchQuery,
        setSearchQuery,
        viewMode,
        isCalendarOpen,
        isMobile,
        isInitialLoading,
        isLoadingMore,
        isCalendarLoading,
        isSearchLoading,
        timelineError,
        calendarError,
        calendarVisibleMonth,
        calendarDays,
        normalizedCalendarRange,
        hasPendingCalendarChanges,
        loadMoreRef,
        calendarPopupRef,
        calendarTriggerRef,
        toggleCalendar,
        resetTimeline,
        selectCalendarDay,
        applyCalendarFilter,
        previousMonth,
        nextMonth,
        clearCalendarSelection,
        loadTimelineFirstPage,
        getWordCount,
        getReadingTime,
        removeDocumentFromTimeline,
    };
}

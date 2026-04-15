import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth';
import { createLogger } from '../logger';

const logger = createLogger('DocSearch');
import { searchDocuments } from './search';
import type { Document } from './types';

interface CacheEntry {
    results: Document[];
    timestamp: number;
}

export interface UseDocumentSearchOptions {
    limit?: number;
    debounceMs?: number;
    enabled?: boolean;
}

const searchCache = new Map<string, CacheEntry>();
const CACHE_TTL = 30000;
const MAX_CACHE_ENTRIES = 100;

const getCacheKey = (userId: string | undefined, query: string) => `${userId ?? 'anonymous'}:${query}`;

const pruneSearchCache = (now: number) => {
    for (const [key, entry] of searchCache.entries()) {
        if ((now - entry.timestamp) >= CACHE_TTL) {
            searchCache.delete(key);
        }
    }

    if (searchCache.size > MAX_CACHE_ENTRIES) {
        const entriesByAge = Array.from(searchCache.entries()).sort(
            (a, b) => a[1].timestamp - b[1].timestamp
        );
        const entriesToRemove = searchCache.size - MAX_CACHE_ENTRIES;
        for (let i = 0; i < entriesToRemove; i++) {
            const entry = entriesByAge[i];
            if (entry) {
                searchCache.delete(entry[0]);
            }
        }
    }
};

export function useDocumentSearch(query: string, options: UseDocumentSearchOptions = {}) {
    const { user } = useAuth();
    const [results, setResults] = useState<Document[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const abortControllerRef = useRef<AbortController | null>(null);
    const {
        limit,
        debounceMs = 350,
        enabled = true,
    } = options;

    useEffect(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }

        const trimmedQuery = query.trim();
        if (!enabled || !trimmedQuery) {
            setResults([]);
            setIsLoading(false);
            return;
        }

        const now = Date.now();
        pruneSearchCache(now);

        const cacheKey = getCacheKey(user?.id, trimmedQuery);
        const cachedEntry = searchCache.get(cacheKey);

        if (cachedEntry && (now - cachedEntry.timestamp) < CACHE_TTL) {
            logger.debug('Using cached search results', { query: trimmedQuery, age: now - cachedEntry.timestamp });
            setResults(typeof limit === 'number' ? cachedEntry.results.slice(0, limit) : cachedEntry.results);
            setIsLoading(false);
            return;
        }

        setIsLoading(true);
        const controller = new AbortController();
        abortControllerRef.current = controller;

        const timeoutId = setTimeout(async () => {
            try {
                logger.debug('Executing search query', { query: trimmedQuery });
                const searchResults = await searchDocuments(trimmedQuery);

                if (controller.signal.aborted) {
                    return;
                }

                searchCache.set(cacheKey, {
                    results: searchResults,
                    timestamp: Date.now(),
                });
                pruneSearchCache(Date.now());

                const nextResults = typeof limit === 'number' ? searchResults.slice(0, limit) : searchResults;
                setResults(nextResults);
                setIsLoading(false);
                logger.debug('Search completed and cached', { resultCount: searchResults.length });
            } catch (error: any) {
                if (!controller.signal.aborted) {
                    logger.error('Search failed', { error: error.message });
                    setResults([]);
                    setIsLoading(false);
                }
            }
        }, debounceMs);

        return () => {
            clearTimeout(timeoutId);
            controller.abort();
        };
    }, [query, user?.id, limit, debounceMs, enabled]);

    return {
        results,
        isLoading,
    };
}

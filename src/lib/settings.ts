import React from 'react';
import { createLogger } from './logger';

const log = createLogger('Settings');

// ===== SIDEBAR SETTINGS =====

// Sidebar width constraints
const MIN_SIDEBAR_WIDTH = 240;
const MAX_SIDEBAR_WIDTH = 600;
const DEFAULT_SIDEBAR_WIDTH = 320;

const SIDEBAR_WIDTH_STORAGE_KEY = 'nana-sidebar-width';
const AUTO_SAVE_DELAY_STORAGE_KEY = 'nana-auto-save-delay';
const DEFAULT_HOMEPAGE_STORAGE_KEY = 'nana-default-homepage';
const LAST_NON_DOCUMENT_ROUTE_STORAGE_KEY = 'nana-last-non-document-route';
const MIN_AUTO_SAVE_DELAY = 200;
const DEFAULT_AUTO_SAVE_DELAY = 600;

export type DefaultHomepage = 'timeline' | 'folders' | 'chat';
const DEFAULT_HOMEPAGE: DefaultHomepage = 'timeline';

// Get the current sidebar width from localStorage
export function getSidebarWidth(): number {
    try {
        const stored = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
        if (stored) {
            const width = parseInt(stored, 10);
            if (!isNaN(width) && width >= MIN_SIDEBAR_WIDTH && width <= MAX_SIDEBAR_WIDTH) {
                return width;
            }
        }
    } catch (error) {
        log.error('Failed to read sidebar width from localStorage', error);
    }
    return DEFAULT_SIDEBAR_WIDTH;
}

// Save sidebar width to localStorage
export function setSidebarWidth(width: number): void {
    try {
        // Clamp width between min and max
        const clampedWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, width));
        localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, clampedWidth.toString());
        // Dispatch custom event to notify components
        window.dispatchEvent(new CustomEvent('sidebar-width-change', { detail: clampedWidth }));
    } catch (error) {
        log.error('Failed to save sidebar width to localStorage', error);
    }
}

// Export constraints for use in components
export { MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH, DEFAULT_SIDEBAR_WIDTH };

// Hook to use sidebar width with live updates
export function useSidebarWidth() {
    const [width, setWidth] = React.useState(() => getSidebarWidth());

    React.useEffect(() => {
        const handleChange = (event: Event) => {
            const customEvent = event as CustomEvent<number>;
            setWidth(customEvent.detail);
        };

        window.addEventListener('sidebar-width-change', handleChange);
        return () => window.removeEventListener('sidebar-width-change', handleChange);
    }, []);

    return width;
}

// ===== AUTO SAVE DELAY =====

export function getAutoSaveDelay(): number {
    try {
        const stored = localStorage.getItem(AUTO_SAVE_DELAY_STORAGE_KEY);
        if (stored) {
            const delay = parseInt(stored, 10);
            if (!isNaN(delay)) {
                return delay;
            }
        }
    } catch (error) {
        log.error('Failed to read auto-save delay from localStorage', error);
    }

    return DEFAULT_AUTO_SAVE_DELAY;
}

export function setAutoSaveDelay(delayMs: number): void {
    try {
        const parsedDelay = Number.isFinite(delayMs) ? Math.floor(delayMs) : DEFAULT_AUTO_SAVE_DELAY;
        const clampedDelay = Math.max(MIN_AUTO_SAVE_DELAY, parsedDelay);
        localStorage.setItem(AUTO_SAVE_DELAY_STORAGE_KEY, String(clampedDelay));
        window.dispatchEvent(new CustomEvent('auto-save-delay-change', { detail: clampedDelay }));
    } catch (error) {
        log.error('Failed to save auto-save delay to localStorage', error);
    }
}

export function useAutoSaveDelay() {
    const [delay, setDelay] = React.useState(() => getAutoSaveDelay());

    React.useEffect(() => {
        const handleChange = (event: Event) => {
            const customEvent = event as CustomEvent<number>;
            setDelay(typeof customEvent.detail === 'number' ? customEvent.detail : getAutoSaveDelay());
        };

        window.addEventListener('auto-save-delay-change', handleChange);
        return () => window.removeEventListener('auto-save-delay-change', handleChange);
    }, []);

    return delay;
}

export { MIN_AUTO_SAVE_DELAY, DEFAULT_AUTO_SAVE_DELAY };

// ===== DEFAULT HOMEPAGE =====

export function getDefaultHomepage(): DefaultHomepage {
    try {
        const stored = localStorage.getItem(DEFAULT_HOMEPAGE_STORAGE_KEY);
        if (stored === 'timeline' || stored === 'folders' || stored === 'chat') {
            return stored;
        }
    } catch (error) {
        log.error('Failed to read default homepage from localStorage', error);
    }

    return DEFAULT_HOMEPAGE;
}

export function setDefaultHomepage(homepage: DefaultHomepage): void {
    try {
        localStorage.setItem(DEFAULT_HOMEPAGE_STORAGE_KEY, homepage);
        window.dispatchEvent(new CustomEvent('default-homepage-change', { detail: homepage }));
    } catch (error) {
        log.error('Failed to save default homepage to localStorage', error);
    }
}

export function getDefaultHomepageRoute(homepage: DefaultHomepage = getDefaultHomepage()): string {
    if (homepage === 'timeline') {
        return '/timeline';
    }

    if (homepage === 'folders') {
        return '/folders';
    }

    if (homepage === 'chat') {
        return '/chat';
    }

    return '/timeline';
}

export function useDefaultHomepage() {
    const [homepage, setHomepage] = React.useState<DefaultHomepage>(() => getDefaultHomepage());

    React.useEffect(() => {
        const handleChange = (event: Event) => {
            const customEvent = event as CustomEvent<DefaultHomepage>;
            const value = customEvent.detail;
            if (value === 'timeline' || value === 'folders' || value === 'chat') {
                setHomepage(value);
                return;
            }
            setHomepage(getDefaultHomepage());
        };

        window.addEventListener('default-homepage-change', handleChange);
        return () => window.removeEventListener('default-homepage-change', handleChange);
    }, []);

    return homepage;
}

// ===== LAST NON-DOCUMENT ROUTE =====

export function getLastNonDocumentRoute(): string | null {
    try {
        const stored = localStorage.getItem(LAST_NON_DOCUMENT_ROUTE_STORAGE_KEY);
        return stored && stored.startsWith('/') ? stored : null;
    } catch (error) {
        log.error('Failed to read last non-document route from localStorage', error);
    }

    return null;
}

export function setLastNonDocumentRoute(route: string): void {
    if (!route.startsWith('/') || route.startsWith('/document/')) {
        return;
    }

    try {
        localStorage.setItem(LAST_NON_DOCUMENT_ROUTE_STORAGE_KEY, route);
    } catch (error) {
        log.error('Failed to save last non-document route to localStorage', error);
    }
}

// ===== LAST CHAT SESSION =====

const LAST_CHAT_STORAGE_KEY = 'nana-last-chat';
const LAST_CHAT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

interface LastChat {
    id: string;
    timestamp: number;
}

export function getLastChat(): LastChat | null {
    try {
        const stored = localStorage.getItem(LAST_CHAT_STORAGE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored) as LastChat;
            if (parsed.id && typeof parsed.timestamp === 'number') {
                return parsed;
            }
        }
    } catch {
        // ignore
    }
    return null;
}

/** Returns the last chat ID if it was active within the last 30 minutes, otherwise null. */
export function getRecentChatId(): string | null {
    const last = getLastChat();
    if (last && Date.now() - last.timestamp < LAST_CHAT_TIMEOUT_MS) {
        return last.id;
    }
    return null;
}

export function setLastChat(id: string): void {
    try {
        const data: LastChat = { id, timestamp: Date.now() };
        localStorage.setItem(LAST_CHAT_STORAGE_KEY, JSON.stringify(data));
    } catch {
        // ignore
    }
}

export function clearLastChat(): void {
    try {
        localStorage.removeItem(LAST_CHAT_STORAGE_KEY);
    } catch {
        // ignore
    }
}

// ===== FUTURE SETTINGS =====
// Add more settings here as needed

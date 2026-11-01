import { useState, useEffect, useRef, useCallback } from 'react';

export function useMobileState(isOpen: boolean, toggle: () => void) {
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
    const hasSidebarHistoryEntryRef = useRef(false);
    const isProgrammaticHistoryBackRef = useRef(false);
    const skipHistoryBackOnCloseRef = useRef(false);

    // Detect mobile viewport changes
    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // Handle back button on mobile
    useEffect(() => {
        if (!isMobile) return;

        const handlePopState = () => {
            if (isProgrammaticHistoryBackRef.current) {
                isProgrammaticHistoryBackRef.current = false;
                return;
            }

            if (isOpen) {
                toggle();
                hasSidebarHistoryEntryRef.current = false;
            }
        };

        if (isOpen && !hasSidebarHistoryEntryRef.current) {
            // Mark the entry so an overlay opened from the drawer (the chat
            // dock) can take it over instead of pushing a second guard.
            window.history.pushState(
                { ...(window.history.state ?? {}), nanaBackToClose: true },
                '',
                window.location.href,
            );
            hasSidebarHistoryEntryRef.current = true;
        } else if (!isOpen && hasSidebarHistoryEntryRef.current) {
            if (skipHistoryBackOnCloseRef.current) {
                // Closing due to navigation — don't call history.back()
                // which would undo the navigation
                skipHistoryBackOnCloseRef.current = false;
                hasSidebarHistoryEntryRef.current = false;
            } else {
                isProgrammaticHistoryBackRef.current = true;
                window.history.back();
                hasSidebarHistoryEntryRef.current = false;
            }
        }

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [isMobile, isOpen, toggle]);

    /**
     * Call before navigating + closing the sidebar on mobile.
     * Prevents the close effect from calling history.back(),
     * which would undo the navigation.
     */
    const prepareForNavigation = useCallback(() => {
        skipHistoryBackOnCloseRef.current = true;
    }, []);

    return {
        isMobile,
        prepareForNavigation,
    };
}

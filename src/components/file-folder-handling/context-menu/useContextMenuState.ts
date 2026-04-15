import { useEffect, useRef, useState } from 'react';

const CONTEXT_MENU_EXIT_DURATION_MS = 180;

export interface ContextMenuState {
    x: number;
    y: number;
    type: 'empty' | 'folder' | 'document' | 'trash-document' | 'trash-folder';
    folderId?: string;
    folderName?: string;
    documentId?: string;
}

export function useContextMenuState() {
    const [contextMenu, setContextMenuState] = useState<ContextMenuState | null>(null);
    const setContextMenu = (nextContextMenu: ContextMenuState | null) => {
        clearCloseTimeout();
        setIsClosingContextMenu(false);
        setContextMenuState(nextContextMenu);
    };

    const [isClosingContextMenu, setIsClosingContextMenu] = useState(false);
    const contextMenuRef = useRef<HTMLDivElement>(null);
    const closeTimeoutRef = useRef<Timer | null>(null);

    const clearCloseTimeout = () => {
        if (closeTimeoutRef.current) {
            clearTimeout(closeTimeoutRef.current);
            closeTimeoutRef.current = null;
        }
    };

    const handleContextMenu = (
        e: React.MouseEvent | React.TouchEvent,
        type: ContextMenuState['type'],
        options?: { folderId?: string; folderName?: string; documentId?: string }
    ) => {
        e.preventDefault();
        e.stopPropagation();
        clearCloseTimeout();
        setIsClosingContextMenu(false);
        const clientX = 'clientX' in e ? e.clientX : e.touches[0]?.clientX || 0;
        const clientY = 'clientY' in e ? e.clientY : e.touches[0]?.clientY || 0;
        setContextMenuState({ x: clientX, y: clientY, type, ...options });
    };

    const closeContextMenu = () => {
        if (!contextMenu || isClosingContextMenu) {
            return;
        }

        clearCloseTimeout();
        setIsClosingContextMenu(true);

        closeTimeoutRef.current = setTimeout(() => {
            setContextMenu(null);
            setIsClosingContextMenu(false);
            closeTimeoutRef.current = null;
        }, CONTEXT_MENU_EXIT_DURATION_MS);
    };

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
                closeContextMenu();
            }
        };

        if (contextMenu) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [contextMenu, closeContextMenu]);

    useEffect(() => {
        return () => {
            clearCloseTimeout();
        };
    }, []);

    return {
        contextMenu,
        isClosingContextMenu,
        setContextMenu,
        contextMenuRef,
        handleContextMenu,
        closeContextMenu,
    };
}

import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

interface UseResponsiveContextMenuPositionOptions {
    contextMenuRef: RefObject<HTMLDivElement | null>;
    x: number;
    y: number;
}

interface MenuPosition {
    top: number | string;
    left: number | string;
    right: number | string;
}

export function useResponsiveContextMenuPosition({
    contextMenuRef,
    x,
    y,
}: UseResponsiveContextMenuPositionOptions) {
    const [position, setPosition] = useState<MenuPosition>({
        top: y,
        left: x,
        right: 'auto',
    });
    const [submenuPosition, setSubmenuPosition] = useState<'right' | 'left'>('right');
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

    useEffect(() => {
        const handleResize = () => {
            setIsMobile(window.innerWidth < 768);
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useLayoutEffect(() => {
        if (!contextMenuRef.current) return;

        const menuRect = contextMenuRef.current.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const MENU_GUTTER = 10;
        const FALLBACK_SUBMENU_WIDTH = 170;

        const menuWidth = Math.max(1, menuRect.width);
        const menuHeight = Math.max(1, menuRect.height);

        const maxLeft = Math.max(MENU_GUTTER, viewportWidth - menuWidth - MENU_GUTTER);
        const maxTop = Math.max(MENU_GUTTER, viewportHeight - menuHeight - MENU_GUTTER);

        const newLeft = Math.max(MENU_GUTTER, Math.min(x, maxLeft));
        const newTop = Math.max(MENU_GUTTER, Math.min(y, maxTop));

        const submenuWillOverflowRight = newLeft + menuWidth + FALLBACK_SUBMENU_WIDTH > viewportWidth - MENU_GUTTER;
        setSubmenuPosition(submenuWillOverflowRight ? 'left' : 'right');

        setPosition({ top: newTop, left: newLeft, right: 'auto' });
    }, [contextMenuRef, x, y]);

    return {
        position,
        submenuPosition,
        isMobile,
    };
}
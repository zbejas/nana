import { useAtom, useSetAtom } from 'jotai';
import { sidebarOpenAtom, toggleSidebarAtom, sidebarResizingAtom } from '../atoms';

/**
 * Hook for sidebar state and actions
 */
export function useSidebar() {
    const [isOpen, setIsOpen] = useAtom(sidebarOpenAtom);
    const toggle = useSetAtom(toggleSidebarAtom);
    const [isResizing, setIsResizing] = useAtom(sidebarResizingAtom);

    return {
        isOpen,
        setIsOpen,
        toggle,
        isResizing,
        setIsResizing,
    };
}

import { useState, useEffect } from 'react';

export function useCollapsibleSections() {
    const [filesCollapsed, setFilesCollapsed] = useState(() =>
        localStorage.getItem('sidebar-files-collapsed') === 'true'
    );

    useEffect(() => {
        localStorage.setItem('sidebar-files-collapsed', String(filesCollapsed));
    }, [filesCollapsed]);

    return {
        filesCollapsed,
        setFilesCollapsed,
    };
}

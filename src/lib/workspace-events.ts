/**
 * Local workspace change notifications.
 *
 * PocketBase realtime cannot deliver a soft-deleted record once it stops
 * matching the collection list rule. A note or folder moved to trash by the
 * AI would therefore leave the sidebar, trash, and open editor stale. Server
 * writes that bypass the browser (chat confirmations, MCP) also have no local
 * mutation to update Jotai state. These events close that gap between the
 * mutation and the surfaces that cache workspace data.
 */

export type WorkspaceTargetType = 'document' | 'folder' | 'board' | 'task';

export interface WorkspaceTarget {
    type: WorkspaceTargetType;
    id: string;
    title?: string;
}

export interface WorkspaceChangeDetail {
    /** Records that changed, so surfaces can close an open item. */
    targets: WorkspaceTarget[];
    /** True when the records left the active workspace for trash. */
    removed?: boolean;
    /** Toast copy for the change, shown once by the app shell. */
    message?: string;
}

export const WORKSPACE_CHANGED_EVENT = 'nana:workspace-changed';

export function notifyWorkspaceChanged(detail: WorkspaceChangeDetail): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent<WorkspaceChangeDetail>(WORKSPACE_CHANGED_EVENT, {
        detail,
    }));
}

export function subscribeWorkspaceChanged(
    handler: (detail: WorkspaceChangeDetail) => void,
): () => void {
    if (typeof window === 'undefined') return () => undefined;

    const listener = (event: Event) => {
        const detail = (event as CustomEvent<WorkspaceChangeDetail>).detail;
        if (!detail || !Array.isArray(detail.targets)) return;
        handler(detail);
    };

    window.addEventListener(WORKSPACE_CHANGED_EVENT, listener);
    return () => window.removeEventListener(WORKSPACE_CHANGED_EVENT, listener);
}

/** Copy for one removed target; the app shell owns the toast. */
export function removalMessage(target: WorkspaceTarget): string {
    if (target.type === 'document') return 'Note moved to trash';
    if (target.type === 'folder') return 'Folder moved to trash';
    if (target.type === 'board') return 'Board moved to trash';
    return 'Task deleted';
}

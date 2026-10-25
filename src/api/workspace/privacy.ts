import { escapeFilterString } from "../chat/tools/text";
import {
    pbRequest,
    queryString,
    type PBListResponse,
    type ToolContext,
    type ToolResult,
} from "../pocketbase/client";

/**
 * Folder privacy for AI surfaces.
 *
 * A private folder and every folder below it are invisible to AI. The helper
 * is structural: callers must not rely on a prompt to skip hidden ids.
 */
export interface AiVisibility {
    hiddenFolderIds: Set<string>;
}

interface PBFolderVisibilityRecord {
    id: string;
    parent?: string;
    is_private?: boolean;
}

interface FolderTreeEntry {
    id: string;
    parent?: string;
    is_private?: boolean;
}

/**
 * Pure tree walk: private folders plus all their descendants are hidden.
 * Cycles and repeated ids are tolerated.
 */
export function computeHiddenFolderIds(
    folders: Array<{ id: string; parent?: string; is_private?: boolean }>,
): Set<string> {
    const hidden = new Set<string>();
    const childrenByParent = new Map<string, string[]>();

    for (const folder of folders) {
        if (!folder || typeof folder.id !== "string" || !folder.id) continue;
        if (folder.is_private === true) hidden.add(folder.id);
        if (typeof folder.parent === "string" && folder.parent) {
            const children = childrenByParent.get(folder.parent);
            if (children) {
                children.push(folder.id);
            } else {
                childrenByParent.set(folder.parent, [folder.id]);
            }
        }
    }

    const queue = [...hidden];
    while (queue.length > 0) {
        const id = queue.shift();
        if (id === undefined) break;
        for (const childId of childrenByParent.get(id) ?? []) {
            if (hidden.has(childId)) continue;
            hidden.add(childId);
            queue.push(childId);
        }
    }

    return hidden;
}

/**
 * Read every folder owned by the caller and derive the hidden subtree.
 * Paged because a user may have more folders than one response can carry.
 */
export async function loadAiVisibility(
    context: ToolContext,
    signal?: AbortSignal,
): Promise<ToolResult<AiVisibility>> {
    const records: FolderTreeEntry[] = [];
    const filter = `author="${escapeFilterString(context.userId)}"`;
    let page = 1;
    let totalPages = 1;

    do {
        const path = `/api/collections/folders/records${queryString({
            filter,
            page,
            perPage: 500,
            fields: "id,parent,is_private,author",
        })}`;
        const result = await pbRequest<PBListResponse<PBFolderVisibilityRecord>>(path, context, { signal });
        if (!result.ok) return result;

        const items = Array.isArray(result.items) ? result.items : [];
        for (const item of items) {
            if (!item || typeof item.id !== "string") continue;
            records.push({
                id: item.id,
                parent: typeof item.parent === "string" ? item.parent : "",
                is_private: item.is_private === true,
            });
        }

        const reportedPages = typeof result.totalPages === "number" && result.totalPages > 0
            ? result.totalPages
            : page;
        totalPages = reportedPages;
        if (items.length === 0) break;
        page += 1;
    } while (page <= totalPages);

    return { ok: true, hiddenFolderIds: computeHiddenFolderIds(records) };
}

/** An empty folder id means the workspace root and is always visible. */
export function folderIsLocked(visibility: AiVisibility, folderId?: string | null): boolean {
    if (!folderId) return false;
    return visibility.hiddenFolderIds.has(folderId);
}

export function noteIsLocked(
    visibility: AiVisibility,
    record: { is_private?: boolean; folder?: string },
): boolean {
    return record.is_private === true || folderIsLocked(visibility, record.folder);
}

export function boardIsLocked(
    visibility: AiVisibility,
    record: { is_private?: boolean; folder?: string },
): boolean {
    return record.is_private === true || folderIsLocked(visibility, record.folder);
}

/**
 * PocketBase filter fragments for AI list queries. `is_private=false` covers
 * private records; `folder!="<id>"` excludes each hidden folder. Notes and
 * boards in the root (empty folder) are always eligible.
 */
export function aiVisibilityConditions(visibility: AiVisibility): string[] {
    const conditions = ["is_private=false"];
    for (const folderId of visibility.hiddenFolderIds) {
        conditions.push(`folder!="${escapeFilterString(folderId)}"`);
    }
    return conditions;
}

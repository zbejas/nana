import { escapeFilterString } from "../chat/tools/text";
import {
    pbRequest,
    queryString,
    type PBListResponse,
    type ToolContext,
    type ToolResult,
} from "../pocketbase/client";
import type { Surface } from "./types";

/**
 * Folder visibility for workspace reads and writes.
 *
 * Two independent restrictions share one computed set of hidden folders:
 *
 * - AI surfaces hide private folders and their entire subtree.
 * - API keys can be limited to the workspace root, or to one or more folder
 *   subtrees. Everything outside that envelope is hidden.
 *
 * The helper is structural: callers must not rely on a prompt or a client-side
 * filter to skip hidden ids.
 */
export interface AiVisibility {
    hiddenFolderIds: Set<string>;
}

export interface WorkspaceVisibility extends AiVisibility {
    /** False when an API key is folder-scoped: records at the root are hidden. */
    rootAllowed: boolean;
    /** False for a root-only key: folders themselves are outside its scope. */
    foldersAllowed: boolean;
    /** True when an API key is limited to selected folder subtrees. */
    folderScoped: boolean;
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

export function unrestrictedVisibility(): WorkspaceVisibility {
    return {
        hiddenFolderIds: new Set(),
        rootAllowed: true,
        foldersAllowed: true,
        folderScoped: false,
    };
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
 * Pure tree walk in the other direction: the selected roots and every folder
 * below them. Roots that are not in the owned folder list are ignored, so a
 * deleted or foreign id grants nothing.
 */
export function computeIncludedFolderIds(
    folders: Array<{ id: string; parent?: string }>,
    rootIds: string[],
): Set<string> {
    const known = new Set<string>();
    const childrenByParent = new Map<string, string[]>();

    for (const folder of folders) {
        if (!folder || typeof folder.id !== "string" || !folder.id) continue;
        known.add(folder.id);
        if (typeof folder.parent === "string" && folder.parent) {
            const children = childrenByParent.get(folder.parent);
            if (children) {
                children.push(folder.id);
            } else {
                childrenByParent.set(folder.parent, [folder.id]);
            }
        }
    }

    const included = new Set<string>();
    const queue: string[] = [];
    for (const rootId of rootIds) {
        if (!known.has(rootId) || included.has(rootId)) continue;
        included.add(rootId);
        queue.push(rootId);
    }

    while (queue.length > 0) {
        const id = queue.shift();
        if (id === undefined) break;
        for (const childId of childrenByParent.get(id) ?? []) {
            if (included.has(childId)) continue;
            included.add(childId);
            queue.push(childId);
        }
    }

    return included;
}

/**
 * Derive the effective visibility from an already-loaded owned folder list.
 * Pure, so listFolders can reuse the records it already fetched.
 */
export function visibilityFromFolders(
    folders: FolderTreeEntry[],
    context: ToolContext,
    surface: Surface,
): WorkspaceVisibility {
    const visibility = unrestrictedVisibility();
    const folderIds = folders
        .map((folder) => folder.id)
        .filter((id): id is string => typeof id === "string" && Boolean(id));

    if (surface === "ai") {
        for (const id of computeHiddenFolderIds(folders)) {
            visibility.hiddenFolderIds.add(id);
        }
    }

    const key = context.apiKey;
    if (!key || key.scope === "workspace") return visibility;

    if (key.scope === "root") {
        // Root records are allowed; every folder is outside the key.
        for (const id of folderIds) visibility.hiddenFolderIds.add(id);
        visibility.foldersAllowed = false;
        return visibility;
    }

    // Folder scope. Include the selected roots and their descendants; hide
    // every other folder and the workspace root.
    const included = computeIncludedFolderIds(folders, key.folderIds);
    for (const id of folderIds) {
        if (!included.has(id)) visibility.hiddenFolderIds.add(id);
    }
    visibility.rootAllowed = false;
    visibility.folderScoped = true;
    return visibility;
}

/**
 * Read every folder owned by the caller and derive the effective visibility.
 * Paged because a user may have more folders than one response can carry.
 */
export async function loadWorkspaceVisibility(
    context: ToolContext,
    surface: Surface,
    signal?: AbortSignal,
): Promise<ToolResult<WorkspaceVisibility>> {
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

    return { ok: true, ...visibilityFromFolders(records, context, surface) };
}

/**
 * AI visibility for the chat read tools. Chat never uses API keys, so this is
 * the private-folder lock plus the unrestricted root.
 */
export async function loadAiVisibility(
    context: ToolContext,
    signal?: AbortSignal,
): Promise<ToolResult<WorkspaceVisibility>> {
    return loadWorkspaceVisibility(context, "ai", signal);
}

/** An empty folder id means the workspace root and is always a valid relation. */
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
 * The full record lock for any surface. AI adds the private flag; every key
 * scope adds its folder envelope; a folder-scoped key also hides root records.
 */
export function recordIsLocked(
    visibility: WorkspaceVisibility,
    surface: Surface,
    record: { is_private?: boolean; folder?: string },
): boolean {
    if (surface === "ai" && record.is_private === true) return true;
    if (folderIsLocked(visibility, record.folder)) return true;
    if (!visibility.rootAllowed && !record.folder) return true;
    return false;
}

/**
 * PocketBase filter fragments for workspace lists. `is_private=false` is only
 * added for AI; API key scopes apply to the owner surface too. Folder keys add
 * one exclusion per hidden folder and, when root is out of scope, exclude the
 * empty folder value.
 */
export function workspaceVisibilityConditions(
    visibility: WorkspaceVisibility,
    surface: Surface,
): string[] {
    const conditions: string[] = [];
    if (surface === "ai") conditions.push("is_private=false");
    for (const folderId of visibility.hiddenFolderIds) {
        conditions.push(`folder!="${escapeFilterString(folderId)}"`);
    }
    if (!visibility.rootAllowed) conditions.push('folder!=""');
    return conditions;
}

/** Backwards-compatible helper for the chat read tools. */
export function aiVisibilityConditions(visibility: AiVisibility): string[] {
    return workspaceVisibilityConditions(
        { ...visibility, rootAllowed: true, foldersAllowed: true, folderScoped: false },
        "ai",
    );
}

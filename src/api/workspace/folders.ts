import { escapeFilterString } from "../chat/tools/text";
import {
    pbRequest,
    queryString,
    type PBListResponse,
    type ToolContext,
} from "../pocketbase/client";
import { badRequest, notFound, upstream } from "./errors";
import { folderIsLocked, visibilityFromFolders } from "./privacy";
import {
    assertFolderVisible,
    assertWritable,
    normalizeFolderId,
    unwrap,
    visibilityFor,
} from "./shared";
import type { FolderDto, Surface } from "./types";

interface PBFolderRecord {
    id: string;
    name?: string;
    parent?: string;
    is_private?: boolean;
    is_public?: boolean;
    author?: string;
    created?: string;
    updated?: string;
}

export interface CreateFolderInput {
    name: string;
    parentId?: string | null;
    isPrivate?: boolean;
}

export interface UpdateFolderInput {
    name?: string;
    parentId?: string | null;
}

const FOLDER_FIELDS = "id,name,parent,is_private,is_public,author,created,updated";

function toFolderDto(record: PBFolderRecord, parentOverride?: string | null): FolderDto {
    return {
        id: record.id,
        name: (record.name || "Untitled folder").trim(),
        parentId: parentOverride === undefined ? record.parent || null : parentOverride,
        isPrivate: record.is_private === true,
        isPublic: record.is_public === true,
        created: record.created || "",
        updated: record.updated || "",
    };
}

async function loadAllFolders(context: ToolContext): Promise<PBFolderRecord[]> {
    const records: PBFolderRecord[] = [];
    const filter = `author="${escapeFilterString(context.userId)}"`;
    let page = 1;
    let totalPages = 1;

    do {
        const path = `/api/collections/folders/records${queryString({
            filter,
            sort: "name",
            page,
            perPage: 500,
            fields: FOLDER_FIELDS,
        })}`;
        const result = unwrap(await pbRequest<PBListResponse<PBFolderRecord>>(path, context));
        const items = Array.isArray(result.items) ? result.items : [];
        for (const item of items) {
            if (item && typeof item.id === "string") records.push(item);
        }
        totalPages = typeof result.totalPages === "number" && result.totalPages > 0
            ? result.totalPages
            : page;
        if (items.length === 0) break;
        page += 1;
    } while (page <= totalPages);

    return records;
}

/**
 * List the caller's folders. AI hides private folders and their entire
 * subtree; an API key hides everything outside its envelope. Any surviving
 * child whose parent was hidden is re-rooted to null so the hidden id never
 * escapes.
 */
export async function listFolders(
    context: ToolContext,
    surface: Surface = "user",
): Promise<FolderDto[]> {
    const records = await loadAllFolders(context);
    const visibility = visibilityFromFolders(records, context, surface);

    return records
        .filter((record) => !folderIsLocked(visibility, record.id))
        .map((record) => {
            const parentId = record.parent || null;
            const safeParent = parentId && folderIsLocked(visibility, parentId) ? null : parentId;
            return toFolderDto(record, safeParent);
        });
}

/** Create a folder. The parent must be visible to this caller's credential. */
export async function createFolder(
    context: ToolContext,
    surface: Surface = "user",
    input: CreateFolderInput,
): Promise<FolderDto> {
    assertWritable(context);

    const name = (input.name || "").trim();
    if (!name) throw badRequest("A folder name is required.");

    const visibility = await visibilityFor(context, surface);
    const parentId = normalizeFolderId(input.parentId);
    if (parentId) {
        await assertFolderVisible(context, surface, parentId, visibility);
    } else if (!visibility.rootAllowed || !visibility.foldersAllowed) {
        throw notFound();
    }

    const body: Record<string, unknown> = {
        name,
        author: context.userId,
        is_private: input.isPrivate === true,
    };
    if (parentId) body.parent = parentId;

    const path = "/api/collections/folders/records";
    const record = unwrap(await pbRequest<PBFolderRecord>(path, context, { method: "POST", body }));
    return toFolderDto(record);
}

/**
 * Rename a folder or move it under another visible folder. Cycles are rejected
 * before the write; PocketBase's relation guard remains the final check.
 */
export async function updateFolder(
    context: ToolContext,
    surface: Surface = "user",
    id: string,
    patch: UpdateFolderInput,
): Promise<FolderDto> {
    assertWritable(context);

    const folders = await loadAllFolders(context);
    const current = folders.find((folder) => folder.id === id);
    if (!current) throw notFound();

    const visibility = visibilityFromFolders(folders, context, surface);
    if (folderIsLocked(visibility, id)) throw notFound();

    const body: Record<string, unknown> = {};
    let changed = false;

    if (patch.name !== undefined) {
        const name = (patch.name || "").trim();
        if (!name) throw badRequest("A folder name is required.");
        body.name = name;
        changed = true;
    }

    if (patch.parentId !== undefined) {
        const parentId = normalizeFolderId(patch.parentId);
        if (parentId === id) throw badRequest("A folder cannot be its own parent.");
        if (parentId) {
            await assertFolderVisible(context, surface, parentId, visibility);
            const byId = new Map(folders.map((folder) => [folder.id, folder]));
            const seen = new Set<string>();
            let cursor: string | null = parentId;
            while (cursor) {
                if (cursor === id) {
                    throw badRequest("A folder cannot move inside itself.");
                }
                if (seen.has(cursor)) break;
                seen.add(cursor);
                cursor = byId.get(cursor)?.parent || null;
            }
        } else if (!visibility.rootAllowed || !visibility.foldersAllowed) {
            throw notFound();
        }
        body.parent = parentId || "";
        changed = true;
    }

    if (!changed) return toFolderDto(current);

    const path = `/api/collections/folders/records/${encodeURIComponent(current.id)}`;
    const record = unwrap(await pbRequest<PBFolderRecord>(path, context, { method: "PATCH", body }));
    return toFolderDto(record);
}

/**
 * Move a visible folder subtree to trash. PocketBase rehomes any boards in the
 * subtree to the root and the folder keeps its trash entry for restore.
 */
export async function deleteFolder(
    context: ToolContext,
    surface: Surface = "user",
    id: string,
): Promise<{ trashFolderId: string }> {
    assertWritable(context);

    const folders = await listFolders(context, surface);
    if (!folders.some((folder) => folder.id === id)) throw notFound();

    const result = unwrap(await pbRequest<{ trashFolderId?: string }>(
        "/api/trash/move-folder",
        context,
        { method: "POST", body: { folderId: id } },
    ));
    if (typeof result.trashFolderId !== "string" || !result.trashFolderId) {
        throw upstream("The folder could not be moved to trash.");
    }
    return { trashFolderId: result.trashFolderId };
}

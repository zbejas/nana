import { escapeFilterString } from "../chat/tools/text";
import {
    pbRequest,
    queryString,
    type PBListResponse,
    type ToolContext,
} from "../pocketbase/client";
import { badRequest, notFound } from "./errors";
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

import { z } from "zod";
import { listFolders } from "../../workspace/folders";
import type { ToolContext, ToolResult } from "./http";
import type { FolderDto } from "../../workspace/types";

export const listFoldersInputSchema = z.object({});

export interface ListFoldersResult {
    ok: true;
    folders: FolderDto[];
}

/**
 * List every folder visible to the caller in the AI surface. The workspace
 * service applies author scoping, API-key scope, and the private-folder lock;
 * hidden parents are re-rooted rather than leaked.
 */
export async function listFoldersForChat(context: ToolContext): Promise<ToolResult<ListFoldersResult>> {
    const folders = await listFolders(context, "ai");
    return { ok: true, folders };
}

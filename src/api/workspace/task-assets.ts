import type { AttachmentKind } from "../../lib/attachments";
import { serverConfig } from "../../lib/config";
import { detectAttachment } from "../chat/attachments";
import { getFileToken } from "../export/auth";
import type { ToolContext } from "../pocketbase/client";
import { badRequest, notFound, upstream } from "./errors";
import { getTask } from "./tasks";
import type { Surface, TaskAttachmentDto } from "./types";

/**
 * Task attachments are protected PocketBase files. MCP and typed REST callers
 * can inspect metadata through the workspace service; the bytes are fetched
 * with a short-lived file token for a record the caller can already read.
 *
 * Keep the response bounded: a 50 MB task file must not become a multi-megabyte
 * model payload. List still reports it; read refuses it with a clear message.
 */
const MAX_ASSET_BYTES = 10 * 1024 * 1024;
const ASSET_TIMEOUT_MS = 15_000;
const TOKEN_TIMEOUT_MS = 8_000;

export interface TaskAttachmentAsset extends TaskAttachmentDto {
    data: Uint8Array;
}

export async function listTaskAttachments(
    context: ToolContext,
    surface: Surface = "user",
    taskId: string,
): Promise<TaskAttachmentDto[]> {
    const task = await getTask(context, surface, taskId);
    return task.attachments;
}

export async function readTaskAttachment(
    context: ToolContext,
    surface: Surface = "user",
    taskId: string,
    filename: string,
): Promise<TaskAttachmentAsset> {
    const task = await getTask(context, surface, taskId);
    const attachment = task.attachments.find((entry) => entry.filename === filename);
    if (!attachment) throw notFound();

    let fileToken: string;
    try {
        fileToken = await getFileToken(context.authHeader, AbortSignal.timeout(TOKEN_TIMEOUT_MS));
    } catch {
        throw upstream("The attachment service is unavailable right now.");
    }

    const url = `${serverConfig.pocketbaseUrl}/api/files/tasks/${encodeURIComponent(task.id)}/${encodeURIComponent(attachment.filename)}?token=${encodeURIComponent(fileToken)}`;
    let response: Response;
    try {
        response = await fetch(url, { signal: AbortSignal.timeout(ASSET_TIMEOUT_MS) });
    } catch {
        throw upstream("The attachment took too long to load.");
    }
    if (!response.ok) {
        if (response.status === 401 || response.status === 403 || response.status === 404) {
            throw notFound();
        }
        throw upstream("The attachment could not be loaded.");
    }

    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_ASSET_BYTES) {
        throw badRequest("That attachment is too large to return through MCP.");
    }

    const data = new Uint8Array(await response.arrayBuffer());
    if (data.byteLength > MAX_ASSET_BYTES) {
        throw badRequest("That attachment is too large to return through MCP.");
    }

    // Bytes win over the extension. An image is only sent as an image when its
    // magic bytes match, and text must decode as UTF-8.
    let kind: AttachmentKind = attachment.kind;
    let mimeType = attachment.mimeType;
    try {
        const detected = detectAttachment(data, "", attachment.name);
        kind = detected.kind;
        mimeType = detected.mimeType;
    } catch {
        // Unknown binary; the metadata extension still names it for the caller.
    }

    return {
        ...attachment,
        kind,
        mimeType,
        data,
    };
}

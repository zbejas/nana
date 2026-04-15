import { verifyAuth, AuthError } from "./auth";
import { downloadDocumentAttachments, obtainFileToken } from "./attachments";
import { createExportCache } from "./cache";
import { resolveExportDocuments, sanitizeFilename } from "./documents";
import { buildExportZip } from "./zip-builder";
import type { ExportRequest, ResolvedDocument, AttachmentFile } from "./types";
import { createLogger } from "../../lib/logger";

const log = createLogger("Export");

/**
 * Main handler for POST /api/export
 *
 * Request body (JSON):
 *   { documentIds?: string[], folderIds?: string[], zipName?: string }
 *
 * Requires a valid PocketBase Authorization header.
 * Returns a ZIP file as an attachment download.
 */
export async function handleExport(req: Request): Promise<Response> {
    // ── Method check ─────────────────────────────────────────────────
    if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
            status: 405,
            headers: { "Content-Type": "application/json" },
        });
    }

    // ── Auth ─────────────────────────────────────────────────────────
    let userId: string;
    try {
        userId = await verifyAuth(req);
    } catch (err) {
        const status = err instanceof AuthError ? err.status : 401;
        const message = err instanceof Error ? err.message : "Authentication failed";
        return new Response(JSON.stringify({ error: message }), {
            status,
            headers: { "Content-Type": "application/json" },
        });
    }

    // ── Parse body ───────────────────────────────────────────────────
    let body: ExportRequest;
    try {
        body = (await req.json()) as ExportRequest;
    } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
    }

    const documentIds = body.documentIds ?? [];
    const folderIds = body.folderIds ?? [];

    if (documentIds.length === 0 && folderIds.length === 0) {
        return new Response(JSON.stringify({ error: "No documents or folders specified" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
    }

    // ── Cache setup ──────────────────────────────────────────────────
    const requestId = crypto.randomUUID();
    const cache = createExportCache(requestId);

    try {
        const authHeader = req.headers.get("Authorization")!;

        // ── Resolve documents ────────────────────────────────────────
        const { resolved, rootFolderNames } = await resolveExportDocuments({
            userId,
            authHeader,
            documentIds,
            folderIds,
        });

        if (resolved.length === 0) {
            return new Response(JSON.stringify({ error: "No documents found to export" }), {
                status: 404,
                headers: { "Content-Type": "application/json" },
            });
        }

        // ── Download attachments ─────────────────────────────────────
        // Only obtain a file token if any document has attachments
        const hasAnyAttachments = resolved.some((r) => r.doc.attachments?.length > 0);
        let fileToken = "";
        if (hasAnyAttachments) {
            fileToken = await obtainFileToken(authHeader);
        }

        const entries: { resolved: ResolvedDocument; attachments: AttachmentFile[] }[] = [];

        for (const item of resolved) {
            let attachments: AttachmentFile[] = [];
            if (item.doc.attachments?.length > 0 && fileToken) {
                attachments = await downloadDocumentAttachments(item.doc, fileToken, cache);
            }
            entries.push({ resolved: item, attachments });
        }

        // ── Build ZIP ────────────────────────────────────────────────
        const zipData = await buildExportZip(entries);

        // ── Determine filename ───────────────────────────────────────
        let zipName = body.zipName;
        if (!zipName) {
            if (folderIds.length === 1 && documentIds.length === 0 && folderIds[0]) {
                // Single folder export – use folder name
                zipName = rootFolderNames.get(folderIds[0]) ?? "export";
            } else if (documentIds.length === 1 && folderIds.length === 0 && resolved.length === 1 && resolved[0]) {
                // Single document export – use document title
                zipName = resolved[0].doc.title || "export";
            } else {
                zipName = "export";
            }
        }

        const safeFilename = `${sanitizeFilename(zipName)}.zip`;

        // ── Send response ────────────────────────────────────────────
        return new Response(zipData.buffer as ArrayBuffer, {
            status: 200,
            headers: {
                "Content-Type": "application/zip",
                "Content-Disposition": `attachment; filename="${safeFilename}"`,
                "Content-Length": String(zipData.byteLength),
            },
        });
    } catch (err) {
        log.error("Export failed", err);
        const message = err instanceof Error ? err.message : "Export failed";
        return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    } finally {
        // Always clean up cached files, whether success or failure
        cache.cleanup();
    }
}

import { serverConfig } from "../../lib/config";
import { getFileToken } from "./auth";
import type { ExportCache } from "./cache";
import { getOriginalFilename } from "./documents";
import type { AttachmentFile, PBDocument } from "./types";
import { createLogger } from "../../lib/logger";

const log = createLogger("Export");

const POCKETBASE_URL = serverConfig.pocketbaseUrl;

/**
 * Download all attachments for a single document from PocketBase file storage.
 * Files are cached via the provided ExportCache, then returned as AttachmentFile[].
 */
export async function downloadDocumentAttachments(
    doc: PBDocument,
    fileToken: string,
    cache: ExportCache,
): Promise<AttachmentFile[]> {
    if (!doc.attachments || doc.attachments.length === 0) {
        return [];
    }

    const results: AttachmentFile[] = [];

    for (const pbFilename of doc.attachments) {
        const url = `${POCKETBASE_URL}/api/files/${doc.collectionId}/${doc.id}/${encodeURIComponent(pbFilename)}?token=${encodeURIComponent(fileToken)}`;

        const res = await fetch(url);
        if (!res.ok) {
            log.error(`Failed to download attachment ${pbFilename} for doc ${doc.id}: ${res.status}`);
            continue; // Skip failed attachments rather than aborting the whole export
        }

        const data = new Uint8Array(await res.arrayBuffer());
        const displayName = getOriginalFilename(pbFilename);
        const cacheKey = `${doc.id}/${pbFilename}`;

        await cache.write(cacheKey, data);

        results.push({
            displayName,
            pbFilename,
            data,
        });
    }

    return results;
}

/**
 * Obtain a fresh file token for downloading protected PocketBase attachments.
 */
export async function obtainFileToken(authHeader: string): Promise<string> {
    return getFileToken(authHeader);
}

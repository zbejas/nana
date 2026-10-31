import { getDocument, updateDocument } from "./crud";
import type { Document } from "./types";
import {
    isRevisionConflict,
    mergeConcurrentMarkdown,
    needsConcurrentMerge,
} from "../collaboration/merge";
import { normalizeCollabMarkdown } from "../collaboration/normalize";

export interface MergedDocumentSaveInput {
    /** The loaded record whose revision/body the editor started from. */
    base: Document;
    title: string;
    content: string;
    tags: string[];
    attachments?: File[];
    removeAttachments?: string[];
    /** Called when the retry had to fold in text from another writer. */
    onMergedContent?: (content: string) => void;
}

export interface MergedDocumentSaveResult {
    document: Document;
    content: string;
}

export interface DocumentMetadataSaveInput {
    /** The loaded record whose revision the editor started from. */
    base: Document;
    title: string;
    tags: string[];
    attachments?: File[];
    removeAttachments?: string[];
}

/**
 * Notes whose Markdown body is currently owned by a connected live room.
 * `saveDocumentWithMerge()` routes these to metadata-only saves so an explicit
 * Save or version action cannot race the room with a stale body.
 */
const roomContentAuthorities = new Set<string>();

export function setRoomContentAuthority(documentId: string, owned: boolean): void {
    if (owned) {
        roomContentAuthorities.add(documentId);
    } else {
        roomContentAuthorities.delete(documentId);
    }
}

/**
 * Save a note and recover from a stale revision.
 *
 * Live editing normally merges before the debounce fires, so the first write
 * succeeds. When a save still loses the race (another tab, MCP, or an AI edit),
 * re-read the note, merge non-overlapping line changes, and retry against the
 * new revision instead of dropping the draft or overwriting the other writer.
 * While a live room owns the note, this only writes metadata; the room saves
 * the body.
 */
export async function saveDocumentWithMerge(
    input: MergedDocumentSaveInput,
): Promise<MergedDocumentSaveResult> {
    if (roomContentAuthorities.has(input.base.id)) {
        // The live room is the content writer. Persist metadata only and let
        // the room's own ack advance the note revision.
        const document = await saveDocumentMetadataWithRetry({
            base: input.base,
            title: input.title,
            tags: input.tags,
            attachments: input.attachments,
            removeAttachments: input.removeAttachments,
        });
        return { document, content: normalizeCollabMarkdown(input.content) };
    }

    let revisionDocument = input.base;
    let contentToSave = normalizeCollabMarkdown(input.content);
    const baseContent = normalizeCollabMarkdown(input.base.content);

    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            const document = await updateDocument(input.base.id, {
                title: input.title,
                content: contentToSave.trim(),
                tags: input.tags,
                revision: revisionDocument.revision,
                attachments: input.attachments && input.attachments.length > 0
                    ? input.attachments
                    : undefined,
                removeAttachments: input.removeAttachments && input.removeAttachments.length > 0
                    ? input.removeAttachments
                    : undefined,
            });
            return { document, content: contentToSave };
        } catch (error) {
            if (!isRevisionConflict(error) || attempt === 2) throw error;

            const latest = await getDocument(input.base.id);
            const remoteContent = normalizeCollabMarkdown(latest.content);
            let mergedContent = contentToSave;
            if (needsConcurrentMerge(baseContent, contentToSave, remoteContent)) {
                mergedContent = mergeConcurrentMarkdown(
                    baseContent,
                    contentToSave,
                    remoteContent,
                );
            } else if (contentToSave === baseContent) {
                mergedContent = remoteContent;
            }

            if (mergedContent !== contentToSave) {
                contentToSave = mergedContent;
                input.onMergedContent?.(mergedContent);
            }
            revisionDocument = latest;

            // Give the live stream a moment to deliver the remote transaction
            // so the retry writes the same merged body the editor now shows.
            await new Promise((resolve) => setTimeout(resolve, 120 + attempt * 180));
        }
    }

    throw new Error("Failed to save document");
}

/**
 * Save title/tags/attachments without sending the Markdown body.
 *
 * Use this while a live room owns content persistence. A stale revision is
 * adopted from the latest record and retried so the metadata lands, but the
 * retry never echoes an editor body that the room may already have superseded.
 */
export async function saveDocumentMetadataWithRetry(
    input: DocumentMetadataSaveInput,
): Promise<Document> {
    let revisionDocument = input.base;

    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            return await updateDocument(input.base.id, {
                title: input.title,
                tags: input.tags,
                revision: revisionDocument.revision,
                attachments: input.attachments && input.attachments.length > 0
                    ? input.attachments
                    : undefined,
                removeAttachments: input.removeAttachments && input.removeAttachments.length > 0
                    ? input.removeAttachments
                    : undefined,
            });
        } catch (error) {
            if (!isRevisionConflict(error) || attempt === 2) throw error;

            // The room or another writer advanced the note. Keep its body and
            // retry only this metadata against the newer revision.
            revisionDocument = await getDocument(input.base.id);
            await new Promise((resolve) => setTimeout(resolve, 120 + attempt * 180));
        }
    }

    throw new Error("Failed to save document metadata");
}

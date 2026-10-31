import { serverConfig } from "../../lib/config";
import { createLogger } from "../../lib/logger";
import {
    loadOwnedDocument,
    patchDocumentContent,
    type VersionableDocument,
    type VersionReader,
} from "./documents";
import { withNoteLock } from "./lock";
import { GitVersionStore, isNoteId, isVersionId } from "./store";
import type { CommitResult, NoteSnapshot, VersionDetail, VersionPage } from "./types";

const log = createLogger("Versioning");

const store = new GitVersionStore(serverConfig.versioningDir);

const NOT_FOUND = "Not found.";
const STALE_REVISION = "This note changed since it was loaded. Reload it and try again.";
const UNAVAILABLE = "The workspace is unavailable right now.";

export class VersioningError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = "VersioningError";
    }
}

function notFound(): VersioningError {
    return new VersioningError(404, NOT_FOUND);
}

function staleRevision(): VersioningError {
    return new VersioningError(409, STALE_REVISION);
}

function snapshotOf(document: VersionableDocument): NoteSnapshot {
    return {
        content: document.content,
        metadata: {
            title: document.title,
            tags: document.tags,
            folder: document.folder,
            is_private: document.is_private,
        },
    };
}

async function requireOwnedDocument(
    reader: VersionReader,
    documentId: string,
): Promise<VersionableDocument> {
    if (!isNoteId(documentId)) throw notFound();
    const result = await loadOwnedDocument(reader, documentId);
    if (!result.ok) {
        if (result.status === 404) throw notFound();
        throw new VersioningError(502, UNAVAILABLE);
    }
    return result.document;
}

export async function listDocumentVersions(
    reader: VersionReader,
    documentId: string,
    page: number,
    perPage: number,
): Promise<VersionPage> {
    return withNoteLock(documentId, async () => {
        await requireOwnedDocument(reader, documentId);
        return store.listVersions(documentId, page, perPage);
    });
}

export async function getDocumentVersion(
    reader: VersionReader,
    documentId: string,
    versionId: string,
): Promise<VersionDetail> {
    return withNoteLock(documentId, async () => {
        await requireOwnedDocument(reader, documentId);
        if (!isVersionId(versionId)) throw notFound();
        const version = await store.getVersion(documentId, versionId);
        if (!version) throw notFound();
        return version;
    });
}

export async function saveDocumentVersion(
    reader: VersionReader,
    documentId: string,
    expectedRevision: number,
): Promise<CommitResult> {
    return withNoteLock(documentId, async () => {
        const document = await requireOwnedDocument(reader, documentId);
        if (document.revision !== expectedRevision) throw staleRevision();

        return store.commit(documentId, snapshotOf(document), "Saved version");
    });
}

export async function restoreDocumentVersion(
    reader: VersionReader,
    documentId: string,
    versionId: string,
    expectedRevision: number,
): Promise<{ document: Record<string, unknown> }> {
    return withNoteLock(documentId, async () => {
        const document = await requireOwnedDocument(reader, documentId);
        if (document.revision !== expectedRevision) throw staleRevision();
        if (!isVersionId(versionId)) throw notFound();

        const version = await store.getVersion(documentId, versionId);
        if (!version) throw notFound();

        // The current body is preserved as a new version before it is replaced.
        // No commit is made after the patch; the restored body becomes a
        // version only when the user explicitly saves one.
        await store.commit(
            documentId,
            snapshotOf(document),
            `Saved before restoring Version ${version.version_number}`,
        );

        const patch = await patchDocumentContent(
            reader,
            documentId,
            version.content,
            document.revision,
        );
        if (!patch.ok) {
            if (patch.conflict || patch.status === 409) throw staleRevision();
            if (patch.status === 403 || patch.status === 404) throw notFound();
            if (patch.status === 400 || patch.status === 422) {
                throw new VersioningError(400, "This version could not be restored.");
            }
            throw new VersioningError(502, UNAVAILABLE);
        }

        return { document: patch.record ?? {} };
    });
}

/** Remove a note's version repository after PocketBase confirms a hard delete. */
export async function removeDocumentVersions(documentId: string): Promise<boolean> {
    if (!isNoteId(documentId)) return false;
    return withNoteLock(documentId, async () => {
        try {
            await store.deleteRepo(documentId);
            return true;
        } catch (error) {
            log.error("Failed to remove a version repository", error);
            return false;
        }
    });
}

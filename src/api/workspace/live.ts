import { createLogger } from "../../lib/logger";
import { getRoom } from "../rest/collab/room";
import { conflict } from "./errors";

const log = createLogger("LiveNotes");

const UNSAVED_LIVE_CHANGES =
    "This note has live changes that could not be saved. Try again before editing it elsewhere.";

/**
 * External writers (typed REST, MCP, chat) must not read a revision while a
 * live room still holds unflushed keystrokes. Flush first so their revision
 * check, section diff, and undo snapshot all start from the durable body.
 *
 * A room in conflict/error is a hard stop: proceeding would either overwrite
 * the live text or create a stale undo snapshot. The caller receives a normal
 * workspace conflict so the AI/tool can ask the user to retry.
 */
export async function flushLiveNoteBeforeExternalWrite(documentId: string): Promise<void> {
    const room = getRoom(documentId);
    if (!room) return;

    const result = await room.flushDocument();
    if (result.persistence === "conflict" || result.persistence === "error") {
        throw conflict(UNSAVED_LIVE_CHANGES);
    }
}

/**
 * Adopt an external content write into the open room, if any. The room merges
 * concurrent local text and may persist once more; the returned revision is
 * the room's final revision. With no room, the write revision is unchanged.
 */
export async function adoptLiveNoteContent(
    documentId: string,
    content: string,
    revision: number,
): Promise<number> {
    const room = getRoom(documentId);
    if (!room) return revision;

    try {
        return await room.applyExternalEdit(content, revision);
    } catch (error) {
        // The workspace write already succeeded. A room that cannot adopt it
        // must not turn that success into a model-visible failure; the next
        // read will return a live conflict instead of stale content.
        log.warn("Failed to adopt an external note write", {
            documentId,
            error: error instanceof Error ? error.message : String(error),
        });
        return revision;
    }
}

/**
 * Adopt a metadata-only revision bump so the next room flush patches against
 * the new revision. Content is untouched.
 */
export function adoptLiveNoteRevision(documentId: string, revision: number): number {
    const room = getRoom(documentId);
    if (!room) return revision;

    try {
        return room.applyExternalRevision(revision);
    } catch (error) {
        log.warn("Failed to adopt an external note revision", {
            documentId,
            error: error instanceof Error ? error.message : String(error),
        });
        return revision;
    }
}

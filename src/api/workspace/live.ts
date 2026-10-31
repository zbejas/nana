import { getRoom } from "../rest/collab/room";
import { conflict } from "./errors";

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

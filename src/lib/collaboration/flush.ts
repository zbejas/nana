import { pb } from "../pocketbase";
import type { CollabFlushResult } from "./protocol";

/**
 * Ask the live room to write its pending body before another server-side
 * operation snapshots the note. The caller must have edit access; rooms are
 * process-local, so a missing room is a reconnect signal, not a client write.
 */
export async function flushCollabDocument(documentId: string): Promise<CollabFlushResult> {
    return pb.send<CollabFlushResult>(
        `/collab/documents/${encodeURIComponent(documentId)}/flush`,
        { method: "POST" },
    );
}

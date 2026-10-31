/**
 * Shared live-note protocol.
 *
 * This module is pure: it must stay importable from both the browser and Bun.
 * The room is the durable writer for note content; clients only publish Yjs
 * updates and observe persistence acknowledgements.
 */

export const COLLAB_PROTOCOL = 2 as const;

export type CollabPersistencePhase =
    | "clean"
    | "dirty"
    | "saving"
    | "error"
    | "conflict";

export type CollabUpdateSource =
    | "user"
    | "ai"
    | "restore"
    | "sanitize"
    | "system";

export interface CollabAckFrame {
    type: "ack";
    durableSeq: number;
    revision: number;
    savedAt: string;
}

export interface CollabStatusFrame {
    type: "status";
    persistence: CollabPersistencePhase;
    revision: number;
    message?: string;
}

export interface CollabConflictFrame {
    type: "conflict";
    revision: number;
    reason: "revision" | "merge";
    serverMarkdown?: string;
}

export interface CollabPermissionFrame {
    type: "permission";
    canEdit: boolean;
    level: number;
    reason?: "share-changed" | "revoked" | "trashed";
}

export interface CollabProtocolFields {
    protocol?: typeof COLLAB_PROTOCOL;
    documentId?: string;
    epoch?: string;
    durableSeq?: number;
}

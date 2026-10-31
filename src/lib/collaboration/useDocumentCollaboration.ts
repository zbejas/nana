import { useCallback, useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { pb } from "../pocketbase";
import type { Collaborator } from "./types";
import type {
    CollabConflictFrame,
    CollabFlushResult,
    CollabPersistencePhase,
} from "./protocol";
import { flushCollabDocument } from "./flush";
import {
    CollabSession,
    type CollabPersistenceSnapshot,
    type CollabPresenceWire,
    type CollabSelection,
    type CollabStatus,
} from "./session";

interface UseDocumentCollaborationOptions {
    documentId: string | undefined;
    initialContent: string;
    /** Loaded note revision, used until the room acknowledges a newer one. */
    initialRevision?: number;
    content: string;
    enabled: boolean;
    onRemoteContent: (content: string) => void;
}

export interface DocumentCollaboration {
    /**
     * The one live session for the open note. Stable across renders and
     * metadata updates; null while the note is new, trashed, or disabled.
     */
    session: CollabSession | null;
    collaborators: Collaborator[];
    status: CollabStatus;
    canEdit: boolean;
    persistence: CollabPersistencePhase;
    durableSeq: number;
    revision: number;
    conflict: CollabConflictFrame | null;
    updateSelection: (selection: CollabSelection) => void;
    /** Fold an editor-originated Markdown value into Yjs synchronously. */
    applyLocalContent: (content: string) => void;
    /**
     * Write the room's pending body before a version/restore snapshot. Null
     * means there is no live room for this note (new note, trash, or offline).
     */
    flushContent: () => Promise<CollabFlushResult | null>;
}

const EMPTY_COLLABORATORS: Collaborator[] = [];

interface PersistenceUiState {
    documentId: string | undefined;
    phase: CollabPersistencePhase;
    durableSeq: number;
    revision: number;
    conflict: CollabConflictFrame | null;
}

interface PermissionUiState {
    documentId: string | undefined;
    canEdit: boolean;
}

interface ConnectionUiState {
    documentId: string | undefined;
    status: CollabStatus;
}

interface CollaboratorUiState {
    documentId: string | undefined;
    entries: Collaborator[];
}

function resolvePresence(
    session: CollabSession,
    entries: CollabPresenceWire[],
    selfUserId: string,
): Collaborator[] {
    const collaborators: Collaborator[] = [];
    for (const entry of entries) {
        if (!entry.clientId || entry.clientId === session.sessionId) continue;
        // Another tab of the same account is not another collaborator.
        if (selfUserId && entry.userId === selfUserId) continue;
        let anchor;
        let head;
        try {
            anchor = Y.createAbsolutePositionFromRelativePosition(
                entry.anchor as Y.RelativePosition,
                session.doc,
            );
            head = Y.createAbsolutePositionFromRelativePosition(
                entry.head as Y.RelativePosition,
                session.doc,
            );
        } catch {
            continue;
        }
        if (!anchor || !head) continue;
        collaborators.push({
            clientId: entry.clientId,
            userId: entry.userId,
            name: entry.name || "Someone",
            avatar: entry.avatar || "",
            color: entry.color || "#ff7a54",
            anchor: anchor.index,
            head: head.index,
            focused: entry.focused === true,
        });
    }
    return collaborators;
}

/**
 * Connects the open note to its live room.
 *
 * The hook is intentionally transport-only: it does not save, change privacy,
 * or bypass the editor's read-only states. Editor-originated values are folded
 * into Yjs synchronously; remote values are applied by the editor without
 * being replayed as local edits. The room owns content persistence and reports
 * it through ack/status/conflict frames; autosave only persists metadata while
 * the room is connected.
 */
export function useDocumentCollaboration({
    documentId,
    initialContent,
    initialRevision,
    content,
    enabled,
    onRemoteContent,
}: UseDocumentCollaborationOptions): DocumentCollaboration {
    const [collaborators, setCollaborators] = useState<CollaboratorUiState>({
        documentId,
        entries: EMPTY_COLLABORATORS,
    });
    // The session handle is state-backed so bindings can attach to the live
    // room. A ref alone was invisible to React and could expose a destroyed
    // room for one render after a note switch.
    const [session, setSession] = useState<CollabSession | null>(null);
    const [connection, setConnection] = useState<ConnectionUiState>({
        documentId,
        status: "offline",
    });
    const [permission, setPermission] = useState<PermissionUiState>({
        documentId,
        canEdit: true,
    });
    const [persistence, setPersistence] = useState<PersistenceUiState>({
        documentId,
        phase: "clean",
        durableSeq: 0,
        revision: initialRevision ?? 0,
        conflict: null,
    });
    const sessionRef = useRef<CollabSession | null>(null);
    const presenceRef = useRef<CollabPresenceWire[]>([]);
    const contentRef = useRef(content);
    const initialContentRef = useRef(initialContent);
    const initialRevisionRef = useRef(initialRevision ?? 0);
    const onRemoteContentRef = useRef(onRemoteContent);

    contentRef.current = content;
    initialContentRef.current = initialContent;
    initialRevisionRef.current = initialRevision ?? 0;
    onRemoteContentRef.current = onRemoteContent;

    const refreshCollaborators = useCallback(() => {
        const current = sessionRef.current;
        if (!current) {
            setCollaborators((previous) => previous.entries.length === 0
                ? previous
                : { documentId: previous.documentId, entries: EMPTY_COLLABORATORS });
            return;
        }
        const resolved = resolvePresence(
            current,
            presenceRef.current,
            pb.authStore.record?.id ?? "",
        );
        setCollaborators((previous) => {
            if (previous.documentId !== current.documentId) {
                return { documentId: current.documentId, entries: resolved };
            }
            if (resolved.length === 0) {
                return previous.entries.length === 0
                    ? previous
                    : { documentId: current.documentId, entries: EMPTY_COLLABORATORS };
            }
            return { documentId: current.documentId, entries: resolved };
        });
    }, []);

    useEffect(() => {
        const resetState = () => {
            setConnection({ documentId, status: "offline" });
            setPermission({ documentId, canEdit: true });
            setPersistence({
                documentId,
                phase: "clean",
                durableSeq: 0,
                revision: initialRevisionRef.current,
                conflict: null,
            });
            setCollaborators({ documentId, entries: EMPTY_COLLABORATORS });
            setSession(null);
        };

        if (!enabled || !documentId) {
            presenceRef.current = [];
            resetState();
            return;
        }

        presenceRef.current = [];
        resetState();
        const session = new CollabSession({
            documentId,
            initialContent: initialContentRef.current,
            initialRevision: initialRevisionRef.current,
            getToken: () => pb.authStore.token,
            onRemoteText: (text) => {
                if (sessionRef.current !== session) return;
                refreshCollaborators();
                onRemoteContentRef.current(text);
            },
            onPresence: (entries) => {
                if (sessionRef.current !== session) return;
                presenceRef.current = entries;
                refreshCollaborators();
            },
            onStatus: (next) => {
                if (sessionRef.current !== session) return;
                setConnection({ documentId, status: next });
            },
            onPermission: (next) => {
                if (sessionRef.current !== session) return;
                setPermission({ documentId, canEdit: next });
                if (!next) onRemoteContentRef.current(session.markdown);
            },
            onPersistence: (state: CollabPersistenceSnapshot) => {
                if (sessionRef.current !== session) return;
                setPersistence({
                    documentId,
                    phase: state.phase,
                    durableSeq: state.durableSeq,
                    revision: state.revision,
                    conflict: state.conflict,
                });
            },
            onConflict: (conflict) => {
                if (sessionRef.current !== session) return;
                setPersistence((previous) => previous.documentId === documentId
                    ? {
                        ...previous,
                        phase: "conflict",
                        revision: Math.max(previous.revision, conflict.revision),
                        conflict,
                    }
                    : previous);
            },
        });
        sessionRef.current = session;
        setSession(session);
        session.applyLocalMarkdown(contentRef.current);
        session.start();
        setConnection({ documentId, status: "connecting" });

        return () => {
            sessionRef.current = null;
            presenceRef.current = [];
            session.destroy();
            setSession(null);
            setConnection({ documentId, status: "offline" });
            setCollaborators({ documentId, entries: EMPTY_COLLABORATORS });
        };
    }, [documentId, enabled, refreshCollaborators]);

    // Editor-originated content is folded into Yjs at the call site, before
    // React commits it. A passive content effect here used to replay stale
    // remote snapshots as local edits and delete the other writer's text.
    const applyLocalContent = useCallback((next: string) => {
        sessionRef.current?.applyLocalMarkdown(next);
    }, []);

    const updateSelection = useCallback((selection: CollabSelection) => {
        sessionRef.current?.sendSelection(selection);
    }, []);

    const flushContent = useCallback(async (): Promise<CollabFlushResult | null> => {
        const current = sessionRef.current;
        if (!current || !enabled || current.documentId !== documentId) return null;
        return flushCollabDocument(current.documentId);
    }, [documentId, enabled]);

    const status = connection.documentId === documentId ? connection.status : "offline";
    // A disabled or newly opened note must never inherit a previous room's
    // session, collaborators, read-only permission, or persistence state.
    const activeSession = enabled && documentId && session?.documentId === documentId
        ? session
        : null;
    const activeCollaborators = enabled && documentId && collaborators.documentId === documentId
        ? collaborators.entries
        : EMPTY_COLLABORATORS;
    const canEdit = !enabled || !documentId || permission.documentId !== documentId
        ? true
        : permission.canEdit;
    const persistenceForDocument = enabled && documentId && persistence.documentId === documentId
        ? persistence
        : {
            phase: "clean" as const,
            durableSeq: 0,
            revision: initialRevisionRef.current,
            conflict: null,
        };

    return {
        session: activeSession,
        collaborators: activeCollaborators,
        status,
        canEdit,
        persistence: persistenceForDocument.phase,
        durableSeq: persistenceForDocument.durableSeq,
        revision: persistenceForDocument.revision,
        conflict: persistenceForDocument.conflict,
        updateSelection,
        applyLocalContent,
        flushContent,
    };
}

import { useCallback, useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { pb } from "../pocketbase";
import type { Collaborator } from "./types";
import {
    CollabSession,
    type CollabPresenceWire,
    type CollabSelection,
    type CollabStatus,
} from "./session";

interface UseDocumentCollaborationOptions {
    documentId: string | undefined;
    initialContent: string;
    content: string;
    enabled: boolean;
    onRemoteContent: (content: string) => void;
}

export interface DocumentCollaboration {
    collaborators: Collaborator[];
    status: CollabStatus;
    canEdit: boolean;
    updateSelection: (selection: CollabSelection) => void;
    /** Fold an editor-originated Markdown value into Yjs synchronously. */
    applyLocalContent: (content: string) => void;
}

const EMPTY_COLLABORATORS: Collaborator[] = [];

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
 * being replayed as local edits. The existing autosave still owns persistence,
 * and a conflict retry in the save path repairs any stale revision.
 */
export function useDocumentCollaboration({
    documentId,
    initialContent,
    content,
    enabled,
    onRemoteContent,
}: UseDocumentCollaborationOptions): DocumentCollaboration {
    const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
    const [status, setStatus] = useState<CollabStatus>("offline");
    const [canEdit, setCanEdit] = useState(true);
    const sessionRef = useRef<CollabSession | null>(null);
    const presenceRef = useRef<CollabPresenceWire[]>([]);
    const contentRef = useRef(content);
    const initialContentRef = useRef(initialContent);
    const onRemoteContentRef = useRef(onRemoteContent);

    contentRef.current = content;
    initialContentRef.current = initialContent;
    onRemoteContentRef.current = onRemoteContent;

    const refreshCollaborators = useCallback(() => {
        const session = sessionRef.current;
        if (!session) {
            setCollaborators([]);
            return;
        }
        const resolved = resolvePresence(
            session,
            presenceRef.current,
            pb.authStore.record?.id ?? "",
        );
        setCollaborators((previous) => {
            if (resolved.length === 0) {
                return previous.length === 0 ? previous : EMPTY_COLLABORATORS;
            }
            return resolved;
        });
    }, []);

    useEffect(() => {
        if (!enabled || !documentId) {
            setStatus("offline");
            setCollaborators([]);
            return;
        }

        presenceRef.current = [];
        const session = new CollabSession({
            documentId,
            initialContent: initialContentRef.current,
            getToken: () => pb.authStore.token,
            onRemoteText: (text) => {
                refreshCollaborators();
                onRemoteContentRef.current(text);
            },
            onPresence: (entries) => {
                presenceRef.current = entries;
                refreshCollaborators();
            },
            onStatus: (next) => setStatus(next),
            onPermission: (next) => {
                setCanEdit(next);
                if (!next) onRemoteContentRef.current(session.markdown);
            },
        });
        sessionRef.current = session;
        session.applyLocalMarkdown(contentRef.current);
        session.start();
        setStatus("connecting");

        return () => {
            sessionRef.current = null;
            presenceRef.current = [];
            session.destroy();
            setStatus("offline");
            setCollaborators([]);
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

    return { collaborators, status, canEdit, updateSelection, applyLocalContent };
}

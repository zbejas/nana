import { serverConfig } from "../../../lib/config";
import { requireBrowserAuth } from "../browser/auth";
import type { CollabIdentity } from "./room";

const POCKETBASE_URL = serverConfig.pocketbaseUrl;
const LOOKUP_TIMEOUT_MS = 8_000;

export interface CollabDocumentAccess {
    token: string;
    userId: string;
    content: string;
    revision: number;
    identity: CollabIdentity;
}

interface DocumentRecord {
    content?: string;
    revision?: number;
    author?: string;
}

interface AccessRecord {
    role?: string | null;
    level?: number;
}

interface UserRecord {
    name?: string;
    avatar?: string;
}

function jsonHeaders(token: string): HeadersInit {
    return {
        Authorization: token,
        Accept: "application/json",
    };
}

/**
 * Resolve a browser session to one live document.
 *
 * Reads go through PocketBase with the caller's token so the collection rules
 * remain authoritative. The sharing route supplies the effective level; only
 * edit grantees (`level >= 3`) may publish Yjs updates, while viewers can watch
 * and share presence.
 */
export async function loadCollabDocumentAccess(
    request: Request,
    documentId: string,
): Promise<CollabDocumentAccess | null> {
    const auth = requireBrowserAuth(request);
    const encodedId = encodeURIComponent(documentId);

    const [documentResponse, accessResponse, userResponse] = await Promise.all([
        fetch(`${POCKETBASE_URL}/api/collections/documents/records/${encodedId}`, {
            headers: jsonHeaders(auth.token),
            signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
        }),
        fetch(
            `${POCKETBASE_URL}/api/sharing/access?targetType=document&targetId=${encodedId}`,
            {
                headers: jsonHeaders(auth.token),
                signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
            },
        ),
        fetch(`${POCKETBASE_URL}/api/collections/users/records/${encodeURIComponent(auth.userId)}`, {
            headers: jsonHeaders(auth.token),
            signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
        }),
    ]);

    if (!documentResponse.ok || !accessResponse.ok) return null;

    let access: AccessRecord;
    try {
        access = (await accessResponse.json()) as AccessRecord;
    } catch {
        return null;
    }
    const level = Number(access.level ?? 0);
    if (!Number.isFinite(level) || level < 1) return null;

    let document: DocumentRecord;
    try {
        document = (await documentResponse.json()) as DocumentRecord;
    } catch {
        return null;
    }

    let user: UserRecord = {};
    if (userResponse.ok) {
        try {
            user = (await userResponse.json()) as UserRecord;
        } catch {
            user = {};
        }
    }

    return {
        token: auth.token,
        userId: auth.userId,
        content: typeof document.content === "string" ? document.content : "",
        revision: Number(document.revision ?? 0),
        identity: {
            userId: auth.userId,
            name: typeof user.name === "string" && user.name.trim() ? user.name.trim() : "Someone",
            avatar: typeof user.avatar === "string" ? user.avatar : "",
            canEdit: level >= 3,
        },
    };
}

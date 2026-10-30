import { Elysia } from "elysia";
import { BrowserAuthError, jsonError, requireBrowserAuth } from "./auth";
import { forwardToPocketBase } from "./proxy";

const FILE_COLLECTIONS = new Set(["documents", "users", "trash_documents", "chat_attachments"]);

function optionalToken(req: Request): string | undefined {
    const header = req.headers.get("authorization");
    if (!header) return undefined;
    const bearer = /^Bearer\s+(.+)$/i.exec(header.trim());
    const token = (bearer?.[1] ?? header).trim();
    return token || undefined;
}

function filePath(collection: string, recordId: string, filename: string): string {
    return `/api/files/${encodeURIComponent(collection)}/${encodeURIComponent(recordId)}/${encodeURIComponent(filename)}`;
}

export const browserFileRoutes = new Elysia({ name: "nana-browser-files" })
    .post("/api/v1/files/token", ({ request }) => {
        try {
            const auth = requireBrowserAuth(request);
            return forwardToPocketBase(request, "/api/files/token", { token: auth.token });
        } catch (error) {
            if (error instanceof BrowserAuthError) return jsonError(error.status, error.message);
            throw error;
        }
    }, { detail: { hide: true } })
    .get("/api/v1/files/:collection/:recordId/:filename", ({ request, params }) => {
        if (!FILE_COLLECTIONS.has(params.collection)) return jsonError(404, "Not found.");
        return forwardToPocketBase(
            request,
            filePath(params.collection, params.recordId, params.filename),
            { token: optionalToken(request), timeoutMs: 5 * 60_000 },
        );
    }, { detail: { hide: true } });

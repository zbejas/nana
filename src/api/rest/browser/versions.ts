import { Elysia } from "elysia";
import { createLogger } from "../../../lib/logger";
import {
    getDocumentVersion,
    listDocumentVersions,
    restoreDocumentVersion,
    saveDocumentVersion,
    VersioningError,
} from "../../versioning/service";
import { BrowserAuthError, jsonError, requireBrowserAuth, type BrowserAuth } from "./auth";

const log = createLogger("BrowserVersions");

const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 100;

function integerParam(value: unknown, fallback: number): number {
    if (typeof value === "number") {
        return Number.isFinite(value) ? Math.trunc(value) : fallback;
    }
    if (typeof value !== "string" || value.trim() === "") return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function pagination(query: Record<string, unknown>): { page: number; perPage: number } {
    const page = Math.max(1, integerParam(query.page, 1));
    const perPage = Math.min(
        MAX_PER_PAGE,
        Math.max(1, integerParam(query.perPage, DEFAULT_PER_PAGE)),
    );
    return { page, perPage };
}

async function expectedRevision(request: Request): Promise<number | null> {
    let raw: string;
    try {
        raw = await request.text();
    } catch {
        return null;
    }
    if (!raw.trim()) return null;

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

    const value = (parsed as Record<string, unknown>).expectedRevision;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
    return value;
}

function errorResponse(error: unknown): Response {
    if (error instanceof BrowserAuthError) return jsonError(error.status, error.message);
    if (error instanceof VersioningError) return jsonError(error.status, error.message);
    log.error("Version request failed", error);
    return jsonError(500, "Version history is unavailable right now.");
}

export const browserVersionRoutes = new Elysia({ name: "nana-browser-versions" })
    .get("/api/v1/documents/:id/versions", async ({ request, params, query }) => {
        try {
            const auth: BrowserAuth = requireBrowserAuth(request);
            const { page, perPage } = pagination(query as Record<string, unknown>);
            const result = await listDocumentVersions(auth, params.id, page, perPage);
            return Response.json(result);
        } catch (error) {
            return errorResponse(error);
        }
    }, { detail: { hide: true } })
    .get("/api/v1/documents/:id/versions/:versionId", async ({ request, params }) => {
        try {
            const auth = requireBrowserAuth(request);
            const version = await getDocumentVersion(auth, params.id, params.versionId);
            return Response.json(version);
        } catch (error) {
            return errorResponse(error);
        }
    }, { detail: { hide: true } })
    .post("/api/v1/documents/:id/versions", async ({ request, params }) => {
        try {
            const auth = requireBrowserAuth(request);
            const revision = await expectedRevision(request);
            if (revision === null) return jsonError(400, "A current revision is required.");

            const result = await saveDocumentVersion(auth, params.id, revision);
            return Response.json(result);
        } catch (error) {
            return errorResponse(error);
        }
    }, { parse: "none", detail: { hide: true } })
    .post("/api/v1/documents/:id/versions/:versionId/restore", async ({ request, params }) => {
        try {
            const auth = requireBrowserAuth(request);
            const revision = await expectedRevision(request);
            if (revision === null) return jsonError(400, "A current revision is required.");

            const result = await restoreDocumentVersion(auth, params.id, params.versionId, revision);
            return Response.json(result);
        } catch (error) {
            return errorResponse(error);
        }
    }, { parse: "none", detail: { hide: true } });

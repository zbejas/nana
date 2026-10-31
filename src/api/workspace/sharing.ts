import { serverConfig } from "../../lib/config";
import type { ToolContext } from "../pocketbase/client";
import { ApiError, upstream } from "./errors";

/**
 * Effective person access resolved by PocketBase's `/api/sharing/access` route.
 * The route mirrors direct shares and inherited folder grants, and returns no
 * access for private/trashed records. Public-link flags never participate.
 */
export type SharingRole = "owner" | "view" | "comment" | "edit";

export interface SharingAccess {
    role: SharingRole;
    level: number;
    source: string;
}

export type SharingTargetType = "document" | "board" | "folder";

const ACCESS_LOOKUP_TIMEOUT_MS = 8_000;
const ROLES = new Set<SharingRole>(["owner", "view", "comment", "edit"]);

function roleForLevel(level: number): SharingRole | null {
    if (level >= 3) return "edit";
    if (level === 2) return "comment";
    if (level === 1) return "view";
    return null;
}

function toAccess(value: unknown): SharingAccess | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const source = value as Record<string, unknown>;
    const level = Number(source.level);
    if (!Number.isFinite(level) || level < 1) return null;

    const role = typeof source.role === "string" && ROLES.has(source.role as SharingRole)
        ? source.role as SharingRole
        : roleForLevel(level);
    if (!role) return null;

    return {
        role,
        level: Math.min(3, Math.max(1, Math.trunc(level))),
        source: typeof source.source === "string" ? source.source : "",
    };
}

/**
 * Resolve the caller's effective access to one shareable record with the
 * caller's own token. Returns `null` when the route reports no access (missing,
 * trashed, private, or inside a private/trashed folder). Transport and upstream
 * failures throw a workspace `ApiError` so callers can show `unavailable`
 * instead of treating an outage as "not shared".
 */
export async function resolveSharingAccess(
    context: ToolContext,
    targetType: SharingTargetType,
    targetId: string,
    signal?: AbortSignal,
): Promise<SharingAccess | null> {
    const id = targetId.trim();
    if (!id || !/^[A-Za-z0-9]{1,64}$/.test(id)) return null;

    const query = new URLSearchParams({
        targetType,
        targetId: id,
    });
    const timeout = AbortSignal.timeout(ACCESS_LOOKUP_TIMEOUT_MS);
    const combined = signal
        ? AbortSignal.any([signal, timeout])
        : timeout;

    let response: Response;
    try {
        response = await fetch(
            `${serverConfig.pocketbaseUrl}/api/sharing/access?${query.toString()}`,
            {
                headers: {
                    Authorization: context.authHeader,
                    Accept: "application/json",
                },
                signal: combined,
            },
        );
    } catch (error) {
        throw upstream(
            error instanceof Error && error.name === "TimeoutError"
                ? "The sharing lookup took too long."
                : "The workspace is unavailable right now.",
        );
    }

    if (response.status === 401 || response.status === 403) {
        throw new ApiError(401, "unauthorized", "Your session expired. Sign in again and retry.");
    }
    if (!response.ok) {
        throw upstream("The sharing lookup is unavailable right now.");
    }

    let body: unknown;
    try {
        body = await response.json();
    } catch {
        throw upstream("The workspace returned an unreadable sharing response.");
    }

    return toAccess(body);
}

export function accessRoleForLevel(level: number): SharingRole | null {
    return roleForLevel(level);
}

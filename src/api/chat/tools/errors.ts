import { ApiError } from "../../workspace/errors";
import type { ToolFailure } from "../../pocketbase/client";

/**
 * Convert a workspace service error into the model-safe tool failure shape.
 * Upstream messages are already curated by the services; unknown errors become
 * a generic `unavailable` so no PocketBase body leaks into the model context.
 */
export function failureFromError(error: unknown): ToolFailure {
    if (error instanceof ApiError) {
        if (error.code === "invalid_input") return { ok: false, code: "invalid_input", message: error.message };
        if (error.code === "not_found") return { ok: false, code: "not_found", message: error.message };
        if (error.code === "conflict") return { ok: false, code: "conflict", message: error.message };
        if (error.code === "unauthorized" || error.code === "forbidden") {
            return { ok: false, code: "unauthorized", message: error.message };
        }
        return { ok: false, code: "unavailable", message: error.message };
    }
    return {
        ok: false,
        code: "unavailable",
        message: "The workspace is unavailable right now.",
    };
}

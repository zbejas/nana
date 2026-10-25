/**
 * Backwards-compatible shim.
 *
 * PocketBase access moved to `src/api/pocketbase/client.ts` so REST services
 * and chat tools share one caller-token client. Existing chat tool imports
 * keep working through these re-exports.
 */

export { pbGet, pbRequest, queryString } from "../../pocketbase/client";
export type {
    PBListResponse,
    PbRequestOptions,
    ToolContext,
    ToolErrorCode,
    ToolFailure,
    ToolResult,
} from "../../pocketbase/client";

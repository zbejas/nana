/**
 * Public workspace API errors.
 *
 * Messages are safe to show to a caller. PocketBase response bodies, upstream
 * URLs, tokens, and SQL details never enter an ApiError.
 */
export class ApiError extends Error {
    readonly status: number;
    readonly code: string;

    constructor(status: number, code: string, message: string) {
        super(message);
        this.name = "ApiError";
        this.status = status;
        this.code = code;
    }
}

export function badRequest(message = "That request was not valid."): ApiError {
    return new ApiError(400, "invalid_input", message);
}

export function unauthorized(message = "Sign in to use the workspace."): ApiError {
    return new ApiError(401, "unauthorized", message);
}

export function notFound(message = "That item was not found."): ApiError {
    return new ApiError(404, "not_found", message);
}

export function conflict(message = "That action conflicts with the current state."): ApiError {
    return new ApiError(409, "conflict", message);
}

export function upstream(message = "The workspace is unavailable right now."): ApiError {
    return new ApiError(502, "upstream_unavailable", message);
}

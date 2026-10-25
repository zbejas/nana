import { t } from "elysia";

/**
 * Error response schemas are runtime schemas as well as documentation. Keeping
 * them in the route `response` map means Scalar documents every status the API
 * can return, while Elysia still validates the envelope in production.
 */
function errorSchema(description: string, example: string) {
    return t.Object(
        {
            error: t.String({
                description: "Human-readable error message. Internal failures are intentionally generic.",
                examples: [example],
            }),
        },
        {
            description,
            examples: [{ error: example }],
        },
    );
}

/** Missing, invalid, or expired token. */
export const UnauthorizedErrorSchema = errorSchema(
    "Missing, invalid, or expired user token.",
    "Missing or invalid authorization token.",
);

/** PocketBase hides records the caller cannot access behind a generic 404. */
export const NotFoundErrorSchema = errorSchema(
    "The record does not exist or belongs to another user.",
    "Not found.",
);

/** Elysia schema validation, including malformed ids and query values. */
export const ValidationErrorSchema = errorSchema(
    "A path, query, or body value failed schema validation.",
    "Invalid request.",
);

/** The action conflicts with the current state. */
export const ConflictErrorSchema = errorSchema(
    "The action conflicts with the current state.",
    "Archive the board before deleting it.",
);

/** The upstream PocketBase request failed. */
export const UpstreamErrorSchema = errorSchema(
    "PocketBase was unreachable or returned an unreadable response.",
    "Internal server error.",
);

/** Unexpected server failure with a deliberately generic body. */
export const ServerErrorSchema = errorSchema(
    "Unexpected server failure. The details are in the server log.",
    "Internal server error.",
);

/** Errors every authenticated workspace route can return. */
export const workspaceErrorSchemas = {
    401: UnauthorizedErrorSchema,
    422: ValidationErrorSchema,
    500: ServerErrorSchema,
    502: UpstreamErrorSchema,
} as const;

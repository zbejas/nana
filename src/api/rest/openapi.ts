import type { ElysiaOpenAPIConfig } from "@elysia/openapi";
import { APP_VERSION } from "../app-version";

/**
 * Scalar/OpenAPI configuration for the owner-facing REST API.
 *
 * The documentation is intentionally public: it describes routes and schemas,
 * never user data. The API itself is authenticated. Scalar and its fonts are
 * served from this origin so the app CSP can stay `script-src 'self'` and the
 * docs keep working offline.
 */
export const DOCS_PAGE_PATH = "/docs";
export const DOCS_SPEC_PATH = "/docs/json";
export const SCALAR_BUNDLE_PATH = "/docs/scalar.js";
export const GEIST_FONT_PATH = "/docs/geist.woff2";
export const GEIST_MONO_FONT_PATH = "/docs/geist-mono.woff2";

const API_DESCRIPTION = [
    "# Nana API",
    "",
    "Nana is a self-hosted workspace for Markdown notes, folders, and task boards. This is the owner-facing JSON API for managing that workspace.",
    "",
    "## Base URL",
    "",
    "All paths in this reference are relative to the origin serving this page: `/api/v1`.",
    "",
    "## Authentication",
    "",
    "Every `/api/v1` route requires a PocketBase user token or a long-lived Nana API key. Send it either raw or as a Bearer token:",
    "",
    "```http",
    "Authorization: <pocketbase-user-token>",
    "Authorization: Bearer <nana_api_key>",
    "```",
    "",
    "The Nana web app stores the PocketBase token after sign-in. Typed workspace routes refresh it on every request, so an expired token returns `401` rather than silently acting as another user. Create API keys from **Settings → API keys**; the same key authenticates `/mcp`. The plaintext is shown once, only a SHA-256 hash is stored, and revocation is immediate.",
    "",
    "An API key can be read-only or read/write, and scoped to the whole workspace, the workspace root only, or selected folder subtrees. A key cannot create, list, or revoke keys; that requires a signed-in session. The browser facade (`/records`, `/auth`, `/files`, `/realtime`, `/trash`, `/admin`, `/public`) does not accept API keys.",
    "",
    "## Scope and privacy",
    "",
    "`/api/v1` is the **owner surface**. Private notes, boards, and folders are visible to their owner here. Chat and MCP are AI surfaces: they hide private records and every descendant of a private folder. A record outside an API key's scope returns `404`, never `403`, so ids cannot be probed. A read-only key that attempts a write returns `403`.",
    "",
    "## Content",
    "",
    "- Notes are Markdown. `content` is sanitized before it is stored.",
    "- List responses for notes contain metadata only; read a note by id to get its body.",
    "- Boards are archived before they can be deleted. Deleting an archived board permanently deletes its tasks.",
    "- Tasks are separate from notes: a task may reference one note, and neither record cascades into the other.",
    "- Folder trash rehomes its boards to the workspace root; it does not delete or trash them.",
    "",
    "## Pagination",
    "",
    "List endpoints return:",
    "",
    "```json",
    "{ items: [], page: 1, perPage: 20, totalItems: 0, totalPages: 0 }",
    "```",
    "",
    "`page` is 1-based. `perPage` is capped at 50. Notes and boards default to 20; task lists default to 50. `GET /folders` is the exception: it returns the full folder list as a plain array.",
    "",
    "## Errors",
    "",
    "Errors use one envelope:",
    "",
    "```json",
    "{ error: message }",
    "```",
    "",
    "| Status | Meaning |",
    "| --- | --- |",
    "| `400` | Malformed JSON or an invalid field value. |",
    "| `401` | Missing, invalid, or expired user token or API key. |",
    "| `403` | A valid credential cannot perform the action, such as a read-only key attempting a write. |",
    "| `404` | Unknown route, or a record the caller cannot see or is outside the key's scope. |",
    "| `409` | The action conflicts with current state, such as deleting an active board. |",
    "| `422` | Schema validation failed. |",
    "| `500` | Unexpected server failure; the body is generic. |",
    "| `502` | PocketBase was unreachable or returned an unreadable response. |",
    "",
    "## Conventions",
    "",
    "- Request and response bodies are JSON with camelCase fields.",
    "- Dates are PocketBase date-time strings, for example `2026-10-25 12:00:00.000Z`.",
    "- Record ids match `[A-Za-z0-9]{1,64}`.",
    "- Send an empty `folderId` or `null` to move a note or board to the workspace root.",
    "",
    "Use the **Authorize** panel to try requests. The token is persisted locally in this browser only.",
].join("\n");

/**
 * Graphite palette for Scalar. The CSS is embedded in the page, so avoid
 * single quotes: the plugin places the JSON configuration in a single-quoted
 * HTML attribute.
 */
const SCALAR_CSS = `
@font-face{font-family:Geist;src:url(${GEIST_FONT_PATH}) format("woff2");font-weight:100 900;font-style:normal;font-display:swap}
@font-face{font-family:Geist Mono;src:url(${GEIST_MONO_FONT_PATH}) format("woff2");font-weight:100 900;font-style:normal;font-display:swap}
.light-mode{
  --scalar-font:Geist,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  --scalar-font-code:Geist Mono,ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
  --scalar-color-1:#1a1a18;
  --scalar-color-2:#52524e;
  --scalar-color-3:#6b6b65;
  --scalar-color-accent:#b7431e;
  --scalar-color-disabled:#a3a29c;
  --scalar-color-ghost:#6b6b65;
  --scalar-background-1:#faf9f7;
  --scalar-background-2:#f3f2ef;
  --scalar-background-3:#ffffff;
  --scalar-background-4:#eeede9;
  --scalar-background-accent:rgb(183 67 30 / 0.08);
  --scalar-background-card:#ffffff;
  --scalar-border-color:rgb(26 26 24 / 0.12);
  --scalar-color-green:#2f7d57;
  --scalar-color-red:#b42318;
  --scalar-color-yellow:#8a5a00;
  --scalar-color-blue:#1f5f8b;
  --scalar-color-orange:#b7431e;
  --scalar-color-purple:#6b4c9a;
  --scalar-button-1:#1a1a18;
  --scalar-button-1-color:#faf9f7;
  --scalar-button-1-hover:#33332f;
  --scalar-sidebar-background-1:#f5f4f1;
  --scalar-sidebar-color-1:#1a1a18;
  --scalar-sidebar-color-2:#52524e;
  --scalar-sidebar-border-color:rgb(26 26 24 / 0.08);
  --scalar-sidebar-item-hover-background:#eeede9;
  --scalar-sidebar-item-hover-color:#1a1a18;
  --scalar-sidebar-item-active-background:rgb(183 67 30 / 0.10);
  --scalar-sidebar-color-active:#b7431e;
  --scalar-sidebar-search-background:#faf9f7;
  --scalar-sidebar-search-color:#6b6b65;
  --scalar-sidebar-search-border-color:rgb(26 26 24 / 0.12);
  --scalar-header-background-1:#faf9f7;
  --scalar-header-background-2:#f3f2ef;
  --scalar-header-border-color:rgb(26 26 24 / 0.08);
  --scalar-header-color-1:#1a1a18;
  --scalar-header-color-2:#52524e;
  --scalar-header-call-to-action-color:#b7431e;
  --scalar-link-color:#b7431e;
  --scalar-link-color-hover:#943314;
  --scalar-link-color-visited:#6b4c9a;
  --scalar-focus-color:#b7431e;
}
.dark-mode{
  --scalar-font:Geist,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  --scalar-font-code:Geist Mono,ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
  --scalar-color-1:#f5f5f4;
  --scalar-color-2:#a3a39e;
  --scalar-color-3:#8a8a84;
  --scalar-color-accent:#ff7a54;
  --scalar-color-disabled:#6b6b65;
  --scalar-color-ghost:#8a8a84;
  --scalar-background-1:#0c0c0d;
  --scalar-background-2:#131315;
  --scalar-background-3:#1b1b1e;
  --scalar-background-4:#232326;
  --scalar-background-accent:rgb(255 112 72 / 0.12);
  --scalar-background-card:#131315;
  --scalar-border-color:rgb(255 255 255 / 0.12);
  --scalar-color-green:#74c69d;
  --scalar-color-red:#ff7b72;
  --scalar-color-yellow:#e3b25f;
  --scalar-color-blue:#8fc7e8;
  --scalar-color-orange:#ff9b7c;
  --scalar-color-purple:#c9b6e8;
  --scalar-button-1:#f5f5f4;
  --scalar-button-1-color:#0c0c0d;
  --scalar-button-1-hover:#d8d8d4;
  --scalar-sidebar-background-1:#0f0f10;
  --scalar-sidebar-color-1:#f5f5f4;
  --scalar-sidebar-color-2:#a3a39e;
  --scalar-sidebar-border-color:rgb(255 255 255 / 0.07);
  --scalar-sidebar-item-hover-background:#1b1b1e;
  --scalar-sidebar-item-hover-color:#f5f5f4;
  --scalar-sidebar-item-active-background:rgb(255 112 72 / 0.14);
  --scalar-sidebar-color-active:#ff7a54;
  --scalar-sidebar-search-background:#131315;
  --scalar-sidebar-search-color:#8a8a84;
  --scalar-sidebar-search-border-color:rgb(255 255 255 / 0.12);
  --scalar-header-background-1:#0c0c0d;
  --scalar-header-background-2:#131315;
  --scalar-header-border-color:rgb(255 255 255 / 0.07);
  --scalar-header-color-1:#f5f5f4;
  --scalar-header-color-2:#a3a39e;
  --scalar-header-call-to-action-color:#ff7a54;
  --scalar-link-color:#ff7a54;
  --scalar-link-color-hover:#ff9b7c;
  --scalar-link-color-visited:#c9b6e8;
  --scalar-focus-color:#ff7a54;
}
body{font-family:var(--scalar-font)}
.section-flare{display:none!important}
`;

export const apiOpenApiConfig = {
    path: DOCS_PAGE_PATH,
    specPath: DOCS_SPEC_PATH,
    provider: "scalar",
    documentation: {
        info: {
            title: "Nana API",
            version: APP_VERSION,
            description: API_DESCRIPTION,
            contact: {
                name: "Nana",
                url: "https://github.com/zbejas/nana",
            },
            license: {
                name: "AGPL-3.0-only",
                identifier: "AGPL-3.0-only",
            },
        },
        servers: [
            {
                url: "/",
                description: "Relative to the origin serving this documentation.",
            },
        ],
        tags: [
            {
                name: "Folders",
                description:
                    "The folder tree. Folders can be nested, private, and shared; private folders hide their entire subtree from AI surfaces.",
            },
            {
                name: "Notes",
                description:
                    "Markdown notes and their metadata. Note bodies are sanitized, versioned on publish, and moved to trash rather than deleted immediately.",
            },
            {
                name: "Boards",
                description:
                    "Author-scoped task boards. Boards can be filed in folders, marked private, archived, and restored. Permanent delete is only available for archived boards.",
            },
            {
                name: "Tasks",
                description:
                    "Tasks grouped by board and column. A task may link to one note; deleting a board cascades its tasks, but deleting a note leaves the task in place.",
            },
            {
                name: "API keys",
                description:
                    "Long-lived credentials for the typed workspace API and MCP. Keys are scoped to the workspace, the root, or selected folders, and can be read-only. The secret is shown once; only its hash is stored.",
            },
        ],
        "x-tagGroups": [
            { name: "Workspace", tags: ["Folders", "Notes", "Boards", "Tasks", "API keys"] },
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: "http",
                    scheme: "bearer",
                    bearerFormat: "PocketBase user token or nana_ API key",
                    description:
                        "PocketBase user token or a long-lived `nana_…` API key. Send it raw or as `Bearer <token>`. Key management requires a signed-in session.",
                },
            },
        },
        security: [{ bearerAuth: [] }],
        externalDocs: {
            description: "Nana engineering documentation",
            url: "https://github.com/zbejas/nana/blob/master/docs/api.md",
        },
    },
    scalar: {
        cdn: SCALAR_BUNDLE_PATH,
        url: DOCS_SPEC_PATH,
        theme: "none",
        darkMode: true,
        favicon: "/nana.svg",
        persistAuth: true,
        withDefaultFonts: false,
        customCss: SCALAR_CSS,
        showDeveloperTools: "never",
        hideClientButton: true,
        telemetry: false,
        defaultOpenFirstTag: false,
        documentDownloadType: "json",
        agent: { disabled: true },
        metaData: {
            title: "Nana API Reference",
            description: "Owner-facing JSON API for notes, folders, boards, and tasks.",
        },
    },
    exclude: {
        paths: [SCALAR_BUNDLE_PATH, GEIST_FONT_PATH, GEIST_MONO_FONT_PATH],
    },
} satisfies ElysiaOpenAPIConfig<true, "/docs">;

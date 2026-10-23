# Security

Nana is self-hosted, so the operator controls the network boundary. The application still enforces a clear trust boundary between the browser, the Bun server, and PocketBase.

## Trust boundary

```text
Browser (untrusted)
  │  same-origin only
  ▼
Bun :3000 (trusted server)
  │
  ▼
PocketBase :8090 (trusted backend, not exposed publicly)
```

- The browser never talks to PocketBase on `:8090`; it uses the same-origin `/pb` proxy.
- PocketBase is the authority for users, API rules, and collection permissions.
- Bun is the authority for API auth checks, rate limiting, CSP, and server-side admin reads.

Production compose exposes only `:3000`. Do not publish `:8090` unless explicitly requested.

## Authentication layers

| Layer | Mechanism |
| --- | --- |
| Browser session | PocketBase auth store; token validated with `authRefresh()` on startup. |
| Bun API | `verifyAuth(req)` calls PB `auth-refresh` and returns the user ID. |
| PocketBase collections | Per-collection API rules (`author = @request.auth.id`, etc.). |
| PocketBase admin routes | `$apis.requireAuth()` plus `requireAdmin(c)`. |
| Server-side admin reads | Auto-provisioned PocketBase superuser token. |

`src/api/auth.ts` throws `AuthError` with `401` for missing/invalid tokens. Handlers map that to a JSON error response.

### Public endpoints

These intentionally do not require a user token:

- `GET /api/check-users`
- `GET /pb/api/public/documents/:token` and its attachment route
- `GET /pb/api/public/folders/:token` and its attachment route
- Static SPA assets and `GET /api/app/version`

All other Bun API routes call `verifyAuth()`. PocketBase collection routes rely on API rules; do not assume a route is private just because it is under `/pb`.

## Admin access

Admin-only PocketBase routes call `requireAdmin(c)`, which:

1. Requires an authenticated record.
2. Requires the `admin` field to be true.
3. Throws `ForbiddenError` otherwise.

Admin capabilities include user updates, password changes, SMTP configuration, OAuth configuration, attachment limits, and app URL sync.

The first user is auto-assigned `admin = true` and `verified = true`. After that, public signup is locked and only admins can create users. Only verified admins can grant admin to another user. Verified users cannot be deleted.

Note: `POST /api/admin/rate-limits/reload` lives under `/api/admin` in the Bun server but is guarded by `verifyAuth()` only, not a separate admin-role check. Keep that in mind if you change its behavior.

## Proxy safety

`src/api/pocketbase-proxy.ts`:

- Forwards method, headers, query string, and body to `POCKETBASE_URL`.
- Sets the upstream `Host` header.
- Disables Bun's timeout for PocketBase realtime connections.
- Does not add or remove authentication; PocketBase enforces it.
- Observes document/trash mutations for embedding side effects.

Keep the proxy transparent. Do not add client-controlled upstream URLs, and do not bypass PocketBase rules by injecting a superuser token into browser requests.

## CSP and response headers

`src/index.ts` applies security headers to every response:

| Header | Value |
| --- | --- |
| `Content-Security-Policy` | Strict in production; development additionally allows `ws:`/`wss:` for HMR. |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |

Production CSP: `default-src 'self'`; `script-src 'self' 'unsafe-inline'`; `style-src 'self' 'unsafe-inline'`; `img-src 'self' data: blob: https:`; `connect-src 'self'`; `frame-src 'none'`; `object-src 'none'`; `base-uri 'self'`.

`unsafe-inline` is required by the current editor/bundled styles. Do not widen `connect-src` or add remote script origins without a concrete need.

## Rate limiting

`src/api/rate-limiter.ts` uses `rate-limiter-flexible` in memory, per IP:

| Scope | Config |
| --- | --- |
| `/pb/*` | `rate_limits.pbMaxPerMinute` |
| Everything else | `rate_limits.appMaxPerMinute` |

`rate_limits.enabled` turns it on. Defaults are disabled, 600 PB req/min, and 1200 app req/min. Reload with `POST /api/admin/rate-limits/reload` after changing settings.

The limiter is process-local, so it resets on restart and is not shared across replicas.

## Sanitization

| Surface | Protection |
| --- | --- |
| Markdown preview | `rehype-sanitize` with an extended GitHub-style schema (`src/lib/sanitize.ts`). |
| Chat messages | `sanitizeHtml()` before persisting to `conversations`. |
| PocketBase HTML responses | `escapeHtml()` from `utils.js` where user data is interpolated. |
| URLs | `sanitizeUrl()` trims quotes and trailing slashes. |
| Attachments | PocketBase protected files + short-lived file token on the client. |
| Static files | `src/api/static-files.ts` blocks traversal and serves only from `dist/`. |

Never render raw user HTML without sanitization. If you add a new Markdown/HTML surface, reuse the existing sanitizer or extend the schema deliberately.

## Public shares

Public sharing is separate from collection rules:

- `public_share_token` is a unique 20-byte random hex value.
- `ensureActivePublicShare()` requires `is_public`, rejects `is_private`, and enforces `public_expires_at`.
- Expired shares are disabled on read and cleaned by a 15-minute cron.
- Folder shares skip private subtrees and private documents.
- Attachments require `share_attachments` and membership in the shared document/folder.
- Share tokens are not user auth tokens; never use them to authorize normal API access.

## Secrets and runtime data

Never commit or expose:

- `pocketbase/pb_data/` (SQLite DB, attachments, Zvec vectors).
- `pocketbase/pb_data/superuser_credentials.json`.
- AI provider API keys (`settings.ai_config`).
- SMTP/OAuth credentials.
- `.env` files.

Use environment variables (`PB_SUPERUSER_EMAIL`, `PB_SUPERUSER_PASSWORD`, `POCKETBASE_URL`, etc.) or the admin UI. `createLogger()` must not log tokens, API keys, or credentials.

## Security review checklist

- Does the change add a new public route? If so, does it validate share tokens/expiry or intentionally need no auth?
- Does a new Bun API call `verifyAuth()`?
- Does a new PocketBase admin route call `requireAdmin(c)`?
- Are PocketBase collection rules still author-scoped?
- Could the change expose `:8090`, a superuser token, or an API key to the browser?
- Is new HTML sanitized on the server and client?
- Does the change affect file access or attachment tokens?
- Does it add a rate-limit bypass or a long-lived background operation?
- Are errors logged without secrets and returned without internals?

## Related docs

- [`api.md`](api.md) — routes and auth requirements.
- [`pocketbase.md`](pocketbase.md) — guards, collection rules, public sharing.
- [`ai-and-embeddings.md`](ai-and-embeddings.md) — superuser token and provider secrets.
- [`deployment.md`](deployment.md) — exposure, volumes, and runtime data.

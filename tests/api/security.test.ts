import { beforeAll, describe, expect, test } from "bun:test";
import { bunRequest, expectStatus, pbRequest, readJson } from "../helpers/client";
import { createNote, createUser, getSuperuserToken, type TestUser } from "../helpers/factories";
import { authHeaders, BROWSER_API } from "../helpers/setup";

const SECURITY_HEADERS = [
    "Content-Security-Policy",
    "X-Content-Type-Options",
    "X-Frame-Options",
    "Referrer-Policy",
] as const;

describe("Security headers and public surface", () => {
    let user: TestUser;
    let superuserToken: string;

    beforeAll(async () => {
        user = await createUser("api-security");
        superuserToken = await getSuperuserToken();
    });

    describe("security headers", () => {
        const paths = ["/api/app/version", "/manifest.webmanifest", "/api/v1/check-users", "/nana.svg"];

        test("are present on Bun, API, static, and SPA responses", async () => {
            for (const path of paths) {
                const res = await bunRequest(path);
                await expectStatus(res, 200, path);

                for (const header of SECURITY_HEADERS) {
                    expect(res.headers.get(header), `${path} missing ${header}`).toBeTruthy();
                }
            }
        });

        test("use the expected values", async () => {
            const res = await bunRequest("/api/app/version");
            expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
            expect(res.headers.get("X-Frame-Options")).toBe("DENY");
            expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
        });

        test("CSP locks scripts, frames, and connections to the origin", async () => {
            const res = await bunRequest("/api/app/version");
            const csp = res.headers.get("Content-Security-Policy") ?? "";

            expect(csp).toContain("default-src 'self'");
            expect(csp).toContain("frame-src 'none'");
            expect(csp).toContain("object-src 'none'");
            expect(csp).toContain("connect-src 'self'");
            expect(csp).toContain("font-src 'self' data:");
            expect(csp).toContain("base-uri 'self'");
        });
    });

    describe("public PocketBase surface is gone", () => {
        test("/pb and /pb/* return 404 instead of proxying PocketBase", async () => {
            for (const path of ["/pb", "/pb/api/health", "/pb/api/collections/users/records"]) {
                const res = await bunRequest(path);
                await expectStatus(res, 404, path);
                expect(await res.text()).not.toContain("PocketBase");
            }
        });

        test("the browser facade requires a user token", async () => {
            const res = await bunRequest(`${BROWSER_API}/records/documents`);
            await expectStatus(res, 401);
            const body = await readJson<{ message?: string }>(res);
            expect((body.message ?? "").toLowerCase()).toContain("authorization");
        });
    });

    describe("Elysia browser facade", () => {
        test("reads records with PB filters using the caller's token", async () => {
            await createNote(user, { title: "Find me by filter", content: "through Elysia" });

            const res = await bunRequest(
                `${BROWSER_API}/records/documents?filter=${encodeURIComponent(`title="Find me by filter"`)}`,
                { headers: authHeaders(user.token) },
            );
            await expectStatus(res, 200);
            const page = await readJson<{ items: Array<{ title: string; content: string }> }>(res);
            expect(page.items.some((item) => item.title === "Find me by filter")).toBe(true);
            expect(page.items[0]?.content).toBe("through Elysia");
        });

        test("hides another user's record behind 404", async () => {
            const note = await createNote(user, { title: "Private to proxy test" });
            const other = await createUser("api-security-other");

            const res = await bunRequest(`${BROWSER_API}/records/documents/${note.id}`, {
                headers: authHeaders(other.token),
            });
            await expectStatus(res, 404);
        });
    });

    describe("loopback PocketBase (test fixture access)", () => {
        test("forwards GET queries and upstream status codes", async () => {
            const res = await pbRequest("/health");
            await expectStatus(res, 200);
            const health = await readJson<{ code: number }>(res);
            expect(health.code).toBe(200);

            const users = await pbRequest("/collections/users/records?perPage=1", {
                headers: { Authorization: superuserToken },
            });
            await expectStatus(users, 200);
            const page = await readJson<{ perPage: number; items: unknown[] }>(users);
            expect(page.perPage).toBe(1);
            expect(page.items).toHaveLength(1);
        });

        test("supports method, JSON body, auth, and 404s", async () => {
            const note = await createNote(user, { title: "Loopback note", content: "direct PB" });

            const readRes = await pbRequest(`/collections/documents/records/${note.id}`, {
                headers: { Authorization: user.token },
            });
            await expectStatus(readRes, 200);
            const read = await readJson<{ title: string; content: string }>(readRes);
            expect(read.title).toBe("Loopback note");
            expect(read.content).toBe("direct PB");

            const missing = await pbRequest("/collections/documents/records/nonexistent123456", {
                headers: { Authorization: user.token },
            });
            await expectStatus(missing, 404);
        });

        test("forwards auth failures without inventing a session", async () => {
            const res = await pbRequest("/collections/users/auth-refresh", {
                method: "POST",
                headers: { Authorization: "invalid-token-value" },
            });
            await expectStatus(res, 401);
        });
    });
});

import { beforeAll, describe, expect, test } from "bun:test";
import { bunRequest, expectStatus, pbRequest, readJson } from "../helpers/client";
import { createNote, createUser, getSuperuserToken, type TestUser } from "../helpers/factories";

const SECURITY_HEADERS = [
    "Content-Security-Policy",
    "X-Content-Type-Options",
    "X-Frame-Options",
    "Referrer-Policy",
] as const;

describe("Security headers and PocketBase proxy", () => {
    let user: TestUser;
    let superuserToken: string;

    beforeAll(async () => {
        user = await createUser("api-security");
        superuserToken = await getSuperuserToken();
    });

    describe("security headers", () => {
        const paths = ["/api/app/version", "/manifest.webmanifest", "/pb/api/health", "/nana.svg"];

        test("are present on Bun, proxy, static, and SPA responses", async () => {
            for (const path of paths) {
                const res = await bunRequest(path);
                await expectStatus(res, 200, path);

                for (const header of SECURITY_HEADERS) {
                    expect(res.headers.get(header)).toBeTruthy();
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
            expect(csp).toContain("base-uri 'self'");
        });
    });

    describe("PocketBase proxy", () => {
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

        test("passes through method, JSON body, auth, and 404s", async () => {
            const note = await createNote(user, { title: "Proxy note", content: "through the proxy" });

            const readRes = await pbRequest(`/collections/documents/records/${note.id}`, {
                headers: { Authorization: user.token },
            });
            await expectStatus(readRes, 200);
            const read = await readJson<{ title: string; content: string }>(readRes);
            expect(read.title).toBe("Proxy note");
            expect(read.content).toBe("through the proxy");

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

        test("preserves filter query strings", async () => {
            await createNote(user, { title: "Find me by filter" });

            const res = await pbRequest(
                `/collections/documents/records?filter=${encodeURIComponent(`title="Find me by filter"`)}`,
                { headers: { Authorization: user.token } },
            );
            await expectStatus(res, 200);
            const page = await readJson<{ items: Array<{ title: string }> }>(res);
            expect(page.items.some((item) => item.title === "Find me by filter")).toBe(true);
        });
    });
});

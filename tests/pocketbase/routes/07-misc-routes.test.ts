import { describe, test, expect, beforeAll } from "bun:test";
import {
    PB_API,
    BASE_URL,
    authenticateSuperuser,
    authenticateUser,
    createTestUser,
} from "../../helpers/setup";

describe("Misc Routes", () => {
    let superuserToken: string;
    let adminToken: string;
    let nonAdminToken: string;

    beforeAll(async () => {
        superuserToken = await authenticateSuperuser();

        // Ensure an admin user exists
        const adminEmail = "misc-routes-admin@test.local";
        const adminListRes = await fetch(
            `${PB_API}/collections/users/records?filter=(email='${adminEmail}')`,
            { headers: { Authorization: superuserToken } },
        );
        const adminListData = await adminListRes.json();
        if (adminListData.items.length === 0) {
            await createTestUser(superuserToken, {
                email: adminEmail,
                password: "testPassword123!",
                name: "Misc Routes Admin",
                admin: true,
            });
        }

        const adminAuth = await authenticateUser(adminEmail, "testPassword123!");
        const adminUserId = adminAuth.record.id;

        // Ensure user is verified
        await fetch(`${PB_API}/collections/users/records/${adminUserId}`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                Authorization: superuserToken,
            },
            body: JSON.stringify({ verified: true }),
        });

        const adminAuth2 = await authenticateUser(adminEmail, "testPassword123!");
        adminToken = adminAuth2.token;

        // Ensure a non-admin user exists
        const nonAdminEmail = "misc-routes-nonadmin@test.local";
        const nonAdminListRes = await fetch(
            `${PB_API}/collections/users/records?filter=(email='${nonAdminEmail}')`,
            { headers: { Authorization: superuserToken } },
        );
        const nonAdminListData = await nonAdminListRes.json();
        if (nonAdminListData.items.length === 0) {
            await createTestUser(superuserToken, {
                email: nonAdminEmail,
                password: "testPassword123!",
                name: "Misc Routes Non-Admin",
                admin: false,
            });
        }

        const nonAdminAuth = await authenticateUser(nonAdminEmail, "testPassword123!");
        nonAdminToken = nonAdminAuth.token;
    });

    // ──────────────────────────────────────────
    // GET /api/check-users (PUBLIC)
    // ──────────────────────────────────────────

    describe("GET /api/check-users", () => {
        const CHECK_USERS_URL = `${PB_API}/check-users`;

        test("returns 200 without any auth header", async () => {
            const res = await fetch(CHECK_USERS_URL);
            expect(res.status).toBe(200);
        });

        test("returns hasUsers: true when users exist", async () => {
            const res = await fetch(CHECK_USERS_URL);
            const data = await res.json();
            expect(data.hasUsers).toBe(true);
        });

        test("returns totalUsers as a number >= 1", async () => {
            const res = await fetch(CHECK_USERS_URL);
            const data = await res.json();
            expect(typeof data.totalUsers).toBe("number");
            expect(data.totalUsers).toBeGreaterThanOrEqual(1);
        });

        test("response has correct shape", async () => {
            const res = await fetch(CHECK_USERS_URL);
            const data = await res.json();
            expect(data).toEqual(
                expect.objectContaining({
                    hasUsers: expect.any(Boolean),
                    totalUsers: expect.any(Number),
                }),
            );
            // Should only have these two keys
            const keys = Object.keys(data).sort();
            expect(keys).toEqual(["hasUsers", "totalUsers"]);
        });

        test("works with an auth header too", async () => {
            const res = await fetch(CHECK_USERS_URL, {
                headers: { Authorization: adminToken },
            });
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.hasUsers).toBe(true);
        });
    });

    // ──────────────────────────────────────────
    // PATCH /api/admin/app-url (ADMIN ONLY)
    // ──────────────────────────────────────────

    describe("PATCH /api/admin/app-url", () => {
        const APP_URL_ENDPOINT = `${PB_API}/admin/app-url`;

        test("returns 401 for unauthenticated request", async () => {
            const res = await fetch(APP_URL_ENDPOINT, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: "https://example.com" }),
            });
            expect(res.status).toBe(401);
        });

        test("rejects non-admin user", async () => {
            const res = await fetch(APP_URL_ENDPOINT, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: nonAdminToken,
                },
                body: JSON.stringify({ url: "https://example.com" }),
            });
            // Non-admin users should get a 403 from requireAdmin()
            expect([403, 500]).toContain(res.status);
        });

        test("returns 400 when url is missing", async () => {
            const res = await fetch(APP_URL_ENDPOINT, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: adminToken,
                },
                body: JSON.stringify({}),
            });
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toContain("URL is required");
        });

        test("returns 400 when url is empty string", async () => {
            const res = await fetch(APP_URL_ENDPOINT, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: adminToken,
                },
                body: JSON.stringify({ url: "   " }),
            });
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toContain("URL is required");
        });

        test("successfully updates app URL as admin", async () => {
            const newUrl = "https://nana-test.example.com";
            const res = await fetch(APP_URL_ENDPOINT, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: adminToken,
                },
                body: JSON.stringify({ url: newUrl }),
            });
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.success).toBe(true);
            expect(data.message).toBe("Application URL updated");
            expect(data.appURL).toBe(newUrl);
        });

        test("strips trailing slashes from url", async () => {
            const res = await fetch(APP_URL_ENDPOINT, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: adminToken,
                },
                body: JSON.stringify({ url: "https://nana.example.com///" }),
            });
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.appURL).toBe("https://nana.example.com");
        });
    });
});

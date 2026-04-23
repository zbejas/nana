import { describe, test, expect, beforeAll } from "bun:test";
import {
    PB_API,
    authenticateSuperuser,
    createTestUser,
    authenticateUser,
    signupUser,
} from "../../helpers/setup";

describe("User Guards", () => {
    let superuserToken: string;

    beforeAll(async () => {
        superuserToken = await authenticateSuperuser();
    });

    // ── First user onboarding flow ──────────────────────────────────

    describe("first user creation (onboarding)", () => {
        test("no users exist initially", async () => {
            const res = await fetch(`${PB_API}/check-users`);
            const data = await res.json();
            expect(data.hasUsers).toBe(false);
        });

        test("first user can self-register without auth", async () => {
            const res = await signupUser({
                email: "admin@test.local",
                password: "testPassword123!",
                name: "Test Admin",
            });
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data).toHaveProperty("id");
        });

        test("first user is auto-granted admin", async () => {
            const { record } = await authenticateUser("admin@test.local", "testPassword123!");
            expect(record.admin).toBe(true);
        });

        test("first user is auto-verified", async () => {
            const { record } = await authenticateUser("admin@test.local", "testPassword123!");
            expect(record.verified).toBe(true);
        });

        test("check-users now shows users exist", async () => {
            const res = await fetch(`${PB_API}/check-users`);
            const data = await res.json();
            expect(data.hasUsers).toBe(true);
        });
    });

    // ── Public signup lockdown ──────────────────────────────────────

    describe("public signup lockdown", () => {
        test("public signup is blocked after first user", async () => {
            const res = await signupUser({
                email: "attacker@evil.local",
                password: "hackPassword123!",
            });
            // Should be rejected — either 400 or 403
            expect(res.ok).toBe(false);
            expect([400, 403]).toContain(res.status);
        });

        test("unauthenticated user cannot create accounts", async () => {
            const res = await signupUser({
                email: "sneaky@evil.local",
                password: "hackPassword123!",
            });
            expect(res.ok).toBe(false);
        });
    });

    // ── Admin user creation ─────────────────────────────────────────

    describe("admin user creation", () => {
        let adminToken: string;

        beforeAll(async () => {
            const auth = await authenticateUser("admin@test.local", "testPassword123!");
            adminToken = auth.token;
        });

        test("superuser can create additional users", async () => {
            const user = await createTestUser(superuserToken, {
                email: "user-by-su@test.local",
                password: "testPassword123!",
                name: "Created by SU",
            });
            expect(user.email).toBe("user-by-su@test.local");
        });

        test("admin user can create additional users", async () => {
            const res = await fetch(`${PB_API}/collections/users/records`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: adminToken,
                },
                body: JSON.stringify({
                    email: "user-by-admin@test.local",
                    password: "testPassword123!",
                    passwordConfirm: "testPassword123!",
                    name: "Created by Admin",
                }),
            });
            expect(res.status).toBe(200);
        });

        test("verified admin can grant admin to new users", async () => {
            const res = await fetch(`${PB_API}/collections/users/records`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: adminToken,
                },
                body: JSON.stringify({
                    email: "admin2@test.local",
                    password: "testPassword123!",
                    passwordConfirm: "testPassword123!",
                    name: "Second Admin",
                    admin: true,
                }),
            });
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.admin).toBe(true);
        });
    });

    // ── Non-admin restrictions ──────────────────────────────────────

    describe("non-admin restrictions", () => {
        let regularUserToken: string;

        beforeAll(async () => {
            // user-by-su@test.local was created above — authenticate as them
            const auth = await authenticateUser("user-by-su@test.local", "testPassword123!");
            regularUserToken = auth.token;
        });

        test("non-admin user cannot create users", async () => {
            const res = await fetch(`${PB_API}/collections/users/records`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: regularUserToken,
                },
                body: JSON.stringify({
                    email: "forbidden@test.local",
                    password: "testPassword123!",
                    passwordConfirm: "testPassword123!",
                }),
            });
            expect(res.ok).toBe(false);
            expect([400, 403]).toContain(res.status);
        });
    });

    // ── Non-verified admin restrictions ─────────────────────────────

    describe("non-verified admin restrictions", () => {
        let unverifiedAdminToken: string;

        beforeAll(async () => {
            // admin2@test.local was created by admin but is not verified
            // We need to authenticate them
            const auth = await authenticateUser("admin2@test.local", "testPassword123!");
            unverifiedAdminToken = auth.token;
        });

        test("non-verified admin cannot grant admin to new users", async () => {
            const res = await fetch(`${PB_API}/collections/users/records`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: unverifiedAdminToken,
                },
                body: JSON.stringify({
                    email: "admin-attempt@test.local",
                    password: "testPassword123!",
                    passwordConfirm: "testPassword123!",
                    admin: true,
                }),
            });
            expect(res.ok).toBe(false);
            expect([400, 403]).toContain(res.status);
        });
    });

    // ── User deletion restrictions ──────────────────────────────────

    describe("verified user deletion protection", () => {
        test("verified user cannot be deleted", async () => {
            // Get the admin user's ID
            const { record } = await authenticateUser("admin@test.local", "testPassword123!");

            // Try to delete via superuser
            const res = await fetch(`${PB_API}/collections/users/records/${record.id}`, {
                method: "DELETE",
                headers: { Authorization: superuserToken },
            });
            // Guard blocks deletion of verified users (superusers bypass, but let's test through PB API)
            // Actually, superusers bypass hasSuperuserAuth() — there's no superuser check in delete guard
            // The guard blocks ALL deletion of verified users, no bypass
            expect(res.ok).toBe(false);
            expect([400, 403]).toContain(res.status);
        });

        test("unverified user can be deleted", async () => {
            // user-by-admin@test.local is unverified — get their ID
            const listRes = await fetch(
                `${PB_API}/collections/users/records?filter=(email='user-by-admin@test.local')`,
                { headers: { Authorization: superuserToken } },
            );
            const listData = await listRes.json();
            const userId = listData.items[0].id;

            const res = await fetch(`${PB_API}/collections/users/records/${userId}`, {
                method: "DELETE",
                headers: { Authorization: superuserToken },
            });
            expect(res.status).toBe(204);
        });
    });
});

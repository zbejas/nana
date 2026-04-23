import { describe, test, expect, beforeAll } from "bun:test";
import {
    PB_API,
    authenticateSuperuser,
    createTestUser,
    authenticateUser,
    signupUser,
} from "../../helpers/setup";

const TEST_PASSWORD = "testPassword123!";

describe("User Guards", () => {
    let superuserToken: string;
    let primaryAdminEmail = "admin@test.local";
    let hadUsersBeforeSuite = false;
    let onboardingSignupStatus: number | null = null;
    let onboardingSignupRecordId: string | null = null;

    async function resolveVerifiedAdminEmail(): Promise<string> {
        const res = await fetch(`${PB_API}/collections/users/records?perPage=200&sort=created`, {
            headers: { Authorization: superuserToken },
        });
        expect(res.status).toBe(200);

        const data = (await res.json()) as {
            items: { email: string; admin: boolean; verified: boolean }[];
        };
        const verifiedAdmin = data.items.find((user) => user.admin && user.verified);

        if (!verifiedAdmin) {
            throw new Error("Expected a verified admin user in the shared test database");
        }

        return verifiedAdmin.email;
    }

    beforeAll(async () => {
        superuserToken = await authenticateSuperuser();

        const checkRes = await fetch(`${PB_API}/check-users`);
        expect(checkRes.status).toBe(200);

        const checkData = (await checkRes.json()) as { hasUsers: boolean };
        hadUsersBeforeSuite = checkData.hasUsers;

        if (!hadUsersBeforeSuite) {
            const res = await signupUser({
                email: primaryAdminEmail,
                password: TEST_PASSWORD,
                name: "Test Admin",
            });

            onboardingSignupStatus = res.status;
            const data = (await res.json()) as { id?: string; message?: string };
            onboardingSignupRecordId = data.id ?? null;

            if (!res.ok) {
                throw new Error(
                    `Expected first-user signup to succeed, got ${res.status}: ${JSON.stringify(data)}`,
                );
            }
        } else {
            primaryAdminEmail = await resolveVerifiedAdminEmail();
        }
    });

    // ── First user onboarding flow ──────────────────────────────────

    describe("first user creation (onboarding)", () => {
        // The integration suite shares one PocketBase instance across files.
        // Only exercise the unauthenticated first-user path when this suite reaches a fresh DB first.
        test("allows unauthenticated first-user signup on a fresh DB", () => {
            if (hadUsersBeforeSuite) {
                expect(onboardingSignupStatus).toBeNull();
                return;
            }

            expect(onboardingSignupStatus).toBe(200);
            expect(typeof onboardingSignupRecordId).toBe("string");
        });

        test("first regular user is auto-granted admin", async () => {
            const { record } = await authenticateUser(primaryAdminEmail, TEST_PASSWORD);
            expect(record.admin).toBe(true);
        });

        test("first regular user is auto-verified", async () => {
            const { record } = await authenticateUser(primaryAdminEmail, TEST_PASSWORD);
            expect(record.verified).toBe(true);
        });

        test("check-users shows regular users exist after onboarding", async () => {
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
            const auth = await authenticateUser(primaryAdminEmail, TEST_PASSWORD);
            adminToken = auth.token;
        });

        test("superuser can create additional users", async () => {
            const user = await createTestUser(superuserToken, {
                email: "user-by-su@test.local",
                password: TEST_PASSWORD,
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
                    password: TEST_PASSWORD,
                    passwordConfirm: TEST_PASSWORD,
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
                    password: TEST_PASSWORD,
                    passwordConfirm: TEST_PASSWORD,
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
            const auth = await authenticateUser("user-by-su@test.local", TEST_PASSWORD);
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
                    password: TEST_PASSWORD,
                    passwordConfirm: TEST_PASSWORD,
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
            const auth = await authenticateUser("admin2@test.local", TEST_PASSWORD);
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
                    password: TEST_PASSWORD,
                    passwordConfirm: TEST_PASSWORD,
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
            const { record } = await authenticateUser(primaryAdminEmail, TEST_PASSWORD);

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

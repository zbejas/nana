import { beforeAll, describe, expect, test } from "bun:test";
import { expectStatus, pbRequest, readJson } from "../../helpers/client";
import { createAdmin, createUnverifiedAdmin, createUser, getSuperuserToken, type TestUser } from "../../helpers/factories";
import {
    TEST_PASSWORD,
    authenticateUser,
    signupUser,
    uniqueEmail,
} from "../../helpers/setup";

describe("User guards and onboarding", () => {
    let superuserToken: string;
    let hadUsersBeforeSuite = false;
    let firstUserStatus: number | null = null;
    let firstUserId: string | null = null;

    beforeAll(async () => {
        superuserToken = await getSuperuserToken();

        const checkRes = await pbRequest("/check-users");
        await expectStatus(checkRes, 200);
        const check = await readJson<{ hasUsers: boolean }>(checkRes);
        hadUsersBeforeSuite = check.hasUsers;

        if (hadUsersBeforeSuite) return;

        // This file runs immediately after the bootstrap checks on a fresh
        // database. Only this first signup exercises the open registration path.
        const res = await signupUser({
            email: "onboarding@test.local",
            password: TEST_PASSWORD,
            name: "Onboarding Admin",
        });
        firstUserStatus = res.status;
        const data = await readJson<{ id?: string }>(res);
        firstUserId = data.id ?? null;
    });

    describe("first user onboarding", () => {
        test("allows unauthenticated signup only when the database is empty", () => {
            if (hadUsersBeforeSuite) {
                expect(firstUserStatus).toBeNull();
                return;
            }

            expect(firstUserStatus).toBe(200);
            expect(typeof firstUserId).toBe("string");
        });

        test("grants the first user admin and verified status", async () => {
            if (hadUsersBeforeSuite) return;

            const { record } = await authenticateUser("onboarding@test.local", TEST_PASSWORD);
            expect(record.admin).toBe(true);
            expect(record.verified).toBe(true);
        });

        test("check-users reports that users exist", async () => {
            const res = await pbRequest("/check-users");
            const data = await readJson<{ hasUsers: boolean; totalUsers: number }>(res);

            expect(data.hasUsers).toBe(true);
            expect(data.totalUsers).toBeGreaterThanOrEqual(1);
        });
    });

    describe("public signup lockdown", () => {
        test("rejects public signup after the first user exists", async () => {
            const res = await signupUser({
                email: uniqueEmail("attacker"),
                password: "hackPassword123!",
            });

            expect(res.ok).toBe(false);
            expect([400, 403]).toContain(res.status);
        });

        test("rejects unauthenticated account creation", async () => {
            const res = await signupUser({
                email: uniqueEmail("sneaky"),
                password: "hackPassword123!",
            });

            expect(res.ok).toBe(false);
            expect([400, 403]).toContain(res.status);
        });
    });

    describe("admin user creation", () => {
        let admin: TestUser;

        beforeAll(async () => {
            if (hadUsersBeforeSuite) {
                admin = await createAdmin("onboarding-admin");
                return;
            }

            const session = await authenticateUser("onboarding@test.local", TEST_PASSWORD);
            admin = {
                ...session.record,
                password: TEST_PASSWORD,
                token: session.token,
            };
        });

        test("superuser can create additional users", async () => {
            const target = await createUser("created-by-superuser");
            expect(target.email).toContain("created-by-superuser");
            expect(target.token.length).toBeGreaterThan(0);
        });

        test("verified admin can create regular users", async () => {
            const res = await pbRequest("/collections/users/records", {
                method: "POST",
                headers: {
                    Authorization: admin.token,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    email: uniqueEmail("user-by-admin"),
                    password: TEST_PASSWORD,
                    passwordConfirm: TEST_PASSWORD,
                    name: "Created by Admin",
                }),
            });

            await expectStatus(res, 200, "admin creates user");
        });

        test("verified admin can grant admin to a new user", async () => {
            const res = await pbRequest("/collections/users/records", {
                method: "POST",
                headers: {
                    Authorization: admin.token,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    email: uniqueEmail("admin-granted"),
                    password: TEST_PASSWORD,
                    passwordConfirm: TEST_PASSWORD,
                    name: "Granted Admin",
                    admin: true,
                }),
            });

            await expectStatus(res, 200, "verified admin grants admin");
            const data = await readJson<{ admin: boolean }>(res);
            expect(data.admin).toBe(true);
        });
    });

    describe("non-admin restrictions", () => {
        test("regular user cannot create users", async () => {
            const regular = await createUser("regular-user");
            const res = await pbRequest("/collections/users/records", {
                method: "POST",
                headers: {
                    Authorization: regular.token,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    email: uniqueEmail("forbidden"),
                    password: TEST_PASSWORD,
                    passwordConfirm: TEST_PASSWORD,
                }),
            });

            expect(res.ok).toBe(false);
            expect([400, 403]).toContain(res.status);
        });
    });

    describe("unverified admin restrictions", () => {
        test("unverified admin cannot grant admin to a new user", async () => {
            const unverified = await createUnverifiedAdmin("unverified-admin");
            const res = await pbRequest("/collections/users/records", {
                method: "POST",
                headers: {
                    Authorization: unverified.token,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    email: uniqueEmail("admin-attempt"),
                    password: TEST_PASSWORD,
                    passwordConfirm: TEST_PASSWORD,
                    admin: true,
                }),
            });

            await expectStatus(res, 400, "unverified admin grant");
            const body = await readJson<{ message?: string }>(res);
            expect(body.message).toContain("verified");
        });
    });

    describe("user deletion protection", () => {
        test("verified users cannot be deleted, even by the superuser", async () => {
            const verified = await createUser("verified-delete-target", { verified: true });
            const res = await pbRequest(`/collections/users/records/${verified.id}`, {
                method: "DELETE",
                headers: { Authorization: superuserToken },
            });

            await expectStatus(res, 400, "delete verified user");
            expect(await readJson<{ message?: string }>(res)).toHaveProperty("message");
        });

        test("unverified users can be deleted by the superuser", async () => {
            const unverified = await createUser("unverified-delete-target", { verified: false });
            const res = await pbRequest(`/collections/users/records/${unverified.id}`, {
                method: "DELETE",
                headers: { Authorization: superuserToken },
            });

            await expectStatus(res, 204, "delete unverified user");
        });
    });
});

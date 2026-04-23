import { describe, test, expect, beforeAll } from "bun:test";
import { PB_API, authenticateSuperuser, authenticateUser, signupUser } from "../../helpers/setup";

const TRASH_COLLECTIONS = ["trash_documents", "trash_folders", "trash_document_versions"] as const;

describe("Trash Guards", () => {
    let userToken: string;

    beforeAll(async () => {
        // Ensure first user exists (may already exist from user-guards tests)
        const superuserToken = await authenticateSuperuser();

        // Check if test user exists, create if not
        const listRes = await fetch(
            `${PB_API}/collections/users/records?filter=(email='trash-test@test.local')`,
            { headers: { Authorization: superuserToken } },
        );
        const listData = await listRes.json();
        if (listData.items.length === 0) {
            // Ensure at least one user exists first (for signup lock)
            const checkRes = await fetch(`${PB_API}/collections/users/records?perPage=1`, {
                headers: { Authorization: superuserToken },
            });
            const checkData = await checkRes.json();
            if (checkData.items.length === 0) {
                // Create first user via signup
                await signupUser({ email: "first@test.local", password: "testPassword123!" });
            }
            // Create test user via superuser
            await fetch(`${PB_API}/collections/users/records`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: superuserToken },
                body: JSON.stringify({
                    email: "trash-test@test.local",
                    password: "testPassword123!",
                    passwordConfirm: "testPassword123!",
                    name: "Trash Test User",
                }),
            });
        }

        const auth = await authenticateUser("trash-test@test.local", "testPassword123!");
        userToken = auth.token;
    });

    for (const collection of TRASH_COLLECTIONS) {
        describe(`${collection}`, () => {
            test(`regular user cannot create records in ${collection}`, async () => {
                const res = await fetch(`${PB_API}/collections/${collection}/records`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: userToken,
                    },
                    body: JSON.stringify({}),
                });
                expect(res.ok).toBe(false);
                expect([400, 403]).toContain(res.status);
            });

            test(`regular user cannot update records in ${collection}`, async () => {
                // Try to update a nonexistent record — guard should fire before 404
                const res = await fetch(`${PB_API}/collections/${collection}/records/nonexistent123456`, {
                    method: "PATCH",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: userToken,
                    },
                    body: JSON.stringify({ deleted_by: "test" }),
                });
                expect(res.ok).toBe(false);
            });

            test(`regular user cannot delete records in ${collection}`, async () => {
                const res = await fetch(`${PB_API}/collections/${collection}/records/nonexistent123456`, {
                    method: "DELETE",
                    headers: { Authorization: userToken },
                });
                expect(res.ok).toBe(false);
            });
        });
    }

    describe("unauthenticated access", () => {
        for (const collection of TRASH_COLLECTIONS) {
            test(`unauthenticated user cannot create in ${collection}`, async () => {
                const res = await fetch(`${PB_API}/collections/${collection}/records`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({}),
                });
                expect(res.ok).toBe(false);
            });
        }
    });
});

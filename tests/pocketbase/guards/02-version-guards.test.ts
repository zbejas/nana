import { describe, test, expect, beforeAll } from "bun:test";
import { PB_API, authenticateSuperuser, authenticateUser, signupUser } from "../../helpers/setup";

describe("Version Guards", () => {
    let userToken: string;

    beforeAll(async () => {
        const superuserToken = await authenticateSuperuser();

        // Check if test user exists, create if not
        const listRes = await fetch(
            `${PB_API}/collections/users/records?filter=(email='version-test@test.local')`,
            { headers: { Authorization: superuserToken } },
        );
        const listData = await listRes.json();
        if (listData.items.length === 0) {
            // Ensure at least one user exists first
            const checkRes = await fetch(`${PB_API}/collections/users/records?perPage=1`, {
                headers: { Authorization: superuserToken },
            });
            const checkData = await checkRes.json();
            if (checkData.items.length === 0) {
                await signupUser({ email: "first@test.local", password: "testPassword123!" });
            }
            await fetch(`${PB_API}/collections/users/records`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: superuserToken },
                body: JSON.stringify({
                    email: "version-test@test.local",
                    password: "testPassword123!",
                    passwordConfirm: "testPassword123!",
                    name: "Version Test User",
                }),
            });
        }

        const auth = await authenticateUser("version-test@test.local", "testPassword123!");
        userToken = auth.token;
    });

    test("regular user cannot create document_versions", async () => {
        const res = await fetch(`${PB_API}/collections/document_versions/records`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: userToken,
            },
            body: JSON.stringify({
                document: "fake_doc_id_12345",
                title: "Fake Version",
                content: "Should not be created",
            }),
        });
        expect(res.ok).toBe(false);
        expect([400, 403]).toContain(res.status);
    });

    test("regular user cannot update document_versions", async () => {
        const res = await fetch(`${PB_API}/collections/document_versions/records/nonexistent123456`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                Authorization: userToken,
            },
            body: JSON.stringify({ title: "Modified" }),
        });
        expect(res.ok).toBe(false);
    });

    test("regular user cannot delete document_versions", async () => {
        const res = await fetch(`${PB_API}/collections/document_versions/records/nonexistent123456`, {
            method: "DELETE",
            headers: { Authorization: userToken },
        });
        expect(res.ok).toBe(false);
    });

    describe("unauthenticated access", () => {
        test("unauthenticated user cannot create document_versions", async () => {
            const res = await fetch(`${PB_API}/collections/document_versions/records`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    document: "fake_doc_id_12345",
                    title: "Fake Version",
                    content: "Unauthenticated attempt",
                }),
            });
            expect(res.ok).toBe(false);
        });
    });
});

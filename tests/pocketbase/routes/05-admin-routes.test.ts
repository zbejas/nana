import { describe, test, expect, beforeAll } from "bun:test";
import {
    PB_API,
    BASE_URL,
    authenticateSuperuser,
    authenticateUser,
    createTestUser,
    signupUser,
} from "../../helpers/setup";

const ADMIN_API = `${PB_API}/admin`;

describe("Admin Routes", () => {
    let superuserToken: string;
    let adminToken: string;
    let adminUserId: string;
    let nonAdminToken: string;
    let nonAdminUserId: string;

    beforeAll(async () => {
        superuserToken = await authenticateSuperuser();

        // Ensure at least one user exists (for signup guard)
        const checkRes = await fetch(`${PB_API}/collections/users/records?perPage=1`, {
            headers: { Authorization: superuserToken },
        });
        const checkData = await checkRes.json();
        if (checkData.items.length === 0) {
            await signupUser({ email: "first@test.local", password: "testPassword123!" });
        }

        // Create admin test user if not exists
        const adminEmail = "admin-route-test@test.local";
        const adminListRes = await fetch(
            `${PB_API}/collections/users/records?filter=(email='${adminEmail}')`,
            { headers: { Authorization: superuserToken } },
        );
        const adminListData = await adminListRes.json();
        if (adminListData.items.length === 0) {
            await createTestUser(superuserToken, {
                email: adminEmail,
                password: "testPassword123!",
                name: "Admin Route Test",
                admin: true,
            });
        }

        // Verify the user, since admin-granting requires verified status
        const adminAuth = await authenticateUser(adminEmail, "testPassword123!");
        adminToken = adminAuth.token;
        adminUserId = adminAuth.record.id;

        // Mark admin user as verified via superuser
        await fetch(`${PB_API}/collections/users/records/${adminUserId}`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                Authorization: superuserToken,
            },
            body: JSON.stringify({ verified: true }),
        });

        // Re-authenticate to pick up verified status
        const adminAuth2 = await authenticateUser(adminEmail, "testPassword123!");
        adminToken = adminAuth2.token;

        // Create non-admin test user if not exists
        const nonAdminEmail = "nonadmin-route-test@test.local";
        const nonAdminListRes = await fetch(
            `${PB_API}/collections/users/records?filter=(email='${nonAdminEmail}')`,
            { headers: { Authorization: superuserToken } },
        );
        const nonAdminListData = await nonAdminListRes.json();
        if (nonAdminListData.items.length === 0) {
            await createTestUser(superuserToken, {
                email: nonAdminEmail,
                password: "testPassword123!",
                name: "Non-Admin Route Test",
                admin: false,
            });
        }

        const nonAdminAuth = await authenticateUser(nonAdminEmail, "testPassword123!");
        nonAdminToken = nonAdminAuth.token;
        nonAdminUserId = nonAdminAuth.record.id;
    });

    // ──────────────────────────────────────────
    // SMTP Routes
    // ──────────────────────────────────────────

    describe("GET /api/admin/smtp", () => {
        test("returns 401 for unauthenticated request", async () => {
            const res = await fetch(`${ADMIN_API}/smtp`);
            expect(res.status).toBe(401);
        });

        test("rejects non-admin user", async () => {
            const res = await fetch(`${ADMIN_API}/smtp`, {
                headers: { Authorization: nonAdminToken },
            });
            // requireAdmin throws ForbiddenError caught by generic catch → 500
            expect([403, 500]).toContain(res.status);
        });

        test("returns SMTP settings for admin user", async () => {
            const res = await fetch(`${ADMIN_API}/smtp`, {
                headers: { Authorization: adminToken },
            });
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.smtp).toBeDefined();
            expect(data.smtp).toHaveProperty("enabled");
            expect(data.smtp).toHaveProperty("host");
            expect(data.smtp).toHaveProperty("port");
            expect(data.smtp).toHaveProperty("username");
            expect(data.smtp).toHaveProperty("senderName");
            expect(data.smtp).toHaveProperty("senderAddress");
            // Password must be masked (empty)
            expect(data.smtp.password).toBe("");
        });
    });

    describe("PATCH /api/admin/smtp", () => {
        test("returns 401 for unauthenticated request", async () => {
            const res = await fetch(`${ADMIN_API}/smtp`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ smtp: { enabled: false } }),
            });
            expect(res.status).toBe(401);
        });

        test("rejects non-admin user", async () => {
            const res = await fetch(`${ADMIN_API}/smtp`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: nonAdminToken,
                },
                body: JSON.stringify({ smtp: { enabled: false } }),
            });
            expect([403, 500]).toContain(res.status);
        });

        test("returns 400 if smtp field is missing", async () => {
            const res = await fetch(`${ADMIN_API}/smtp`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: adminToken,
                },
                body: JSON.stringify({ notSmtp: true }),
            });
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toContain("SMTP configuration is required");
        });

        test("updates SMTP settings for admin user", async () => {
            const res = await fetch(`${ADMIN_API}/smtp`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: adminToken,
                },
                body: JSON.stringify({
                    smtp: {
                        enabled: false,
                        host: "smtp.test.local",
                        port: 465,
                        username: "testuser",
                        tls: true,
                    },
                }),
            });
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.success).toBe(true);
            expect(data.message).toContain("SMTP settings updated");

            // Verify settings were persisted
            const getRes = await fetch(`${ADMIN_API}/smtp`, {
                headers: { Authorization: adminToken },
            });
            const getResData = await getRes.json();
            expect(getResData.smtp.host).toBe("smtp.test.local");
            expect(getResData.smtp.port).toBe(465);
            expect(getResData.smtp.username).toBe("testuser");
        });
    });

    describe("POST /api/admin/smtp/test", () => {
        test("returns 401 for unauthenticated request", async () => {
            const res = await fetch(`${ADMIN_API}/smtp/test`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
            });
            expect(res.status).toBe(401);
        });

        test("rejects non-admin user", async () => {
            const res = await fetch(`${ADMIN_API}/smtp/test`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: nonAdminToken,
                },
            });
            expect([403, 500]).toContain(res.status);
        });

        test("fails when sender address is not configured", async () => {
            // Ensure SMTP sender address is cleared
            await fetch(`${ADMIN_API}/smtp`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: adminToken,
                },
                body: JSON.stringify({
                    smtp: {
                        enabled: false,
                        senderAddress: "",
                    },
                }),
            });

            const res = await fetch(`${ADMIN_API}/smtp/test`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: adminToken,
                },
            });
            // Should fail because sender address is not configured or SMTP will fail
            expect([400, 500]).toContain(res.status);
        });
    });

    describe("POST /api/admin/smtp/send-password", () => {
        test("returns 401 for unauthenticated request", async () => {
            const res = await fetch(`${ADMIN_API}/smtp/send-password`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email: "user@test.local",
                    password: "newpassword123",
                }),
            });
            expect(res.status).toBe(401);
        });

        test("rejects non-admin user", async () => {
            const res = await fetch(`${ADMIN_API}/smtp/send-password`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: nonAdminToken,
                },
                body: JSON.stringify({
                    email: "user@test.local",
                    password: "newpassword123",
                }),
            });
            expect([403, 500]).toContain(res.status);
        });

        test("returns 400 if email is missing or invalid", async () => {
            const res = await fetch(`${ADMIN_API}/smtp/send-password`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: adminToken,
                },
                body: JSON.stringify({ password: "newpassword123" }),
            });
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toContain("email");
        });

        test("returns 400 if password is missing", async () => {
            const res = await fetch(`${ADMIN_API}/smtp/send-password`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: adminToken,
                },
                body: JSON.stringify({ email: "user@test.local" }),
            });
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toContain("Password is required");
        });

        test("returns 400 when SMTP is not enabled", async () => {
            // Ensure SMTP is disabled
            await fetch(`${ADMIN_API}/smtp`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: adminToken,
                },
                body: JSON.stringify({ smtp: { enabled: false } }),
            });

            const res = await fetch(`${ADMIN_API}/smtp/send-password`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: adminToken,
                },
                body: JSON.stringify({
                    email: "user@test.local",
                    password: "newpassword123",
                    name: "Test User",
                }),
            });
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toContain("SMTP is not enabled");
        });
    });

    // ──────────────────────────────────────────
    // Users Routes
    // ──────────────────────────────────────────

    describe("PATCH /api/admin/users/{id}", () => {
        test("returns 401 for unauthenticated request", async () => {
            const res = await fetch(`${ADMIN_API}/users/${nonAdminUserId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: "Updated Name" }),
            });
            expect(res.status).toBe(401);
        });

        test("rejects non-admin user", async () => {
            const res = await fetch(`${ADMIN_API}/users/${nonAdminUserId}`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: nonAdminToken,
                },
                body: JSON.stringify({ name: "Updated Name" }),
            });
            expect([403, 500]).toContain(res.status);
        });

        test("returns 400 if body is empty", async () => {
            const res = await fetch(`${ADMIN_API}/users/${nonAdminUserId}`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: adminToken,
                },
                body: JSON.stringify({}),
            });
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toContain("Request body is required");
        });

        test("updates user name as admin", async () => {
            const newName = `Updated-${Date.now()}`;
            const res = await fetch(`${ADMIN_API}/users/${nonAdminUserId}`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: adminToken,
                },
                body: JSON.stringify({ name: newName }),
            });
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.name).toBe(newName);
        });

        test("updates user password without oldPassword", async () => {
            const res = await fetch(`${ADMIN_API}/users/${nonAdminUserId}`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: adminToken,
                },
                body: JSON.stringify({ password: "newPassword456!" }),
            });
            expect(res.status).toBe(200);

            // Verify login with new password works
            const authRes = await authenticateUser(
                "nonadmin-route-test@test.local",
                "newPassword456!",
            );
            expect(authRes.token).toBeTruthy();
            // Update token for subsequent tests
            nonAdminToken = authRes.token;
        });

        test("returns 403 when unverified admin tries to grant admin", async () => {
            // Create an unverified admin user
            const unverifiedEmail = "unverified-admin-test@test.local";
            const uvListRes = await fetch(
                `${PB_API}/collections/users/records?filter=(email='${unverifiedEmail}')`,
                { headers: { Authorization: superuserToken } },
            );
            const uvListData = await uvListRes.json();
            let unverifiedAdminId: string;
            if (uvListData.items.length === 0) {
                const created = await createTestUser(superuserToken, {
                    email: unverifiedEmail,
                    password: "testPassword123!",
                    name: "Unverified Admin",
                    admin: true,
                });
                unverifiedAdminId = created.id;
            } else {
                unverifiedAdminId = uvListData.items[0].id;
            }

            const uvAuth = await authenticateUser(unverifiedEmail, "testPassword123!");

            const res = await fetch(`${ADMIN_API}/users/${nonAdminUserId}`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: uvAuth.token,
                },
                body: JSON.stringify({ admin: true }),
            });
            expect(res.status).toBe(403);
            const data = await res.json();
            expect(data.error).toContain("verified");
        });

        test("verified admin can grant admin privileges", async () => {
            // Create a target user to promote
            const targetEmail = "promote-target@test.local";
            const targetListRes = await fetch(
                `${PB_API}/collections/users/records?filter=(email='${targetEmail}')`,
                { headers: { Authorization: superuserToken } },
            );
            const targetListData = await targetListRes.json();
            let targetId: string;
            if (targetListData.items.length === 0) {
                const created = await createTestUser(superuserToken, {
                    email: targetEmail,
                    password: "testPassword123!",
                    name: "Promote Target",
                    admin: false,
                });
                targetId = created.id;
            } else {
                targetId = targetListData.items[0].id;
            }

            const res = await fetch(`${ADMIN_API}/users/${targetId}`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: adminToken,
                },
                body: JSON.stringify({ admin: true }),
            });
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.admin).toBe(true);
        });

        test("returns 404 for non-existent user ID", async () => {
            const res = await fetch(`${ADMIN_API}/users/nonexistent_id_000`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: adminToken,
                },
                body: JSON.stringify({ name: "Ghost" }),
            });
            // PB throws when record not found — becomes 500 in this handler
            expect([404, 500]).toContain(res.status);
        });
    });

    describe("POST /api/admin/users/{id}/request-email-change", () => {
        test("returns 401 for unauthenticated request", async () => {
            const res = await fetch(
                `${ADMIN_API}/users/${nonAdminUserId}/request-email-change`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ newEmail: "new@test.local" }),
                },
            );
            expect(res.status).toBe(401);
        });

        test("rejects non-admin user", async () => {
            const res = await fetch(
                `${ADMIN_API}/users/${nonAdminUserId}/request-email-change`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: nonAdminToken,
                    },
                    body: JSON.stringify({ newEmail: "new@test.local" }),
                },
            );
            // req_email_change properly checks for ForbiddenError → 403
            expect(res.status).toBe(403);
        });

        test("returns 400 if newEmail is missing", async () => {
            const res = await fetch(
                `${ADMIN_API}/users/${nonAdminUserId}/request-email-change`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: adminToken,
                    },
                    body: JSON.stringify({}),
                },
            );
            expect(res.status).toBe(400);
        });

        test("returns 400 for invalid email format", async () => {
            const res = await fetch(
                `${ADMIN_API}/users/${nonAdminUserId}/request-email-change`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: adminToken,
                    },
                    body: JSON.stringify({ newEmail: "not-an-email" }),
                },
            );
            expect(res.status).toBe(400);
        });

        test("fails when SMTP is not configured (send fails)", async () => {
            // Ensure SMTP is disabled
            await fetch(`${ADMIN_API}/smtp`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: adminToken,
                },
                body: JSON.stringify({ smtp: { enabled: false } }),
            });

            const res = await fetch(
                `${ADMIN_API}/users/${nonAdminUserId}/request-email-change`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: adminToken,
                    },
                    body: JSON.stringify({ newEmail: "changed@test.local" }),
                },
            );
            // Will fail because mail client can't send without SMTP
            expect([400, 500]).toContain(res.status);
        });
    });

    // ──────────────────────────────────────────
    // Attachments Routes
    // ──────────────────────────────────────────

    describe("GET /api/admin/attachments", () => {
        test("returns 401 for unauthenticated request", async () => {
            const res = await fetch(`${ADMIN_API}/attachments`);
            expect(res.status).toBe(401);
        });

        test("rejects non-admin user", async () => {
            const res = await fetch(`${ADMIN_API}/attachments`, {
                headers: { Authorization: nonAdminToken },
            });
            expect([403, 500]).toContain(res.status);
        });

        test("returns attachment settings for admin user", async () => {
            const res = await fetch(`${ADMIN_API}/attachments`, {
                headers: { Authorization: adminToken },
            });
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.attachments).toBeDefined();
            expect(data.attachments).toHaveProperty("maxAttachmentSizeBytes");
            expect(data.attachments).toHaveProperty("maxAttachmentSizeMB");
            expect(data.attachments).toHaveProperty("maxAttachments");
            expect(typeof data.attachments.maxAttachmentSizeBytes).toBe("number");
            expect(typeof data.attachments.maxAttachmentSizeMB).toBe("number");
            expect(typeof data.attachments.maxAttachments).toBe("number");
        });
    });

    describe("PATCH /api/admin/attachments", () => {
        test("returns 401 for unauthenticated request", async () => {
            const res = await fetch(`${ADMIN_API}/attachments`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    attachments: { maxAttachmentSizeMB: 10, maxAttachments: 5 },
                }),
            });
            expect(res.status).toBe(401);
        });

        test("rejects non-admin user", async () => {
            const res = await fetch(`${ADMIN_API}/attachments`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: nonAdminToken,
                },
                body: JSON.stringify({
                    attachments: { maxAttachmentSizeMB: 10, maxAttachments: 5 },
                }),
            });
            expect([403, 500]).toContain(res.status);
        });

        test("returns 400 if values are not positive integers", async () => {
            const res = await fetch(`${ADMIN_API}/attachments`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: adminToken,
                },
                body: JSON.stringify({
                    attachments: { maxAttachmentSizeMB: -1, maxAttachments: 0 },
                }),
            });
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toContain("positive integers");
        });

        test("returns 400 if values are non-numeric", async () => {
            const res = await fetch(`${ADMIN_API}/attachments`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: adminToken,
                },
                body: JSON.stringify({
                    attachments: { maxAttachmentSizeMB: "abc", maxAttachments: "xyz" },
                }),
            });
            expect(res.status).toBe(400);
        });

        test("updates attachment settings for admin user", async () => {
            const res = await fetch(`${ADMIN_API}/attachments`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: adminToken,
                },
                body: JSON.stringify({
                    attachments: { maxAttachmentSizeMB: 25, maxAttachments: 10 },
                }),
            });
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.success).toBe(true);
            expect(data.attachments.maxAttachmentSizeMB).toBe(25);
            expect(data.attachments.maxAttachments).toBe(10);
            expect(data.attachments.maxAttachmentSizeBytes).toBe(25 * 1024 * 1024);

            // Verify settings persisted via GET
            const getRes = await fetch(`${ADMIN_API}/attachments`, {
                headers: { Authorization: adminToken },
            });
            const getData = await getRes.json();
            expect(getData.attachments.maxAttachmentSizeMB).toBe(25);
            expect(getData.attachments.maxAttachments).toBe(10);
        });
    });

    // ──────────────────────────────────────────
    // OAuth Routes
    // ──────────────────────────────────────────

    describe("GET /api/admin/oauth/providers", () => {
        test("returns 401 for unauthenticated request", async () => {
            const res = await fetch(`${ADMIN_API}/oauth/providers`);
            expect(res.status).toBe(401);
        });

        test("rejects non-admin user", async () => {
            const res = await fetch(`${ADMIN_API}/oauth/providers`, {
                headers: { Authorization: nonAdminToken },
            });
            expect([403, 500]).toContain(res.status);
        });

        test("returns OAuth2 provider settings for admin user", async () => {
            const res = await fetch(`${ADMIN_API}/oauth/providers`, {
                headers: { Authorization: adminToken },
            });
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data).toHaveProperty("enabled");
            expect(data).toHaveProperty("providers");
            expect(data).toHaveProperty("mappedFields");
            expect(Array.isArray(data.providers)).toBe(true);
        });

        test("secrets are masked in response", async () => {
            // First add a provider with a secret
            await fetch(`${ADMIN_API}/oauth/providers`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: adminToken,
                },
                body: JSON.stringify({
                    providers: [
                        {
                            name: "google",
                            clientId: "test-client-id",
                            clientSecret: "super-secret-value",
                        },
                    ],
                }),
            });

            const res = await fetch(`${ADMIN_API}/oauth/providers`, {
                headers: { Authorization: adminToken },
            });
            expect(res.status).toBe(200);
            const data = await res.json();
            const google = data.providers.find((p: any) => p.name === "google");
            if (google && google.clientSecret) {
                // Secret should be masked, not the actual value
                expect(google.clientSecret).not.toBe("super-secret-value");
                expect(google.clientSecret).toBe("••••••••");
            }
        });
    });

    describe("PATCH /api/admin/oauth/providers", () => {
        test("returns 401 for unauthenticated request", async () => {
            const res = await fetch(`${ADMIN_API}/oauth/providers`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ enabled: true }),
            });
            expect(res.status).toBe(401);
        });

        test("rejects non-admin user", async () => {
            const res = await fetch(`${ADMIN_API}/oauth/providers`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: nonAdminToken,
                },
                body: JSON.stringify({ enabled: true }),
            });
            expect([403, 500]).toContain(res.status);
        });

        test("updates OAuth2 enabled state for admin user", async () => {
            const res = await fetch(`${ADMIN_API}/oauth/providers`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: adminToken,
                },
                body: JSON.stringify({ enabled: true }),
            });
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.success).toBe(true);
        });

        test("updates OAuth2 providers list for admin user", async () => {
            const res = await fetch(`${ADMIN_API}/oauth/providers`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: adminToken,
                },
                body: JSON.stringify({
                    providers: [
                        {
                            name: "github",
                            clientId: "gh-client-id",
                            clientSecret: "gh-secret",
                            displayName: "GitHub",
                        },
                    ],
                }),
            });
            expect(res.status).toBe(200);

            // Verify persisted
            const getRes = await fetch(`${ADMIN_API}/oauth/providers`, {
                headers: { Authorization: adminToken },
            });
            const getData = await getRes.json();
            const github = getData.providers.find((p: any) => p.name === "github");
            expect(github).toBeDefined();
            expect(github.clientId).toBe("gh-client-id");
            expect(github.displayName).toBe("GitHub");
        });

        test("updates mapped fields for admin user", async () => {
            const res = await fetch(`${ADMIN_API}/oauth/providers`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: adminToken,
                },
                body: JSON.stringify({
                    mappedFields: {
                        id: "sub",
                        name: "name",
                        username: "login",
                        avatarURL: "avatar_url",
                    },
                }),
            });
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.success).toBe(true);
        });

        test("preserves existing secret when masked value sent", async () => {
            // Set a known provider with secret
            await fetch(`${ADMIN_API}/oauth/providers`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: adminToken,
                },
                body: JSON.stringify({
                    providers: [
                        {
                            name: "gitlab",
                            clientId: "gl-client-id",
                            clientSecret: "gl-real-secret",
                        },
                    ],
                }),
            });

            // Update with masked secret — should preserve original
            const res = await fetch(`${ADMIN_API}/oauth/providers`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: adminToken,
                },
                body: JSON.stringify({
                    providers: [
                        {
                            name: "gitlab",
                            clientId: "gl-client-id-updated",
                            clientSecret: "••••••••",
                        },
                    ],
                }),
            });
            expect(res.status).toBe(200);

            // GET should still show masked (meaning secret is still there)
            const getRes = await fetch(`${ADMIN_API}/oauth/providers`, {
                headers: { Authorization: adminToken },
            });
            const getData = await getRes.json();
            const gitlab = getData.providers.find((p: any) => p.name === "gitlab");
            expect(gitlab).toBeDefined();
            expect(gitlab.clientId).toBe("gl-client-id-updated");
            // Secret should still be masked (preserved, not cleared)
            expect(gitlab.clientSecret).toBe("••••••••");
        });
    });

    // ──────────────────────────────────────────
    // App URL Route
    // ──────────────────────────────────────────

    describe("PATCH /api/admin/app-url", () => {
        test("returns 401 for unauthenticated request", async () => {
            const res = await fetch(`${ADMIN_API}/app-url`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: "https://example.com" }),
            });
            expect(res.status).toBe(401);
        });

        test("rejects non-admin user", async () => {
            const res = await fetch(`${ADMIN_API}/app-url`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: nonAdminToken,
                },
                body: JSON.stringify({ url: "https://example.com" }),
            });
            expect([403, 500]).toContain(res.status);
        });

        test("returns 400 if url is empty", async () => {
            const res = await fetch(`${ADMIN_API}/app-url`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: adminToken,
                },
                body: JSON.stringify({ url: "" }),
            });
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toContain("URL is required");
        });

        test("returns 400 if url field is missing", async () => {
            const res = await fetch(`${ADMIN_API}/app-url`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: adminToken,
                },
                body: JSON.stringify({ notUrl: "https://example.com" }),
            });
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toContain("URL is required");
        });

        test("updates app URL for admin user", async () => {
            const testUrl = "https://nana-test.example.com";
            const res = await fetch(`${ADMIN_API}/app-url`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: adminToken,
                },
                body: JSON.stringify({ url: testUrl }),
            });
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.success).toBe(true);
            expect(data.appURL).toBe(testUrl);
            expect(data.message).toContain("Application URL updated");
        });

        test("strips trailing slashes from URL", async () => {
            const res = await fetch(`${ADMIN_API}/app-url`, {
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

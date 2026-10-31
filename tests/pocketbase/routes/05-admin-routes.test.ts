import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
    expectJsonError,
    expectStatus,
    pbRequest,
    readJson,
} from "../../helpers/client";
import {
    createAdmin,
    createUnverifiedAdmin,
    createUser,
    getSuperuserToken,
    type TestUser,
} from "../../helpers/factories";
import {
    restoreAdminSettings,
    snapshotAdminSettings,
    type AdminSettingsSnapshot,
} from "../../helpers/settings";
import { authenticateUser, uniqueEmail, uniqueSuffix } from "../../helpers/setup";

const ADMIN_API = "/admin";

describe("Admin routes", () => {
    let superuserToken: string;
    let admin: TestUser;
    let nonAdmin: TestUser;
    let unverifiedAdmin: TestUser;
    let snapshot: AdminSettingsSnapshot;

    beforeAll(async () => {
        superuserToken = await getSuperuserToken();
        admin = await createAdmin("admin-routes");
        nonAdmin = await createUser("admin-routes-nonadmin");
        unverifiedAdmin = await createUnverifiedAdmin("admin-routes-unverified");
        snapshot = await snapshotAdminSettings(admin.token, superuserToken);
    });

    afterAll(async () => {
        await restoreAdminSettings(snapshot, admin.token, superuserToken);
    });

    function adminRequest(
        path: string,
        options: RequestInit = {},
        token = admin.token,
    ): Promise<Response> {
        return pbRequest(`${ADMIN_API}${path}`, {
            ...options,
            headers: { Authorization: token, ...options.headers },
        });
    }

    function adminJson(
        method: string,
        path: string,
        body: unknown,
        token = admin.token,
    ): Promise<Response> {
        return adminRequest(
            path,
            {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            },
            token,
        );
    }

    describe("auth boundary", () => {
        test("unauthenticated requests are rejected", async () => {
            const paths = [
                ["GET", "/smtp"],
                ["PATCH", "/smtp"],
                ["POST", "/smtp/test"],
                ["POST", "/smtp/send-password"],
                ["GET", "/attachments"],
                ["PATCH", "/attachments"],
                ["GET", "/oauth/providers"],
                ["PATCH", "/oauth/providers"],
                ["PATCH", "/app-url"],
            ] as const;

            for (const [method, path] of paths) {
                const res = await pbRequest(`${ADMIN_API}${path}`, { method });
                await expectStatus(res, 401, `${method} ${path}`);
            }
        });

        test("non-admin users receive 403 on every admin endpoint", async () => {
            const requests = [
                ["GET", "/smtp", undefined],
                ["PATCH", "/smtp", { smtp: { enabled: false } }],
                ["POST", "/smtp/test", undefined],
                ["POST", "/smtp/send-password", { email: "x@test.local", password: "pw" }],
                ["GET", "/attachments", undefined],
                ["PATCH", "/attachments", { attachments: { maxAttachmentSizeMB: 10, maxAttachments: 5 } }],
                ["GET", "/oauth/providers", undefined],
                ["PATCH", "/oauth/providers", { enabled: true }],
                ["PATCH", "/app-url", { url: "https://example.com" }],
            ] as const;

            for (const [method, path, body] of requests) {
                const res = body
                    ? await adminJson(method, path, body, nonAdmin.token)
                    : await adminRequest(path, { method }, nonAdmin.token);
                await expectStatus(res, 403, `${method} ${path} as non-admin`);
            }
        });
    });

    describe("SMTP", () => {
        test("GET returns masked settings", async () => {
            const res = await adminRequest("/smtp");
            await expectStatus(res, 200);
            const data = await readJson<{ smtp: Record<string, unknown> }>(res);

            expect(data.smtp).toHaveProperty("enabled");
            expect(data.smtp).toHaveProperty("host");
            expect(data.smtp).toHaveProperty("port");
            expect(data.smtp).toHaveProperty("username");
            expect(data.smtp).toHaveProperty("senderName");
            expect(data.smtp).toHaveProperty("senderAddress");
            expect(data.smtp.password).toBe("");
        });

        test("PATCH requires an smtp object", async () => {
            const res = await adminJson("PATCH", "/smtp", { notSmtp: true });
            await expectJsonError(res, 400, "SMTP configuration is required");
        });

        test("PATCH persists settings", async () => {
            const res = await adminJson("PATCH", "/smtp", {
                smtp: {
                    enabled: false,
                    host: "smtp.test.local",
                    port: 465,
                    username: "testuser",
                    tls: true,
                },
            });
            await expectStatus(res, 200);
            expect((await readJson<{ success: boolean }>(res)).success).toBe(true);

            const data = await readJson<{ smtp: { host: string; port: number; username: string } }>(
                await adminRequest("/smtp"),
            );
            expect(data.smtp.host).toBe("smtp.test.local");
            expect(data.smtp.port).toBe(465);
            expect(data.smtp.username).toBe("testuser");
        });

        test("POST /smtp/test fails clearly when sender is missing", async () => {
            await adminJson("PATCH", "/smtp", {
                smtp: { enabled: false, senderAddress: "" },
            });

            const res = await adminRequest("/smtp/test", { method: "POST" });
            expect([400, 500]).toContain(res.status);
        });

        test("POST /smtp/send-password validates input", async () => {
            await expectJsonError(
                await adminJson("POST", "/smtp/send-password", { password: "newpassword123" }),
                400,
                "email",
            );
            await expectJsonError(
                await adminJson("POST", "/smtp/send-password", { email: "user@test.local" }),
                400,
                "Password is required",
            );
        });

        test("POST /smtp/send-password requires SMTP to be enabled", async () => {
            await adminJson("PATCH", "/smtp", { smtp: { enabled: false } });

            const res = await adminJson("POST", "/smtp/send-password", {
                email: "user@test.local",
                password: "newpassword123",
                name: "Test User",
            });
            await expectJsonError(res, 400, "SMTP is not enabled");
        });
    });

    describe("users", () => {
        test("PATCH rejects an empty body", async () => {
            const res = await adminJson("PATCH", `/users/${nonAdmin.id}`, {});
            await expectJsonError(res, 400, "Request body is required");
        });

        test("PATCH updates a name", async () => {
            const newName = `Updated-${uniqueSuffix()}`;
            const res = await adminJson("PATCH", `/users/${nonAdmin.id}`, { name: newName });
            await expectStatus(res, 200);
            expect((await readJson<{ name: string }>(res)).name).toBe(newName);
        });

        test("PATCH updates a password without the old password", async () => {
            const newPassword = `newPassword-${uniqueSuffix()}!`;
            const res = await adminJson("PATCH", `/users/${nonAdmin.id}`, {
                password: newPassword,
            });
            await expectStatus(res, 200);

            const session = await authenticateUser(nonAdmin.email, newPassword);
            expect(session.token).toBeTruthy();
            nonAdmin = { ...nonAdmin, token: session.token, password: newPassword };

            const oldLogin = await pbRequest("/collections/users/auth-with-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ identity: nonAdmin.email, password: "testPassword123!" }),
            });
            expect(oldLogin.ok).toBe(false);
        });

        test("an unverified admin cannot grant admin", async () => {
            const target = await createUser("promote-blocked");
            const res = await adminJson(
                "PATCH",
                `/users/${target.id}`,
                { admin: true },
                unverifiedAdmin.token,
            );

            await expectJsonError(res, 403, "verified");
        });

        test("a verified admin can grant admin", async () => {
            const target = await createUser("promote-target");
            const res = await adminJson("PATCH", `/users/${target.id}`, { admin: true });

            await expectStatus(res, 200);
            expect((await readJson<{ admin: boolean }>(res)).admin).toBe(true);
        });

        test("PATCH returns 404 for an unknown user", async () => {
            const res = await adminJson("PATCH", "/users/nonexistent_id_000", { name: "Ghost" });
            await expectStatus(res, 404);
        });

        test("request-email-change validates input", async () => {
            await expectJsonError(
                await adminJson("POST", `/users/${nonAdmin.id}/request-email-change`, {}),
                400,
                "New email is required",
            );
            await expectJsonError(
                await adminJson("POST", `/users/${nonAdmin.id}/request-email-change`, {
                    newEmail: "not-an-email",
                }),
                400,
                "Invalid email format",
            );
        });

        test("request-email-change rejects an email already in use", async () => {
            const res = await adminJson("POST", `/users/${nonAdmin.id}/request-email-change`, {
                newEmail: admin.email,
            });
            await expectJsonError(res, 400, "Email is already in use");
        });

        test("request-email-change fails when mail cannot be sent", async () => {
            await adminJson("PATCH", "/smtp", { smtp: { enabled: false } });
            const res = await adminJson("POST", `/users/${nonAdmin.id}/request-email-change`, {
                newEmail: uniqueEmail("changed"),
            });
            expect([400, 500]).toContain(res.status);
        });
    });

    describe("attachments", () => {
        test("GET returns the attachment limits", async () => {
            const res = await adminRequest("/attachments");
            await expectStatus(res, 200);
            const data = await readJson<{ attachments: Record<string, unknown> }>(res);

            expect(typeof data.attachments.maxAttachmentSizeBytes).toBe("number");
            expect(typeof data.attachments.maxAttachmentSizeMB).toBe("number");
            expect(typeof data.attachments.maxAttachments).toBe("number");
        });

        test("PATCH validates positive integers", async () => {
            await expectJsonError(
                await adminJson("PATCH", "/attachments", {
                    attachments: { maxAttachmentSizeMB: -1, maxAttachments: 0 },
                }),
                400,
                "positive integers",
            );
            await expectJsonError(
                await adminJson("PATCH", "/attachments", {
                    attachments: { maxAttachmentSizeMB: "abc", maxAttachments: "xyz" },
                }),
                400,
            );
        });

        test("PATCH persists limits and derives bytes", async () => {
            const res = await adminJson("PATCH", "/attachments", {
                attachments: { maxAttachmentSizeMB: 25, maxAttachments: 10 },
            });
            await expectStatus(res, 200);
            const data = await readJson<{
                success: boolean;
                attachments: {
                    maxAttachmentSizeMB: number;
                    maxAttachments: number;
                    maxAttachmentSizeBytes: number;
                };
            }>(res);

            expect(data.success).toBe(true);
            expect(data.attachments.maxAttachmentSizeMB).toBe(25);
            expect(data.attachments.maxAttachments).toBe(10);
            expect(data.attachments.maxAttachmentSizeBytes).toBe(25 * 1024 * 1024);

            const stored = await readJson<{ attachments: { maxAttachmentSizeMB: number } }>(
                await adminRequest("/attachments"),
            );
            expect(stored.attachments.maxAttachmentSizeMB).toBe(25);
        });
    });

    describe("OAuth providers", () => {
        test("GET returns the documented shape", async () => {
            const res = await adminRequest("/oauth/providers");
            await expectStatus(res, 200);
            const data = await readJson<Record<string, unknown>>(res);

            expect(data).toHaveProperty("enabled");
            expect(data).toHaveProperty("providers");
            expect(data).toHaveProperty("mappedFields");
            expect(Array.isArray(data.providers)).toBe(true);
        });

        test("PATCH masks secrets and preserves them when re-submitted", async () => {
            await adminJson("PATCH", "/oauth/providers", {
                providers: [
                    {
                        name: "google",
                        clientId: "test-client-id",
                        clientSecret: "super-secret-value",
                    },
                ],
            });

            const masked = await readJson<{ providers: Array<{ name: string; clientSecret: string }> }>(
                await adminRequest("/oauth/providers"),
            );
            const google = masked.providers.find((provider) => provider.name === "google");
            expect(google?.clientSecret).toBe("••••••••");

            await adminJson("PATCH", "/oauth/providers", {
                providers: [
                    {
                        name: "google",
                        clientId: "updated-client-id",
                        clientSecret: "••••••••",
                    },
                ],
            });

            const stored = await readJson<{
                providers: Array<{ name: string; clientId: string; clientSecret: string }>;
            }>(await adminRequest("/oauth/providers"));
            const updated = stored.providers.find((provider) => provider.name === "google");
            expect(updated?.clientId).toBe("updated-client-id");
            expect(updated?.clientSecret).toBe("••••••••");
        });

        test("PATCH updates enabled state and mapped fields", async () => {
            const enabledRes = await adminJson("PATCH", "/oauth/providers", { enabled: true });
            await expectStatus(enabledRes, 200);

            const mappedRes = await adminJson("PATCH", "/oauth/providers", {
                mappedFields: {
                    id: "id",
                    name: "name",
                    username: "",
                    avatarURL: "avatar",
                },
            });
            await expectStatus(mappedRes, 200);

            const data = await readJson<{
                enabled: boolean;
                mappedFields: Record<string, string>;
            }>(await adminRequest("/oauth/providers"));
            expect(data.enabled).toBe(true);
            expect(data.mappedFields).toEqual({
                id: "id",
                name: "name",
                username: "",
                avatarURL: "avatar",
            });
        });
    });

    describe("app URL", () => {
        test("PATCH requires a non-empty URL", async () => {
            await expectJsonError(await adminJson("PATCH", "/app-url", { url: "" }), 400, "URL is required");
            await expectJsonError(
                await adminJson("PATCH", "/app-url", { notUrl: "https://example.com" }),
                400,
                "URL is required",
            );
        });

        test("PATCH updates PocketBase meta.appURL and trims slashes", async () => {
            const res = await adminJson("PATCH", "/app-url", {
                url: "https://nana.example.com///",
            });
            await expectStatus(res, 200);
            const data = await readJson<{ appURL: string; success: boolean }>(res);
            expect(data.success).toBe(true);
            expect(data.appURL).toBe("https://nana.example.com");

            const settings = await readJson<{ meta: { appURL: string } }>(
                await pbRequest("/settings", { headers: { Authorization: superuserToken } }),
            );
            expect(settings.meta.appURL).toBe("https://nana.example.com");
        });
    });
});

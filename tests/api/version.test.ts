import { beforeAll, describe, expect, test } from "bun:test";
import { bunRequest, expectJsonError, expectStatus, readJson } from "../helpers/client";
import { createUser, type TestUser } from "../helpers/factories";

describe("Bun app endpoints", () => {
    let user: TestUser;

    beforeAll(async () => {
        user = await createUser("api-version");
    });

    describe("GET /api/app/version", () => {
        test("is public and returns the documented shape", async () => {
            const res = await bunRequest("/api/app/version");
            await expectStatus(res, 200);
            const data = await readJson<Record<string, unknown>>(res);

            expect(Object.keys(data).sort()).toEqual(
                ["currentVersion", "latestVersion", "releasesUrl", "updateAvailable"].sort(),
            );
            expect(typeof data.currentVersion).toBe("string");
            expect((data.currentVersion as string).length).toBeGreaterThan(0);
            expect(typeof data.updateAvailable).toBe("boolean");
        });

        test("returns the package version and GitHub releases URL", async () => {
            const data = await readJson<{ currentVersion: string; releasesUrl: string }>(
                await bunRequest("/api/app/version"),
            );

            const packageVersion = (await Bun.file(new URL("../../package.json", import.meta.url)).json()) as {
                version: string;
            };
            expect(data.currentVersion).toBe(packageVersion.version);
            expect(data.releasesUrl).toContain("github.com/zbejas/nana");
        });

        test("rejects non-GET methods", async () => {
            await expectStatus(await bunRequest("/api/app/version", { method: "POST" }), 405);
        });
    });

    describe("POST /api/admin/rate-limits/reload", () => {
        test("requires a valid user token", async () => {
            await expectStatus(
                await bunRequest("/api/admin/rate-limits/reload", { method: "POST" }),
                401,
            );
            await expectStatus(
                await bunRequest("/api/admin/rate-limits/reload", {
                    method: "POST",
                    headers: { Authorization: "invalid-token-value" },
                }),
                401,
            );
        });

        test("reloads the rate-limit configuration", async () => {
            const res = await bunRequest("/api/admin/rate-limits/reload", {
                method: "POST",
                headers: { Authorization: user.token },
            });
            await expectStatus(res, 200);
            const data = await readJson<{
                success: boolean;
                config: { enabled: boolean; pbMaxPerMinute: number; appMaxPerMinute: number };
            }>(res);

            expect(data.success).toBe(true);
            expect(typeof data.config.enabled).toBe("boolean");
            expect(typeof data.config.pbMaxPerMinute).toBe("number");
            expect(typeof data.config.appMaxPerMinute).toBe("number");
        });

        test("rejects GET", async () => {
            await expectStatus(
                await bunRequest("/api/admin/rate-limits/reload", {
                    method: "GET",
                    headers: { Authorization: user.token },
                }),
                405,
            );
        });

        test("applies security headers", async () => {
            const res = await bunRequest("/api/app/version");
            expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
            expect(res.headers.get("X-Frame-Options")).toBe("DENY");
        });
    });

    describe("misc errors", () => {
        test("export rejects GET before auth", async () => {
            const res = await bunRequest("/api/export", {
                method: "GET",
                headers: { Authorization: user.token },
            });
            await expectJsonError(res, 405);
        });
    });
});

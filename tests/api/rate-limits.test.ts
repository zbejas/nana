import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunRequest, expectJsonError, expectStatus, patchJson, readJson } from "../helpers/client";
import { createAdmin, createUser, type TestUser } from "../helpers/factories";

interface RateLimitSettings {
    enabled: boolean;
    apiPerMinute: number;
    otherPerMinute: number;
}

interface RateLimitResponse {
    rateLimits: RateLimitSettings;
    defaults: { apiPerMinute: number; otherPerMinute: number };
    scopes: { api: string[]; other: string[] };
}

const ENDPOINT = "/api/v1/admin/rate-limits";

let admin: TestUser;
let user: TestUser;
let snapshot: RateLimitSettings | null = null;

describe("/api/v1/admin/rate-limits", () => {
    beforeAll(async () => {
        admin = await createAdmin("rate-limit-admin");
        user = await createUser("rate-limit-user");

        const res = await bunRequest(ENDPOINT, { headers: { Authorization: admin.token } });
        await expectStatus(res, 200, "snapshot rate limits");
        snapshot = (await readJson<RateLimitResponse>(res)).rateLimits;
    });

    afterAll(async () => {
        if (!snapshot) return;
        const res = await patchJson(ENDPOINT, snapshot, { Authorization: admin.token });
        await expectStatus(res, 200, "restore rate limits");
    });

    test("requires an admin token", async () => {
        await expectStatus(await bunRequest(ENDPOINT), 401, "missing token");
        await expectStatus(
            await bunRequest(ENDPOINT, { headers: { Authorization: "invalid-token-value" } }),
            401,
            "invalid token",
        );
        await expectStatus(
            await bunRequest(ENDPOINT, { headers: { Authorization: user.token } }),
            403,
            "non-admin token",
        );
    });

    test("returns the settings, defaults, and route scopes", async () => {
        const res = await bunRequest(ENDPOINT, { headers: { Authorization: admin.token } });
        await expectStatus(res, 200);
        const data = await readJson<RateLimitResponse>(res, "rate limits");

        expect(typeof data.rateLimits.enabled).toBe("boolean");
        expect(Number.isInteger(data.rateLimits.apiPerMinute)).toBe(true);
        expect(Number.isInteger(data.rateLimits.otherPerMinute)).toBe(true);
        expect(data.defaults.apiPerMinute).toBeGreaterThan(0);
        expect(data.defaults.otherPerMinute).toBeGreaterThan(0);
        expect(data.scopes.api).toContain("/api/v1/*");
        expect(data.scopes.other).toContain("/mcp");
    });

    test("rejects invalid limits", async () => {
        const invalidBodies = [
            { enabled: false, apiPerMinute: 0, otherPerMinute: 1200 },
            { enabled: false, apiPerMinute: -1, otherPerMinute: 1200 },
            { enabled: false, apiPerMinute: 600.5, otherPerMinute: 1200 },
            { enabled: false, apiPerMinute: 600, otherPerMinute: 1_000_001 },
            { enabled: false, apiPerMinute: 600 },
        ];

        for (const body of invalidBodies) {
            const res = await patchJson(ENDPOINT, body, { Authorization: admin.token });
            await expectStatus(res, 422, `invalid body ${JSON.stringify(body)}`);
        }
    });

    test("rejects a non-admin write", async () => {
        const res = await patchJson(
            ENDPOINT,
            { enabled: false, apiPerMinute: 600, otherPerMinute: 1200 },
            { Authorization: user.token },
        );
        await expectJsonError(res, 403);
    });

    test("persists the config and applies it to the limiter", async () => {
        const next: RateLimitSettings = {
            enabled: true,
            apiPerMinute: 100_000,
            otherPerMinute: 100_000,
        };

        const res = await patchJson(ENDPOINT, next, { Authorization: admin.token });
        await expectStatus(res, 200, "update rate limits");
        const data = await readJson<RateLimitResponse>(res, "updated rate limits");
        expect(data.rateLimits).toEqual(next);

        const read = await bunRequest(ENDPOINT, { headers: { Authorization: admin.token } });
        await expectStatus(read, 200);
        expect((await readJson<RateLimitResponse>(read)).rateLimits).toEqual(next);

        const reload = await bunRequest("/api/admin/rate-limits/reload", {
            method: "POST",
            headers: { Authorization: admin.token },
        });
        await expectStatus(reload, 200);
        const reloadData = await readJson<{
            config: { enabled: boolean; pbMaxPerMinute: number; appMaxPerMinute: number };
        }>(reload);
        expect(reloadData.config).toEqual({
            enabled: true,
            pbMaxPerMinute: next.apiPerMinute,
            appMaxPerMinute: next.otherPerMinute,
        });
    });
});

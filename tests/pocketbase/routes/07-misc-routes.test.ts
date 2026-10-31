import { describe, expect, test } from "bun:test";
import { expectStatus, pbList, pbRequest, readJson } from "../../helpers/client";
import { getSuperuserToken } from "../../helpers/factories";

describe("GET /api/check-users", () => {
    test("is public and returns exactly hasUsers and totalUsers", async () => {
        const res = await pbRequest("/check-users");
        await expectStatus(res, 200);

        const data = await readJson<Record<string, unknown>>(res);
        expect(Object.keys(data).sort()).toEqual(["hasUsers", "totalUsers"]);
        expect(typeof data.hasUsers).toBe("boolean");
        expect(typeof data.totalUsers).toBe("number");
    });

    test("reports a hasUsers flag that matches totalUsers", async () => {
        const data = await readJson<{ hasUsers: boolean; totalUsers: number }>(
            await pbRequest("/check-users"),
        );

        expect(data.hasUsers).toBe(data.totalUsers > 0);
        expect(data.totalUsers).toBeGreaterThanOrEqual(1);
    });

    test("totalUsers matches the real user count", async () => {
        const superuserToken = await getSuperuserToken();
        const users = await pbList<{ id: string }>(superuserToken, "users");

        const data = await readJson<{ totalUsers: number }>(await pbRequest("/check-users"));
        expect(data.totalUsers).toBe(users.totalItems);
    });

    test("does not allow a write method", async () => {
        const res = await pbRequest("/check-users", { method: "POST" });
        expect([404, 405]).toContain(res.status);
    });
});

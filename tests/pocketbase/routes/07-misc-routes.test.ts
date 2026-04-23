import { describe, test, expect } from "bun:test";
import { PB_API } from "../../helpers/setup";

describe("Misc Routes", () => {
    describe("GET /api/check-users", () => {
        const CHECK_USERS_URL = `${PB_API}/check-users`;

        test("returns 200 without any auth header", async () => {
            const res = await fetch(CHECK_USERS_URL);
            expect(res.status).toBe(200);
        });

        test("returns hasUsers: true when users exist", async () => {
            const res = await fetch(CHECK_USERS_URL);
            const data = await res.json();
            expect(data.hasUsers).toBe(true);
        });

        test("returns totalUsers as a number >= 1", async () => {
            const res = await fetch(CHECK_USERS_URL);
            const data = await res.json();
            expect(typeof data.totalUsers).toBe("number");
            expect(data.totalUsers).toBeGreaterThanOrEqual(1);
        });

        test("response has correct shape", async () => {
            const res = await fetch(CHECK_USERS_URL);
            const data = await res.json();
            expect(data).toEqual(
                expect.objectContaining({
                    hasUsers: expect.any(Boolean),
                    totalUsers: expect.any(Number),
                }),
            );
            const keys = Object.keys(data).sort();
            expect(keys).toEqual(["hasUsers", "totalUsers"]);
        });
    });
});

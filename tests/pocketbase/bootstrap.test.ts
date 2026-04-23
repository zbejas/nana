import { describe, test, expect } from "bun:test";
import { existsSync, readFileSync } from "fs";
import {
    PB_API,
    getSuperuserCredentials,
    authenticateSuperuser,
} from "../helpers/setup";

const CREDENTIALS_PATH =
    process.env.PB_CREDENTIALS_PATH || "/app/pocketbase/pb_data/superuser_credentials.json";

describe("PocketBase Bootstrap", () => {
    test("PB health endpoint returns 200", async () => {
        const res = await fetch(`${PB_API}/health`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.code).toBe(200);
    });

    test("check-users endpoint works without auth", async () => {
        const res = await fetch(`${PB_API}/check-users`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data).toHaveProperty("hasUsers");
        expect(typeof data.hasUsers).toBe("boolean");
    });

    test("superuser credentials file exists", () => {
        expect(existsSync(CREDENTIALS_PATH)).toBe(true);
    });

    test("superuser credentials file has valid structure", () => {
        const raw = readFileSync(CREDENTIALS_PATH, "utf-8");
        const creds = JSON.parse(raw);
        expect(creds).toHaveProperty("email");
        expect(creds).toHaveProperty("password");
        expect(typeof creds.email).toBe("string");
        expect(typeof creds.password).toBe("string");
        expect(creds.email.length).toBeGreaterThan(0);
        expect(creds.password.length).toBeGreaterThan(0);
    });

    test("superuser can authenticate with file credentials", async () => {
        const creds = getSuperuserCredentials();
        const res = await fetch(
            `${PB_API}/collections/_superusers/auth-with-password`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ identity: creds.email, password: creds.password }),
            },
        );
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data).toHaveProperty("token");
        expect(typeof data.token).toBe("string");
    });

    test("authenticateSuperuser helper returns valid token", async () => {
        const token = await authenticateSuperuser();
        expect(typeof token).toBe("string");
        expect(token.length).toBeGreaterThan(0);
    });
});

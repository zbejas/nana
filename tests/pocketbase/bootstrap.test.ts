import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { expectStatus, pbRequest, readJson } from "../helpers/client";
import {
    CREDENTIALS_PATH,
    PB_API,
    authenticateSuperuser,
    getSuperuserCredentials,
} from "../helpers/setup";

describe("PocketBase bootstrap", () => {
    test("health endpoint reports a healthy API", async () => {
        const res = await pbRequest("/health");
        await expectStatus(res, 200);
        const data = await readJson<{ code: number }>(res);
        expect(data.code).toBe(200);
    });

    test("check-users is public and returns the documented shape", async () => {
        const res = await pbRequest("/check-users");
        await expectStatus(res, 200);
        const data = await readJson<{ hasUsers: boolean; totalUsers: number }>(res);

        expect(typeof data.hasUsers).toBe("boolean");
        expect(typeof data.totalUsers).toBe("number");
        expect(data.totalUsers).toBeGreaterThanOrEqual(0);
    });

    test("superuser credentials file exists", () => {
        if (process.env.PB_SUPERUSER_EMAIL && process.env.PB_SUPERUSER_PASSWORD) return;
        expect(existsSync(CREDENTIALS_PATH)).toBe(true);
    });

    test("superuser credentials file has a valid structure", () => {
        if (process.env.PB_SUPERUSER_EMAIL && process.env.PB_SUPERUSER_PASSWORD) return;

        const creds = JSON.parse(readFileSync(CREDENTIALS_PATH, "utf-8")) as {
            email?: string;
            password?: string;
        };

        expect(typeof creds.email).toBe("string");
        expect(typeof creds.password).toBe("string");
        expect(creds.email?.length).toBeGreaterThan(0);
        expect(creds.password?.length).toBeGreaterThan(0);
    });

    test("superuser can authenticate with the file credentials", async () => {
        const creds = getSuperuserCredentials();
        const res = await fetch(`${PB_API}/collections/_superusers/auth-with-password`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ identity: creds.email, password: creds.password }),
        });
        await expectStatus(res, 200);
        const data = await readJson<{ token: string }>(res);
        expect(typeof data.token).toBe("string");
        expect(data.token.length).toBeGreaterThan(0);
    });

    test("authenticateSuperuser helper returns a usable token", async () => {
        const token = await authenticateSuperuser();
        expect(token.length).toBeGreaterThan(0);

        const res = await pbRequest("/collections/users/records?perPage=1", {
            headers: { Authorization: token },
        });
        await expectStatus(res, 200);
    });

    test("editor content fields allow notes larger than the 5 MB default", async () => {
        const token = await authenticateSuperuser();
        const collections = [
            "documents",
            "document_versions",
            "trash_documents",
        ];

        for (const name of collections) {
            const res = await pbRequest(`/collections/${name}`, {
                headers: { Authorization: token },
            });
            await expectStatus(res, 200, `read ${name} schema`);

            const collection = await readJson<{
                fields: Array<{ name: string; maxSize?: number }>;
            }>(res);
            const contentField = collection.fields.find((field) => field.name === "content");

            expect(contentField).toBeDefined();
            expect(contentField?.maxSize).toBeGreaterThan(5 * 1024 * 1024);
        }
    });
});

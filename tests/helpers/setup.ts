import { readFileSync } from "fs";

export const BASE_URL = "http://127.0.0.1:3000";
export const PB_API = `${BASE_URL}/pb/api`;

const CREDENTIALS_PATH =
    process.env.PB_CREDENTIALS_PATH || "/app/pocketbase/pb_data/superuser_credentials.json";

/**
 * Poll a URL until it responds with 200, or throw after timeout.
 */
export async function waitForServer(url: string, timeoutMs = 30_000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const res = await fetch(url);
            if (res.ok) return;
        } catch {
            // not ready yet
        }
        await Bun.sleep(500);
    }
    throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

/**
 * Read the superuser credentials file written by bootstrap.js.
 */
export function getSuperuserCredentials(): { email: string; password: string } {
    const raw = readFileSync(CREDENTIALS_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed.email || !parsed.password) {
        throw new Error("Invalid superuser credentials file: missing email or password");
    }
    return { email: parsed.email, password: parsed.password };
}

/**
 * Authenticate as superuser via the PB API and return the auth token.
 */
export async function authenticateSuperuser(): Promise<string> {
    const { email, password } = getSuperuserCredentials();
    const res = await fetch(`${PB_API}/collections/_superusers/auth-with-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: email, password }),
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Superuser auth failed (${res.status}): ${body}`);
    }
    const data = await res.json();
    return data.token;
}

/**
 * Create a test user via the PB API using a superuser token.
 */
export async function createTestUser(
    superuserToken: string,
    opts: {
        email: string;
        password: string;
        name?: string;
        admin?: boolean;
    },
): Promise<{ id: string; email: string; admin: boolean; verified: boolean }> {
    const res = await fetch(`${PB_API}/collections/users/records`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: superuserToken,
        },
        body: JSON.stringify({
            email: opts.email,
            password: opts.password,
            passwordConfirm: opts.password,
            name: opts.name || "",
            admin: opts.admin ?? false,
        }),
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Failed to create user (${res.status}): ${body}`);
    }
    const data = await res.json();
    return { id: data.id, email: data.email, admin: data.admin, verified: data.verified };
}

/**
 * Authenticate a regular user and return the auth token.
 */
export async function authenticateUser(
    email: string,
    password: string,
): Promise<{ token: string; record: { id: string; email: string; admin: boolean; verified: boolean } }> {
    const res = await fetch(`${PB_API}/collections/users/auth-with-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: email, password }),
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`User auth failed (${res.status}): ${body}`);
    }
    const data = await res.json();
    return {
        token: data.token,
        record: {
            id: data.record.id,
            email: data.record.email,
            admin: data.record.admin,
            verified: data.record.verified,
        },
    };
}

/**
 * Create a user via direct signup (POST without superuser token).
 * Returns the response object for status checking.
 */
export async function signupUser(opts: {
    email: string;
    password: string;
    name?: string;
}): Promise<Response> {
    return fetch(`${PB_API}/collections/users/records`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            email: opts.email,
            password: opts.password,
            passwordConfirm: opts.password,
            name: opts.name || "",
        }),
    });
}

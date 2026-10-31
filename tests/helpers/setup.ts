import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, "");

export const BASE_URL = trimTrailingSlash(process.env.TEST_BASE_URL || "http://127.0.0.1:3000");
/** Internal PocketBase origin. Tests use it for fixtures and PB hook/route assertions; the browser never does. */
export const PB_DIRECT_URL = trimTrailingSlash(process.env.POCKETBASE_URL || "http://127.0.0.1:8090");
export const PB_API = `${PB_DIRECT_URL}/api`;
export const PUBLIC_API = `${PB_API}/public`;
/** Public Elysia browser facade. */
export const BROWSER_API = `${BASE_URL}/api/v1`;
export const TEST_PASSWORD = "testPassword123!";

const CONTAINER_CREDENTIALS_PATH = "/app/pocketbase/pb_data/superuser_credentials.json";
const REPO_CREDENTIALS_PATH = resolve(import.meta.dir, "../../pocketbase/pb_data/superuser_credentials.json");

/**
 * Locate the superuser credentials written by bootstrap.js. The container path
 * is preferred; the repository path lets the integration suite run against a
 * host dev stack without extra environment setup.
 */
export const CREDENTIALS_PATH =
    process.env.PB_CREDENTIALS_PATH ||
    (existsSync(CONTAINER_CREDENTIALS_PATH) ? CONTAINER_CREDENTIALS_PATH : REPO_CREDENTIALS_PATH);

export interface SuperuserCredentials {
    email: string;
    password: string;
}

export interface AuthRecord {
    id: string;
    email: string;
    admin: boolean;
    verified: boolean;
}

export interface UserSession {
    token: string;
    record: AuthRecord;
}

/** A short, collision-resistant suffix for fixture names. */
export function uniqueSuffix(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function uniqueEmail(prefix: string): string {
    return `${prefix}-${uniqueSuffix()}@test.local`;
}

/** Authorization header shorthand for a PocketBase user token. */
export function authHeaders(token: string, json = false): Record<string, string> {
    return {
        Authorization: token,
        ...(json ? { "Content-Type": "application/json" } : {}),
    };
}

/**
 * Poll a URL until it responds with 200, or throw after timeout.
 */
export async function waitForServer(url: string, timeoutMs = 30_000): Promise<void> {
    const start = Date.now();
    let lastStatus: number | null = null;
    let lastError: unknown = null;

    while (Date.now() - start < timeoutMs) {
        try {
            const res = await fetch(url);
            if (res.ok) return;
            lastStatus = res.status;
        } catch (error) {
            lastError = error;
        }
        await Bun.sleep(500);
    }

    const detail = lastStatus !== null
        ? `last status ${lastStatus}`
        : `last error ${lastError instanceof Error ? lastError.message : String(lastError)}`;
    throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms (${detail})`);
}

/**
 * Read the superuser credentials file written by bootstrap.js, or the values
 * supplied through PB_SUPERUSER_EMAIL / PB_SUPERUSER_PASSWORD.
 */
export function getSuperuserCredentials(): SuperuserCredentials {
    const envEmail = process.env.PB_SUPERUSER_EMAIL;
    const envPassword = process.env.PB_SUPERUSER_PASSWORD;
    if (envEmail && envPassword) {
        return { email: envEmail, password: envPassword };
    }

    if (!existsSync(CREDENTIALS_PATH)) {
        throw new Error(`Superuser credentials not found at ${CREDENTIALS_PATH}`);
    }

    const raw = readFileSync(CREDENTIALS_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<SuperuserCredentials>;
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
    const data = (await res.json()) as { token: string };
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
        verified?: boolean;
    },
): Promise<AuthRecord> {
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
            ...(opts.verified === undefined ? {} : { verified: opts.verified }),
        }),
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Failed to create user (${res.status}): ${body}`);
    }
    const data = (await res.json()) as AuthRecord;
    return {
        id: data.id,
        email: data.email,
        admin: data.admin,
        verified: data.verified,
    };
}

/**
 * Authenticate a regular user and return the auth token plus public fields.
 */
export async function authenticateUser(email: string, password: string): Promise<UserSession> {
    const res = await fetch(`${PB_API}/collections/users/auth-with-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: email, password }),
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`User auth failed (${res.status}): ${body}`);
    }
    const data = (await res.json()) as { token: string; record: AuthRecord };
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
 * Create a user via direct signup (POST without a superuser token).
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

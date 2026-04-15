import { serverConfig } from "../../lib/config";
import { resolve } from "path";
import { readFileSync, existsSync } from "fs";
import { createLogger } from "../../lib/logger";

const log = createLogger("Superuser");

const POCKETBASE_URL = serverConfig.pocketbaseUrl;

// Cached superuser token
let cachedToken: string | null = null;
let tokenExpiresAt = 0;

interface SuperuserCredentials {
    email: string;
    password: string;
}

/**
 * Resolve superuser credentials from env vars or the auto-generated file.
 * The file is created by PocketBase's bootstrap hook in pb_data/.
 */
function resolveCredentials(): SuperuserCredentials {
    // 1. Check env vars first
    if (serverConfig.pbSuperuserEmail && serverConfig.pbSuperuserPassword) {
        return {
            email: serverConfig.pbSuperuserEmail,
            password: serverConfig.pbSuperuserPassword,
        };
    }

    // 2. Read from auto-generated credentials file
    // Both Docker and local dev use pocketbase/pb_data/ relative to project root
    const candidatePaths = [
        resolve(process.cwd(), "pocketbase/pb_data/superuser_credentials.json"),
        resolve(import.meta.dir, "../../../pocketbase/pb_data/superuser_credentials.json"),
    ];

    for (const candidatePath of candidatePaths) {
        if (existsSync(candidatePath)) {
            try {
                const raw = readFileSync(candidatePath, "utf-8");
                const creds = JSON.parse(raw) as SuperuserCredentials;
                if (creds.email && creds.password) {
                    return creds;
                }
            } catch {
                // Try next path
            }
        }
    }

    throw new Error(
        "No superuser credentials found. " +
        "Either set PB_SUPERUSER_EMAIL/PB_SUPERUSER_PASSWORD env vars, " +
        "or ensure PocketBase has started (it auto-generates credentials on first boot)."
    );
}

/**
 * Authenticate as a PocketBase superuser and return the auth token.
 * Retries up to 5 times with 1s delay to handle startup race conditions
 * where PocketBase may not be ready yet.
 */
async function authenticate(): Promise<{ token: string; expiresAt: number }> {
    const maxRetries = 5;
    const retryDelayMs = 1000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const creds = resolveCredentials();

            const response = await fetch(`${POCKETBASE_URL}/api/collections/_superusers/auth-with-password`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    identity: creds.email,
                    password: creds.password,
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Auth failed (${response.status}): ${errorText}`);
            }

            const data = (await response.json()) as { token?: string };
            if (!data.token) {
                throw new Error("No token in auth response");
            }

            // PocketBase tokens expire in ~14 days by default; refresh after 12 hours
            const expiresAt = Date.now() + 12 * 60 * 60 * 1000;

            return { token: data.token, expiresAt };
        } catch (err) {
            if (attempt < maxRetries) {
                log.warn(`Auth attempt ${attempt}/${maxRetries} failed, retrying in ${retryDelayMs}ms...`);
                await new Promise((r) => setTimeout(r, retryDelayMs));
            } else {
                throw new Error(`Failed to obtain superuser token after ${maxRetries} attempts: ${err}`);
            }
        }
    }

    // Should never reach here, but TypeScript needs it
    throw new Error("Unreachable");
}

/**
 * Get a valid PocketBase superuser token.
 * Caches the token in memory and re-authenticates when expired.
 */
export async function getSuperuserToken(): Promise<string> {
    if (cachedToken && Date.now() < tokenExpiresAt) {
        return cachedToken;
    }

    const { token, expiresAt } = await authenticate();
    cachedToken = token;
    tokenExpiresAt = expiresAt;

    return token;
}

/**
 * Invalidate the cached superuser token (e.g., on a 401 response).
 * The next call to getSuperuserToken() will re-authenticate.
 */
export function invalidateSuperuserToken(): void {
    cachedToken = null;
    tokenExpiresAt = 0;
}

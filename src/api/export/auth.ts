// Re-export shared auth utilities from the common auth module
export { verifyAuth, AuthError } from "../auth";

import { AuthError } from "../auth";
import { serverConfig } from "../../lib/config";

const POCKETBASE_URL = serverConfig.pocketbaseUrl;

/**
 * Get a PocketBase file token for downloading protected attachments.
 * Uses the user's auth token to obtain a short-lived file token.
 */
export async function getFileToken(authHeader: string): Promise<string> {
    const response = await fetch(`${POCKETBASE_URL}/api/files/token`, {
        method: "POST",
        headers: {
            "Authorization": authHeader,
        },
    });

    if (!response.ok) {
        throw new AuthError("Failed to obtain file token", 403);
    }

    const data = (await response.json()) as { token?: string };
    if (!data.token) {
        throw new AuthError("Empty file token response", 500);
    }

    return data.token;
}

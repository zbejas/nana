/** Pure API key token format helpers. No I/O, no auth, no logging. */

const API_KEY_PREFIX = "nana_";
const API_KEY_RANDOM_BYTES = 32;

function base64Url(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A long-lived machine credential. PocketBase session tokens are JWTs. */
export function isApiKeyToken(token: string): boolean {
    return /^nana_[A-Za-z0-9_-]{32,64}$/.test(token);
}

export function generateApiKeyToken(): string {
    const bytes = new Uint8Array(API_KEY_RANDOM_BYTES);
    crypto.getRandomValues(bytes);
    return `${API_KEY_PREFIX}${base64Url(bytes)}`;
}

/** SHA-256 hex. Keys carry 256 bits of entropy, so a fast hash is appropriate. */
export async function hashApiKey(token: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

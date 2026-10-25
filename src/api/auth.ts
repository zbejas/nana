import { serverConfig } from "../lib/config";

const POCKETBASE_URL = serverConfig.pocketbaseUrl;

interface AuthContext {
    userId: string;
    admin: boolean;
}

async function authenticate(req: Request): Promise<AuthContext> {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
        throw new AuthError("Missing Authorization header", 401);
    }

    const response = await fetch(`${POCKETBASE_URL}/api/collections/users/auth-refresh`, {
        method: "POST",
        headers: {
            "Authorization": authHeader,
        },
    });

    if (!response.ok) {
        throw new AuthError("Invalid or expired auth token", 401);
    }

    const data = (await response.json()) as { record?: { id?: string; admin?: boolean } };
    const userId = data.record?.id;

    if (!userId) {
        throw new AuthError("Could not resolve user identity", 401);
    }

    return { userId, admin: data.record?.admin === true };
}

/**
 * Verify the user's PocketBase auth token by calling the built-in auth-refresh endpoint.
 * Returns the authenticated user's ID on success, or throws on failure.
 */
export async function verifyAuth(req: Request): Promise<string> {
    return (await authenticate(req)).userId;
}

/**
 * Verify the caller's token and require the PocketBase admin flag.
 * Returns the authenticated admin's user ID.
 */
export async function verifyAdmin(req: Request): Promise<string> {
    const auth = await authenticate(req);
    if (!auth.admin) {
        throw new AuthError("Admin access required", 403);
    }
    return auth.userId;
}

export class AuthError extends Error {
    status: number;
    constructor(message: string, status: number) {
        super(message);
        this.name = "AuthError";
        this.status = status;
    }
}

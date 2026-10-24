import PocketBase from 'pocketbase';
import { clientConfig } from './config';

// Use proxied PocketBase endpoint through our Bun server
// This eliminates the need to expose port 8090
export const pb = new PocketBase(clientConfig.pocketbaseUrl);

// Clear auth store on 401 responses so the UI redirects to login.
// Checking the token itself (instead of `isValid`) also covers tokens that
// expired locally, which otherwise leave a stale user record in the store.
// When there is no token (e.g. a failed sign-in attempt) this is a no-op.
//
// Pass the token used by the failing request when it is known. A delayed 401
// from an older token must not clear a session that was just established.
export function invalidateAuthOnUnauthorized(status: number, requestToken?: string | null): void {
    if (status !== 401 || !pb.authStore.token) {
        return;
    }

    if (requestToken && requestToken !== pb.authStore.token) {
        return;
    }

    pb.authStore.clear();
}

pb.afterSend = function (
    response: Response,
    data: unknown,
    options?: { headers?: Record<string, string> }
) {
    const header = options?.headers?.Authorization
        ?? options?.headers?.authorization
        ?? null;

    invalidateAuthOnUnauthorized(response.status, header);
    return data;
};

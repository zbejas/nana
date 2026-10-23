import PocketBase from 'pocketbase';
import { clientConfig } from './config';

// Use proxied PocketBase endpoint through our Bun server
// This eliminates the need to expose port 8090
export const pb = new PocketBase(clientConfig.pocketbaseUrl);

// Clear auth store on 401 responses so the UI redirects to login.
// Checking the token itself (instead of `isValid`) also covers tokens that
// expired locally, which otherwise leave a stale user record in the store.
// When there is no token (e.g. a failed sign-in attempt) this is a no-op.
export function invalidateAuthOnUnauthorized(status: number): void {
    if (status === 401 && pb.authStore.token) {
        pb.authStore.clear();
    }
}

pb.afterSend = function (response, data) {
    invalidateAuthOnUnauthorized(response.status);
    return data;
};

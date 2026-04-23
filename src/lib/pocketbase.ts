import PocketBase from 'pocketbase';
import { clientConfig } from './config';

// Use proxied PocketBase endpoint through our Bun server
// This eliminates the need to expose port 8090
export const pb = new PocketBase(clientConfig.pocketbaseUrl);

// Clear auth store on 401 responses so the UI redirects to login.
// Only clear when the store was previously valid to avoid interfering
// with login attempts where 401 is expected.
pb.afterSend = function (response, data) {
    if (response.status === 401 && pb.authStore.isValid) {
        pb.authStore.clear();
    }
    return data;
};

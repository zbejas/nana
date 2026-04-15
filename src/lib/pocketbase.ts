import PocketBase from 'pocketbase';
import { clientConfig } from './config';

// Use proxied PocketBase endpoint through our Bun server
// This eliminates the need to expose port 8090
export const pb = new PocketBase(clientConfig.pocketbaseUrl);

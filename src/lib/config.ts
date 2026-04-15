/**
 * Centralized configuration for environment variables
 * All environment variable access should go through this file
 * 
 * Note: PocketBase migrations use separate environment variables:
 * - MAX_ATTACHMENT_SIZE: Max attachment size in MB (default: 50)
 * - MAX_ATTACHMENTS: Max number of attachments per document (default: 20)
 * These are read via $os.getenv() in PocketBase's JavaScript runtime
 * and cannot be accessed through this config file.
 */

// Check if we're in a server environment
const isServer = typeof process !== 'undefined';

// Server-side configuration (Node.js/Bun)
export const serverConfig = {
    /** Port for the server to listen on */
    port: isServer && process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,

    /** PocketBase backend URL (server-side) */
    pocketbaseUrl: isServer ? (process.env.POCKETBASE_URL || 'http://127.0.0.1:8090') : '',

    /** Use RAM instead of disk for export cache (RAM_CACHE=true) */
    ramCache: isServer && process.env.RAM_CACHE === 'true',

    /** PocketBase superuser email (optional — auto-generated if not set) */
    pbSuperuserEmail: isServer ? (process.env.PB_SUPERUSER_EMAIL || '') : '',

    /** PocketBase superuser password (optional — auto-generated if not set) */
    pbSuperuserPassword: isServer ? (process.env.PB_SUPERUSER_PASSWORD || '') : '',

    /** Check if running in development mode */
    get isDevelopment() {
        return isServer ? process.env.NODE_ENV !== 'production' : false;
    },

    /** Check if running in production mode */
    get isProduction() {
        return isServer ? process.env.NODE_ENV === 'production' : false;
    },
};

// Client-side configuration (browser)
export const clientConfig = {
    /** PocketBase URL for client-side requests (always proxied through /pb) */
    get pocketbaseUrl() {
        if (typeof window !== 'undefined') {
            return `${window.location.origin}/pb`;
        }
        // Fallback for SSR/build time
        return 'http://127.0.0.1:3000/pb';
    },
};

// Export a unified config object
export const config = {
    server: serverConfig,
    client: clientConfig,
};

export default config;

// Allow HMR for config consumers to avoid full-page reloads during dev
if (import.meta.hot) {
    import.meta.hot.accept();
}

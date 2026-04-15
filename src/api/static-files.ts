import { existsSync, statSync } from "fs";
import { resolve } from "path";

/**
 * Handler for serving static files in production
 * Implements SPA fallback routing and blocks source file access
 */
export function createStaticFileHandler(distDir: string) {
    return (req: Request): Response => {
        const url = new URL(req.url);
        let pathname = url.pathname.slice(1) || "index.html";

        // Security: Only serve files from dist/, block all other paths
        // Prevent directory traversal and access to src/, pocketbase/, etc.
        const normalizedPath = resolve(distDir, pathname);
        if (!normalizedPath.startsWith(distDir)) {
            return new Response("Forbidden", { status: 403 });
        }

        let filePath = normalizedPath;

        // Check if the file exists
        if (existsSync(filePath)) {
            // If it's a directory, try to serve index.html from that directory
            const stats = statSync(filePath);
            if (stats.isDirectory()) {
                filePath = resolve(filePath, "index.html");
                // Ensure index.html is still within distDir
                if (!filePath.startsWith(distDir)) {
                    return new Response("Forbidden", { status: 403 });
                }
            }
            return new Response(Bun.file(filePath));
        }

        // Only serve index.html for non-asset routes (SPA fallback)
        // Don't serve index.html for JS, CSS, images, fonts, etc.
        const assetExtensions = ['.js', '.css', '.json', '.webmanifest', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.woff', '.woff2', '.ttf', '.eot', '.ico', '.webp', '.mp4', '.webm'];
        const isAssetRequest = assetExtensions.some(ext => pathname.toLowerCase().endsWith(ext));

        if (isAssetRequest) {
            // Return 404 for missing assets
            return new Response("Not Found", { status: 404 });
        }

        // Fallback to index.html for client-side routing (e.g., /document/xxx)
        return new Response(Bun.file(resolve(distDir, "index.html")));
    };
}

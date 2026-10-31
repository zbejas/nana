/**
 * Stored Markdown may contain file URLs from the old `/pb` proxy. Rewrite them
 * at render time so old notes keep their images and attachment links without
 * reintroducing a public PocketBase route.
 */
export function rewriteLegacyFileUrl(url: string | undefined): string | undefined {
    if (!url) return url;
    return url.replace(/\/pb\/api\/files\//g, "/api/v1/files/");
}

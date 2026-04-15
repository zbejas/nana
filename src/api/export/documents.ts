import { serverConfig } from "../../lib/config";
import type { PBDocument, PBFolder, PBListResponse, ResolvedDocument } from "./types";

const POCKETBASE_URL = serverConfig.pocketbaseUrl;

/**
 * Sanitize a filename by removing invalid characters.
 */
export function sanitizeFilename(name: string): string {
    const normalizedName = (name || "").trim() || "Untitled";
    return normalizedName
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
        .replace(/\s+/g, "_")
        .replace(/\.+$/, "")
        .trim();
}

/**
 * Convert a document to markdown with YAML frontmatter.
 */
export function documentToMarkdown(doc: PBDocument): string {
    const title = (doc.title || "").trim() || "Untitled";
    const frontmatter = [
        "---",
        `title: ${title}`,
        `created: ${new Date(doc.created).toISOString()}`,
        `updated: ${new Date(doc.updated).toISOString()}`,
        doc.tags && doc.tags.length > 0 ? `tags: [${doc.tags.join(", ")}]` : "",
        `published: ${doc.published}`,
        "---",
    ]
        .filter(Boolean)
        .join("\n");

    return `${frontmatter}\n\n${doc.content}`;
}

/**
 * Extract original filename by stripping PocketBase's random suffix.
 * e.g. "photo_a8f3kd2.png" → "photo.png"
 */
export function getOriginalFilename(filename: string): string {
    const match = filename.match(/^(.+?)_[a-zA-Z0-9]+(\.[^.]+)$/);
    if (match && match[1] && match[2]) {
        return match[1] + match[2];
    }
    return filename;
}

// ── PocketBase REST helpers ──────────────────────────────────────────

async function pbFetch<T>(path: string, authHeader: string): Promise<T> {
    const url = `${POCKETBASE_URL}${path}`;
    const res = await fetch(url, {
        headers: { Authorization: authHeader },
    });
    if (!res.ok) {
        throw new Error(`PocketBase request failed: ${res.status} ${res.statusText} – ${url}`);
    }
    return res.json() as Promise<T>;
}

/**
 * Fetch all non-deleted folders for a user.
 */
export async function fetchAllUserFolders(userId: string, authHeader: string): Promise<PBFolder[]> {
    const folders: PBFolder[] = [];
    let page = 1;
    const perPage = 500;

    while (true) {
        const res = await pbFetch<PBListResponse<PBFolder>>(
            `/api/collections/folders/records?filter=${encodeURIComponent(`author="${userId}"`)}&perPage=${perPage}&page=${page}`,
            authHeader,
        );
        folders.push(...res.items);
        if (page >= res.totalPages) break;
        page++;
    }

    return folders;
}

/**
 * Fetch documents matching a PocketBase filter string.
 */
export async function fetchDocuments(filter: string, authHeader: string): Promise<PBDocument[]> {
    const docs: PBDocument[] = [];
    let page = 1;
    const perPage = 500;

    while (true) {
        const res = await pbFetch<PBListResponse<PBDocument>>(
            `/api/collections/documents/records?filter=${encodeURIComponent(filter)}&perPage=${perPage}&page=${page}&sort=-updated`,
            authHeader,
        );
        docs.push(...res.items);
        if (page >= res.totalPages) break;
        page++;
    }

    return docs;
}

/**
 * Recursively collect all subfolder IDs starting from a given folder.
 */
export function getAllSubfolderIds(folderId: string, allFolders: PBFolder[]): string[] {
    const folderIds: string[] = [folderId];

    const childrenMap = new Map<string, string[]>();
    for (const folder of allFolders) {
        if (folder.parent) {
            if (!childrenMap.has(folder.parent)) {
                childrenMap.set(folder.parent, []);
            }
            childrenMap.get(folder.parent)!.push(folder.id);
        }
    }

    const collect = (parentId: string) => {
        const children = childrenMap.get(parentId) || [];
        for (const childId of children) {
            folderIds.push(childId);
            collect(childId);
        }
    };

    collect(folderId);
    return folderIds;
}

/**
 * Build the path string from root to the given folder (e.g. "A/B/C").
 */
export function getFolderPath(folderId: string, allFolders: PBFolder[]): string {
    const folderMap = new Map(allFolders.map((f) => [f.id, f]));
    const path: string[] = [];

    let currentId: string | undefined = folderId;
    while (currentId) {
        const folder = folderMap.get(currentId);
        if (!folder) break;
        path.unshift(sanitizeFilename(folder.name));
        currentId = folder.parent;
    }

    return path.join("/");
}

// ── High-level resolution ────────────────────────────────────────────

/**
 * Given folderIds and documentIds, resolve everything into a flat list of
 * ResolvedDocuments, each carrying its relative folder path within the ZIP.
 *
 * Folder exports preserve their internal hierarchy relative to their own root.
 * Standalone documents sit at the ZIP root.
 */
export async function resolveExportDocuments(options: {
    userId: string;
    authHeader: string;
    documentIds: string[];
    folderIds: string[];
}): Promise<{ resolved: ResolvedDocument[]; allFolders: PBFolder[]; rootFolderNames: Map<string, string> }> {
    const { userId, authHeader, documentIds, folderIds } = options;

    const allFolders = await fetchAllUserFolders(userId, authHeader);
    const folderMap = new Map(allFolders.map((f) => [f.id, f]));

    const resolved: ResolvedDocument[] = [];
    const rootFolderNames = new Map<string, string>();

    // ── Resolve folders (recursive) ─────────────────────────────────
    // Filter out folders whose ancestors are already selected to avoid duplicates
    const selectedSet = new Set(folderIds);
    const rootSelectedFolderIds = folderIds.filter((folderId) => {
        let currentParentId = folderMap.get(folderId)?.parent;
        while (currentParentId) {
            if (selectedSet.has(currentParentId)) return false;
            currentParentId = folderMap.get(currentParentId)?.parent;
        }
        return true;
    });

    for (const folderId of rootSelectedFolderIds) {
        const folder = folderMap.get(folderId);
        if (!folder) continue;

        const rootPrefix = sanitizeFilename(folder.name);
        rootFolderNames.set(folderId, folder.name);

        const subfolderIds = getAllSubfolderIds(folderId, allFolders);
        const folderFilter = subfolderIds.map((id) => `folder="${id}"`).join(" || ");
        const filter = `author="${userId}" && (${folderFilter})`;

        const docs = await fetchDocuments(filter, authHeader);

        const subtreeRootPath = getFolderPath(folderId, allFolders);

        for (const doc of docs) {
            let relativePath = "";
            if (doc.folder) {
                const docFolderPath = getFolderPath(doc.folder, allFolders);
                if (subtreeRootPath && docFolderPath.startsWith(subtreeRootPath)) {
                    relativePath = docFolderPath.substring(subtreeRootPath.length + 1);
                }
            }

            const folderPath = relativePath
                ? `${rootPrefix}/${relativePath}`
                : rootPrefix;

            resolved.push({ doc, folderPath });
        }
    }

    // ── Resolve standalone documents ────────────────────────────────
    // Only fetch documents that haven't already been included via folder expansion
    const alreadyIncludedIds = new Set(resolved.map((r) => r.doc.id));
    const remainingDocIds = documentIds.filter((id) => !alreadyIncludedIds.has(id));

    if (remainingDocIds.length > 0) {
        const docFilter = remainingDocIds.map((id) => `id="${id}"`).join(" || ");
        const filter = `author="${userId}" && (${docFilter})`;
        const docs = await fetchDocuments(filter, authHeader);

        for (const doc of docs) {
            resolved.push({ doc, folderPath: "" });
        }
    }

    return { resolved, allFolders, rootFolderNames };
}

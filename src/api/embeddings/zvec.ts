// ══════════════════════════════════════════════════════════════════════
// Zvec in-process vector database – per-provider collection management
// with user-level isolation via scalar filter on every query.
// ══════════════════════════════════════════════════════════════════════

import {
    ZVecCollectionSchema,
    ZVecCreateAndOpen,
    ZVecOpen,
    ZVecDataType,
    ZVecMetricType,
    ZVecIndexType,
    ZVecInitialize,
    ZVecLogLevel,
    isZVecError,
    type ZVecCollection,
    type ZVecDoc,
    type ZVecDocInput,
} from "@zvec/zvec";
import { join } from "path";
import { mkdirSync, existsSync, rmSync } from "fs";
import type { AIProviderKey } from "../../lib/ai/types";
import { createLogger } from "../../lib/logger";

const log = createLogger("Zvec");

// ── Data directory ───────────────────────────────────────────────────
// Resolves to pocketbase/pb_data/zvec relative to process.cwd().
// Local dev: ./pocketbase/pb_data/zvec
// Docker:    /app/pocketbase/pb_data/zvec  (inside the mounted pb_data volume)

const ZVEC_DATA_DIR = join(process.cwd(), "pocketbase", "pb_data", "zvec");

// ── Initialise Zvec once ─────────────────────────────────────────────
// Use globalThis so the flag survives Bun HMR reloads.

const ZVEC_INIT_KEY = Symbol.for("zvec_initialised");

function ensureInitialised(): void {
    if ((globalThis as any)[ZVEC_INIT_KEY]) return;
    log.info("Initialising Zvec engine");
    ZVecInitialize({ logLevel: ZVecLogLevel.WARN });
    (globalThis as any)[ZVEC_INIT_KEY] = true;
    log.info(`Data directory: ${ZVEC_DATA_DIR}`);
}

// ── Collection cache ─────────────────────────────────────────────────
// Stored on globalThis so the Map survives Bun HMR reloads.
// Without this, a hot-reload drops references to open ZVecCollections
// while the native RocksDB locks are still held, making re-open fail.

const ZVEC_COLLECTIONS_KEY = Symbol.for("zvec_collections");

function getCollectionsMap(): Map<string, ZVecCollection> {
    let map = (globalThis as any)[ZVEC_COLLECTIONS_KEY] as Map<string, ZVecCollection> | undefined;
    if (!map) {
        map = new Map();
        (globalThis as any)[ZVEC_COLLECTIONS_KEY] = map;
    }
    return map;
}

const collections = getCollectionsMap();

// On HMR reload, close stale collections from the previous module instance
// so RocksDB locks are released before we try to re-open.
if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        for (const [key, col] of collections) {
            try {
                col.closeSync();
                log.info(`HMR: closed collection ${key}`);
            } catch { /* ignore – best effort */ }
        }
        collections.clear();
    });
}

function collectionKey(provider: AIProviderKey, dimensions: number): string {
    return `${provider}_${dimensions}`;
}

function collectionPath(provider: AIProviderKey, dimensions: number): string {
    return join(ZVEC_DATA_DIR, collectionKey(provider, dimensions));
}

/**
 * Build the schema for a chunk collection.
 * Fields: documentId (string), chunkIndex (int32), chunkText (string), userId (string)
 * Vector: embedding (fp32, cosine)
 */
function buildSchema(dimensions: number): ZVecCollectionSchema {
    return new ZVecCollectionSchema({
        name: "chunks",
        fields: [
            {
                name: "documentId",
                dataType: ZVecDataType.STRING,
                indexParams: { indexType: ZVecIndexType.INVERT },
            },
            { name: "chunkIndex", dataType: ZVecDataType.INT32 },
            { name: "chunkText", dataType: ZVecDataType.STRING },
            {
                name: "userId",
                dataType: ZVecDataType.STRING,
                indexParams: { indexType: ZVecIndexType.INVERT },
            },
        ],
        vectors: [
            {
                name: "embedding",
                dataType: ZVecDataType.VECTOR_FP32,
                dimension: dimensions,
                indexParams: {
                    indexType: ZVecIndexType.HNSW,
                    metricType: ZVecMetricType.COSINE,
                    m: 32,
                    efConstruction: 200,
                },
            },
        ],
    });
}

// ── Public API ───────────────────────────────────────────────────────

export interface ChunkVector {
    documentId: string;
    chunkIndex: number;
    chunkText: string;
    userId: string;
    vector: number[];
}

/**
 * Get (or lazily open/create) the ZVec collection for a provider + dimension pair.
 */
export function getCollection(provider: AIProviderKey, dimensions: number): ZVecCollection {
    ensureInitialised();

    const key = collectionKey(provider, dimensions);
    const cached = collections.get(key);
    if (cached) return cached;

    const path = collectionPath(provider, dimensions);

    // Ensure parent directories exist
    if (!existsSync(ZVEC_DATA_DIR)) {
        mkdirSync(ZVEC_DATA_DIR, { recursive: true });
    }

    let col: ZVecCollection;

    if (existsSync(path)) {
        // Open existing collection
        try {
            col = ZVecOpen(path, { readOnly: false, enableMMAP: true });

            // Check if the collection has the required inverted indexes.
            // Collections created before the index fix will be missing them,
            // causing filter-based queries (search, delete) to return 0 results.
            const schema = col.schema;
            const userIdField = schema.field("userId");
            const documentIdField = schema.field("documentId");
            const hasUserIdIndex = userIdField?.indexParams?.indexType === ZVecIndexType.INVERT;
            const hasDocumentIdIndex = documentIdField?.indexParams?.indexType === ZVecIndexType.INVERT;

            if (!hasUserIdIndex || !hasDocumentIdIndex) {
                log.warn(
                    `Collection ${key} is missing inverted indexes on scalar fields — recreating. ` +
                    `A full re-embed is required after this.`,
                );
                col.destroySync();
                col = ZVecCreateAndOpen(path, buildSchema(dimensions), {
                    readOnly: false,
                    enableMMAP: true,
                });
                log.info(`Recreated collection with inverted indexes: ${key}`);
            } else {
                log.info(`Opened existing collection: ${key}`);
            }
        } catch (err) {
            // If the error is a lock conflict, the collection is still open
            // from a previous HMR cycle or stale process. Don't try to
            // rmSync (the lock files can't be removed while held).
            const isLockError = err instanceof Error &&
                (err.message.includes("lock") || err.message.includes("Lock"));

            if (isLockError) {
                log.error(`Collection ${key} is locked by another handle — cannot open. ` +
                    `This usually means a previous HMR reload didn't close cleanly. ` +
                    `Try restarting the server.`, err);
                throw err;
            }

            log.warn(`Failed to open collection ${key}, recreating`, err);
            // Non-lock error (corrupted data) — safe to remove and recreate
            rmSync(path, { recursive: true, force: true });
            col = ZVecCreateAndOpen(path, buildSchema(dimensions), {
                readOnly: false,
                enableMMAP: true,
            });
            log.info(`Recreated collection: ${key}`);
        }
    } else {
        // Create new collection
        col = ZVecCreateAndOpen(path, buildSchema(dimensions), {
            readOnly: false,
            enableMMAP: true,
        });
        log.info(`Created new collection: ${key}`);
    }

    collections.set(key, col);
    return col;
}

/**
 * Upsert embedding chunks into the collection.
 * Document ID for each zvec record is a composite: `{documentId}_{chunkIndex}`.
 */
export function upsertChunks(provider: AIProviderKey, dimensions: number, chunks: ChunkVector[]): void {
    if (chunks.length === 0) return;

    const key = collectionKey(provider, dimensions);
    log.debug(`Upserting ${chunks.length} chunk(s) into ${key}`);

    const col = getCollection(provider, dimensions);
    const docs: ZVecDocInput[] = chunks.map((c) => ({
        id: `${c.documentId}_${c.chunkIndex}`,
        fields: {
            documentId: c.documentId,
            chunkIndex: c.chunkIndex,
            chunkText: c.chunkText,
            userId: c.userId,
        },
        vectors: {
            embedding: c.vector,
        },
    }));

    const statuses = col.upsertSync(docs);
    const failures = (Array.isArray(statuses) ? statuses : [statuses]).filter((s) => !s.ok);
    if (failures.length > 0) {
        log.warn(`Upsert into ${key}: ${failures.length}/${chunks.length} failure(s)`, failures.slice(0, 3));
    } else {
        log.debug(`Upserted ${chunks.length} chunk(s) into ${key} (doc: ${chunks[0]?.documentId})`);
    }
}

/**
 * Delete all chunks belonging to a specific document.
 */
export function deleteByDocument(provider: AIProviderKey, dimensions: number, documentId: string): void {
    const key = collectionKey(provider, dimensions);
    log.debug(`Deleting chunks for document ${documentId} from ${key}`);
    try {
        const col = getCollection(provider, dimensions);
        col.deleteByFilterSync(`documentId = "${documentId}"`);
        log.debug(`Deleted chunks for document ${documentId} from ${key}`);
    } catch (err) {
        if (isZVecError(err) && err.code === "ZVEC_NOT_FOUND") return;
        log.error(`Failed to delete chunks for document ${documentId}`, err);
    }
}

/**
 * Delete all chunks belonging to a specific user.
 * Used when re-embedding all documents for a user.
 */
export function deleteByUser(provider: AIProviderKey, dimensions: number, userId: string): void {
    const key = collectionKey(provider, dimensions);
    log.debug(`Deleting all chunks for user ${userId} from ${key}`);
    try {
        const col = getCollection(provider, dimensions);
        col.deleteByFilterSync(`userId = "${userId}"`);
        log.debug(`Deleted all chunks for user ${userId} from ${key}`);
    } catch (err) {
        if (isZVecError(err) && err.code === "ZVEC_NOT_FOUND") return;
        log.error(`Failed to delete chunks for user ${userId}`, err);
    }
}

/**
 * Perform a vector similarity search, scoped to a single user.
 * The userId filter ensures strict user isolation — user A never sees user B's data.
 */
export function search(
    provider: AIProviderKey,
    dimensions: number,
    vector: number[],
    userId: string,
    topk: number,
): ZVecDoc[] {
    const key = collectionKey(provider, dimensions);
    try {
        const col = getCollection(provider, dimensions);
        const results = col.querySync({
            fieldName: "embedding",
            vector,
            topk,
            filter: `userId = "${userId}"`,
        });
        log.debug(`Search ${key}: ${results.length} hit(s), topk=${topk}`);
        return results;
    } catch (err) {
        log.error(`Vector search failed in ${key}`, err);
        return [];
    }
}

/**
 * Perform a vector similarity search scoped to a user AND a specific set of document IDs.
 * Used when the user explicitly attaches documents via # mentions in chat.
 *
 * Zvec only supports single-field filters, so we query with the userId filter
 * (for user isolation) using a higher topk, then post-filter by documentId.
 */
export function searchByDocumentIds(
    provider: AIProviderKey,
    dimensions: number,
    vector: number[],
    userId: string,
    documentIds: string[],
    topk: number,
): ZVecDoc[] {
    const key = collectionKey(provider, dimensions);
    try {
        const col = getCollection(provider, dimensions);
        const docIdSet = new Set(documentIds);
        // Over-fetch to compensate for post-filtering
        const expandedTopk = topk * 10;
        const results = col.querySync({
            fieldName: "embedding",
            vector,
            topk: expandedTopk,
            filter: `userId = "${userId}"`,
        });
        const filtered = results.filter(doc => docIdSet.has(doc.fields.documentId as string)).slice(0, topk);
        log.debug(`SearchByDocIds ${key}: ${results.length} raw → ${filtered.length} filtered, topk=${topk}, docs=${documentIds.length}`);
        return filtered;
    } catch (err) {
        log.error(`Vector search by doc IDs failed in ${key}`, err);
        return [];
    }
}

/**
 * Optimize the collection's internal structures (HNSW graph, inverted indexes).
 * Should be called after bulk upsert operations (e.g., embedAllDocuments).
 */
export function optimize(provider: AIProviderKey, dimensions: number): void {
    const key = collectionKey(provider, dimensions);
    try {
        const col = getCollection(provider, dimensions);
        log.info(`Optimizing collection ${key}`);
        col.optimizeSync();
        log.info(`Optimized collection ${key}`);
    } catch (err) {
        log.error(`Failed to optimize collection ${key}`, err);
    }
}

/**
 * Get collection statistics.
 * Note: docCount is the number of *chunks* stored (each document is split into multiple chunks).
 */
export function getStats(provider: AIProviderKey, dimensions: number): { docCount: number; indexCompleteness: Record<string, number> } {
    const key = collectionKey(provider, dimensions);
    try {
        const col = getCollection(provider, dimensions);
        const { docCount, indexCompleteness } = col.stats;
        log.debug(`Stats for ${key}: ${docCount} chunk(s), index completeness: ${JSON.stringify(indexCompleteness)}`);
        return { docCount, indexCompleteness };
    } catch {
        log.debug(`Stats for ${key}: collection not available, returning 0`);
        return { docCount: 0, indexCompleteness: {} };
    }
}

/**
 * Close all open collections. Call on graceful shutdown.
 */
export function closeAll(): void {
    log.info(`Closing ${collections.size} collection(s)`);
    for (const [key, col] of collections) {
        try {
            col.closeSync();
            log.info(`Closed collection: ${key}`);
        } catch (err) {
            log.error(`Failed to close collection ${key}`, err);
        }
    }
    collections.clear();
}

/**
 * Destroy (permanently delete) a collection from disk.
 */
export function destroyCollection(provider: AIProviderKey, dimensions: number): void {
    const key = collectionKey(provider, dimensions);
    log.info(`Destroying collection ${key}`);
    const cached = collections.get(key);
    if (cached) {
        try {
            cached.destroySync();
        } catch (err) {
            log.error(`Failed to destroy collection ${key}`, err);
        }
        collections.delete(key);
    } else {
        // Not cached — remove directory directly if it exists
        const path = collectionPath(provider, dimensions);
        if (existsSync(path)) {
            rmSync(path, { recursive: true, force: true });
        }
    }
    log.info(`Destroyed collection: ${key}`);
}

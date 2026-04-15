import { embed, embedMany } from "ai";
import { fetchAIConfig } from "../chat/pocketbase";
import { getEmbeddingModel } from "../chat/providers";
import { chunkDocument } from "./chunking";
import * as zvec from "./zvec";
import { fetchEmbeddingConfig } from "./config";
import type { AIConfig, AIProviderKey } from "../../lib/ai/types";
import type { EmbeddingConfig, EmbeddingSearchResult } from "./types";
import { serverConfig } from "../../lib/config";
import { createLogger } from "../../lib/logger";

const log = createLogger("Embeddings");

const POCKETBASE_URL = serverConfig.pocketbaseUrl;

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Fetch a single document from PocketBase by ID using the provided auth.
 */
async function fetchDocument(authHeader: string, documentId: string): Promise<{ id: string; content: string; author: string; title: string; tags: string[] }> {
    const res = await fetch(`${POCKETBASE_URL}/api/collections/documents/records/${encodeURIComponent(documentId)}`, {
        headers: { Authorization: authHeader },
    });
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Failed to fetch document ${documentId}: ${res.status} ${errText}`);
    }
    return res.json() as any;
}

/**
 * Fetch all documents for a user from PocketBase.
 */
async function fetchAllUserDocuments(authHeader: string): Promise<Array<{ id: string; content: string; author: string; title: string; tags: string[] }>> {
    const docs: Array<{ id: string; content: string; author: string; title: string; tags: string[] }> = [];
    let page = 1;
    const perPage = 100;

    while (true) {
        const res = await fetch(
            `${POCKETBASE_URL}/api/collections/documents/records?perPage=${perPage}&page=${page}&fields=id,content,author,title,tags`,
            { headers: { Authorization: authHeader } },
        );
        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Failed to fetch documents page ${page}: ${res.status} ${errText}`);
        }
        const data = (await res.json()) as { items: typeof docs; totalPages: number };
        docs.push(...data.items);
        if (page >= data.totalPages) break;
        page++;
    }

    return docs;
}

// ── Pipeline ─────────────────────────────────────────────────────────

/**
 * Embed a single document: chunk it, generate embedding vectors, and store in zvec.
 * Returns the number of chunks embedded.
 */
export async function embedDocument(
    authHeader: string,
    documentId: string,
    userId: string,
): Promise<number> {
    const [aiConfig, embeddingConfig] = await Promise.all([
        fetchAIConfig(),
        fetchEmbeddingConfig(),
    ]);

    const provider = aiConfig.activeProvider;
    if (!provider) {
        throw new Error("No active AI provider configured.");
    }

    const providerConfig = aiConfig.providers[provider];
    if (!providerConfig.embeddingModel) {
        throw new Error(`No embedding model configured for ${provider}.`);
    }

    const dimensions = embeddingConfig.embeddingDimensions[provider];
    const embeddingModel = getEmbeddingModel(aiConfig);

    // Fetch the document
    const doc = await fetchDocument(authHeader, documentId);

    if (!doc.content || doc.content.trim().length === 0) {
        // No content to embed — remove any existing vectors
        zvec.deleteByDocument(provider, dimensions, documentId);
        return 0;
    }

    // Prepend title and tags as metadata so the embedding captures them
    let textToEmbed = doc.content;
    const metaParts: string[] = [];
    if (doc.title && doc.title.trim()) {
        metaParts.push(`Title: ${doc.title.trim()}`);
    }
    if (doc.tags && doc.tags.length > 0) {
        metaParts.push(`Tags: ${doc.tags.join(", ")}`);
    }
    if (metaParts.length > 0) {
        textToEmbed = metaParts.join("\n") + "\n\n" + textToEmbed;
    }

    // Chunk the document
    const chunks = chunkDocument(
        documentId,
        textToEmbed,
        embeddingConfig.chunkingStrategy,
        embeddingConfig.chunkSize,
        embeddingConfig.chunkOverlap,
    );

    if (chunks.length === 0) {
        zvec.deleteByDocument(provider, dimensions, documentId);
        return 0;
    }

    // Delete existing chunks for this document before re-embedding
    zvec.deleteByDocument(provider, dimensions, documentId);

    // Generate embeddings using embedMany for batch efficiency
    const texts = chunks.map((c) => c.text);
    const { embeddings } = await embedMany({
        model: embeddingModel,
        values: texts,
    });

    // Store in zvec
    const chunkVectors = chunks.map((chunk, i) => ({
        documentId: chunk.documentId,
        chunkIndex: chunk.index,
        chunkText: chunk.text,
        userId,
        vector: embeddings[i] as number[],
    }));

    zvec.upsertChunks(provider, dimensions, chunkVectors);

    return chunks.length;
}

/**
 * Embed all documents for a user. Returns total chunks embedded.
 */
export async function embedAllDocuments(
    authHeader: string,
    userId: string,
): Promise<{ totalChunks: number; totalDocuments: number; errors: string[] }> {
    const [aiConfig, embeddingConfig] = await Promise.all([
        fetchAIConfig(),
        fetchEmbeddingConfig(),
    ]);

    const provider = aiConfig.activeProvider;
    if (!provider) {
        throw new Error("No active AI provider configured.");
    }

    const dimensions = embeddingConfig.embeddingDimensions[provider];

    // Delete all existing embeddings for this user before re-embedding
    zvec.deleteByUser(provider, dimensions, userId);

    const docs = await fetchAllUserDocuments(authHeader);

    let totalChunks = 0;
    const errors: string[] = [];

    for (const doc of docs) {
        try {
            const count = await embedDocument(authHeader, doc.id, userId);
            totalChunks += count;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(`Document "${doc.title}" (${doc.id}): ${msg}`);
            log.error(`Failed to embed document ${doc.id}`, err);
        }
    }

    // Optimize the collection after bulk upsert to rebuild HNSW graph
    // and inverted indexes for best search performance.
    zvec.optimize(provider, dimensions);

    return { totalChunks, totalDocuments: docs.length, errors };
}

/**
 * Perform semantic search across a user's embedded documents.
 */
export async function searchDocuments(
    query: string,
    userId: string,
    topk?: number,
): Promise<EmbeddingSearchResult[]> {
    const [aiConfig, embeddingConfig] = await Promise.all([
        fetchAIConfig(),
        fetchEmbeddingConfig(),
    ]);

    const provider = aiConfig.activeProvider;
    if (!provider) {
        throw new Error("No active AI provider configured.");
    }

    const providerConfig = aiConfig.providers[provider];
    if (!providerConfig.embeddingModel) {
        throw new Error(`No embedding model configured for ${provider}.`);
    }

    const dimensions = embeddingConfig.embeddingDimensions[provider];
    const k = topk ?? embeddingConfig.topk;
    const threshold = embeddingConfig.similarityThreshold ?? 0.65;
    const embeddingModel = getEmbeddingModel(aiConfig);

    // Embed the query
    const { embedding } = await embed({
        model: embeddingModel,
        value: query,
    });

    // Search zvec
    const results = zvec.search(provider, dimensions, embedding, userId, k);

    if (results.length > 0) {
        const scores = results.map(r => r.score);
        const maxScore = Math.max(...scores);
        const minScore = Math.min(...scores);
        log.debug(`Raw scores: ${minScore.toFixed(3)}–${maxScore.toFixed(3)}, threshold: ${threshold}`);
    }

    return results
        .filter((doc) => doc.score >= threshold)
        .map((doc) => ({
            documentId: doc.fields.documentId as string,
            chunkIndex: doc.fields.chunkIndex as number,
            chunkText: doc.fields.chunkText as string,
            score: doc.score,
        }));
}

/**
 * Perform semantic search scoped to specific document IDs (from # mentions).
 * Falls back to fetching raw document content if no embeddings exist yet.
 */
export async function searchDocumentsByIds(
    query: string,
    userId: string,
    authHeader: string,
    documentIds: string[],
    topk?: number,
): Promise<EmbeddingSearchResult[]> {
    let aiConfig: AIConfig;
    let embeddingConfig: EmbeddingConfig;
    try {
        [aiConfig, embeddingConfig] = await Promise.all([
            fetchAIConfig(),
            fetchEmbeddingConfig(),
        ]);
    } catch {
        // AI not configured — fall back to raw content
        return fallbackRawContent(authHeader, documentIds);
    }

    const provider = aiConfig.activeProvider;
    if (!provider) {
        return fallbackRawContent(authHeader, documentIds);
    }

    const providerConfig = aiConfig.providers[provider];
    if (!providerConfig.embeddingModel) {
        return fallbackRawContent(authHeader, documentIds);
    }

    const dimensions = embeddingConfig.embeddingDimensions[provider];
    const k = topk ?? embeddingConfig.topk;
    const threshold = embeddingConfig.similarityThreshold ?? 0.65;

    try {
        const embeddingModel = getEmbeddingModel(aiConfig);
        const { embedding } = await embed({
            model: embeddingModel,
            value: query,
        });

        const results = zvec.searchByDocumentIds(provider, dimensions, embedding, userId, documentIds, k);

        if (results.length > 0) {
            const scores = results.map(r => r.score);
            log.debug(`SearchByDocIds raw scores: ${Math.min(...scores).toFixed(3)}–${Math.max(...scores).toFixed(3)}, threshold: ${threshold}`);
        }

        const filtered = results
            .filter((doc) => doc.score >= threshold)
            .map((doc) => ({
                documentId: doc.fields.documentId as string,
                chunkIndex: doc.fields.chunkIndex as number,
                chunkText: doc.fields.chunkText as string,
                score: doc.score,
            }));

        // If no embedding results (docs not yet embedded), fall back to raw content
        if (filtered.length === 0) {
            log.info("SearchByDocIds: no embedding hits, falling back to raw doc content");
            return fallbackRawContent(authHeader, documentIds);
        }

        return filtered;
    } catch (err) {
        log.warn("SearchByDocIds: embedding search failed, falling back to raw content", err);
        return fallbackRawContent(authHeader, documentIds);
    }
}

/**
 * Fallback: fetch raw document content when embeddings are unavailable.
 * Truncates each document to ~4000 chars to avoid token overflow.
 */
async function fallbackRawContent(
    authHeader: string,
    documentIds: string[],
): Promise<EmbeddingSearchResult[]> {
    const MAX_CHARS = 4000;
    const results: EmbeddingSearchResult[] = [];

    for (const docId of documentIds) {
        try {
            const doc = await fetchDocument(authHeader, docId);
            if (!doc.content || !doc.content.trim()) continue;

            let text = doc.content.trim();
            if (doc.title) text = `Title: ${doc.title}\n\n${text}`;
            if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS) + "…";

            results.push({
                documentId: docId,
                chunkIndex: 0,
                chunkText: text,
                score: 1.0, // explicit attachment — always relevant
            });
        } catch {
            log.warn(`Fallback: could not fetch document ${docId}`);
        }
    }

    return results;
}

/**
 * Delete embeddings for a specific document or all of a user's documents.
 */
export async function deleteEmbeddings(
    userId: string,
    documentId?: string,
): Promise<void> {
    const [aiConfig, embeddingConfig] = await Promise.all([
        fetchAIConfig(),
        fetchEmbeddingConfig(),
    ]);

    const provider = aiConfig.activeProvider;
    if (!provider) return;

    const dimensions = embeddingConfig.embeddingDimensions[provider];

    if (documentId) {
        zvec.deleteByDocument(provider, dimensions, documentId);
    } else {
        zvec.deleteByUser(provider, dimensions, userId);
    }
}

/**
 * Get embedding status/stats for the active provider.
 */
export async function getEmbeddingStatus(): Promise<{
    provider: AIProviderKey | null;
    totalVectors: number;
    embeddingModel: string | null;
    dimensions: number;
}> {
    const [aiConfig, embeddingConfig] = await Promise.all([
        fetchAIConfig(),
        fetchEmbeddingConfig(),
    ]);

    const provider = aiConfig.activeProvider;
    if (!provider) {
        return { provider: null, totalVectors: 0, embeddingModel: null, dimensions: 0 };
    }

    const providerConfig = aiConfig.providers[provider];
    const dimensions = embeddingConfig.embeddingDimensions[provider];

    const stats = zvec.getStats(provider, dimensions);

    return {
        provider,
        totalVectors: stats.docCount,
        embeddingModel: providerConfig.embeddingModel || null,
        dimensions,
    };
}

/**
 * Check if auto-embedding is enabled and a valid embedding model is configured.
 */
export async function shouldAutoEmbed(): Promise<boolean> {
    try {
        const [aiConfig, embeddingConfig] = await Promise.all([
            fetchAIConfig(),
            fetchEmbeddingConfig(),
        ]);

        if (!embeddingConfig.autoEmbed) return false;

        const provider = aiConfig.activeProvider;
        if (!provider) return false;

        const providerConfig = aiConfig.providers[provider];
        return !!providerConfig.embeddingModel;
    } catch {
        return false;
    }
}

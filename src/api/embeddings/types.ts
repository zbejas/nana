import type { AIProviderKey } from "../../lib/ai/types";

// ── Embedding Config (stored in PocketBase settings) ─────────────────

export type ChunkingStrategy = "fixed" | "paragraph" | "sentence";

export interface EmbeddingConfig {
    chunkingStrategy: ChunkingStrategy;
    chunkSize: number;
    chunkOverlap: number;
    topk: number;
    similarityThreshold: number;
    embeddingDimensions: Record<AIProviderKey, number>;
    autoEmbed: boolean;
}

export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
    chunkingStrategy: "paragraph",
    chunkSize: 500,
    chunkOverlap: 50,
    topk: 10,
    similarityThreshold: 0.65,
    embeddingDimensions: {
        openai: 1536,
        google: 768,
        ollama: 768,
    },
    autoEmbed: true,
};

// ── Chunking ─────────────────────────────────────────────────────────

export interface TextChunk {
    text: string;
    index: number;
    documentId: string;
}

// ── Embedding API ────────────────────────────────────────────────────

export interface EmbedRequest {
    documentId: string;
    /** When true, the server checks shouldAutoEmbed() and skips if disabled. */
    auto?: boolean;
}

export interface EmbedAllRequest {
    /** If true, delete existing embeddings before re-embedding */
    force?: boolean;
}

export interface EmbeddingSearchRequest {
    query: string;
    topk?: number;
}

export interface EmbeddingSearchResult {
    documentId: string;
    chunkIndex: number;
    chunkText: string;
    score: number;
}

export interface EmbeddingDeleteRequest {
    documentId?: string;
}

export interface EmbeddingStatusResponse {
    provider: AIProviderKey | null;
    totalVectors: number;
    embeddingModel: string | null;
    dimensions: number;
}

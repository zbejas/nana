import type { ChunkingStrategy, TextChunk } from "./types";

/**
 * Strip markdown formatting to produce plain text for embedding.
 * Removes headers, links, images, code blocks, bold/italic markers, etc.
 */
function stripMarkdown(text: string): string {
    return (
        text
            // Remove code blocks (``` ... ```)
            .replace(/```[\s\S]*?```/g, "")
            // Remove inline code
            .replace(/`([^`]+)`/g, "$1")
            // Remove images ![alt](url)
            .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
            // Remove links [text](url) → text
            .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
            // Remove headers (# ## ### etc.)
            .replace(/^#{1,6}\s+/gm, "")
            // Remove bold/italic markers
            .replace(/(\*{1,3}|_{1,3})(.*?)\1/g, "$2")
            // Remove strikethrough
            .replace(/~~(.*?)~~/g, "$1")
            // Remove blockquotes
            .replace(/^>\s+/gm, "")
            // Remove horizontal rules
            .replace(/^[-*_]{3,}\s*$/gm, "")
            // Remove HTML tags
            .replace(/<[^>]+>/g, "")
            // Collapse multiple blank lines into one
            .replace(/\n{3,}/g, "\n\n")
            .trim()
    );
}

/**
 * Split text using fixed-size character windows with overlap.
 */
function chunkFixed(text: string, chunkSize: number, chunkOverlap: number): string[] {
    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
        const end = Math.min(start + chunkSize, text.length);
        const chunk = text.slice(start, end).trim();
        if (chunk.length > 0) {
            chunks.push(chunk);
        }
        // Move forward by (chunkSize - overlap)
        start += Math.max(chunkSize - chunkOverlap, 1);
    }

    return chunks;
}

/**
 * Split text on paragraph boundaries (double newlines),
 * merging short paragraphs together up to chunkSize.
 */
function chunkParagraph(text: string, chunkSize: number, chunkOverlap: number): string[] {
    const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    const chunks: string[] = [];
    let current = "";

    for (const para of paragraphs) {
        // If adding this paragraph exceeds chunkSize and current is non-empty, flush
        if (current.length > 0 && current.length + para.length + 2 > chunkSize) {
            chunks.push(current.trim());
            // Overlap: take the last `chunkOverlap` characters of the flushed chunk
            if (chunkOverlap > 0 && current.length > chunkOverlap) {
                current = current.slice(-chunkOverlap) + "\n\n" + para;
            } else {
                current = para;
            }
        } else {
            current = current ? current + "\n\n" + para : para;
        }
    }

    if (current.trim().length > 0) {
        chunks.push(current.trim());
    }

    // Handle paragraphs that are individually larger than chunkSize
    const result: string[] = [];
    for (const chunk of chunks) {
        if (chunk.length > chunkSize * 1.5) {
            // Fall back to fixed chunking for oversized paragraphs
            result.push(...chunkFixed(chunk, chunkSize, chunkOverlap));
        } else {
            result.push(chunk);
        }
    }

    return result;
}

/**
 * Split text on sentence boundaries, merging sentences up to chunkSize.
 */
function chunkSentence(text: string, chunkSize: number, chunkOverlap: number): string[] {
    // Split on sentence endings followed by whitespace
    const sentences = text.match(/[^.!?]+[.!?]+[\s]*/g) || [text];
    const chunks: string[] = [];
    let current = "";

    for (const sentence of sentences) {
        if (current.length > 0 && current.length + sentence.length > chunkSize) {
            chunks.push(current.trim());
            if (chunkOverlap > 0 && current.length > chunkOverlap) {
                current = current.slice(-chunkOverlap) + sentence;
            } else {
                current = sentence;
            }
        } else {
            current += sentence;
        }
    }

    if (current.trim().length > 0) {
        chunks.push(current.trim());
    }

    return chunks;
}

/**
 * Chunk a document's content into text segments suitable for embedding.
 *
 * 1. Strips markdown formatting
 * 2. Splits text according to the chosen strategy
 * 3. Returns chunks with their index and source document ID
 */
export function chunkDocument(
    documentId: string,
    content: string,
    strategy: ChunkingStrategy,
    chunkSize: number,
    chunkOverlap: number,
): TextChunk[] {
    const plainText = stripMarkdown(content);

    if (plainText.length === 0) {
        return [];
    }

    let rawChunks: string[];

    switch (strategy) {
        case "fixed":
            rawChunks = chunkFixed(plainText, chunkSize, chunkOverlap);
            break;
        case "paragraph":
            rawChunks = chunkParagraph(plainText, chunkSize, chunkOverlap);
            break;
        case "sentence":
            rawChunks = chunkSentence(plainText, chunkSize, chunkOverlap);
            break;
        default:
            rawChunks = chunkParagraph(plainText, chunkSize, chunkOverlap);
    }

    return rawChunks.map((text, index) => ({
        text,
        index,
        documentId,
    }));
}

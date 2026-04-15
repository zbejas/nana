import { streamText, generateText } from "ai";
import { verifyAuth, AuthError } from "../auth";
import { getAIModel } from "./providers";
import { fetchAIConfig, createConversation, appendMessage, getConversationMessages, listConversations, getConversation, deleteConversation, updateConversationTitle } from "./pocketbase";
import { searchDocumentsByIds } from "../embeddings/pipeline";
import type { ChatSendRequest, ChatMessage, ChatSource } from "./types";
import { createLogger } from "../../lib/logger";
import { serverConfig } from "../../lib/config";

const log = createLogger("Chat");
const POCKETBASE_URL = serverConfig.pocketbaseUrl;

/**
 * Fetch document titles for a list of document IDs.
 * Best-effort — returns whatever titles it can resolve.
 */
async function fetchDocTitles(authHeader: string, docIds: string[]): Promise<ChatSource[]> {
    const sources: ChatSource[] = [];
    for (const id of docIds) {
        try {
            const res = await fetch(
                `${POCKETBASE_URL}/api/collections/documents/records/${encodeURIComponent(id)}?fields=id,title`,
                { headers: { Authorization: authHeader } },
            );
            if (res.ok) {
                const doc = (await res.json()) as { id: string; title: string };
                sources.push({ id: doc.id, title: doc.title });
            }
        } catch {
            // Skip documents we can't fetch
        }
    }
    return sources;
}

/**
 * JSON error response helper.
 */
function jsonError(message: string, status: number): Response {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

/**
 * JSON success response helper.
 */
function jsonOk(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

/**
 * Main chat API handler.
 * Dispatches based on method + URL path:
 *
 *   POST   /api/chat/send                → Stream AI response
 *   GET    /api/chat/conversations        → List conversations
 *   GET    /api/chat/conversations/{id}   → Get messages for a conversation
 *   DELETE /api/chat/conversations/{id}   → Delete a conversation
 */
export async function handleChat(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    // ── Auth ─────────────────────────────────────────────────────────
    let _userId: string;
    try {
        _userId = await verifyAuth(req);
    } catch (err) {
        const status = err instanceof AuthError ? err.status : 401;
        const message = err instanceof Error ? err.message : "Authentication failed";
        return jsonError(message, status);
    }

    const authHeader = req.headers.get("Authorization")!;

    try {
        // ── POST /api/chat/send ──────────────────────────────────────
        if (path === "/api/chat/send" && req.method === "POST") {
            return await handleSend(req, authHeader, _userId);
        }

        // ── GET /api/chat/conversations ──────────────────────────────
        if (path === "/api/chat/conversations" && req.method === "GET") {
            const conversations = await listConversations(authHeader);
            return jsonOk(conversations);
        }

        // ── GET /api/chat/conversations/{id} ─────────────────────────
        if (path.startsWith("/api/chat/conversations/") && req.method === "GET") {
            const conversationId = path.slice("/api/chat/conversations/".length);
            if (!conversationId) return jsonError("Missing conversation ID", 400);

            const conversation = await getConversation(authHeader, conversationId);

            return jsonOk({
                conversation,
                messages: conversation.messages || [],
            });
        }

        // ── DELETE /api/chat/conversations/{id} ──────────────────────
        if (path.startsWith("/api/chat/conversations/") && req.method === "DELETE") {
            const conversationId = path.slice("/api/chat/conversations/".length);
            if (!conversationId) return jsonError("Missing conversation ID", 400);

            await deleteConversation(authHeader, conversationId);
            return new Response(null, { status: 204 });
        }

        return jsonError("Not found", 404);
    } catch (err) {
        log.error("Chat API error", err);
        const message = err instanceof Error ? err.message : "Internal server error";
        return jsonError(message, 500);
    }
}

/**
 * Handle POST /api/chat/send
 *
 * Body: { conversationId?: string, message: string }
 *
 * If conversationId is provided, appends to that conversation.
 * Otherwise creates a new conversation (title auto-generated from message).
 *
 * Returns an SSE stream using the Vercel AI SDK data stream protocol.
 */
async function handleSend(req: Request, authHeader: string, userId: string): Promise<Response> {
    // ── Parse body ───────────────────────────────────────────────────
    let body: ChatSendRequest;
    try {
        body = (await req.json()) as ChatSendRequest;
    } catch {
        return jsonError("Invalid JSON body", 400);
    }

    if (!body.message || typeof body.message !== "string" || !body.message.trim()) {
        return jsonError("Message is required", 400);
    }

    const userMessage = body.message.trim();
    log.info(`Send request: convId=${body.conversationId ?? "(new)"}, msgLen=${userMessage.length}`);

    // ── Fetch AI config ──────────────────────────────────────────────
    let model;
    let generationParams: { temperature?: number; maxTokens?: number; topP?: number } = {};
    try {
        const aiConfig = await fetchAIConfig();
        model = getAIModel(aiConfig);
        log.debug(`Using AI provider: ${aiConfig.activeProvider}, model: ${aiConfig.providers[aiConfig.activeProvider!]?.activeModel}`);

        // Extract generation parameters from the active provider config
        const providerConfig = aiConfig.providers[aiConfig.activeProvider!];
        if (providerConfig.temperature != null) generationParams.temperature = providerConfig.temperature;
        if (providerConfig.maxTokens != null) generationParams.maxTokens = providerConfig.maxTokens;
        if (providerConfig.topP != null) generationParams.topP = providerConfig.topP;
    } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load AI configuration";
        return jsonError(message, 503);
    }

    // ── Get or create conversation ───────────────────────────────────
    let conversationId = body.conversationId;
    let isNewConversation = false;

    if (!conversationId) {
        // Auto-generate title from first ~60 chars of the message
        const title = userMessage.length > 60
            ? userMessage.slice(0, 57) + "..."
            : userMessage;

        const conversation = await createConversation(authHeader, title, [
            { role: "user", content: userMessage },
        ]);
        conversationId = conversation.id;
        isNewConversation = true;
    } else {
        // Append user message to existing conversation
        await appendMessage(authHeader, conversationId, {
            role: "user",
            content: userMessage,
        });
    }

    // ── Build message history for the AI model ───────────────────────
    let messages: ChatMessage[];

    if (isNewConversation) {
        messages = [{ role: "user", content: userMessage }];
    } else {
        messages = await getConversationMessages(authHeader, conversationId);
    }

    // ── RAG: retrieve relevant document context ──────────────────────
    const hasExplicitDocs = Array.isArray(body.documentIds) && body.documentIds.length > 0;
    let ragContext = "";
    let ragSources: ChatSource[] = [];

    if (hasExplicitDocs) {
        // Explicit document IDs from # mentions — search only within those docs
        try {
            const searchResults = await searchDocumentsByIds(userMessage, userId, authHeader, body.documentIds!);
            if (searchResults.length > 0) {
                const uniqueDocs = new Set(searchResults.map(r => r.documentId)).size;
                const topScore = searchResults.reduce((max, r) => Math.max(max, r.score), 0);
                const lowScore = searchResults.reduce((min, r) => Math.min(min, r.score), 1);
                log.info(`RAG (explicit): ${searchResults.length} chunk(s) from ${uniqueDocs} doc(s), scores ${lowScore.toFixed(3)}–${topScore.toFixed(3)}`);

                const uniqueDocIds = [...new Set(searchResults.map(r => r.documentId))];
                ragSources = await fetchDocTitles(authHeader, uniqueDocIds);

                const contextParts = searchResults.map(
                    (r, i) => `[${i + 1}] ${r.chunkText}`
                );
                ragContext =
                    "Relevant context from the user's documents:\n\n" +
                    contextParts.join("\n\n") +
                    "\n\n---\n\nUse the above context to inform your response when relevant. " +
                    "If the context isn't relevant to the question, you may ignore it.";
            } else {
                log.info("RAG (explicit): no relevant chunks found from specified documents");
            }
        } catch (err) {
            log.warn("RAG (explicit): search failed, proceeding without context", err);
        }
    } else {
        log.info("RAG: no documents attached");
    }

    // NOTE: Automatic RAG via vector search across all documents is disabled.
    // To re-enable, check `body.useRag !== false` and call `searchDocuments(userMessage, userId)`.

    // ── Stream AI response ───────────────────────────────────────────
    const finalConversationId = conversationId;

    const result = streamText({
        model,
        ...(ragContext ? { system: ragContext } : {}),
        ...generationParams,
        messages,
        onFinish: async ({ text }) => {
            log.info(`AI response complete: convId=${finalConversationId}, replyLen=${text.length}`);
            // Persist the assistant's complete response into the conversation
            try {
                await appendMessage(authHeader, finalConversationId, {
                    role: "assistant",
                    content: text,
                    ...(ragSources.length > 0 ? { sources: ragSources } : {}),
                });
            } catch (err) {
                log.error("Failed to save assistant message", err);
            }

            // Generate a smart title for new conversations after the first response
            if (isNewConversation) {
                generateConversationTitle(model, userMessage, text, authHeader, finalConversationId);
            }
        },
    });

    // Return a streaming response with the conversation ID in a custom header
    // (title generation runs in the background via onFinish)
    const response = result.toTextStreamResponse();

    // Clone the response to add our custom header
    const headers = new Headers(response.headers);
    headers.set("X-Conversation-Id", finalConversationId);
    headers.set("X-Is-New-Conversation", isNewConversation ? "true" : "false");
    if (ragSources.length > 0) {
        headers.set("X-RAG-Sources", JSON.stringify(ragSources));
    }

    return new Response(response.body, {
        status: response.status,
        headers,
    });
}

/**
 * Fire-and-forget: ask the AI to generate a short title (emoji + name)
 * for a conversation based on the first user message and assistant reply,
 * then update the conversation record in PocketBase.
 */
async function generateConversationTitle(
    model: Parameters<typeof generateText>[0]["model"],
    userMessage: string,
    assistantReply: string,
    authHeader: string,
    conversationId: string
): Promise<void> {
    try {
        const { text: title } = await generateText({
            model,
            messages: [
                {
                    role: "system",
                    content:
                        "Generate a short title for the following conversation. " +
                        "The title MUST start with a single relevant emoji, followed by a space and a concise descriptive name (max 5 words). " +
                        "Output ONLY the title — no quotes, no extra text.\n\n" +
                        "Examples:\n" +
                        "📊 Sales Report Analysis\n" +
                        "🐛 Fix Login Bug\n" +
                        "✈️ Trip to Japan Planning",
                },
                { role: "user", content: userMessage },
                { role: "assistant", content: assistantReply },
                { role: "user", content: "Now generate the title for the conversation above." },
            ],
        });

        const cleaned = title.trim().replace(/^["']|["']$/g, "");
        if (cleaned) {
            await updateConversationTitle(authHeader, conversationId, cleaned);
        }
    } catch (err) {
        log.error("Failed to generate conversation title", err);
    }
}

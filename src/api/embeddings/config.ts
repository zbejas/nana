import { serverConfig } from "../../lib/config";
import { getSuperuserToken, invalidateSuperuserToken } from "../chat/superuser";
import type { EmbeddingConfig } from "./types";
import { DEFAULT_EMBEDDING_CONFIG } from "./types";

const POCKETBASE_URL = serverConfig.pocketbaseUrl;

/**
 * Fetch the embedding configuration from the admin-only settings collection.
 * Uses the auto-provisioned superuser token.
 */
export async function fetchEmbeddingConfig(): Promise<EmbeddingConfig> {
    const token = await getSuperuserToken();

    try {
        return await fetchEmbeddingConfigWithToken(token);
    } catch (err) {
        // If 401/403, invalidate cached token and retry once
        if (err instanceof Error && (err.message.includes("401") || err.message.includes("403"))) {
            invalidateSuperuserToken();
            const freshToken = await getSuperuserToken();
            return await fetchEmbeddingConfigWithToken(freshToken);
        }
        throw err;
    }
}

async function fetchEmbeddingConfigWithToken(token: string): Promise<EmbeddingConfig> {
    const response = await fetch(
        `${POCKETBASE_URL}/api/collections/settings/records?filter=key="embedding_config"&perPage=1`,
        {
            headers: {
                "Content-Type": "application/json",
                Authorization: token,
            },
        },
    );

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to fetch embedding config: ${response.status} ${errText}`);
    }

    const data = (await response.json()) as { items: Array<{ value: EmbeddingConfig }> };
    const item = data.items[0];

    if (!item) {
        // Return defaults if the setting doesn't exist yet
        return structuredClone(DEFAULT_EMBEDDING_CONFIG);
    }

    // Merge with defaults to ensure all fields are present
    return {
        ...DEFAULT_EMBEDDING_CONFIG,
        ...item.value,
        embeddingDimensions: {
            ...DEFAULT_EMBEDDING_CONFIG.embeddingDimensions,
            ...(item.value.embeddingDimensions ?? {}),
        },
    };
}

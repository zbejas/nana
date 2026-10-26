import type {
    ApiKeyAccess,
    ApiKeyDto,
    ApiKeyScope,
} from "../api/api-keys/types";
import { pb } from "./pocketbase";

/**
 * Client-side API key management.
 *
 * Key management always uses the signed-in PocketBase session. A key itself
 * cannot list, create, or revoke keys.
 */

export interface CreateApiKeyRequest {
    name: string;
    access: ApiKeyAccess;
    scope: ApiKeyScope;
    folderIds?: string[];
}

export interface CreatedApiKeyResponse {
    token: string;
    apiKey: ApiKeyDto;
}

function headers(json = false): Record<string, string> {
    return {
        ...(json ? { "Content-Type": "application/json" } : {}),
        Authorization: pb.authStore.token,
    };
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    return body?.error || `${fallback} (${response.status})`;
}

export async function listApiKeys(): Promise<ApiKeyDto[]> {
    const response = await fetch("/api/v1/api-keys", { headers: headers() });
    if (!response.ok) {
        throw new Error(await errorMessage(response, "Could not load API keys"));
    }
    return response.json() as Promise<ApiKeyDto[]>;
}

export async function createApiKey(input: CreateApiKeyRequest): Promise<CreatedApiKeyResponse> {
    const response = await fetch("/api/v1/api-keys", {
        method: "POST",
        headers: headers(true),
        body: JSON.stringify(input),
    });
    if (!response.ok) {
        throw new Error(await errorMessage(response, "Could not create the API key"));
    }
    return response.json() as Promise<CreatedApiKeyResponse>;
}

export async function revokeApiKey(id: string): Promise<void> {
    const response = await fetch(`/api/v1/api-keys/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: headers(),
    });
    if (!response.ok) {
        throw new Error(await errorMessage(response, "Could not revoke the API key"));
    }
}

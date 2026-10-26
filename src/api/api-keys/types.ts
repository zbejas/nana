/** Shared API key values used by the store, REST routes, MCP, and the SPA. */

export const API_KEY_ACCESS_VALUES = ["read", "write"] as const;
export type ApiKeyAccess = (typeof API_KEY_ACCESS_VALUES)[number];

/**
 * `workspace` covers the root and every folder; `root` covers only records with
 * no folder; `folders` covers the selected folders and their descendants.
 */
export const API_KEY_SCOPE_VALUES = ["workspace", "root", "folders"] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPE_VALUES)[number];

export interface ApiKeyPermission {
    /** The `api_keys` record id. */
    id: string;
    access: ApiKeyAccess;
    scope: ApiKeyScope;
    /** Selected folder roots when `scope` is `folders`; empty otherwise. */
    folderIds: string[];
}

export interface ApiKeyFolderDto {
    id: string;
    name: string;
}

/** Key metadata safe to return to the owner. Never includes the hash or secret. */
export interface ApiKeyDto {
    id: string;
    name: string;
    /** Display prefix such as `nana_a1b2c3d4e5`. */
    prefix: string;
    access: ApiKeyAccess;
    scope: ApiKeyScope;
    folders: ApiKeyFolderDto[];
    lastUsedAt: string | null;
    createdAt: string;
}

export interface CreateApiKeyInput {
    name: string;
    access: ApiKeyAccess;
    scope: ApiKeyScope;
    folderIds?: string[];
}

export interface CreatedApiKey {
    /** The plaintext secret. Returned once and never stored. */
    token: string;
    apiKey: ApiKeyDto;
}

export function isApiKeyAccess(value: unknown): value is ApiKeyAccess {
    return typeof value === "string" && (API_KEY_ACCESS_VALUES as readonly string[]).includes(value);
}

export function isApiKeyScope(value: unknown): value is ApiKeyScope {
    return typeof value === "string" && (API_KEY_SCOPE_VALUES as readonly string[]).includes(value);
}

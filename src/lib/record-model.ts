/**
 * Minimal record shape shared by the browser data layer and UI types.
 *
 * PocketBase records include the system fields below plus collection-specific
 * fields. The index signature stays permissive so existing UI interfaces can
 * extend this without importing the PocketBase SDK.
 */
export interface RecordModel {
    id: string;
    collectionId?: string;
    collectionName?: string;
    created?: string;
    updated?: string;
    expand?: Record<string, unknown>;
    [key: string]: any;
}

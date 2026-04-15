import { existsSync, mkdirSync, rmSync } from "fs";
import { resolve } from "path";
import { serverConfig } from "../../lib/config";

const CACHE_BASE = resolve(import.meta.dir, "../../../cache/export");

/**
 * Whether to cache in RAM instead of disk.
 * Controlled by the RAM_CACHE=true environment variable.
 */
const useRamCache = serverConfig.ramCache;

/** In-memory store keyed by requestId → path → data */
const ramStore = new Map<string, Map<string, Uint8Array>>();

/**
 * Create an isolated cache context for a single export request.
 * Returns helpers to write, read, and clean up files.
 */
export function createExportCache(requestId: string) {
    const diskDir = resolve(CACHE_BASE, requestId);

    if (useRamCache) {
        ramStore.set(requestId, new Map());
    } else {
        mkdirSync(diskDir, { recursive: true });
    }

    return {
        /**
         * Write data to the cache under a relative key (e.g. "doc-id/image.png").
         */
        async write(key: string, data: Uint8Array): Promise<void> {
            if (useRamCache) {
                ramStore.get(requestId)!.set(key, data);
            } else {
                const filePath = resolve(diskDir, key);
                const dir = resolve(filePath, "..");
                mkdirSync(dir, { recursive: true });
                await Bun.write(filePath, data);
            }
        },

        /**
         * Read data from the cache by key.
         */
        async read(key: string): Promise<Uint8Array> {
            if (useRamCache) {
                const data = ramStore.get(requestId)?.get(key);
                if (!data) throw new Error(`Cache miss: ${key}`);
                return data;
            }
            const filePath = resolve(diskDir, key);
            const file = Bun.file(filePath);
            return new Uint8Array(await file.arrayBuffer());
        },

        /**
         * Clean up all cached data for this request (disk or RAM).
         */
        cleanup(): void {
            if (useRamCache) {
                ramStore.delete(requestId);
            } else {
                if (existsSync(diskDir)) {
                    rmSync(diskDir, { recursive: true, force: true });
                }
                // Clean up the base dir if empty
                try {
                    if (existsSync(CACHE_BASE)) {
                        const remaining = Bun.file(CACHE_BASE);
                        // rmSync only if the export base is now empty
                        const entries = require("fs").readdirSync(CACHE_BASE);
                        if (entries.length === 0) {
                            rmSync(CACHE_BASE, { recursive: true, force: true });
                        }
                    }
                } catch {
                    // Ignore cleanup errors for the base dir
                }
            }
        },
    };
}

export type ExportCache = ReturnType<typeof createExportCache>;

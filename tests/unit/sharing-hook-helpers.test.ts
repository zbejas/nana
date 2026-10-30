import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The sharing lifecycle helper must not swallow a failed grant rebuild. A
 * privacy/folder transition runs inside a transaction, so a rebuild error has
 * to reach `runInTransaction` and roll the write back instead of leaving stale
 * access behind.
 */

function loadHelpers(access: Record<string, unknown>) {
    const source = readFileSync(
        join(import.meta.dir, "../../pocketbase/pb_hooks/sharing/hook_helpers.js"),
        "utf-8",
    );
    const module = { exports: {} as Record<string, unknown> };
    const app = {
        runInTransaction(fn: (txApp: unknown) => void) {
            const txApp = { id: "tx" };
            fn(txApp);
            return txApp;
        },
    };
    const fn = new Function(
        "__hooks",
        "require",
        "module",
        "exports",
        "$app",
        "console",
        source,
    );
    fn(
        "/hooks",
        () => access,
        module,
        module.exports,
        app,
        { error() {}, log() {} },
    );
    return module.exports as {
        syncTarget: (type: string, id: string, app?: unknown) => void;
        syncFolder: (id: string, app?: unknown) => void;
        runWithRebuild: (event: unknown, rebuild: (app: unknown) => void) => void;
    };
}

describe("sharing hook helpers", () => {
    test("propagates a failed grant rebuild", () => {
        const helpers = loadHelpers({
            syncResourceSharing() {
                throw new Error("forced rebuild failure");
            },
            syncFolderSubtree() {
                throw new Error("forced folder rebuild failure");
            },
        });

        expect(() => helpers.syncTarget("board", "board1")).toThrow("forced rebuild failure");
        expect(() => helpers.syncFolder("folder1")).toThrow("forced folder rebuild failure");
    });

    test("runs the save and rebuild in one transaction and rethrows", () => {
        const helpers = loadHelpers({});
        const calls: string[] = [];
        const event = {
            app: { id: "request" },
            next() {
                calls.push("next");
            },
        };

        expect(() =>
            helpers.runWithRebuild(event, () => {
                calls.push("rebuild");
                throw new Error("rollback");
            }),
        ).toThrow("rollback");
        expect(calls).toEqual(["next", "rebuild"]);
        expect((event.app as { id: string }).id).toBe("request");
    });
});

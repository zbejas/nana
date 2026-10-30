import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readdirSync,
    rmSync,
} from "node:fs";
import { join, resolve } from "node:path";

/**
 * Migration-level checks against a disposable PocketBase database.
 *
 * The Docker suite starts PocketBase from an empty database, so runtime tests
 * never exercise the upgrade path (a database with pre-0025 rows) or the
 * migration rollbacks. This file copies the repo migrations into a temp
 * directory, applies the pre-kanban prefix, inserts a fixture with raw SQL, and
 * then applies the remaining migrations. No server or port is used.
 */

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const SOURCE_MIGRATIONS = join(REPO_ROOT, "pocketbase/pb_migrations");
const PB_BIN = Bun.which("pocketbase") ?? "/usr/local/bin/pocketbase";

const BOARD_ID = "migboard0000001";
const DONE_TASK_ID = "migtaskdone0001";
const PLANNED_TASK_ID = "migtaskplan0001";
const OWNER_ID = "miguserowner001";
const VIEWER_ID = "miguserviewer01";
const FOLDER_ID = "migfolder000001";
const DOCUMENT_ID = "migdocument0001";

function migrationsUpTo(limit: number): string[] {
    return readdirSync(SOURCE_MIGRATIONS)
        .filter((name) => /^\d{7}_.*\.js$/.test(name))
        .filter((name) => Number(name.slice(0, 7)) <= limit)
        .sort();
}

describe("kanban migrations", () => {
    let root: string;
    let dataDir: string;
    let migrationsDir: string;
    let hooksDir: string;

    function copyMigrations(limit = Number.POSITIVE_INFINITY): void {
        for (const name of migrationsUpTo(limit)) {
            copyFileSync(join(SOURCE_MIGRATIONS, name), join(migrationsDir, name));
        }
    }

    async function migrate(...args: string[]): Promise<void> {
        const proc = Bun.spawn(
            [
                PB_BIN,
                "migrate",
                ...args,
                "--dir",
                dataDir,
                "--hooksDir",
                hooksDir,
                "--migrationsDir",
                migrationsDir,
            ],
            {
                env: { ...process.env, PB_MIGRATING: "1" },
                stdin: args[0] === "down" ? "pipe" : "ignore",
                stdout: "pipe",
                stderr: "pipe",
            },
        );
        if (args[0] === "down" && proc.stdin) {
            proc.stdin.write("y\n");
            proc.stdin.end();
        }
        const [stdout, stderr, code] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
        ]);
        if (code !== 0) {
            throw new Error(`pocketbase migrate ${args.join(" ")} failed (${code})\n${stdout}\n${stderr}`);
        }
    }

    function query<T>(db: Database, sql: string, params: unknown[] = []): T[] {
        return db.query(sql).all(...(params as never[])) as T[];
    }

    /** Number of applied migrations at or above a version, for head-agnostic rollbacks. */
    function appliedAtOrAbove(version: number): number {
        const db = new Database(join(dataDir, "data.db"));
        const applied = query<{ file: string }>(db, "SELECT file FROM _migrations").map((row) => row.file);
        db.close();
        return applied.filter((name) => /^\d{7}_/.test(name) && Number(name.slice(0, 7)) >= version).length;
    }

    beforeAll(async () => {
        if (!existsSync(PB_BIN)) {
            throw new Error(`PocketBase binary not found at ${PB_BIN}`);
        }
        root = join("/tmp", `nana-migrations-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
        dataDir = join(root, "data");
        migrationsDir = join(root, "migrations");
        hooksDir = join(root, "hooks");
        mkdirSync(dataDir, { recursive: true });
        mkdirSync(migrationsDir, { recursive: true });
        mkdirSync(hooksDir, { recursive: true });

        copyMigrations(24);
        await migrate("up");

        const fixture = new Database(join(dataDir, "data.db"));
        fixture.run(
            `INSERT INTO boards
             (id, created, updated, name, description, author, archived, folder, is_private, is_public, public_share_token, public_expires_at)
             VALUES (?, ?, ?, ?, ?, ?, 0, '', 0, 0, '', '')`,
            [BOARD_ID, "2024-01-01 00:00:00.000Z", "2024-01-02 00:00:00.000Z", "Migration board", "", OWNER_ID],
        );
        fixture.run(
            `INSERT INTO tasks
             (id, created, updated, title, description, status, priority, due_date, board_order, labels, document, board)
             VALUES (?, ?, ?, ?, ?, ?, '', '', 0, '[]', '', ?)`,
            [DONE_TASK_ID, "2024-01-01 00:00:00.000Z", "2024-02-01 00:00:00.000Z", "Done task", "", "done", BOARD_ID],
        );
        fixture.run(
            `INSERT INTO tasks
             (id, created, updated, title, description, status, priority, due_date, board_order, labels, document, board)
             VALUES (?, ?, ?, ?, ?, ?, '', '', 1, '[]', '', ?)`,
            [PLANNED_TASK_ID, "2024-01-01 00:00:00.000Z", "2024-02-02 00:00:00.000Z", "Planned task", "", "planned", BOARD_ID],
        );
        fixture.close();

        copyMigrations();
        await migrate("up");

        // Simulate a partial seed plus a reserved virtual slug, then run the
        // 0028 repair again (down/up) so the suite starts from repaired data.
        const broken = new Database(join(dataDir, "data.db"));
        broken.run("DELETE FROM board_columns WHERE board = ? AND slug = 'next'", [BOARD_ID]);
        broken.run(
            `INSERT INTO board_columns (id, board, name, slug, position, icon, color, is_final, created, updated)
             VALUES ('migcolumnplan01', ?, 'Planned', 'planned', 9, '', '', 0, '2024-01-01 00:00:00.000Z', '2024-01-01 00:00:00.000Z')`,
            [BOARD_ID],
        );
        broken.close();

        await migrate("down", String(appliedAtOrAbove(28)));
        await migrate("up");
    }, 120_000);

    afterAll(() => {
        if (root) rmSync(root, { recursive: true, force: true });
    });

    test("upgrades a pre-kanban board with preserved task timestamps", async () => {
        const read = new Database(join(dataDir, "data.db"));
        const columns = query<{ slug: string }>(read, "SELECT slug FROM board_columns WHERE board = ? ORDER BY position", [BOARD_ID]);
        expect(columns.map((column) => column.slug)).toEqual(["backlog", "next", "progress", "done", "planned-column"]);

        const done = query<{ task_number: number; completed_at: string; updated: string }>(
            read,
            "SELECT task_number, completed_at, updated FROM tasks WHERE id = ?",
            [DONE_TASK_ID],
        )[0]!;
        expect(done.task_number).toBe(1);
        expect(done.completed_at).toBe("2024-02-01 00:00:00.000Z");
        expect(done.updated).toBe("2024-02-01 00:00:00.000Z");

        const planned = query<{ status: string; task_number: number; completed_at: string }>(
            read,
            "SELECT status, task_number, completed_at FROM tasks WHERE id = ?",
            [PLANNED_TASK_ID],
        )[0]!;
        expect(planned.status).toBe("planned-column");
        expect(planned.task_number).toBe(2);
        expect(planned.completed_at).toBe("");
        read.close();
    }, 120_000);

    test("0026 down rebuilds inherited grants before restoring legacy rules", async () => {
        const db = new Database(join(dataDir, "data.db"));
        const now = "2024-03-01 00:00:00.000Z";
        for (const id of [OWNER_ID, VIEWER_ID]) {
            db.run(
                `INSERT OR IGNORE INTO users
                 (id, created, updated, email, password, tokenKey, verified, emailVisibility, name, avatar, admin)
                 VALUES (?, ?, ?, ?, 'x', ?, 1, 0, ?, '', 0)`,
                [id, now, now, `${id}@migration.test`, (id + "a".repeat(50)).slice(0, 50), id],
            );
        }
        db.run(
            `INSERT INTO folders (id, created, updated, name, author, color, parent, is_private, is_public, public_share_token, public_expires_at, share_attachments, deleted_at, deleted_by)
             VALUES (?, ?, ?, 'Shared folder', ?, '', '', 0, 0, '', '', 0, '', '')`,
            [FOLDER_ID, now, now, OWNER_ID],
        );
        db.run(
            `INSERT INTO documents (id, created, updated, title, slug, content, author, folder, is_private, is_public, public_share_token, public_expires_at, share_attachments, deleted_at, deleted_by)
             VALUES (?, ?, ?, 'Shared doc', 'shared-doc', '# body', ?, ?, 0, 0, '', '', 0, '', '')`,
            [DOCUMENT_ID, now, now, OWNER_ID, FOLDER_ID],
        );
        db.run(
            `INSERT INTO shares (id, created, updated, folder, user, shared_by, permission, level)
             VALUES ('migshare0000001', ?, ?, ?, ?, ?, 'view', 1)`,
            [now, now, FOLDER_ID, VIEWER_ID, OWNER_ID],
        );
        const userCount = query<{ count: number }>(db, "SELECT COUNT(*) AS count FROM users WHERE id IN (?, ?)", [OWNER_ID, VIEWER_ID])[0]!;
        expect(userCount.count).toBe(2);
        db.close();

        // Re-run 0026 up so the share is materialized, then roll it back.
        await migrate("down", String(appliedAtOrAbove(26)));
        await migrate("up");

        const up = new Database(join(dataDir, "data.db"));
        expect(
            query<{ count: number }>(up, "SELECT COUNT(*) AS count FROM access_grants WHERE document = ?", [DOCUMENT_ID])[0]!.count,
        ).toBeGreaterThan(0);
        up.close();

        await migrate("down", String(appliedAtOrAbove(26)));
        const down = new Database(join(dataDir, "data.db"));
        expect(
            query<{ count: number }>(down, "SELECT COUNT(*) AS count FROM access_grants WHERE document = ?", [DOCUMENT_ID])[0]!.count,
        ).toBeGreaterThan(0);
        down.close();
    }, 120_000);

    test("a failed grant rebuild rolls back the privacy change", async () => {
        // A disposable server lets us remove the grant collection and force the
        // post-save rebuild to fail. The request must not leave the board
        // private with stale grants; the transaction rolls the write back.
        const liveRoot = join(root, "fail-rebuild");
        const liveData = join(liveRoot, "data");
        const liveMigrations = join(liveRoot, "migrations");
        mkdirSync(liveData, { recursive: true });
        mkdirSync(liveMigrations, { recursive: true });
        for (const name of migrationsUpTo(Number.POSITIVE_INFINITY)) {
            copyFileSync(join(SOURCE_MIGRATIONS, name), join(liveMigrations, name));
        }
        const port = 19000 + Math.floor(Math.random() * 800);
        const base = `http://127.0.0.1:${port}/api`;
        const proc = Bun.spawn(
            [
                PB_BIN,
                "serve",
                `--http=127.0.0.1:${port}`,
                "--dir",
                liveData,
                "--hooksDir",
                join(REPO_ROOT, "pocketbase/pb_hooks"),
                "--migrationsDir",
                liveMigrations,
            ],
            {
                env: {
                    ...process.env,
                    PB_SUPERUSER_EMAIL: "fail-rebuild@test.local",
                    PB_SUPERUSER_PASSWORD: "testpass123",
                    PB_DATA_DIR: liveData,
                    PB_MIGRATING: "",
                },
                stdin: "ignore",
                stdout: "ignore",
                stderr: "ignore",
            },
        );

        const api = async (
            method: string,
            path: string,
            body?: unknown,
            token?: string,
        ): Promise<{ status: number; data: Record<string, unknown> | null }> => {
            const res = await fetch(`${base}${path}`, {
                method,
                headers: {
                    "Content-Type": "application/json",
                    ...(token ? { Authorization: token } : {}),
                },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            });
            const text = await res.text();
            return { status: res.status, data: text ? JSON.parse(text) : null };
        };

        try {
            let ready = false;
            for (let i = 0; i < 80; i++) {
                try {
                    const res = await fetch(`${base}/health`);
                    if (res.ok) {
                        ready = true;
                        break;
                    }
                } catch (_) {}
                await Bun.sleep(250);
            }
            expect(ready).toBe(true);

            const su = await api("POST", "/collections/_superusers/auth-with-password", {
                identity: "fail-rebuild@test.local",
                password: "testpass123",
            });
            expect(su.status).toBe(200);
            const superToken = String(su.data!.token);

            const created = await api("POST", "/collections/users/records", {
                email: "fail-rebuild-user@test.local",
                password: "testpass123",
                passwordConfirm: "testpass123",
                name: "Fail rebuild",
                verified: true,
            }, superToken);
            expect(created.status).toBe(200);
            const userId = String(created.data!.id);

            const session = await api("POST", "/collections/users/auth-with-password", {
                identity: "fail-rebuild-user@test.local",
                password: "testpass123",
            });
            expect(session.status).toBe(200);
            const userToken = String(session.data!.token);

            const board = await api("POST", "/collections/boards/records", {
                name: "Failure board",
                author: userId,
            }, userToken);
            expect(board.status).toBe(200);
            const boardId = String(board.data!.id);

            const removed = await api("DELETE", "/collections/access_grants", undefined, superToken);
            expect(removed.status).toBe(204);

            const failed = await api("PATCH", `/collections/boards/records/${boardId}`, {
                is_private: true,
            }, userToken);
            expect(failed.status).not.toBe(200);

            const after = await api("GET", `/collections/boards/records/${boardId}`, undefined, superToken);
            expect(after.status).toBe(200);
            expect(after.data!.is_private).toBe(false);
        } finally {
            proc.kill();
            await proc.exited;
        }
    }, 120_000);

    test("0025 down drops the comments task index before the column", async () => {
        // Revert 0028..0025 only. 0023/0024 and the comments collection must
        // still exist, otherwise the index/column removal is not exercised.
        await migrate("down", String(appliedAtOrAbove(25)));

        const after = new Database(join(dataDir, "data.db"));
        const collections = query<{ name: string }>(after, "SELECT name FROM _collections").map((row) => row.name);
        expect(collections).toContain("comments");
        const columns = query<{ name: string }>(after, "PRAGMA table_info('comments')").map((column) => column.name);
        expect(columns).not.toContain("task");
        after.close();
    }, 120_000);
});

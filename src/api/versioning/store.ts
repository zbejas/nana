import { mkdir, rm, stat } from "node:fs/promises";
import { devNull } from "node:os";
import { resolve } from "node:path";
import type {
    CommitResult,
    NoteSnapshot,
    VersionDetail,
    VersionEntry,
    VersionMetadata,
    VersionPage,
} from "./types";

/**
 * One bare git repository per note.
 *
 * The repository is an implementation detail: callers only see opaque commit
 * ids, chronological version numbers, and Markdown bodies. Every command uses
 * an argument array (never a shell string), and every path is built from a
 * validated note id.
 */

const NOTE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const COMMIT_ID_PATTERN = /^[0-9a-f]{40}$/;
const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 100;

const UTF8 = new TextEncoder();
const TEXT = new TextDecoder("utf-8", { ignoreBOM: true });

export interface GitVersionStoreOptions {
    /** Override the git executable for tests or unusual installations. */
    gitBinary?: string;
    /** Injectable clock; commits still use the real current time by default. */
    now?: () => Date;
}

interface GitResult {
    stdout: Uint8Array;
    stderr: string;
    exitCode: number;
}

interface GitRunOptions {
    input?: Uint8Array;
    allowExitCodes?: number[];
}

export function isNoteId(value: string): boolean {
    return NOTE_ID_PATTERN.test(value);
}

export function isVersionId(value: string): boolean {
    return COMMIT_ID_PATTERN.test(value);
}

export function normalizePagination(page: number, perPage: number): { page: number; perPage: number } {
    const safePage = Number.isFinite(page) ? Math.max(1, Math.trunc(page)) : 1;
    const safePerPage = Number.isFinite(perPage)
        ? Math.min(MAX_PER_PAGE, Math.max(1, Math.trunc(perPage)))
        : DEFAULT_PER_PAGE;
    return { page: safePage, perPage: safePerPage };
}

function metadataDocument(metadata: VersionMetadata): string {
    // Object literal order is the stable field order used for comparison.
    const canonical = {
        title: typeof metadata.title === "string" ? metadata.title : "",
        tags: Array.isArray(metadata.tags) ? metadata.tags.map((tag) => String(tag)) : [],
        folder: typeof metadata.folder === "string" ? metadata.folder : "",
        is_private: metadata.is_private === true,
    };
    return `${JSON.stringify(canonical, null, 2)}\n`;
}

function parseMetadata(text: string): VersionMetadata {
    try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        return {
            title: typeof parsed.title === "string" ? parsed.title : "",
            tags: Array.isArray(parsed.tags) ? parsed.tags.map((tag) => String(tag)) : [],
            folder: typeof parsed.folder === "string" ? parsed.folder : "",
            is_private: parsed.is_private === true,
        };
    } catch {
        return { title: "", tags: [], folder: "", is_private: false };
    }
}

function text(stdout: Uint8Array): string {
    return TEXT.decode(stdout);
}

function splitCommitLine(line: string): { id: string; date: string; subject: string } | null {
    const first = line.indexOf("\x1f");
    const second = line.indexOf("\x1f", first + 1);
    if (first <= 0 || second < 0) return null;

    const id = line.slice(0, first);
    if (!COMMIT_ID_PATTERN.test(id)) return null;

    return {
        id,
        date: line.slice(first + 1, second),
        subject: line.slice(second + 1),
    };
}

export class GitVersionStore {
    private readonly root: string;
    private readonly gitBinary: string;
    private readonly now: () => Date;

    constructor(root: string, options: GitVersionStoreOptions = {}) {
        if (!root.trim()) throw new Error("A versioning directory is required.");
        this.root = resolve(root);
        this.gitBinary = options.gitBinary ?? "git";
        this.now = options.now ?? (() => new Date());
    }

    /** Absolute path to a note's bare repository. */
    pathFor(noteId: string): string {
        if (!isNoteId(noteId)) throw new Error("Invalid note id.");
        return resolve(this.root, `${noteId}.git`);
    }

    async hasRepo(noteId: string): Promise<boolean> {
        try {
            const info = await stat(this.pathFor(noteId));
            return info.isDirectory();
        } catch {
            return false;
        }
    }

    /**
     * Commit the current note state.
     *
     * A tree hash equal to HEAD's tree means the body and metadata are
     * byte-for-byte identical, so no commit is created.
     */
    async commit(noteId: string, snapshot: NoteSnapshot, summary: string): Promise<CommitResult> {
        const repo = await this.ensureRepo(noteId);
        const head = await this.headCommit(repo);
        const tree = await this.writeTree(repo, snapshot);

        if (head) {
            const headTree = text((await this.repoGit(repo, ["rev-parse", `${head}^{tree}`])).stdout).trim();
            if (headTree === tree) {
                return {
                    created: false,
                    version: await this.entryFor(repo, noteId, head),
                };
            }
        }

        const commitArgs = ["commit-tree", tree];
        if (head) commitArgs.push("-p", head);
        commitArgs.push("-m", summary);
        const commit = text((await this.repoGit(repo, commitArgs)).stdout).trim();
        if (!COMMIT_ID_PATTERN.test(commit)) throw new Error("Git did not return a valid commit id.");

        if (head) {
            await this.repoGit(repo, ["update-ref", "refs/heads/main", commit, head]);
        } else {
            await this.repoGit(repo, ["update-ref", "refs/heads/main", commit]);
        }

        return {
            created: true,
            version: await this.entryFor(repo, noteId, commit),
        };
    }

    /** Newest-first paginated history. A note without commits has an empty page. */
    async listVersions(noteId: string, page: number, perPage: number): Promise<VersionPage> {
        const pagination = normalizePagination(page, perPage);
        const repo = this.pathFor(noteId);
        if (!(await this.hasRepo(noteId))) {
            return emptyPage(pagination.page, pagination.perPage);
        }

        const head = await this.headCommit(repo);
        if (!head) return emptyPage(pagination.page, pagination.perPage);

        const totalItems = await this.countCommits(repo);
        if (totalItems === 0) return emptyPage(pagination.page, pagination.perPage);
        const totalPages = Math.ceil(totalItems / pagination.perPage);

        const offset = (pagination.page - 1) * pagination.perPage;
        if (offset >= totalItems) {
            return {
                items: [],
                page: pagination.page,
                perPage: pagination.perPage,
                totalItems,
                totalPages,
            };
        }

        const output = text((await this.repoGit(repo, [
            "log",
            "refs/heads/main",
            "--format=%H%x1f%cI%x1f%s",
            `--skip=${offset}`,
            `--max-count=${pagination.perPage}`,
        ])).stdout);

        const items: VersionEntry[] = [];
        for (const line of output.split("\n")) {
            if (!line) continue;
            const parsed = splitCommitLine(line);
            if (!parsed) continue;
            items.push({
                id: parsed.id,
                document: noteId,
                version_number: totalItems - (offset + items.length),
                change_summary: parsed.subject,
                source_created_at: parsed.date,
                created: parsed.date,
            });
        }

        return {
            items,
            page: pagination.page,
            perPage: pagination.perPage,
            totalItems,
            totalPages,
        };
    }

    /** Read one committed version, or null when it is not reachable from HEAD. */
    async getVersion(noteId: string, versionId: string): Promise<VersionDetail | null> {
        if (!isVersionId(versionId)) return null;
        if (!(await this.hasRepo(noteId))) return null;

        const repo = this.pathFor(noteId);
        const head = await this.headCommit(repo);
        if (!head) return null;

        const ancestor = await this.repoGit(
            repo,
            ["merge-base", "--is-ancestor", versionId, "refs/heads/main"],
            { allowExitCodes: [1, 128] },
        );
        if (ancestor.exitCode !== 0) return null;

        const totalItems = await this.countCommits(repo);
        const after = Number.parseInt(text((await this.repoGit(repo, [
            "rev-list",
            "--count",
            `${versionId}..refs/heads/main`,
        ])).stdout).trim(), 10);
        const versionNumber = totalItems - (Number.isFinite(after) ? after : 0);

        const entry = await this.entryFor(repo, noteId, versionId, versionNumber);
        const content = text((await this.repoGit(repo, [
            "cat-file",
            "blob",
            `${versionId}:content.md`,
        ])).stdout);

        let metadata: VersionMetadata = { title: "", tags: [], folder: "", is_private: false };
        try {
            const stored = text((await this.repoGit(repo, [
                "cat-file",
                "blob",
                `${versionId}:metadata.json`,
            ])).stdout);
            metadata = parseMetadata(stored);
        } catch {
            // A version still has a body even if an old commit lacks metadata.
        }

        return { ...entry, content, metadata };
    }

    /** Remove a note's repository. Missing repositories are a no-op. */
    async deleteRepo(noteId: string): Promise<void> {
        await rm(this.pathFor(noteId), { recursive: true, force: true });
    }

    private async ensureRepo(noteId: string): Promise<string> {
        const repo = this.pathFor(noteId);
        if (await this.hasRepo(noteId)) return repo;

        await mkdir(this.root, { recursive: true });
        await this.exec(["init", "--bare", "--quiet", repo]);
        await this.repoGit(repo, ["symbolic-ref", "HEAD", "refs/heads/main"]);
        return repo;
    }

    private async writeTree(repo: string, snapshot: NoteSnapshot): Promise<string> {
        const contentSha = text((await this.repoGit(
            repo,
            ["hash-object", "-w", "--stdin"],
            { input: UTF8.encode(snapshot.content) },
        )).stdout).trim();
        const metadataSha = text((await this.repoGit(
            repo,
            ["hash-object", "-w", "--stdin"],
            { input: UTF8.encode(metadataDocument(snapshot.metadata)) },
        )).stdout).trim();

        if (!COMMIT_ID_PATTERN.test(contentSha) || !COMMIT_ID_PATTERN.test(metadataSha)) {
            throw new Error("Git did not return valid blob ids.");
        }

        const entries = [
            `100644 blob ${contentSha}\tcontent.md`,
            `100644 blob ${metadataSha}\tmetadata.json`,
            "",
        ].join("\n");
        const tree = text((await this.repoGit(
            repo,
            ["mktree"],
            { input: UTF8.encode(entries) },
        )).stdout).trim();
        if (!COMMIT_ID_PATTERN.test(tree)) throw new Error("Git did not return a valid tree id.");
        return tree;
    }

    private async entryFor(
        repo: string,
        noteId: string,
        commit: string,
        versionNumber?: number,
    ): Promise<VersionEntry> {
        const resolvedNumber = versionNumber ?? await this.countCommits(repo);
        const output = text((await this.repoGit(repo, [
            "show",
            "-s",
            "--format=%cI%x1f%s",
            commit,
        ])).stdout).replace(/\n+$/, "");
        const separator = output.indexOf("\x1f");
        const date = separator >= 0 ? output.slice(0, separator) : "";
        const subject = separator >= 0 ? output.slice(separator + 1) : "";

        return {
            id: commit,
            document: noteId,
            version_number: resolvedNumber,
            change_summary: subject,
            source_created_at: date,
            created: date,
        };
    }

    private async countCommits(repo: string): Promise<number> {
        const output = text((await this.repoGit(repo, [
            "rev-list",
            "--count",
            "refs/heads/main",
        ])).stdout).trim();
        const count = Number.parseInt(output, 10);
        return Number.isFinite(count) && count > 0 ? count : 0;
    }

    private async headCommit(repo: string): Promise<string | null> {
        const result = await this.repoGit(
            repo,
            ["rev-parse", "--verify", "--quiet", "refs/heads/main^{commit}"],
            { allowExitCodes: [1, 128] },
        );
        if (result.exitCode !== 0) return null;

        const commit = text(result.stdout).trim();
        return COMMIT_ID_PATTERN.test(commit) ? commit : null;
    }

    private repoGit(repo: string, args: string[], options: GitRunOptions = {}): Promise<GitResult> {
        return this.exec(["--git-dir", repo, ...args], options);
    }

    private async exec(args: string[], options: GitRunOptions = {}): Promise<GitResult> {
        const stamp = this.now().toISOString();
        const env: Record<string, string | undefined> = {
            ...process.env,
            GIT_AUTHOR_NAME: "Nana",
            GIT_AUTHOR_EMAIL: "nana@local",
            GIT_COMMITTER_NAME: "Nana",
            GIT_COMMITTER_EMAIL: "nana@local",
            GIT_AUTHOR_DATE: stamp,
            GIT_COMMITTER_DATE: stamp,
            GIT_CONFIG_GLOBAL: devNull,
            GIT_CONFIG_SYSTEM: devNull,
            GIT_DEFAULT_HASH: "sha1",
            GIT_TERMINAL_PROMPT: "0",
            GIT_PAGER: "cat",
            LC_ALL: "C",
        };

        const proc = Bun.spawn({
            cmd: [this.gitBinary, ...args],
            env,
            stdin: options.input ?? "ignore",
            stdout: "pipe",
            stderr: "pipe",
        });

        const [stdout, stderr, exitCode] = await Promise.all([
            new Response(proc.stdout).arrayBuffer(),
            new Response(proc.stderr).text(),
            proc.exited,
        ]);

        const allowed = [0, ...(options.allowExitCodes ?? [])];
        if (!allowed.includes(exitCode)) {
            throw new Error(`Git command failed (${args[0] ?? "git"}, exit ${exitCode}): ${stderr.trim()}`);
        }

        return { stdout: new Uint8Array(stdout), stderr, exitCode };
    }
}

function emptyPage(page: number, perPage: number): VersionPage {
    return { items: [], page, perPage, totalItems: 0, totalPages: 0 };
}

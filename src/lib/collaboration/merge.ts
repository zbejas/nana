/**
 * Small three-way text merge used when a save loses the revision race.
 *
 * Live editing already converges through Yjs. This fallback matters when the
 * note changed outside the live room (another tab, MCP, or an AI edit): keep
 * both sides' line changes, and prefer the local side where they overlap.
 */
import { minimalTextChange } from "./text";

const MAX_DP_CELLS = 400_000;

interface Hunk {
    start: number;
    end: number;
    lines: string[];
}

function splitLines(value: string): string[] {
    return value.split("\n");
}

function diffHunks(base: string[], next: string[]): Hunk[] {
    const n = base.length;
    const m = next.length;
    if (n * m > MAX_DP_CELLS) {
        return [{ start: 0, end: n, lines: next }];
    }

    const width = m + 1;
    const dp = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i -= 1) {
        for (let j = m - 1; j >= 0; j -= 1) {
            dp[i * width + j] = base[i] === next[j]
                ? dp[(i + 1) * width + j + 1]! + 1
                : Math.max(dp[(i + 1) * width + j]!, dp[i * width + j + 1]!);
        }
    }

    const hunks: Hunk[] = [];
    let i = 0;
    let j = 0;
    let open: Hunk | null = null;
    const close = () => {
        if (!open) return;
        hunks.push(open);
        open = null;
    };

    while (i < n || j < m) {
        if (i < n && j < m && base[i] === next[j]) {
            close();
            i += 1;
            j += 1;
            continue;
        }
        const right = j < m ? dp[i * width + j + 1]! : -1;
        const down = i < n ? dp[(i + 1) * width + j]! : -1;
        if (!open) open = { start: i, end: i, lines: [] };
        if (j < m && (i === n || right > down)) {
            open.lines.push(next[j]!);
            j += 1;
        } else {
            i += 1;
        }
        open.end = i;
    }
    close();
    return hunks;
}

function overlaps(left: Hunk, right: Hunk): boolean {
    return left.start < right.end && right.start < left.end;
}

function applyHunks(base: string[], hunks: Hunk[]): string[] {
    const out: string[] = [];
    let cursor = 0;
    for (const hunk of [...hunks].sort((left, right) => left.start - right.start)) {
        out.push(...base.slice(cursor, hunk.start));
        out.push(...hunk.lines);
        cursor = Math.max(cursor, hunk.end);
    }
    out.push(...base.slice(cursor));
    return out;
}

/**
 * Merge `local` and `remote` relative to their common `base`.
 *
 * Non-overlapping line edits are kept from both sides. When both sides changed
 * the same base lines, the local replacement wins rather than silently dropping
 * the writer's draft.
 */
export function mergeConcurrentMarkdown(base: string, local: string, remote: string): string {
    if (local === remote || remote === base) return local;
    if (local === base) return remote;

    const baseLines = splitLines(base);
    const localHunks = diffHunks(baseLines, splitLines(local));
    const remoteHunks = diffHunks(baseLines, splitLines(remote));
    if (localHunks.length === 0) return remote;
    if (remoteHunks.length === 0) return local;

    const merged = [...localHunks];
    for (const remoteHunk of remoteHunks) {
        if (merged.some((localHunk) => overlaps(localHunk, remoteHunk))) continue;
        merged.push(remoteHunk);
    }
    return applyHunks(baseLines, merged).join("\n");
}

/** True when a save used a revision that another writer already advanced. */
export function isRevisionConflict(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const candidate = error as { status?: unknown; message?: unknown; data?: { message?: unknown } };
    if (candidate.status !== 400 && candidate.status !== 409) return false;
    const message = typeof candidate.message === "string"
        ? candidate.message
        : typeof candidate.data?.message === "string"
            ? candidate.data.message
            : "";
    return /changed since it was loaded/i.test(message);
}

/** Apply the live-merge path only when both sides actually moved. */
export function needsConcurrentMerge(base: string, local: string, remote: string): boolean {
    const localChange = minimalTextChange(base, local);
    const remoteChange = minimalTextChange(base, remote);
    return Boolean(localChange && remoteChange);
}

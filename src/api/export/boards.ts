import { serverConfig } from "../../lib/config";
import { sanitizeFilename } from "./documents";
import type { PBBoard, PBBoardColumn, PBListResponse, PBTask } from "./types";

const POCKETBASE_URL = serverConfig.pocketbaseUrl;

async function pbFetch<T>(path: string, authHeader: string): Promise<T> {
    const url = `${POCKETBASE_URL}${path}`;
    const response = await fetch(url, {
        headers: { Authorization: authHeader },
    });
    if (!response.ok) {
        throw new Error(`PocketBase request failed: ${response.status} ${response.statusText} – ${url}`);
    }
    return response.json() as Promise<T>;
}

async function fetchAll<T>(path: string, authHeader: string): Promise<T[]> {
    const items: T[] = [];
    let page = 1;
    const perPage = 500;

    while (true) {
        const separator = path.includes("?") ? "&" : "?";
        const result = await pbFetch<PBListResponse<T>>(
            `${path}${separator}perPage=${perPage}&page=${page}`,
            authHeader,
        );
        items.push(...result.items);
        if (page >= result.totalPages || result.items.length < perPage) break;
        page += 1;
    }

    return items;
}

const COLUMN_STATUS: Array<{ slug: string; name: string; final?: boolean }> = [
    { slug: "planned", name: "Planned" },
    { slug: "archived", name: "Archived" },
];

function taskLine(task: PBTask, done: boolean): string[] {
    const title = (task.title || "Untitled task").trim();
    const lines = [`- [${done ? "x" : " "}] ${title}`];
    const details: string[] = [];

    if (task.priority) details.push(`Priority: ${task.priority}`);
    if (task.due_date) details.push(`Due: ${task.due_date.slice(0, 10)}`);
    if (task.labels?.length) details.push(`Labels: ${task.labels.join(", ")}`);
    if (task.document) details.push(`Note: /document/${task.document}`);
    if (details.length > 0) lines.push(`  - ${details.join(" · ")}`);

    const description = (task.description || "").trim();
    if (description) {
        const excerpt = description.length > 1200 ? `${description.slice(0, 1200)}…` : description;
        for (const line of excerpt.split(/\r?\n/)) {
            lines.push(`  > ${line}`);
        }
    }

    return lines;
}

/** Markdown body for one board export. Pure, so it is unit-testable. */
export function boardToMarkdown(
    board: PBBoard,
    columns: PBBoardColumn[],
    tasks: PBTask[],
): string {
    const sections = [
        ...columns
            .slice()
            .sort((a, b) => a.position - b.position)
            .map((column) => ({
                slug: column.slug,
                name: column.name || column.slug,
                final: column.is_final === true,
            })),
        ...COLUMN_STATUS,
    ];

    const seen = new Set<string>();
    const sectionsWithTasks = sections.filter((section) => {
        if (seen.has(section.slug)) return false;
        seen.add(section.slug);
        return true;
    });

    const lines = [`# ${(board.name || "Untitled board").trim()}`, ""];
    const description = (board.description || "").trim();
    if (description) {
        lines.push(description, "");
    }
    lines.push(`_Updated ${board.updated}_`, "");

    let taskCount = 0;
    for (const section of sectionsWithTasks) {
        const sectionTasks = tasks.filter((task) => task.status === section.slug);
        if (sectionTasks.length === 0) continue;

        taskCount += sectionTasks.length;
        lines.push(`## ${section.name}`, "");
        for (const task of sectionTasks) {
            lines.push(...taskLine(task, section.final === true), "");
        }
    }

    if (taskCount === 0) {
        lines.push("_No tasks._", "");
    }

    return lines.join("\n").trimEnd() + "\n";
}

export interface BoardExport {
    name: string;
    markdown: string;
    filename: string;
}

/** Load one owned board and render it as a Markdown download. */
export async function resolveBoardExport(
    userId: string,
    authHeader: string,
    boardId: string,
): Promise<BoardExport | null> {
    let board: PBBoard;
    try {
        board = await pbFetch<PBBoard>(
            `/api/collections/boards/records/${encodeURIComponent(boardId)}`,
            authHeader,
        );
    } catch {
        return null;
    }
    if (board.author !== userId) return null;

    const [columns, tasks] = await Promise.all([
        fetchAll<PBBoardColumn>(
            `/api/collections/board_columns/records?filter=${encodeURIComponent(`board="${board.id}"`)}&sort=position,created`,
            authHeader,
        ),
        fetchAll<PBTask>(
            `/api/collections/tasks/records?filter=${encodeURIComponent(`board="${board.id}"`)}&sort=status,board_order,created`,
            authHeader,
        ),
    ]);

    return {
        name: board.name || "Untitled board",
        markdown: boardToMarkdown(board, columns, tasks),
        filename: `${sanitizeFilename(board.name || "board")}.md`,
    };
}

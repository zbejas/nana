import { describe, expect, test } from "bun:test";
import { boardToMarkdown } from "../../src/api/export/boards";
import type { PBBoard, PBBoardColumn, PBTask } from "../../src/api/export/types";

const board: PBBoard = {
    id: "board1",
    name: "Release board",
    description: "Everything needed for 0.3.2",
    author: "user1",
    created: "2026-10-01 10:00:00.000Z",
    updated: "2026-10-31 10:00:00.000Z",
};

const columns: PBBoardColumn[] = [
    { id: "c1", board: "board1", name: "Next up", slug: "next", position: 2, is_final: false },
    { id: "c2", board: "board1", name: "Done", slug: "done", position: 3, is_final: true },
    { id: "c0", board: "board1", name: "Backlog", slug: "backlog", position: 1, is_final: false },
];

const tasks: PBTask[] = [
    {
        id: "t1",
        title: "Fix sidebar",
        description: "Refresh after delete",
        status: "next",
        priority: "high",
        due_date: "2026-11-02 00:00:00.000Z",
        labels: ["bug", "ui"],
        document: "note1",
        board: "board1",
    },
    { id: "t2", title: "Ship it", status: "done", board: "board1" },
    { id: "t3", title: "Later idea", status: "planned", board: "board1" },
    { id: "t4", title: "Old idea", status: "archived", board: "board1" },
];

describe("boardToMarkdown", () => {
    test("renders columns in order with task detail", () => {
        const markdown = boardToMarkdown(board, columns, tasks);

        expect(markdown.startsWith("# Release board\n\nEverything needed for 0.3.2\n\n")).toBe(true);
        expect(markdown).toContain("_Updated 2026-10-31 10:00:00.000Z_\n");
        expect(markdown).toContain("## Next up\n\n- [ ] Fix sidebar\n");
        expect(markdown).toContain("  - Priority: high · Due: 2026-11-02 · Labels: bug, ui · Note: /document/note1\n");
        expect(markdown).toContain("  > Refresh after delete\n");
        expect(markdown).toContain("## Done\n\n- [x] Ship it\n");
        expect(markdown).toContain("## Planned\n\n- [ ] Later idea\n");
        expect(markdown).toContain("## Archived\n\n- [ ] Old idea\n");
        expect(markdown.indexOf("## Backlog")).toBeLessThan(markdown.indexOf("## Next up"));
        expect(markdown.indexOf("## Next up")).toBeLessThan(markdown.indexOf("## Done"));
    });

    test("handles an empty board", () => {
        const markdown = boardToMarkdown({ ...board, description: "" }, columns, []);
        expect(markdown).toContain("# Release board");
        expect(markdown).not.toContain("Everything needed");
        expect(markdown).toContain("_No tasks._");
    });
});

import { describe, expect, test } from "bun:test";
import { formatRelativeDate, padCount } from "../../src/components/board/dates";

function iso(offsetMs: number): string {
    return new Date(Date.now() - offsetMs).toISOString();
}

describe("formatRelativeDate", () => {
    test("returns blank for missing or invalid values", () => {
        expect(formatRelativeDate("")).toBe("");
        expect(formatRelativeDate(undefined)).toBe("");
        expect(formatRelativeDate(null)).toBe("");
        expect(formatRelativeDate("not-a-date")).toBe("");
    });

    test("formats the last minute as Just now", () => {
        expect(formatRelativeDate(iso(10_000))).toBe("Just now");
    });

    test("formats minutes and hours", () => {
        expect(formatRelativeDate(iso(5 * 60_000))).toBe("5m ago");
        expect(formatRelativeDate(iso(3 * 60 * 60_000))).toBe("3h ago");
    });

    test("uses the month/day form for older dates", () => {
        const value = new Date();
        value.setDate(value.getDate() - 10);

        const formatted = formatRelativeDate(value.toISOString());
        const expected = value.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
        });

        expect(formatted).toBe(expected);
    });

    test("includes the year when the date leaves the current year", () => {
        const value = new Date();
        value.setFullYear(value.getFullYear() - 1);

        const formatted = formatRelativeDate(value.toISOString());
        const expected = value.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
        });

        expect(formatted).toBe(expected);
    });
});

describe("padCount", () => {
    test("pads to two digits", () => {
        expect(padCount(0)).toBe("00");
        expect(padCount(3)).toBe("03");
        expect(padCount(12)).toBe("12");
    });

    test("does not truncate larger numbers", () => {
        expect(padCount(104)).toBe("104");
    });

    test("clamps negative values to zero", () => {
        expect(padCount(-4)).toBe("00");
    });
});

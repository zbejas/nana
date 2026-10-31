/**
 * Pure text helpers shared by collaborative editing.
 *
 * The persisted document is Markdown, while the editor exposes plain text
 * derived from its ProseMirror document (see `proseTextMap` in
 * `createEditor.ts`). This module bridges those coordinate spaces:
 *
 * - `minimalTextChange` describes the smallest single splice between two
 *   strings, using offsets into the current string.
 * - `applyTextChange` applies such a splice.
 * - `mapOffsetThroughChange` moves a cursor offset through a splice.
 * - `alignMarkdownToText` builds line segments between Markdown source and the
 *   editor's plain text.
 * - `markdownOffsetToTextOffset` / `textOffsetToMarkdownOffset` translate
 *   cursor offsets inside or next to those segments.
 *
 * All offsets are UTF-16 code-unit indices, matching JavaScript strings and
 * ProseMirror positions. Inputs are treated defensively: malformed values are
 * clamped or ignored rather than thrown on.
 */

export interface TextChange {
    from: number;
    to: number;
    insert: string;
}

export interface MarkdownTextSegment {
    mdStart: number;
    mdEnd: number;
    textStart: number;
    textEnd: number;
}

/** A gap larger than this between segments is not a safe cursor landing spot. */
const MAX_MAPPING_GAP = 4;

function clampIndex(value: unknown, maximum: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(Math.trunc(value), maximum));
}

function isHighSurrogate(code: number): boolean {
    return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
    return code >= 0xdc00 && code <= 0xdfff;
}

function splitsSurrogatePair(value: string, index: number): boolean {
    return index > 0
        && index < value.length
        && isHighSurrogate(value.charCodeAt(index - 1))
        && isLowSurrogate(value.charCodeAt(index));
}

/**
 * Return the smallest single replacement turning `current` into `next`.
 *
 * Common prefixes and suffixes are kept, then widened by at most one code unit
 * so a replacement never starts or ends between two halves of a surrogate
 * pair. Returns `null` when the strings are already equal.
 */
export function minimalTextChange(current: string, next: string): TextChange | null {
    const before = typeof current === 'string' ? current : '';
    const after = typeof next === 'string' ? next : '';
    if (before === after) return null;

    let from = 0;
    const prefixLimit = Math.min(before.length, after.length);
    while (from < prefixLimit && before.charCodeAt(from) === after.charCodeAt(from)) {
        from += 1;
    }

    let beforeEnd = before.length;
    let afterEnd = after.length;
    while (
        beforeEnd > from
        && afterEnd > from
        && before.charCodeAt(beforeEnd - 1) === after.charCodeAt(afterEnd - 1)
    ) {
        beforeEnd -= 1;
        afterEnd -= 1;
    }

    while (from > 0 && (splitsSurrogatePair(before, from) || splitsSurrogatePair(after, from))) {
        from -= 1;
    }
    while (beforeEnd < before.length && splitsSurrogatePair(before, beforeEnd)) {
        beforeEnd += 1;
    }
    while (afterEnd < after.length && splitsSurrogatePair(after, afterEnd)) {
        afterEnd += 1;
    }

    beforeEnd = Math.max(from, beforeEnd);
    afterEnd = Math.max(from, afterEnd);

    return {
        from,
        to: beforeEnd,
        insert: after.slice(from, afterEnd),
    };
}

/** Apply a change to a string, clamping bad offsets instead of throwing. */
export function applyTextChange(current: string, change: TextChange): string {
    const before = typeof current === 'string' ? current : '';
    const from = clampIndex(change?.from, before.length);
    const to = Math.max(from, clampIndex(change?.to, before.length));
    const insert = typeof change?.insert === 'string' ? change.insert : '';
    return before.slice(0, from) + insert + before.slice(to);
}

/**
 * Map a cursor offset through a change.
 *
 * Offsets before the replacement stay put; offsets after it shift by the
 * length delta. Offsets on or inside the replaced range collapse to the start
 * of the replacement with `assoc === -1` and to its end with `assoc === 1`.
 */
export function mapOffsetThroughChange(
    offset: number,
    change: TextChange,
    assoc: -1 | 1,
): number {
    const base = typeof offset === 'number' && Number.isFinite(offset) ? offset : 0;
    const from = clampIndex(change?.from, Number.MAX_SAFE_INTEGER);
    const to = Math.max(from, clampIndex(change?.to, Number.MAX_SAFE_INTEGER));
    const insert = typeof change?.insert === 'string' ? change.insert : '';
    const delta = insert.length - (to - from);

    if (base < from) return Math.max(0, base);
    if (base > to) return Math.max(0, base + delta);
    return assoc < 0 ? from : from + insert.length;
}

interface SourceLine {
    text: string;
    start: number;
}

interface VisibleLine {
    text: string;
    starts: number[];
    ends: number[];
}

interface NormalizedText {
    value: string;
    starts: number[];
    ends: number[];
}

function splitSourceLines(source: string): SourceLine[] {
    const lines: SourceLine[] = [];
    let start = 0;

    for (let index = 0; index <= source.length; index += 1) {
        if (index !== source.length && source.charCodeAt(index) !== 10) continue;
        let end = index;
        if (end > start && source.charCodeAt(end - 1) === 13) end -= 1;
        lines.push({ text: source.slice(start, end), start });
        start = index + 1;
    }

    return lines;
}

function isWhitespaceCode(code: number): boolean {
    return code === 32
        || (code >= 9 && code <= 13)
        || code === 0x00a0
        || code === 0x1680
        || (code >= 0x2000 && code <= 0x200a)
        || code === 0x2028
        || code === 0x2029
        || code === 0x202f
        || code === 0x205f
        || code === 0x3000
        || code === 0xfeff;
}

function isAsciiWord(value: string | undefined): boolean {
    return value !== undefined && /[A-Za-z0-9]/.test(value);
}

function isEscapable(value: string): boolean {
    const code = value.charCodeAt(0);
    return (code >= 33 && code <= 47)
        || (code >= 58 && code <= 64)
        || (code >= 91 && code <= 96)
        || (code >= 123 && code <= 126);
}

function countRun(source: string, start: number, char: string, limit: number): number {
    let end = start;
    while (end < limit && source[end] === char) end += 1;
    return end - start;
}

function copyRange(
    source: string,
    from: number,
    to: number,
    output: VisibleLine,
    baseOffset = 0,
): void {
    for (let index = from; index < to; index += 1) {
        output.text += source[index]!;
        output.starts.push(baseOffset + index);
        output.ends.push(baseOffset + index + 1);
    }
}

function pushVisibleChar(output: VisibleLine, char: string, sourceIndex: number): void {
    const width = char.length;
    output.text += char;
    output.starts.push(sourceIndex);
    output.ends.push(sourceIndex + width);
}

function findBalancedClose(
    source: string,
    start: number,
    limit: number,
    open: string,
    close: string,
): number {
    let depth = 0;
    for (let index = start; index < limit; index += 1) {
        const char = source[index];
        if (char === '\\') {
            index += 1;
            continue;
        }
        if (char === open) {
            depth += 1;
        } else if (char === close) {
            depth -= 1;
            if (depth === 0) return index;
        }
    }
    return -1;
}

interface ParsedLink {
    labelStart: number;
    labelEnd: number;
    end: number;
}

function parseLink(source: string, open: number, limit: number): ParsedLink | null {
    if (source[open] !== '[') return null;

    const labelEnd = findBalancedClose(source, open, limit, '[', ']');
    if (labelEnd < 0) return null;

    const afterLabel = labelEnd + 1;
    if (source[afterLabel] === '(') {
        const close = findBalancedClose(source, afterLabel, limit, '(', ')');
        if (close < 0) return null;
        return { labelStart: open + 1, labelEnd, end: close + 1 };
    }
    if (source[afterLabel] === '[') {
        const close = findBalancedClose(source, afterLabel, limit, '[', ']');
        if (close < 0) return null;
        return { labelStart: open + 1, labelEnd, end: close + 1 };
    }
    return null;
}

interface HtmlMatch {
    end: number;
    textStart?: number;
    textEnd?: number;
}

function matchHtml(source: string, start: number, limit: number): HtmlMatch | null {
    const remainder = source.slice(start, limit);

    const autolink = /^<((?:https?:\/\/|mailto:)[^<>\s]+|[^<>\s]+@[^<>\s]+)>/.exec(remainder);
    if (autolink) {
        return {
            end: start + autolink[0].length,
            textStart: start + 1,
            textEnd: start + 1 + autolink[1]!.length,
        };
    }

    const comment = /^<!--[\s\S]*?-->/.exec(remainder);
    if (comment) return { end: start + comment[0].length };

    const tag = /^<\/?[A-Za-z][^>]*>/.exec(remainder);
    if (tag) return { end: start + tag[0].length };

    return null;
}

function findCodeSpanClose(
    source: string,
    start: number,
    limit: number,
    length: number,
): number {
    let index = start;
    while (index < limit) {
        if (source[index] !== '`') {
            index += 1;
            continue;
        }
        const run = countRun(source, index, '`', limit);
        if (run === length) return index;
        index += run;
    }
    return -1;
}

function findClosingRun(
    source: string,
    start: number,
    limit: number,
    char: string,
    length: number,
): number {
    let index = start;
    while (index < limit) {
        if (source[index] === '\\') {
            index += 2;
            continue;
        }
        if (source[index] !== char) {
            index += 1;
            continue;
        }
        const run = countRun(source, index, char, limit);
        if (run >= length) return index;
        index += run;
    }
    return -1;
}

function scanInline(
    source: string,
    baseOffset: number,
    from: number,
    to: number,
    output: VisibleLine,
    depth: number,
): void {
    if (depth > 8) {
        copyRange(source, from, to, output, baseOffset);
        return;
    }

    let index = from;
    while (index < to) {
        const char = source[index]!;

        if (char === '\\' && index + 1 < to && isEscapable(source[index + 1]!)) {
            pushVisibleChar(output, source[index + 1]!, baseOffset + index + 1);
            index += 2;
            continue;
        }

        if (char === '`') {
            const run = countRun(source, index, '`', to);
            const close = findCodeSpanClose(source, index + run, to, run);
            if (close < 0) {
                copyRange(source, index, index + run, output, baseOffset);
                index += run;
                continue;
            }

            let contentStart = index + run;
            let contentEnd = close;
            if (
                contentEnd - contentStart >= 2
                && source[contentStart] === ' '
                && source[contentEnd - 1] === ' '
                && source.slice(contentStart, contentEnd).trim() !== ''
            ) {
                contentStart += 1;
                contentEnd -= 1;
            }
            copyRange(source, contentStart, contentEnd, output, baseOffset);
            index = close + run;
            continue;
        }

        if (char === '!' && source[index + 1] === '[') {
            const image = parseLink(source, index + 1, to);
            if (image) {
                // Images contribute no text nodes to the ProseMirror document,
                // so both the alt text and destination are alignment-invisible.
                index = image.end;
                continue;
            }
            pushVisibleChar(output, char, baseOffset + index);
            index += 1;
            continue;
        }

        if (char === '[') {
            const link = parseLink(source, index, to);
            if (link) {
                scanInline(
                    source,
                    baseOffset,
                    link.labelStart,
                    link.labelEnd,
                    output,
                    depth + 1,
                );
                index = link.end;
                continue;
            }
            pushVisibleChar(output, char, baseOffset + index);
            index += 1;
            continue;
        }

        if (char === '<') {
            const html = matchHtml(source, index, to);
            if (html) {
                if (html.textStart !== undefined && html.textEnd !== undefined) {
                    copyRange(source, html.textStart, html.textEnd, output, baseOffset);
                }
                index = html.end;
                continue;
            }
            pushVisibleChar(output, char, baseOffset + index);
            index += 1;
            continue;
        }

        if (char === '|') {
            // Table cell separator; the visible cell text remains.
            index += 1;
            continue;
        }

        if (char === '*' || char === '_' || char === '~') {
            const run = countRun(source, index, char, to);
            if (char === '~' && run < 2) {
                copyRange(source, index, index + run, output, baseOffset);
                index += run;
                continue;
            }
            if (char === '_' && isAsciiWord(source[index - 1])) {
                copyRange(source, index, index + run, output, baseOffset);
                index += run;
                continue;
            }

            const close = findClosingRun(source, index + run, to, char, run);
            if (close < 0) {
                copyRange(source, index, index + run, output, baseOffset);
                index += run;
                continue;
            }

            scanInline(source, baseOffset, index + run, close, output, depth + 1);
            index = close + countRun(source, close, char, to);
            continue;
        }

        pushVisibleChar(output, char, baseOffset + index);
        index += 1;
    }
}

function createVisibleLine(): VisibleLine {
    return { text: '', starts: [], ends: [] };
}

function trimVisibleLine(line: VisibleLine): VisibleLine | null {
    let start = 0;
    let end = line.text.length;

    while (start < end && isWhitespaceCode(line.text.charCodeAt(start))) start += 1;
    while (end > start && isWhitespaceCode(line.text.charCodeAt(end - 1))) end -= 1;
    if (start >= end) return null;

    return {
        text: line.text.slice(start, end),
        starts: line.starts.slice(start, end),
        ends: line.ends.slice(start, end),
    };
}

function stripClosingHeadingMarks(line: VisibleLine): VisibleLine {
    const match = /\s+#{1,}\s*$/.exec(line.text);
    if (!match) return line;
    return {
        text: line.text.slice(0, match.index),
        starts: line.starts.slice(0, match.index),
        ends: line.ends.slice(0, match.index),
    };
}

function blockContentStart(line: string): { start: number; heading: boolean } {
    let index = 0;

    while (index < line.length && (line[index] === ' ' || line[index] === '\t')) index += 1;
    while (line[index] === '>') {
        index += 1;
        if (line[index] === ' ') index += 1;
    }

    const heading = /^#{1,6}[ \t]+/.exec(line.slice(index));
    if (heading) {
        return { start: index + heading[0].length, heading: true };
    }

    const list = /^(?:[-*+]|\d{1,9}[.)])[ \t]+/.exec(line.slice(index));
    if (list) index += list[0].length;

    const task = /^\[[ xX]\][ \t]+/.exec(line.slice(index));
    if (task) index += task[0].length;

    return { start: index, heading: false };
}

function isTableDivider(value: string): boolean {
    return value.includes('|')
        && value.includes('-')
        && /^[|\s:-]+$/.test(value)
        && /-{3,}/.test(value);
}

function isStructuralOnlyLine(value: string): boolean {
    const trimmed = value.trim();
    if (!trimmed) return false;
    if (/^<!--[\s\S]*-->$/.test(trimmed)) return true;
    if (/^\[[^\]]+\]:\s*\S+/.test(trimmed)) return true;
    if (/^(?:[-*_][ \t]*){3,}$/.test(trimmed)) return true;
    if (/^[=-]{2,}$/.test(trimmed)) return true;
    return isTableDivider(trimmed);
}

function buildVisibleLine(line: SourceLine): VisibleLine {
    const output = createVisibleLine();
    const block = blockContentStart(line.text);
    scanInline(line.text, line.start, block.start, line.text.length, output, 0);
    return block.heading ? stripClosingHeadingMarks(output) : output;
}

function normalizeText(value: string): NormalizedText {
    const parts: string[] = [];
    const starts: number[] = [];
    const ends: number[] = [];
    let index = 0;

    while (index < value.length) {
        const code = value.charCodeAt(index);
        if (isWhitespaceCode(code)) {
            let end = index + 1;
            while (end < value.length && isWhitespaceCode(value.charCodeAt(end))) end += 1;
            parts.push(' ');
            starts.push(index);
            ends.push(end);
            index = end;
            continue;
        }

        parts.push(value[index]!);
        starts.push(index);
        ends.push(index + 1);
        index += 1;
    }

    return { value: parts.join(''), starts, ends };
}

function normalizeNeedle(value: string): string {
    let result = '';
    let pendingSpace = false;

    for (let index = 0; index < value.length; index += 1) {
        if (isWhitespaceCode(value.charCodeAt(index))) {
            pendingSpace = result.length > 0;
            continue;
        }
        if (pendingSpace) {
            result += ' ';
            pendingSpace = false;
        }
        result += value[index]!;
    }

    return result;
}

/**
 * Align Markdown source lines with ProseMirror plain text.
 *
 * Both inputs describe the same document. Markdown lines are reduced to their
 * visible content by removing block markers (headings, lists, task boxes,
 * quotes, table pipes), inline markers (emphasis, code spans, links, HTML),
 * and structural lines (fences, rules, link definitions). Visible lines are
 * matched in order against whitespace-normalized `text`; unmatched lines are
 * skipped. The returned segments are sorted by source order.
 */
export function alignMarkdownToText(markdown: string, text: string): MarkdownTextSegment[] {
    const source = typeof markdown === 'string' ? markdown : '';
    const prose = typeof text === 'string' ? text : '';
    if (!source || !prose) return [];

    const lines = splitSourceLines(source);
    const normalized = normalizeText(prose);
    const segments: MarkdownTextSegment[] = [];
    let textCursor = 0;
    let fence: { marker: string; length: number } | null = null;

    for (const line of lines) {
        const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line.text);

        let visible: VisibleLine;
        if (fence) {
            const run = fenceMatch?.[1];
            const afterRun = fenceMatch ? line.text.slice(fenceMatch[0].length) : '';
            if (run && run[0] === fence.marker && run.length >= fence.length && !afterRun.trim()) {
                fence = null;
                continue;
            }

            visible = createVisibleLine();
            copyRange(line.text, 0, line.text.length, visible, line.start);
        } else if (fenceMatch) {
            fence = { marker: fenceMatch[1]![0]!, length: fenceMatch[1]!.length };
            continue;
        } else {
            if (isStructuralOnlyLine(line.text)) continue;
            visible = buildVisibleLine(line);
        }

        const trimmed = trimVisibleLine(visible);
        if (!trimmed) continue;

        const needle = normalizeNeedle(trimmed.text);
        if (!needle) continue;

        const found = normalized.value.indexOf(needle, textCursor);
        if (found < 0) continue;

        const textStart = normalized.starts[found];
        const textEnd = normalized.ends[found + needle.length - 1];
        if (textStart === undefined || textEnd === undefined) continue;

        segments.push({
            mdStart: trimmed.starts[0]!,
            mdEnd: trimmed.ends[trimmed.ends.length - 1]!,
            textStart,
            textEnd,
        });
        textCursor = found + needle.length;
    }

    return segments;
}

function isValidSegment(segment: MarkdownTextSegment | undefined): segment is MarkdownTextSegment {
    return segment !== undefined
        && Number.isFinite(segment.mdStart)
        && Number.isFinite(segment.mdEnd)
        && Number.isFinite(segment.textStart)
        && Number.isFinite(segment.textEnd)
        && segment.mdEnd >= segment.mdStart
        && segment.textEnd >= segment.textStart;
}

function mapRange(
    sourceStart: number,
    sourceEnd: number,
    targetStart: number,
    targetEnd: number,
    offset: number,
): number {
    const sourceLength = sourceEnd - sourceStart;
    const targetLength = targetEnd - targetStart;
    if (sourceLength <= 0 || targetLength <= 0) return targetStart;

    const delta = Math.max(0, Math.min(offset - sourceStart, sourceLength));
    if (delta === 0) return targetStart;
    if (delta === sourceLength) return targetEnd;

    const mapped = targetStart + Math.round((delta / sourceLength) * targetLength);
    return Math.max(targetStart, Math.min(targetEnd, mapped));
}

/** Map a Markdown offset to plain text, or `null` when no safe segment exists. */
export function markdownOffsetToTextOffset(
    segments: MarkdownTextSegment[],
    offset: number,
): number | null {
    if (!Array.isArray(segments) || segments.length === 0 || !Number.isFinite(offset)) return null;

    let previous: MarkdownTextSegment | null = null;
    for (const segment of segments) {
        if (!isValidSegment(segment)) continue;

        if (offset < segment.mdStart) {
            const nextGap = segment.mdStart - offset;
            const previousGap = previous ? offset - previous.mdEnd : Number.POSITIVE_INFINITY;
            if (Math.min(nextGap, previousGap) > MAX_MAPPING_GAP) return null;
            if (previous && previousGap <= nextGap) return previous.textEnd;
            return segment.textStart;
        }

        if (offset <= segment.mdEnd) {
            return mapRange(
                segment.mdStart,
                segment.mdEnd,
                segment.textStart,
                segment.textEnd,
                offset,
            );
        }

        previous = segment;
    }

    if (previous && offset - previous.mdEnd <= MAX_MAPPING_GAP) return previous.textEnd;
    return null;
}

/** Map a plain-text offset to Markdown, or `null` when no safe segment exists. */
export function textOffsetToMarkdownOffset(
    segments: MarkdownTextSegment[],
    offset: number,
): number | null {
    if (!Array.isArray(segments) || segments.length === 0 || !Number.isFinite(offset)) return null;

    let previous: MarkdownTextSegment | null = null;
    for (const segment of segments) {
        if (!isValidSegment(segment)) continue;

        if (offset < segment.textStart) {
            const nextGap = segment.textStart - offset;
            const previousGap = previous ? offset - previous.textEnd : Number.POSITIVE_INFINITY;
            if (Math.min(nextGap, previousGap) > MAX_MAPPING_GAP) return null;
            if (previous && previousGap <= nextGap) return previous.mdEnd;
            return segment.mdStart;
        }

        if (offset <= segment.textEnd) {
            return mapRange(
                segment.textStart,
                segment.textEnd,
                segment.mdStart,
                segment.mdEnd,
                offset,
            );
        }

        previous = segment;
    }

    if (previous && offset - previous.textEnd <= MAX_MAPPING_GAP) return previous.mdEnd;
    return null;
}

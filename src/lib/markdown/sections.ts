/**
 * Section-scoped Markdown edits for the AI note tools.
 *
 * The parser is deliberately small: ATX headings outside fenced code blocks
 * define sections; a section runs to the next heading of the same or a higher
 * level. Untouched bytes are preserved so a model edit never reformats the
 * whole note.
 */

export type MarkdownEditOperation =
  | { op: 'replace_section'; heading: string; markdown: string }
  | { op: 'insert_after'; heading: string; markdown: string }
  | { op: 'append'; markdown: string }
  | { op: 'replace_text'; find: string; markdown: string };

export interface MarkdownSection {
  /** Heading text without the leading hashes, or null for the preamble. */
  heading: string | null;
  /** Ancestor headings, root first, excluding this heading. */
  path: string[];
  level: number;
  /** Start of the heading line (or 0 for the preamble). */
  from: number;
  /** Start of the next peer/higher heading, or the document length. */
  to: number;
  /** Start of the body (after the heading line). */
  contentFrom: number;
  /** End of the body (always equal to `to`). */
  contentTo: number;
}

export interface AppliedSectionEdit {
  op: MarkdownEditOperation['op'];
  heading?: string;
  path?: string[];
  from: number;
  to: number;
}

export interface ApplySectionEditsResult {
  markdown: string;
  changed: AppliedSectionEdit[];
}

export class MarkdownSectionError extends Error {
  code: 'not_found' | 'ambiguous' | 'invalid';

  constructor(code: 'not_found' | 'ambiguous' | 'invalid', message: string) {
    super(message);
    this.name = 'MarkdownSectionError';
    this.code = code;
  }
}

interface HeadingLine {
  title: string;
  level: number;
  lineStart: number;
  lineEnd: number;
}

interface LineInfo {
  start: number;
  end: number;
  text: string;
}

function linesOf(markdown: string): LineInfo[] {
  const lines: LineInfo[] = [];
  let start = 0;
  for (let index = 0; index < markdown.length; index += 1) {
    if (markdown[index] !== '\n') continue;
    lines.push({ start, end: index + 1, text: markdown.slice(start, index) });
    start = index + 1;
  }
  if (start <= markdown.length) {
    lines.push({ start, end: markdown.length, text: markdown.slice(start) });
  }
  return lines;
}

/**
 * Returns ATX headings outside fenced code blocks. Indented headings are
 * treated as text; this keeps code samples and nested list prose safe.
 */
export function findHeadings(markdown: string): HeadingLine[] {
  const headings: HeadingLine[] = [];
  let fence: { marker: string; length: number } | null = null;

  for (const line of linesOf(markdown)) {
    const text = line.text;
    const trimmedStart = text.replace(/^\s{0,3}/, '');
    const fenceMatch = /^(`{3,}|~{3,})/.exec(trimmedStart);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      const length = fenceMatch[1].length;
      if (!fence) {
        fence = { marker, length };
      } else if (fence.marker === marker && length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (fence) continue;

    const match = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(text);
    if (!match) continue;
    headings.push({
      title: match[2].trim(),
      level: match[1].length,
      lineStart: line.start,
      lineEnd: line.end,
    });
  }

  return headings;
}

export function parseMarkdownSections(markdown: string): MarkdownSection[] {
  const headings = findHeadings(markdown);
  const sections: MarkdownSection[] = [];

  if (headings.length === 0) {
    return [
      {
        heading: null,
        path: [],
        level: 0,
        from: 0,
        to: markdown.length,
        contentFrom: 0,
        contentTo: markdown.length,
      },
    ];
  }

  if (headings[0].lineStart > 0) {
    sections.push({
      heading: null,
      path: [],
      level: 0,
      from: 0,
      to: headings[0].lineStart,
      contentFrom: 0,
      contentTo: headings[0].lineStart,
    });
  }

  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    let end = markdown.length;
    for (let next = index + 1; next < headings.length; next += 1) {
      if (headings[next].level <= heading.level) {
        end = headings[next].lineStart;
        break;
      }
    }

    const path: string[] = [];
    let parentLevel = heading.level;
    for (let previous = index - 1; previous >= 0; previous -= 1) {
      if (headings[previous].level < parentLevel) {
        path.unshift(headings[previous].title);
        parentLevel = headings[previous].level;
      }
    }

    sections.push({
      heading: heading.title,
      path,
      level: heading.level,
      from: heading.lineStart,
      to: end,
      contentFrom: heading.lineEnd,
      contentTo: end,
    });
  }

  return sections;
}

function normalizeHeadingKey(value: string): string {
  return value
    .replace(/^#{1,6}\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function sectionKeys(section: MarkdownSection): string[] {
  const keys: string[] = [];
  if (!section.heading) {
    keys.push('');
    return keys;
  }
  keys.push(normalizeHeadingKey(section.heading));
  const trail = [...section.path, section.heading];
  // Accept a full path or any unique suffix, so "Risks > Schedule" works
  // without forcing the caller to repeat the document title.
  for (let start = 0; start < trail.length - 1; start += 1) {
    const suffix = trail.slice(start);
    keys.push(normalizeHeadingKey(suffix.join(' > ')));
    keys.push(normalizeHeadingKey(suffix.join(' / ')));
    keys.push(normalizeHeadingKey(suffix.join('/')));
  }
  return keys;
}

function findSection(markdown: string, heading: string): MarkdownSection {
  const wanted = normalizeHeadingKey(heading);
  if (!wanted) {
    throw new MarkdownSectionError('not_found', 'A heading is required.');
  }

  const matches = parseMarkdownSections(markdown).filter((section) =>
    sectionKeys(section).includes(wanted)
  );

  if (matches.length === 0) {
    throw new MarkdownSectionError('not_found', `No section matches "${heading}".`);
  }
  if (matches.length > 1) {
    throw new MarkdownSectionError(
      'ambiguous',
      `More than one section matches "${heading}". Use the heading path.`
    );
  }
  return matches[0];
}

function block(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/^\n+/, '').replace(/\n+$/, '');
}

function ensureNewline(value: string): string {
  if (!value) return '';
  return value.endsWith('\n') ? value : `${value}\n`;
}

function shiftRange(range: AppliedSectionEdit, at: number, delta: number): AppliedSectionEdit {
  if (delta === 0) return range;
  if (range.to <= at) return range;
  if (range.from >= at) {
    return { ...range, from: range.from + delta, to: range.to + delta };
  }
  return { ...range, to: Math.max(range.from, range.to + delta) };
}

function replaceSectionBody(markdown: string, section: MarkdownSection, value: string): {
  markdown: string;
  applied: AppliedSectionEdit;
} {
  const headingLine = markdown.slice(section.from, section.contentFrom);
  const body = block(value);
  const replacement = body ? `${ensureNewline(headingLine)}\n${body}\n\n` : headingLine;
  const next = markdown.slice(0, section.from) + replacement + markdown.slice(section.to);
  const bodyStart = section.from + ensureNewline(headingLine).length + (body ? 1 : 0);
  return {
    markdown: next,
    applied: {
      op: 'replace_section',
      heading: section.heading ?? undefined,
      path: section.path,
      from: bodyStart,
      to: bodyStart + (body ? body.length : 0),
    },
  };
}

function insertAfterSection(markdown: string, section: MarkdownSection, value: string): {
  markdown: string;
  applied: AppliedSectionEdit;
} {
  const body = block(value);
  if (!body) {
    return {
      markdown,
      applied: { op: 'insert_after', heading: section.heading ?? undefined, path: section.path, from: section.to, to: section.to },
    };
  }

  const before = markdown.slice(0, section.to).replace(/\n*$/, '\n\n');
  const after = markdown.slice(section.to).replace(/^\n*/, '');
  const insertion = `${before}${body}\n\n`;
  const next = `${insertion}${after}`;
  const from = before.length;
  return {
    markdown: next,
    applied: {
      op: 'insert_after',
      heading: section.heading ?? undefined,
      path: section.path,
      from,
      to: from + body.length,
    },
  };
}

function appendToDocument(markdown: string, value: string): {
  markdown: string;
  applied: AppliedSectionEdit;
} {
  const body = block(value);
  if (!body) {
    return { markdown, applied: { op: 'append', from: markdown.length, to: markdown.length } };
  }
  const prefix = markdown.replace(/\n*$/, '');
  const from = prefix.length + (prefix ? 2 : 0);
  const next = `${prefix}${prefix ? '\n\n' : ''}${body}\n`;
  return { markdown: next, applied: { op: 'append', from, to: from + body.length } };
}

function replaceUniqueText(markdown: string, find: string, value: string): {
  markdown: string;
  applied: AppliedSectionEdit;
} {
  if (!find) throw new MarkdownSectionError('invalid', 'A text anchor is required.');
  const first = markdown.indexOf(find);
  if (first < 0) {
    throw new MarkdownSectionError('not_found', 'The text to replace was not found.');
  }
  if (markdown.indexOf(find, first + 1) >= 0) {
    throw new MarkdownSectionError('ambiguous', 'The text to replace occurs more than once.');
  }
  const replacement = block(value);
  const next = markdown.slice(0, first) + replacement + markdown.slice(first + find.length);
  return {
    markdown: next,
    applied: { op: 'replace_text', from: first, to: first + replacement.length },
  };
}

/**
 * Applies operations in order. Any failed anchor aborts the whole edit; the
 * caller receives the original markdown untouched.
 */
export function applySectionEdits(
  markdown: string,
  operations: MarkdownEditOperation[]
): ApplySectionEditsResult {
  let current = markdown.replace(/\r\n/g, '\n');
  const changed: AppliedSectionEdit[] = [];

  for (const operation of operations) {
    let result: { markdown: string; applied: AppliedSectionEdit };

    if (operation.op === 'append') {
      result = appendToDocument(current, operation.markdown);
    } else if (operation.op === 'replace_text') {
      result = replaceUniqueText(current, operation.find, operation.markdown);
    } else {
      if (!operation.heading) {
        throw new MarkdownSectionError('invalid', 'A heading is required for this edit.');
      }
      const section = findSection(current, operation.heading);
      result =
        operation.op === 'replace_section'
          ? replaceSectionBody(current, section, operation.markdown)
          : insertAfterSection(current, section, operation.markdown);
    }

    const delta = result.markdown.length - current.length;
    const at = result.applied.from;
    for (let index = 0; index < changed.length; index += 1) {
      changed[index] = shiftRange(changed[index], at, delta);
    }
    changed.push(result.applied);
    current = result.markdown;
  }

  return { markdown: current, changed };
}

export function sectionLabel(section: Pick<MarkdownSection, 'heading' | 'path'>): string {
  return section.heading ? [...section.path, section.heading].join(' > ') : 'Introduction';
}

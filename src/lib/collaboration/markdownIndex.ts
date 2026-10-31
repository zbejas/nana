/**
 * Pure block index for canonical Markdown.
 *
 * The editor bridge keeps one Markdown string but the WYSIWYG pane works on a
 * ProseMirror document. This scanner identifies top-level Markdown blocks and
 * maps them, in order, to ProseMirror's top-level nodes. The mapping is
 * deliberately coarse and conservative: context-sensitive containers are
 * flagged, and ambiguous documents return `null` rather than a guess.
 *
 * Markdown spans are half-open (`[mdStart, mdEnd)`) and exclude the blank line
 * that separates blocks. ProseMirror ranges are full node ranges
 * (`[pmStart, pmEnd)`), ready for `tr.delete(from, to)` / `tr.replaceWith`.
 *
 * No Milkdown, ProseMirror, or browser runtime is imported here. The structural
 * types below are satisfied by `@milkdown/kit/prose/model` nodes.
 */

export type MarkdownBlockKind =
  | 'paragraph'
  | 'heading'
  | 'list'
  | 'blockquote'
  | 'fenced-code'
  | 'table'
  | 'html'
  | 'alert'
  | 'hr'
  | 'unknown';

/** One ordered top-level Markdown block. */
export interface MarkdownBlock {
  /** Position in the scanner output, including empty paragraph spans. */
  readonly index: number;
  /** Inclusive UTF-16 source offset. */
  readonly mdStart: number;
  /** Exclusive UTF-16 source offset, before the block separator. */
  readonly mdEnd: number;
  readonly kind: MarkdownBlockKind;
  /**
   * True when inline/block mapping inside the range is unsafe without deeper
   * parsing: lists, blockquotes, tables, HTML/details, alerts, unknown blocks.
   */
  readonly contextSensitive: boolean;
}

/** The minimal ProseMirror node shape this module needs. */
export interface ProseNodeLike {
  readonly type: { readonly name: string };
  readonly nodeSize: number;
  readonly textContent?: string;
  readonly childCount?: number;
}

/** The minimal ProseMirror document shape this module needs. */
export interface ProseDocumentLike {
  readonly childCount: number;
  child(index: number): ProseNodeLike;
}

export type ProseDocumentInput = ProseDocumentLike | readonly ProseNodeLike[];

/** A top-level ProseMirror node with its document position range. */
export interface ProseBlock {
  readonly index: number;
  readonly node: ProseNodeLike;
  readonly pmStart: number;
  readonly pmEnd: number;
}

/** How a Markdown block found its ProseMirror node. */
export type BlockMatch = 'kind' | 'empty' | 'order';

/** One successful Markdown-to-ProseMirror block pairing. */
export interface AlignedMarkdownBlock extends MarkdownBlock {
  readonly node: ProseNodeLike;
  readonly pmIndex: number;
  readonly pmStart: number;
  readonly pmEnd: number;
  readonly match: BlockMatch;
  /** True when the Markdown span was invented to represent an empty node. */
  readonly synthesized: boolean;
}

/** Result of a conservative block alignment. */
export interface BlockAlignment {
  /** Matched blocks in document order. Unmatched empty spacers are omitted. */
  readonly blocks: readonly AlignedMarkdownBlock[];
  /** Empty Markdown spans that carried no ProseMirror counterpart. */
  readonly skippedMarkdown: readonly MarkdownBlock[];
  /**
   * False when a block was paired by order only or an empty span had to be
   * synthesized. Callers should fall back to full-snapshot reconciliation.
   */
  readonly reliable: boolean;
}

/** A half-open range in either coordinate space. */
export interface BlockRange {
  readonly from: number;
  readonly to: number;
}

interface SourceLine {
  start: number;
  contentEnd: number;
  text: string;
}

interface FenceInfo {
  marker: string;
  length: number;
  rest: string;
}

interface HtmlStart {
  mode: 'comment' | 'cdata' | 'processing' | 'declaration' | 'tag';
  tag?: string;
}

const HTML_BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'base',
  'basefont',
  'blockquote',
  'body',
  'caption',
  'center',
  'col',
  'colgroup',
  'dd',
  'details',
  'dialog',
  'dir',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'frame',
  'frameset',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'header',
  'hr',
  'html',
  'iframe',
  'legend',
  'li',
  'link',
  'main',
  'menu',
  'menuitem',
  'nav',
  'noframes',
  'ol',
  'optgroup',
  'option',
  'p',
  'param',
  'pre',
  'script',
  'search',
  'section',
  'style',
  'summary',
  'table',
  'tbody',
  'td',
  'textarea',
  'tfoot',
  'th',
  'thead',
  'title',
  'tr',
  'track',
  'ul',
]);

const RAW_HTML_TAGS = new Set(['pre', 'script', 'style', 'textarea']);

const VOID_HTML_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

function splitLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;

  for (let index = 0; index <= source.length; index += 1) {
    if (index !== source.length && source.charCodeAt(index) !== 10) continue;
    let contentEnd = index;
    if (contentEnd > start && source.charCodeAt(contentEnd - 1) === 13) contentEnd -= 1;
    lines.push({
      start,
      contentEnd,
      text: source.slice(start, contentEnd),
    });
    start = index + 1;
  }

  return lines;
}

function isBlankLine(text: string): boolean {
  return /^[ \t]*$/.test(text);
}

function indentWidth(text: string): number {
  let width = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === ' ') {
      width += 1;
      continue;
    }
    if (char === '\t') {
      width += 4 - (width % 4);
      continue;
    }
    break;
  }
  return width;
}

function matchFence(text: string): FenceInfo | null {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text);
  const run = match?.[1];
  if (!run) return null;
  return { marker: run[0]!, length: run.length, rest: match[2] ?? '' };
}

function closesFence(info: FenceInfo, fence: FenceInfo): boolean {
  return info.marker === fence.marker
    && info.length >= fence.length
    && info.rest.trim() === '';
}

function isAtxHeading(text: string): boolean {
  return /^ {0,3}#{1,6}(?:[ \t]+.*)?$/.test(text);
}

function isThematicBreak(text: string): boolean {
  const compact = text.trim().replace(/[ \t]/g, '');
  return /^(?:\*{3,}|-{3,}|_{3,})$/.test(compact);
}

function isSetextUnderline(text: string): boolean {
  return /^ {0,3}(?:=+|-+)[ \t]*$/.test(text);
}

function isBlockquoteStart(text: string): boolean {
  return /^ {0,3}>/.test(text);
}

function quoteContent(text: string): string {
  return /^ {0,3}>[ \t]?(.*)$/.exec(text)?.[1] ?? '';
}

function isListStart(text: string): boolean {
  return /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:[ \t]+|$)/.test(text);
}

function isTableDelimiter(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.includes('|') || !trimmed.includes('-')) return false;
  const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|');
  return cells.length > 0
    && cells.every((cell) => /^[ \t]*:?-{3,}:?[ \t]*$/.test(cell));
}

function isTableStart(lines: SourceLine[], index: number): boolean {
  const header = lines[index];
  const delimiter = lines[index + 1];
  if (!header || !delimiter) return false;
  return header.text.includes('|') && isTableDelimiter(delimiter.text);
}

function htmlBlockStart(text: string): HtmlStart | null {
  const trimmed = text.replace(/^ {0,3}/, '');
  if (trimmed.startsWith('<!--')) return { mode: 'comment' };
  if (trimmed.startsWith('<![CDATA[')) return { mode: 'cdata' };
  if (trimmed.startsWith('<?')) return { mode: 'processing' };
  if (/^<![A-Za-z]/.test(trimmed)) return { mode: 'declaration' };

  const match = /^<\/?([A-Za-z][A-Za-z0-9-]*)(?=[\s/>]|$)/.exec(trimmed);
  const tag = match?.[1]?.toLowerCase();
  if (!tag || !HTML_BLOCK_TAGS.has(tag)) return null;
  return { mode: 'tag', tag };
}

function findHtmlEnd(lines: SourceLine[], start: number, info: HtmlStart): number {
  const textAt = (index: number): string => lines[index]?.text ?? '';
  const closingMarker = (marker: string): number => {
    for (let index = start; index < lines.length; index += 1) {
      if (textAt(index).includes(marker)) return index;
    }
    return lines.length - 1;
  };

  if (info.mode === 'comment') return closingMarker('-->');
  if (info.mode === 'cdata') return closingMarker(']]>');
  if (info.mode === 'processing') return closingMarker('?>');
  if (info.mode === 'declaration') return closingMarker('>');

  const tag = info.tag;
  if (!tag || VOID_HTML_TAGS.has(tag)) return start;

  const close = `</${tag}`;
  if (tag === 'details' || RAW_HTML_TAGS.has(tag)) {
    for (let index = start; index < lines.length; index += 1) {
      if (textAt(index).toLowerCase().includes(close)) return index;
    }
    return lines.length - 1;
  }

  if (textAt(start).toLowerCase().includes(close)) return start;

  // Ordinary block HTML ends at a blank line (CommonMark type 6). Keeping the
  // block small avoids swallowing a following Markdown paragraph.
  let end = start;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (isBlankLine(textAt(index))) break;
    end = index;
    if (textAt(index).toLowerCase().includes(close)) break;
  }
  return end;
}

function startsTopLevelBlock(lines: SourceLine[], index: number): boolean {
  const line = lines[index];
  if (!line) return false;
  const text = line.text;
  if (matchFence(text) || isAtxHeading(text) || isThematicBreak(text)) return true;
  if (isBlockquoteStart(text) || isListStart(text)) return true;
  if (htmlBlockStart(text)) return true;
  if (isTableStart(lines, index)) return true;
  return false;
}

function makeBlock(
  index: number,
  mdStart: number,
  mdEnd: number,
  kind: MarkdownBlockKind,
  contextSensitive: boolean,
): MarkdownBlock {
  return { index, mdStart, mdEnd, kind, contextSensitive };
}

function isEmptyMarkdownBlock(block: MarkdownBlock, markdown: string): boolean {
  return block.kind === 'paragraph'
    && block.mdEnd >= block.mdStart
    && markdown.slice(block.mdStart, block.mdEnd).trim() === '';
}

/**
 * Scan top-level Markdown blocks without parsing inline Markdown.
 *
 * Blank lines separate blocks and are not returned, except that:
 *
 * - an empty or whitespace-only document produces one empty paragraph span;
 * - a run of two or more blank lines between blocks produces one zero-width
 *   empty paragraph span at the run start, so a ProseMirror empty paragraph can
 *   still be represented;
 * - a trailing blank run produces no span because serialized Markdown drops it.
 */
export function scanMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const source = typeof markdown === 'string' ? markdown : '';
  if (source.trim() === '') {
    return [makeBlock(0, 0, source.length, 'paragraph', false)];
  }

  const lines = splitLines(source);
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]!;

    if (isBlankLine(line.text)) {
      const runStart = index;
      let runEnd = index;
      while (runEnd < lines.length && isBlankLine(lines[runEnd]!.text)) runEnd += 1;
      if (runEnd < lines.length && runEnd - runStart >= 2) {
        const at = lines[runStart]!.start;
        blocks.push(makeBlock(blocks.length, at, at, 'paragraph', false));
      }
      index = runEnd;
      continue;
    }

    const fence = matchFence(line.text);
    if (fence) {
      let cursor = index + 1;
      let end = index;
      let closing = false;
      while (cursor < lines.length) {
        end = cursor;
        const candidate = matchFence(lines[cursor]!.text);
        if (candidate && closesFence(candidate, fence)) {
          closing = true;
          break;
        }
        cursor += 1;
      }
      const mdEnd = closing ? lines[end]!.contentEnd : source.length;
      blocks.push(makeBlock(blocks.length, line.start, mdEnd, 'fenced-code', false));
      index = closing ? end + 1 : lines.length;
      continue;
    }

    if (isAtxHeading(line.text)) {
      blocks.push(makeBlock(
        blocks.length,
        line.start,
        line.contentEnd,
        'heading',
        false,
      ));
      index += 1;
      continue;
    }

    if (isThematicBreak(line.text)) {
      blocks.push(makeBlock(blocks.length, line.start, line.contentEnd, 'hr', false));
      index += 1;
      continue;
    }

    if (isBlockquoteStart(line.text)) {
      const firstContent = quoteContent(line.text);
      const alert = /^\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.test(firstContent);
      let cursor = index;
      let last = index;
      let sawBlank = false;

      while (cursor < lines.length) {
        const current = lines[cursor]!;
        if (isBlockquoteStart(current.text)) {
          last = cursor;
          sawBlank = false;
          cursor += 1;
          continue;
        }
        if (isBlankLine(current.text)) {
          let next = cursor + 1;
          while (next < lines.length && isBlankLine(lines[next]!.text)) next += 1;
          if (next < lines.length && isBlockquoteStart(lines[next]!.text)) {
            sawBlank = true;
            cursor = next;
            continue;
          }
          break;
        }
        if (!sawBlank && !startsTopLevelBlock(lines, cursor)) {
          last = cursor;
          cursor += 1;
          continue;
        }
        break;
      }

      blocks.push(makeBlock(
        blocks.length,
        line.start,
        lines[last]!.contentEnd,
        alert ? 'alert' : 'blockquote',
        true,
      ));
      index = cursor;
      continue;
    }

    if (isListStart(line.text)) {
      let cursor = index;
      let last = index;
      let sawBlank = false;

      while (cursor < lines.length) {
        const current = lines[cursor]!;
        if (isBlankLine(current.text)) {
          let next = cursor + 1;
          while (next < lines.length && isBlankLine(lines[next]!.text)) next += 1;
          if (
            next < lines.length
            && (isListStart(lines[next]!.text) || indentWidth(lines[next]!.text) >= 2)
          ) {
            sawBlank = true;
            cursor = next;
            continue;
          }
          break;
        }
        if (isListStart(current.text) || indentWidth(current.text) >= 2) {
          last = cursor;
          sawBlank = false;
          cursor += 1;
          continue;
        }
        if (!sawBlank && !startsTopLevelBlock(lines, cursor)) {
          last = cursor;
          cursor += 1;
          continue;
        }
        break;
      }

      blocks.push(makeBlock(
        blocks.length,
        line.start,
        lines[last]!.contentEnd,
        'list',
        true,
      ));
      index = cursor;
      continue;
    }

    if (isTableStart(lines, index)) {
      let cursor = index + 2;
      let last = index + 1;
      while (cursor < lines.length) {
        const current = lines[cursor]!;
        if (isBlankLine(current.text) || !current.text.includes('|')) break;
        last = cursor;
        cursor += 1;
      }
      blocks.push(makeBlock(
        blocks.length,
        line.start,
        lines[last]!.contentEnd,
        'table',
        true,
      ));
      index = cursor;
      continue;
    }

    const html = htmlBlockStart(line.text);
    if (html) {
      const end = findHtmlEnd(lines, index, html);
      blocks.push(makeBlock(
        blocks.length,
        line.start,
        lines[end]!.contentEnd,
        'html',
        true,
      ));
      index = end + 1;
      continue;
    }

    if (indentWidth(line.text) >= 4) {
      let cursor = index;
      let last = index;
      while (cursor < lines.length) {
        const current = lines[cursor]!;
        if (isBlankLine(current.text)) {
          let next = cursor + 1;
          while (next < lines.length && isBlankLine(lines[next]!.text)) next += 1;
          if (next < lines.length && indentWidth(lines[next]!.text) >= 4) {
            cursor = next;
            continue;
          }
          break;
        }
        if (indentWidth(current.text) < 4) break;
        last = cursor;
        cursor += 1;
      }
      blocks.push(makeBlock(
        blocks.length,
        line.start,
        lines[last]!.contentEnd,
        'unknown',
        true,
      ));
      index = cursor;
      continue;
    }

    let cursor = index;
    let last = index;
    let kind: MarkdownBlockKind = 'paragraph';

    while (cursor < lines.length) {
      const current = lines[cursor]!;
      if (isBlankLine(current.text)) break;

      if (cursor > index) {
        if (isSetextUnderline(current.text)) {
          last = cursor;
          kind = 'heading';
          cursor += 1;
          break;
        }
        if (startsTopLevelBlock(lines, cursor)) break;
      }

      last = cursor;
      cursor += 1;
    }

    blocks.push(makeBlock(
      blocks.length,
      line.start,
      lines[last]!.contentEnd,
      kind,
      false,
    ));
    index = cursor;
  }

  return blocks;
}

function proseNodeName(node: ProseNodeLike | null | undefined): string {
  const name = node?.type?.name;
  return typeof name === 'string' ? name.toLowerCase() : '';
}

function normalizeProseBlocks(source: ProseDocumentInput | null | undefined): ProseBlock[] {
  if (!source) return [];

  const nodes: ProseNodeLike[] = [];
  if (Array.isArray(source)) {
    for (const node of source) nodes.push(node);
  } else {
    const document = source as ProseDocumentLike;
    if (typeof document.childCount === 'number' && typeof document.child === 'function') {
      for (let index = 0; index < document.childCount; index += 1) {
        try {
          nodes.push(document.child(index));
        } catch {
          // A malformed document contributes no block for this index.
        }
      }
    }
  }

  const blocks: ProseBlock[] = [];
  let position = 0;
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    const size = typeof node.nodeSize === 'number' && Number.isFinite(node.nodeSize)
      ? Math.max(0, node.nodeSize)
      : 0;
    blocks.push({
      index,
      node,
      pmStart: position,
      pmEnd: position + size,
    });
    position += size;
  }
  return blocks;
}

function isEmptyProseBlock(block: ProseBlock | null | undefined): boolean {
  if (!block) return false;
  const node = block.node;
  if (proseNodeName(node) !== 'paragraph') return false;
  if ((node.textContent ?? '') !== '') return false;
  return (node.childCount ?? 0) === 0;
}

function isCompatibleKind(kind: MarkdownBlockKind, nodeName: string): boolean {
  switch (kind) {
    case 'paragraph':
      return nodeName === 'paragraph';
    case 'heading':
      return nodeName === 'heading';
    case 'list':
      return nodeName === 'bullet_list'
        || nodeName === 'ordered_list'
        || nodeName === 'task_list'
        || nodeName === 'list';
    case 'blockquote':
      return nodeName === 'blockquote';
    case 'fenced-code':
      return nodeName === 'code_block' || nodeName === 'codeblock' || nodeName === 'fence';
    case 'table':
      return nodeName === 'table';
    case 'html':
      return nodeName === 'html'
        || nodeName === 'html_block'
        || nodeName === 'details'
        || nodeName === 'div';
    case 'alert':
      return nodeName === 'blockquote'
        || nodeName === 'alert'
        || nodeName === 'callout';
    case 'hr':
      return nodeName === 'horizontal_rule'
        || nodeName === 'hr'
        || nodeName === 'thematic_break';
    case 'unknown':
      return false;
    default:
      return false;
  }
}

function alignedBlock(
  block: MarkdownBlock,
  prose: ProseBlock,
  match: BlockMatch,
  synthesized: boolean,
): AlignedMarkdownBlock {
  return {
    index: block.index,
    mdStart: block.mdStart,
    mdEnd: block.mdEnd,
    kind: block.kind,
    contextSensitive: block.contextSensitive,
    node: prose.node,
    pmIndex: prose.index,
    pmStart: prose.pmStart,
    pmEnd: prose.pmEnd,
    match,
    synthesized,
  };
}

function synthesizedEmptyBlock(
  index: number,
  at: number,
): MarkdownBlock {
  return {
    index,
    mdStart: at,
    mdEnd: at,
    kind: 'paragraph',
    contextSensitive: false,
  };
}

/**
 * Align scanner spans with top-level ProseMirror nodes, in order.
 *
 * A match requires a compatible block kind. `unknown` blocks are paired by
 * order only and mark the result unreliable; incompatible kinds or unequal
 * non-empty counts return `null`. Empty paragraphs are handled explicitly:
 * blank-run spans may be skipped when the prose document has no empty block,
 * and an empty prose paragraph may receive a synthesized zero-width Markdown
 * span at the next block boundary (or the document end).
 */
export function alignBlocks(
  markdown: string,
  prose: ProseDocumentInput | null | undefined,
): BlockAlignment | null {
  const source = typeof markdown === 'string' ? markdown : '';
  const markdownBlocks = scanMarkdownBlocks(source);
  const proseBlocks = normalizeProseBlocks(prose);

  if (source.trim() !== '' && proseBlocks.length === 0) return null;
  if (source.trim() === '' && proseBlocks.some((block) => !isEmptyProseBlock(block))) {
    return null;
  }

  const blocks: AlignedMarkdownBlock[] = [];
  const skippedMarkdown: MarkdownBlock[] = [];
  let markdownIndex = 0;
  let proseIndex = 0;

  while (markdownIndex < markdownBlocks.length || proseIndex < proseBlocks.length) {
    const markdownBlock = markdownBlocks[markdownIndex];
    const proseBlock = proseBlocks[proseIndex];

    if (!proseBlock) {
      if (markdownBlock && isEmptyMarkdownBlock(markdownBlock, source)) {
        skippedMarkdown.push(markdownBlock);
        markdownIndex += 1;
        continue;
      }
      return null;
    }

    if (!markdownBlock) {
      if (isEmptyProseBlock(proseBlock)) {
        const empty = synthesizedEmptyBlock(blocks.length, source.length);
        blocks.push(alignedBlock(empty, proseBlock, 'empty', true));
        proseIndex += 1;
        continue;
      }
      return null;
    }

    if (isEmptyMarkdownBlock(markdownBlock, source)) {
      if (isEmptyProseBlock(proseBlock)) {
        blocks.push(alignedBlock(markdownBlock, proseBlock, 'empty', false));
        markdownIndex += 1;
        proseIndex += 1;
        continue;
      }
      // Blank-run spans are formatting, not content. A document with an empty
      // paragraph in the middle of two blank lines is handled above.
      skippedMarkdown.push(markdownBlock);
      markdownIndex += 1;
      continue;
    }

    if (isEmptyProseBlock(proseBlock)) {
      const empty = synthesizedEmptyBlock(blocks.length, markdownBlock.mdStart);
      blocks.push(alignedBlock(empty, proseBlock, 'empty', true));
      proseIndex += 1;
      continue;
    }

    const nodeName = proseNodeName(proseBlock.node);
    if (isCompatibleKind(markdownBlock.kind, nodeName)) {
      blocks.push(alignedBlock(markdownBlock, proseBlock, 'kind', false));
      markdownIndex += 1;
      proseIndex += 1;
      continue;
    }

    if (markdownBlock.kind === 'unknown') {
      blocks.push(alignedBlock(markdownBlock, proseBlock, 'order', false));
      markdownIndex += 1;
      proseIndex += 1;
      continue;
    }

    return null;
  }

  return {
    blocks,
    skippedMarkdown,
    reliable: blocks.every((block) => block.match !== 'order' && !block.synthesized),
  };
}

/** Half-open Markdown range for a block. */
export function markdownRange(block: MarkdownBlock): BlockRange {
  return { from: block.mdStart, to: block.mdEnd };
}

/** Half-open ProseMirror range for a block. */
export function pmRange(block: ProseBlock | AlignedMarkdownBlock): BlockRange {
  return { from: block.pmStart, to: block.pmEnd };
}

function findMarkdownBlock(
  blocks: readonly MarkdownBlock[],
  offset: number,
): MarkdownBlock | null {
  if (!Number.isFinite(offset) || blocks.length === 0) return null;
  const target = Math.max(0, Math.trunc(offset));
  let previous: MarkdownBlock | null = null;
  let emptyAt: MarkdownBlock | null = null;

  for (const block of blocks) {
    if (target >= block.mdStart && target < block.mdEnd) return block;
    if (block.mdStart === block.mdEnd && target === block.mdStart) {
      emptyAt ??= block;
    }
    if (target < block.mdStart) {
      // The caret at the end of a block belongs to that block when the next
      // block starts after a separator. At an exact shared boundary the next
      // block is selected by the containment check above.
      return previous && target === previous.mdEnd ? previous : null;
    }
    previous = block;
  }

  const last = blocks[blocks.length - 1]!;
  if (target >= last.mdEnd) return last;
  return emptyAt;
}

function findProseBlock(
  blocks: readonly ProseBlock[],
  position: number,
): ProseBlock | null {
  if (!Number.isFinite(position) || blocks.length === 0) return null;
  const target = Math.max(0, Math.trunc(position));
  let emptyAt: ProseBlock | null = null;

  for (const block of blocks) {
    if (target >= block.pmStart && target < block.pmEnd) return block;
    if (block.pmStart === block.pmEnd && target === block.pmStart) {
      emptyAt ??= block;
    }
    if (target < block.pmStart) break;
  }

  if (emptyAt) return emptyAt;
  const last = blocks[blocks.length - 1]!;
  return target >= last.pmEnd ? last : null;
}

/** Find the Markdown block containing an offset, or the last block at EOF. */
export function blockAtMarkdown(
  source: string,
  offset: number,
): MarkdownBlock | null;
export function blockAtMarkdown(
  source: readonly MarkdownBlock[],
  offset: number,
): MarkdownBlock | null;
export function blockAtMarkdown(
  source: BlockAlignment,
  offset: number,
): AlignedMarkdownBlock | null;
export function blockAtMarkdown(
  source: string | readonly MarkdownBlock[] | BlockAlignment,
  offset: number,
): MarkdownBlock | AlignedMarkdownBlock | null {
  const blocks: readonly MarkdownBlock[] = typeof source === 'string'
    ? scanMarkdownBlocks(source)
    : Array.isArray(source)
      ? source
      : (source as BlockAlignment | null)?.blocks ?? [];
  return findMarkdownBlock(blocks, offset);
}

/** Find the top-level ProseMirror block containing a document position. */
export function blockAtPm(
  source: ProseDocumentInput,
  position: number,
): ProseBlock | null;
export function blockAtPm(
  source: BlockAlignment,
  position: number,
): AlignedMarkdownBlock | null;
export function blockAtPm(
  source: ProseDocumentInput | BlockAlignment,
  position: number,
): ProseBlock | AlignedMarkdownBlock | null {
  if (!source) return null;
  const blocks = Array.isArray(source)
    ? normalizeProseBlocks(source)
    : typeof (source as ProseDocumentLike).child === 'function'
      ? normalizeProseBlocks(source as ProseDocumentLike)
      : (source as BlockAlignment).blocks ?? [];
  return findProseBlock(blocks, position);
}

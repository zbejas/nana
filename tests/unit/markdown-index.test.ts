import { describe, expect, test } from 'bun:test';
import {
  alignBlocks,
  blockAtMarkdown,
  blockAtPm,
  markdownRange,
  pmRange,
  scanMarkdownBlocks,
  type MarkdownBlock,
  type ProseDocumentLike,
  type ProseNodeLike,
} from '../../src/lib/collaboration/markdownIndex';

function node(name: string, text = '', nodeSize = text.length + 2): ProseNodeLike {
  return {
    type: { name },
    nodeSize,
    textContent: text,
    childCount: 0,
  };
}

function docOf(...nodes: ProseNodeLike[]): ProseDocumentLike {
  return {
    childCount: nodes.length,
    child(index: number) {
      return nodes[index]!;
    },
  };
}

function kinds(markdown: string): string[] {
  return scanMarkdownBlocks(markdown).map((block) => block.kind);
}

function slices(markdown: string): string[] {
  return scanMarkdownBlocks(markdown).map((block) => markdown.slice(block.mdStart, block.mdEnd));
}

describe('scanMarkdownBlocks', () => {
  test('classifies a mixed top-level corpus in order', () => {
    const corpus = [
      '# Title',
      '',
      'Intro paragraph',
      'on two lines.',
      '',
      '- First',
      '  - Nested',
      '- Second',
      '',
      '> Quoted line',
      '> continues',
      '',
      '```ts',
      'const x = 1;',
      '```',
      '',
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '<details>',
      '<summary>More</summary>',
      '',
      'Hidden **body**.',
      '',
      '</details>',
      '',
      '> [!NOTE]',
      '> Remember this.',
      '',
      '---',
      '',
      'Last paragraph.',
    ].join('\n');

    const blocks = scanMarkdownBlocks(corpus);

    expect(blocks.map((block) => block.kind)).toEqual([
      'heading',
      'paragraph',
      'list',
      'blockquote',
      'fenced-code',
      'table',
      'html',
      'alert',
      'hr',
      'paragraph',
    ]);
    expect(blocks.map((block) => block.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(blocks.map((block) => block.contextSensitive)).toEqual([
      false,
      false,
      true,
      true,
      false,
      true,
      true,
      true,
      false,
      false,
    ]);
    expect(blocks.map((block) => corpus.slice(block.mdStart, block.mdEnd))).toEqual([
      '# Title',
      'Intro paragraph\non two lines.',
      '- First\n  - Nested\n- Second',
      '> Quoted line\n> continues',
      '```ts\nconst x = 1;\n```',
      '| A | B |\n| --- | --- |\n| 1 | 2 |',
      '<details>\n<summary>More</summary>\n\nHidden **body**.\n\n</details>',
      '> [!NOTE]\n> Remember this.',
      '---',
      'Last paragraph.',
    ]);
  });

  test('recognizes ATX and setext headings', () => {
    expect(kinds('## Two ##\n\nTitle\n=====\n\nSub\n---')).toEqual([
      'heading',
      'heading',
      'heading',
    ]);
    expect(kinds('#Not a heading')).toEqual(['paragraph']);
    expect(kinds('Text\n---')).toEqual(['heading']);
    expect(kinds('---\nText')).toEqual(['hr', 'paragraph']);
  });

  test('keeps nested list items in one top-level block', () => {
    const markdown = '- One\n  - Two\n    1. Three\n- Four\n\nAfter';
    const blocks = scanMarkdownBlocks(markdown);

    expect(blocks.map((block) => block.kind)).toEqual(['list', 'paragraph']);
    expect(markdown.slice(blocks[0]!.mdStart, blocks[0]!.mdEnd))
      .toBe('- One\n  - Two\n    1. Three\n- Four');
    expect(blocks[0]!.contextSensitive).toBe(true);
  });

  test('keeps fenced code intact, including unclosed fences', () => {
    expect(kinds('~~~\na\n~~~\n\nAfter')).toEqual(['fenced-code', 'paragraph']);
    expect(kinds('```js\nconst x = 1;')).toEqual(['fenced-code']);
    expect(slices('~~~\na\n~~~\n\nAfter')).toEqual(['~~~\na\n~~~', 'After']);
  });

  test('recognizes GFM tables, alerts, HTML, and rules', () => {
    expect(kinds('| A | B |\n| :--- | ---: |\n| 1 | 2 |')).toEqual(['table']);
    expect(kinds('> [!WARNING]\n> Careful')).toEqual(['alert']);
    expect(kinds('> [!note]\n> Lowercase marker')).toEqual(['alert']);
    expect(kinds('> Plain quote')).toEqual(['blockquote']);
    expect(kinds('<details>\n<summary>More</summary>\n\nBody\n\n</details>'))
      .toEqual(['html']);
    expect(kinds('<span>Inline HTML</span> stays a paragraph')).toEqual(['paragraph']);
    expect(kinds('***\n\n___\n\n- - -')).toEqual(['hr', 'hr', 'hr']);
    expect(kinds('    indented code\n    next')).toEqual(['unknown']);
  });

  test('represents empty paragraphs without inventing normal separators', () => {
    const emptyDocument = scanMarkdownBlocks('');
    expect(emptyDocument).toEqual([
      {
        index: 0,
        mdStart: 0,
        mdEnd: 0,
        kind: 'paragraph',
        contextSensitive: false,
      },
    ]);

    const whitespace = scanMarkdownBlocks('  \n');
    expect(whitespace).toHaveLength(1);
    expect(whitespace[0]!.kind).toBe('paragraph');
    expect(whitespace[0]!.mdStart).toBe(0);
    expect(whitespace[0]!.mdEnd).toBe(3);

    expect(kinds('A\n\nB')).toEqual(['paragraph', 'paragraph']);

    const withEmpty = scanMarkdownBlocks('A\n\n\n\nB');
    expect(withEmpty.map((block) => block.kind)).toEqual([
      'paragraph',
      'paragraph',
      'paragraph',
    ]);
    expect(withEmpty[1]!.mdStart).toBe(withEmpty[1]!.mdEnd);
    expect('A\n\n\n\nB'.slice(withEmpty[1]!.mdStart, withEmpty[1]!.mdEnd)).toBe('');

    expect(kinds('A\n\n\n')).toEqual(['paragraph']);

    const afterList = scanMarkdownBlocks('- A\n\n\n\nB');
    expect(afterList.map((block) => block.kind)).toEqual([
      'list',
      'paragraph',
      'paragraph',
    ]);
    expect(afterList[1]!.mdStart).toBe(afterList[1]!.mdEnd);
  });

  test('does not deduplicate repeated block text', () => {
    const blocks = scanMarkdownBlocks('Same\n\nSame\n\nSame');
    expect(blocks).toHaveLength(3);
    expect(blocks.map((block) => block.kind)).toEqual([
      'paragraph',
      'paragraph',
      'paragraph',
    ]);
  });

  test('handles CRLF and trailing newlines', () => {
    const markdown = '# Title\r\n\r\nBody\r\n\r\n- One\r\n  - Two\r\n';
    expect(kinds(markdown)).toEqual(['heading', 'paragraph', 'list']);
    expect(slices(markdown)).toEqual([
      '# Title',
      'Body',
      '- One\r\n  - Two',
    ]);

    const blocks = scanMarkdownBlocks(markdown);
    expect(blocks[2]!.mdEnd).toBe(markdown.length - 2);

    expect(kinds('One\n')).toEqual(['paragraph']);
    expect(scanMarkdownBlocks('One\n')).toHaveLength(1);
  });

  test('tolerates non-string input', () => {
    expect(scanMarkdownBlocks(null as unknown as string)).toEqual([
      {
        index: 0,
        mdStart: 0,
        mdEnd: 0,
        kind: 'paragraph',
        contextSensitive: false,
      },
    ]);
  });
});

describe('alignBlocks', () => {
  const corpus = [
    '# Title',
    '',
    'Intro paragraph',
    'on two lines.',
    '',
    '- First',
    '  - Nested',
    '- Second',
    '',
    '> Quoted line',
    '> continues',
    '',
    '```ts',
    'const x = 1;',
    '```',
    '',
    '| A | B |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    '<details>',
    '<summary>More</summary>',
    '',
    'Hidden **body**.',
    '',
    '</details>',
    '',
    '> [!NOTE]',
    '> Remember this.',
    '',
    '---',
    '',
    'Last paragraph.',
  ].join('\n');

  test('pairs scanner spans with compatible top-level nodes', () => {
    const prose = docOf(
      node('heading', 'Title'),
      node('paragraph', 'Intro paragraph\non two lines.'),
      node('bullet_list', 'FirstNestedSecond', 24),
      node('blockquote', 'Quoted line\ncontinues', 24),
      node('code_block', 'const x = 1;', 16),
      node('table', 'AB12', 10),
      node('html_block', 'MoreHidden **body**.', 24),
      node('blockquote', '[!NOTE]\nRemember this.', 24),
      node('horizontal_rule', '', 1),
      node('paragraph', 'Last paragraph.'),
    );

    const alignment = alignBlocks(corpus, prose);
    expect(alignment).not.toBeNull();
    expect(alignment!.blocks).toHaveLength(10);
    expect(alignment!.blocks.map((block) => block.pmIndex))
      .toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(alignment!.blocks.map((block) => block.match))
      .toEqual(Array(10).fill('kind'));
    expect(alignment!.blocks.map((block) => block.contextSensitive)).toEqual([
      false,
      false,
      true,
      true,
      false,
      true,
      true,
      true,
      false,
      false,
    ]);
    expect(alignment!.blocks.every((block) => block.synthesized === false)).toBe(true);
    expect(alignment!.reliable).toBe(true);

    expect(pmRange(alignment!.blocks[0]!)).toEqual({ from: 0, to: 7 });
    expect(markdownRange(alignment!.blocks[1]!)).toEqual({
      from: corpus.indexOf('Intro'),
      to: corpus.indexOf('Intro') + 'Intro paragraph\non two lines.'.length,
    });
  });

  test('is conservative about incompatible kinds and counts', () => {
    expect(alignBlocks('# Heading', docOf(node('paragraph', 'Heading')))).toBeNull();
    expect(alignBlocks('One\n\nTwo', docOf(node('paragraph', 'One')))).toBeNull();
    expect(alignBlocks('One', docOf())).toBeNull();
  });

  test('falls back by order for unknown blocks and reports unreliability', () => {
    const alignment = alignBlocks('    indented code', docOf(node('code_block', 'indented code')));

    expect(alignment).not.toBeNull();
    expect(alignment!.blocks).toHaveLength(1);
    expect(alignment!.blocks[0]!.match).toBe('order');
    expect(alignment!.reliable).toBe(false);
  });

  test('pairs an empty document with an empty paragraph', () => {
    const alignment = alignBlocks('', docOf(node('paragraph', '')));

    expect(alignment).not.toBeNull();
    expect(alignment!.blocks).toHaveLength(1);
    expect(alignment!.blocks[0]!.match).toBe('empty');
    expect(alignment!.blocks[0]!.mdStart).toBe(0);
    expect(alignment!.blocks[0]!.mdEnd).toBe(0);
    expect(pmRange(alignment!.blocks[0]!)).toEqual({ from: 0, to: 2 });
    expect(alignment!.reliable).toBe(true);
  });

  test('pairs blank-run spans with an empty ProseMirror paragraph', () => {
    const markdown = 'A\n\n\n\nB';
    const alignment = alignBlocks(
      markdown,
      docOf(node('paragraph', 'A'), node('paragraph', ''), node('paragraph', 'B')),
    );

    expect(alignment).not.toBeNull();
    expect(alignment!.blocks).toHaveLength(3);
    expect(alignment!.blocks[1]!.match).toBe('empty');
    expect(alignment!.blocks[1]!.synthesized).toBe(false);
    expect(alignment!.blocks[1]!.mdStart).toBe(alignment!.blocks[1]!.mdEnd);
    expect(alignment!.reliable).toBe(true);
  });

  test('skips blank-run spans when the prose document has no empty block', () => {
    const alignment = alignBlocks(
      'A\n\n\n\nB',
      docOf(node('paragraph', 'A'), node('paragraph', 'B')),
    );

    expect(alignment).not.toBeNull();
    expect(alignment!.blocks).toHaveLength(2);
    expect(alignment!.skippedMarkdown).toHaveLength(1);
    expect(alignment!.reliable).toBe(true);
  });

  test('synthesizes a representable span for an empty paragraph without extra blanks', () => {
    const alignment = alignBlocks(
      'A\n\nB',
      docOf(node('paragraph', 'A'), node('paragraph', ''), node('paragraph', 'B')),
    );

    expect(alignment).not.toBeNull();
    expect(alignment!.blocks).toHaveLength(3);
    const empty = alignment!.blocks[1]!;
    expect(empty.match).toBe('empty');
    expect(empty.synthesized).toBe(true);
    expect(empty.mdStart).toBe(empty.mdEnd);
    expect(empty.mdStart).toBe('A\n\nB'.indexOf('B'));
    expect(alignment!.reliable).toBe(false);
  });
});

describe('block lookup helpers', () => {
  const markdown = 'A\n\n\n\nB\n\n# Heading';
  const blocks = scanMarkdownBlocks(markdown);

  test('finds blocks by Markdown offset and returns the last block at EOF', () => {
    expect(blockAtMarkdown(markdown, 0)).toMatchObject({ kind: 'paragraph', mdStart: 0 });
    expect(blockAtMarkdown(markdown, 1)).toMatchObject({ kind: 'paragraph', mdStart: 0 });
    expect(blockAtMarkdown(markdown, 3)).toBeNull();
    expect(blockAtMarkdown(blocks, markdown.length)?.kind).toBe('heading');
    expect(blockAtMarkdown([], 0)).toBeNull();
    expect(blockAtMarkdown(markdown, Number.NaN)).toBeNull();
  });

  test('uses alignment results for Markdown and ProseMirror lookups', () => {
    const alignment = alignBlocks(
      markdown,
      docOf(
        node('paragraph', 'A'),
        node('paragraph', ''),
        node('paragraph', 'B'),
        node('heading', 'Heading'),
      ),
    );
    expect(alignment).not.toBeNull();

    expect(blockAtMarkdown(alignment!, 0)?.pmIndex).toBe(0);
    expect(blockAtMarkdown(alignment!, markdown.indexOf('B'))?.pmIndex).toBe(2);
    expect(blockAtPm(alignment!, 0)?.pmIndex).toBe(0);
    expect(blockAtPm(alignment!, alignment!.blocks[1]!.pmStart)?.match).toBe('empty');
    expect(blockAtPm(alignment!, alignment!.blocks[3]!.pmEnd)?.pmIndex).toBe(3);
  });

  test('finds prose blocks directly from a document', () => {
    const prose = docOf(
      node('paragraph', 'A'),
      node('paragraph', 'B'),
    );

    expect(blockAtPm(prose, 0)?.index).toBe(0);
    expect(blockAtPm(prose, 3)?.index).toBe(1);
    expect(blockAtPm(prose, 7)?.index).toBe(1);
    expect(blockAtPm([], 0)).toBeNull();
  });

  test('reports half-open range helpers', () => {
    const block: MarkdownBlock = {
      index: 0,
      mdStart: 2,
      mdEnd: 7,
      kind: 'paragraph',
      contextSensitive: false,
    };
    expect(markdownRange(block)).toEqual({ from: 2, to: 7 });
    expect(pmRange({
      index: 0,
      node: node('paragraph', 'A'),
      pmStart: 4,
      pmEnd: 9,
    })).toEqual({ from: 4, to: 9 });
  });
});

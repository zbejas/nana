import { describe, expect, test } from 'bun:test';
import { Schema, type Node as ProseNode } from '@milkdown/kit/prose/model';
import { diffText, recomputeSourceAiDiff } from '../../src/components/editor/milkdown/aiDiff';
import {
  canonicalEditorMarkdown,
  isSameEditorMarkdown,
  planAiMarkdownApply,
  planWysiwygAiMarkdown,
} from '../../src/components/editor/milkdown/aiEdits';
import {
  aiDiffFallbackRanges,
  prosePositionAt,
  proseTextMap,
  proseTextOffsetAt,
} from '../../src/components/editor/milkdown/createEditor';
import {
  alignMarkdownToText,
  markdownOffsetToTextOffset,
  textOffsetToMarkdownOffset,
} from '../../src/lib/collaboration/text';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    text: { group: 'inline' },
  },
});

function paragraph(text = ''): ProseNode {
  return schema.nodes.paragraph!.create(null, text ? schema.text(text) : null);
}

function docOf(...nodes: ProseNode[]): ProseNode {
  return schema.nodes.doc!.create(null, nodes);
}

/** Position of the first content character inside a top-level block. */
function contentStart(doc: ProseNode, index: number): number {
  let position = 0;
  for (let child = 0; child < index; child += 1) {
    position += doc.child(child).nodeSize;
  }
  return position + 1;
}

describe('canonical editor Markdown', () => {
  test('treats extra blank lines, CRLF, and trailing newlines as the editor does', () => {
    expect(canonicalEditorMarkdown('one\r\n\r\n\r\n\r\ntwo\r\n\r\n')).toBe('one\n\ntwo');
    expect(isSameEditorMarkdown('one\n\n\n\ntwo', 'one\n\ntwo')).toBe(true);
    expect(isSameEditorMarkdown('one\r\n\r\n\r\ntwo\r\n', 'one\n\ntwo')).toBe(true);
  });

  test('rejects unrelated bodies and merged local text', () => {
    expect(isSameEditorMarkdown('one\n\ntwo', 'one\n\nthree')).toBe(false);
    expect(isSameEditorMarkdown(
      'Keep this.\n\nRemove me.\n\nTail.',
      'Keep this.\n\nRemove me.\n\nTail.\n\nLocal text that is not the event body.',
    )).toBe(false);
    expect(isSameEditorMarkdown(
      'Keep this.\n\nRemove me.\n\nTail.',
      'Keep this.\n\nTail.\n\nLocal merge that re-added a sentence.',
    )).toBe(false);
  });

  test('keeps blank lines inside fenced code significant', () => {
    const tight = 'Prose.\n\n```ts\none\n\ntwo\n```\n\nTail.';
    const loose = 'Prose.\n\n```ts\none\n\n\ntwo\n```\n\nTail.';

    expect(canonicalEditorMarkdown(loose)).toBe(loose);
    expect(isSameEditorMarkdown(loose, tight)).toBe(false);
    expect(isSameEditorMarkdown(
      'Prose.\n\n\n\n```ts\none\n\ntwo\n```\n\n\n\nTail.',
      tight,
    )).toBe(true);
    expect(canonicalEditorMarkdown('````md\n```\none\n\n\ntwo\n```\n````'))
      .toBe('````md\n```\none\n\n\ntwo\n```\n````');
  });

  test('recomputes source changes against the body the source pane holds', () => {
    // The event target and the source body are canonically equal but serialize
    // the blank run differently. Anchors must still land on the source string.
    expect(isSameEditorMarkdown('A\n\n\nB', 'A\n\nB')).toBe(true);
    expect(recomputeSourceAiDiff('A\n\nB', 'A\n\n\nB')).toEqual([
      { type: 'insert', start: 1, end: 1, text: '', block: true },
    ]);
    expect(recomputeSourceAiDiff('A\r\n\r\nB\r\n', 'A\r\n\r\n\r\nB')).toEqual([
      { type: 'insert', start: 1, end: 1, text: '', block: true },
    ]);
    expect(recomputeSourceAiDiff(
      'Keep this.\n\nRemove me.\n\nTail.',
      'Keep this.\n\nLocal merge.\n\nTail.',
    ).length).toBeGreaterThan(0);
  });
});

describe('planWysiwygAiMarkdown', () => {
  test('paints a replace_text deletion whose raw after keeps a blank-line run', () => {
    const before = '# Notes\n\nOpening paragraph.\n\nRemove this whole paragraph.\n\nClosing paragraph.';
    // `replace_text` deletes only the text, leaving both surrounding blank
    // lines (`\n\n\n\n`); the editor serializes the same body as `\n\n`.
    const rawAfter = before.replace('Remove this whole paragraph.', '');
    const editorMarkdown = before.replace('Remove this whole paragraph.\n\n', '');

    expect(rawAfter).toContain('Opening paragraph.\n\n\n\nClosing paragraph.');
    expect(editorMarkdown).toBe('# Notes\n\nOpening paragraph.\n\nClosing paragraph.');
    expect(isSameEditorMarkdown(editorMarkdown, rawAfter)).toBe(true);

    const plan = planWysiwygAiMarkdown({
      editorMarkdown,
      nextMarkdown: rawAfter,
      previousMarkdown: before,
      liveSession: true,
      matchesNext: true,
      matchesPrevious: false,
    });

    expect(plan.action).toBe('paint');
    if (plan.action !== 'paint') return;
    expect(plan.fallback).toBe(false);
    expect(plan.targetMarkdown).toBe(editorMarkdown);
    expect(plan.targetMarkdown).not.toBe(rawAfter);
    expect(plan.previousMarkdown).toBe(before);

    const changes = diffText(before, plan.targetMarkdown);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ type: 'delete', text: 'Remove this whole paragraph.' });
    expect(changes[0]!.start).toBeGreaterThanOrEqual(0);
    expect(changes[0]!.start).toBeLessThanOrEqual(plan.targetMarkdown.length);
  });

  test('paints two separated deletions in a long note against the editor body', () => {
    const paragraphs = Array.from({ length: 18 }, (_, index) =>
      `Unique${index} paragraph${index} contains${index} enough${index} distinct${index} `
      + `words${index} for${index} a${index} stable${index} token${index} diff${index}.`);
    const before = `# Long note\n\n${paragraphs.join('\n\n')}`;
    const removed = [paragraphs[4]!, paragraphs[13]!];
    const rawAfter = before
      .replace(removed[0]!, '')
      .replace(removed[1]!, '');
    const editorMarkdown = before
      .replace(`${removed[0]!}\n\n`, '')
      .replace(`${removed[1]!}\n\n`, '');

    expect(before.length).toBeGreaterThan(1_500);
    expect(isSameEditorMarkdown(editorMarkdown, rawAfter)).toBe(true);

    const plan = planWysiwygAiMarkdown({
      editorMarkdown,
      nextMarkdown: rawAfter,
      previousMarkdown: before,
      liveSession: true,
      matchesNext: true,
      matchesPrevious: false,
    });
    expect(plan.action).toBe('paint');
    if (plan.action !== 'paint') return;
    expect(plan.fallback).toBe(false);
    expect(plan.targetMarkdown).toBe(editorMarkdown);

    const changes = diffText(before, plan.targetMarkdown);
    expect(changes.map((change) => change.type)).toEqual(['delete', 'delete']);
    expect(changes.map((change) => change.text)).toEqual(removed);
  });

  test('falls back to a visible wash while the editor still holds the previous body', () => {
    const previous = 'Keep this.\n\nRemove me.\n\nTail.';
    const next = 'Keep this.\n\nTail.\n\n\n\nFresh closing.';

    const plan = planWysiwygAiMarkdown({
      editorMarkdown: previous,
      nextMarkdown: next,
      previousMarkdown: previous,
      liveSession: true,
      matchesNext: false,
      matchesPrevious: true,
      waitElapsed: true,
    });

    expect(plan).toMatchObject({
      action: 'paint',
      fallback: true,
      targetMarkdown: previous,
      previousMarkdown: previous,
    });
    if (plan.action !== 'paint') return;

    const doc = docOf(paragraph('Keep this.'), paragraph('Remove me.'), paragraph('Tail.'));
    const map = proseTextMap(doc);
    const changes = diffText(previous, plan.targetMarkdown);
    expect(changes).toEqual([]);
    const ranges = aiDiffFallbackRanges(doc, map, changes);
    expect(ranges.length).toBeGreaterThan(0);
    expect(ranges[0]!.to).toBeGreaterThan(ranges[0]!.from);
  });

  test('skips unrelated and merged local text after the wait', () => {
    const previous = 'Keep this.\n\nRemove me.\n\nTail.';
    const next = 'Keep this.\n\nTail.';
    const merged = 'Keep this.\n\nLocal replacement.\n\nTail.';

    expect(planWysiwygAiMarkdown({
      editorMarkdown: merged,
      nextMarkdown: next,
      previousMarkdown: previous,
      liveSession: true,
      matchesNext: false,
      matchesPrevious: false,
      waitElapsed: true,
    })).toEqual({ action: 'skip', reason: 'unrelated' });

    expect(planWysiwygAiMarkdown({
      editorMarkdown: 'Completely different body.',
      nextMarkdown: next,
      previousMarkdown: previous,
      liveSession: true,
      matchesNext: false,
      matchesPrevious: false,
      waitElapsed: false,
    })).toEqual({ action: 'wait' });
  });

  test('replaces only when the pane still holds the event-time body outside a room', () => {
    const previous = 'Keep this.\n\nRemove me.\n\nTail.';
    const next = 'Keep this.\n\nTail.';
    const plan = planWysiwygAiMarkdown({
      editorMarkdown: previous,
      nextMarkdown: next,
      previousMarkdown: previous,
      liveSession: false,
      matchesNext: false,
      matchesPrevious: true,
    });

    expect(plan).toEqual({
      action: 'replace',
      targetMarkdown: next,
      previousMarkdown: previous,
    });
  });
});

describe('planAiMarkdownApply', () => {
  test('paints only when a live room already holds the fetched body', () => {
    expect(planAiMarkdownApply({
      liveSession: true,
      matchesNext: true,
      matchesPrevious: false,
    })).toBe('decorate');
  });

  test('waits for a live room that has not delivered the fetched body yet', () => {
    expect(planAiMarkdownApply({
      liveSession: true,
      matchesNext: false,
      matchesPrevious: true,
    })).toBe('wait');
    expect(planAiMarkdownApply({
      liveSession: true,
      matchesNext: false,
      matchesPrevious: false,
    })).toBe('wait');
  });

  test('honors an explicit decoration-only edit outside a room', () => {
    expect(planAiMarkdownApply({
      liveSession: false,
      replace: false,
      matchesNext: true,
      matchesPrevious: true,
    })).toBe('decorate');
    expect(planAiMarkdownApply({
      liveSession: false,
      replace: false,
      matchesNext: false,
      matchesPrevious: false,
    })).toBe('wait');
    expect(planAiMarkdownApply({
      liveSession: false,
      replace: false,
      matchesNext: false,
      matchesPrevious: true,
    })).toBe('wait');
  });

  test('falls back after the bounded wait only when the previous body is related', () => {
    expect(planAiMarkdownApply({
      liveSession: true,
      matchesNext: false,
      matchesPrevious: true,
      waitElapsed: true,
    })).toBe('fallback');
    expect(planAiMarkdownApply({
      liveSession: false,
      replace: false,
      matchesNext: false,
      matchesPrevious: true,
      waitElapsed: true,
    })).toBe('fallback');
    expect(planAiMarkdownApply({
      liveSession: true,
      matchesNext: false,
      matchesPrevious: false,
      waitElapsed: true,
    })).toBe('skip');
  });

  test('replaces an unchanged note that still holds the event body', () => {
    expect(planAiMarkdownApply({
      liveSession: false,
      matchesNext: false,
      matchesPrevious: true,
    })).toBe('replace');
  });

  test('paints an already-applied fetched body without replacing it', () => {
    expect(planAiMarkdownApply({
      liveSession: false,
      matchesNext: true,
      matchesPrevious: false,
    })).toBe('decorate');
  });

  test('keeps local typing that diverged from the event body', () => {
    expect(planAiMarkdownApply({
      liveSession: false,
      matchesNext: false,
      matchesPrevious: false,
    })).toBe('skip');
  });
});

describe('prose text position mapping', () => {
  test('anchors a deletion at the start of the following paragraph, not after its first character', () => {
    const before = docOf(
      paragraph('KEEP-ALPHA'),
      paragraph('REMOVE-ONE'),
      paragraph('KEEP-BRAVO'),
      paragraph('REMOVE-TWO'),
      paragraph('Tail.'),
    );
    const after = docOf(paragraph('KEEP-ALPHA'), paragraph('KEEP-BRAVO'), paragraph('Tail.'));
    const afterMap = proseTextMap(after);
    const changes = diffText(proseTextMap(before).text, afterMap.text);

    expect(changes.map((change) => change.text)).toEqual(['REMOVE-ONE', 'REMOVE-TWO']);

    // The second deletion sits on the block separator in the new body, the
    // first on the next paragraph's first text offset. Both must resolve to
    // the paragraph start so the widget renders before its first letter.
    const first = prosePositionAt(afterMap, changes[0]!.start, 'next-block');
    const second = prosePositionAt(afterMap, changes[1]!.start, 'next-block');
    expect(after.resolve(first).parent.textContent).toBe('KEEP-BRAVO');
    expect(after.resolve(first).parentOffset).toBe(0);
    expect(after.resolve(second).parent.textContent).toBe('Tail.');
    expect(after.resolve(second).parentOffset).toBe(0);
  });

  test('keeps the end of a paragraph and the start of the next one distinct', () => {
    const doc = docOf(
      paragraph('KEEP-ALPHA'),
      paragraph('BRAVO'),
      paragraph('CHARLIE'),
      paragraph('Tail.'),
    );
    const map = proseTextMap(doc);
    const bravoEnd = contentStart(doc, 1) + doc.child(1).content.size;
    const charlieStart = contentStart(doc, 2);
    const endText = proseTextOffsetAt(map, bravoEnd);
    const startText = proseTextOffsetAt(map, charlieStart);

    expect(endText).not.toBe(startText);

    const previousEnd = prosePositionAt(map, endText, 'previous-text');
    const nextStart = prosePositionAt(map, startText, 'previous-text');
    expect(doc.resolve(previousEnd).parent.textContent).toBe('BRAVO');
    expect(doc.resolve(previousEnd).parentOffset).toBe(5);
    expect(doc.resolve(nextStart).parent.textContent).toBe('CHARLIE');
    expect(doc.resolve(nextStart).parentOffset).toBe(0);

    // Both offsets round-trip back to the same paragraph edge.
    expect(proseTextOffsetAt(map, previousEnd)).toBe(endText);
    expect(proseTextOffsetAt(map, nextStart)).toBe(startText);

    // An AI deletion at either side of the separator belongs before CHARLIE.
    expect(prosePositionAt(map, endText, 'next-block')).toBe(charlieStart);
    expect(prosePositionAt(map, startText, 'next-block')).toBe(charlieStart);
  });

  test('round-trips boundary carets through Markdown presence without collapsing them', () => {
    const doc = docOf(
      paragraph('KEEP-ALPHA'),
      paragraph('BRAVO'),
      paragraph('CHARLIE'),
      paragraph('Tail.'),
    );
    const markdown = 'KEEP-ALPHA\n\nBRAVO\n\nCHARLIE\n\nTail.';
    const map = proseTextMap(doc);
    const segments = alignMarkdownToText(markdown, map.text);
    const projectPresence = (position: number): number | null => {
      const textOffset = proseTextOffsetAt(map, position);
      const markdownOffset = textOffsetToMarkdownOffset(segments, textOffset);
      const received = markdownOffset === null
        ? null
        : markdownOffsetToTextOffset(segments, markdownOffset);
      return received === null ? null : prosePositionAt(map, received, 'previous-text');
    };

    const bravoEnd = contentStart(doc, 1) + doc.child(1).content.size;
    const charlieStart = contentStart(doc, 2);

    expect(projectPresence(bravoEnd)).toBe(bravoEnd);
    expect(projectPresence(charlieStart)).toBe(charlieStart);
  });

  test('keeps inline text offsets on their original characters', () => {
    const doc = docOf(paragraph('alpha beta'), paragraph('gamma'));
    const map = proseTextMap(doc);

    expect(map.text).toBe('alpha beta\ngamma');
    expect(prosePositionAt(map, 0)).toBe(1);
    expect(prosePositionAt(map, 5)).toBe(6);
    expect(prosePositionAt(map, 10)).toBe(13);
    expect(doc.resolve(prosePositionAt(map, 5)).parentOffset).toBe(5);

    const start = doc.resolve(prosePositionAt(map, 0, 'next-block'));
    const end = doc.resolve(prosePositionAt(map, map.text.length, 'next-block'));
    expect(start.parent.textContent).toBe('alpha beta');
    expect(start.parentOffset).toBe(0);
    expect(end.parent.textContent).toBe('gamma');
    expect(end.parentOffset).toBe(5);
  });
});

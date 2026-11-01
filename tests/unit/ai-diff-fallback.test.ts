import { describe, expect, test } from 'bun:test';
import { Schema, type Node as ProseNode } from '@milkdown/kit/prose/model';
import { diffText } from '../../src/components/editor/milkdown/aiDiff';
import { aiDiffFallbackRanges, proseTextMap } from '../../src/components/editor/milkdown/createEditor';

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

describe('AI diff fallback ranges', () => {
  test('maps separated deletions to the blocks that remain in the new body', () => {
    const before = docOf(
      paragraph('one'),
      paragraph('remove me'),
      paragraph('middle'),
      paragraph('drop this'),
      paragraph('end'),
    );
    const after = docOf(paragraph('one'), paragraph('middle'), paragraph('end'));
    const changes = diffText(proseTextMap(before).text, proseTextMap(after).text);
    const ranges = aiDiffFallbackRanges(after, proseTextMap(after), changes);

    expect(changes.map((change) => change.type)).toEqual(['delete', 'delete']);
    expect(ranges).toHaveLength(2);
    expect(ranges[0]!.from).toBeLessThan(ranges[1]!.from);
  });

  test('washes the whole body when the diff produced no ranges', () => {
    const after = docOf(paragraph('one'), paragraph('two'), paragraph('three'));
    const ranges = aiDiffFallbackRanges(after, proseTextMap(after), []);

    expect(ranges).toHaveLength(3);
    expect(ranges[0]).toMatchObject({ from: 0 });
    expect(ranges[2]!.to).toBe(after.content.size);
  });

  test('still marks the empty block instead of painting nothing', () => {
    const empty = docOf(paragraph());
    expect(aiDiffFallbackRanges(empty, proseTextMap(empty), [])).toEqual([
      { from: 0, to: 2 },
    ]);
  });
});

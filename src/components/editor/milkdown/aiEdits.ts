import { editorViewCtx, type Editor } from '@milkdown/kit/core';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import { replaceEditorMarkdown, setAiHighlights, type AiHighlightRange } from './createEditor';

export interface AiChangedSection {
  heading?: string | null;
  path?: string[];
  from?: number;
  to?: number;
}

interface Block {
  from: number;
  to: number;
  level: number;
  keys: string[];
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function textOf(node: ProseMirrorNode): string {
  return normalize(node.textBetween(0, node.content.size, ' '));
}

/**
 * Walks the top-level blocks once, keeping the heading trail so a section can
 * be matched by its leaf heading or a `Parent > Child` path. Body blocks keep
 * level 0; a heading's level closes the previous section at the same or
 * shallower level.
 */
function blocksOf(doc: ProseMirrorNode): Block[] {
  const blocks: Block[] = [];
  const trail: Array<{ level: number; text: string }> = [];

  doc.forEach((node, offset) => {
    const from = offset;
    const to = offset + node.nodeSize;

    if (node.type.name !== 'heading') {
      blocks.push({ from, to, level: 0, keys: [] });
      return;
    }

    const level = Number(node.attrs.level) || 6;
    const text = textOf(node);
    while (trail.length > 0 && (trail[trail.length - 1]?.level ?? 0) >= level) {
      trail.pop();
    }
    const path = [...trail.map((item) => item.text), text].join(' > ');
    trail.push({ level, text });
    blocks.push({ from, to, level, keys: [text, path] });
  });

  return blocks;
}

function rangesFor(doc: ProseMirrorNode, sections: AiChangedSection[]): AiHighlightRange[] {
  if (sections.length === 0) return [];

  const blocks = blocksOf(doc);
  const ranges = new Map<string, AiHighlightRange>();

  for (const section of sections) {
    const wanted = section.heading ? normalize(section.heading) : '';
    const path = (section.path?.join(' > ') ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!wanted && !path) continue;

    const headingIndex = blocks.findIndex((block) => {
      if (block.level === 0) return false;
      return block.keys.includes(wanted) || (path ? block.keys.includes(path) : false);
    });
    if (headingIndex === -1) continue;

    const heading = blocks[headingIndex];
    if (!heading) continue;
    ranges.set(`${heading.from}:${heading.to}`, { from: heading.from, to: heading.to, heading: true });

    for (let index = headingIndex + 1; index < blocks.length; index += 1) {
      const block = blocks[index];
      if (!block) break;
      if (block.level > 0 && block.level <= heading.level) break;
      ranges.set(`${block.from}:${block.to}`, { from: block.from, to: block.to });
    }
  }

  if (ranges.size === 0 && blocks.length > 0) {
    // Appends and text replacements may not add a heading. Mark the final
    // block so the user still sees what changed.
    const last = blocks[blocks.length - 1];
    if (last) ranges.set(`${last.from}:${last.to}`, { from: last.from, to: last.to });
  }

  return [...ranges.values()].sort((left, right) => left.from - right.from);
}

/**
 * Replaces the editor document with the AI-applied Markdown and highlights the
 * changed sections through ProseMirror decorations. Scrolling and the fade are
 * owned by `setAiHighlights`.
 */
export function applyAiMarkdown(
  editor: Editor,
  markdown: string,
  sections: AiChangedSection[],
): void {
  editor.action((ctx) => replaceEditorMarkdown(ctx, markdown));
  const view = editor.action((ctx) => ctx.get(editorViewCtx));

  window.requestAnimationFrame(() => {
    if (view.isDestroyed) return;
    setAiHighlights(view, rangesFor(view.state.doc, sections));
  });
}

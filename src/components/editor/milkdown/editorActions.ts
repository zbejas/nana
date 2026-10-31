import type { Ctx } from '@milkdown/kit/ctx';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import type { EditorState } from '@milkdown/kit/prose/state';
import { commandsCtx, editorViewCtx } from '@milkdown/kit/core';
import {
  createCodeBlockCommand,
  insertHrCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  updateLinkCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark';
import {
  insertTableCommand,
  toggleStrikethroughCommand,
} from '@milkdown/kit/preset/gfm';
import { redoCommand, undoCommand } from '@milkdown/kit/plugin/history';
import { redoDepth, undoDepth } from '@milkdown/kit/prose/history';
import { TextSelection } from '@milkdown/kit/prose/state';
import type { EditorActionId } from './helpers';

export interface EditorToolbarState {
  paragraph: boolean;
  bold: boolean;
  italic: boolean;
  strike: boolean;
  inlineCode: boolean;
  link: boolean;
  headingLevel: 1 | 2 | 3 | null;
  bulletList: boolean;
  orderedList: boolean;
  taskList: boolean;
  quote: boolean;
  codeBlock: boolean;
  canUndo: boolean;
  canRedo: boolean;
  linkHref: string;
}

export const EMPTY_TOOLBAR_STATE: EditorToolbarState = {
  paragraph: false,
  bold: false,
  italic: false,
  strike: false,
  inlineCode: false,
  link: false,
  headingLevel: null,
  bulletList: false,
  orderedList: false,
  taskList: false,
  quote: false,
  codeBlock: false,
  canUndo: false,
  canRedo: false,
  linkHref: '',
};

interface AncestorMatch {
  node: ProseNode;
  pos: number;
  depth: number;
}

function findAncestor(state: EditorState, name: string): AncestorMatch | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === name) {
      return { node, pos: $from.before(depth), depth };
    }
  }
  return null;
}

/** Read the marks and blocks the toolbar needs without subscribing to docs. */
export function readToolbarState(state: EditorState): EditorToolbarState {
  const { $from } = state.selection;
  const marks = state.storedMarks ?? $from.marks();
  const hasMark = (name: string) => marks.some((mark) => mark.type.name === name);
  const linkMark = marks.find((mark) => mark.type.name === 'link');

  const listItem = findAncestor(state, 'list_item');
  const bullet = findAncestor(state, 'bullet_list');
  const ordered = findAncestor(state, 'ordered_list');

  let headingLevel: EditorToolbarState['headingLevel'] = null;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === 'heading') {
      const level = Number(node.attrs.level);
      headingLevel = level === 1 || level === 2 || level === 3 ? level : null;
      break;
    }
  }

  return {
    paragraph:
      !headingLevel &&
      !findAncestor(state, 'blockquote') &&
      !findAncestor(state, 'code_block') &&
      !bullet &&
      !ordered,
    bold: hasMark('strong'),
    italic: hasMark('emphasis'),
    strike: hasMark('strike_through'),
    inlineCode: hasMark('inlineCode'),
    link: Boolean(linkMark),
    headingLevel,
    bulletList: Boolean(bullet) && listItem?.node.attrs.checked == null && listItem?.node.attrs.listType !== 'ordered',
    orderedList: Boolean(ordered) || listItem?.node.attrs.listType === 'ordered',
    taskList: listItem?.node.attrs.checked != null,
    quote: Boolean(findAncestor(state, 'blockquote')),
    codeBlock: Boolean(findAncestor(state, 'code_block')),
    canUndo: undoDepth(state) > 0,
    canRedo: redoDepth(state) > 0,
    linkHref: typeof linkMark?.attrs.href === 'string' ? linkMark.attrs.href : '',
  };
}

function toggleTaskList(ctx: Ctx): void {
  const view = ctx.get(editorViewCtx);
  const existing = findAncestor(view.state, 'list_item');

  if (existing && existing.node.attrs.checked != null) {
    view.dispatch(
      view.state.tr.setNodeMarkup(existing.pos, undefined, {
        ...existing.node.attrs,
        checked: null,
      }),
    );
    return;
  }

  ctx.get(commandsCtx).call(wrapInBulletListCommand.key);

  const created = findAncestor(view.state, 'list_item');
  if (!created) return;
  view.dispatch(
    view.state.tr.setNodeMarkup(created.pos, undefined, {
      ...created.node.attrs,
      checked: false,
    }),
  );
}

/** Run a toolbar or slash-menu action against the current selection. */
export function runEditorAction(ctx: Ctx, action: EditorActionId): boolean {
  const commands = ctx.get(commandsCtx);

  switch (action) {
    case 'paragraph':
      return commands.call(turnIntoTextCommand.key);
    case 'heading-1':
      return commands.call(wrapInHeadingCommand.key, 1);
    case 'heading-2':
      return commands.call(wrapInHeadingCommand.key, 2);
    case 'heading-3':
      return commands.call(wrapInHeadingCommand.key, 3);
    case 'bold':
      return commands.call(toggleStrongCommand.key);
    case 'italic':
      return commands.call(toggleEmphasisCommand.key);
    case 'strike':
      return commands.call(toggleStrikethroughCommand.key);
    case 'inline-code':
      return commands.call(toggleInlineCodeCommand.key);
    case 'bullet-list':
      return commands.call(wrapInBulletListCommand.key);
    case 'ordered-list':
      return commands.call(wrapInOrderedListCommand.key);
    case 'task-list':
      toggleTaskList(ctx);
      return true;
    case 'quote':
      return commands.call(wrapInBlockquoteCommand.key);
    case 'code-block':
      return commands.call(createCodeBlockCommand.key);
    case 'divider':
      return commands.call(insertHrCommand.key);
    case 'table':
      return commands.call(insertTableCommand.key, { row: 3, col: 3 });
    case 'undo':
      return commands.call(undoCommand.key);
    case 'redo':
      return commands.call(redoCommand.key);
    case 'link':
      return false;
    default:
      return false;
  }
}

/**
 * Insert the link text (when the selection is empty) and apply the link mark.
 * The popover has focus, but ProseMirror keeps the document selection.
 */
export function applyLink(ctx: Ctx, href: string): boolean {
  const view = ctx.get(editorViewCtx);
  const commands = ctx.get(commandsCtx);

  if (view.state.selection.empty) {
    const { from } = view.state.selection;
    const text = href.replace(/^https?:\/\//i, '').replace(/^mailto:/i, '');
    if (text) {
      const tr = view.state.tr.insertText(text, from);
      tr.setSelection(TextSelection.create(tr.doc, from, from + text.length));
      view.dispatch(tr.scrollIntoView());
    }
  }

  const { from, to } = view.state.selection;
  let alreadyLinked = false;
  view.state.doc.nodesBetween(from, from === to ? to + 1 : to, (node) => {
    if (node.marks.some((mark) => mark.type.name === 'link')) {
      alreadyLinked = true;
      return false;
    }
    return true;
  });

  return commands.call(alreadyLinked ? updateLinkCommand.key : toggleLinkCommand.key, { href });
}

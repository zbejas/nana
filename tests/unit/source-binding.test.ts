import { describe, expect, test } from 'bun:test';
import { EditorState } from '@codemirror/state';
import type { EditorView, ViewUpdate } from '@codemirror/view';
import {
  COLLAB_LOCAL_ORIGIN,
  COLLAB_REMOTE_ORIGIN,
  COLLAB_RESET_ORIGIN,
  type CollabContentChange,
  type CollabSession,
} from '../../src/lib/collaboration/session';
import {
  applyOps,
  type CanonicalOp,
  type CodeMirrorChange,
} from '../../src/lib/collaboration/ops';
import {
  SOURCE_BINDING_ORIGIN,
  SourceBinding,
  collectSourceChanges,
  isRemoteSourceTransaction,
  opsFromSourceChanges,
  shouldApplySourceContent,
  sourceRemoteAnnotation,
} from '../../src/components/editor/milkdown/sourceBinding';

interface FakeChange {
  from: number;
  to: number;
  insert?: string;
}

function fakeDoc(value: string) {
  return { toString: () => value, length: value.length };
}

/** Minimal EditorView stand-in: a text snapshot plus recorded dispatches. */
function createFakeView(initial: string) {
  let text = initial;
  const dispatches: Array<{
    changes?: FakeChange;
    annotations?: readonly unknown[];
  }> = [];

  const view = {
    get state() {
      return { doc: fakeDoc(text) };
    },
    dispatch(spec: {
      changes?: FakeChange;
      annotations?: readonly unknown[];
      effects?: unknown;
    }) {
      dispatches.push(spec);
      if (spec.changes) {
        text = text.slice(0, spec.changes.from)
          + (spec.changes.insert ?? '')
          + text.slice(spec.changes.to);
      }
    },
  };

  return {
    view: view as unknown as EditorView,
    dispatches,
    text: () => text,
  };
}

/** Minimal CollabSession stand-in: one canonical string plus observers. */
function createFakeSession(initial: string) {
  let markdown = initial;
  const observers = new Set<(change: CollabContentChange) => void>();
  const applied: Array<{ ops: CanonicalOp[]; origin: unknown }> = [];

  const session = {
    get markdown() {
      return markdown;
    },
    applyLocalOps(ops: readonly CanonicalOp[], origin?: unknown) {
      applied.push({ ops: [...ops], origin });
      markdown = applyOps(markdown, ops);
    },
    observeContent(listener: (change: CollabContentChange) => void) {
      observers.add(listener);
      return () => {
        observers.delete(listener);
      };
    },
  };

  return {
    session: session as unknown as CollabSession,
    applied,
    emit(next: string, rawOrigin: unknown) {
      markdown = next;
      for (const observer of [...observers]) {
        observer({ markdown: next, origin: 'local', rawOrigin });
      }
    },
    observerCount: () => observers.size,
  };
}

/** Headless ViewUpdate carrying CodeMirror-style pre-transaction changes. */
function createFakeUpdate(options: {
  before: string;
  after: string;
  changes: FakeChange[];
  remote?: boolean;
}): ViewUpdate {
  const transaction = {
    annotation: (annotation: unknown) =>
      (options.remote && annotation === sourceRemoteAnnotation ? true : undefined),
  };

  return {
    docChanged: true,
    startState: { doc: fakeDoc(options.before) },
    state: { doc: fakeDoc(options.after) },
    changes: {
      iterChanges(callback: (
        fromA: number,
        toA: number,
        fromB: number,
        toB: number,
        inserted: { toString(): string },
      ) => void) {
        for (const change of options.changes) {
          callback(change.from, change.to, change.from, change.to, {
            toString: () => change.insert ?? '',
          });
        }
      },
    },
    transactions: [transaction],
  } as unknown as ViewUpdate;
}

describe('opsFromSourceChanges', () => {
  test('turns a collapsed insertion into one canonical insert', () => {
    const changes: CodeMirrorChange[] = [{ from: 5, to: 5, insert: 'hello' }];
    expect(opsFromSourceChanges(changes, 10)).toEqual([
      { type: 'insert', index: 5, text: 'hello' },
    ]);
  });

  test('turns a replacement into delete then insert', () => {
    const changes: CodeMirrorChange[] = [{ from: 2, to: 5, insert: 'xy' }];
    expect(opsFromSourceChanges(changes, 10)).toEqual([
      { type: 'delete', index: 2, length: 3 },
      { type: 'insert', index: 2, text: 'xy' },
    ]);
  });

  test('adjusts later changes by the delta of earlier ones', () => {
    const changes: CodeMirrorChange[] = [
      { from: 0, to: 0, insert: 'ab' },
      { from: 3, to: 4, insert: 'Z' },
    ];
    expect(opsFromSourceChanges(changes, 10)).toEqual([
      { type: 'insert', index: 0, text: 'ab' },
      { type: 'delete', index: 5, length: 1 },
      { type: 'insert', index: 5, text: 'Z' },
    ]);
  });

  test('clamps changes to the pre-transaction document length', () => {
    const changes: CodeMirrorChange[] = [{ from: 8, to: 20, insert: 'x' }];
    expect(opsFromSourceChanges(changes, 10)).toEqual([
      { type: 'delete', index: 8, length: 2 },
      { type: 'insert', index: 8, text: 'x' },
    ]);
  });

  test('drops no-op and malformed changes', () => {
    const changes: CodeMirrorChange[] = [
      { from: 1, to: 1, insert: '' },
      { from: Number.NaN, to: 2, insert: 'x' },
    ];
    expect(opsFromSourceChanges(changes, 10)).toEqual([]);
  });
});

describe('collectSourceChanges', () => {
  test('collects CodeMirror pre-transaction coordinates and stringifies Text', () => {
    const changes = {
      iterChanges(callback: (
        fromA: number,
        toA: number,
        fromB: number,
        toB: number,
        inserted: { toString(): string },
      ) => void) {
        callback(1, 3, 1, 5, { toString: () => 'ok' });
        callback(7, 7, 9, 9, { toString: () => '' });
      },
    };

    expect(collectSourceChanges(changes as never)).toEqual([
      { from: 1, to: 3, insert: 'ok' },
    ]);
  });
});

describe('real CodeMirror ChangeSet', () => {
  test('reads pre-transaction coordinates from EditorState updates', () => {
    const state = EditorState.create({ doc: 'hello world' });
    const transaction = state.update({
      changes: [
        { from: 0, to: 0, insert: '>> ' },
        { from: 6, to: 11, insert: 'there' },
      ],
    });

    const changes = collectSourceChanges(transaction.changes);
    expect(changes).toEqual([
      { from: 0, to: 0, insert: '>> ' },
      { from: 6, to: 11, insert: 'there' },
    ]);
    expect(opsFromSourceChanges(changes, state.doc.length)).toEqual([
      { type: 'insert', index: 0, text: '>> ' },
      { type: 'delete', index: 9, length: 5 },
      { type: 'insert', index: 9, text: 'there' },
    ]);
    expect(transaction.newDoc.toString()).toBe('>> hello there');
  });
});

describe('shouldApplySourceContent', () => {
  test('ignores the binding\'s own transactions', () => {
    expect(shouldApplySourceContent(
      { markdown: 'next', rawOrigin: SOURCE_BINDING_ORIGIN },
      'current',
    )).toBe(false);
  });

  test('ignores snapshots that exactly match the pane', () => {
    expect(shouldApplySourceContent(
      { markdown: 'same body', rawOrigin: COLLAB_REMOTE_ORIGIN },
      'same body',
    )).toBe(false);
  });

  test('applies a trailing-newline difference so positions stay aligned', () => {
    expect(shouldApplySourceContent(
      { markdown: 'same body\n', rawOrigin: COLLAB_REMOTE_ORIGIN },
      'same body',
    )).toBe(true);
  });

  test('applies other local, remote, and reset transactions', () => {
    for (const rawOrigin of [COLLAB_LOCAL_ORIGIN, COLLAB_REMOTE_ORIGIN, COLLAB_RESET_ORIGIN]) {
      expect(shouldApplySourceContent(
        { markdown: 'from the room', rawOrigin },
        'older text',
      )).toBe(true);
    }
  });
});

describe('SourceBinding', () => {
  test('aligns the pane to a non-empty canonical snapshot on attach', () => {
    const view = createFakeView('loaded draft');
    const session = createFakeSession('canonical body');
    const changes: string[] = [];

    const binding = new SourceBinding({
      view: view.view,
      session: session.session,
      onChange: (markdown) => changes.push(markdown),
    });

    expect(view.text()).toBe('canonical body');
    expect(view.dispatches).toHaveLength(1);
    expect(view.dispatches[0]?.annotations?.some(
      (annotation) => (annotation as { type?: unknown }).type === sourceRemoteAnnotation,
    )).toBe(true);
    expect(changes).toEqual([]);
    binding.destroy();
  });

  test('does not wipe a loaded pane with a fresh session\'s empty text', () => {
    const view = createFakeView('loaded note body');
    const session = createFakeSession('');

    const binding = new SourceBinding({ view: view.view, session: session.session });

    expect(view.text()).toBe('loaded note body');
    expect(view.dispatches).toHaveLength(0);
    binding.destroy();
  });

  test('applies remote snapshots without calling onChange', () => {
    const view = createFakeView('start');
    const session = createFakeSession('start');
    const changes: string[] = [];
    const binding = new SourceBinding({
      view: view.view,
      session: session.session,
      onChange: (markdown) => changes.push(markdown),
    });

    session.emit('start plus remote', COLLAB_REMOTE_ORIGIN);

    expect(view.text()).toBe('start plus remote');
    expect(changes).toEqual([]);
    binding.destroy();
  });

  test('does not re-apply its own transactions or identical snapshots', () => {
    const view = createFakeView('start');
    const session = createFakeSession('start');
    const binding = new SourceBinding({ view: view.view, session: session.session });

    session.emit('start plus own', SOURCE_BINDING_ORIGIN);
    session.emit('start', COLLAB_REMOTE_ORIGIN);

    expect(view.text()).toBe('start');
    expect(view.dispatches).toHaveLength(0);
    binding.destroy();
  });

  test('writes local changes as canonical ops before notifying onChange', () => {
    const view = createFakeView('start');
    const session = createFakeSession('start');
    const order: string[] = [];
    const binding = new SourceBinding({
      view: view.view,
      session: session.session,
      onChange: (markdown) => order.push(`change:${markdown}`),
    });

    binding.handleUpdate(createFakeUpdate({
      before: 'start',
      after: 'start!',
      changes: [{ from: 5, to: 5, insert: '!' }],
    }));

    expect(session.applied).toEqual([{
      ops: [{ type: 'insert', index: 5, text: '!' }],
      origin: SOURCE_BINDING_ORIGIN,
    }]);
    expect(order).toEqual(['change:start!']);
    binding.destroy();
  });

  test('ignores remote-annotated updates from the view listener', () => {
    const view = createFakeView('start');
    const session = createFakeSession('start');
    const changes: string[] = [];
    const binding = new SourceBinding({
      view: view.view,
      session: session.session,
      onChange: (markdown) => changes.push(markdown),
    });

    const update = createFakeUpdate({
      before: 'start',
      after: 'remote',
      changes: [{ from: 0, to: 5, insert: 'remote' }],
      remote: true,
    });
    expect(isRemoteSourceTransaction(update)).toBe(true);

    binding.handleUpdate(update);

    expect(session.applied).toEqual([]);
    expect(changes).toEqual([]);
    binding.destroy();
  });

  test('unsubscribes the observer when destroyed', () => {
    const view = createFakeView('start');
    const session = createFakeSession('start');
    const binding = new SourceBinding({ view: view.view, session: session.session });

    expect(session.observerCount()).toBe(1);
    binding.destroy();
    expect(session.observerCount()).toBe(0);

    session.emit('after destroy', COLLAB_REMOTE_ORIGIN);
    expect(view.text()).toBe('start');
    binding.destroy();
  });
});

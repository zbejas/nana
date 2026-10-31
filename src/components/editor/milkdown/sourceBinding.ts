/**
 * CodeMirror source-pane binding for a live {@link CollabSession}.
 *
 * The canonical note body is the room's `Y.Text`. This binding is the only
 * writer for the source pane in live mode:
 *
 * - A local CodeMirror transaction becomes ordered canonical operations and is
 *   applied to the session. The pane never diffs a full snapshot.
 * - A canonical transaction from any other origin (another pane, another
 *   writer, an AI write, a room reset) is applied to CodeMirror with a private
 *   annotation so the pane cannot echo it back into Yjs.
 * - `onChange` still fires for local edits so React state, stats, and AI diff
 *   state stay current. It never fires for remote content; the session already
 *   delivers that to the state hook.
 *
 * The module keeps the decision and conversion helpers pure so they are
 * testable without a DOM.
 */

import { Annotation, Transaction, type ChangeSet, type Text } from '@codemirror/state';
import type { EditorView, ViewUpdate } from '@codemirror/view';
import {
  opsFromCodeMirrorChanges,
  type CanonicalOp,
  type CodeMirrorChange,
} from '../../../lib/collaboration/ops';
import type {
  CollabContentChange,
  CollabSession,
} from '../../../lib/collaboration/session';
import { minimalTextChange } from '../../../lib/collaboration/text';

/**
 * Transaction origin owned by this binding. The session listener ignores
 * Markdown transactions carrying it, which is what stops a local keystroke
 * from being applied back into the pane as remote content.
 */
export const SOURCE_BINDING_ORIGIN = 'nana-source-binding';

/**
 * Marks a CodeMirror transaction applied from the canonical session. The
 * view's update listener checks it before treating a change as local input.
 */
export const sourceRemoteAnnotation = Annotation.define<boolean>();

export interface SourceBindingOptions {
  view: EditorView;
  session: CollabSession;
  /** Local-edit notification for React state; never called for remote text. */
  onChange?: (markdown: string) => void;
}

/** True when a view update was produced by {@link SourceBinding}. */
export function isRemoteSourceTransaction(update: ViewUpdate): boolean {
  return update.transactions.some(
    (transaction) => transaction.annotation(sourceRemoteAnnotation) === true,
  );
}

/**
 * Flatten a CodeMirror `ChangeSet` into the pre-transaction changes the
 * canonical-op converter expects. `iterChanges` reports `fromA`/`toA` in the
 * document before the transaction, which is exactly the coordinate space
 * {@link opsFromCodeMirrorChanges} consumes.
 */
export function collectSourceChanges(changes: ChangeSet): CodeMirrorChange[] {
  const collected: CodeMirrorChange[] = [];
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted: Text) => {
    const text = inserted.toString();
    if (fromA === toA && text.length === 0) return;
    collected.push({ from: fromA, to: toA, insert: text });
  });
  return collected;
}

/** Convert one transaction's changes into ordered canonical operations. */
export function opsFromSourceChanges(
  changes: readonly CodeMirrorChange[],
  documentLength: number,
): CanonicalOp[] {
  return opsFromCodeMirrorChanges(changes, documentLength);
}

/**
 * Decide whether an observed canonical snapshot must be written into the
 * pane. Own-origin transactions are echoes, and an exactly matching snapshot
 * is a no-op.
 *
 * The comparison is exact, not Markdown-normalized: canonical operations are
 * positional, so a pane that trails the room by a blank line would publish
 * future edits at the wrong offset.
 */
export function shouldApplySourceContent(
  change: Pick<CollabContentChange, 'markdown' | 'rawOrigin'>,
  currentMarkdown: string,
): boolean {
  if (change.rawOrigin === SOURCE_BINDING_ORIGIN) return false;
  return currentMarkdown !== change.markdown;
}

/**
 * One CodeMirror view attached to one live session. Construct it after the
 * view exists and call {@link destroy} in the same cleanup that destroys the
 * view; destroying also unsubscribes the content observer.
 */
export class SourceBinding {
  private readonly view: EditorView;
  private readonly session: CollabSession;
  private readonly onChange?: (markdown: string) => void;
  private readonly unsubscribe: () => void;
  private destroyed = false;

  constructor({ view, session, onChange }: SourceBindingOptions) {
    this.view = view;
    this.session = session;
    this.onChange = onChange;
    this.unsubscribe = session.observeContent((change) => this.handleContent(change));
    this.alignToSession();
  }

  /**
   * Handle a viewer update. Remote-annotated transactions are ignored here;
   * everything else is local input that belongs in the shared text.
   */
  handleUpdate(update: ViewUpdate): void {
    if (this.destroyed || !update.docChanged) return;
    if (isRemoteSourceTransaction(update)) return;

    const ops = opsFromSourceChanges(
      collectSourceChanges(update.changes),
      update.startState.doc.length,
    );
    if (ops.length === 0) return;

    const nextMarkdown = update.state.doc.toString();
    // Y.Text is written first; React only learns about the edit afterwards.
    this.session.applyLocalOps(ops, SOURCE_BINDING_ORIGIN);
    this.onChange?.(nextMarkdown);
  }

  /** Stop observing the session. Safe to call more than once. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsubscribe();
  }

  private handleContent(change: CollabContentChange): void {
    if (this.destroyed) return;
    const current = this.view.state.doc.toString();
    if (!shouldApplySourceContent(change, current)) return;
    this.applyRemote(change.markdown);
  }

  /**
   * Align the pane with the session on attach. A fresh session has not
   * received the room seed yet, so its text is empty while the pane already
   * shows the loaded note; applying that transient empty snapshot would wipe
   * the draft before the first sync. A genuine remote clear arrives through
   * the content observer and is applied there.
   */
  private alignToSession(): void {
    const canonical = this.session.markdown;
    const current = this.view.state.doc.toString();
    if (current === canonical) return;
    if (canonical.length === 0 && current.length > 0) return;
    this.applyRemote(canonical);
  }

  private applyRemote(markdown: string): void {
    const current = this.view.state.doc.toString();
    if (current === markdown) return;
    const change = minimalTextChange(current, markdown);
    if (!change) return;

    // A minimal splice maps the local selection through the remote edit
    // instead of replacing the document and collapsing the caret.
    this.view.dispatch({
      changes: change,
      annotations: [
        sourceRemoteAnnotation.of(true),
        Transaction.addToHistory.of(false),
      ],
    });
  }
}

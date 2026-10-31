/**
 * Contracts for transaction-level editor bindings.
 *
 * A binding is the bridge between one mounted native editor and the canonical
 * Markdown `Y.Text`. The bridge owns the Y.Text and decides which changes are
 * published; the native binding only turns canonical operations into one
 * native transaction (and native transactions back into canonical operations).
 *
 * These are type-only contracts. The WYSIWYG (Milkdown/ProseMirror) and
 * CodeMirror implementations will live beside their editor components and must
 * not import React state into this module.
 */

import type { BlockAlignment } from './markdownIndex';
import type { CanonicalOp } from './ops';

/** A selection in canonical Markdown coordinates. */
export interface MarkdownSelection {
  /** UTF-16 offset of the selection anchor. */
  readonly anchor: number;
  /** UTF-16 offset of the selection head. */
  readonly head: number;
}

/** Native editor kinds that can attach to the canonical document. */
export type EditorBindingKind = 'wysiwyg' | 'source';

/**
 * Where one canonical change came from.
 *
 * `wysiwyg` and `source` are local transactions and are published. `remote`,
 * `restore`, and `system` changes are applied to a native editor without being
 * echoed back to Y.Text. A native binding must retain this tag on the native
 * transaction it dispatches.
 */
export type EditorOrigin = EditorBindingKind | 'remote' | 'restore' | 'system';

/** Session metadata shared by every binding for one note/room incarnation. */
export interface BindingContext {
  /** Note id; useful for diagnostics and stale-handle checks. */
  readonly documentId: string;
  /** Collaboration-room epoch; a new epoch invalidates local alignment. */
  readonly epoch: string;
  /** True when the current user may publish edits. */
  readonly canEdit: boolean;
  /** Canonical Markdown at attach time. */
  readonly markdown: string;
  /** Canonical revision at attach time. */
  readonly revision: number;
  /** Coarse block alignment for `markdown`; null disables block-level mapping. */
  readonly alignment: BlockAlignment | null;
}

/** One canonical transaction to apply to, or report from, a native editor. */
export interface BindingChange {
  /** Canonical Markdown after `ops`. */
  readonly markdown: string;
  /**
   * Ordered operations. Every index refers to the document after the previous
   * operation, with UTF-16 offsets.
   */
  readonly ops: readonly CanonicalOp[];
  readonly origin: EditorOrigin;
  /** Revision produced by the canonical writer. */
  readonly revision: number;
  /** Alignment for the post-change Markdown, when available. */
  readonly alignment: BlockAlignment | null;
}

/** A mounted native editor attached to the canonical document. */
export interface BindingHandle {
  readonly kind: EditorBindingKind;

  /** Read the native selection in canonical Markdown offsets. */
  readSelection(): MarkdownSelection | null;

  /** Move the native selection to canonical Markdown offsets. */
  writeSelection(selection: MarkdownSelection): void;

  /**
   * Apply one canonical change as a single native transaction. The
   * transaction must carry `change.origin` so the bridge does not publish the
   * apply back as a local edit.
   *
   * Returns false when the operations cannot be represented transactionally
   * (for example, a context-sensitive block rewrite); the caller must then
   * reconcile the native document from `change.markdown`.
   */
  apply(change: BindingChange): boolean;

  /**
   * Replace the native document from a canonical snapshot. Used only after
   * `apply` returns false, on a room reset, or after loading a note.
   */
  reconcile(change: BindingChange): void;

  /** Remove native listeners. Safe to call more than once. */
  destroy(): void;
}

/**
 * Implemented by the future WYSIWYG and CodeMirror adapters.
 *
 * The host calls `attach` once a native view exists and then routes every
 * canonical change whose origin differs from this binding through the returned
 * handle. The binding never talks to PocketBase or the collaboration session.
 */
export interface EditorBinding {
  readonly kind: EditorBindingKind;

  /**
   * Attach to a mounted native editor. The adapter already owns the native
   * view/refs; `context` describes the canonical document state.
   */
  attach(context: BindingContext): BindingHandle;
}

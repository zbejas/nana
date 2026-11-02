/**
 * Milkdown ⇄ CollabSession binding.
 *
 * The live session owns one canonical Markdown string (one `Y.Text`). While a
 * session is attached, the WYSIWYG pane publishes the minimal splice between
 * the last canonical Markdown and its next serialized Markdown, and applies
 * every other transaction back into the ProseMirror document. The controlled
 * `value`/`onChange` snapshot path stays in charge when no session is present
 * (task descriptions, comments, and standalone editors).
 *
 * Origins are the echo guard. A local transaction is applied with
 * `WYSIWYG_BINDING_ORIGIN`; `observeContent` reports that raw origin
 * synchronously, and the binding ignores it because ProseMirror already shows
 * the edit. Every other origin — remote Yjs updates, a source-pane binding,
 * `applyLocalMarkdown()` for AI/restore/explicit writes, and reset — is
 * applied to Milkdown with document-change suppression and no `onChange`.
 *
 * This module is pure and headless so the rules can be unit tested without a
 * Milkdown view or a real Y.Doc.
 */

import type { CanonicalOp } from '../../../lib/collaboration/ops';
import { applyOps, opsFromMinimalTextChange } from '../../../lib/collaboration/ops';
import type { CollabContentChange } from '../../../lib/collaboration/session';
import { createLogger } from '../../../lib/logger';
import { normalizeMarkdown } from './helpers';

const logger = createLogger('WysiwygBinding');

/** Raw Yjs origin used only by the WYSIWYG pane's own ProseMirror edits. */
export const WYSIWYG_BINDING_ORIGIN = 'nana-collab-wysiwyg';

/**
 * The slice of `CollabSession` the binding needs. Keeping it structural makes
 * the binding testable with a fake session and avoids a second Y.Doc.
 */
export interface WysiwygSessionPort {
  readonly markdown: string;
  applyLocalOps(ops: readonly CanonicalOp[], origin?: unknown): void;
  observeContent(listener: (change: CollabContentChange) => void): () => void;
}

export type WysiwygApplyResult =
  | boolean
  | { applied: boolean; normalizationOnly?: boolean }
  | void;

export interface WysiwygBindingHost {
  /** Markdown currently rendered by the editor. */
  getMarkdown(): string;
  /**
   * Replace the editor document without publishing it back to the session.
   * A richer result distinguishes a structural apply from normalization-only
   * serialization; `false` means the editor could not become the target.
   */
  applyMarkdown(markdown: string): WysiwygApplyResult;
}

/**
 * Convert one local Markdown change into canonical operations.
 *
 * The caller keeps `lastCanonicalMarkdown` in sync with the session text, not
 * with the last React value. That is what makes the splice safe when the
 * source pane or a remote writer moved the canonical text between renders.
 */
export function wysiwygLocalOps(
  lastCanonicalMarkdown: string,
  nextMarkdown: string,
): CanonicalOp[] {
  const previous = normalizeMarkdown(lastCanonicalMarkdown);
  const next = normalizeMarkdown(nextMarkdown);
  if (previous === next) return [];
  return opsFromMinimalTextChange(previous, next);
}

/** True only for the WYSIWYG pane's own canonical transaction. */
export function isWysiwygBindingOrigin(rawOrigin: unknown): boolean {
  return rawOrigin === WYSIWYG_BINDING_ORIGIN;
}

/**
 * Every canonical transaction except this pane's own edit belongs in the
 * editor. Other panes use different origins, so their writes still apply here.
 */
export function shouldApplyWysiwygSessionChange(rawOrigin: unknown): boolean {
  return !isWysiwygBindingOrigin(rawOrigin);
}

/**
 * Initial editor Markdown in session mode. Before the first sync the session
 * has no canonical text yet, so the loaded `value` is the only safe fallback.
 */
export function initialWysiwygMarkdown(
  sessionMarkdown: string | null | undefined,
  value: string,
): string {
  const canonical = normalizeMarkdown(sessionMarkdown ?? '');
  return canonical.length > 0 ? canonical : normalizeMarkdown(value);
}

/**
 * Owns the origin/echo rule for one WYSIWYG pane and one session.
 *
 * Call `attach()` once the editor is ready, `publishLocal()` from the
 * document-change plugin, and `dispose()` on unmount or note switch.
 */
export class WysiwygSessionBinding {
  private unsubscribe: (() => void) | null = null;
  private lastCanonicalMarkdown: string;
  /** Editor body after the last remote/local apply, for divergence checks. */
  private lastEditorMarkdown: string;
  private applyFailed = false;
  private normalizationOnly = false;
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly session: WysiwygSessionPort,
    private readonly host: WysiwygBindingHost,
    initialMarkdown?: string,
  ) {
    this.lastCanonicalMarkdown = normalizeMarkdown(initialMarkdown ?? host.getMarkdown());
    this.lastEditorMarkdown = normalizeMarkdown(host.getMarkdown());
  }

  /** Last Markdown the WYSIWYG pane believes the canonical text contains. */
  get canonicalMarkdown(): string {
    return this.lastCanonicalMarkdown;
  }

  get attached(): boolean {
    return this.unsubscribe !== null;
  }

  /**
   * Subscribe and catch up. A pane that mounts after the room synced (or after
   * another pane edited) applies the existing canonical text with selection
   * preservation. An empty canonical text means the first sync has not
   * happened; the editor keeps the loaded value it was created with.
   */
  attach(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.session.observeContent(this.handleContent);

    const canonical = normalizeMarkdown(this.session.markdown);
    if (canonical.length === 0) {
      this.lastCanonicalMarkdown = normalizeMarkdown(this.host.getMarkdown());
      this.lastEditorMarkdown = this.lastCanonicalMarkdown;
      this.applyFailed = false;
      this.normalizationOnly = false;
      return;
    }
    this.applyRemote(canonical);
  }

  /**
   * Publish one local serialized Markdown value.
   *
   * Returns true when the local edit changed the canonical Markdown, so the
   * caller can update UI statistics and fire `onChange` once. The session
   * transaction uses the binding origin and is ignored by the observer below.
   */
  publishLocal(markdown: string): boolean {
    const normalized = normalizeMarkdown(markdown);
    const previous = this.lastCanonicalMarkdown;
    if (normalized === previous) return false;

    // A remote apply that could not reproduce the canonical target is retried
    // once on the next tick. If the retry also fails, the latch is cleared so
    // a failed apply can never swallow local typing forever.
    if (this.applyFailed) {
      logger.debug('Skipped a local publish while a diverged remote apply retries', {
        canonicalLength: previous.length,
        editorLength: this.lastEditorMarkdown.length,
      });
      return false;
    }

    let nextCanonical = normalized;
    let ops: CanonicalOp[];
    if (
      this.normalizationOnly
      && this.lastEditorMarkdown.length === previous.length
    ) {
      // The editor serializes the same structure with a different marker or
      // blank-line spelling. Diff the local edit against the editor's own
      // previous body, then apply that same edit to the canonical body so the
      // normalization is not written into Yjs.
      ops = opsFromMinimalTextChange(this.lastEditorMarkdown, normalized);
      nextCanonical = applyOps(previous, ops) as string;
    } else {
      ops = wysiwygLocalOps(previous, normalized);
    }

    // Update the baseline before applying so a synchronous observer callback
    // cannot see a stale canonical position.
    this.lastCanonicalMarkdown = nextCanonical;
    this.lastEditorMarkdown = normalized;
    this.normalizationOnly = normalized !== nextCanonical;
    if (ops.length > 0) this.session.applyLocalOps(ops, WYSIWYG_BINDING_ORIGIN);
    return true;
  }

  dispose(): void {
    const unsubscribe = this.unsubscribe;
    this.unsubscribe = null;
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
    unsubscribe?.();
  }

  private handleContent = (change: CollabContentChange): void => {
    if (!shouldApplyWysiwygSessionChange(change.rawOrigin)) return;
    this.applyRemote(change.markdown);
  };

  private applyRemote(markdown: string): void {
    const normalized = normalizeMarkdown(markdown);
    this.lastCanonicalMarkdown = normalized;
    if (normalized === normalizeMarkdown(this.host.getMarkdown())) {
      this.lastEditorMarkdown = normalized;
      this.applyFailed = false;
      this.normalizationOnly = false;
      this.clearRecovery();
      return;
    }
    const result = this.host.applyMarkdown(normalized);
    this.lastEditorMarkdown = normalizeMarkdown(this.host.getMarkdown());
    const applied = typeof result === 'boolean'
      ? result
      : result && typeof result === 'object'
        ? result.applied
        : undefined;
    const normalizationOnly = result && typeof result === 'object'
      ? result.normalizationOnly === true
      : false;
    // A real editor reports structural success. A host that does not return a
    // result (an older/test host) falls back to comparing its body.
    this.applyFailed = applied === undefined
      ? this.lastEditorMarkdown !== normalized
      : applied === false;
    this.normalizationOnly = !this.applyFailed
      && (normalizationOnly || this.lastEditorMarkdown !== normalized);
    if (this.applyFailed) {
      logger.debug('Remote Markdown did not reproduce the canonical body', {
        targetLength: normalized.length,
        editorLength: this.lastEditorMarkdown.length,
      });
      this.scheduleRecovery();
    } else {
      this.clearRecovery();
    }
  }

  /** One bounded repair attempt; never leaves a permanent publish latch. */
  private scheduleRecovery(): void {
    if (this.recoveryTimer) return;
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null;
      if (!this.applyFailed) return;
      const result = this.host.applyMarkdown(this.lastCanonicalMarkdown);
      const editor = normalizeMarkdown(this.host.getMarkdown());
      const applied = typeof result === 'boolean'
        ? result
        : result && typeof result === 'object'
          ? result.applied
          : editor === this.lastCanonicalMarkdown;
      if (applied || editor === this.lastCanonicalMarkdown) {
        this.lastEditorMarkdown = editor;
        this.applyFailed = false;
        this.normalizationOnly = editor !== this.lastCanonicalMarkdown;
        return;
      }
      // The conservative apply already ran inside the editor. Do not turn a
      // normalization edge into permanently dropped keystrokes.
      this.applyFailed = false;
      logger.debug('Cleared a remote-apply divergence latch after one retry');
    }, 0);
  }

  private clearRecovery(): void {
    if (!this.recoveryTimer) return;
    clearTimeout(this.recoveryTimer);
    this.recoveryTimer = null;
  }
}

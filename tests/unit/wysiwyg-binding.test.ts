import { describe, expect, test } from 'bun:test';
import type { CanonicalOp } from '../../src/lib/collaboration/ops';
import { applyOps } from '../../src/lib/collaboration/ops';
import type { CollabContentChange } from '../../src/lib/collaboration/session';
import {
  WYSIWYG_BINDING_ORIGIN,
  WysiwygSessionBinding,
  initialWysiwygMarkdown,
  isWysiwygBindingOrigin,
  shouldApplyWysiwygSessionChange,
  wysiwygLocalOps,
  type WysiwygBindingHost,
  type WysiwygSessionPort,
} from '../../src/components/editor/milkdown/wysiwygBinding';

const LOCAL_ORIGIN = 'nana-collab-local';
const REMOTE_ORIGIN = 'nana-collab-remote';
const SOURCE_ORIGIN = 'nana-collab-source';

class FakeSession implements WysiwygSessionPort {
  markdown = '';
  readonly localOps: Array<{ ops: readonly CanonicalOp[]; origin: unknown }> = [];
  private readonly listeners = new Set<(change: CollabContentChange) => void>();

  applyLocalOps(ops: readonly CanonicalOp[], origin?: unknown): void {
    if (ops.length === 0) return;
    this.localOps.push({ ops, origin });
    this.markdown = applyOps(this.markdown, ops) as string;
    // Yjs fires `observeContent` synchronously inside the transaction.
    this.emit({
      markdown: this.markdown,
      origin: 'local',
      rawOrigin: origin,
    });
  }

  observeContent(listener: (change: CollabContentChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(change: CollabContentChange): void {
    for (const listener of [...this.listeners]) listener(change);
  }
}

class FakeHost implements WysiwygBindingHost {
  readonly applied: string[] = [];
  ignoreApply = false;
  normalizeTo: string | null = null;
  resultOverride: { applied: boolean; normalizationOnly?: boolean } | null = null;

  constructor(public markdown: string) {}

  getMarkdown(): string {
    return this.markdown;
  }

  applyMarkdown(markdown: string): boolean | { applied: boolean; normalizationOnly?: boolean } {
    this.applied.push(markdown);
    if (this.ignoreApply) return false;
    this.markdown = this.normalizeTo ?? markdown;
    return this.resultOverride ?? true;
  }
}

function change(markdown: string, rawOrigin: unknown): CollabContentChange {
  return { markdown, origin: 'local', rawOrigin };
}

describe('wysiwygLocalOps', () => {
  test('builds the minimal splice against the canonical Markdown', () => {
    expect(wysiwygLocalOps('Hello world', 'Hello brave world')).toEqual([
      { type: 'insert', index: 6, text: 'brave ' },
    ]);
    expect(wysiwygLocalOps('Hello world', 'Hello')).toEqual([
      { type: 'delete', index: 5, length: 6 },
    ]);
    expect(wysiwygLocalOps('one two', 'one THREE')).toEqual([
      { type: 'delete', index: 4, length: 3 },
      { type: 'insert', index: 4, text: 'THREE' },
    ]);
  });

  test('ignores no-ops and normalizes line endings/trailing blank lines', () => {
    expect(wysiwygLocalOps('same', 'same')).toEqual([]);
    expect(wysiwygLocalOps('same\r\n\r\n', 'same')).toEqual([]);
  });
});

describe('origin rule', () => {
  test('recognizes only this pane origin', () => {
    expect(isWysiwygBindingOrigin(WYSIWYG_BINDING_ORIGIN)).toBe(true);
    expect(isWysiwygBindingOrigin(LOCAL_ORIGIN)).toBe(false);
    expect(isWysiwygBindingOrigin(REMOTE_ORIGIN)).toBe(false);
    expect(isWysiwygBindingOrigin(undefined)).toBe(false);
  });

  test('applies every session change except this pane own transaction', () => {
    expect(shouldApplyWysiwygSessionChange(WYSIWYG_BINDING_ORIGIN)).toBe(false);
    expect(shouldApplyWysiwygSessionChange(REMOTE_ORIGIN)).toBe(true);
    expect(shouldApplyWysiwygSessionChange(LOCAL_ORIGIN)).toBe(true);
    expect(shouldApplyWysiwygSessionChange(SOURCE_ORIGIN)).toBe(true);
    expect(shouldApplyWysiwygSessionChange(undefined)).toBe(true);
  });
});

describe('initialWysiwygMarkdown', () => {
  test('prefers canonical session text and falls back to the loaded value', () => {
    expect(initialWysiwygMarkdown('# Session', '# Value')).toBe('# Session');
    expect(initialWysiwygMarkdown('', '# Value')).toBe('# Value');
    expect(initialWysiwygMarkdown(null, '# Value')).toBe('# Value');
    expect(initialWysiwygMarkdown(undefined, '# Value\n\n')).toBe('# Value');
  });
});

describe('WysiwygSessionBinding', () => {
  test('attaches by applying canonical session text the editor has not seen', () => {
    const session = new FakeSession();
    session.markdown = 'From the room';
    const host = new FakeHost('Loaded value');
    const binding = new WysiwygSessionBinding(session, host);

    binding.attach();

    expect(binding.attached).toBe(true);
    expect(host.applied).toEqual(['From the room']);
    expect(host.markdown).toBe('From the room');
    expect(binding.canonicalMarkdown).toBe('From the room');
  });

  test('falls back to the loaded value before the first sync', () => {
    const session = new FakeSession();
    const host = new FakeHost('Loaded value');
    const binding = new WysiwygSessionBinding(session, host);

    binding.attach();

    expect(host.applied).toEqual([]);
    expect(binding.canonicalMarkdown).toBe('Loaded value');
  });

  test('publishes a local transaction once with the binding origin and ignores its echo', () => {
    const session = new FakeSession();
    session.markdown = 'Hello world';
    const host = new FakeHost('Hello world');
    const binding = new WysiwygSessionBinding(session, host);
    binding.attach();

    const changed = binding.publishLocal('Hello brave world');

    expect(changed).toBe(true);
    expect(session.localOps).toEqual([{
      ops: [{ type: 'insert', index: 6, text: 'brave ' }],
      origin: WYSIWYG_BINDING_ORIGIN,
    }]);
    // The synchronous own-origin observer callback must not re-apply the
    // document, because ProseMirror already shows the local edit.
    expect(host.applied).toEqual([]);
    expect(binding.canonicalMarkdown).toBe('Hello brave world');
  });

  test('applies remote and other-pane transactions without publishing', () => {
    const session = new FakeSession();
    session.markdown = 'Start';
    const host = new FakeHost('Start');
    const binding = new WysiwygSessionBinding(session, host);
    binding.attach();

    session.emit(change('Remote text', REMOTE_ORIGIN));
    session.emit(change('Source text', SOURCE_ORIGIN));

    expect(host.applied).toEqual(['Remote text', 'Source text']);
    expect(session.localOps).toEqual([]);
    expect(binding.canonicalMarkdown).toBe('Source text');
  });

  test('diffs the next local edit against the last remote Markdown', () => {
    const session = new FakeSession();
    session.markdown = 'Start';
    const host = new FakeHost('Start');
    const binding = new WysiwygSessionBinding(session, host);
    binding.attach();

    session.emit(change('Remote text', REMOTE_ORIGIN));
    binding.publishLocal('Remote texts');

    expect(session.localOps[0]).toEqual({
      ops: [{ type: 'insert', index: 11, text: 's' }],
      origin: WYSIWYG_BINDING_ORIGIN,
    });
    expect(host.applied).toEqual(['Remote text']);
  });

  test('refuses to publish a local edit after a diverged remote apply', () => {
    const session = new FakeSession();
    session.markdown = 'Start';
    const host = new FakeHost('Start');
    const binding = new WysiwygSessionBinding(session, host);
    binding.attach();

    host.ignoreApply = true;
    session.emit(change('Remote text', REMOTE_ORIGIN));
    expect(host.markdown).toBe('Start');

    expect(binding.publishLocal('Remote text plus local')).toBe(false);
    expect(session.localOps).toEqual([]);
  });

  test('recovers the publish path after a failed remote apply retry', async () => {
    const session = new FakeSession();
    session.markdown = 'Start';
    const host = new FakeHost('Start');
    const binding = new WysiwygSessionBinding(session, host);
    binding.attach();

    host.ignoreApply = true;
    session.emit(change('Remote text', REMOTE_ORIGIN));
    expect(binding.publishLocal('Remote text plus local')).toBe(false);

    host.ignoreApply = false;
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(binding.publishLocal('Remote text plus local')).toBe(true);
    expect(session.localOps.at(-1)?.ops).toEqual([
      { type: 'insert', index: 11, text: ' plus local' },
    ]);
  });

  test('does not write normalization-only markers back on a local edit', () => {
    const session = new FakeSession();
    session.markdown = '- a';
    const host = new FakeHost('* a');
    host.normalizeTo = '* a';
    host.resultOverride = { applied: true, normalizationOnly: true };
    const binding = new WysiwygSessionBinding(session, host);
    binding.attach();

    expect(binding.publishLocal('* ab')).toBe(true);
    expect(session.markdown).toBe('- ab');
    expect(session.localOps.at(-1)?.ops).toEqual([
      { type: 'insert', index: 3, text: 'b' },
    ]);
  });

  test('publishes text typed in the preserved trailing paragraph at the end', () => {
    const session = new FakeSession();
    session.markdown = 'A';
    const host = new FakeHost('A');
    const binding = new WysiwygSessionBinding(session, host);
    binding.attach();

    expect(binding.publishLocal('A\n\nQ')).toBe(true);
    expect(session.localOps[0]).toEqual({
      ops: [{ type: 'insert', index: 1, text: '\n\nQ' }],
      origin: WYSIWYG_BINDING_ORIGIN,
    });
  });

  test('treats an AI/restore snapshot as external content, not a local echo', () => {
    const session = new FakeSession();
    session.markdown = 'Before';
    const host = new FakeHost('Before');
    const binding = new WysiwygSessionBinding(session, host);
    binding.attach();

    session.markdown = 'After the AI edit';
    session.emit(change('After the AI edit', LOCAL_ORIGIN));

    expect(host.applied).toEqual(['After the AI edit']);
    expect(session.localOps).toEqual([]);
  });

  test('does not republish when a no-op local transaction comes through', () => {
    const session = new FakeSession();
    session.markdown = 'Stable';
    const host = new FakeHost('Stable');
    const binding = new WysiwygSessionBinding(session, host);
    binding.attach();

    expect(binding.publishLocal('Stable')).toBe(false);
    expect(session.localOps).toEqual([]);
    expect(host.applied).toEqual([]);
  });

  test('stops applying after dispose', () => {
    const session = new FakeSession();
    session.markdown = 'Start';
    const host = new FakeHost('Start');
    const binding = new WysiwygSessionBinding(session, host);
    binding.attach();

    binding.dispose();
    session.emit(change('Ignored', REMOTE_ORIGIN));

    expect(binding.attached).toBe(false);
    expect(host.applied).toEqual([]);
  });
});

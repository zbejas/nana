import { describe, expect, test } from 'bun:test';
import {
  MAX_REMOTE_TRANSITIONS,
  MAX_REMOTE_TRANSITION_CHARS,
  appendRemoteTransition,
  findRemoteTransition,
  resolveAiEdit,
  type ResolveAiEditInput,
} from '../../src/components/editor/aiEditLifecycle';

function base(overrides: Partial<ResolveAiEditInput> = {}): ResolveAiEditInput {
  return {
    eventId: 'edit-1',
    targetId: 'note-1',
    currentDocumentId: 'note-1',
    lastHandledEventId: null,
    contentChange: { before: 'before body', after: 'after body', beforeRevision: 3, afterRevision: 4 },
    currentMarkdown: 'before body',
    fetchedMarkdown: 'after body',
    remoteTransitions: [],
    roomStatus: 'absent',
    currentRevision: 4,
    ...overrides,
  };
}

describe('resolveAiEdit', () => {
  test('uses the event body pair instead of an ambient remote snapshot', () => {
    const result = resolveAiEdit(base({
      currentMarkdown: 'before body',
      remoteTransitions: [{ from: 'ring before', to: 'after body' }],
    }));
    expect(result).toEqual({
      action: 'paint',
      previousMarkdown: 'before body',
      markdown: 'after body',
      replace: true,
      source: 'event',
    });
  });

  test('paints when the event arrives after the connected room already holds after', () => {
    const result = resolveAiEdit(base({
      roomStatus: 'connected',
      currentMarkdown: 'after body',
      lastHandledEventId: 'older-edit',
    }));
    expect(result).toEqual({
      action: 'paint',
      previousMarkdown: 'before body',
      markdown: 'after body',
      replace: false,
      source: 'event',
    });
  });

  test('waits for a connected room that has not delivered after yet', () => {
    const early = resolveAiEdit(base({
      roomStatus: 'connected',
      currentMarkdown: 'before body',
    }));
    expect(early).toEqual({ action: 'wait', reason: 'room' });

    const synced = resolveAiEdit(base({
      roomStatus: 'connected',
      currentMarkdown: 'after body',
    }));
    expect(synced.action).toBe('paint');
    if (synced.action !== 'paint') return;
    expect(synced.replace).toBe(false);
  });

  test('keeps each edit body across multiple room updates', () => {
    const transitions = [
      { from: 'body A', to: 'body B' },
      { from: 'body B', to: 'body C' },
    ];
    const result = resolveAiEdit(base({
      contentChange: null,
      fetchedMarkdown: 'body C',
      currentMarkdown: 'body C',
      remoteTransitions: transitions,
    }));
    expect(result).toEqual({
      action: 'paint',
      previousMarkdown: 'body B',
      markdown: 'body C',
      replace: false,
      source: 'remote',
    });
  });

  test('skips an old event with no reliable before image', () => {
    expect(resolveAiEdit(base({
      contentChange: null,
      fetchedMarkdown: 'body C',
      currentMarkdown: 'body C',
    }))).toEqual({ action: 'skip', reason: 'missing-before' });
  });

  test('falls back to the transition ring when the event bodies were over cap', () => {
    const result = resolveAiEdit(base({
      contentChange: null,
      contentChangeOmitted: true,
      fetchedMarkdown: 'body B',
      currentMarkdown: 'body B',
      remoteTransitions: [{ from: 'body A', to: 'body B' }],
    }));
    expect(result).toEqual({
      action: 'paint',
      previousMarkdown: 'body A',
      markdown: 'body B',
      replace: false,
      source: 'remote',
    });
  });

  test('skips when a newer current or fetched revision superseded the event', () => {
    expect(resolveAiEdit(base({ currentRevision: 5 }))).toEqual({
      action: 'skip',
      reason: 'stale',
    });
    expect(resolveAiEdit(base({
      currentRevision: 4,
      fetchedRevision: 5,
    }))).toEqual({ action: 'skip', reason: 'stale' });
  });

  test('waits briefly for a connecting or offline session, then uses the no-room path', () => {
    expect(resolveAiEdit(base({
      roomStatus: 'connecting',
      currentMarkdown: 'before body',
    }))).toEqual({ action: 'wait', reason: 'connection' });

    expect(resolveAiEdit(base({
      roomStatus: 'offline',
      currentMarkdown: 'before body',
    }))).toEqual({ action: 'wait', reason: 'connection' });

    expect(resolveAiEdit(base({
      roomStatus: 'connecting',
      currentMarkdown: 'before body',
      connectionWaitElapsed: true,
    }))).toEqual({
      action: 'paint',
      previousMarkdown: 'before body',
      markdown: 'after body',
      replace: true,
      source: 'event',
    });
  });

  test('applies after for a settled offline or absent room only when the body is before/after', () => {
    expect(resolveAiEdit(base({
      roomStatus: 'offline',
      currentMarkdown: 'before body',
      connectionWaitElapsed: true,
    }))).toEqual({
      action: 'paint',
      previousMarkdown: 'before body',
      markdown: 'after body',
      replace: true,
      source: 'event',
    });

    expect(resolveAiEdit(base({
      roomStatus: 'absent',
      currentMarkdown: 'after body',
    }))).toEqual({
      action: 'paint',
      previousMarkdown: 'before body',
      markdown: 'after body',
      replace: false,
      source: 'event',
    });
  });

  test('keeps merged local divergence untouched', () => {
    const waiting = resolveAiEdit(base({
      roomStatus: 'connected',
      currentMarkdown: 'local merged body',
    }));
    expect(waiting).toEqual({ action: 'wait', reason: 'room' });

    expect(resolveAiEdit(base({
      roomStatus: 'connected',
      currentMarkdown: 'local merged body',
      roomWaitElapsed: true,
    }))).toEqual({ action: 'skip', reason: 'diverged' });

    expect(resolveAiEdit(base({
      roomStatus: 'absent',
      currentMarkdown: 'local merged body',
    }))).toEqual({ action: 'skip', reason: 'diverged' });
  });

  test('rejects duplicate ids and events for another note', () => {
    expect(resolveAiEdit(base({ lastHandledEventId: 'edit-1' }))).toEqual({
      action: 'skip',
      reason: 'duplicate',
    });
    expect(resolveAiEdit(base({ currentDocumentId: 'note-2' }))).toEqual({
      action: 'skip',
      reason: 'wrong-document',
    });
  });

  test('supports an empty after body without treating it as missing', () => {
    expect(resolveAiEdit(base({
      contentChange: { before: 'old body', after: '' },
      currentMarkdown: '',
      fetchedMarkdown: '',
    }))).toEqual({
      action: 'paint',
      previousMarkdown: 'old body',
      markdown: '',
      replace: false,
      source: 'event',
    });
  });
});

describe('remote transition ring', () => {
  test('finds the newest transition ending at the target body', () => {
    expect(findRemoteTransition([
      { from: 'A', to: 'B' },
      { from: 'B', to: 'C' },
      { from: 'X', to: 'C' },
    ], 'C')).toEqual({ from: 'X', to: 'C' });
  });

  test('bounds count and total characters while keeping newest last', () => {
    let transitions = [] as ReturnType<typeof appendRemoteTransition>;
    for (let index = 0; index < MAX_REMOTE_TRANSITIONS + 5; index += 1) {
      transitions = appendRemoteTransition(transitions, `from ${index}`, `to ${index}`);
    }
    expect(transitions.length).toBe(MAX_REMOTE_TRANSITIONS);
    expect(transitions[transitions.length - 1]).toEqual({
      from: `from ${MAX_REMOTE_TRANSITIONS + 4}`,
      to: `to ${MAX_REMOTE_TRANSITIONS + 4}`,
    });

    const huge = 'x'.repeat(MAX_REMOTE_TRANSITION_CHARS);
    expect(appendRemoteTransition(transitions, huge, 'tiny')).toEqual(transitions);
  });

  test('does not append a no-op or duplicate consecutive transition', () => {
    expect(appendRemoteTransition([], 'same', 'same')).toEqual([]);
    const once = appendRemoteTransition([], 'A', 'B');
    expect(appendRemoteTransition(once, 'A', 'B')).toEqual(once);
  });
});

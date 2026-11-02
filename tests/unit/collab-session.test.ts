import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { caretAssocForMarkdown } from '../../src/lib/collaboration/text';
import {
    isCollabPersistencePhase,
    reduceCollabAck,
    reduceCollabConflict,
    reduceCollabStatus,
    type CollabPersistenceContext,
    type CollabPersistenceSnapshot,
} from '../../src/lib/collaboration/session';
import type { CollabAckFrame } from '../../src/lib/collaboration/protocol';

function snapshot(overrides: Partial<CollabPersistenceSnapshot> = {}): CollabPersistenceSnapshot {
    return {
        phase: 'clean',
        durableSeq: 0,
        revision: 1,
        conflict: null,
        ...overrides,
    };
}

function context(overrides: Partial<CollabPersistenceContext> = {}): CollabPersistenceContext {
    return {
        lastLocalSeq: 0,
        pendingLocalUpdates: false,
        ...overrides,
    };
}

function ack(overrides: Partial<CollabAckFrame> = {}): CollabAckFrame {
    return {
        type: 'ack',
        durableSeq: 4,
        revision: 7,
        savedAt: '2026-10-31T00:00:00.000Z',
        ...overrides,
    };
}

describe('reduceCollabAck', () => {
    test('returns a clean note to clean and adopts the durable sequence', () => {
        const next = reduceCollabAck(
            snapshot({ phase: 'saving', durableSeq: 2, revision: 5 }),
            ack({ durableSeq: 4, revision: 7 }),
            context(),
        );

        expect(next).toEqual({
            phase: 'clean',
            durableSeq: 4,
            revision: 7,
            conflict: null,
        });
    });

    test('does not clear dirty state while local updates are pending', () => {
        const next = reduceCollabAck(
            snapshot({ phase: 'dirty', durableSeq: 2 }),
            ack({ durableSeq: 4 }),
            context({ pendingLocalUpdates: true }),
        );

        expect(next.phase).toBe('dirty');
        expect(next.durableSeq).toBe(4);
    });

    test('ignores an ack older than the last local update', () => {
        const next = reduceCollabAck(
            snapshot({ phase: 'dirty', durableSeq: 3 }),
            ack({ durableSeq: 4 }),
            context({ lastLocalSeq: 6 }),
        );

        expect(next.phase).toBe('dirty');
    });

    test('an ack that covers the last local update clears dirty state', () => {
        const next = reduceCollabAck(
            snapshot({ phase: 'saving', durableSeq: 3 }),
            ack({ durableSeq: 6 }),
            context({ lastLocalSeq: 6 }),
        );

        expect(next.phase).toBe('clean');
    });

    test('keeps a conflict until a covering ack resolves it', () => {
        const conflict = snapshot({
            phase: 'conflict',
            conflict: { type: 'conflict', revision: 8, reason: 'revision' },
        });

        const stale = reduceCollabAck(conflict, ack({ durableSeq: 4 }), context({ lastLocalSeq: 6 }));
        expect(stale.phase).toBe('conflict');

        const resolved = reduceCollabAck(conflict, ack({ durableSeq: 6 }), context({ lastLocalSeq: 6 }));
        expect(resolved.phase).toBe('clean');
        expect(resolved.conflict).toBeNull();
    });
});

describe('reduceCollabStatus', () => {
    test('exposes a server saving phase and revision', () => {
        const next = reduceCollabStatus(
            snapshot({ durableSeq: 4 }),
            { type: 'status', persistence: 'saving', revision: 8 },
            context(),
        );

        expect(next.phase).toBe('saving');
        expect(next.revision).toBe(8);
    });

    test('does not let a premature clean status hide pending local work', () => {
        const next = reduceCollabStatus(
            snapshot({ phase: 'dirty', durableSeq: 4 }),
            { type: 'status', persistence: 'clean', revision: 8 },
            context({ lastLocalSeq: 5 }),
        );

        expect(next.phase).toBe('dirty');
    });

    test('accepts clean when no local update is outstanding', () => {
        const next = reduceCollabStatus(
            snapshot({ phase: 'saving', durableSeq: 4 }),
            { type: 'status', persistence: 'clean', revision: 8 },
            context({ lastLocalSeq: 4 }),
        );

        expect(next.phase).toBe('clean');
    });

    test('keeps error and conflict phases visible', () => {
        expect(reduceCollabStatus(
            snapshot(),
            { type: 'status', persistence: 'error', revision: 8 },
            context(),
        ).phase).toBe('error');

        expect(reduceCollabStatus(
            snapshot(),
            { type: 'status', persistence: 'conflict', revision: 8 },
            context(),
        ).phase).toBe('conflict');
    });
});

describe('reduceCollabConflict', () => {
    test('records the server conflict and its revision', () => {
        const next = reduceCollabConflict(
            snapshot({ phase: 'saving', revision: 4 }),
            { type: 'conflict', revision: 9, reason: 'merge', serverMarkdown: '# Server' },
        );

        expect(next.phase).toBe('conflict');
        expect(next.revision).toBe(9);
        expect(next.conflict?.serverMarkdown).toBe('# Server');
    });
});

describe('presence relative-position association', () => {
    test('a left-associated line-end caret stays before a peer newline run', () => {
        const local = new Y.Doc();
        const peer = new Y.Doc();
        local.getText('content').insert(0, 'abc\ndef');
        Y.applyUpdate(peer, Y.encodeStateAsUpdate(local));

        const text = local.getText('content');
        const markdown = text.toString();
        expect(caretAssocForMarkdown(markdown, 3)).toBe(-1);

        const left = Y.createRelativePositionFromTypeIndex(text, 3, -1);
        const right = Y.createRelativePositionFromTypeIndex(text, 3, 0);

        peer.getText('content').insert(3, '\n\n');
        Y.applyUpdate(local, Y.encodeStateAsUpdate(peer, Y.encodeStateVector(local)));
        Y.applyUpdate(peer, Y.encodeStateAsUpdate(local, Y.encodeStateVector(peer)));

        const resolve = (position: Y.RelativePosition) =>
            Y.createAbsolutePositionFromRelativePosition(position, local)?.index ?? -1;

        expect(local.getText('content').toString()).toBe('abc\n\n\ndef');
        expect(resolve(left)).toBe(3);
        expect(resolve(right)).toBe(5);
    });

    test('mid-text association follows the character as before', () => {
        const local = new Y.Doc();
        const peer = new Y.Doc();
        local.getText('content').insert(0, 'abcdef');
        Y.applyUpdate(peer, Y.encodeStateAsUpdate(local));

        const text = local.getText('content');
        expect(caretAssocForMarkdown(text.toString(), 2)).toBe(1);
        const right = Y.createRelativePositionFromTypeIndex(text, 2, 1);

        peer.getText('content').insert(0, 'XY');
        Y.applyUpdate(local, Y.encodeStateAsUpdate(peer, Y.encodeStateVector(local)));

        expect(Y.createAbsolutePositionFromRelativePosition(right, local)?.index).toBe(4);
    });
});

describe('isCollabPersistencePhase', () => {
    test('accepts the frozen phase names only', () => {
        for (const phase of ['clean', 'dirty', 'saving', 'error', 'conflict']) {
            expect(isCollabPersistencePhase(phase)).toBe(true);
        }
        expect(isCollabPersistencePhase('saved')).toBe(false);
        expect(isCollabPersistencePhase(undefined)).toBe(false);
    });
});

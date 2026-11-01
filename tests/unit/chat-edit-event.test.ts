import { describe, expect, test } from 'bun:test';
import { normalizeEdit, normalizeEditEvent } from '../../src/lib/chat/client';

const editRecord = {
  id: 'edit1',
  conversationId: 'conv1',
  target: { type: 'document', id: 'note1', title: 'Note', url: '/document/note1' },
  tool: 'edit_note',
  summary: 'Updated a section.',
  status: 'applied',
  changed: { sections: [{ heading: 'Goals', path: ['Goals'], from: 1, to: 2 }] },
  undo: { kind: 'restore', available: true },
  created: '2026-01-01T00:00:00.000Z',
  updated: '2026-01-01T00:00:00.000Z',
};

describe('chat edit event normalization', () => {
  test('lifts the event-only body pair onto the UI edit', () => {
    const edit = normalizeEditEvent({
      type: 'edit',
      edit: editRecord,
      contentChange: {
        before: '# Note\n\nOld.',
        after: '# Note\n\nNew.',
        beforeRevision: 2,
        afterRevision: 3,
      },
    });
    expect(edit?.contentChange).toEqual({
      before: '# Note\n\nOld.',
      after: '# Note\n\nNew.',
      beforeRevision: 2,
      afterRevision: 3,
    });
    expect(edit?.contentChangeOmitted).toBeUndefined();
  });

  test('keeps the over-cap omission flag without body text', () => {
    const edit = normalizeEditEvent({
      type: 'edit',
      edit: editRecord,
      contentChangeOmitted: true,
    });
    expect(edit?.contentChangeOmitted).toBe(true);
    expect(edit?.contentChange).toBeUndefined();
  });

  test('persisted list/get records never invent a body pair', () => {
    const edit = normalizeEdit(editRecord);
    expect(edit?.contentChange).toBeUndefined();
    expect(edit?.contentChangeOmitted).toBeUndefined();
  });
});

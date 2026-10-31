import { describe, expect, test } from 'bun:test';
import {
  hasPendingMetadataChanges,
  MAX_AUTO_SAVE_WAIT_MS,
  nextAutoSaveDelay,
  resolveEditorSaveStatus,
} from '../../src/components/editor/useAutoSave';
import type { Document } from '../../src/lib/documents/types';

describe('nextAutoSaveDelay', () => {
  test('waits for the trailing debounce at the start of an unsaved burst', () => {
    expect(nextAutoSaveDelay({ debounceMs: 600, maxWaitMs: 8000, elapsedMs: 0 })).toBe(600);
  });

  test('keeps the trailing debounce while the max wait has room', () => {
    expect(nextAutoSaveDelay({ debounceMs: 600, maxWaitMs: 8000, elapsedMs: 7000 })).toBe(600);
  });

  test('shrinks to the remaining max wait near the deadline', () => {
    expect(nextAutoSaveDelay({ debounceMs: 600, maxWaitMs: 8000, elapsedMs: 7800 })).toBe(200);
  });

  test('fires immediately once the max wait is spent', () => {
    expect(nextAutoSaveDelay({ debounceMs: 600, maxWaitMs: 8000, elapsedMs: 8000 })).toBe(0);
    expect(nextAutoSaveDelay({ debounceMs: 600, maxWaitMs: 8000, elapsedMs: 9500 })).toBe(0);
  });

  test('caps a debounce longer than the max wait', () => {
    expect(nextAutoSaveDelay({ debounceMs: 12000, maxWaitMs: 8000, elapsedMs: 0 })).toBe(8000);
  });

  test('treats invalid or negative timing values as zero', () => {
    expect(nextAutoSaveDelay({ debounceMs: 600, maxWaitMs: 8000, elapsedMs: -100 })).toBe(600);
    expect(nextAutoSaveDelay({ debounceMs: Number.NaN, maxWaitMs: 8000, elapsedMs: 0 })).toBe(0);
    expect(nextAutoSaveDelay({ debounceMs: 600, maxWaitMs: Number.NaN, elapsedMs: 600 })).toBe(0);
  });
});

describe('autosave max wait', () => {
  test('stays within the 5-10s persistence bound', () => {
    expect(MAX_AUTO_SAVE_WAIT_MS).toBeGreaterThanOrEqual(5000);
    expect(MAX_AUTO_SAVE_WAIT_MS).toBeLessThanOrEqual(10000);
  });
});

describe('resolveEditorSaveStatus', () => {
  test('shows Saving while a write is in flight, even with unsaved text', () => {
    expect(resolveEditorSaveStatus({ autoSaving: true, hasUnsavedChanges: true })).toBe('saving');
    expect(resolveEditorSaveStatus({ autoSaving: true, hasUnsavedChanges: false })).toBe('saving');
  });

  test('shows Unsaved only when nothing is being written', () => {
    expect(resolveEditorSaveStatus({ autoSaving: false, hasUnsavedChanges: true })).toBe('unsaved');
  });

  test('is idle when there is no save and no unsaved work', () => {
    expect(resolveEditorSaveStatus({ autoSaving: false, hasUnsavedChanges: false })).toBe('idle');
  });

  test('shows server saving only when this client has local content pending', () => {
    expect(resolveEditorSaveStatus({
      autoSaving: false,
      hasUnsavedChanges: true,
      persistence: 'saving',
    })).toBe('saving');
    expect(resolveEditorSaveStatus({
      autoSaving: false,
      hasUnsavedChanges: false,
      persistence: 'saving',
    })).toBe('idle');
  });

  test('does not show Unsaved for a remote-only dirty room', () => {
    expect(resolveEditorSaveStatus({
      autoSaving: false,
      hasUnsavedChanges: false,
      persistence: 'dirty',
    })).toBe('idle');
  });

  test('surfaces server error and conflict even while a save is in flight', () => {
    expect(resolveEditorSaveStatus({
      autoSaving: true,
      hasUnsavedChanges: true,
      persistence: 'error',
    })).toBe('error');
    expect(resolveEditorSaveStatus({
      autoSaving: true,
      hasUnsavedChanges: true,
      persistence: 'conflict',
    })).toBe('conflict');
  });
});

describe('hasPendingMetadataChanges', () => {
  const document = {
    id: 'doc-1',
    title: 'Title',
    tags: ['one'],
  } as Document;

  test('ignores content-only changes', () => {
    expect(hasPendingMetadataChanges({
      document,
      title: 'Title',
      tags: ['one'],
      newAttachments: [],
      removedAttachments: [],
    })).toBe(false);
  });

  test('detects title, tag, and attachment changes', () => {
    expect(hasPendingMetadataChanges({
      document,
      title: 'Retitled',
      tags: ['one'],
      newAttachments: [],
      removedAttachments: [],
    })).toBe(true);
    expect(hasPendingMetadataChanges({
      document,
      title: 'Title',
      tags: ['one', 'two'],
      newAttachments: [],
      removedAttachments: [],
    })).toBe(true);
    expect(hasPendingMetadataChanges({
      document,
      title: 'Title',
      tags: ['one'],
      newAttachments: [new File(['x'], 'x.txt')],
      removedAttachments: [],
    })).toBe(true);
  });

  test('treats an empty title as Untitled', () => {
    expect(hasPendingMetadataChanges({
      document: { ...document, title: 'Untitled' } as Document,
      title: '   ',
      tags: ['one'],
      newAttachments: [],
      removedAttachments: [],
    })).toBe(false);
  });
});

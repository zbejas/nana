import { describe, expect, test } from 'bun:test';
import { ownedShareTargetsFromShares } from '../../src/lib/sharing/targets';

describe('owned share targets', () => {
  test('groups direct shares by target type and ignores empty relations', () => {
    const targets = ownedShareTargetsFromShares([
      { document: 'doc-1' },
      { folder: 'folder-1' },
      { board: 'board-1' },
      { document: 'doc-2', folder: 'folder-2' },
      { document: '', folder: '', board: '' },
    ]);

    expect([...targets.documents].sort()).toEqual(['doc-1', 'doc-2']);
    expect([...targets.folders].sort()).toEqual(['folder-1', 'folder-2']);
    expect([...targets.boards]).toEqual(['board-1']);
  });

  test('returns empty sets when the account owns no direct shares', () => {
    const targets = ownedShareTargetsFromShares([]);

    expect(targets.documents.size).toBe(0);
    expect(targets.folders.size).toBe(0);
    expect(targets.boards.size).toBe(0);
  });
});

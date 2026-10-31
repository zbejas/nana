/** Target ids owned by the current account and shared directly with people. */
export interface OwnedShareTargets {
  documents: ReadonlySet<string>;
  folders: ReadonlySet<string>;
  boards: ReadonlySet<string>;
}

export interface OwnedShareRecord {
  document?: string;
  folder?: string;
  board?: string;
}

export const EMPTY_OWNED_SHARE_TARGETS: OwnedShareTargets = {
  documents: new Set(),
  folders: new Set(),
  boards: new Set(),
};

export function ownedShareTargetsFromShares(shares: OwnedShareRecord[]): OwnedShareTargets {
  const documents = new Set<string>();
  const folders = new Set<string>();
  const boards = new Set<string>();

  for (const share of shares) {
    if (share.document) documents.add(share.document);
    if (share.folder) folders.add(share.folder);
    if (share.board) boards.add(share.board);
  }

  return { documents, folders, boards };
}

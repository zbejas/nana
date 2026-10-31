import type { BoardSummary } from '../../lib/boards';
import type { Document } from '../../lib/documents';

const DAY_MS = 86_400_000;

export type TimelineItem =
  | { kind: 'document'; id: string; updated: string; document: Document }
  | { kind: 'board'; id: string; updated: string; board: BoardSummary };

export type TimelineRange = {
  startDate: Date | null;
  endDate: Date | null;
};

type TimelineBoardOptions = {
  /** The active search term. Boards match on name and description. */
  searchQuery: string;
  /** Set only while the calendar range owns the feed. */
  calendarRange: TimelineRange | null;
  hasMoreDocuments: boolean;
  /** Updated timestamp of the last loaded note, when notes are paged. */
  oldestLoadedDocumentUpdated: string | null;
};

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Boards that belong in the current feed. Search and the calendar both replace
 * the normal feed; otherwise paged notes impose a chronological cutoff so a
 * board never appears above an older note that has not loaded yet.
 */
export function filterTimelineBoards(
  boards: BoardSummary[],
  options: TimelineBoardOptions
): BoardSummary[] {
  const query = options.searchQuery.trim().toLowerCase();
  if (query) {
    return boards.filter(
      (board) =>
        board.name.toLowerCase().includes(query) ||
        board.description.toLowerCase().includes(query)
    );
  }

  if (options.calendarRange) {
    const { startDate, endDate } = options.calendarRange;
    if (!startDate) {
      return boards;
    }

    const rangeStart = startOfDay(startDate).getTime();
    const rangeEnd = startOfDay(endDate ?? startDate).getTime() + DAY_MS - 1;

    return boards.filter((board) => {
      const activity = new Date(board.lastActivity).getTime();
      return activity >= rangeStart && activity <= rangeEnd;
    });
  }

  if (options.hasMoreDocuments && options.oldestLoadedDocumentUpdated) {
    const cutoff = new Date(options.oldestLoadedDocumentUpdated).getTime();
    return boards.filter((board) => new Date(board.lastActivity).getTime() >= cutoff);
  }

  return boards;
}

/** Merges notes and boards into one newest-first feed. */
export function mergeTimelineItems(
  documents: Document[],
  boards: BoardSummary[]
): TimelineItem[] {
  const items: TimelineItem[] = [
    ...documents.map((document) => ({
      kind: 'document' as const,
      id: `document:${document.id}`,
      updated: document.updated,
      document,
    })),
    ...boards.map((board) => ({
      kind: 'board' as const,
      id: `board:${board.id}`,
      updated: board.lastActivity,
      board,
    })),
  ];

  return items.sort(
    (a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime()
  );
}

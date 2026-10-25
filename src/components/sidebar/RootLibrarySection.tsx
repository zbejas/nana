import type { Board } from '../../lib/boards';
import type { Document } from '../../lib/documents';
import type {
  OnDragEnd,
  OnDragLeave,
  OnDragOver,
  OnDragStartBoard,
  OnDragStartDocument,
  OnDrop,
} from '../file-folder-handling';
import { BoardItem } from './BoardItem';
import { DocumentItem } from './DocumentItem';

interface RootLibrarySectionProps {
  documents: Document[];
  boards: Board[];
  isDataLoading: boolean;
  dropZone: string | null;
  activeDocumentId?: string;
  activeBoardId?: string;
  onDocumentClick: (doc: Document) => void;
  onDocumentContextMenu: (event: React.MouseEvent, documentId: string) => void;
  onBoardClick: (board: Board) => void;
  onBoardContextMenu: (event: React.MouseEvent, board: Board) => void;
  onDocumentDragStart: OnDragStartDocument;
  onDocumentDragEnd: OnDragEnd;
  onBoardDragStart: OnDragStartBoard;
  onBoardDragEnd: OnDragEnd;
  onDragOver: OnDragOver;
  onDragLeave: OnDragLeave;
  onDrop: OnDrop;
}

export function RootLibrarySection({
  documents,
  boards,
  isDataLoading,
  dropZone,
  activeDocumentId,
  activeBoardId,
  onDocumentClick,
  onDocumentContextMenu,
  onBoardClick,
  onBoardContextMenu,
  onDocumentDragStart,
  onDocumentDragEnd,
  onBoardDragStart,
  onBoardDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: RootLibrarySectionProps) {
  if (documents.length === 0 && boards.length === 0 && !isDataLoading) return null;

  return (
    <div
      className={`rounded-control transition-colors ${
        dropZone === 'root' ? 'bg-signal-soft ring-1 ring-inset ring-signal/40' : ''
      }`}
      onDragOver={(event) => onDragOver(event, undefined)}
      onDragLeave={onDragLeave}
      onDrop={(event) => onDrop(event, undefined)}
    >
      {documents.map((doc) => (
        <DocumentItem
          key={doc.id}
          document={doc}
          draggable
          depth={0}
          currentFolderId={undefined}
          active={doc.id === activeDocumentId}
          onClick={() => onDocumentClick(doc)}
          onContextMenu={(event) => {
            if ('clientX' in event) {
              onDocumentContextMenu(event as React.MouseEvent, doc.id);
            }
          }}
          onDragStart={onDocumentDragStart}
          onDragEnd={onDocumentDragEnd}
        />
      ))}
      {boards.map((board) => (
        <BoardItem
          key={board.id}
          board={board}
          draggable
          depth={0}
          currentFolderId={undefined}
          active={board.id === activeBoardId}
          onClick={() => onBoardClick(board)}
          onContextMenu={(event) => {
            if ('clientX' in event) {
              onBoardContextMenu(event as React.MouseEvent, board);
            }
          }}
          onDragStart={onBoardDragStart}
          onDragEnd={onBoardDragEnd}
        />
      ))}
      {documents.length === 0 && boards.length === 0 && isDataLoading && (
        <div className="flex items-center justify-center py-3">
          <span className="h-4 w-4 animate-spin rounded-full border border-ink-muted/30 border-t-signal" />
        </div>
      )}
    </div>
  );
}

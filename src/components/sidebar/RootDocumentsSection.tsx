import { type Document } from '../../lib/documents';
import type { OnDragStartDocument, OnDragEnd, OnDragOver, OnDragLeave, OnDrop } from '../file-folder-handling';
import { DocumentItem } from './DocumentItem';

interface RootDocumentsSectionProps {
  documents: Document[];
  isDataLoading: boolean;
  dropZone: string | null;
  activeDocumentId?: string;
  onDocumentClick: (doc: Document) => void;
  onContextMenu: (e: React.MouseEvent, documentId: string) => void;
  onDragStart: OnDragStartDocument;
  onDragEnd: OnDragEnd;
  onDragOver: OnDragOver;
  onDragLeave: OnDragLeave;
  onDrop: OnDrop;
  onAddDocument: (folderId?: string) => Promise<void>;
}

export function RootDocumentsSection({
  documents,
  isDataLoading,
  dropZone,
  activeDocumentId,
  onDocumentClick,
  onContextMenu,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: RootDocumentsSectionProps) {
  if (documents.length === 0 && !isDataLoading) return null;

  return (
    <div
      className={`rounded-control transition-colors ${
        dropZone === 'root' ? 'bg-ember-soft ring-1 ring-inset ring-ember/40' : ''
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
              onContextMenu(event as React.MouseEvent, doc.id);
            }
          }}
          onDragStart={(event) => onDragStart(event, doc.id, undefined)}
          onDragEnd={onDragEnd}
        />
      ))}
      {documents.length === 0 && isDataLoading && (
        <div className="flex items-center justify-center py-3">
          <span className="h-4 w-4 animate-spin rounded-full border border-ink-muted/30 border-t-ember" />
        </div>
      )}
    </div>
  );
}

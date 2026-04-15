import { PlusIcon } from '@heroicons/react/24/outline';
import { type Document } from '../../lib/documents';
import type { OnDragStartDocument, OnDragEnd, OnDragOver, OnDragLeave, OnDrop } from '../file-folder-handling';
import { DocumentItem } from './DocumentItem';

interface RootDocumentsSectionProps {
  documents: Document[];
  isDataLoading: boolean;
  dropZone: string | null;
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
  onDocumentClick,
  onContextMenu,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onAddDocument,
}: RootDocumentsSectionProps) {
  if (documents.length === 0 && !isDataLoading) return null;

  return (
    <div 
      className={`rounded-lg transition-colors ${
        dropZone === 'root' ? 'bg-blue-500/20 border-2 border-blue-500 p-2' : ''
      }`}
      onDragOver={(e) => onDragOver(e, undefined)}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop(e, undefined)}
    >
      {documents.map(doc => (
        <DocumentItem
          key={doc.id}
          document={doc}
          draggable={true}
          depth={0}
          currentFolderId={undefined}
          onClick={() => onDocumentClick(doc)}
          onContextMenu={(e) => {
            if ('clientX' in e) {
              onContextMenu(e as React.MouseEvent, doc.id);
            }
          }}
          onDragStart={(e) => onDragStart(e, doc.id, undefined)}
          onDragEnd={onDragEnd}
        />
      ))}
      {documents.length === 0 && isDataLoading && (
        <div className="px-3 py-4 flex items-center justify-center">
          <svg className="w-5 h-5 text-gray-500 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        </div>
      )}
    </div>
  );
}

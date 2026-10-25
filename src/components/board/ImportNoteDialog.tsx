import { useEffect, useMemo, useState } from 'react';
import { MagnifyingGlassIcon, DocumentTextIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { listDocuments, type Document } from '../../lib/documents';
import { Button, Dialog, EmptyState, Input, Spinner } from '../ui';

interface ImportNoteDialogProps {
  open: boolean;
  boardId: string;
  boardName: string;
  onClose: () => void;
  existingDocumentIds: Set<string>;
  onImport: (document: Document) => Promise<void>;
}

export function ImportNoteDialog({
  open,
  boardId,
  boardName,
  onClose,
  existingDocumentIds,
  onImport,
}: ImportNoteDialogProps) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [importingId, setImportingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    setQuery('');
    setError(null);
    setIsLoading(true);

    let cancelled = false;
    void listDocuments()
      .then((result) => {
        if (!cancelled) {
          setDocuments(result.items);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('Could not load your notes.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, boardId]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return documents;
    return documents.filter((document) => document.title.toLowerCase().includes(term));
  }, [documents, query]);

  const handleImport = async (document: Document) => {
    setImportingId(document.id);
    setError(null);
    try {
      await onImport(document);
      onClose();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Could not import that note.');
    } finally {
      setImportingId(null);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Add a note to ${boardName}`}
      description="A task is created on this board and linked back to the note. The note stays in your library."
      size="md"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="relative">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search notes"
            aria-label="Search notes to import"
            className="pl-9"
            autoFocus
          />
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Spinner label="Loading notes" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            compact
            title={documents.length === 0 ? 'No notes yet' : 'No matching notes'}
            description={
              documents.length === 0
                ? 'Write a note first, then bring it onto the board.'
                : 'Try a different search.'
            }
          />
        ) : (
          <div className="max-h-[46dvh] space-y-1 overflow-y-auto scrollbar-autohide pr-1">
            {filtered.map((document) => {
              const alreadyOnBoard = existingDocumentIds.has(document.id);
              return (
                <button
                  key={document.id}
                  type="button"
                  disabled={alreadyOnBoard || importingId !== null}
                  onClick={() => void handleImport(document)}
                  className="flex w-full items-center gap-3 rounded-control border border-transparent px-3 py-2.5 text-left transition-colors hover:border-line hover:bg-surface-sunken disabled:cursor-default disabled:opacity-60 disabled:hover:border-transparent disabled:hover:bg-transparent"
                >
                  <DocumentTextIcon className="h-4 w-4 shrink-0 text-ink-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">{document.title || 'Untitled'}</span>
                    <span className="mt-0.5 block text-[11.5px] text-ink-muted">
                      Updated {new Date(document.updated).toLocaleDateString()}
                      {document.word_count ? ` · ${document.word_count} words` : ''}
                    </span>
                  </span>
                  {importingId === document.id ? (
                    <Spinner className="h-4 w-4" />
                  ) : alreadyOnBoard ? (
                    <span className="inline-flex shrink-0 items-center gap-1 text-[11.5px] text-success">
                      <CheckCircleIcon className="h-3.5 w-3.5" /> On board
                    </span>
                  ) : (
                    <span className="shrink-0 text-[11.5px] font-medium text-signal">Import</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Dialog>
  );
}

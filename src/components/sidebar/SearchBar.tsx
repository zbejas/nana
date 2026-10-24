import { useEffect, useRef, useState } from 'react';
import { MagnifyingGlassIcon } from '@heroicons/react/20/solid';
import { type Document } from '../../lib/documents';
import { useDocumentSearch } from '../../lib/documents/useDocumentSearch';
import { highlightText } from '../../lib/highlightText';
import { Spinner } from '../ui';

interface SearchBarProps {
  onDocumentClick: (doc: Document) => void;
  onContextMenu: (e: React.MouseEvent, documentId: string) => void;
}

export function SearchBar({ onDocumentClick, onContextMenu }: SearchBarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showResults, setShowResults] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const { results: searchResults, isLoading } = useDocumentSearch(searchQuery, { limit: 10 });

  useEffect(() => {
    setShowResults(searchQuery.trim().length > 0);
  }, [searchQuery]);

  useEffect(() => {
    if (!showResults) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowResults(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowResults(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showResults]);

  const handleDocumentSelect = (doc: Document) => {
    onDocumentClick(doc);
    setSearchQuery('');
    setShowResults(false);
  };

  return (
    <div ref={searchRef} className="relative px-3">
      <div className="relative">
        <MagnifyingGlassIcon
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted"
          aria-hidden="true"
        />
        <input
          type="text"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          onFocus={() => searchQuery.trim().length > 0 && setShowResults(true)}
          placeholder="Search notes"
          aria-label="Search documents"
          className="h-9 w-full rounded-control border border-line-strong bg-surface-sunken pl-8 pr-3 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-muted/80 focus:border-signal focus:ring-2 focus:ring-signal/20"
        />
      </div>

      {showResults && (
        <div className="absolute left-3 right-3 top-full z-50 mt-1.5 overflow-hidden rounded-panel border border-line bg-surface-raised shadow-float">
          <div className="max-h-72 overflow-y-auto scrollbar-autohide py-1">
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-ink-muted">
                <Spinner className="h-3.5 w-3.5" />
                Searching
              </div>
            ) : searchResults.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-ink-muted">No notes found</p>
            ) : (
              searchResults.map((doc) => (
                <button
                  key={doc.id}
                  onClick={() => handleDocumentSelect(doc)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    onContextMenu(event, doc.id);
                    setShowResults(false);
                  }}
                  className="block w-full px-3 py-2 text-left transition-colors hover:bg-surface-sunken"
                >
                  <p className="truncate text-[13px] text-ink">{highlightText(doc.title || 'Untitled', searchQuery)}</p>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <p className="text-[11px] text-ink-muted">
                      {new Date(doc.updated).toLocaleDateString()}
                    </p>
                    {doc.tags?.length > 0 && (
                      <p className="truncate text-[11px] text-ink-muted">
                        {doc.tags.slice(0, 2).map((tag, index) => (
                          <span key={index}>
                            {index > 0 && ' · '}
                            {highlightText(tag, searchQuery)}
                          </span>
                        ))}
                      </p>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

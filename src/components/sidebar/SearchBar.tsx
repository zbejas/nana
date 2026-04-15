import { useState, useRef, useEffect } from 'react';
import { type Document } from '../../lib/documents';
import { useDocumentSearch } from '../../lib/documents/useDocumentSearch';
import { highlightText } from '../../lib/highlightText';

interface SearchBarProps {
  onDocumentClick: (doc: Document) => void;
  onContextMenu: (e: React.MouseEvent, documentId: string) => void;
}

export function SearchBar({ onDocumentClick, onContextMenu }: SearchBarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showResults, setShowResults] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const { results: searchResults, isLoading } = useDocumentSearch(searchQuery, { limit: 10 });

  // Show/hide dropdown based on query content
  useEffect(() => {
    const trimmedQuery = searchQuery.trim();
    if (!trimmedQuery) {
      setShowResults(false);
      return;
    }

    setShowResults(true);
  }, [searchQuery]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };

    if (showResults) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showResults]);

  const handleInputChange = (value: string) => {
    setSearchQuery(value);
    // Results will show automatically via useEffect when query changes
  };

  const handleDocumentSelect = (doc: Document) => {
    onDocumentClick(doc);
    setSearchQuery('');
    setShowResults(false);
  };

  return (
    <div ref={searchRef} className="relative">
      {/* Search Input */}
      <div className="relative">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => searchQuery.trim().length > 0 && setShowResults(true)}
          placeholder="Search documents..."
          className="w-full px-3 py-2 pl-8 bg-white/5 border border-white/8 rounded-xl text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-white/20 focus:border-white/15 focus:bg-white/8 transition-all"
        />
        <svg
          className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>

      {/* Search Results Dropdown */}
      {showResults && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-gray-900/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl shadow-black/40 max-h-80 overflow-y-auto z-50">
          {isLoading ? (
            <div className="px-3 py-3 text-xs text-gray-500 text-center flex items-center justify-center gap-2">
              <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Searching...
            </div>
          ) : searchResults.length === 0 ? (
            <div className="px-3 py-3 text-xs text-gray-500 text-center">No documents found</div>
          ) : (
            <div className="py-1">
              {searchResults.map(doc => (
                <button
                  key={doc.id}
                  onClick={() => handleDocumentSelect(doc)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onContextMenu(e, doc.id);
                    setShowResults(false);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-white/10 transition-colors"
                >
                  <p className="text-sm text-gray-300 truncate">{highlightText(doc.title || 'Untitled', searchQuery)}</p>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <p className="text-xs text-gray-500">
                      Updated {new Date(doc.updated).toLocaleDateString()}
                    </p>
                    {doc.tags.length > 0 && (
                      <p className="text-xs text-gray-400 truncate">
                        {doc.tags.map((tag, i) => (
                          <span key={i}>
                            {i > 0 && ', '}
                            {highlightText(tag, searchQuery)}
                          </span>
                        ))}
                      </p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

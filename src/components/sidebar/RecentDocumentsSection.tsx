import type { Document } from "../../lib/documents";

interface RecentDocumentsSectionProps {
  documents: Document[];
  onDocumentClick: (doc: Document) => void;
  onContextMenu: (e: React.MouseEvent, documentId: string) => void;
  isLoading?: boolean;
}

export function RecentDocumentsSection({
  documents,
  onDocumentClick,
  onContextMenu,
  isLoading = false,
}: RecentDocumentsSectionProps) {
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div>
      <div className="flex items-center px-2 py-1.5">
        <span className="text-[11px] text-gray-500 uppercase font-semibold tracking-wider">Recent</span>
      </div>
      {documents.length === 0 && isLoading ? (
        <div className="px-3 py-4 flex items-center justify-center">
          <svg className="w-5 h-5 text-gray-500 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        </div>
      ) : documents.length === 0 ? (
        <div className="px-3 py-2 text-xs text-gray-600 italic">No recent documents</div>
      ) : (
        <div className="space-y-0.5">
          {documents.map(doc => (
            <button
              key={doc.id}
              onClick={() => onDocumentClick(doc)}
              onContextMenu={(e) => onContextMenu(e, doc.id)}
              className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 transition-colors group"
            >
              <p className="text-sm text-gray-300 truncate group-hover:text-gray-200">{doc.title || 'Untitled'}</p>
              <p className="text-[11px] text-gray-600 mt-0.5">{formatDate(doc.updated)}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

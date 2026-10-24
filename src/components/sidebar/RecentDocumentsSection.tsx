import type { Document } from "../../lib/documents";

interface RecentDocumentsSectionProps {
  documents: Document[];
  onDocumentClick: (doc: Document) => void;
  onContextMenu: (e: React.MouseEvent, documentId: string) => void;
  isLoading?: boolean;
}

function formatRelative(dateString: string): string {
  const date = new Date(dateString);
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(diffMs / 86400000);

  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h`;
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function RecentDocumentsSection({
  documents,
  onDocumentClick,
  onContextMenu,
  isLoading = false,
}: RecentDocumentsSectionProps) {
  if (documents.length === 0 && !isLoading) {
    return null;
  }

  return (
    <section className="px-3 pt-4" aria-label="Recent notes">
      <p className="eyebrow px-2 pb-1.5">Recent</p>
      {documents.length === 0 ? (
        <p className="px-2 py-1 text-[12px] text-ink-muted">Nothing yet</p>
      ) : (
        <div className="space-y-px">
          {documents.map((doc) => (
            <button
              key={doc.id}
              onClick={() => onDocumentClick(doc)}
              onContextMenu={(event) => onContextMenu(event, doc.id)}
              className="flex w-full items-baseline gap-2 rounded-[6px] px-2 py-1.5 text-left transition-colors hover:bg-surface"
            >
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink-secondary group-hover:text-ink">
                {doc.title || 'Untitled'}
              </span>
              <span className="shrink-0 font-mono text-[10px] tabular-nums tracking-[0.04em] text-ink-muted">{formatRelative(doc.updated)}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

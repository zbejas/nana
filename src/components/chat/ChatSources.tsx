import { Link } from 'react-router-dom';
import { DocumentTextIcon, ViewColumnsIcon } from '@heroicons/react/24/outline';
import type { ChatSource } from '../../api/chat/types';

interface ChatSourcesProps {
  sources?: ChatSource[];
}

function sourceHref(source: ChatSource): string | null {
  if (!source.id) return null;
  return source.type === 'board'
    ? `/board/${encodeURIComponent(source.id)}`
    : `/document/${encodeURIComponent(source.id)}`;
}

/** Server-provided source links. Nothing is inferred from the answer text. */
export function ChatSources({ sources = [] }: ChatSourcesProps) {
  const clean = sources.filter((source) => source.title);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[11.5px]">
      <span className="font-medium text-ink-muted">
        {clean.length > 0 ? `Sources · ${clean.length}` : 'No note sources'}
      </span>
      {clean.length > 0 && (
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          {clean.map((source, index) => {
            const href = sourceHref(source);
            const Icon = source.type === 'board' ? ViewColumnsIcon : DocumentTextIcon;
            const content = (
              <>
                <Icon className="h-3 w-3 shrink-0 text-ink-muted" aria-hidden="true" />
                <span className="max-w-[11rem] truncate" title={source.title}>{source.title}</span>
              </>
            );
            const className = 'inline-flex h-6 max-w-[13rem] items-center gap-1 rounded-[5px] border border-line bg-surface px-1.5 text-ink-secondary transition-colors hover:border-line-strong hover:text-ink';
            return href ? (
              <Link key={`${source.type}:${source.id}:${index}`} to={href} className={className}>
                {content}
              </Link>
            ) : (
              <span key={`${source.type}:${source.title}:${index}`} className={className}>
                {content}
              </span>
            );
          })}
        </span>
      )}
    </div>
  );
}

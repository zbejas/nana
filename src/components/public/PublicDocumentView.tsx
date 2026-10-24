import { ChevronRightIcon, PaperClipIcon } from '@heroicons/react/24/outline';
import { useState } from 'react';
import { MarkdownPreview } from '../MarkdownPreview';
import { PublicAttachmentList } from './PublicAttachmentList';
import { EmptyState } from '../ui';

interface PublicDocumentViewProps {
    content: string;
    attachments: string[];
    getAttachmentUrl: (filename: string) => string;
    collapsibleAttachments?: boolean;
    animationKey?: string;
    className?: string;
    emptyMessage?: string;
}

/**
 * The public reading surface. One narrow column, warm paper, generous line
 * height. It is the same content as the app without any of the app chrome.
 */
export function PublicDocumentView({
    content,
    attachments,
    getAttachmentUrl,
    collapsibleAttachments = false,
    animationKey,
    className = '',
    emptyMessage,
}: PublicDocumentViewProps) {
    const [attachmentsExpanded, setAttachmentsExpanded] = useState(false);
    const hasAttachments = attachments.length > 0;

    if (emptyMessage && !content) {
        return (
            <div className={`rounded-panel border border-line bg-surface p-4 ${className}`}>
                <EmptyState compact title="Nothing here yet" description={emptyMessage} />
            </div>
        );
    }

    return (
        <main className={`overflow-hidden rounded-panel border border-line bg-surface ${className}`}>
            <div key={animationKey || 'default'} className="public-content-enter px-5 py-8 sm:px-10 sm:py-12">
                <MarkdownPreview content={content} className="text-ink-secondary" />

                {hasAttachments && (
                    <div className="mt-10 border-t border-line pt-6">
                        {collapsibleAttachments ? (
                            <>
                                <button
                                    type="button"
                                    onClick={() => setAttachmentsExpanded((current) => !current)}
                                    className="flex w-full items-center justify-between gap-3 rounded-control border border-line bg-surface-sunken/50 px-3 py-3 text-left text-sm font-medium text-ink transition-colors hover:bg-surface-sunken"
                                    aria-expanded={attachmentsExpanded}
                                >
                                    <span className="flex items-center gap-2">
                                        <PaperClipIcon className="h-4 w-4 text-warning" />
                                        Attachments
                                        <span className="text-[11px] font-normal text-ink-muted">({attachments.length})</span>
                                    </span>
                                    <ChevronRightIcon className={`h-4 w-4 text-ink-muted public-chevron-rotate ${attachmentsExpanded ? 'rotate-90' : ''}`} />
                                </button>

                                {attachmentsExpanded && (
                                    <div className="public-attachment-panel-enter mt-4">
                                        <PublicAttachmentList attachments={attachments} getAttachmentUrl={getAttachmentUrl} />
                                    </div>
                                )}
                            </>
                        ) : (
                            <>
                                <div className="mb-3 flex items-center gap-2 text-sm font-medium text-ink">
                                    <PaperClipIcon className="h-4 w-4 text-warning" />
                                    Attachments
                                    <span className="text-[11px] font-normal text-ink-muted">({attachments.length})</span>
                                </div>
                                <PublicAttachmentList attachments={attachments} getAttachmentUrl={getAttachmentUrl} />
                            </>
                        )}
                    </div>
                )}
            </div>
        </main>
    );
}

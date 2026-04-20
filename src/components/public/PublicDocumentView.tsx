import { ChevronRightIcon, PaperClipIcon } from '@heroicons/react/24/outline';
import { useState } from 'react';
import { MarkdownPreview } from '../MarkdownPreview';
import { PublicAttachmentList } from './PublicAttachmentList';

interface PublicDocumentViewProps {
    /** Rendered markdown content (already processed with rewritten URLs) */
    content: string;
    /** List of attachment filenames */
    attachments: string[];
    /** Function to get the URL for an attachment filename */
    getAttachmentUrl: (filename: string) => string;
    /** Whether attachments should be collapsible (folder page) or always visible (document page) */
    collapsibleAttachments?: boolean;
    /** Optional key for triggering enter animation on document switch */
    animationKey?: string;
    /** Additional className for the <main> element */
    className?: string;
    /** Message shown when there's no content */
    emptyMessage?: string;
}

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

    // If emptyMessage is provided and there's no content, show empty state
    if (emptyMessage && !content) {
        return (
            <main className={`min-w-0 overflow-hidden rounded-2xl border border-stone-700/60 bg-stone-900/70 ring-1 ring-white/[0.06] shadow-lg shadow-black/20 ${className}`}>
                <div className="rounded-lg border border-stone-700/60 bg-stone-800/30 p-8 text-stone-300">
                    {emptyMessage}
                </div>
            </main>
        );
    }

    return (
        <main className={`min-w-0 overflow-hidden rounded-2xl border border-stone-700/60 bg-stone-900/70 ring-1 ring-white/[0.06] shadow-lg shadow-black/20 ${className}`}>
            <div key={animationKey || 'default'} className="public-content-enter">
                <MarkdownPreview content={content} className="text-stone-100" />

                {hasAttachments && (
                    <div className="border-t border-stone-700/60 pt-6 mt-8">
                        <section>
                            {collapsibleAttachments ? (
                                <>
                                    <button
                                        type="button"
                                        onClick={() => setAttachmentsExpanded((current) => !current)}
                                        className="flex w-full items-center justify-between gap-3 rounded-lg border border-stone-700/60 bg-stone-800/50 px-3 py-3 text-left text-sm font-medium text-white transition-colors hover:bg-stone-800/80"
                                        aria-expanded={attachmentsExpanded}
                                    >
                                        <span className="flex items-center gap-2">
                                            <PaperClipIcon className="h-4 w-4 text-amber-300" />
                                            Attachments
                                        </span>
                                        <ChevronRightIcon className={`h-4 w-4 text-stone-400 public-chevron-rotate ${attachmentsExpanded ? 'is-open' : ''}`} />
                                    </button>

                                    {attachmentsExpanded && (
                                        <div className="mt-4 public-attachment-panel-enter">
                                            <PublicAttachmentList
                                                attachments={attachments}
                                                getAttachmentUrl={getAttachmentUrl}
                                            />
                                        </div>
                                    )}
                                </>
                            ) : (
                                <>
                                    <div className="mb-3 flex items-center gap-2 text-sm font-medium text-white">
                                        <PaperClipIcon className="h-4 w-4 text-amber-300" />
                                        Attachments
                                    </div>
                                    <PublicAttachmentList
                                        attachments={attachments}
                                        getAttachmentUrl={getAttachmentUrl}
                                    />
                                </>
                            )}
                        </section>
                    </div>
                )}
            </div>
        </main>
    );
}

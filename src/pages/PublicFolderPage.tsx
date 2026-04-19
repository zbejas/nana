import { ChevronRightIcon, ListBulletIcon, PaperClipIcon } from '@heroicons/react/24/outline';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useParams } from 'react-router-dom';
import { PublicAttachmentList } from '../components/public/PublicAttachmentList';
import { PublicTopBar } from '../components/public/PublicTopBar';
import logo from '../assets/nana.svg';
import { MarkdownPreview } from '../components/MarkdownPreview';
import { PublicFolderTree } from '../components/public/PublicFolderTree';
import {
    buildPublicFolderTree,
    fetchPublicFolderShare,
    getPublicFolderAttachmentUrl,
    rewritePublicAttachmentUrls,
    type PublicFolderShareResponse,
} from '../lib/public-sharing';

export function PublicFolderPage() {
    const { shareToken = '' } = useParams<{ shareToken: string }>();
    const [searchParams, setSearchParams] = useSearchParams();
    const [data, setData] = useState<PublicFolderShareResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [attachmentsExpanded, setAttachmentsExpanded] = useState(false);
    const [shareTokenCopied, setShareTokenCopied] = useState(false);

    useEffect(() => {
        let cancelled = false;

        setLoading(true);
        setError(null);

        fetchPublicFolderShare(shareToken)
            .then((response) => {
                if (!cancelled) {
                    setData(response);
                }
            })
            .catch((err: Error) => {
                if (!cancelled) {
                    setError(err.message === 'not-found' ? 'This public folder is unavailable.' : 'Failed to load public folder.');
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [shareToken]);

    const selectedDocumentId = searchParams.get('document');
    const documentsByFolderId = useMemo(() => {
        const map = new Map<string, typeof data.documents>();

        if (!data) {
            return map;
        }

        for (const document of data.documents) {
            const key = document.folder || data.rootFolder.id;
            const group = map.get(key) || [];
            group.push(document);
            map.set(key, group);
        }

        return map;
    }, [data]);

    const folderTree = useMemo(() => (data ? buildPublicFolderTree(data) : []), [data]);

    const activeDocument = useMemo(() => {
        if (!data) {
            return null;
        }

        const nextDocumentId = selectedDocumentId || data.entryDocumentId;
        return data.documents.find((document) => document.id === nextDocumentId) || data.documents[0] || null;
    }, [data, selectedDocumentId]);

    useEffect(() => {
        if (!data || !activeDocument || selectedDocumentId === activeDocument.id) {
            return;
        }

        const nextSearchParams = new URLSearchParams(searchParams);
        nextSearchParams.set('document', activeDocument.id);
        setSearchParams(nextSearchParams, { replace: true });
    }, [activeDocument, data, searchParams, selectedDocumentId, setSearchParams]);

    const renderedContent = useMemo(() => {
        if (!activeDocument) {
            return '';
        }

        return rewritePublicAttachmentUrls(
            activeDocument.content,
            activeDocument,
            (filename) => getPublicFolderAttachmentUrl(shareToken, activeDocument.id, filename),
        );
    }, [activeDocument, shareToken]);

    const handleSelectDocument = (documentId: string) => {
        const nextSearchParams = new URLSearchParams(searchParams);
        nextSearchParams.set('document', documentId);
        setSearchParams(nextSearchParams, { replace: true });
    };

    const hasAttachments = Boolean(activeDocument && activeDocument.attachments.length > 0);

    const handleCopyShareToken = async () => {
        await navigator.clipboard.writeText(shareToken);
        setShareTokenCopied(true);
        window.setTimeout(() => setShareTokenCopied(false), 1800);
    };

    if (loading) {
        return <div className="h-full bg-black/25 backdrop-blur-sm p-6 text-stone-200">Loading public docs...</div>;
    }

    if (error || !data) {
        return (
            <div className="min-h-full bg-black/25 backdrop-blur-sm px-4 py-6 sm:px-6 lg:px-10">
                <div className="mx-auto flex min-h-full max-w-4xl items-center justify-center py-8 sm:py-14">
                    <section className="w-full overflow-hidden rounded-2xl border border-white/15 bg-black/60 backdrop-blur-xl p-6 text-white shadow-2xl sm:p-10">
                        <div>
                            <div className="flex flex-col items-center text-center">
                                <img src={logo} alt="Nana" className="h-16 w-16 sm:h-20 sm:w-20" />
                                <div className="mt-4 text-[11px] uppercase tracking-[0.24em] text-amber-200/80">Nana</div>
                                <div className="mt-3 text-4xl font-semibold tracking-[0.18em] text-amber-100 sm:text-5xl">404</div>
                            </div>

                            <h1 className="mt-8 text-center text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                                This folder was not found
                            </h1>
                            <p className="mx-auto mt-4 max-w-2xl text-center text-base leading-7 text-stone-300 sm:text-lg">
                                The owner may have stopped sharing it, the public link may have expired, or this URL may no longer be valid.
                            </p>

                            <div className="mx-auto mt-8 max-w-xl rounded-lg border border-white/10 bg-white/5 p-4 sm:p-5">
                                <div className="flex items-center justify-between gap-4">
                                    <div className="min-w-0">
                                        <div className="text-[11px] uppercase tracking-[0.22em] text-stone-400">Share token</div>
                                        <div className="mt-2 truncate font-mono text-sm text-stone-200">{shareToken}</div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => { void handleCopyShareToken(); }}
                                        className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white transition-colors hover:bg-white/10"
                                    >
                                        {shareTokenCopied ? 'Copied' : 'Copy'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>
            </div>
        );
    }

    const topBarRight = data.expiresAt ? (
        <div className="rounded-lg border border-amber-400/20 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-100 whitespace-nowrap">
            Expires {new Date(data.expiresAt).toLocaleString()}
        </div>
    ) : undefined;

    return (
        <div className="min-h-screen flex flex-col bg-black/25 backdrop-blur-sm">

            <PublicTopBar
                subtitle={data.rootFolder.name}
                author={data.author?.name}
                title={activeDocument?.title || 'Untitled'}
                rightContent={topBarRight}
            />

            <div className="mx-auto mt-4 w-full max-w-7xl px-4 sm:px-6 lg:px-10 grid grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-6 lg:items-start">
                <aside className="overflow-hidden rounded-2xl border border-white/15 bg-white/8 px-5 pb-5 pt-5 sm:px-8 sm:pb-8 sm:pt-6 lg:sticky lg:top-[4.5rem] lg:max-h-[calc(100vh-5.5rem)] lg:overflow-y-auto">
                    <div>
                        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-white">
                            <ListBulletIcon className="h-4 w-4 text-amber-300" />
                            Navigation
                        </div>
                    <PublicFolderTree
                            nodes={folderTree}
                            documentsByFolderId={documentsByFolderId}
                            selectedDocumentId={activeDocument?.id || null}
                            onSelectDocument={handleSelectDocument}
                            rootFolderId={data.rootFolder.id}
                        />
                    </div>

                </aside>

                <main className="min-w-0 overflow-hidden rounded-2xl border border-white/15 bg-white/8 px-5 pb-5 pt-5 sm:px-8 sm:pb-8 sm:pt-6 lg:mt-1.5">
                    <div key={activeDocument?.id || 'empty'} className="public-content-enter">
                        {activeDocument ? (
                            <>
                                <MarkdownPreview content={renderedContent} className="text-stone-100" />

                                {hasAttachments && (
                                    <div className="border-t border-white/10 pt-6 mt-8">
                                        <section>
                                            <button
                                                type="button"
                                                onClick={() => setAttachmentsExpanded((current) => !current)}
                                                className="flex w-full items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-left text-sm font-medium text-white transition-colors hover:bg-white/10"
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
                                                        attachments={activeDocument.attachments}
                                                        getAttachmentUrl={(filename) => getPublicFolderAttachmentUrl(shareToken, activeDocument.id, filename)}
                                                    />
                                                </div>
                                            )}
                                        </section>
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="rounded-lg border border-white/10 bg-white/5 p-8 text-stone-300">
                                No documents are available in this public folder.
                            </div>
                        )}
                    </div>
                </main>
            </div>

            <footer className="mt-auto pt-6 pb-4 px-4 sm:px-6 lg:px-10 text-center sm:text-right text-sm text-stone-500">
                Powered by <a href="https://nana.fyi" target="_blank" rel="noopener noreferrer" className="text-amber-200/80 hover:text-amber-100 transition-colors">Nana</a>
            </footer>
        </div>
    );
}

export default PublicFolderPage;
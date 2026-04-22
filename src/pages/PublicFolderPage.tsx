import { ListBulletIcon } from '@heroicons/react/24/outline';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useParams } from 'react-router-dom';
import { PublicDocumentView } from '../components/public/PublicDocumentView';
import { PublicTopBar } from '../components/public/PublicTopBar';
import logo from '../assets/nana.svg';
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

        if (!data?.shareAttachments) {
            return activeDocument.content;
        }

        return rewritePublicAttachmentUrls(
            activeDocument.content,
            activeDocument,
            (filename) => getPublicFolderAttachmentUrl(shareToken, activeDocument.id, filename),
        );
    }, [activeDocument, data, shareToken]);

    const handleSelectDocument = (documentId: string) => {
        const nextSearchParams = new URLSearchParams(searchParams);
        nextSearchParams.set('document', documentId);
        setSearchParams(nextSearchParams, { replace: true });
    };

    const handleCopyShareToken = async () => {
        await navigator.clipboard.writeText(shareToken);
        setShareTokenCopied(true);
        window.setTimeout(() => setShareTokenCopied(false), 1800);
    };

    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-[#0a0908]">
                <div className="pointer-events-none fixed inset-0 z-0 bg-gradient-to-br from-[#0a0908] via-[#141010] to-[#0a0908]" aria-hidden="true" />
                <div className="flex flex-col items-center gap-3">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-amber-500/30 border-t-amber-400" />
                    <span className="text-sm text-stone-400">Loading public docs…</span>
                </div>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="min-h-full bg-stone-950 px-4 py-6 sm:px-6 lg:px-10">
                <div className="pointer-events-none fixed inset-0 z-0 bg-gradient-to-br from-stone-950 via-stone-900 to-stone-950" aria-hidden="true" />
                <div className="mx-auto flex min-h-full max-w-4xl items-center justify-center py-8 sm:py-14">
                    <section className="w-full overflow-hidden rounded-2xl border border-stone-700/60 bg-stone-900/80 backdrop-blur-xl p-6 text-white shadow-2xl sm:p-10">
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

                            <div className="mx-auto mt-8 max-w-xl rounded-lg border border-stone-700/60 bg-stone-800/50 p-4 sm:p-5">
                                <div className="flex items-center justify-between gap-4">
                                    <div className="min-w-0">
                                        <div className="text-[11px] uppercase tracking-[0.22em] text-stone-400">Share token</div>
                                        <div className="mt-2 truncate font-mono text-sm text-stone-200">{shareToken}</div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => { void handleCopyShareToken(); }}
                                        className="shrink-0 rounded-lg border border-stone-700/60 bg-stone-800/50 px-3 py-2 text-sm text-white transition-colors hover:bg-stone-700/60"
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

    const topBarRight = (
        <div className="flex items-center gap-3">
            {activeDocument?.updated && (
                <div className="flex items-center gap-1.5 text-xs text-stone-400 whitespace-nowrap">
                    <span>Updated {new Date(activeDocument.updated).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                </div>
            )}
            {data.expiresAt && (
                <div className="rounded-lg border border-amber-400/20 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-100 whitespace-nowrap">
                    Expires {new Date(data.expiresAt).toLocaleString()}
                </div>
            )}
        </div>
    );

    return (
        <div className="min-h-screen flex flex-col bg-[#0a0908]">
            <div className="pointer-events-none fixed inset-0 z-0 bg-gradient-to-br from-[#0a0908] via-[#141010] to-[#0a0908]" aria-hidden="true" />
            <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(ellipse_at_top,rgba(217,119,6,0.04),transparent_50%)]" aria-hidden="true" />

            <PublicTopBar
                subtitle={data.rootFolder.name}
                author={data.author?.name}
                title={activeDocument?.title || 'Untitled'}
                rightContent={topBarRight}
                logo={logo}
            />

            <div className="relative z-10 mx-auto mt-4 mb-6 w-full max-w-7xl flex-1 px-4 sm:px-6 lg:px-10 flex flex-col lg:flex-row gap-4 lg:gap-6 lg:items-start">
                <aside className="w-full lg:w-[280px] shrink-0 overflow-hidden rounded-2xl border border-stone-700/60 bg-stone-900/70 ring-1 ring-white/[0.06] px-5 pb-5 pt-5 sm:px-8 sm:pb-8 sm:pt-6 lg:sticky lg:top-[4.5rem] lg:max-h-[calc(100vh-5.5rem)] lg:overflow-y-auto shadow-lg shadow-black/20">
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

                <div className="min-w-0 flex-1 lg:mt-1">
                    {activeDocument ? (
                        <PublicDocumentView
                            content={renderedContent}
                            attachments={data.shareAttachments ? activeDocument.attachments : []}
                            getAttachmentUrl={(filename) => getPublicFolderAttachmentUrl(shareToken, activeDocument.id, filename)}
                            collapsibleAttachments
                            animationKey={activeDocument.id}
                            className="px-5 pb-5 pt-5 sm:px-8 sm:pb-8 sm:pt-6"
                        />
                    ) : (
                        <PublicDocumentView
                            content=""
                            attachments={[]}
                            getAttachmentUrl={() => ''}
                            emptyMessage="No documents are available in this public folder."
                            className="px-5 pb-5 pt-5 sm:px-8 sm:pb-8 sm:pt-6"
                        />
                    )}
                </div>
            </div>

            <footer className="relative z-10 mt-auto pt-8 pb-5 px-4 sm:px-6 lg:px-10 text-center sm:text-right text-sm text-stone-500">
                Powered by <a href="https://nana.fyi" target="_blank" rel="noopener noreferrer" className="text-amber-200/80 hover:text-amber-100 transition-colors">Nana</a>
            </footer>
        </div>
    );
}

export default PublicFolderPage;
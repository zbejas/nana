import { BookOpenIcon, ClockIcon } from '@heroicons/react/24/outline';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useParams } from 'react-router-dom';
import { PublicDocumentView } from '../components/public/PublicDocumentView';
import { PublicTopBar } from '../components/public/PublicTopBar';
import { PublicFolderTree } from '../components/public/PublicFolderTree';
import { PublicBoardView } from '../components/public/PublicBoardView';
import { countDoneTasks, countOpenTasks } from '../components/public/board';
import { Badge, Button } from '../components/ui';
import logo from '../assets/nana.svg';
import {
    buildPublicFolderTree,
    fetchPublicFolderShare,
    getPublicFolderAttachmentUrl,
    rewritePublicAttachmentUrls,
    type PublicFolderBoard,
    type PublicFolderShareResponse,
} from '../lib/public-sharing';

export function PublicFolderPage() {
    const { shareToken = '' } = useParams<{ shareToken: string }>();
    const [searchParams, setSearchParams] = useSearchParams();
    const [data, setData] = useState<PublicFolderShareResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

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
                    setError(err.message === 'not-found' ? 'This public folder is unavailable.' : 'Failed to load the public folder.');
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
    const selectedBoardId = searchParams.get('board');

    const boards = useMemo(() => data?.boards ?? [], [data]);

    const documentsByFolderId = useMemo(() => {
        const map = new Map<string, PublicFolderShareResponse['documents']>();

        if (!data) {
            return map;
        }

        for (const document of data.documents ?? []) {
            const key = document.folder || data.rootFolder.id || '';
            const group = map.get(key) || [];
            group.push(document);
            map.set(key, group);
        }

        return map;
    }, [data]);

    const boardsByFolderId = useMemo(() => {
        const map = new Map<string, PublicFolderBoard[]>();

        if (!data) {
            return map;
        }

        for (const board of boards) {
            const key = board.folder || data.rootFolder.id || '';
            const group = map.get(key) || [];
            group.push(board);
            map.set(key, group);
        }

        return map;
    }, [boards, data]);

    const folderTree = useMemo(() => (data ? buildPublicFolderTree(data) : []), [data]);

    const activeDocument = useMemo(() => {
        if (!data) {
            return null;
        }

        if (selectedDocumentId) {
            const selectedDocument = data.documents.find((document) => document.id === selectedDocumentId);
            if (selectedDocument) {
                return selectedDocument;
            }
        }

        if (selectedBoardId) {
            return null;
        }

        const nextDocumentId = data.entryDocumentId;
        return data.documents.find((document) => document.id === nextDocumentId) || data.documents[0] || null;
    }, [data, selectedBoardId, selectedDocumentId]);

    const activeBoard = useMemo(() => {
        if (!data) {
            return null;
        }

        if (selectedBoardId) {
            return boards.find((board) => board.id === selectedBoardId) || null;
        }

        if (selectedDocumentId || activeDocument) {
            return null;
        }

        return boards[0] || null;
    }, [activeDocument, boards, data, selectedBoardId, selectedDocumentId]);

    useEffect(() => {
        if (!data) {
            return;
        }

        if (activeBoard) {
            if (selectedBoardId === activeBoard.id) {
                return;
            }

            const nextSearchParams = new URLSearchParams(searchParams);
            nextSearchParams.delete('document');
            nextSearchParams.set('board', activeBoard.id);
            setSearchParams(nextSearchParams, { replace: true });
            return;
        }

        if (activeDocument && selectedDocumentId !== activeDocument.id) {
            const nextSearchParams = new URLSearchParams(searchParams);
            nextSearchParams.delete('board');
            nextSearchParams.set('document', activeDocument.id);
            setSearchParams(nextSearchParams, { replace: true });
        }
    }, [activeBoard, activeDocument, data, searchParams, selectedBoardId, selectedDocumentId, setSearchParams]);

    const activeBoardCounts = useMemo(
        () => ({
            open: activeBoard ? countOpenTasks(activeBoard.tasks) : 0,
            done: activeBoard ? countDoneTasks(activeBoard.tasks) : 0,
        }),
        [activeBoard],
    );

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
        nextSearchParams.delete('board');
        nextSearchParams.set('document', documentId);
        setSearchParams(nextSearchParams, { replace: true });
    };

    const handleSelectBoard = (boardId: string) => {
        const nextSearchParams = new URLSearchParams(searchParams);
        nextSearchParams.delete('document');
        nextSearchParams.set('board', boardId);
        setSearchParams(nextSearchParams, { replace: true });
    };

    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <img src={logo} alt="Nana" className="h-14 w-14 opacity-90" />
                    <span className="h-6 w-6 animate-spin rounded-full border-2 border-line-strong border-t-signal" />
                    <span className="text-sm text-ink-muted">Opening the folder…</span>
                </div>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="flex min-h-screen items-center justify-center px-4 py-10">
                <div className="w-full max-w-md rounded-panel border border-line bg-surface p-6 text-center sm:p-8">
                    <img src={logo} alt="Nana" className="mx-auto h-16 w-16" />
                    <h1 className="mt-5 text-2xl text-ink">This link is not available</h1>
                    <p className="mt-3 text-sm leading-relaxed text-ink-secondary">
                        {error ?? 'The owner may have stopped sharing this folder, or the link has expired.'}
                    </p>
                    <a href="/" className="mt-6 inline-block">
                        <Button variant="secondary">Open Nana</Button>
                    </a>
                </div>
            </div>
        );
    }

    const topBarRight = (
        <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-end">
            {activeBoard && (
                <span className="inline-flex items-center gap-1.5 text-[11.5px] tabular-nums text-ink-muted">
                    <ClockIcon className="h-3.5 w-3.5" />
                    {activeBoardCounts.open} open · {activeBoardCounts.done} done
                </span>
            )}
            {(activeBoard?.updated || activeDocument?.updated) && (
                <span className="hidden text-[11.5px] text-ink-muted sm:inline">
                    Updated{' '}
                    {new Date(activeBoard?.updated || activeDocument?.updated || '').toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                    })}
                </span>
            )}
            {data.expiresAt && <Badge tone="warning">Expires {new Date(data.expiresAt).toLocaleDateString()}</Badge>}
        </div>
    );

    return (
        <div className="flex min-h-screen flex-col">
            <PublicTopBar
                subtitle={data.rootFolder.name}
                author={data.author?.name}
                title={activeBoard?.name || activeDocument?.title || data.rootFolder.name}
                rightContent={topBarRight}
                logo={logo}
            />

            <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5 px-4 py-6 lg:flex-row lg:items-start lg:gap-8 lg:px-6 lg:py-8">
                <aside className="w-full shrink-0 lg:sticky lg:top-24 lg:w-64">
                    <div className="overflow-hidden rounded-panel border border-line bg-surface">
                        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
                            <BookOpenIcon className="h-4 w-4 text-ink-muted" />
                            <p className="text-[11.5px] font-medium text-ink-muted">Contents</p>
                        </div>
                        <div className="px-3 py-3">
                            <PublicFolderTree
                                nodes={folderTree}
                                documentsByFolderId={documentsByFolderId}
                                boardsByFolderId={boardsByFolderId}
                                selectedDocumentId={activeDocument?.id || null}
                                selectedBoardId={activeBoard?.id || null}
                                onSelectDocument={handleSelectDocument}
                                onSelectBoard={handleSelectBoard}
                                rootFolderId={data.rootFolder.id}
                            />
                        </div>
                    </div>
                </aside>

                <div className="mx-auto w-full min-w-0 max-w-3xl flex-1">
                    {activeBoard ? (
                        <PublicBoardView board={activeBoard} tasks={activeBoard.tasks} />
                    ) : activeDocument ? (
                        <PublicDocumentView
                            content={renderedContent}
                            attachments={data.shareAttachments ? activeDocument.attachments : []}
                            getAttachmentUrl={(filename) => getPublicFolderAttachmentUrl(shareToken, activeDocument.id, filename)}
                            collapsibleAttachments
                            animationKey={activeDocument.id}
                        />
                    ) : (
                        <PublicDocumentView
                            content=""
                            attachments={[]}
                            getAttachmentUrl={() => ''}
                            emptyMessage="The owner has not added any notes or boards to this folder yet."
                        />
                    )}
                </div>
            </div>

            <footer className="px-4 pb-6 pt-4 text-center text-[11.5px] text-ink-muted">
                Published with{' '}
                <a href="https://nana.fyi" target="_blank" rel="noopener noreferrer" className="text-signal hover:text-signal-strong">
                    Nana
                </a>
            </footer>
        </div>
    );
}

export default PublicFolderPage;

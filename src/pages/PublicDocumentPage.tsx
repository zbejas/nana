import { ClockIcon, PaperClipIcon } from '@heroicons/react/24/outline';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { PublicAttachmentList } from '../components/public/PublicAttachmentList';
import { PublicTopBar } from '../components/public/PublicTopBar';
import logo from '../assets/nana.svg';
import { MarkdownPreview } from '../components/MarkdownPreview';
import {
    fetchPublicDocumentShare,
    getPublicDocumentAttachmentUrl,
    rewritePublicAttachmentUrls,
    type PublicDocumentShareResponse,
} from '../lib/public-sharing';

export function PublicDocumentPage() {
    const { shareToken = '' } = useParams<{ shareToken: string }>();
    const [data, setData] = useState<PublicDocumentShareResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [shareTokenCopied, setShareTokenCopied] = useState(false);

    useEffect(() => {
        let cancelled = false;

        setLoading(true);
        setError(null);

        fetchPublicDocumentShare(shareToken)
            .then((response) => {
                if (!cancelled) {
                    setData(response);
                }
            })
            .catch((err: Error) => {
                if (!cancelled) {
                    setError(err.message === 'not-found' ? 'This public document is unavailable.' : 'Failed to load public document.');
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

    const renderedContent = useMemo(() => {
        if (!data) {
            return '';
        }

        return rewritePublicAttachmentUrls(
            data.document.content,
            data.document,
            (filename) => getPublicDocumentAttachmentUrl(shareToken, filename),
        );
    }, [data, shareToken]);

    const handleCopyShareToken = async () => {
        await navigator.clipboard.writeText(shareToken);
        setShareTokenCopied(true);
        window.setTimeout(() => setShareTokenCopied(false), 1800);
    };

    if (loading) {
        return <div className="h-full bg-black/25 backdrop-blur-sm p-6 text-stone-200">Loading public document...</div>;
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
                                This document was not found
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

    const hasAttachments = data.document.attachments.length > 0;

    const topBarRight = (
        <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-stone-300 whitespace-nowrap">
                <ClockIcon className="h-3.5 w-3.5 text-amber-300" />
                <span>{data.document.reading_time || 0} min</span>
            </div>
            {data.expiresAt && (
                <div className="rounded-lg border border-amber-400/20 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-100 whitespace-nowrap">
                    Expires {new Date(data.expiresAt).toLocaleString()}
                </div>
            )}
        </div>
    );

    return (
        <div className="min-h-screen flex flex-col bg-black/25 backdrop-blur-sm overflow-x-hidden">

            <PublicTopBar
                author={data.author?.name}
                title={data.document.title || 'Untitled'}
                rightContent={topBarRight}
            />

            <div className="mx-auto mt-4 w-full max-w-5xl px-4 sm:px-6 lg:px-10">
                <main className="min-w-0 overflow-hidden rounded-2xl border border-white/15 bg-white/8 p-5 sm:p-8">
                    <div className="public-content-enter">
                        <MarkdownPreview content={renderedContent} className="text-stone-100" />

                        {hasAttachments && (
                            <div className="border-t border-white/10 pt-6 mt-8">
                                <section>
                                    <div className="mb-3 flex items-center gap-2 text-sm font-medium text-white">
                                        <PaperClipIcon className="h-4 w-4 text-amber-300" />
                                        Attachments
                                    </div>
                                    <PublicAttachmentList
                                        attachments={data.document.attachments}
                                        getAttachmentUrl={(filename) => getPublicDocumentAttachmentUrl(shareToken, filename)}
                                    />
                                </section>
                            </div>
                        )}
                    </div>
                </main>
            </div>

            <footer className="mx-auto w-full max-w-5xl mt-auto pt-6 pb-4 px-4 sm:px-6 lg:px-10 text-center sm:text-right text-sm text-stone-500">
                Powered by <a href="https://nana.fyi" target="_blank" rel="noopener noreferrer" className="text-amber-200/80 hover:text-amber-100 transition-colors">Nana</a>
            </footer>
        </div>
    );
}

export default PublicDocumentPage;
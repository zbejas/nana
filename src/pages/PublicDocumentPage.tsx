import { ClockIcon } from '@heroicons/react/24/outline';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { PublicDocumentView } from '../components/public/PublicDocumentView';
import { PublicTopBar } from '../components/public/PublicTopBar';
import { Badge, Button } from '../components/ui';
import logo from '../assets/nana.svg';
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
                    setError(err.message === 'not-found' ? 'This public note is unavailable.' : 'Failed to load the public note.');
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

        if (!data.shareAttachments) {
            return data.document.content;
        }

        return rewritePublicAttachmentUrls(
            data.document.content,
            data.document,
            (filename) => getPublicDocumentAttachmentUrl(shareToken, filename),
        );
    }, [data, shareToken]);

    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <img src={logo} alt="Nana" className="h-14 w-14 opacity-90" />
                    <span className="h-6 w-6 animate-spin rounded-full border-2 border-line-strong border-t-signal" />
                    <span className="text-sm text-ink-muted">Opening the note…</span>
                </div>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="flex min-h-screen items-center justify-center px-4 py-10">
                <div className="w-full max-w-md rounded-panel border border-line bg-surface p-6 text-center sm:p-8">
                    <img src={logo} alt="Nana" className="mx-auto h-16 w-16" />
                    <p className="eyebrow mt-5">Public note</p>
                    <h1 className="mt-2 font-display text-2xl text-ink">This link is not available</h1>
                    <p className="mt-3 text-sm leading-relaxed text-ink-secondary">
                        {error ?? 'The owner may have stopped sharing this note, or the link has expired.'}
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
            <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted">
                <ClockIcon className="h-3.5 w-3.5" />
                {data.document.reading_time || 0} min
            </span>
            {data.document.updated && (
                <span className="hidden text-[11px] text-ink-muted sm:inline">
                    Updated {new Date(data.document.updated).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
            )}
            {data.expiresAt && (
                <Badge tone="warning">Expires {new Date(data.expiresAt).toLocaleDateString()}</Badge>
            )}
        </div>
    );

    return (
        <div className="flex min-h-screen flex-col">
            <PublicTopBar
                author={data.author?.name}
                title={data.document.title || 'Untitled'}
                rightContent={topBarRight}
                logo={logo}
            />

            <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-7 sm:px-6 sm:py-10">
                <PublicDocumentView
                    content={renderedContent}
                    attachments={data.shareAttachments ? data.document.attachments : []}
                    getAttachmentUrl={(filename) => getPublicDocumentAttachmentUrl(shareToken, filename)}
                />
            </div>

            <footer className="px-4 pb-6 pt-4 text-center text-[11px] text-ink-muted">
                Published with{' '}
                <a href="https://nana.fyi" target="_blank" rel="noopener noreferrer" className="text-signal hover:text-signal-strong">
                    Nana
                </a>
            </footer>
        </div>
    );
}

export default PublicDocumentPage;

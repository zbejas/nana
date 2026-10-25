import { ClockIcon } from '@heroicons/react/24/outline';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { PublicBoardView } from '../components/public/PublicBoardView';
import { PublicTopBar } from '../components/public/PublicTopBar';
import { Badge, Button } from '../components/ui';
import logo from '../assets/nana.svg';
import {
    fetchPublicBoardShare,
    type PublicBoardShareResponse,
} from '../lib/public-sharing';
import { countDoneTasks, countOpenTasks } from '../components/public/board';

export function PublicBoardPage() {
    const { shareToken = '' } = useParams<{ shareToken: string }>();
    const [data, setData] = useState<PublicBoardShareResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        setLoading(true);
        setError(null);

        fetchPublicBoardShare(shareToken)
            .then((response) => {
                if (!cancelled) {
                    setData(response);
                }
            })
            .catch((err: Error) => {
                if (!cancelled) {
                    setError(err.message === 'not-found' ? 'This public board is unavailable.' : 'Failed to load the public board.');
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

    const counts = useMemo(
        () => ({
            open: data ? countOpenTasks(data.tasks) : 0,
            done: data ? countDoneTasks(data.tasks) : 0,
        }),
        [data],
    );

    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <img src={logo} alt="Nana" className="h-14 w-14 opacity-90" />
                    <span className="h-6 w-6 animate-spin rounded-full border-2 border-line-strong border-t-signal" />
                    <span className="text-sm text-ink-muted">Opening the board…</span>
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
                        {error ?? 'The owner may have stopped sharing this board, or the link has expired.'}
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
            <span className="inline-flex items-center gap-1.5 text-[11.5px] tabular-nums text-ink-muted">
                <ClockIcon className="h-3.5 w-3.5" />
                {counts.open} open · {counts.done} done
            </span>
            {data.board.updated && (
                <span className="hidden text-[11.5px] text-ink-muted sm:inline">
                    Updated {new Date(data.board.updated).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
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
                title={data.board.name || 'Untitled board'}
                rightContent={topBarRight}
                logo={logo}
            />

            <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-7 sm:px-6 sm:py-10">
                <PublicBoardView board={data.board} tasks={data.tasks} />
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

export default PublicBoardPage;

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowPathIcon,
  ArrowUpIcon,
  FolderIcon,
} from '@heroicons/react/24/outline';
import { getSharedFolder, type SharedFolder, type SharedTarget } from '../lib/sharing';
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  PageShell,
} from '../components/ui';
import { PermissionBadge } from '../components/sharing/PermissionBadge';
import { SharedItemRow } from '../components/sharing/SharedItemRow';
import { displayShareUserName } from '../components/sharing/share-users';
import { formatRelativeDate } from '../components/board/dates';

function noteMeta(target: SharedTarget): string {
  if (typeof target.word_count === 'number' && target.word_count > 0) {
    return `${target.word_count.toLocaleString()} ${target.word_count === 1 ? 'word' : 'words'}`;
  }
  return 'Note';
}

/**
 * Read-only browser for a folder another user shared. It never creates, edits,
 * or deletes; rows open the normal readers so permission-aware controls stay in
 * the surfaces that already own them.
 */
export function SharedFolderPage() {
  const { folderId } = useParams<{ folderId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<SharedFolder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);

  const load = useCallback(async () => {
    if (!folderId) {
      setData(null);
      setError('This shared folder link is missing an id.');
      setLoading(false);
      return;
    }

    const current = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const response = await getSharedFolder(folderId);
      if (current !== sequence.current) return;
      setData(response);
    } catch (loadError) {
      if (current !== sequence.current) return;
      setData(null);
      setError(
        loadError instanceof Error ? loadError.message : 'Could not load this shared folder.'
      );
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [folderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const folder = data?.folder;
  const owner = data?.owner ? displayShareUserName(data.owner) : 'someone';
  const itemCount = data ? data.folders.length + data.boards.length + data.documents.length : 0;
  const isEmpty = Boolean(data && itemCount === 0);

  const openFolder = (target: SharedTarget) => {
    navigate(`/shared/folders/${encodeURIComponent(target.id)}`);
  };

  return (
    <PageShell contentClassName="desktop-page-content-enter">
      <PageHeader
        back={{ label: 'Shared with me', onClick: () => navigate('/shared') }}
        title={folder?.name || 'Shared folder'}
        description={
          loading
            ? 'Loading the folder and its contents.'
            : data
              ? `Shared by ${owner}. Open a note, board, or subfolder to read it.`
              : 'This folder could not be opened.'
        }
        meta={
          data ? (
            <>
              <PermissionBadge permission={data.permission} />
              {data.access.source === 'inherited' && (
                <Badge tone="neutral">Inherited access</Badge>
              )}
              <span>
                <span className="font-medium tabular-nums text-ink">{itemCount}</span>{' '}
                {itemCount === 1 ? 'item' : 'items'}
              </span>
              {folder?.updated && <span>Updated {formatRelativeDate(folder.updated)}</span>}
            </>
          ) : undefined
        }
        actions={
          <>
            {data?.parent && (
              <Button
                variant="secondary"
                size="sm"
                icon={<ArrowUpIcon />}
                onClick={() => openFolder(data.parent as SharedTarget)}
              >
                Up to {data.parent.name || 'parent folder'}
              </Button>
            )}
          </>
        }
      />

      {loading ? (
        <div className="space-y-6" aria-busy="true" aria-label="Loading shared folder">
          <div className="h-16 animate-pulse rounded-panel bg-surface-raised" />
          <div className="overflow-hidden rounded-panel border border-line bg-surface">
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className="flex min-h-[64px] items-center gap-3 border-b border-line px-4 py-3 last:border-b-0"
              >
                <span className="h-10 w-10 animate-pulse rounded-[8px] bg-surface-raised" />
                <span className="h-3.5 w-48 max-w-full animate-pulse rounded bg-surface-raised" />
              </div>
            ))}
          </div>
        </div>
      ) : error ? (
        <EmptyState
          title="This shared folder could not load"
          description={error}
          action={
            <Button variant="secondary" icon={<ArrowPathIcon />} onClick={() => void load()}>
              Try again
            </Button>
          }
        />
      ) : isEmpty ? (
        <div className="flex min-h-[44vh] items-center justify-center pb-12">
          <EmptyState
            icon={<FolderIcon />}
            title="This shared folder is empty"
            description="Notes, boards, and subfolders added by the owner will appear here."
            className="max-w-lg"
          />
        </div>
      ) : !data ? null : (
        <div className="space-y-7 pb-2">
          {data.folders.length > 0 && (
            <section aria-labelledby="shared-folder-folders">
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <h2
                  id="shared-folder-folders"
                  className="text-[12.5px] font-semibold tracking-[-0.005em] text-ink"
                >
                  Folders
                </h2>
                <span className="text-[11.5px] tabular-nums text-ink-muted">
                  {data.folders.length}
                </span>
              </div>
              <ul className="overflow-hidden rounded-panel border border-line bg-surface">
                {data.folders.map((target) => (
                  <SharedItemRow
                    key={`folder:${target.id}`}
                    type="folder"
                    title={target.name?.trim() || 'Untitled folder'}
                    subtitle="Folder"
                    permission={data.permission}
                    activity={formatRelativeDate(target.updated)}
                    activityTitle={
                      target.updated ? new Date(target.updated).toLocaleString() : undefined
                    }
                    onOpen={() => openFolder(target)}
                  />
                ))}
              </ul>
            </section>
          )}

          {data.boards.length > 0 && (
            <section aria-labelledby="shared-folder-boards">
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <h2
                  id="shared-folder-boards"
                  className="text-[12.5px] font-semibold tracking-[-0.005em] text-ink"
                >
                  Boards
                </h2>
                <span className="text-[11.5px] tabular-nums text-ink-muted">
                  {data.boards.length}
                </span>
              </div>
              <ul className="overflow-hidden rounded-panel border border-line bg-surface">
                {data.boards.map((target) => (
                  <SharedItemRow
                    key={`board:${target.id}`}
                    type="board"
                    title={target.name?.trim() || 'Untitled board'}
                    subtitle="Board"
                    permission={data.permission}
                    activity={formatRelativeDate(target.updated)}
                    activityTitle={
                      target.updated ? new Date(target.updated).toLocaleString() : undefined
                    }
                    onOpen={() => navigate(`/board/${encodeURIComponent(target.id)}`)}
                  />
                ))}
              </ul>
            </section>
          )}

          {data.documents.length > 0 && (
            <section aria-labelledby="shared-folder-notes">
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <h2
                  id="shared-folder-notes"
                  className="text-[12.5px] font-semibold tracking-[-0.005em] text-ink"
                >
                  Notes
                </h2>
                <span className="text-[11.5px] tabular-nums text-ink-muted">
                  {data.documents.length}
                </span>
              </div>
              <ul className="overflow-hidden rounded-panel border border-line bg-surface">
                {data.documents.map((target) => (
                  <SharedItemRow
                    key={`document:${target.id}`}
                    type="document"
                    title={target.title?.trim() || 'Untitled note'}
                    subtitle={noteMeta(target)}
                    permission={data.permission}
                    activity={formatRelativeDate(target.updated)}
                    activityTitle={
                      target.updated ? new Date(target.updated).toLocaleString() : undefined
                    }
                    onOpen={() => navigate(`/document/${encodeURIComponent(target.id)}`)}
                  />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </PageShell>
  );
}

export default SharedFolderPage;

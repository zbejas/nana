import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAtomValue } from 'jotai';
import {
  ArrowPathIcon,
  EllipsisHorizontalIcon,
  MagnifyingGlassIcon,
  ShareIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import type { SharedItem } from '../lib/sharing';
import { useAuth } from '../lib/auth';
import { useToasts } from '../state/hooks';
import { useSharedWithMe } from '../state/hooks/useSharedWithMe';
import {
  sharedWithMeErrorAtom,
  sharedWithMeLoadingAtom,
} from '../state/sharing';
import {
  Button,
  EmptyState,
  IconButton,
  Input,
  MenuItem,
  MenuSurface,
  PageHeader,
  PageShell,
  SegmentedControl,
} from '../components/ui';
import { SharedItemRow } from '../components/sharing/SharedItemRow';
import {
  SHARED_TABS,
  filterSharedItems,
  groupSharedItems,
  sharedEmptyCopy,
  sharedItemHref,
  sharedItemTitle,
  sharedTabCounts,
  type SharedTab,
} from '../components/sharing/share-copy';
import { displayShareUserName } from '../components/sharing/share-users';
import { formatRelativeDate } from '../components/board/dates';

interface OpenMenu {
  item: SharedItem;
  rect: DOMRect;
}

function menuPosition(rect: DOMRect) {
  const width = 208;
  const maxTop = typeof window === 'undefined' ? rect.bottom + 6 : window.innerHeight - 150;
  const maxLeft = typeof window === 'undefined' ? rect.left : window.innerWidth - width - 8;
  return {
    top: Math.max(8, Math.min(rect.bottom + 6, maxTop)),
    left: Math.max(8, Math.min(rect.right - width, maxLeft)),
  };
}

/**
 * "Shared with me" groups folders, boards, and notes by type. Realtime refresh
 * is owned by useSharedWithMe; this page only renders and navigates.
 */
export function SharedPage() {
  const navigate = useNavigate();
  const { showToast } = useToasts();
  const { user } = useAuth();
  const { items, load } = useSharedWithMe();
  const loading = useAtomValue(sharedWithMeLoadingAtom);
  const error = useAtomValue(sharedWithMeErrorAtom);
  const [tab, setTab] = useState<SharedTab>('all');
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [loadStarted, setLoadStarted] = useState(false);

  useEffect(() => {
    if (loading) setLoadStarted(true);
  }, [loading]);

  const counts = useMemo(() => sharedTabCounts(items), [items]);
  const filtered = useMemo(() => filterSharedItems(items, tab, query), [items, query, tab]);
  const groups = useMemo(() => groupSharedItems(filtered), [filtered]);
  const emptyCopy = sharedEmptyCopy({ total: items.length, tab, query });
  const awaitingFirstLoad =
    Boolean(user?.id) && !loadStarted && !error && items.length === 0;
  const showsSkeleton = (loading || awaitingFirstLoad) && items.length === 0;

  const openItem = (item: SharedItem) => {
    navigate(sharedItemHref(item.type, item.target.id));
  };

  const handleCopyLink = async (item: SharedItem) => {
    const href = sharedItemHref(item.type, item.target.id);
    const url = new URL(href, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(url);
      showToast('Link copied', 'success');
    } catch {
      showToast('Could not copy the link', 'error');
    }
    setMenu(null);
  };

  return (
    <PageShell contentClassName="desktop-page-content-enter">
      <PageHeader
        title="Shared with me"
        description="Notes, folders, and boards other people have shared with you. Access updates as owners change it."
        meta={
          <>
            <span>
              <span className="font-medium tabular-nums text-ink">{counts.all}</span> shared
              with you
            </span>
            {counts.folders > 0 && (
              <span>
                <span className="tabular-nums text-ink">{counts.folders}</span>{' '}
                {counts.folders === 1 ? 'folder' : 'folders'}
              </span>
            )}
            {counts.boards > 0 && (
              <span>
                <span className="tabular-nums text-ink">{counts.boards}</span>{' '}
                {counts.boards === 1 ? 'board' : 'boards'}
              </span>
            )}
            {counts.notes > 0 && (
              <span>
                <span className="tabular-nums text-ink">{counts.notes}</span>{' '}
                {counts.notes === 1 ? 'note' : 'notes'}
              </span>
            )}
          </>
        }
      />

      <div className="mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="-mx-1 max-w-full overflow-x-auto px-1 pb-1">
          <SegmentedControl<SharedTab>
            value={tab}
            onChange={setTab}
            label="Filter shared items"
            options={SHARED_TABS.map((option) => ({
              value: option.value,
              label: `${option.label} ${counts[option.value]}`,
            }))}
          />
        </div>
        <div className="w-full sm:w-72">
          <Input
            type="search"
            value={query}
            placeholder="Search shared items…"
            aria-label="Search shared items"
            autoComplete="off"
            icon={<MagnifyingGlassIcon />}
            trailing={
              query ? (
                <IconButton
                  label="Clear search"
                  size="sm"
                  onClick={() => setQuery('')}
                >
                  <XMarkIcon />
                </IconButton>
              ) : undefined
            }
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      {error ? (
        <EmptyState
          title="Shared items could not load"
          description={error}
          action={
            <Button
              variant="secondary"
              icon={<ArrowPathIcon />}
              onClick={() => void load()}
            >
              Try again
            </Button>
          }
        />
      ) : showsSkeleton ? (
        <div
          className="overflow-hidden rounded-panel border border-line bg-surface"
          aria-busy="true"
          aria-label="Loading shared items"
        >
          {[0, 1, 2, 3, 4].map((index) => (
            <div
              key={index}
              className="flex min-h-[64px] items-center gap-3 border-b border-line px-3 py-3 last:border-b-0 sm:px-4"
            >
              <span className="h-10 w-10 animate-pulse rounded-[8px] bg-surface-raised" />
              <span className="min-w-0 flex-1">
                <span className="block h-3.5 w-44 max-w-full animate-pulse rounded bg-surface-raised" />
                <span className="mt-2 block h-2.5 w-32 animate-pulse rounded bg-surface-raised" />
              </span>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex min-h-[46vh] items-center justify-center pb-12">
          <EmptyState
            icon={<ShareIcon />}
            title={emptyCopy.title}
            description={emptyCopy.description}
            className="max-w-lg"
            action={
              items.length === 0 ? undefined : (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    setTab('all');
                  }}
                  className="text-[12.5px] font-medium text-signal hover:text-signal-strong"
                >
                  Clear filters
                </button>
              )
            }
          />
        </div>
      ) : (
        <div className="space-y-7 pb-2">
          {groups.map((group) => (
            <section key={group.type} aria-labelledby={`shared-group-${group.type}`}>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <h2
                  id={`shared-group-${group.type}`}
                  className="text-[12.5px] font-semibold tracking-[-0.005em] text-ink"
                >
                  {group.label}
                </h2>
                <span className="text-[11.5px] tabular-nums text-ink-muted">
                  {group.items.length}
                </span>
              </div>
              <ul className="overflow-hidden rounded-panel border border-line bg-surface">
                {group.items.map((item) => {
                  const title = sharedItemTitle(item);
                  const owner = item.sharedBy ? displayShareUserName(item.sharedBy) : 'someone';
                  const activity = formatRelativeDate(item.target.updated);
                  return (
                    <SharedItemRow
                      key={`${item.type}:${item.target.id}`}
                      type={item.type}
                      title={title}
                      subtitle={`Shared by ${owner}`}
                      permission={item.permission}
                      inherited={item.inherited}
                      activity={activity}
                      activityTitle={
                        item.target.updated
                          ? new Date(item.target.updated).toLocaleString()
                          : undefined
                      }
                      onOpen={() => openItem(item)}
                      menu={
                        <IconButton
                          label={`Actions for ${title}`}
                          size="lg"
                          className="h-11 w-11 sm:h-7 sm:w-7"
                          onClick={(event) => {
                            const rect = event.currentTarget.getBoundingClientRect();
                            setMenu({ item, rect });
                          }}
                        >
                          <EllipsisHorizontalIcon />
                        </IconButton>
                      }
                    />
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      <MenuSurface
        open={menu !== null}
        onClose={() => setMenu(null)}
        position={menu ? menuPosition(menu.rect) : { top: 0, left: 0 }}
        ariaLabel={menu ? `Actions for ${sharedItemTitle(menu.item)}` : 'Shared item actions'}
        className="min-w-[13rem]"
      >
        {menu && (
          <>
            <MenuItem
              label="Open"
              onClick={() => {
                const item = menu.item;
                setMenu(null);
                openItem(item);
              }}
            />
            <MenuItem
              label="Open in new tab"
              onClick={() => {
                const href = sharedItemHref(menu.item.type, menu.item.target.id);
                window.open(href, '_blank', 'noopener,noreferrer');
                setMenu(null);
              }}
            />
            <MenuItem
              label="Copy link"
              onClick={() => void handleCopyLink(menu.item)}
            />
          </>
        )}
      </MenuSurface>
    </PageShell>
  );
}

export default SharedPage;

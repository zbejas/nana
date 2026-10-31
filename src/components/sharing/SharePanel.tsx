import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSetAtom } from 'jotai';
import {
  ArrowPathIcon,
  ExclamationTriangleIcon,
  FolderIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { getBoard } from '../../lib/boards';
import type { Board } from '../../lib/boards';
import { getDocument } from '../../lib/documents';
import type { Document } from '../../lib/documents';
import { getFolder } from '../../lib/folders';
import type { Folder } from '../../lib/folders';
import {
  deleteShareLink,
  listShareLinks,
  searchShareUsers,
  upsertShareLink,
  type ShareLink,
  type SharePermission,
  type ShareTargetType,
  type ShareUser,
} from '../../lib/sharing';
import { useAuth } from '../../lib/auth';
import { useToasts } from '../../state/hooks';
import { useResourceAccess } from '../../state/hooks/useResourceAccess';
import { sharingRealtimeTickAtom } from '../../state/sharing';
import {
  Avatar,
  Button,
  EmptyState,
  IconButton,
  Input,
  SidePanel,
  Spinner,
} from '../ui';
import { PermissionBadge } from './PermissionBadge';
import { PermissionSelect } from './PermissionSelect';
import { PublicShareSection, type PublicShareSectionTarget } from './PublicShareSection';
import {
  inviteSearchCopy,
  shareCandidates,
  targetKindLabel,
  type ShareCandidate,
} from './share-copy';
import { displayShareUserName, shareUserAvatarUrl } from './share-users';

export interface SharePanelProps {
  open: boolean;
  onClose: () => void;
  targetType: ShareTargetType;
  targetId: string;
  targetTitle: string;
  /**
   * Parent folder for a folder target, or the containing folder for a note or
   * board. Passing it lets the panel explain inherited folder access before the
   * record has loaded. It is optional; the loaded record supplies it when
   * omitted.
   */
  folderId?: string;
  folderName?: string;
  onChanged?: () => void;
}

type LoadedTarget = PublicShareSectionTarget;

function loadedFolderId(targetType: ShareTargetType, target: LoadedTarget | null, folderId?: string): string {
  if (targetType === 'folder') {
    return (target?.type === 'folder' ? target.record.parent : undefined) || folderId || '';
  }
  if (target?.type === 'document' || target?.type === 'board') {
    return target.record.folder || folderId || '';
  }
  return folderId || '';
}

function loadTarget(targetType: ShareTargetType, targetId: string): Promise<LoadedTarget> {
  if (targetType === 'document') {
    return getDocument(targetId).then((record: Document) => ({ type: 'document', record }));
  }
  if (targetType === 'folder') {
    return getFolder(targetId).then((record: Folder) => ({ type: 'folder', record }));
  }
  return getBoard(targetId).then((record: Board) => ({ type: 'board', record }));
}

/**
 * Owner-only sharing surface for a note, folder, or board. People changes
 * apply immediately; the public-link section keeps its explicit save because
 * expiry is a multi-field draft.
 */
export function SharePanel({
  open,
  onClose,
  targetType,
  targetId,
  targetTitle,
  folderId,
  folderName,
  onChanged,
}: SharePanelProps) {
  const { user } = useAuth();
  const { showToast } = useToasts();
  const bumpTick = useSetAtom(sharingRealtimeTickAtom);
  const { access, loading: accessLoading, error: accessError, reload: reloadAccess } =
    useResourceAccess(targetType, open ? targetId : undefined);

  const [target, setTarget] = useState<LoadedTarget | null>(null);
  const [loadedKey, setLoadedKey] = useState('');
  const [recordLoading, setRecordLoading] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);

  const [links, setLinks] = useState<ShareLink[]>([]);
  const [linksLoading, setLinksLoading] = useState(false);
  const [linksError, setLinksError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ShareUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchNonce, setSearchNonce] = useState(0);
  const [invitePermissions, setInvitePermissions] = useState<Record<string, SharePermission>>({});
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const [ancestorFolderName, setAncestorFolderName] = useState(folderName || '');
  const [ancestorHasShares, setAncestorHasShares] = useState(false);

  const linkSequence = useRef(0);
  const recordSequence = useRef(0);
  const targetKey = `${targetType}:${targetId}`;

  const loadRecord = useCallback(async () => {
    if (!open) return;
    const current = ++recordSequence.current;
    setRecordLoading(true);
    setRecordError(null);
    try {
      const loaded = await loadTarget(targetType, targetId);
      if (current !== recordSequence.current) return;
      setTarget(loaded);
      setLoadedKey(`${targetType}:${targetId}`);
    } catch (error) {
      if (current !== recordSequence.current) return;
      setTarget(null);
      setLoadedKey('');
      setRecordError(error instanceof Error ? error.message : 'Could not load this record.');
    } finally {
      if (current === recordSequence.current) setRecordLoading(false);
    }
  }, [open, targetId, targetType]);

  const loadLinks = useCallback(async () => {
    if (!open) return;
    const current = ++linkSequence.current;
    setLinksLoading(true);
    setLinksError(null);
    try {
      const response = await listShareLinks(targetType, targetId);
      if (current !== linkSequence.current) return;
      setLinks(response.items);
    } catch (error) {
      if (current !== linkSequence.current) return;
      setLinks([]);
      setLinksError(error instanceof Error ? error.message : 'Could not load people.');
    } finally {
      if (current === linkSequence.current) setLinksLoading(false);
    }
  }, [open, targetId, targetType]);

  useEffect(() => {
    void loadRecord();
  }, [loadRecord]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSearchResults([]);
    setSearchError(null);
    setInvitePermissions({});
    void loadLinks();
  }, [loadLinks, open, targetId, targetType]);

  const activeTarget = loadedKey === targetKey ? target : null;

  const effectiveFolderId = useMemo(
    () => loadedFolderId(targetType, activeTarget, folderId),
    [activeTarget, folderId, targetType]
  );

  useEffect(() => {
    if (!open || !effectiveFolderId) {
      setAncestorHasShares(false);
      if (folderName) setAncestorFolderName(folderName);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const [response, folder] = await Promise.all([
          listShareLinks('folder', effectiveFolderId),
          folderName ? Promise.resolve(null) : getFolder(effectiveFolderId).catch(() => null),
        ]);
        if (cancelled) return;
        setAncestorHasShares(response.items.length > 0);
        setAncestorFolderName(folderName || folder?.name || 'a shared folder');
      } catch {
        // Access may be inherited from a parent the caller cannot inspect. Do not
        // guess at an inherited grant when the folder link list is unavailable.
        if (!cancelled) setAncestorHasShares(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [effectiveFolderId, folderName, open]);

  useEffect(() => {
    if (!open) return;
    const value = query.trim();
    if (!value) {
      setSearchResults([]);
      setSearching(false);
      setSearchError(null);
      return;
    }

    let cancelled = false;
    setSearching(true);
    setSearchError(null);
    const timer = window.setTimeout(() => {
      void searchShareUsers(value)
        .then((response) => {
          if (cancelled) return;
          setSearchResults(response.items);
          setSearching(false);
        })
        .catch(() => {
          if (cancelled) return;
          setSearchResults([]);
          setSearchError('Could not search people. Try again.');
          setSearching(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query, searchNonce]);

  const notifyChange = useCallback(() => {
    bumpTick((value) => value + 1);
    onChanged?.();
  }, [bumpTick, onChanged]);

  const handlePermissionChange = async (link: ShareLink, permission: SharePermission) => {
    if (!link.user?.id) return;
    setBusyUserId(link.user.id);
    try {
      await upsertShareLink({
        targetType,
        targetId,
        userId: link.user.id,
        permission,
      });
      await loadLinks();
      notifyChange();
      showToast(`Permission updated for ${displayShareUserName(link.user)}`, 'success');
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Could not update that permission.',
        'error'
      );
    } finally {
      setBusyUserId(null);
    }
  };

  const handleRemove = async (link: ShareLink) => {
    const name = displayShareUserName(link.user);
    setRemovingId(link.id);
    try {
      await deleteShareLink(link.id);
      await loadLinks();
      notifyChange();
      showToast(`Access removed for ${name}`, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not remove access.', 'error');
    } finally {
      setRemovingId(null);
    }
  };

  const handleInvite = async (candidate: ShareCandidate) => {
    const permission = invitePermissions[candidate.id] ?? 'view';
    setInvitingId(candidate.id);
    try {
      await upsertShareLink({
        targetType,
        targetId,
        userId: candidate.id,
        permission,
      });
      await loadLinks();
      notifyChange();
      showToast(`Shared with ${displayShareUserName(candidate)}`, 'success');
      setQuery('');
      setSearchResults([]);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not share with that person.', 'error');
    } finally {
      setInvitingId(null);
    }
  };

  const isPrivate = Boolean(activeTarget?.record.is_private);
  const existingUserIds = useMemo(
    () => links.map((link) => link.user?.id).filter((id): id is string => Boolean(id)),
    [links]
  );
  const candidates = useMemo(
    () => shareCandidates(searchResults, existingUserIds, user?.id),
    [existingUserIds, searchResults, user?.id]
  );

  const selfEmail = typeof user?.email === 'string' ? user.email : '';
  const exactEmail = query.includes('@');
  const isSelfQuery = Boolean(
    selfEmail && exactEmail && query.trim().toLowerCase() === selfEmail.toLowerCase()
  );
  const inviteCopy = searching || isPrivate
    ? null
    : inviteSearchCopy({
        query,
        resultCount: candidates.length,
        exactEmail,
        isSelf: isSelfQuery,
        error: searchError,
      });

  const ownerAvatar = shareUserAvatarUrl(
    user ? { id: user.id, avatar: typeof user.avatar === 'string' ? user.avatar : undefined } : null
  );
  const ownerName = String(user?.name || user?.email || 'You');
  const ownerEmail = typeof user?.email === 'string' ? user.email : '';

  const loadError = accessError || recordError;
  const loading = accessLoading || recordLoading || (open && !activeTarget && !loadError);
  const isOwner = access.role === 'owner';
  const kind = targetKindLabel(targetType);
  const privateCopy =
    'This record is private. Turn off Private in settings to share it with people.';

  const loadedTitle = target?.type === 'document'
    ? target.record.title
    : target?.type === 'board'
      ? target.record.name
      : target?.type === 'folder'
        ? target.record.name
        : '';
  const displayTitle = loadedTitle || targetTitle;

  const inheritedCopy = (() => {
    if (targetType === 'folder') {
      if (ancestorHasShares) {
        return `This folder is inside “${ancestorFolderName}”. People with access to that folder can open this folder too.`;
      }
      if (links.length > 0) {
        return 'Folder access flows down. Everyone listed here can open every note, board, and subfolder inside this folder.';
      }
      return '';
    }

    if (ancestorHasShares) {
      return `Access is inherited from “${ancestorFolderName}”. Everyone with access to that folder can open this ${kind}. Folder access is managed from the folder’s share panel.`;
    }

    if (access.source === 'inherited') {
      return `This ${kind} sits inside a shared folder. Folder access is managed from that folder.`;
    }

    return '';
  })();

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title={`Share “${displayTitle}”`}
      description="People and privacy changes apply immediately. Public-link settings save explicitly."
      width="lg"
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      {loading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading sharing settings">
          <div className="h-14 animate-pulse rounded-control bg-surface-raised" />
          <div className="h-14 animate-pulse rounded-control bg-surface-raised" />
          <div className="h-24 animate-pulse rounded-control bg-surface-raised" />
          <div className="h-32 animate-pulse rounded-control bg-surface-raised" />
        </div>
      ) : loadError ? (
        <EmptyState
          compact
          title="Sharing settings could not load"
          description={loadError}
          action={
            <Button
              variant="secondary"
              size="sm"
              icon={<ArrowPathIcon />}
              onClick={() => {
                void reloadAccess();
                void loadRecord();
              }}
            >
              Try again
            </Button>
          }
        />
      ) : !isOwner ? (
        <EmptyState
          compact
          title="Only the owner can manage sharing"
          description={`You can open this ${kind}, but its owner controls who else has access.`}
        />
      ) : (
        <div className="space-y-6">
          {isPrivate && (
            <div
              role="status"
              className="flex gap-3 rounded-control border border-warning/25 bg-warning-soft p-3.5"
            >
              <ExclamationTriangleIcon
                className="mt-0.5 h-4 w-4 shrink-0 text-warning"
                aria-hidden="true"
              />
              <p className="text-[12.5px] leading-relaxed text-warning">{privateCopy}</p>
            </div>
          )}

          <section aria-labelledby="share-people-heading">
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <h3
                  id="share-people-heading"
                  className="text-[13.5px] font-semibold tracking-[-0.01em] text-ink"
                >
                  People with access
                </h3>
                <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
                  Direct access to this {kind}.
                </p>
              </div>
              {links.length > 0 && (
                <span className="shrink-0 text-[11.5px] tabular-nums text-ink-muted">
                  {links.length} {links.length === 1 ? 'person' : 'people'}
                </span>
              )}
            </div>

            <ul className="mt-3 divide-y divide-line rounded-control border border-line bg-surface">
              <li className="flex min-h-[52px] items-center gap-3 px-3 py-2.5">
                <Avatar src={ownerAvatar} name={ownerName} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-ink">You</p>
                  {ownerEmail && (
                    <p className="truncate text-[11.5px] text-ink-muted">{ownerEmail}</p>
                  )}
                </div>
                <PermissionBadge permission="owner" />
              </li>

              {linksLoading ? (
                <li className="flex min-h-[52px] items-center gap-3 px-3 py-2.5" aria-busy="true">
                  <span className="h-8 w-8 animate-pulse rounded-full bg-surface-raised" />
                  <span className="h-3 w-32 animate-pulse rounded bg-surface-raised" />
                </li>
              ) : linksError ? (
                <li className="flex min-h-[52px] flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                  <span className="text-[12px] text-danger">{linksError}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-11 sm:h-8"
                    icon={<ArrowPathIcon />}
                    onClick={() => void loadLinks()}
                  >
                    Retry
                  </Button>
                </li>
              ) : links.length === 0 ? (
                <li className="px-3 py-4 text-[12px] leading-relaxed text-ink-muted">
                  Only you can open this {kind} right now.
                </li>
              ) : (
                links.map((link) => {
                  const name = displayShareUserName(link.user);
                  const avatar = shareUserAvatarUrl(link.user);
                  const busy = busyUserId === link.user?.id || removingId === link.id;
                  return (
                    <li
                      key={link.id}
                      className="flex min-h-[52px] items-center gap-2 px-3 py-2"
                    >
                      <Avatar src={avatar} name={name} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-ink">
                          {link.user?.id === user?.id ? 'You' : name}
                        </p>
                        {link.user?.email && (
                          <p className="truncate text-[11.5px] text-ink-muted">
                            {link.user.email}
                          </p>
                        )}
                      </div>
                      <PermissionSelect
                        value={link.permission}
                        label={`Permission for ${name}`}
                        disabled={busy || isPrivate}
                        onChange={(permission) => void handlePermissionChange(link, permission)}
                      />
                      <IconButton
                        label={`Remove access for ${name}`}
                        size="lg"
                        className="h-11 w-11 text-ink-muted hover:bg-danger-soft hover:text-danger sm:h-8 sm:w-8"
                        onClick={() => void handleRemove(link)}
                        disabled={busy}
                      >
                        <XMarkIcon />
                      </IconButton>
                    </li>
                  );
                })
              )}
            </ul>
          </section>

          <div className="border-t border-line" />

          <section aria-labelledby="share-invite-heading">
            <h3
              id="share-invite-heading"
              className="text-[13.5px] font-semibold tracking-[-0.01em] text-ink"
            >
              Share with a person
            </h3>
            <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
              They can open this {kind} as soon as you invite them.
            </p>

            <div className="mt-3">
              <Input
                type="search"
                value={query}
                placeholder="name@email…"
                aria-label="Search people to share with"
                autoComplete="off"
                icon={<MagnifyingGlassIcon />}
                disabled={isPrivate}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>

            {isPrivate && (
              <p className="mt-2 text-[12px] leading-relaxed text-ink-muted">
                Private records cannot be shared with people. Turn off Private below, then invite.
              </p>
            )}

            {searching && (
              <div className="mt-3 flex items-center gap-2 text-[12px] text-ink-muted">
                <Spinner className="h-4 w-4" />
                Searching people…
              </div>
            )}

            {!searching && inviteCopy && (
              <p
                role={inviteCopy.tone === 'danger' ? 'alert' : undefined}
                className={
                  inviteCopy.tone === 'danger'
                    ? 'mt-2 text-[12px] leading-relaxed text-danger'
                    : 'mt-2 text-[12px] leading-relaxed text-ink-muted'
                }
              >
                {inviteCopy.message}
              </p>
            )}

            {!searching && searchError && !isPrivate && (
              <button
                type="button"
                onClick={() => setSearchNonce((value) => value + 1)}
                className="mt-1 text-[12px] font-medium text-signal hover:text-signal-strong"
              >
                Try again
              </button>
            )}

            {!searching && candidates.length > 0 && (
              <ul className="mt-2 divide-y divide-line rounded-control border border-line bg-surface">
                {candidates.map((candidate) => {
                  const name = displayShareUserName(candidate);
                  const permission = invitePermissions[candidate.id] ?? 'view';
                  const inviting = invitingId === candidate.id;
                  return (
                    <li
                      key={candidate.id}
                      className="flex min-h-[52px] flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center"
                    >
                      <div className="flex min-w-0 items-center gap-2 sm:flex-1">
                        <Avatar
                          src={shareUserAvatarUrl(candidate)}
                          name={name}
                          size="sm"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium text-ink">{name}</p>
                          {candidate.email && (
                            <p className="truncate text-[11.5px] text-ink-muted">
                              {candidate.email}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 pl-10 sm:shrink-0 sm:pl-0">
                        <PermissionSelect
                          value={permission}
                          label={`Invite permission for ${name}`}
                          className="flex-1 sm:flex-none"
                          selectClassName="w-full sm:w-auto"
                          disabled={isPrivate || candidate.alreadyHasAccess || inviting}
                          onChange={(next) =>
                            setInvitePermissions((current) => ({
                              ...current,
                              [candidate.id]: next,
                            }))
                          }
                        />
                        <Button
                          variant={candidate.alreadyHasAccess ? 'secondary' : 'primary'}
                          size="sm"
                          className="h-11 sm:h-8"
                          disabled={isPrivate || candidate.alreadyHasAccess || inviting}
                          loading={inviting}
                          onClick={() => void handleInvite(candidate)}
                        >
                          {candidate.alreadyHasAccess ? 'Has access' : 'Invite'}
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {inheritedCopy && !isPrivate && (
            <div className="flex gap-3 rounded-control border border-line bg-surface-sunken/60 p-3.5">
              <FolderIcon className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
              <div>
                <p className="text-[12.5px] font-medium text-ink">Inherited folder access</p>
                <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
                  {inheritedCopy}
                </p>
              </div>
            </div>
          )}

          <div className="border-t border-line" />

          {activeTarget ? (
            <PublicShareSection
              target={activeTarget}
              onSaved={(updated) => setTarget(updated)}
              onChanged={notifyChange}
            />
          ) : (
            <div className="h-32 animate-pulse rounded-control bg-surface-raised" />
          )}
        </div>
      )}
    </SidePanel>
  );
}

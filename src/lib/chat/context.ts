import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAtomValue } from 'jotai';
import { pb } from '../pocketbase';
import type { ChatContextType } from '../../api/chat/types';
import {
  folderDocumentsAtom,
  foldersAtom,
  recentDocumentsAtom,
  rootDocumentsAtom,
  selectedDocumentAtom,
} from '../../state/atoms';
import type { Folder, FolderTreeNode } from '../folders';
import type { Document } from '../documents';

export interface RouteChatContext {
  type: ChatContextType;
  id: string;
}

export interface ChatContextTarget extends RouteChatContext {
  isPrivate: boolean;
  /** True while the light privacy lookup is in flight. */
  loading?: boolean;
  /** True when the record could not be resolved. */
  unavailable?: boolean;
}

interface LightDocument {
  id: string;
  is_private?: boolean;
  folder?: string;
}

interface LightBoard {
  id: string;
  is_private?: boolean;
  folder?: string;
}

interface LightFolder {
  id: string;
  is_private?: boolean;
  parent?: string;
}

/**
 * Derive the page context from a route. Only the three content surfaces carry
 * context; chat, settings, timeline, trash, board trash, and shared folders do not.
 */
export function deriveChatContext(pathname: string): RouteChatContext | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length !== 2) return null;

  const [surface, rawId] = parts;
  if (!rawId) return null;

  let id: string;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    return null;
  }

  if (surface === 'document' && id !== 'new') {
    return { type: 'document', id };
  }
  if (surface === 'board' && id !== 'trash' && id !== 'archive') {
    return { type: 'board', id };
  }
  if (surface === 'folders' && id !== 'trash' && id !== 'shared') {
    return { type: 'folder', id };
  }
  return null;
}

export function chatContextKey(context: RouteChatContext | null): string {
  return context ? `${context.type}:${context.id}` : '';
}

export function flattenFolderTree(tree: readonly FolderTreeNode[]): Folder[] {
  const folders: Folder[] = [];
  const walk = (nodes: readonly FolderTreeNode[]) => {
    for (const node of nodes) {
      const { subfolders, ...folder } = node;
      folders.push(folder);
      if (subfolders?.length) walk(subfolders);
    }
  };
  walk(tree);
  return folders;
}

/**
 * A folder is hidden from AI when it or any ancestor is private. The tree may
 * not contain the folder yet (lazy-loaded folders), in which case the caller
 * should treat the record's own flag as the only evidence.
 */
export function folderInPrivateBranch(
  folderId: string | null | undefined,
  folders: readonly Pick<Folder, 'id' | 'parent' | 'is_private'>[],
): boolean {
  if (!folderId) return false;
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const seen = new Set<string>();
  let current = byId.get(folderId);

  while (current && !seen.has(current.id)) {
    if (current.is_private) return true;
    seen.add(current.id);
    current = current.parent ? byId.get(current.parent) : undefined;
  }

  return false;
}

// ── Light privacy lookup ─────────────────────────────────────────────
// Chat only needs the page id and whether the page is private. The browser
// facade supports field projection, so these reads never load note content.

const targetCache = new Map<string, ChatContextTarget>();
const inflight = new Map<string, Promise<ChatContextTarget | null>>();

async function loadLightTarget(route: RouteChatContext): Promise<ChatContextTarget | null> {
  try {
    if (route.type === 'document') {
      const record = await pb.collection<LightDocument>('documents').getOne(route.id, {
        fields: 'id,is_private,folder',
      });
      return {
        ...route,
        isPrivate: record.is_private === true,
        folderId: record.folder,
      } as ChatContextTarget & { folderId?: string };
    }

    if (route.type === 'board') {
      const record = await pb.collection<LightBoard>('boards').getOne(route.id, {
        fields: 'id,is_private,folder',
      });
      return {
        ...route,
        isPrivate: record.is_private === true,
        folderId: record.folder,
      } as ChatContextTarget & { folderId?: string };
    }

    const record = await pb.collection<LightFolder>('folders').getOne(route.id, {
      fields: 'id,is_private,parent',
    });
    return {
      ...route,
      isPrivate: record.is_private === true,
      parentId: record.parent,
    } as ChatContextTarget & { parentId?: string };
  } catch {
    return null;
  }
}

function getLightTarget(route: RouteChatContext): Promise<ChatContextTarget | null> {
  const key = chatContextKey(route);
  const cached = targetCache.get(key);
  if (cached) return Promise.resolve(cached);

  const pending = inflight.get(key);
  if (pending) return pending;

  const request = loadLightTarget(route)
    .then((target) => {
      if (target) targetCache.set(key, target);
      return target;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, request);
  return request;
}

function findDocument(
  id: string,
  selected: Document | null,
  recent: readonly Document[],
  root: readonly Document[],
  byFolder: ReadonlyMap<string, Document[]>,
): Document | undefined {
  if (selected?.id === id) return selected;
  const direct = [...recent, ...root].find((document) => document.id === id);
  if (direct) return direct;
  for (const documents of byFolder.values()) {
    const match = documents.find((document) => document.id === id);
    if (match) return match;
  }
  return undefined;
}

/**
 * Resolve the privacy of the page currently open. Already-loaded app data is
 * used when possible; otherwise one projected record fetch checks the record
 * and its folder. Content is never read.
 */
export function useChatContextTarget(): ChatContextTarget | null {
  const location = useLocation();
  const route = useMemo(() => deriveChatContext(location.pathname), [location.pathname]);
  const selectedDocument = useAtomValue(selectedDocumentAtom);
  const recentDocuments = useAtomValue(recentDocumentsAtom);
  const rootDocuments = useAtomValue(rootDocumentsAtom);
  const folderDocuments = useAtomValue(folderDocumentsAtom);
  const folders = useAtomValue(foldersAtom);

  const flatFolders = useMemo(() => flattenFolderTree(folders), [folders]);

  const stateTarget = useMemo<ChatContextTarget | null>(() => {
    if (!route) return null;

    if (route.type === 'document') {
      const document = findDocument(
        route.id,
        selectedDocument,
        recentDocuments,
        rootDocuments,
        folderDocuments,
      );
      if (!document) return null;
      return {
        ...route,
        isPrivate:
          document.is_private === true
          || folderInPrivateBranch(document.folder, flatFolders),
      };
    }

    if (route.type === 'folder') {
      const folder = flatFolders.find((candidate) => candidate.id === route.id);
      if (!folder) return null;
      return {
        ...route,
        isPrivate: folderInPrivateBranch(folder.id, flatFolders),
      };
    }

    return null;
  }, [route, selectedDocument, recentDocuments, rootDocuments, folderDocuments, flatFolders]);

  const [fetchedTarget, setFetchedTarget] = useState<ChatContextTarget | null>(null);
  const [lookupFailed, setLookupFailed] = useState(false);

  useEffect(() => {
    setFetchedTarget(null);
    setLookupFailed(false);
    if (!route || stateTarget) return;

    let cancelled = false;
    void getLightTarget(route).then((target) => {
      if (cancelled) return;
      if (target) setFetchedTarget(target);
      else setLookupFailed(true);
    });

    return () => {
      cancelled = true;
    };
  }, [route, stateTarget]);

  const target = stateTarget ?? fetchedTarget;
  if (!target) {
    if (!route) return null;
    return {
      ...route,
      isPrivate: false,
      loading: !lookupFailed,
      unavailable: lookupFailed,
    };
  }

  // A fetched document/board may live in a private folder that has not loaded
  // yet. The state tree is the source of truth when the folder is present.
  const raw = target as ChatContextTarget & { folderId?: string; parentId?: string };
  let isPrivate = target.isPrivate;
  if (!isPrivate && route?.type === 'document' && raw.folderId) {
    isPrivate = folderInPrivateBranch(raw.folderId, flatFolders);
  }
  if (!isPrivate && route?.type === 'board' && raw.folderId) {
    isPrivate = folderInPrivateBranch(raw.folderId, flatFolders);
  }
  if (!isPrivate && route?.type === 'folder' && raw.parentId) {
    isPrivate = folderInPrivateBranch(raw.parentId, flatFolders);
  }

  return { ...target, isPrivate };
}

/**
 * The automatic context payload for the next send. Only the page id crosses
 * the wire; the server resolves and permission-checks it. Private pages and
 * pages whose privacy is still loading are omitted so a send never fails just
 * because the page context is unavailable.
 */
export function toContextInput(
  target: ChatContextTarget | null,
): { type: ChatContextType; id: string } | undefined {
  if (!target || target.loading || target.unavailable || target.isPrivate) return undefined;
  return { type: target.type, id: target.id };
}

/** Reset module caches when the session changes. */
export function clearChatContextCaches(): void {
  targetCache.clear();
  inflight.clear();
}

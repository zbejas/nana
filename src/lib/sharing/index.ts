import { pb } from '../pocketbase';

export type ShareTargetType = 'document' | 'folder' | 'board';
export type CommentTargetType = ShareTargetType | 'task';
export type SharePermission = 'view' | 'comment' | 'edit';
export type AccessRole = SharePermission | 'owner' | null;

export interface ShareUser {
  id: string;
  collectionName: 'users';
  name: string;
  avatar: string;
  email?: string;
}

export interface ShareLink {
  id: string;
  targetType: ShareTargetType;
  targetId: string;
  user: ShareUser | null;
  sharedBy: ShareUser | null;
  permission: SharePermission;
  level: number;
  created: string;
  updated: string;
}

export interface SharedTarget {
  id: string;
  title?: string;
  name?: string;
  slug?: string;
  description?: string;
  tags?: string[];
  folder?: string;
  parent?: string;
  color?: string;
  archived?: boolean;
  is_private?: boolean;
  is_public?: boolean;
  word_count?: number;
  reading_time?: number;
  created: string;
  updated: string;
}

export interface SharedItem {
  id: string;
  shareId: string;
  grantId: string;
  type: ShareTargetType;
  permission: SharePermission;
  level: number;
  inherited: boolean;
  sharedBy: ShareUser | null;
  target: SharedTarget;
}

export interface SharedPage {
  items: SharedItem[];
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset: number | null;
}

export interface ResourceAccess {
  role: AccessRole;
  level: number;
  source: 'owner' | 'direct' | 'inherited' | '';
}

export interface SharedFolder {
  folder: SharedTarget;
  permission: SharePermission | 'owner';
  access: ResourceAccess;
  owner: ShareUser | null;
  parent: SharedTarget | null;
  folders: SharedTarget[];
  documents: SharedTarget[];
  boards: SharedTarget[];
}

export interface ShareComment {
  id: string;
  targetType: CommentTargetType;
  targetId: string;
  body: string;
  author: ShareUser | null;
  created: string;
  updated: string;
  canEdit: boolean;
  canDelete: boolean;
}

export interface CommentPage {
  items: ShareComment[];
  permission: AccessRole;
  canComment: boolean;
}

function token(): string {
  return pb.authStore.token;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  if (token()) headers.set('Authorization', token());

  const response = await fetch(`/api/v1/sharing${path}`, { ...init, headers });
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : 'Sharing request failed.';
    throw new Error(message);
  }

  return data as T;
}

function queryString(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === '') continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

export function searchShareUsers(query: string): Promise<{ items: ShareUser[] }> {
  return request(`/users${queryString({ q: query })}`);
}

export function listSharedWithMe(options: { limit?: number; offset?: number } = {}): Promise<SharedPage> {
  return request(`/shared${queryString(options)}`);
}

export function getResourceAccess(
  targetType: ShareTargetType,
  targetId: string
): Promise<ResourceAccess> {
  return request(`/access${queryString({ targetType, targetId })}`);
}

export function listShareLinks(
  targetType: ShareTargetType,
  targetId: string
): Promise<{ items: ShareLink[] }> {
  return request(`/links${queryString({ targetType, targetId })}`);
}

export function upsertShareLink(data: {
  targetType: ShareTargetType;
  targetId: string;
  userId: string;
  permission: SharePermission;
}): Promise<ShareLink> {
  return request('/links', { method: 'POST', body: JSON.stringify(data) });
}

export function deleteShareLink(id: string): Promise<{ success: true }> {
  return request(`/links/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function getSharedFolder(id: string): Promise<SharedFolder> {
  return request(`/folders/${encodeURIComponent(id)}`);
}

export function listComments(
  targetType: CommentTargetType,
  targetId: string
): Promise<CommentPage> {
  return request(`/comments${queryString({ targetType, targetId })}`);
}

export function createComment(
  targetType: CommentTargetType,
  targetId: string,
  body: string
): Promise<ShareComment> {
  return request('/comments', {
    method: 'POST',
    body: JSON.stringify({ targetType, targetId, body }),
  });
}

export function updateComment(id: string, body: string): Promise<ShareComment> {
  return request(`/comments/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ body }),
  });
}

export function deleteComment(id: string): Promise<{ success: true }> {
  return request(`/comments/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

import { pb } from '../../lib/pocketbase';

/**
 * Share payloads carry the users avatar filename, not a URL. The rest of the
 * app renders avatars through the `/api/v1` file facade, so sharing does the
 * same instead of asking PocketBase for a private file path.
 */
export function shareUserAvatarUrl(
  user: { id: string; avatar?: string } | null | undefined,
  thumb = '80x80'
): string | null {
  if (!user?.avatar || !user.id) return null;
  const url = pb.files.getURL(
    { id: user.id, collectionName: 'users' },
    user.avatar,
    { thumb }
  );
  return url || null;
}

export function displayShareUserName(
  user: { name?: string; email?: string } | null | undefined
): string {
  return user?.name?.trim() || user?.email?.trim() || 'Unnamed user';
}

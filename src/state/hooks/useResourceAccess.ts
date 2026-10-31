import { useCallback, useEffect, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { useAuth } from '../../lib/auth';
import { getResourceAccess, type ResourceAccess, type ShareTargetType } from '../../lib/sharing';
import { sharingRealtimeTickAtom } from '../sharing';

const EMPTY: ResourceAccess = { role: null, level: 0, source: '' };

/**
 * Resolves the caller's effective access to one record. Cached for the current
 * target and invalidated when a share or grant changes. Board/task/editor
 * surfaces use this to hide owner-only controls; the server remains the
 * authority.
 */
export function useResourceAccess(type: ShareTargetType, id: string | undefined) {
  const { user } = useAuth();
  const tick = useAtomValue(sharingRealtimeTickAtom);
  const [access, setAccess] = useState<ResourceAccess>(EMPTY);
  const [loading, setLoading] = useState(Boolean(id && user?.id));
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);

  const load = useCallback(async () => {
    if (!id || !user?.id) {
      setAccess(EMPTY);
      setLoading(false);
      return;
    }

    const current = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const resolved = await getResourceAccess(type, id);
      if (current !== sequence.current) return;
      setAccess(resolved);
    } catch (loadError) {
      if (current !== sequence.current) return;
      setError(loadError instanceof Error ? loadError.message : 'Could not resolve access.');
      setAccess(EMPTY);
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [id, type, user?.id]);

  useEffect(() => {
    void load();
  }, [load, tick]);

  return { access, loading, error, reload: load };
}

/**
 * Loads data for a screen, and loads it again whenever the screen comes back
 * into focus -- so accepting an invite on one tab shows up on another without
 * any shared cache to keep in sync.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { describeError } from '@/lib/api';

export interface Loaded<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
}

/**
 * `deps` says when to load again -- a different group id, a different week.
 * The latest `load` is always the one called, so it may close over anything.
 */
export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[] = []): Loaded<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);
  const loadRef = useRef(load);
  const key = JSON.stringify(deps);

  useEffect(() => {
    loadRef.current = load;
  });

  const reload = useCallback(async () => {
    const id = ++latest.current;
    setLoading(true);
    try {
      const result = await loadRef.current();
      if (id === latest.current) {
        setData(result);
        setError(null);
      }
    } catch (caught) {
      if (id === latest.current) setError(describeError(caught));
    } finally {
      if (id === latest.current) setLoading(false);
    }
    // `key` is what makes a new `reload` -- and so a fresh load -- when deps change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return { data, error, loading, reload };
}

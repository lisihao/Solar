/**
 * useRadarRunDetailView —— Radar canonical run detail view consumer hook（B7-3）
 *
 * 落地依据：thinning plan §B7-3 / §6.7 fetch-coalescing / §6.7.2 stream-vs-view split.
 *
 * Mirror of playground useMissionDetailView。radar runs/[runId]/page.tsx 后续 cutover
 * 时引入此 hook 替换 derive truth from raw events / RadarRun row。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  getRadarRunDetailView,
  type RadarRunDetailView,
  type RadarViewRefreshHint,
} from '@/services/ai-radar/api';

const COALESCE_WINDOW_MS = 250;

interface UseRadarRunDetailViewResult {
  data: RadarRunDetailView | null;
  loading: boolean;
  error: Error | null;
  refresh: () => void;
  applyRefreshHints: (hints: RadarViewRefreshHint[]) => void;
}

interface InternalState {
  inFlight: boolean;
  hasQueued: boolean;
}

export function useRadarRunDetailView(
  runId: string | undefined
): UseRadarRunDetailViewResult {
  const [data, setData] = useState<RadarRunDetailView | null>(null);
  const [loading, setLoading] = useState<boolean>(!!runId);
  const [error, setError] = useState<Error | null>(null);

  const stateRef = useRef<InternalState>({ inFlight: false, hasQueued: false });
  const abortRef = useRef<AbortController | null>(null);
  const coalesceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const performFetch = useCallback(async (id: string) => {
    stateRef.current.inFlight = true;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    try {
      const view = await getRadarRunDetailView(id, {
        signal: abortRef.current.signal,
      });
      setData(view);
      setError(null);
    } catch (err) {
      if ((err as { name?: string })?.name !== 'AbortError') {
        setError(err as Error);
      }
    } finally {
      setLoading(false);
      stateRef.current.inFlight = false;
      if (stateRef.current.hasQueued) {
        stateRef.current.hasQueued = false;
        void performFetch(id);
      }
    }
  }, []);

  const scheduleFetch = useCallback(
    (id: string) => {
      if (stateRef.current.inFlight) {
        stateRef.current.hasQueued = true;
        return;
      }
      if (coalesceTimerRef.current) clearTimeout(coalesceTimerRef.current);
      coalesceTimerRef.current = setTimeout(() => {
        coalesceTimerRef.current = null;
        void performFetch(id);
      }, COALESCE_WINDOW_MS);
    },
    [performFetch]
  );

  useEffect(() => {
    if (!runId) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    void performFetch(runId);
    return () => {
      abortRef.current?.abort();
      if (coalesceTimerRef.current) clearTimeout(coalesceTimerRef.current);
      coalesceTimerRef.current = null;
      stateRef.current = { inFlight: false, hasQueued: false };
    };
  }, [runId, performFetch]);

  const refresh = useCallback(() => {
    if (runId) scheduleFetch(runId);
  }, [runId, scheduleFetch]);

  const applyRefreshHints = useCallback(
    (hints: RadarViewRefreshHint[]) => {
      if (!runId || hints.length === 0) return;
      const hasRefetch = hints.some((h) => h.mode === 'refetch');
      if (hasRefetch) scheduleFetch(runId);
    },
    [runId, scheduleFetch]
  );

  return { data, loading, error, refresh, applyRefreshHints };
}

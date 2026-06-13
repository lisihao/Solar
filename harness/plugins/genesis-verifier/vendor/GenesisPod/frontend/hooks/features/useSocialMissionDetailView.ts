/**
 * useSocialMissionDetailView —— Social canonical mission detail view consumer hook（B7-3）
 *
 * 落地依据：thinning plan §B7-3 / §6.7 fetch-coalescing / §6.7.2 stream-vs-view split.
 *
 * Mirror of playground useMissionDetailView。social/[taskId]/page.tsx 后续 cutover
 * 时引入此 hook 替换 deriveSocialView 调用。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  getSocialMissionDetailView,
  type SocialMissionDetailView,
  type SocialViewRefreshHint,
} from '@/services/ai-social/api';

const COALESCE_WINDOW_MS = 250;

interface UseSocialMissionDetailViewResult {
  data: SocialMissionDetailView | null;
  loading: boolean;
  error: Error | null;
  refresh: () => void;
  applyRefreshHints: (hints: SocialViewRefreshHint[]) => void;
}

interface InternalState {
  inFlight: boolean;
  hasQueued: boolean;
}

export function useSocialMissionDetailView(
  missionId: string | undefined
): UseSocialMissionDetailViewResult {
  const [data, setData] = useState<SocialMissionDetailView | null>(null);
  const [loading, setLoading] = useState<boolean>(!!missionId);
  const [error, setError] = useState<Error | null>(null);

  const stateRef = useRef<InternalState>({ inFlight: false, hasQueued: false });
  const coalesceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const performFetch = useCallback(async (id: string) => {
    stateRef.current.inFlight = true;
    try {
      const view = await getSocialMissionDetailView(id);
      setData(view);
      setError(null);
    } catch (err) {
      setError(err as Error);
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
    if (!missionId) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    void performFetch(missionId);
    return () => {
      if (coalesceTimerRef.current) clearTimeout(coalesceTimerRef.current);
      coalesceTimerRef.current = null;
      stateRef.current = { inFlight: false, hasQueued: false };
    };
  }, [missionId, performFetch]);

  const refresh = useCallback(() => {
    if (missionId) scheduleFetch(missionId);
  }, [missionId, scheduleFetch]);

  const applyRefreshHints = useCallback(
    (hints: SocialViewRefreshHint[]) => {
      if (!missionId || hints.length === 0) return;
      const hasRefetch = hints.some((h) => h.mode === 'refetch');
      if (hasRefetch) scheduleFetch(missionId);
    },
    [missionId, scheduleFetch]
  );

  return { data, loading, error, refresh, applyRefreshHints };
}

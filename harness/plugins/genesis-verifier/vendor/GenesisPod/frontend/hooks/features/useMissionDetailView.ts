/**
 * useMissionDetailView —— Canonical mission detail view consumer hook（B4-2）
 *
 * 落地依据：thinning plan §B4-2 / §6.7 / §6.7.2 / §6.7.3
 *
 * 职责：
 * 1. 拉取 GET /missions/:id/view canonical truth
 * 2. 暴露 loading / error / data 状态
 * 3. 支持 refresh on demand
 * 4. §6.7 fetch-coalescing：one active fetch max + one queued + 250ms window coalesce
 * 5. 不 derive mission truth；hint 触发的 refetch 仅做透传
 *
 * 与 useAgentPlaygroundStream 的分工（§6.7.2）：
 * - useMissionDetailView：canonical mission truth（status / stages / agents / artifact / todo）
 * - useAgentPlaygroundStream：immediacy（token-by-token / stage transition animation / retry flicker）
 *
 * stream 推 refresh hint，本 hook 接收并调度 refetch；hint payload 不能携带足以重建 truth 的 data。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  getMissionDetailView,
  type MissionDetailView,
  type ViewRefreshHint,
} from '@/services/agent-playground/api';

const COALESCE_WINDOW_MS = 250;

interface UseMissionDetailViewResult {
  data: MissionDetailView | null;
  loading: boolean;
  error: Error | null;
  /** 显式触发一次 refetch（按 §6.7 coalescing 规则执行）。 */
  refresh: () => void;
  /** 接收来自 useAgentPlaygroundStream 的 refreshHints，调度 coalesced refetch。 */
  applyRefreshHints: (hints: ViewRefreshHint[]) => void;
}

interface InternalState {
  inFlight: boolean;
  hasQueued: boolean;
  lastTriggerAt: number;
}

/**
 * §6.7 fetch-coalescing 规则：
 *   1. one active fetch maximum at a time
 *   2. at most one queued follow-up while one is in flight
 *   3. hints within the same 250ms window are coalesced
 *   4. one user interaction round must not trigger unbounded fan-out
 */
interface UseMissionDetailViewOptions {
  /**
   * ★ 2026-05-29: WS 断开走 polling 时，stream 事件不再携带 refreshHints
   *   （hint 只由 live WS dispatcher 注入），导致 canonical view 永不 refetch、
   *   所有 canonical-only 字段（dimensionPipelines / references / reportVersions /
   *   finalScore 等）冻结。调用方在 connState !== 'live' 且 mission 未终态时置
   *   shouldPoll=true，本 hook 定时 refetch 兜底。
   */
  shouldPoll?: boolean;
  /** 轮询间隔，默认 4s（与 useMissionStream POLL_INTERVAL_MS 对齐）。 */
  pollIntervalMs?: number;
}

export function useMissionDetailView(
  missionId: string | undefined,
  options?: UseMissionDetailViewOptions
): UseMissionDetailViewResult {
  const { shouldPoll = false, pollIntervalMs = 4000 } = options ?? {};
  const [data, setData] = useState<MissionDetailView | null>(null);
  const [loading, setLoading] = useState<boolean>(!!missionId);
  const [error, setError] = useState<Error | null>(null);

  const stateRef = useRef<InternalState>({
    inFlight: false,
    hasQueued: false,
    lastTriggerAt: 0,
  });
  const abortRef = useRef<AbortController | null>(null);
  const coalesceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // mission 是否已终态——polling 兜底据此自停，无需调用方传 isRunning（避免
  // hook 调用点早于 isRunning 计算的时序问题）。
  const terminalRef = useRef<boolean>(false);

  const performFetch = useCallback(
    async (id: string) => {
      stateRef.current.inFlight = true;
      stateRef.current.lastTriggerAt = Date.now();

      abortRef.current?.abort();
      abortRef.current = new AbortController();

      try {
        const view = await getMissionDetailView(id, {
          signal: abortRef.current.signal,
        });
        setData(view);
        setError(null);
        const st = (view.mission as { status?: string } | undefined)?.status;
        terminalRef.current =
          st === 'completed' ||
          st === 'quality-failed' ||
          st === 'failed' ||
          st === 'cancelled';
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') {
          // 主动取消（unmount / 新 fetch 抢占）不算 error
        } else {
          setError(err as Error);
        }
      } finally {
        setLoading(false);
        stateRef.current.inFlight = false;
        // 队列中有等待的 refetch → 立刻消费一次
        if (stateRef.current.hasQueued) {
          stateRef.current.hasQueued = false;
          void performFetch(id);
        }
      }
    },
    [setData, setError, setLoading]
  );

  const scheduleFetch = useCallback(
    (id: string) => {
      // 1. 处于 in-flight：标 hasQueued，等当前 fetch 完了再触发一次
      if (stateRef.current.inFlight) {
        stateRef.current.hasQueued = true;
        return;
      }
      // 2. 在 250ms coalesce 窗口内：清旧 timer 重新计
      if (coalesceTimerRef.current) clearTimeout(coalesceTimerRef.current);
      coalesceTimerRef.current = setTimeout(() => {
        coalesceTimerRef.current = null;
        void performFetch(id);
      }, COALESCE_WINDOW_MS);
    },
    [performFetch]
  );

  // 初始 fetch + missionId 变化时重新拉
  useEffect(() => {
    if (!missionId) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    void performFetch(missionId);
    return () => {
      abortRef.current?.abort();
      if (coalesceTimerRef.current) clearTimeout(coalesceTimerRef.current);
      coalesceTimerRef.current = null;
      stateRef.current = {
        inFlight: false,
        hasQueued: false,
        lastTriggerAt: 0,
      };
    };
  }, [missionId, performFetch]);

  // ★ 2026-05-29 polling 兜底：WS 退化为 polling 时 refreshHints 不再到达，
  //   靠定时 refetch 保证 canonical-only 字段持续更新。coalescing 规则仍生效
  //   （scheduleFetch 内部去重），不会叠加 fan-out。
  useEffect(() => {
    if (!missionId || !shouldPoll) return;
    const timer = setInterval(() => {
      if (terminalRef.current) return; // 终态后停止轮询
      scheduleFetch(missionId);
    }, pollIntervalMs);
    return () => clearInterval(timer);
  }, [missionId, shouldPoll, pollIntervalMs, scheduleFetch]);

  const refresh = useCallback(() => {
    if (missionId) scheduleFetch(missionId);
  }, [missionId, scheduleFetch]);

  const applyRefreshHints = useCallback(
    (hints: ViewRefreshHint[]) => {
      if (!missionId || hints.length === 0) return;
      // first cut：任一 hint family 都触发整 view refetch（mode='refetch'）
      // patch 模式 §6.7 rule 4：本 hook 不实施 patch 路径，因为 patch 容易把
      // truth 推回前端；first cut 一律走 refetch 保证 single-track。
      const hasRefetch = hints.some((h) => h.mode === 'refetch');
      if (hasRefetch) scheduleFetch(missionId);
    },
    [missionId, scheduleFetch]
  );

  return { data, loading, error, refresh, applyRefreshHints };
}

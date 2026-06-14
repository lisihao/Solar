/**
 * useWritingMissionView — Canonical writing mission detail view consumer hook
 *
 * 照抄 useMissionDetailView 的全部机制（设计文档 §4.2 / writing-frontend-consistency.md §7.3）：
 *   1. GET /api/v1/ai-writing/missions/:id/view canonical truth
 *   2. 暴露 loading / error / data / refresh / applyRefreshHints
 *   3. §6.7 fetch-coalescing：one active fetch max + one queued + 250ms window
 *   4. shouldPoll 兜底（WS 断线或 replay 端点不存在时）
 *   5. terminal 状态自停 polling（读 WritingMissionViewEnvelope.status）
 *
 * 数据源：getWritingMissionView（frontend/services/ai-writing/api.ts）
 * 与 useMissionDetailView 的区别：
 *   - 数据类型：WritingMissionViewEnvelope（不是 MissionDetailView）
 *   - RefreshHint：writing 事件不带 ViewRefreshHint（无 hint 机制）；
 *     applyRefreshHints 提供给未来对齐；页面当前靠 terminal-event 三连拉 + shouldPoll。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getWritingMissionView,
  type WritingMissionViewEnvelope,
} from '@/services/ai-writing/api';

const COALESCE_WINDOW_MS = 250;

export interface UseWritingMissionViewResult {
  data: WritingMissionViewEnvelope | null;
  loading: boolean;
  error: Error | null;
  /** 显式触发一次 refetch（coalescing 规则执行）。 */
  refresh: () => void;
  /**
   * 接收来自 useWritingStream 的 refreshHints。
   * writing 当前无 hint payload，调用方可在收到 terminal 事件后直接调 refresh()，
   * 此方法预留给未来 hint 对齐。
   */
  applyRefreshHints: (hints: { mode: string }[]) => void;
}

interface InternalState {
  inFlight: boolean;
  hasQueued: boolean;
  lastTriggerAt: number;
}

export interface UseWritingMissionViewOptions {
  /**
   * WS 断开走 polling 时置 true，本 hook 定时 refetch 保证 canonical view 持续更新。
   * 调用方在 connState !== 'live' 且 mission 未终态时传 true。
   */
  shouldPoll?: boolean;
  /** 轮询间隔，默认 4000ms（与 useMissionStream POLL_INTERVAL_MS 对齐）。 */
  pollIntervalMs?: number;
}

/** writing 终态状态字符串（与后端 WritingMissionViewEnvelope.status 对齐） */
const TERMINAL_STATUSES = new Set([
  'completed',
  'failed',
  'cancelled',
  'quality-failed',
  // 大写兼容旧路 mission status
  'COMPLETED',
  'FAILED',
]);

export function useWritingMissionView(
  missionId: string | undefined,
  options?: UseWritingMissionViewOptions
): UseWritingMissionViewResult {
  const { shouldPoll = false, pollIntervalMs = 4000 } = options ?? {};

  const [data, setData] = useState<WritingMissionViewEnvelope | null>(null);
  const [loading, setLoading] = useState<boolean>(!!missionId);
  const [error, setError] = useState<Error | null>(null);

  const stateRef = useRef<InternalState>({
    inFlight: false,
    hasQueued: false,
    lastTriggerAt: 0,
  });
  const abortRef = useRef<AbortController | null>(null);
  const coalesceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // terminal 后自停 polling，无需调用方传 isRunning（避免时序问题）
  const terminalRef = useRef<boolean>(false);

  const performFetch = useCallback(
    async (id: string) => {
      stateRef.current.inFlight = true;
      stateRef.current.lastTriggerAt = Date.now();

      abortRef.current?.abort();
      abortRef.current = new AbortController();

      try {
        const envelope = await getWritingMissionView(id, {
          signal: abortRef.current.signal,
        });
        setData(envelope);
        setError(null);
        terminalRef.current = TERMINAL_STATUSES.has(envelope.status);
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') {
          // 主动取消（unmount / 新 fetch 抢占）不算 error
        } else {
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
    },
    [setData, setError, setLoading]
  );

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

  // polling 兜底：WS 断线 / replay 不存在时靠定时 refetch 保证 canonical 字段更新
  useEffect(() => {
    if (!missionId || !shouldPoll) return;
    const timer = setInterval(() => {
      if (terminalRef.current) return; // 终态后停止
      scheduleFetch(missionId);
    }, pollIntervalMs);
    return () => clearInterval(timer);
  }, [missionId, shouldPoll, pollIntervalMs, scheduleFetch]);

  const refresh = useCallback(() => {
    if (missionId) scheduleFetch(missionId);
  }, [missionId, scheduleFetch]);

  const applyRefreshHints = useCallback(
    (hints: { mode: string }[]) => {
      if (!missionId || hints.length === 0) return;
      const hasRefetch = hints.some((h) => h.mode === 'refetch');
      if (hasRefetch) scheduleFetch(missionId);
    },
    [missionId, scheduleFetch]
  );

  return { data, loading, error, refresh, applyRefreshHints };
}

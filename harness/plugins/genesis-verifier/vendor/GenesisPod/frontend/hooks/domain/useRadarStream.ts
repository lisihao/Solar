'use client';

/**
 * useRadarStream —— 雷达 mission 双通道事件流（replay + socket），对齐
 * useAgentPlaygroundStream。
 *
 * 设计（与 playground 同形）：
 *   1. 进页面立刻 GET /radar/replay 拉累积事件 hydrate（解决刷新/掉包后 UI 空白）
 *   2. Socket（namespace=ai-radar）连上后用 onAny 追 live 事件
 *   3. connect 后用 lastTs 再拉一次 /replay 覆盖 hydrate↔join 之间的空隙
 *   4. Socket 断/出错时 polling /replay?since=lastTs 兜底
 *   5. 5000 上限 + 去重防长 mission 内存泄漏
 *
 * 与 playground 差异：join 负载用 {missionId: runId}（雷达 gateway 约定），
 * socket 收到的 data 是 envelope {type, payload, timestamp}（雷达 SocketBroadcastAdapter）。
 */

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { replayRadarRun, type RadarStreamEvent } from '@/services/ai-radar/api';

const MAX_EVENTS = 5000;
const POLL_INTERVAL_MS = 4000;

type ConnState = 'connecting' | 'live' | 'polling' | 'disconnected';

function dedupeAndCap(events: RadarStreamEvent[]): RadarStreamEvent[] {
  const seen = new Set<string>();
  const out: RadarStreamEvent[] = [];
  for (const e of events) {
    let payloadKey = '';
    try {
      payloadKey = JSON.stringify(e.payload);
    } catch {
      payloadKey = String(e.payload);
    }
    const key = `${e.type}|${e.timestamp}|${payloadKey.slice(0, 120)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  out.sort((a, b) => a.timestamp - b.timestamp);
  return out.length > MAX_EVENTS ? out.slice(-MAX_EVENTS) : out;
}

export function useRadarStream(runId: string | null | undefined): {
  events: RadarStreamEvent[];
  connState: ConnState;
  connected: boolean;
  error: string | null;
} {
  const [events, setEvents] = useState<RadarStreamEvent[]>([]);
  const [connState, setConnState] = useState<ConnState>('connecting');
  const [error, setError] = useState<string | null>(null);
  const lastTsRef = useRef<number>(0);

  useEffect(() => {
    if (!runId || runId === 'undefined') return;
    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let socket: Socket | null = null;

    const append = (next: RadarStreamEvent[]) => {
      if (cancelled || !next.length) return;
      setEvents((prev) => {
        const merged = dedupeAndCap([...prev, ...next]);
        if (merged.length) {
          lastTsRef.current = merged[merged.length - 1].timestamp;
        }
        return merged;
      });
    };

    // Step 1: hydrate
    void (async () => {
      try {
        const replay = await replayRadarRun(runId);
        if (!cancelled) append(replay.events);
      } catch (e) {
        if (!cancelled) {
          setError(`加载事件历史失败: ${(e as Error).message}`);
        }
      }
    })();

    // Step 2: socket —— 必须连完整后端 URL（自定义域名上 apiBaseUrl 为空，
    // Next rewrites 不代理 /socket.io/*，相对 URL 会永久 timeout）
    const token =
      getAuthHeader().Authorization?.replace(/^Bearer\s+/i, '') ?? '';
    socket = io(`${config.getBackendUrl()}/ai-radar`, {
      transports: ['polling', 'websocket'],
      auth: token ? { token } : {},
      reconnectionAttempts: 8,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 12000,
      withCredentials: true,
    });

    const startPolling = () => {
      if (pollTimer) return;
      const tick = async () => {
        if (cancelled) return;
        try {
          const replay = await replayRadarRun(runId, lastTsRef.current);
          append(replay.events);
        } catch {
          // 忽略 polling 错误（下次 tick 重试）
        }
      };
      pollTimer = setInterval(() => {
        void tick();
      }, POLL_INTERVAL_MS);
    };

    const onConnect = () => {
      setConnState('live');
      setError(null);
      socket?.emit(
        'join',
        { missionId: runId },
        (resp: { ok: boolean; error?: string }) => {
          if (!resp?.ok) {
            setError(resp?.error ?? 'join failed');
            startPolling();
          }
        }
      );
      // 覆盖 hydrate↔join 空隙
      void (async () => {
        try {
          const replay = await replayRadarRun(runId, lastTsRef.current);
          if (!cancelled) append(replay.events);
        } catch {
          // socket live 流仍在跑，断线时 startPolling 兜底
        }
      })();
    };
    const onDisconnect = () => {
      if (cancelled) return;
      setConnState('polling');
      startPolling();
    };
    const onConnectError = (err: Error) => {
      if (cancelled) return;
      setError(err.message);
      setConnState('polling');
      startPolling();
    };
    // 雷达 socket 的 data 是 envelope {type, payload, timestamp}
    const onAnyHandler = (
      type: string,
      env: { payload?: unknown; timestamp?: number }
    ) => {
      if (!type.includes('.')) return; // 只接受有 namespace 前缀的事件
      append([
        {
          type,
          payload: env?.payload,
          timestamp: env?.timestamp ?? Date.now(),
        },
      ]);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.onAny(onAnyHandler);

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (socket) {
        socket.emit('leave', { missionId: runId });
        socket.off('connect', onConnect);
        socket.off('disconnect', onDisconnect);
        socket.off('connect_error', onConnectError);
        socket.offAny(onAnyHandler);
        socket.disconnect();
      }
    };
  }, [runId]);

  return {
    events,
    connState,
    connected: connState === 'live',
    error,
  };
}

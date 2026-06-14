'use client';

/**
 * useMissionStream — 通用「mission 事件流」双通道 hook（标准 21 P1 泛化）
 *
 * 从 useAgentPlaygroundStream 抽出，参数化 namespace / replay 端点 / join-leave 协议 /
 * 事件过滤，供 agent-playground / ai-social / ai-radar / ai-teams 等共用。
 *
 * 设计（与原 playground 行为一致）：
 *   1. 进页面立刻从 replay 端点拉累积事件（hydrate）—— 解决刷新页面 UI 全空
 *   2. Socket 连上后追加 live 事件 + onConnect 用 lastTs 兜底补空隙
 *   3. Socket 断/出错时自动 polling replay(since=lastTs) 兜底
 *   4. MAX_EVENTS 上限防长 mission 内存泄漏
 */

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';

const MAX_EVENTS = 5000;
const POLL_INTERVAL_MS = 4000;

export interface MissionEvent {
  type: string;
  payload: unknown;
  agentId?: string;
  traceId?: string;
  timestamp: number;
}

export type MissionConnState =
  | 'connecting'
  | 'live'
  | 'polling'
  | 'disconnected';

export interface UseMissionStreamOptions {
  /** Socket.IO namespace，如 '/agent-playground' | '/ai-teams' */
  namespace: string;
  /** replay 端点：拉取累积事件（hydrate + polling 兜底） */
  replay: (
    missionId: string,
    since?: number
  ) => Promise<{ events: MissionEvent[] }>;
  /** join 事件名（默认 'join'）；ai-teams 用 'topic:join' */
  joinEvent?: string;
  /** leave 事件名（默认 'leave'）；ai-teams 用 'topic:leave' */
  leaveEvent?: string;
  /** join/leave payload 的 id 字段名（默认 'missionId'）；ai-teams 用 'topicId' */
  idKey?: string;
  /** 接受哪些事件类型（默认 playground 规则：含 '.' namespace 前缀） */
  acceptEvent?: (type: string) => boolean;
}

function dedupeAndCap(events: MissionEvent[]): MissionEvent[] {
  // 用 type+timestamp+agentId+payload 序列化做 key —— 同 ms 内多条 trace 不会被误吞
  const seen = new Set<string>();
  const out: MissionEvent[] = [];
  for (const e of events) {
    let payloadKey = '';
    try {
      payloadKey = JSON.stringify(e.payload);
    } catch {
      payloadKey = String(e.payload);
    }
    const key = `${e.type}|${e.timestamp}|${e.agentId ?? ''}|${payloadKey.slice(0, 120)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  out.sort((a, b) => a.timestamp - b.timestamp);
  return out.length > MAX_EVENTS ? out.slice(-MAX_EVENTS) : out;
}

export function useMissionStream(
  missionId: string | null,
  options: UseMissionStreamOptions
) {
  const {
    namespace,
    replay,
    joinEvent = 'join',
    leaveEvent = 'leave',
    idKey = 'missionId',
    acceptEvent = (type: string) => type.includes('.'),
  } = options;

  const [events, setEvents] = useState<MissionEvent[]>([]);
  const [connState, setConnState] = useState<MissionConnState>('connecting');
  const [error, setError] = useState<string | null>(null);
  const lastTsRef = useRef<number>(0);
  const eventsRef = useRef<MissionEvent[]>([]);

  useEffect(() => {
    eventsRef.current = events;
  }, [events]);

  useEffect(() => {
    if (!missionId || missionId === 'undefined') return;
    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let socket: Socket | null = null;

    const append = (next: MissionEvent[]) => {
      if (cancelled || !next.length) return;
      // 在 setEvents updater 内同步更新 lastTsRef，避免 polling tick 在 useEffect
      // 触发前读到旧 ts 导致重复拉取已有事件（race condition）。
      setEvents((prev) => {
        const merged = dedupeAndCap([...prev, ...next]);
        if (merged.length) {
          lastTsRef.current = merged[merged.length - 1].timestamp;
        }
        return merged;
      });
    };

    // Step 1: hydrate 从 replay 端点
    void (async () => {
      try {
        const snap = await replay(missionId);
        if (!cancelled) append(snap.events);
      } catch (e) {
        if (!cancelled) {
          setError(`Failed to load mission history: ${(e as Error).message}`);
        }
      }
    })();

    // Step 2: 连 socket（必须直连后端，相对 URL 在自定义域名上代理不了 /socket.io）
    const auth = getAuthHeader();
    const token = auth.Authorization?.replace(/^Bearer\s+/i, '') ?? auth.token;
    socket = io(`${config.getBackendUrl()}${namespace}`, {
      transports: ['polling', 'websocket'],
      auth: token ? { token } : {},
      reconnectionAttempts: 8,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 12000,
      withCredentials: true,
    });

    // ★ 2026-05-27 Screenshot_49 致命修复 (failsafe polling start):
    //   socket.io 初始 'connecting' 永远不进 'live' / 'disconnect' / 'connect_error'
    //   时（罕见但用户实证：mission 创建后 14 stage 永远"待启动"），用户彻底卡死。
    //   8 秒后若仍非 live → 强制 startPolling，让 page 至少通过 replay 端点 4s 一次
    //   兜底拿事件，UI 能进展。WS 后续成功仍会切回 live（startPolling no-op 二次调用）。
    const handshakeFailsafeTimer = setTimeout(() => {
      if (!cancelled && socket && !socket.connected) {
        setConnState('polling');
        startPolling();
      }
    }, 8_000);

    const onConnect = () => {
      setConnState('live');
      setError(null);
      socket?.emit(
        joinEvent,
        { [idKey]: missionId },
        (resp: { ok: boolean; error?: string }) => {
          // 部分 gateway（如 ai-teams topic:join）不回 ack → resp 为 undefined，
          // 不视为失败；仅显式 ok=false 才降级 polling。
          if (resp && resp.ok === false) {
            setError(resp.error ?? 'join failed');
            startPolling();
          }
        }
      );
      // hydrate 与 socket join 之间发生的事件既不在 initial replay 也不在 live 流 →
      // onConnect 后用 lastTs 兜底拉一次 replay 覆盖空隙。
      void (async () => {
        try {
          const snap = await replay(missionId, lastTsRef.current);
          if (!cancelled) append(snap.events);
        } catch {
          // 忽略：live 流仍在跑，下次 disconnect 时 startPolling 兜底
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
    const onAnyHandler = (type: string, data: MissionEvent) => {
      // mission id 在 join 时已绑定，socket 只会收到本 mission 的事件；
      // acceptEvent 用于剔除非业务事件（默认 playground 规则：含 '.' 前缀）。
      if (!acceptEvent(type)) return;
      append([{ ...data, type }]);
    };

    const startPolling = () => {
      if (pollTimer) return;
      const tick = async () => {
        if (cancelled) return;
        try {
          const snap = await replay(missionId, lastTsRef.current);
          append(snap.events);
        } catch {
          // 忽略 polling 错误
        }
      };
      pollTimer = setInterval(() => {
        void tick();
      }, POLL_INTERVAL_MS);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.onAny(onAnyHandler);

    return () => {
      cancelled = true;
      clearTimeout(handshakeFailsafeTimer);
      if (pollTimer) clearInterval(pollTimer);
      if (socket) {
        socket.emit(leaveEvent, { [idKey]: missionId });
        socket.off('connect', onConnect);
        socket.off('disconnect', onDisconnect);
        socket.off('connect_error', onConnectError);
        socket.offAny(onAnyHandler);
        socket.disconnect();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionId, namespace]);

  return {
    events,
    connState,
    connected: connState === 'live',
    error,
  };
}

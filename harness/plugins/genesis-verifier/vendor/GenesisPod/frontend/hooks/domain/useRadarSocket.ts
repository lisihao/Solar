'use client';

/**
 * useRadarSocket —— 订阅后端 ai-radar Socket.IO namespace
 *
 * 后端 RadarGateway 启动时注册 SocketBroadcastAdapter
 * (eventTypePrefix='ai-radar.', roomPrefix='radar')。本 hook：
 *   1. 用 socket.io-client 连 namespace='ai-radar'
 *   2. join `radar:<runId>` room（gateway 内做 ownership 校验）
 *   3. 订阅 7 个事件 → 回调 handler
 *   4. unmount 时 leave + disconnect
 *
 * 用法：
 * ```
 * const { connected, lastStage } = useRadarSocket(runId, {
 *   onStage: (e) => setProgress(e.stage),
 *   onCompleted: () => refetchFeed(),
 * });
 * ```
 */
import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { config } from '@/lib/utils/config';
import { getAuthTokens } from '@/lib/utils/auth';

export interface RadarStageEvent {
  runId: string;
  topicId: string;
  stage: string;
  status: 'started' | 'completed' | 'failed';
  message?: string;
}

export interface RadarRunCompletedEvent {
  runId: string;
  topicId: string;
  // mission lifecycle 标准值域 (small letter，对齐后端 schema VarChar(20) +
  // RadarRunStatus types.ts)；早期错写大写已修
  status: 'completed' | 'failed' | 'cancelled';
  durationMs: number;
  metrics: Record<string, unknown>;
}

export interface RadarRunFailedEvent {
  runId: string;
  topicId: string;
  error: string;
  durationMs: number;
}

export interface RadarInsightCreatedEvent {
  runId: string;
  topicId: string;
  insightId: string;
  signalCount: number;
  entityCount: number;
}

export interface RadarSourceHealthEvent {
  runId?: string;
  topicId: string;
  sourceId: string;
  health: 'HEALTHY' | 'DEGRADED' | 'FAILING' | 'UNKNOWN';
  consecutiveFailures: number;
}

export interface RadarSocketHandlers {
  onStarted?: (e: { runId: string; topicId: string; trigger: string }) => void;
  onStage?: (e: RadarStageEvent) => void;
  onCompleted?: (e: RadarRunCompletedEvent) => void;
  onFailed?: (e: RadarRunFailedEvent) => void;
  onCancelled?: (e: { runId: string; topicId: string; reason: string }) => void;
  onInsightCreated?: (e: RadarInsightCreatedEvent) => void;
  onSourceHealthChanged?: (e: RadarSourceHealthEvent) => void;
}

interface SocketEnvelope<TPayload> {
  type: string;
  payload: TPayload;
  timestamp?: number;
}

export function useRadarSocket(
  runId: string | null | undefined,
  handlers: RadarSocketHandlers = {}
): {
  connected: boolean;
  lastStage: RadarStageEvent | null;
} {
  const [connected, setConnected] = useState(false);
  const [lastStage, setLastStage] = useState<RadarStageEvent | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!runId) return;
    const tokens = getAuthTokens();
    const token = tokens?.accessToken;
    if (!token) return;
    const socket = io(`${config.apiBaseUrl}/ai-radar`, {
      auth: { token },
      transports: ['polling', 'websocket'],
      reconnectionAttempts: 3,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit(
        'join',
        { missionId: runId },
        (resp: { ok: boolean; error?: string }) => {
          if (!resp?.ok) {
            // join 失败：继续保留 connection 但不监听该 mission 事件
            // gateway 还原因（forbidden / not-found）；不在 UI 强提示
          }
        }
      );
    });
    socket.on('disconnect', () => setConnected(false));

    socket.on(
      'ai-radar.run.started',
      (
        env: SocketEnvelope<{ runId: string; topicId: string; trigger: string }>
      ) => {
        handlersRef.current.onStarted?.(env.payload);
      }
    );
    socket.on('ai-radar.run.stage', (env: SocketEnvelope<RadarStageEvent>) => {
      setLastStage(env.payload);
      handlersRef.current.onStage?.(env.payload);
    });
    socket.on(
      'ai-radar.run.completed',
      (env: SocketEnvelope<RadarRunCompletedEvent>) => {
        handlersRef.current.onCompleted?.(env.payload);
      }
    );
    socket.on(
      'ai-radar.run.failed',
      (env: SocketEnvelope<RadarRunFailedEvent>) => {
        handlersRef.current.onFailed?.(env.payload);
      }
    );
    socket.on(
      'ai-radar.run.cancelled',
      (
        env: SocketEnvelope<{ runId: string; topicId: string; reason: string }>
      ) => {
        handlersRef.current.onCancelled?.(env.payload);
      }
    );
    socket.on(
      'ai-radar.insight.created',
      (env: SocketEnvelope<RadarInsightCreatedEvent>) => {
        handlersRef.current.onInsightCreated?.(env.payload);
      }
    );
    socket.on(
      'ai-radar.source.health-changed',
      (env: SocketEnvelope<RadarSourceHealthEvent>) => {
        handlersRef.current.onSourceHealthChanged?.(env.payload);
      }
    );

    return () => {
      socket.emit('leave', { missionId: runId });
      socket.disconnect();
      socketRef.current = null;
    };
  }, [runId]);

  return { connected, lastStage };
}

/**
 * useNotificationSocket
 *
 * 订阅 `/notifications` namespace 的 Socket.IO 实时事件：
 *   - `notification:new`   — 收到一条新通知（推给当前 user）
 *   - `notification:broadcast` — admin 广播（频道级，所有 user）
 *
 * 用法：
 *   useNotificationSocket({
 *     onNewNotification: () => refresh(),
 *     onBroadcast: () => refresh(),
 *   });
 *
 * 设计要点：
 *   - 静默失败：socket 连不上不抛错，UI 仍可工作（拉模式兜底）
 *   - 单例：组件卸载主动 disconnect，不留泄漏
 *   - 无 token 时不连（避免无意义的连接尝试 + 后端 disconnect 风暴）
 */

import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getAuthTokens } from '@/lib/utils/auth';
import { logger } from '@/lib/utils/logger';

export interface NotificationSocketPayload {
  notificationId?: string;
  userId?: string;
  type?: string;
  title?: string;
  message?: string;
  /** quiet hours 内的通知 — 只更新 unread badge，不弹 toast */
  silent?: boolean;
}

interface UseNotificationSocketOptions {
  enabled?: boolean;
  onNewNotification?: (payload: NotificationSocketPayload) => void;
  onBroadcast?: (payload: NotificationSocketPayload) => void;
}

export function useNotificationSocket(opts: UseNotificationSocketOptions = {}) {
  const { enabled = true, onNewNotification, onBroadcast } = opts;
  const onNewRef = useRef(onNewNotification);
  const onBroadcastRef = useRef(onBroadcast);
  onNewRef.current = onNewNotification;
  onBroadcastRef.current = onBroadcast;

  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const tokens = getAuthTokens();
    if (!tokens?.accessToken) return;

    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    const baseUrl = apiUrl?.replace('/api/v1', '') || 'http://localhost:3001';

    const socket = io(`${baseUrl}/notifications`, {
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionAttempts: 3,
      reconnectionDelay: 2000,
      timeout: 10000,
      withCredentials: true,
      auth: { token: tokens.accessToken },
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      logger.debug('[NotificationSocket] connected');
    });

    socket.on('notification:new', (payload: NotificationSocketPayload) => {
      onNewRef.current?.(payload);
    });

    socket.on(
      'notification:broadcast',
      (payload: NotificationSocketPayload) => {
        onBroadcastRef.current?.(payload);
      }
    );

    socket.on('connect_error', (err: Error) => {
      // 静默：拉模式兜底
      logger.debug('[NotificationSocket] connect_error:', err.message);
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [enabled]);
}

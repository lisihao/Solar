/**
 * useAskRoomSocket
 *
 * 订阅 `/ai-ask-room` namespace 的 socket.io 事件，把 server event 派发到 store。
 * 设计：teams-mode.md §6.2；模式参考 useNotificationSocket。
 *
 * 用法：
 *   useAskRoomSocket({ sessionId, enabled: !!sessionId, onEvent });
 */

import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getAuthTokens } from '@/lib/utils/auth';
import { config } from '@/lib/utils/config';
import { logger } from '@/lib/utils/logger';
import {
  ASK_ROOM_CLIENT_EVENT_NAME,
  ASK_ROOM_EVENT_NAME,
  ASK_ROOM_JOIN_EVENT_NAME,
  ASK_ROOM_NAMESPACE,
  type AskRoomClientEvent,
  type AskRoomJoinAck,
  type AskRoomServerEvent,
} from '@/lib/types/ask-room';
import { useAskRoomStore } from '@/stores/ask-room.store';

interface UseAskRoomSocketOptions {
  sessionId: string;
  enabled?: boolean;
  onEvent?: (event: AskRoomServerEvent) => void;
  onJoinError?: (reason: string) => void;
}

interface SocketHandle {
  cancelTurn: (turnId: string) => void;
  isConnected: () => boolean;
}

export function useAskRoomSocket(opts: UseAskRoomSocketOptions): SocketHandle {
  const { sessionId, enabled = true, onEvent, onJoinError } = opts;
  const socketRef = useRef<Socket | null>(null);
  const onEventRef = useRef(onEvent);
  const onJoinErrorRef = useRef(onJoinError);
  onEventRef.current = onEvent;
  onJoinErrorRef.current = onJoinError;

  const applyEvent = useAskRoomStore((s) => s.applyEvent);

  useEffect(() => {
    if (!enabled || !sessionId) return;

    const tokens = getAuthTokens();
    if (!tokens?.accessToken) return;

    // socket 必须直连后端（与 useRadarStream / useSocialMissionStream /
    // useAgentPlaygroundStream 一致）：gens.team 等自定义域名上 apiBaseUrl 为空字符串
    // （REST 走 Next.js rewrites 代理），但 rewrites 只代理 /api/v1/*，不代理
    // /socket.io/*；旧写法 `NEXT_PUBLIC_API_URL?.replace(...) || 'localhost:3001'`
    // 既不绕代理、未注入时还会兜底到 localhost。getBackendUrl() = NEXT_PUBLIC_API_URL
    // || RAILWAY_BACKEND_URL，始终返回完整后端 URL。
    const baseUrl = config.getBackendUrl();

    const socket = io(`${baseUrl}${ASK_ROOM_NAMESPACE}`, {
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
      logger.debug('[AskRoomSocket] connected; joining session=' + sessionId);
      socket.emit(
        ASK_ROOM_JOIN_EVENT_NAME,
        { sessionId },
        (ack: AskRoomJoinAck) => {
          if (!ack.ok) {
            logger.warn(
              `[AskRoomSocket] join rejected: ${ack.reason ?? 'unknown'}`
            );
            onJoinErrorRef.current?.(ack.reason ?? 'unknown');
          }
        }
      );
    });

    socket.on(ASK_ROOM_EVENT_NAME, (event: AskRoomServerEvent) => {
      applyEvent(event);
      onEventRef.current?.(event);
    });

    socket.on('connect_error', (err: Error) => {
      // 优雅降级（与 useNotificationSocket 一致）：传输层连接失败（代理环境常见的
      // xhr poll error）不再弹致命红条。RoomChatPage 的 loading 由 HTTP initialLoad
      // 控制、与 socket 无关（原 "否则卡 loading" 注释不成立）；socket.io 会按
      // reconnectionAttempts 自行重连。onJoinError 仅保留给真正的 join 拒绝
      // （ack.ok===false：未登录 / 越权 / 房间不存在），那才是用户需要看到的错误。
      logger.debug(`[AskRoomSocket] connect_error: ${err.message}`);
    });

    socket.on('disconnect', (reason: string) => {
      logger.debug(`[AskRoomSocket] disconnected: ${reason}`);
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [sessionId, enabled, applyEvent]);

  return {
    cancelTurn(turnId: string) {
      const s = socketRef.current;
      if (!s || !s.connected) return;
      const event: AskRoomClientEvent = { kind: 'turn.cancel', turnId };
      s.emit(ASK_ROOM_CLIENT_EVENT_NAME, event);
    },
    isConnected() {
      return !!socketRef.current?.connected;
    },
  };
}

import { StateCreator } from 'zustand';
import { io, Socket } from 'socket.io-client';
import { getAuthTokens } from '@/lib/utils/auth';

import { logger } from '@/lib/utils/logger';
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export interface WebSocketSlice {
  // State
  socket: Socket | null;
  isConnected: boolean;
  currentUserId: string | null;
  onlineUsers: Set<string>;

  // Actions
  connectSocket: (userId: string) => void;
  disconnectSocket: () => void;
  joinTopicRoom: (topicId: string) => void;
  leaveTopicRoom: (topicId: string) => void;
  sendTyping: (topicId: string) => void;
}

export const createWebSocketSlice: StateCreator<
  WebSocketSlice,
  [],
  [],
  WebSocketSlice
> = (set, get) => ({
  // Initial state
  socket: null,
  isConnected: false,
  currentUserId: null,
  onlineUsers: new Set(),

  // ==================== WebSocket ====================

  connectSocket: (userId) => {
    const { socket } = get();
    if (socket?.connected) return;

    // Store current user ID
    set({ currentUserId: userId });

    const tokens = getAuthTokens();
    const newSocket = io(`${API_URL}/ai-teams`, {
      auth: { userId, token: tokens?.accessToken },
      query: { userId },
      // 代理环境兼容性配置
      transports: ['websocket', 'polling'],
      upgrade: true,
      rememberUpgrade: true,
      // 重连策略
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      randomizationFactor: 0.5,
      // 超时配置
      timeout: 20000,
      // 代理相关配置
      forceNew: false,
      multiplex: true,
    });

    newSocket.on('connect', () => {
      logger.debug('[WS] Connected', {
        socketId: newSocket.id,
        transport: newSocket.io.engine?.transport?.name,
      });
      set({ isConnected: true });
    });

    newSocket.on('disconnect', (reason) => {
      logger.debug('[WS] Disconnected', { reason, socketId: newSocket.id });
      set({
        isConnected: false,
        onlineUsers: new Set(),
      });
    });

    newSocket.on('connect_error', (error) => {
      logger.error('[WS] Connection error:', error.message);
    });

    // 重连事件
    newSocket.io.on('reconnect', (attempt) => {
      logger.debug('[WS] Reconnected', {
        attempts: attempt,
        transport: newSocket.io.engine?.transport?.name,
      });
    });

    newSocket.io.on('reconnect_attempt', (attempt) => {
      logger.debug('[WS] Reconnection attempt', attempt);
    });

    newSocket.io.on('reconnect_error', (error) => {
      logger.error('[WS] Reconnection error:', error.message);
    });

    newSocket.io.on('reconnect_failed', () => {
      logger.error('[WS] Reconnection failed after all attempts');
    });

    // 传输层升级事件
    newSocket.io.engine?.on('upgrade', (transport: { name: string }) => {
      logger.debug('[WS] Transport upgraded to:', transport.name);
    });

    // 成员上线
    newSocket.on(
      'member:online',
      ({ userId: onlineUserId }: { userId: string }) => {
        set((state) => {
          const newSet = new Set(state.onlineUsers);
          newSet.add(onlineUserId);
          return { onlineUsers: newSet };
        });
      }
    );

    // 成员下线
    newSocket.on(
      'member:offline',
      ({ userId: offlineUserId }: { userId: string }) => {
        set((state) => {
          const newSet = new Set(state.onlineUsers);
          newSet.delete(offlineUserId);
          return { onlineUsers: newSet };
        });
      }
    );

    set({ socket: newSocket });
  },

  disconnectSocket: () => {
    const { socket } = get();
    if (socket) {
      socket.disconnect();
      set({
        socket: null,
        isConnected: false,
        currentUserId: null,
        onlineUsers: new Set(),
      });
    }
  },

  joinTopicRoom: (topicId) => {
    const { socket } = get();
    logger.debug(
      `[WS] joinTopicRoom called for topic ${topicId}, socket connected: ${socket?.connected}, socket id: ${socket?.id}`
    );
    if (socket?.connected) {
      socket.emit(
        'topic:join',
        { topicId },
        (response: {
          success?: boolean;
          onlineUsers?: string[];
          error?: string;
        }) => {
          logger.debug(`[WS] topic:join response for ${topicId}:`, response);
          if (response.success && response.onlineUsers) {
            set({ onlineUsers: new Set(response.onlineUsers) });
            logger.debug(
              '[WS] Joined topic room, online users:',
              response.onlineUsers
            );
          } else if (response.error) {
            logger.error('[WS] Failed to join topic room:', response.error);
          }
        }
      );
    } else {
      logger.debug('[WS] Socket not connected, waiting...');
      const MAX_RETRIES = 20;
      let retryCount = 0;
      const checkAndJoin = () => {
        const { socket: currentSocket } = get();
        logger.debug(
          `[WS] Retry join (${retryCount + 1}/${MAX_RETRIES}): socket connected: ${currentSocket?.connected}, socket id: ${currentSocket?.id}`
        );
        if (currentSocket?.connected) {
          currentSocket.emit(
            'topic:join',
            { topicId },
            (response: {
              success?: boolean;
              onlineUsers?: string[];
              error?: string;
            }) => {
              logger.debug(
                `[WS] topic:join response (delayed) for ${topicId}:`,
                response
              );
              if (response.success && response.onlineUsers) {
                set({ onlineUsers: new Set(response.onlineUsers) });
                logger.debug(
                  '[WS] Joined topic room (delayed), online users:',
                  response.onlineUsers
                );
              }
            }
          );
        } else {
          retryCount += 1;
          if (retryCount < MAX_RETRIES) {
            setTimeout(checkAndJoin, 500);
          } else {
            logger.error(
              `[WS] Gave up waiting to join topic room ${topicId} after ${MAX_RETRIES} retries`
            );
          }
        }
      };
      setTimeout(checkAndJoin, 500);
    }
  },

  leaveTopicRoom: (topicId) => {
    const { socket } = get();
    if (socket?.connected) {
      socket.emit('topic:leave', { topicId });
    }
  },

  sendTyping: (topicId) => {
    const { socket } = get();
    if (socket?.connected) {
      socket.emit('message:typing', { topicId });
    }
  },
});

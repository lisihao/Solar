/**
 * AI Research WebSocket Hook
 *
 * 连接到 Topic Research WebSocket Gateway，接收实时更新
 * 参考 AI Writing 的 useWritingWebSocket 设计
 *
 * ★ Security: JWT 认证已启用
 * - 连接时自动传递 JWT token
 * - 认证失败会断开连接并显示错误
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { io, Socket } from 'socket.io-client';

import { logger } from '@/lib/utils/logger';
import { getAuthTokens } from '@/lib/utils/auth';
// 事件类型
export type ResearchEventType =
  | 'mission:started'
  | 'mission:progress'
  | 'mission:completed'
  | 'mission:failed'
  // Leader 事件
  | 'leader:thinking'
  | 'leader:planning'
  | 'leader:plan_ready'
  | 'leader:response'
  // Agent 事件
  | 'agent:working'
  | 'agent:completed'
  | 'agent:failed'
  // 任务事件
  | 'task:started'
  | 'task:progress'
  | 'task:completed'
  | 'task:failed'
  // 维度研究事件
  | 'dimension:research_started'
  | 'dimension:research_progress'
  | 'dimension:research_completed'
  // 报告撰写事件
  | 'report:synthesis_started'
  | 'report:synthesis_progress'
  | 'report:synthesis_completed'
  // TODO 事件 (Phase TODO UX Enhancement)
  | 'todo:created'
  | 'todo:status_changed'
  | 'todo:progress'
  | 'todo:completed'
  | 'todo:failed'
  | 'todo:cancelled'
  // ★ v7.2: Leader 审核事件
  | 'todo:reviewing'
  | 'todo:reviewed';

// Leader 思考数据
export interface LeaderThinkingData {
  missionId: string;
  phase: 'understanding' | 'analyzing' | 'planning' | 'assigning';
  content: string;
  progress?: number;
  timestamp: string;
}

// Agent 工作状态
export interface AgentWorkingData {
  agentId: string;
  agentName: string;
  agentRole: 'leader' | 'researcher' | 'reviewer' | 'synthesizer';
  status: 'working' | 'completed' | 'failed';
  taskDescription?: string;
  dimensionName?: string;
  progress?: number;
  timestamp: string;
}

// 任务进度数据
export interface TaskProgressData {
  taskId: string;
  taskType: string;
  title: string;
  dimensionName?: string;
  status: string;
  progress: number;
  message?: string;
  timestamp: string;
}

// Mission 进度数据
export interface MissionProgressData {
  missionId: string;
  progress: number;
  phase: string;
  message: string;
  currentTask?: string;
  completedTasks: number;
  totalTasks: number;
  activeAgents?: string[];
  timestamp: string;
}

// 事件回调类型
export interface ResearchEvent {
  type: ResearchEventType;
  data: unknown;
  timestamp: string;
}

// ★ Phase 5: Sync request/response types
interface SyncResponse {
  success: boolean;
  needsRecovery: boolean;
  currentState: {
    phase: string;
    progress: number;
    message: string;
    missionId?: string;
    lastActivityAt?: string;
  } | null;
  error?: string;
}

// Hook 配置选项
interface UseResearchWebSocketOptions {
  enabled?: boolean;
  onEvent?: (event: ResearchEvent) => void;
  /** ★ Phase 5: Callback when state needs recovery after reconnect */
  onNeedsRecovery?: (state: SyncResponse['currentState']) => void;
}

// Hook 返回类型
interface UseResearchWebSocketResult {
  isConnected: boolean;
  error: string | null;
  // 最新状态
  progress: number;
  phase: string;
  currentMessage: string;
  activeAgentIds: string[];
  // 事件历史（用于显示在团队互动区）
  events: ResearchEvent[];
  // ★ Phase 5: Sync state
  isSyncing: boolean;
  lastSyncAt: string | null;
  // 方法
  connect: () => void;
  disconnect: () => void;
  clearEvents: () => void;
  /** ★ Phase 5: Request state sync from server */
  requestSync: () => void;
}

export function useResearchWebSocket(
  topicId: string | null,
  enabledOrOptions: boolean | UseResearchWebSocketOptions = true
): UseResearchWebSocketResult {
  // 支持旧的 boolean 参数和新的 options 对象
  const options: UseResearchWebSocketOptions =
    typeof enabledOrOptions === 'boolean'
      ? { enabled: enabledOrOptions }
      : enabledOrOptions;
  const { enabled = true, onEvent, onNeedsRecovery } = options;
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onNeedsRecoveryRef = useRef(onNeedsRecovery);
  onNeedsRecoveryRef.current = onNeedsRecovery;
  const socketRef = useRef<Socket | null>(null);
  const connectingRef = useRef(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // ★ Ref that always reflects the latest error value, used inside connect()
  // to avoid stale closure capture when connect is recreated.
  const errorRef = useRef(error);
  errorRef.current = error;

  // 状态
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState('');
  const [currentMessage, setCurrentMessage] = useState('');
  const [activeAgentIds, setActiveAgentIds] = useState<string[]>([]);
  const [events, setEvents] = useState<ResearchEvent[]>([]);

  // ★ Phase 5: Sync state
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  // 清除事件
  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  // ★ Phase 5: Request state sync from server
  const requestSync = useCallback(() => {
    if (!socketRef.current?.connected || !topicId) {
      return;
    }

    setIsSyncing(true);

    socketRef.current.emit(
      'sync:request',
      {
        topicId,
        lastKnownPhase: phase || undefined,
        lastKnownProgress: progress || undefined,
      },
      (response: SyncResponse) => {
        setIsSyncing(false);
        setLastSyncAt(new Date().toISOString());

        if (!response.success) {
          logger.error('[ResearchWS] Sync failed:', response.error);
          return;
        }

        if (response.currentState) {
          // Update local state with server state
          setProgress(response.currentState.progress);
          setPhase(response.currentState.phase);
          setCurrentMessage(response.currentState.message);

          // Notify if recovery is needed
          if (response.needsRecovery && onNeedsRecoveryRef.current) {
            logger.debug('[ResearchWS] State recovery needed');
            onNeedsRecoveryRef.current(response.currentState);
          }
        }

        logger.debug('[ResearchWS] Sync completed:', response);
      }
    );
  }, [topicId, phase, progress]);

  // 连接
  const connect = useCallback(() => {
    // 防止重复连接
    if (!topicId || socketRef.current?.connected || connectingRef.current) {
      return;
    }

    // ★ Security: 获取 JWT token
    const tokens = getAuthTokens();
    if (!tokens?.accessToken) {
      logger.warn('[ResearchWS] No auth token available, cannot connect');
      setError('请先登录后再使用研究功能');
      return;
    }

    // 从 NEXT_PUBLIC_API_URL 获取后端 URL
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    if (!apiUrl) {
      // 本地开发环境
      logger.debug('[ResearchWS] No API URL configured, using localhost');
    }

    // 移除 /api/v1 后缀获取基础 URL
    const baseUrl = apiUrl?.replace('/api/v1', '') || 'http://localhost:3001';

    connectingRef.current = true;
    logger.debug('[ResearchWS] Connecting to:', `${baseUrl}/topic-insights`);

    const socket = io(`${baseUrl}/topic-insights`, {
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionAttempts: 3,
      reconnectionDelay: 2000,
      timeout: 10000,
      withCredentials: true,
      // ★ Security: 在 handshake 中传递 JWT token
      auth: {
        token: tokens.accessToken,
      },
    });

    socket.on('connect', () => {
      logger.debug('[ResearchWS] Connected');
      connectingRef.current = false;
      setIsConnected(true);
      setError(null);

      // 加入专题房间
      socket.emit('join:topic', { topicId });

      // ★ Phase 5: Auto-sync state after connecting
      // Use setTimeout to ensure join is processed first
      setTimeout(() => {
        if (socket.connected) {
          setIsSyncing(true);
          socket.emit('sync:request', { topicId }, (response: SyncResponse) => {
            setIsSyncing(false);
            setLastSyncAt(new Date().toISOString());

            if (response.success && response.currentState) {
              setProgress(response.currentState.progress);
              setPhase(response.currentState.phase);
              setCurrentMessage(response.currentState.message);

              if (response.needsRecovery && onNeedsRecoveryRef.current) {
                onNeedsRecoveryRef.current(response.currentState);
              }
            }
          });
        }
      }, 100);
    });

    socket.on('disconnect', (reason) => {
      logger.debug('[ResearchWS] Disconnected:', reason);
      connectingRef.current = false;
      setIsConnected(false);
    });

    socket.on('connect_error', (err) => {
      logger.error('[ResearchWS] Connection error:', err.message);
      connectingRef.current = false;
      // 只在首次失败时设置错误，避免频繁更新状态导致闪烁
      // Use errorRef.current instead of error to avoid stale closure
      if (!errorRef.current) {
        setError(`WebSocket 连接失败`);
      }
    });

    // ★ Security: 处理认证错误
    socket.on('auth:error', (data: { message: string }) => {
      logger.error('[ResearchWS] Authentication error:', data.message);
      connectingRef.current = false;
      setError(data.message || '认证失败，请重新登录');
      setIsConnected(false);
    });

    // Helper to emit event to callback and store in history
    const handleEvent = (type: ResearchEventType, data: unknown) => {
      const event: ResearchEvent = {
        type,
        data,
        timestamp: new Date().toISOString(),
      };

      // 添加到事件历史
      setEvents((prev) => [...prev, event]);

      // 回调
      if (onEventRef.current) {
        onEventRef.current(event);
      }
    };

    // Mission 事件
    socket.on('mission:started', (data) => {
      logger.debug('[ResearchWS] Mission started:', data);
      setProgress(0);
      setPhase('started');
      setCurrentMessage(data.message || '研究任务已启动');
      handleEvent('mission:started', data);
    });

    socket.on('mission:progress', (data: MissionProgressData) => {
      setProgress(data.progress);
      setPhase(data.phase);
      setCurrentMessage(data.message);
      if (data.activeAgents) {
        setActiveAgentIds(data.activeAgents);
      }
      handleEvent('mission:progress', data);
    });

    socket.on('mission:completed', (data) => {
      logger.debug('[ResearchWS] Mission completed:', data);
      setProgress(100);
      setPhase('completed');
      setCurrentMessage(data.message || '研究完成');
      setActiveAgentIds([]);
      handleEvent('mission:completed', data);
    });

    socket.on('mission:failed', (data) => {
      logger.error('[ResearchWS] Mission failed:', data);
      setError(data.error || '任务失败');
      handleEvent('mission:failed', data);
    });

    // Leader 事件
    socket.on('leader:thinking', (data: LeaderThinkingData) => {
      logger.debug('[ResearchWS] Leader thinking:', data);
      setCurrentMessage(data.content);
      handleEvent('leader:thinking', data);
    });

    socket.on('leader:planning', (data) => {
      logger.debug('[ResearchWS] Leader planning:', data);
      setCurrentMessage(data.message || data.content);
      handleEvent('leader:planning', data);
    });

    socket.on('leader:plan_ready', (data) => {
      logger.debug('[ResearchWS] Leader plan ready:', data);
      setCurrentMessage(data.message);
      handleEvent('leader:plan_ready', data);
    });

    socket.on('leader:response', (data) => {
      logger.debug('[ResearchWS] Leader response:', data);
      handleEvent('leader:response', data);
    });

    // Agent 事件
    socket.on('agent:working', (data: AgentWorkingData) => {
      if (data.status === 'working') {
        setActiveAgentIds((prev) =>
          prev.includes(data.agentId) ? prev : [...prev, data.agentId]
        );
      } else {
        setActiveAgentIds((prev) => prev.filter((id) => id !== data.agentId));
      }
      handleEvent('agent:working', data);
    });

    socket.on('agent:completed', (data) => {
      logger.debug('[ResearchWS] Agent completed:', data);
      handleEvent('agent:completed', data);
    });

    // 任务事件
    socket.on('task:started', (data: TaskProgressData) => {
      logger.debug('[ResearchWS] Task started:', data);
      setCurrentMessage(data.message || `开始执行: ${data.title}`);
      handleEvent('task:started', data);
    });

    socket.on('task:progress', (data: TaskProgressData) => {
      handleEvent('task:progress', data);
    });

    socket.on('task:completed', (data: TaskProgressData) => {
      logger.debug('[ResearchWS] Task completed:', data);
      handleEvent('task:completed', data);
    });

    // 维度研究事件
    socket.on('dimension:research_started', (data) => {
      logger.debug('[ResearchWS] Dimension research started:', data);
      handleEvent('dimension:research_started', data);
    });

    socket.on('dimension:research_progress', (data) => {
      handleEvent('dimension:research_progress', data);
    });

    socket.on('dimension:research_completed', (data) => {
      logger.debug('[ResearchWS] Dimension research completed:', data);
      handleEvent('dimension:research_completed', data);
    });

    // 报告撰写事件
    socket.on('report:synthesis_started', (data) => {
      logger.debug('[ResearchWS] Report synthesis started:', data);
      handleEvent('report:synthesis_started', data);
    });

    socket.on('report:synthesis_completed', (data) => {
      logger.debug('[ResearchWS] Report synthesis completed:', data);
      handleEvent('report:synthesis_completed', data);
    });

    // TODO 事件 (Phase TODO UX Enhancement)
    socket.on('todo:created', (data) => {
      logger.debug('[ResearchWS] TODO created:', data);
      handleEvent('todo:created', data);
    });

    socket.on('todo:status_changed', (data) => {
      logger.debug('[ResearchWS] TODO status changed:', data);
      handleEvent('todo:status_changed', data);
    });

    socket.on('todo:progress', (data) => {
      handleEvent('todo:progress', data);
    });

    socket.on('todo:completed', (data) => {
      logger.debug('[ResearchWS] TODO completed:', data);
      handleEvent('todo:completed', data);
    });

    socket.on('todo:failed', (data) => {
      logger.debug('[ResearchWS] TODO failed:', data);
      handleEvent('todo:failed', data);
    });

    socket.on('todo:cancelled', (data) => {
      logger.debug('[ResearchWS] TODO cancelled:', data);
      handleEvent('todo:cancelled', data);
    });

    // ★ v7.2: Leader 审核事件
    socket.on('todo:reviewing', (data) => {
      logger.debug('[ResearchWS] TODO reviewing:', data);
      setCurrentMessage(data.message || 'Leader 正在审核任务结果...');
      handleEvent('todo:reviewing', data);
    });

    socket.on('todo:reviewed', (data) => {
      logger.debug('[ResearchWS] TODO reviewed:', data);
      const decision = data.decision || 'unknown';
      const msg =
        decision === 'approved'
          ? '审核通过'
          : decision === 'needs_revision'
            ? '需要修改'
            : '审核拒绝';
      setCurrentMessage(`Leader 审核结果: ${msg}`);
      handleEvent('todo:reviewed', data);
    });

    socketRef.current = socket;
    // error is intentionally excluded: we use errorRef.current inside the
    // callback to read the latest value without recreating the socket on each
    // error state change (which would cause a reconnect loop).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicId]);

  // 断开连接
  const disconnect = useCallback(() => {
    if (socketRef.current) {
      if (topicId) {
        socketRef.current.emit('leave:topic', { topicId });
      }
      socketRef.current.disconnect();
      socketRef.current = null;
      setIsConnected(false);
    }
  }, [topicId]);

  // 自动连接/断开
  useEffect(() => {
    if (enabled && topicId) {
      connect();
    }

    return () => {
      if (socketRef.current) {
        if (topicId) {
          socketRef.current.emit('leave:topic', { topicId });
        }
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
        connectingRef.current = false;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, topicId]);

  return {
    isConnected,
    error,
    progress,
    phase,
    currentMessage,
    activeAgentIds,
    events,
    // ★ Phase 5: Sync state
    isSyncing,
    lastSyncAt,
    // Methods
    connect,
    disconnect,
    clearEvents,
    requestSync,
  };
}

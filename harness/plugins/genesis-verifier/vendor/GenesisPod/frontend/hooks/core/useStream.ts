/**
 * useStream - SSE 流式响应 Hook
 *
 * 提供：
 * 1. EventSource 连接管理
 * 2. 进度状态追踪
 * 3. 自动重连
 * 4. 取消支持
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  apiClient,
  SSEHandler,
  SSEProgressEvent,
  SSECompleteEvent,
  SSEErrorEvent,
  SSEEvent,
} from '@/lib/api/client';

export interface StreamState<T = unknown> {
  // 是否正在流式传输
  streaming: boolean;
  // 当前进度 (0-100)
  progress: number;
  // 当前阶段
  phase: string;
  // 进度消息
  message: string;
  // 最终结果
  result: T | undefined;
  // 错误信息
  error: string | null;
  // 当前/总数 (可选)
  current?: number;
  total?: number;
}

export interface UseStreamOptions<T> {
  /** 完成回调 */
  onComplete?: (result: T) => void;
  /** 错误回调 */
  onError?: (error: string) => void;
  /** 进度回调 */
  onProgress?: (event: SSEProgressEvent) => void;
  /** 原始事件回调 */
  onEvent?: (event: SSEEvent) => void;
  /** 是否自动重连 */
  autoReconnect?: boolean;
  /** 最大重连次数 */
  reconnectAttempts?: number;
  /** 初始重连间隔（毫秒） */
  reconnectInterval?: number;
  /** 最大重连间隔（毫秒） */
  maxReconnectInterval?: number;
  /** 退避因子 */
  backoffFactor?: number;
}

export interface UseStreamResult<T, P = void> {
  // 当前状态
  state: StreamState<T>;
  // 开始流式请求 (GET)
  start: (path: string) => void;
  // 开始流式请求 (POST)
  startPost: (path: string, body: P) => Promise<void>;
  // 停止流式请求
  stop: () => void;
  // 重置状态
  reset: () => void;
}

const initialState: StreamState = {
  streaming: false,
  progress: 0,
  phase: '',
  message: '',
  result: undefined,
  error: null,
};

/**
 * SSE 流式响应 Hook
 */
/**
 * 计算指数退避延迟
 */
function calculateBackoffDelay(
  attempt: number,
  baseDelay: number,
  maxDelay: number,
  factor: number
): number {
  // 指数退避
  const delay = Math.min(baseDelay * Math.pow(factor, attempt), maxDelay);
  // 添加随机抖动 (±25%) 防止雷鸣羊群效应
  const jitter = delay * 0.25;
  return Math.floor(delay + Math.random() * jitter * 2 - jitter);
}

export function useStream<T = unknown, P = unknown>(
  options: UseStreamOptions<T> = {}
): UseStreamResult<T, P> {
  const {
    onComplete,
    onError,
    onProgress,
    onEvent,
    autoReconnect = false,
    reconnectAttempts = 3,
    reconnectInterval = 1000,
    maxReconnectInterval = 30000,
    backoffFactor = 2,
  } = options;

  const [state, setState] = useState<StreamState<T>>(
    initialState as StreamState<T>
  );
  const closeRef = useRef<(() => void) | null>(null);
  const reconnectCountRef = useRef(0);
  const currentPathRef = useRef<string>('');

  // 处理进度事件
  const handleProgress = useCallback(
    (event: SSEProgressEvent) => {
      setState((prev) => ({
        ...prev,
        progress: event.progress,
        phase: event.phase,
        message: event.message,
        current: event.current,
        total: event.total,
      }));
      onProgress?.(event);
    },
    [onProgress]
  );

  // 处理完成事件
  const handleComplete = useCallback(
    (event: SSECompleteEvent<T>) => {
      setState((prev) => ({
        ...prev,
        streaming: false,
        progress: 100,
        result: event.result,
      }));
      closeRef.current?.();
      closeRef.current = null;
      reconnectCountRef.current = 0;
      onComplete?.(event.result);
    },
    [onComplete]
  );

  // 处理错误事件
  const handleError = useCallback(
    (event: SSEErrorEvent) => {
      // 如果可恢复且启用自动重连
      if (
        event.recoverable &&
        autoReconnect &&
        reconnectCountRef.current < reconnectAttempts
      ) {
        const delay = calculateBackoffDelay(
          reconnectCountRef.current,
          reconnectInterval,
          maxReconnectInterval,
          backoffFactor
        );
        reconnectCountRef.current++;
        setTimeout(() => {
          if (currentPathRef.current) {
            startStream(currentPathRef.current);
          }
        }, delay);
        return;
      }

      setState((prev) => ({
        ...prev,
        streaming: false,
        error: event.error,
      }));
      closeRef.current?.();
      closeRef.current = null;
      onError?.(event.error);
    },
    [autoReconnect, reconnectAttempts, reconnectInterval, onError]
  );

  // 创建事件处理器
  const createHandlers = useCallback((): SSEHandler<T> => {
    return {
      onProgress: handleProgress,
      onComplete: handleComplete,
      onError: handleError,
      onEvent,
    };
  }, [handleProgress, handleComplete, handleError, onEvent]);

  // 开始 GET 流式请求
  const startStream = useCallback(
    (path: string) => {
      // 关闭现有连接
      closeRef.current?.();

      currentPathRef.current = path;
      setState({
        streaming: true,
        progress: 0,
        phase: 'initializing',
        message: '正在初始化...',
        result: undefined,
        error: null,
      });

      const { close } = apiClient.createSSEStream<T>(path, createHandlers());
      closeRef.current = close;
    },
    [createHandlers]
  );

  // 开始 POST 流式请求
  const startPostStream = useCallback(
    async (path: string, body: P) => {
      // 关闭现有连接
      closeRef.current?.();

      currentPathRef.current = path;
      setState({
        streaming: true,
        progress: 0,
        phase: 'initializing',
        message: '正在初始化...',
        result: undefined,
        error: null,
      });

      const { close } = await apiClient.postSSEStream<T>(
        path,
        body,
        createHandlers()
      );
      closeRef.current = close;
    },
    [createHandlers]
  );

  // 停止流式请求
  const stop = useCallback(() => {
    closeRef.current?.();
    closeRef.current = null;
    currentPathRef.current = '';
    reconnectCountRef.current = 0;
    setState((prev) => ({
      ...prev,
      streaming: false,
    }));
  }, []);

  // 重置状态
  const reset = useCallback(() => {
    stop();
    setState(initialState as StreamState<T>);
  }, [stop]);

  // 清理
  useEffect(() => {
    return () => {
      closeRef.current?.();
    };
  }, []);

  return {
    state,
    start: startStream,
    startPost: startPostStream,
    stop,
    reset,
  };
}

/**
 * 简化的进度 Hook
 * 只追踪进度，不处理完整结果
 */
export function useProgress(
  options: {
    onComplete?: () => void;
    onError?: (error: string) => void;
  } = {}
) {
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { state, start, startPost, stop, reset } = useStream({
    onProgress: (event) => {
      setProgress(event.progress);
      setPhase(event.phase);
      setMessage(event.message);
    },
    onComplete: () => {
      setIsLoading(false);
      options.onComplete?.();
    },
    onError: (err) => {
      setIsLoading(false);
      setError(err);
      options.onError?.(err);
    },
  });

  const startProgress = useCallback(
    (path: string) => {
      setIsLoading(true);
      setError(null);
      start(path);
    },
    [start]
  );

  const startProgressPost = useCallback(
    async <P>(path: string, body: P) => {
      setIsLoading(true);
      setError(null);
      await startPost(path, body);
    },
    [startPost]
  );

  const resetProgress = useCallback(() => {
    setProgress(0);
    setPhase('');
    setMessage('');
    setIsLoading(false);
    setError(null);
    reset();
  }, [reset]);

  return {
    progress,
    phase,
    message,
    isLoading,
    error,
    streaming: state.streaming,
    start: startProgress,
    startPost: startProgressPost,
    stop,
    reset: resetProgress,
  };
}

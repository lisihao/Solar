/**
 * useAsyncOperation - 统一的异步操作基础 Hook
 *
 * 提取 useApi 和 useAsyncState 的共同逻辑：
 * - loading/error 状态管理
 * - 成功/失败回调
 * - 重置功能
 *
 * 符合 DRY 原则，减少代码重复
 */

import { useState, useCallback, useRef } from 'react';

/**
 * 异步操作状态
 */
export interface AsyncOperationState<T, E = string> {
  data: T | undefined;
  isLoading: boolean;
  error: E | null;
  isSuccess: boolean;
  isError: boolean;
}

/**
 * 异步操作选项
 */
export interface AsyncOperationOptions<T, E = string> {
  /** 初始数据 */
  initialData?: T;
  /** 成功回调 */
  onSuccess?: (data: T) => void;
  /** 失败回调 */
  onError?: (error: E) => void;
  /** 结束回调 (无论成功失败) */
  onSettled?: () => void;
}

/**
 * 异步操作结果
 */
export interface AsyncOperationResult<T, P = void, E = string> {
  /** 当前数据 */
  data: T | undefined;
  /** 是否正在加载 */
  isLoading: boolean;
  /** 错误信息 */
  error: E | null;
  /** 是否成功 */
  isSuccess: boolean;
  /** 是否失败 */
  isError: boolean;
  /** 执行操作 */
  execute: (params?: P) => Promise<T | undefined>;
  /** 重置状态 */
  reset: () => void;
  /** 手动设置数据 */
  setData: (data: T | undefined) => void;
  /** 手动设置错误 */
  setError: (error: E | null) => void;
}

/**
 * 统一的异步操作 Hook
 *
 * @template T - 返回数据类型
 * @template P - 参数类型
 * @template E - 错误类型
 */
export function useAsyncOperation<T, P = void, E = string>(
  asyncFn: (params?: P) => Promise<T>,
  options: AsyncOperationOptions<T, E> = {}
): AsyncOperationResult<T, P, E> {
  const { initialData, onSuccess, onError, onSettled } = options;

  const [data, setData] = useState<T | undefined>(initialData);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<E | null>(null);

  // 追踪是否已挂载
  const mountedRef = useRef(true);

  const isSuccess = data !== undefined && error === null;
  const isError = error !== null;

  const execute = useCallback(
    async (params?: P): Promise<T | undefined> => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await asyncFn(params);

        // 防止组件卸载后更新状态
        if (!mountedRef.current) return undefined;

        setData(result);
        onSuccess?.(result);
        return result;
      } catch (err) {
        if (!mountedRef.current) return undefined;

        const errorValue = (
          err instanceof Error ? err.message : String(err)
        ) as E;
        setError(errorValue);
        onError?.(errorValue);
        return undefined;
      } finally {
        if (mountedRef.current) {
          setIsLoading(false);
          onSettled?.();
        }
      }
    },
    [asyncFn, onSuccess, onError, onSettled]
  );

  const reset = useCallback(() => {
    setData(initialData);
    setError(null);
    setIsLoading(false);
  }, [initialData]);

  return {
    data,
    isLoading,
    error,
    isSuccess,
    isError,
    execute,
    reset,
    setData,
    setError,
  };
}

/**
 * 带取消支持的异步操作 Hook
 */
export function useAsyncOperationWithCancel<T, P = void, E = string>(
  asyncFn: (params?: P, signal?: AbortSignal) => Promise<T>,
  options: AsyncOperationOptions<T, E> = {}
): AsyncOperationResult<T, P, E> & { cancel: () => void } {
  const abortRef = useRef<AbortController | null>(null);

  const wrappedAsyncFn = useCallback(
    async (params?: P): Promise<T> => {
      // 取消之前的请求
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      return asyncFn(params, abortRef.current.signal);
    },
    [asyncFn]
  );

  const result = useAsyncOperation(wrappedAsyncFn, options);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  return { ...result, cancel };
}

/**
 * 带重试的异步操作 Hook
 */
export interface RetryOptions {
  /** 最大重试次数 */
  maxRetries?: number;
  /** 初始重试延迟 (毫秒) */
  initialDelay?: number;
  /** 最大重试延迟 (毫秒) */
  maxDelay?: number;
  /** 退避因子 */
  backoffFactor?: number;
  /** 是否添加随机抖动 */
  jitter?: boolean;
}

export function useAsyncOperationWithRetry<T, P = void, E = string>(
  asyncFn: (params?: P) => Promise<T>,
  options: AsyncOperationOptions<T, E> & RetryOptions = {}
): AsyncOperationResult<T, P, E> & { retryCount: number } {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    backoffFactor = 2,
    jitter = true,
    ...baseOptions
  } = options;

  const retryCountRef = useRef(0);
  const [retryCount, setRetryCount] = useState(0);

  const calculateDelay = useCallback(
    (attempt: number): number => {
      // 指数退避
      let delay = Math.min(
        initialDelay * Math.pow(backoffFactor, attempt),
        maxDelay
      );

      // 添加随机抖动 (±25%)
      if (jitter) {
        const jitterRange = delay * 0.25;
        delay += Math.random() * jitterRange * 2 - jitterRange;
      }

      return Math.floor(delay);
    },
    [initialDelay, maxDelay, backoffFactor, jitter]
  );

  const wrappedAsyncFn = useCallback(
    async (params?: P): Promise<T> => {
      retryCountRef.current = 0;

      const attempt = async (): Promise<T> => {
        try {
          const result = await asyncFn(params);
          retryCountRef.current = 0;
          setRetryCount(0);
          return result;
        } catch (err) {
          retryCountRef.current++;
          setRetryCount(retryCountRef.current);

          if (retryCountRef.current <= maxRetries) {
            const delay = calculateDelay(retryCountRef.current - 1);
            await new Promise((resolve) => setTimeout(resolve, delay));
            return attempt();
          }

          throw err;
        }
      };

      return attempt();
    },
    [asyncFn, maxRetries, calculateDelay]
  );

  const result = useAsyncOperation(wrappedAsyncFn, baseOptions);

  return { ...result, retryCount };
}

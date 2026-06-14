/**
 * useAsyncState - 通用异步状态管理 Hook
 *
 * 解决的问题：
 * - 各 Store 中重复的 isLoading、error 状态
 * - 缺乏统一的错误处理
 * - 数据加载模式不一致
 *
 * 使用场景：
 * - 替代 Store 中重复的 loading/error 状态
 * - 统一的异步操作包装
 * - 自动错误分类和处理
 */

import { useState, useCallback, useRef } from 'react';

/**
 * 异步状态
 */
export interface AsyncState<T> {
  data: T | undefined;
  isLoading: boolean;
  error: string | null;
  isSuccess: boolean;
  isError: boolean;
}

/**
 * 异步操作选项
 */
export interface AsyncOptions<T> {
  onSuccess?: (data: T) => void;
  onError?: (error: string) => void;
  onSettled?: () => void;
}

/**
 * 基础异步状态 Hook
 */
export function useAsyncState<T>(initialData?: T) {
  const [data, setData] = useState<T | undefined>(initialData);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSuccess = data !== undefined && !error;
  const isError = error !== null;

  /**
   * 执行异步操作
   */
  const execute = useCallback(
    async (
      asyncFn: () => Promise<T>,
      options?: AsyncOptions<T>
    ): Promise<T | undefined> => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await asyncFn();
        setData(result);
        options?.onSuccess?.(result);
        return result;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError(errorMessage);
        options?.onError?.(errorMessage);
        return undefined;
      } finally {
        setIsLoading(false);
        options?.onSettled?.();
      }
    },
    []
  );

  /**
   * 重置状态
   */
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
 * 带重试的异步状态 Hook
 */
export function useAsyncStateWithRetry<T>(
  initialData?: T,
  maxRetries = 3,
  retryDelay = 1000
) {
  const baseState = useAsyncState<T>(initialData);
  const retryCountRef = useRef(0);

  const executeWithRetry = useCallback(
    async (
      asyncFn: () => Promise<T>,
      options?: AsyncOptions<T>
    ): Promise<T | undefined> => {
      retryCountRef.current = 0;

      const attempt = async (): Promise<T | undefined> => {
        try {
          const result = await baseState.execute(asyncFn);
          if (result !== undefined) {
            retryCountRef.current = 0;
            return result;
          }
          throw new Error('Operation failed');
        } catch (err) {
          retryCountRef.current++;

          if (retryCountRef.current < maxRetries) {
            await new Promise((resolve) =>
              setTimeout(resolve, retryDelay * retryCountRef.current)
            );
            return attempt();
          }

          const errorMessage = err instanceof Error ? err.message : String(err);
          options?.onError?.(errorMessage);
          return undefined;
        }
      };

      return attempt();
    },
    [baseState, maxRetries, retryDelay]
  );

  return {
    ...baseState,
    execute: executeWithRetry,
    retryCount: retryCountRef.current,
  };
}

/**
 * 数组数据的异步状态 Hook（带去重）
 */
export function useAsyncArrayState<T extends { _id: string }>(
  initialData: T[] = []
) {
  const [items, setItems] = useState<T[]>(initialData);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * 去重添加项目
   */
  const addItem = useCallback((item: T) => {
    setItems((prev) => {
      const exists = prev.some((p) => p._id === item._id);
      if (exists) return prev;
      return [...prev, item];
    });
  }, []);

  /**
   * 批量去重添加项目
   */
  const addItems = useCallback((newItems: T[]) => {
    setItems((prev) => {
      const existingIds = new Set(prev.map((p) => p._id));
      const uniqueNew = newItems.filter((item) => !existingIds.has(item._id));
      if (uniqueNew.length === 0) return prev;
      return [...prev, ...uniqueNew];
    });
  }, []);

  /**
   * 移除项目
   */
  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item._id !== id));
  }, []);

  /**
   * 更新项目
   */
  const updateItem = useCallback((id: string, updates: Partial<T>) => {
    setItems((prev) =>
      prev.map((item) => (item._id === id ? { ...item, ...updates } : item))
    );
  }, []);

  /**
   * 加载数据（带去重）
   */
  const load = useCallback(
    async (asyncFn: () => Promise<T[]>, options?: AsyncOptions<T[]>) => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await asyncFn();
        // 去重后设置
        const uniqueItems = result.reduce((acc, item) => {
          if (!acc.some((a) => a._id === item._id)) {
            acc.push(item);
          }
          return acc;
        }, [] as T[]);
        setItems(uniqueItems);
        options?.onSuccess?.(uniqueItems);
        return uniqueItems;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError(errorMessage);
        options?.onError?.(errorMessage);
        return undefined;
      } finally {
        setIsLoading(false);
        options?.onSettled?.();
      }
    },
    []
  );

  /**
   * 重置
   */
  const reset = useCallback(() => {
    setItems(initialData);
    setError(null);
    setIsLoading(false);
  }, [initialData]);

  return {
    items,
    isLoading,
    error,
    isEmpty: items.length === 0,
    count: items.length,
    addItem,
    addItems,
    removeItem,
    updateItem,
    load,
    reset,
    setItems,
  };
}

/**
 * 创建 Zustand store 的异步状态 slice
 *
 * 用于在 Zustand store 中统一管理异步状态
 */
export interface AsyncSliceState {
  isLoading: boolean;
  error: string | null;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
}

export function createAsyncSlice(
  set: (fn: (state: AsyncSliceState) => Partial<AsyncSliceState>) => void
): AsyncSliceState {
  return {
    isLoading: false,
    error: null,
    setLoading: (loading: boolean) => set(() => ({ isLoading: loading })),
    setError: (error: string | null) => set(() => ({ error })),
    clearError: () => set(() => ({ error: null })),
  };
}

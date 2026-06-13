/**
 * useApi - 通用 API 调用 Hook (重构版)
 *
 * 基于 useAsyncOperation 构建，提供：
 * 1. 自动加载状态管理 (继承自基础 hook)
 * 2. 错误处理 (继承自基础 hook)
 * 3. LRU 缓存 (使用新的缓存实现)
 * 4. 请求去重 (AbortController)
 *
 * 符合 DRY 原则：复用 useAsyncOperation 的状态管理逻辑
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { apiClient, ApiError } from '@/lib/api/client';
import { apiCache } from '@/lib/cache';

// ==================== 类型定义 ====================

export interface UseApiOptions<T> {
  /** 初始数据 */
  initialData?: T;
  /** 是否立即执行 */
  immediate?: boolean;
  /** 依赖项（变化时重新请求） */
  deps?: unknown[];
  /** 缓存键 */
  cacheKey?: string;
  /** 缓存时间（毫秒），默认 5 分钟 */
  cacheTTL?: number;
  /** 错误回调 */
  onError?: (error: ApiError) => void;
  /** 成功回调 */
  onSuccess?: (data: T) => void;
}

export interface UseApiGetResult<T> {
  data: T | undefined;
  loading: boolean;
  error: ApiError | null;
  execute: () => Promise<T | undefined>;
  /** Force refresh bypassing cache */
  refresh: () => Promise<T | undefined>;
  reset: () => void;
  setData: (data: T | undefined) => void;
}

export interface UseApiResult<T, P = void> {
  data: T | undefined;
  loading: boolean;
  error: ApiError | null;
  execute: (params?: P) => Promise<T | undefined>;
  /** Force refresh bypassing cache (no-op for mutations) */
  refresh: () => Promise<T | undefined>;
  reset: () => void;
  setData: (data: T | undefined) => void;
}

// ==================== GET Hook ====================

/**
 * GET 请求 Hook
 */
export function useApiGet<T>(
  path: string,
  options: UseApiOptions<T> = {}
): UseApiGetResult<T> {
  const {
    initialData,
    immediate = true,
    deps = [],
    cacheKey,
    cacheTTL = 5 * 60 * 1000,
    onError,
    onSuccess,
  } = options;

  const [data, setData] = useState<T | undefined>(initialData);
  const [loading, setLoading] = useState(immediate);
  const [error, setError] = useState<ApiError | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Internal fetch function that supports skipCache
  const fetchData = useCallback(
    async (skipCache = false) => {
      // Don't fetch if path is empty
      if (!path) {
        setLoading(false);
        return undefined;
      }

      // 检查 LRU 缓存 (除非强制刷新)
      if (cacheKey && !skipCache) {
        const cached = apiCache.get(cacheKey) as T | undefined;
        if (cached !== undefined) {
          setData(cached);
          setLoading(false);
          return cached;
        }
      }

      // 取消之前的请求
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      setLoading(true);
      setError(null);

      try {
        const result = await apiClient.get<T>(path, {
          signal: abortRef.current.signal,
        });
        setData(result);

        // 更新 LRU 缓存
        if (cacheKey) {
          apiCache.set(cacheKey, result, cacheTTL);
        }

        onSuccess?.(result);
        return result;
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          return;
        }
        const apiError = err as ApiError;
        setError(apiError);
        onError?.(apiError);
        return undefined;
      } finally {
        setLoading(false);
      }
    },
    [path, cacheKey, cacheTTL, onError, onSuccess]
  );

  // Public execute function (uses cache)
  const execute = useCallback(() => fetchData(false), [fetchData]);

  // Force refresh that bypasses cache
  const refresh = useCallback(() => fetchData(true), [fetchData]);

  const reset = useCallback(() => {
    setData(initialData);
    setError(null);
    setLoading(false);
  }, [initialData]);

  // 自动执行
  useEffect(() => {
    if (immediate) {
      fetchData(false);
    }
    return () => {
      abortRef.current?.abort();
    };
  }, [immediate, fetchData, ...deps]);

  return { data, loading, error, execute, refresh, reset, setData };
}

// ==================== Mutation Hooks ====================

/**
 * 通用 Mutation Hook 基础实现
 */
function useMutationBase<T, P = unknown>(
  method: 'post' | 'put' | 'patch' | 'delete',
  path: string,
  options: Omit<UseApiOptions<T>, 'immediate' | 'deps'> = {}
): UseApiResult<T, P> {
  const { initialData, onError, onSuccess } = options;

  const [data, setData] = useState<T | undefined>(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const execute = useCallback(
    async (params?: P) => {
      setLoading(true);
      setError(null);

      try {
        let result: T;
        switch (method) {
          case 'post':
            result = await apiClient.post<T>(path, params);
            break;
          case 'put':
            result = await apiClient.put<T>(path, params);
            break;
          case 'patch':
            result = await apiClient.patch<T>(path, params);
            break;
          case 'delete':
            result = await apiClient.delete<T>(path);
            break;
        }
        setData(result);
        onSuccess?.(result);
        return result;
      } catch (err) {
        const apiError = err as ApiError;
        setError(apiError);
        onError?.(apiError);
        return undefined;
      } finally {
        setLoading(false);
      }
    },
    [method, path, onError, onSuccess]
  );

  const reset = useCallback(() => {
    setData(initialData);
    setError(null);
    setLoading(false);
  }, [initialData]);

  // Mutations don't have cache, refresh is same as execute without params
  const refresh = useCallback(() => execute(), [execute]);

  return { data, loading, error, execute, refresh, reset, setData };
}

/**
 * POST 请求 Hook
 */
export function useApiPost<T, P = unknown>(
  path: string,
  options: Omit<UseApiOptions<T>, 'immediate' | 'deps'> = {}
): UseApiResult<T, P> {
  return useMutationBase<T, P>('post', path, options);
}

/**
 * PUT 请求 Hook
 */
export function useApiPut<T, P = unknown>(
  path: string,
  options: Omit<UseApiOptions<T>, 'immediate' | 'deps'> = {}
): UseApiResult<T, P> {
  return useMutationBase<T, P>('put', path, options);
}

/**
 * DELETE 请求 Hook
 */
export function useApiDelete<T, P = void>(
  path: string,
  options: Omit<UseApiOptions<T>, 'immediate' | 'deps'> = {}
): UseApiResult<T, P> {
  return useMutationBase<T, P>('delete', path, options);
}

/**
 * 通用 Mutation Hook (POST/PUT/PATCH/DELETE)
 */
export function useApiMutation<T, P = unknown>(
  method: 'post' | 'put' | 'patch' | 'delete',
  path: string,
  options: Omit<UseApiOptions<T>, 'immediate' | 'deps'> = {}
): UseApiResult<T, P> {
  return useMutationBase<T, P>(method, path, options);
}

// ==================== 缓存管理 ====================

/**
 * 使缓存失效
 */
export function invalidateCache(cacheKey: string): void {
  apiCache.delete(cacheKey);
}

/**
 * 使匹配的缓存失效
 */
export function invalidateCacheByPattern(pattern: string | RegExp): void {
  const keys = apiCache.keys();
  const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;

  for (const key of keys) {
    if (regex.test(key)) {
      apiCache.delete(key);
    }
  }
}

/**
 * 清空所有缓存
 */
export function clearApiCache(): void {
  apiCache.clear();
}

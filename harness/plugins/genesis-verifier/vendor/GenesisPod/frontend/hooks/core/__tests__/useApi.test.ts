import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useApiGet,
  useApiPost,
  useApiPut,
  useApiDelete,
  useApiMutation,
  invalidateCache,
  invalidateCacheByPattern,
  clearApiCache,
} from '../useApi';
import { apiClient, ApiError } from '@/lib/api/client';
import { apiCache } from '@/lib/cache';

// Mock the apiClient
vi.mock('@/lib/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: Error,
}));

// Mock the cache
vi.mock('@/lib/cache', () => ({
  apiCache: {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    keys: vi.fn(),
    clear: vi.fn(),
  },
}));

describe('useApiGet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiCache.get).mockReturnValue(undefined);
    vi.mocked(apiCache.keys).mockReturnValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with loading state when immediate is true', () => {
    // Use a never-resolving promise so the fetch doesn't complete during this sync test,
    // which would trigger a state update outside act().
    vi.mocked(apiClient.get).mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useApiGet('/api/test'));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeNull();
  });

  it('should not immediately fetch when immediate is false', async () => {
    const { result } = renderHook(() =>
      useApiGet('/api/test', { immediate: false })
    );

    expect(result.current.loading).toBe(false);
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it('should fetch data successfully', async () => {
    const mockData = { id: 1, name: 'Test' };
    vi.mocked(apiClient.get).mockResolvedValue(mockData);

    const { result } = renderHook(() =>
      useApiGet('/api/test', { immediate: false })
    );

    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.data).toEqual(mockData);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should handle errors correctly', async () => {
    const mockError: ApiError = {
      message: 'Not found',
      status: 404,
      code: 'NOT_FOUND',
    };
    vi.mocked(apiClient.get).mockRejectedValue(mockError);
    const onError = vi.fn();

    const { result } = renderHook(() =>
      useApiGet('/api/test', { immediate: false, onError })
    );

    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.error).toEqual(mockError);
    expect(result.current.loading).toBe(false);
    expect(onError).toHaveBeenCalledWith(mockError);
  });

  it('should call onSuccess callback when successful', async () => {
    const mockData = { id: 1 };
    vi.mocked(apiClient.get).mockResolvedValue(mockData);
    const onSuccess = vi.fn();

    const { result } = renderHook(() =>
      useApiGet('/api/test', { immediate: false, onSuccess })
    );

    await act(async () => {
      await result.current.execute();
    });

    expect(onSuccess).toHaveBeenCalledWith(mockData);
  });

  it('should use cached data when available', async () => {
    const cachedData = { id: 1, cached: true };
    vi.mocked(apiCache.get).mockReturnValue(cachedData);

    const { result } = renderHook(() =>
      useApiGet('/api/test', { immediate: false, cacheKey: 'test-key' })
    );

    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.data).toEqual(cachedData);
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it('should update cache after successful fetch', async () => {
    const mockData = { id: 1 };
    vi.mocked(apiClient.get).mockResolvedValue(mockData);
    vi.mocked(apiCache.get).mockReturnValue(undefined);

    const { result } = renderHook(() =>
      useApiGet('/api/test', { immediate: false, cacheKey: 'test-key' })
    );

    await act(async () => {
      await result.current.execute();
    });

    expect(apiCache.set).toHaveBeenCalledWith(
      'test-key',
      mockData,
      expect.any(Number)
    );
  });

  it('should reset state correctly', async () => {
    const initialData = { initial: true };
    const mockData = { fetched: true };
    vi.mocked(apiClient.get).mockResolvedValue(mockData);

    const { result } = renderHook(() =>
      useApiGet('/api/test', { immediate: false, initialData })
    );

    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.data).toEqual(mockData);

    act(() => {
      result.current.reset();
    });

    expect(result.current.data).toEqual(initialData);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('should allow manual data setting', () => {
    const { result } = renderHook(() =>
      useApiGet('/api/test', { immediate: false })
    );

    act(() => {
      result.current.setData({ manual: true });
    });

    expect(result.current.data).toEqual({ manual: true });
  });

  it('should handle AbortError gracefully', async () => {
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';
    vi.mocked(apiClient.get).mockRejectedValue(abortError);

    const { result } = renderHook(() =>
      useApiGet('/api/test', { immediate: false })
    );

    await act(async () => {
      await result.current.execute();
    });

    // AbortError should not set error state
    expect(result.current.error).toBeNull();
  });
});

describe('useApiPost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should not execute immediately', () => {
    const { result } = renderHook(() => useApiPost('/api/test'));

    expect(result.current.loading).toBe(false);
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('should execute POST request with params', async () => {
    const mockResponse = { success: true };
    const params = { name: 'Test' };
    vi.mocked(apiClient.post).mockResolvedValue(mockResponse);

    const { result } = renderHook(() =>
      useApiPost<typeof mockResponse, typeof params>('/api/test')
    );

    await act(async () => {
      await result.current.execute(params);
    });

    expect(apiClient.post).toHaveBeenCalledWith('/api/test', params);
    expect(result.current.data).toEqual(mockResponse);
  });

  it('should handle POST errors', async () => {
    const mockError: ApiError = { message: 'Bad request', status: 400 };
    vi.mocked(apiClient.post).mockRejectedValue(mockError);

    const { result } = renderHook(() => useApiPost('/api/test'));

    await act(async () => {
      await result.current.execute({ data: 'test' });
    });

    expect(result.current.error).toEqual(mockError);
  });
});

describe('useApiPut', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should execute PUT request', async () => {
    const mockResponse = { updated: true };
    vi.mocked(apiClient.put).mockResolvedValue(mockResponse);

    const { result } = renderHook(() => useApiPut('/api/test/1'));

    await act(async () => {
      await result.current.execute({ name: 'Updated' });
    });

    expect(apiClient.put).toHaveBeenCalledWith('/api/test/1', {
      name: 'Updated',
    });
    expect(result.current.data).toEqual(mockResponse);
  });
});

describe('useApiDelete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should execute DELETE request', async () => {
    const mockResponse = { deleted: true };
    vi.mocked(apiClient.delete).mockResolvedValue(mockResponse);

    const { result } = renderHook(() => useApiDelete('/api/test/1'));

    await act(async () => {
      await result.current.execute();
    });

    expect(apiClient.delete).toHaveBeenCalledWith('/api/test/1');
    expect(result.current.data).toEqual(mockResponse);
  });
});

describe('useApiMutation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should execute PATCH request', async () => {
    const mockResponse = { patched: true };
    vi.mocked(apiClient.patch).mockResolvedValue(mockResponse);

    const { result } = renderHook(() => useApiMutation('patch', '/api/test/1'));

    await act(async () => {
      await result.current.execute({ field: 'value' });
    });

    expect(apiClient.patch).toHaveBeenCalledWith('/api/test/1', {
      field: 'value',
    });
    expect(result.current.data).toEqual(mockResponse);
  });

  it('should call onSuccess and onError callbacks', async () => {
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const mockError: ApiError = { message: 'Error', status: 500 };
    vi.mocked(apiClient.post).mockRejectedValue(mockError);

    const { result } = renderHook(() =>
      useApiMutation('post', '/api/test', { onError, onSuccess })
    );

    await act(async () => {
      await result.current.execute({});
    });

    expect(onError).toHaveBeenCalledWith(mockError);
    expect(onSuccess).not.toHaveBeenCalled();
  });
});

describe('Cache Management Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invalidateCache should delete specific key', () => {
    invalidateCache('test-key');
    expect(apiCache.delete).toHaveBeenCalledWith('test-key');
  });

  it('invalidateCacheByPattern should delete matching keys', () => {
    vi.mocked(apiCache.keys).mockReturnValue(['users-1', 'users-2', 'posts-1']);

    invalidateCacheByPattern(/users/);

    expect(apiCache.delete).toHaveBeenCalledWith('users-1');
    expect(apiCache.delete).toHaveBeenCalledWith('users-2');
    expect(apiCache.delete).not.toHaveBeenCalledWith('posts-1');
  });

  it('invalidateCacheByPattern should work with string pattern', () => {
    vi.mocked(apiCache.keys).mockReturnValue(['api-users', 'api-posts']);

    invalidateCacheByPattern('api-');

    expect(apiCache.delete).toHaveBeenCalledWith('api-users');
    expect(apiCache.delete).toHaveBeenCalledWith('api-posts');
  });

  it('clearApiCache should clear all cache', () => {
    clearApiCache();
    expect(apiCache.clear).toHaveBeenCalled();
  });
});

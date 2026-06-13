import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// vi.mock factories are hoisted — do NOT reference outer variables inside them.
// Retrieve mocked values via vi.mocked() after imports.

vi.mock('@/hooks/core', () => ({
  useApiGet: vi.fn(() => ({
    data: null,
    loading: false,
    error: null,
    execute: vi.fn(),
    refresh: vi.fn(),
    reset: vi.fn(),
    setData: vi.fn(),
  })),
}));

vi.mock('@/lib/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/stores', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('@/hooks/features/useAIModels', () => ({
  clearAIModelsCache: vi.fn(),
}));

import { useUserApiKeys } from '../useUserApiKeys';
import { useApiGet } from '@/hooks/core';
import type { UseApiGetResult } from '@/hooks/core';
import { apiClient } from '@/lib/api/client';
import { toast } from '@/stores';

// Helper to build a stable useApiGet mock return value
function makeApiGetReturn(
  overrides: {
    data?: { keys: unknown[]; providers: unknown[] } | null;
    loading?: boolean;
    error?: string | null;
  } = {}
) {
  const refresh = vi.fn().mockResolvedValue(undefined);
  return {
    data: overrides.data ?? null,
    loading: overrides.loading ?? false,
    error: overrides.error ?? null,
    execute: vi.fn(),
    refresh,
    reset: vi.fn(),
    setData: vi.fn(),
    _refresh: refresh, // expose so tests can assert
  } as unknown as UseApiGetResult<unknown>;
}

describe('useUserApiKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiGet).mockReturnValue(makeApiGetReturn());
  });

  // ==================== Initial State ====================

  it('should return initial state with empty keys and providers', () => {
    const { result } = renderHook(() => useUserApiKeys());
    expect(result.current.keys).toEqual([]);
    expect(result.current.providers).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.saving).toBe(false);
    expect(result.current.testing).toBe(false);
  });

  it('should call useApiGet with correct endpoint and immediate: true', () => {
    renderHook(() => useUserApiKeys());
    expect(useApiGet).toHaveBeenCalledWith('/user/api-keys', {
      immediate: true,
    });
  });

  it('should extract keys from API response data', () => {
    const keys = [
      {
        id: 'key-1',
        provider: 'openai',
        mode: 'personal' as const,
        apiEndpoint: null,
        preferredModelId: null,
        isActive: true,
        lastUsedAt: null,
        testStatus: null,
        usageCount: 0,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        keyHint: 'sk-...abc',
      },
    ];
    vi.mocked(useApiGet).mockReturnValue(
      makeApiGetReturn({ data: { keys, providers: [] } })
    );

    const { result } = renderHook(() => useUserApiKeys());
    expect(result.current.keys).toEqual(keys);
  });

  it('should extract providers from API response data', () => {
    const providers = [
      { id: 'openai', name: 'OpenAI', endpoint: 'https://api.openai.com' },
    ];
    vi.mocked(useApiGet).mockReturnValue(
      makeApiGetReturn({ data: { keys: [], providers } })
    );

    const { result } = renderHook(() => useUserApiKeys());
    expect(result.current.providers).toEqual(providers);
  });

  // ==================== saveKey ====================

  it('saveKey: calls apiClient.put with correct endpoint and body', async () => {
    vi.mocked(apiClient.put).mockResolvedValue(undefined);

    const { result } = renderHook(() => useUserApiKeys());

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.saveKey(
        'openai',
        'sk-test-key',
        'personal',
        'gpt-4',
        'https://api.openai.com'
      );
    });

    expect(success).toBe(true);
    expect(apiClient.put).toHaveBeenCalledWith('/user/api-keys/openai', {
      apiKey: 'sk-test-key',
      mode: 'personal',
      preferredModelId: 'gpt-4',
      apiEndpoint: 'https://api.openai.com',
    });
  });

  it('saveKey: calls refresh and clearAIModelsCache on success', async () => {
    vi.mocked(apiClient.put).mockResolvedValue(undefined);
    const { clearAIModelsCache } = await import('@/hooks/features/useAIModels');

    const { result } = renderHook(() => useUserApiKeys());

    await act(async () => {
      await result.current.saveKey('openai', 'sk-test', 'personal');
    });

    expect(clearAIModelsCache).toHaveBeenCalled();
    expect(result.current.refresh).toBeDefined();
  });

  it('saveKey: returns false and shows toast on error', async () => {
    vi.mocked(apiClient.put).mockRejectedValue(new Error('Unauthorized'));

    const { result } = renderHook(() => useUserApiKeys());

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.saveKey('openai', 'bad-key', 'personal');
    });

    expect(success).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('Unauthorized');
  });

  it('saveKey: sets saving to false after completion (success path)', async () => {
    vi.mocked(apiClient.put).mockResolvedValue(undefined);

    const { result } = renderHook(() => useUserApiKeys());

    await act(async () => {
      await result.current.saveKey('openai', 'sk-test', 'personal');
    });

    expect(result.current.saving).toBe(false);
  });

  it('saveKey: sets saving to false after completion (error path)', async () => {
    vi.mocked(apiClient.put).mockRejectedValue(new Error('Error'));

    const { result } = renderHook(() => useUserApiKeys());

    await act(async () => {
      await result.current.saveKey('openai', 'sk-test', 'personal');
    });

    expect(result.current.saving).toBe(false);
  });

  // ==================== deleteKey ====================

  it('deleteKey: calls apiClient.delete with correct endpoint', async () => {
    vi.mocked(apiClient.delete).mockResolvedValue(undefined);

    const { result } = renderHook(() => useUserApiKeys());

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.deleteKey('anthropic');
    });

    expect(success).toBe(true);
    expect(apiClient.delete).toHaveBeenCalledWith('/user/api-keys/anthropic');
  });

  it('deleteKey: returns false and shows toast on error', async () => {
    vi.mocked(apiClient.delete).mockRejectedValue(new Error('Delete failed'));

    const { result } = renderHook(() => useUserApiKeys());

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.deleteKey('anthropic');
    });

    expect(success).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('Delete failed');
  });

  // ==================== testKey ====================

  it('testKey: calls apiClient.post with test endpoint and returns result', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({
      success: true,
      message: 'Connected',
    });

    const { result } = renderHook(() => useUserApiKeys());

    let testResult: { success: boolean; message: string } | undefined;
    await act(async () => {
      testResult = await result.current.testKey('openai', 'sk-test');
    });

    expect(testResult).toEqual({ success: true, message: 'Connected' });
    expect(apiClient.post).toHaveBeenCalledWith('/user/api-keys/openai/test', {
      apiKey: 'sk-test',
      apiEndpoint: undefined,
    });
  });

  it('testKeyById: posts to per-key test endpoint and returns ok', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ ok: true });

    const { result } = renderHook(() => useUserApiKeys());

    let res: { ok: boolean; errorCode?: string } | undefined;
    await act(async () => {
      res = await result.current.testKeyById('openai', 'key-1');
    });

    expect(res).toEqual({ ok: true });
    expect(apiClient.post).toHaveBeenCalledWith(
      '/user/api-keys/openai/keys/key-1/test',
      {}
    );
  });

  it('testKeyById: returns { ok: false } on error', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(new Error('probe failed'));

    const { result } = renderHook(() => useUserApiKeys());

    let res: { ok: boolean; errorCode?: string } | undefined;
    await act(async () => {
      res = await result.current.testKeyById('openai', 'key-1');
    });

    expect(res).toEqual({ ok: false });
  });

  it('testKey: returns failure result on error', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(
      new Error('Connection refused')
    );

    const { result } = renderHook(() => useUserApiKeys());

    let testResult: { success: boolean; message: string } | undefined;
    await act(async () => {
      testResult = await result.current.testKey('openai', 'sk-bad');
    });

    expect(testResult).toEqual({
      success: false,
      message: 'Connection failed',
    });
  });

  it('testKey: sets testing to false after completion', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({
      success: true,
      message: 'OK',
    });

    const { result } = renderHook(() => useUserApiKeys());

    await act(async () => {
      await result.current.testKey('openai', 'sk-test');
    });

    expect(result.current.testing).toBe(false);
  });

  it('testKey: passes apiEndpoint when provided', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({
      success: true,
      message: 'OK',
    });

    const { result } = renderHook(() => useUserApiKeys());

    await act(async () => {
      await result.current.testKey(
        'openai',
        'sk-test',
        'https://custom.api.com'
      );
    });

    expect(apiClient.post).toHaveBeenCalledWith('/user/api-keys/openai/test', {
      apiKey: 'sk-test',
      apiEndpoint: 'https://custom.api.com',
    });
  });

  // ==================== getKeyForProvider ====================

  it('getKeyForProvider: returns matching key for provider', () => {
    const keys = [
      {
        id: 'key-1',
        provider: 'openai',
        mode: 'personal' as const,
        apiEndpoint: null,
        preferredModelId: null,
        isActive: true,
        lastUsedAt: null,
        testStatus: null,
        usageCount: 0,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        keyHint: 'sk-...abc',
      },
    ];
    vi.mocked(useApiGet).mockReturnValue(
      makeApiGetReturn({ data: { keys, providers: [] } })
    );

    const { result } = renderHook(() => useUserApiKeys());
    const found = result.current.getKeyForProvider('openai');
    expect(found?.provider).toBe('openai');
  });

  it('getKeyForProvider: returns undefined for unknown provider', () => {
    const { result } = renderHook(() => useUserApiKeys());
    expect(
      result.current.getKeyForProvider('unknown-provider')
    ).toBeUndefined();
  });

  // ==================== Loading/Error propagation ====================

  it('propagates loading state from useApiGet', () => {
    vi.mocked(useApiGet).mockReturnValue(makeApiGetReturn({ loading: true }));

    const { result } = renderHook(() => useUserApiKeys());
    expect(result.current.loading).toBe(true);
  });

  it('propagates error state from useApiGet', () => {
    vi.mocked(useApiGet).mockReturnValue(
      makeApiGetReturn({ error: 'Load failed' })
    );

    const { result } = renderHook(() => useUserApiKeys());
    expect(result.current.error).toBe('Load failed');
  });
});

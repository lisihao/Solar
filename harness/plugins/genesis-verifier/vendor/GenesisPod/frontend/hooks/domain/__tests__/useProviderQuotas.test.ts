import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock dependencies used by useProviderQuotas
vi.mock('@/lib/utils/config', () => ({
  config: {
    apiUrl: 'https://api.example.com',
  },
}));

vi.mock('@/lib/utils/auth', () => ({
  getAuthHeader: vi.fn(() => ({ Authorization: 'Bearer test-token' })),
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { useProviderQuotas, type ProviderQuota } from '../useProviderQuotas';

const makeQuota = (
  provider: string,
  overrides: Partial<ProviderQuota> = {}
): ProviderQuota => ({
  provider,
  providerDisplayName: provider.charAt(0).toUpperCase() + provider.slice(1),
  providerIcon: `${provider}-icon`,
  quotaType: 'tokens',
  usage: 1000,
  limit: 10000,
  remaining: 9000,
  usagePercentage: 10,
  unit: 'tokens',
  period: 'monthly',
  status: 'normal',
  statusMessage: 'Normal usage',
  lastUpdated: '2026-01-01T00:00:00Z',
  dataSource: 'api',
  consoleUrl: `https://${provider}.com`,
  ...overrides,
});

describe('useProviderQuotas', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty quotas and loading:false in initial state', () => {
    const { result } = renderHook(() => useProviderQuotas());
    expect(result.current.quotas).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.refreshing).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.lastUpdated).toBeNull();
  });

  it('fetchQuotas sets loading=true while in progress', async () => {
    let resolveQuota: (v: unknown) => void;
    const promise = new Promise((res) => {
      resolveQuota = res;
    });
    fetchMock.mockReturnValue(promise);

    const { result } = renderHook(() => useProviderQuotas());
    act(() => {
      void result.current.fetchQuotas();
    });
    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolveQuota!({
        ok: true,
        json: vi.fn().mockResolvedValue({ quotas: [], lastUpdated: null }),
      });
      await promise;
    });
    expect(result.current.loading).toBe(false);
  });

  it('fetchQuotas populates quotas on success', async () => {
    const mockQuotas = [makeQuota('openai'), makeQuota('anthropic')];
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        quotas: mockQuotas,
        lastUpdated: '2026-01-01T00:00:00Z',
      }),
    });

    const { result } = renderHook(() => useProviderQuotas());
    await act(async () => {
      await result.current.fetchQuotas();
    });
    expect(result.current.quotas).toEqual(mockQuotas);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('fetchQuotas handles wrapped response { success, data }', async () => {
    const mockQuotas = [makeQuota('openai')];
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        success: true,
        data: { quotas: mockQuotas, lastUpdated: '2026-01-01T00:00:00Z' },
      }),
    });

    const { result } = renderHook(() => useProviderQuotas());
    await act(async () => {
      await result.current.fetchQuotas();
    });
    expect(result.current.quotas).toEqual(mockQuotas);
  });

  it('fetchQuotas sets lastUpdated when API provides it', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi
        .fn()
        .mockResolvedValue({ quotas: [], lastUpdated: '2026-02-01T00:00:00Z' }),
    });

    const { result } = renderHook(() => useProviderQuotas());
    await act(async () => {
      await result.current.fetchQuotas();
    });
    expect(result.current.lastUpdated).toBeInstanceOf(Date);
    expect(result.current.lastUpdated?.toISOString()).toContain('2026-02-01');
  });

  it('fetchQuotas sets error on network failure', async () => {
    fetchMock.mockRejectedValue(new Error('Network failure'));

    const { result } = renderHook(() => useProviderQuotas());
    await act(async () => {
      await result.current.fetchQuotas();
    });
    expect(result.current.error).toBe('Network failure');
    expect(result.current.loading).toBe(false);
  });

  it('fetchQuotas sets error message for 401 response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 });

    const { result } = renderHook(() => useProviderQuotas());
    await act(async () => {
      await result.current.fetchQuotas();
    });
    expect(result.current.error).toBe('需要管理员权限');
  });

  it('fetchQuotas sets error message for 403 response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403 });

    const { result } = renderHook(() => useProviderQuotas());
    await act(async () => {
      await result.current.fetchQuotas();
    });
    expect(result.current.error).toBe('需要管理员权限');
  });

  it('fetchQuotas sets generic error for non-401/403 failures', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    const { result } = renderHook(() => useProviderQuotas());
    await act(async () => {
      await result.current.fetchQuotas();
    });
    expect(result.current.error).toBe('获取配额信息失败');
  });

  it('fetchQuotas calls the correct API endpoint', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ quotas: [], lastUpdated: null }),
    });

    const { result } = renderHook(() => useProviderQuotas());
    await act(async () => {
      await result.current.fetchQuotas();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/admin/quota/providers',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      })
    );
  });

  it('refreshQuotas sets refreshing=true while in progress', async () => {
    let resolveRefresh: (v: unknown) => void;
    const promise = new Promise((res) => {
      resolveRefresh = res;
    });
    fetchMock.mockReturnValue(promise);

    const { result } = renderHook(() => useProviderQuotas());
    act(() => {
      void result.current.refreshQuotas();
    });
    expect(result.current.refreshing).toBe(true);

    await act(async () => {
      resolveRefresh!({
        ok: true,
        json: vi.fn().mockResolvedValue({ quotas: [], lastUpdated: null }),
      });
      await promise;
    });
    expect(result.current.refreshing).toBe(false);
  });

  it('refreshQuotas POSTs to the refresh endpoint', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ quotas: [], lastUpdated: null }),
    });

    const { result } = renderHook(() => useProviderQuotas());
    await act(async () => {
      await result.current.refreshQuotas();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/admin/quota/refresh',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('refreshQuotas updates quotas after success', async () => {
    const refreshedQuotas = [makeQuota('openai', { usage: 2000 })];
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi
        .fn()
        .mockResolvedValue({ quotas: refreshedQuotas, lastUpdated: null }),
    });

    const { result } = renderHook(() => useProviderQuotas());
    await act(async () => {
      await result.current.refreshQuotas();
    });
    expect(result.current.quotas).toEqual(refreshedQuotas);
  });

  it('refreshQuotas sets error for 401', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 });

    const { result } = renderHook(() => useProviderQuotas());
    await act(async () => {
      await result.current.refreshQuotas();
    });
    expect(result.current.error).toBe('需要管理员权限');
    expect(result.current.refreshing).toBe(false);
  });

  it('refreshProviderQuota POSTs to the provider-specific refresh endpoint', async () => {
    const updatedQuota = makeQuota('openai', { usage: 3000 });
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(updatedQuota),
    });

    const { result } = renderHook(() => useProviderQuotas());
    await act(async () => {
      await result.current.refreshProviderQuota('openai');
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/admin/quota/refresh/openai',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('refreshProviderQuota updates only the matching provider in quotas', async () => {
    // First, set up two quotas via fetchQuotas
    const initialQuotas = [makeQuota('openai'), makeQuota('anthropic')];
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi
        .fn()
        .mockResolvedValue({ quotas: initialQuotas, lastUpdated: null }),
    });

    const updatedOpenai = makeQuota('openai', { usage: 9999 });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue(updatedOpenai),
    });

    const { result } = renderHook(() => useProviderQuotas());
    await act(async () => {
      await result.current.fetchQuotas();
    });
    await act(async () => {
      await result.current.refreshProviderQuota('openai');
    });

    // openai should be updated, anthropic should remain unchanged
    const openaiQuota = result.current.quotas.find(
      (q) => q.provider === 'openai'
    );
    const anthropicQuota = result.current.quotas.find(
      (q) => q.provider === 'anthropic'
    );
    expect(openaiQuota?.usage).toBe(9999);
    expect(anthropicQuota?.usage).toBe(initialQuotas[1].usage);
  });

  it('refreshProviderQuota sets error on failure', async () => {
    fetchMock.mockRejectedValue(new Error('Provider refresh failed'));

    const { result } = renderHook(() => useProviderQuotas());
    await act(async () => {
      await result.current.refreshProviderQuota('openai');
    });
    expect(result.current.error).toBe('Provider refresh failed');
  });

  it('refreshQuotas sets lastUpdated to now when API returns null lastUpdated', async () => {
    const before = new Date();
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ quotas: [], lastUpdated: null }),
    });

    const { result } = renderHook(() => useProviderQuotas());
    await act(async () => {
      await result.current.refreshQuotas();
    });
    // When lastUpdated is null in the refresh response, we set it to now
    expect(result.current.lastUpdated).toBeInstanceOf(Date);
    expect(result.current.lastUpdated!.getTime()).toBeGreaterThanOrEqual(
      before.getTime()
    );
  });

  it('clears error before a new fetchQuotas call', async () => {
    // First call produces an error
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });

    const { result } = renderHook(() => useProviderQuotas());
    await act(async () => {
      await result.current.fetchQuotas();
    });
    expect(result.current.error).toBe('获取配额信息失败');

    // Second call succeeds and clears the error
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({ quotas: [], lastUpdated: null }),
    });
    await act(async () => {
      await result.current.fetchQuotas();
    });
    expect(result.current.error).toBeNull();
  });

  it('refreshProviderQuota handles wrapped response { success, data }', async () => {
    const updatedQuota = makeQuota('openai', { usage: 5555 });
    const initialQuotas = [makeQuota('openai')];

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi
        .fn()
        .mockResolvedValue({ quotas: initialQuotas, lastUpdated: null }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({ success: true, data: updatedQuota }),
    });

    const { result } = renderHook(() => useProviderQuotas());
    await act(async () => {
      await result.current.fetchQuotas();
    });
    await act(async () => {
      await result.current.refreshProviderQuota('openai');
    });

    const openaiQuota = result.current.quotas.find(
      (q) => q.provider === 'openai'
    );
    expect(openaiQuota?.usage).toBe(5555);
  });
});

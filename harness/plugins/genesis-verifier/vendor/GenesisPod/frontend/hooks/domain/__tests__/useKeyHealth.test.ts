import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('@/hooks/core', () => ({
  useApiGet: vi.fn(),
}));

// Mock the admin types to avoid real module resolution
vi.mock('@/lib/types/admin', () => ({
  KeyHealthStatus: {},
}));

import { useApiGet } from '@/hooks/core';
import { useKeyHealth } from '../useKeyHealth';

const makeDefaultGet = (overrides = {}) => ({
  data: null,
  loading: false,
  error: null,
  execute: vi.fn(),
  refresh: vi.fn(),
  reset: vi.fn(),
  setData: vi.fn(),
  ...overrides,
});

describe('useKeyHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty keyHealth and null stats when secretName is null', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    const { result } = renderHook(() => useKeyHealth(null));
    expect(result.current.keyHealth).toEqual([]);
    expect(result.current.stats).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('returns empty keyHealth when secretName maps to no serviceId', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    const { result } = renderHook(() => useKeyHealth('unknown-service'));
    expect(result.current.keyHealth).toEqual([]);
    expect(result.current.stats).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('resolves tavily-api-key to tavily serviceId and uses correct endpoint', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    renderHook(() => useKeyHealth('tavily-api-key'));
    expect(vi.mocked(useApiGet)).toHaveBeenCalledWith(
      '/admin/ai/services/tavily/key-health',
      expect.any(Object)
    );
  });

  it('resolves serper-api-key to serper serviceId', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    renderHook(() => useKeyHealth('serper-api-key'));
    expect(vi.mocked(useApiGet)).toHaveBeenCalledWith(
      '/admin/ai/services/serper/key-health',
      expect.any(Object)
    );
  });

  it('resolves jina-api-key to jina serviceId', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    renderHook(() => useKeyHealth('jina-api-key'));
    expect(vi.mocked(useApiGet)).toHaveBeenCalledWith(
      '/admin/ai/services/jina/key-health',
      expect.any(Object)
    );
  });

  it('resolves elevenlabs-api-key to elevenlabs serviceId', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    renderHook(() => useKeyHealth('elevenlabs-api-key'));
    expect(vi.mocked(useApiGet)).toHaveBeenCalledWith(
      '/admin/ai/services/elevenlabs/key-health',
      expect.any(Object)
    );
  });

  it('resolves firecrawl-api-key to firecrawl serviceId', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    renderHook(() => useKeyHealth('firecrawl-api-key'));
    expect(vi.mocked(useApiGet)).toHaveBeenCalledWith(
      '/admin/ai/services/firecrawl/key-health',
      expect.any(Object)
    );
  });

  it('returns keyHealth data when API responds', () => {
    const mockKeyHealth = [
      {
        keyId: 'key-1',
        isHealthy: true,
        lastChecked: '2026-01-01',
        errorMessage: null,
      },
      {
        keyId: 'key-2',
        isHealthy: false,
        lastChecked: '2026-01-01',
        errorMessage: 'Invalid key',
      },
    ];
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ data: mockKeyHealth })
    );
    const { result } = renderHook(() => useKeyHealth('tavily-api-key'));
    expect(result.current.keyHealth).toEqual(mockKeyHealth);
  });

  it('computes correct stats from keyHealth data', () => {
    const mockKeyHealth = [
      {
        keyId: 'key-1',
        isHealthy: true,
        lastChecked: '2026-01-01',
        errorMessage: null,
      },
      {
        keyId: 'key-2',
        isHealthy: false,
        lastChecked: '2026-01-01',
        errorMessage: 'Error',
      },
      {
        keyId: 'key-3',
        isHealthy: true,
        lastChecked: '2026-01-01',
        errorMessage: null,
      },
    ];
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ data: mockKeyHealth })
    );
    const { result } = renderHook(() => useKeyHealth('tavily-api-key'));
    expect(result.current.stats).toEqual({
      total: 3,
      healthy: 2,
      unhealthy: 1,
    });
  });

  it('returns null stats when keyHealth data is null', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet({ data: null }));
    const { result } = renderHook(() => useKeyHealth('tavily-api-key'));
    expect(result.current.stats).toBeNull();
  });

  it('does not fetch when secretName is null (immediate=false)', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    renderHook(() => useKeyHealth(null));
    expect(vi.mocked(useApiGet)).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ immediate: false })
    );
  });

  it('fetches when secretName resolves to valid serviceId (immediate=true)', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    renderHook(() => useKeyHealth('tavily'));
    expect(vi.mocked(useApiGet)).toHaveBeenCalledWith(
      '/admin/ai/services/tavily/key-health',
      expect.objectContaining({ immediate: true })
    );
  });

  it('respects immediate=false option even for valid secretName', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    renderHook(() => useKeyHealth('tavily', { immediate: false }));
    expect(vi.mocked(useApiGet)).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ immediate: false })
    );
  });

  it('returns loading state as false when shouldFetch is false', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet({ loading: true }));
    const { result } = renderHook(() => useKeyHealth(null));
    expect(result.current.isLoading).toBe(false);
  });

  it('returns loading state from useApiGet when shouldFetch is true', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet({ loading: true }));
    const { result } = renderHook(() => useKeyHealth('tavily'));
    expect(result.current.isLoading).toBe(true);
  });

  it('exposes refetch function when secretName is valid', () => {
    const mockExecute = vi.fn();
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ execute: mockExecute })
    );
    const { result } = renderHook(() => useKeyHealth('tavily'));
    expect(result.current.refetch).toBe(mockExecute);
  });

  it('refetch returns resolved promise when secretName is null', async () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    const { result } = renderHook(() => useKeyHealth(null));
    const ret = await result.current.refetch();
    expect(ret).toBeUndefined();
  });

  it('handles all-healthy keyHealth stats correctly', () => {
    const mockKeyHealth = [
      {
        keyId: 'key-1',
        isHealthy: true,
        lastChecked: '2026-01-01',
        errorMessage: null,
      },
      {
        keyId: 'key-2',
        isHealthy: true,
        lastChecked: '2026-01-01',
        errorMessage: null,
      },
    ];
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ data: mockKeyHealth })
    );
    const { result } = renderHook(() => useKeyHealth('tavily'));
    expect(result.current.stats).toEqual({
      total: 2,
      healthy: 2,
      unhealthy: 0,
    });
  });

  it('handles all-unhealthy keyHealth stats correctly', () => {
    const mockKeyHealth = [
      {
        keyId: 'key-1',
        isHealthy: false,
        lastChecked: '2026-01-01',
        errorMessage: 'Err',
      },
      {
        keyId: 'key-2',
        isHealthy: false,
        lastChecked: '2026-01-01',
        errorMessage: 'Err',
      },
    ];
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ data: mockKeyHealth })
    );
    const { result } = renderHook(() => useKeyHealth('tavily'));
    expect(result.current.stats).toEqual({
      total: 2,
      healthy: 0,
      unhealthy: 2,
    });
  });

  it('resolves supadata-api-key to supadata serviceId', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    renderHook(() => useKeyHealth('supadata-api-key'));
    expect(vi.mocked(useApiGet)).toHaveBeenCalledWith(
      '/admin/ai/services/supadata/key-health',
      expect.any(Object)
    );
  });

  it('resolves tavily-extraction-api-key to tavily-extract serviceId', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    renderHook(() => useKeyHealth('tavily-extraction-api-key'));
    expect(vi.mocked(useApiGet)).toHaveBeenCalledWith(
      '/admin/ai/services/tavily-extract/key-health',
      expect.any(Object)
    );
  });

  it('returns empty keyHealth array (not null) when data is undefined', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet({ data: undefined }));
    const { result } = renderHook(() => useKeyHealth('tavily'));
    expect(result.current.keyHealth).toEqual([]);
  });

  it('error is null when shouldFetch is false regardless of underlying error', () => {
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ error: new Error('Should be hidden') as never })
    );
    const { result } = renderHook(() => useKeyHealth('unknown-service'));
    expect(result.current.error).toBeNull();
  });
});

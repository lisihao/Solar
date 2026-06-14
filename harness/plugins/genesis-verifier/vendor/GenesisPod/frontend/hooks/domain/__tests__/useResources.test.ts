import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// useResources imports from '@/hooks/core' (relative)
vi.mock('@/hooks/core', () => ({
  useApiGet: vi.fn(),
  useApiPost: vi.fn(),
  useApiDelete: vi.fn(),
}));

import { useApiGet, useApiPost, useApiDelete } from '@/hooks/core';
import { useResources } from '../useResources';

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

const makeDefaultMutation = (overrides = {}) => ({
  data: null,
  loading: false,
  error: null,
  execute: vi.fn(),
  refresh: vi.fn(),
  reset: vi.fn(),
  setData: vi.fn(),
  ...overrides,
});

describe('useResources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty resources when data is null', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiDelete).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());
    const { result } = renderHook(() => useResources());
    expect(result.current.resources).toEqual([]);
    expect(result.current.total).toBe(0);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.isDeleting).toBe(false);
  });

  it('returns resources when API responds with data', () => {
    const mockResources = [
      {
        id: 'r-1',
        title: 'Resource 1',
        type: 'article',
        status: 'completed' as const,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
      {
        id: 'r-2',
        title: 'Resource 2',
        type: 'video',
        status: 'pending' as const,
        createdAt: '2026-01-02',
        updatedAt: '2026-01-02',
      },
    ];
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({
        data: {
          items: mockResources,
          total: 2,
          page: 1,
          pageSize: 20,
          hasMore: false,
        },
      })
    );
    vi.mocked(useApiDelete).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());

    const { result } = renderHook(() => useResources());
    expect(result.current.resources).toEqual(mockResources);
    expect(result.current.total).toBe(2);
    expect(result.current.hasMore).toBe(false);
  });

  it('uses correct query params for type filter', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiDelete).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());

    renderHook(() => useResources({ filter: { type: 'article' } }));
    const callArg = vi.mocked(useApiGet).mock.calls[0][0];
    expect(callArg).toContain('type=article');
  });

  it('uses correct query params for status filter', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiDelete).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());

    renderHook(() => useResources({ filter: { status: 'completed' } }));
    const callArg = vi.mocked(useApiGet).mock.calls[0][0];
    expect(callArg).toContain('status=completed');
  });

  it('uses correct query params for search filter', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiDelete).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());

    renderHook(() => useResources({ filter: { search: 'AI research' } }));
    const callArg = vi.mocked(useApiGet).mock.calls[0][0];
    expect(callArg).toContain('search=AI+research');
  });

  it('uses default pageSize of 20', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiDelete).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());

    renderHook(() => useResources());
    const callArg = vi.mocked(useApiGet).mock.calls[0][0];
    expect(callArg).toContain('limit=20');
  });

  it('respects custom pageSize', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiDelete).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());

    renderHook(() => useResources({ pageSize: 50 }));
    const callArg = vi.mocked(useApiGet).mock.calls[0][0];
    expect(callArg).toContain('limit=50');
  });

  it('reflects loading state from useApiGet', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet({ loading: true }));
    vi.mocked(useApiDelete).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());

    const { result } = renderHook(() => useResources());
    expect(result.current.loading).toBe(true);
  });

  it('reflects error state from useApiGet', () => {
    const mockError = new Error('Fetch failed');
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ error: mockError as never })
    );
    vi.mocked(useApiDelete).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());

    const { result } = renderHook(() => useResources());
    expect(result.current.error).toBe(mockError);
  });

  it('refresh calls execute', async () => {
    const mockExecute = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ execute: mockExecute })
    );
    vi.mocked(useApiDelete).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());

    const { result } = renderHook(() => useResources());
    await act(async () => {
      await result.current.refresh();
    });
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it('deleteResource calls deleteApi and then refresh', async () => {
    const mockExecute = vi.fn().mockResolvedValue(undefined);
    const mockDeleteExecute = vi.fn().mockResolvedValue(undefined);

    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ execute: mockExecute })
    );
    vi.mocked(useApiDelete).mockReturnValue(
      makeDefaultMutation({ execute: mockDeleteExecute })
    );
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());

    const { result } = renderHook(() => useResources());
    await act(async () => {
      await result.current.deleteResource('r-1');
    });
    expect(mockDeleteExecute).toHaveBeenCalledWith({ id: 'r-1' });
    expect(mockExecute).toHaveBeenCalled();
  });

  it('batchDelete calls batchDeleteApi and then refresh', async () => {
    const mockExecute = vi.fn().mockResolvedValue(undefined);
    const mockBatchExecute = vi.fn().mockResolvedValue(undefined);

    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ execute: mockExecute })
    );
    vi.mocked(useApiDelete).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiPost).mockReturnValue(
      makeDefaultMutation({ execute: mockBatchExecute })
    );

    const { result } = renderHook(() => useResources());
    await act(async () => {
      await result.current.batchDelete(['r-1', 'r-2']);
    });
    expect(mockBatchExecute).toHaveBeenCalledWith({ ids: ['r-1', 'r-2'] });
    expect(mockExecute).toHaveBeenCalled();
  });

  it('isDeleting is true when either delete or batchDelete is in progress', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiDelete).mockReturnValue(
      makeDefaultMutation({ loading: true })
    );
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());

    const { result } = renderHook(() => useResources());
    expect(result.current.isDeleting).toBe(true);
  });

  it('isDeleting is true when batchDelete is loading', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiDelete).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiPost).mockReturnValue(
      makeDefaultMutation({ loading: true })
    );

    const { result } = renderHook(() => useResources());
    expect(result.current.isDeleting).toBe(true);
  });

  it('hasMore reflects paginated response correctly', () => {
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({
        data: { items: [], total: 100, page: 1, pageSize: 20, hasMore: true },
      })
    );
    vi.mocked(useApiDelete).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());

    const { result } = renderHook(() => useResources());
    expect(result.current.hasMore).toBe(true);
    expect(result.current.total).toBe(100);
  });

  it('uses immediate=false option when provided', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiDelete).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());

    renderHook(() => useResources({ immediate: false }));
    expect(vi.mocked(useApiGet)).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ immediate: false })
    );
  });

  it('defaults immediate to true when not specified', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiDelete).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());

    renderHook(() => useResources());
    expect(vi.mocked(useApiGet)).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ immediate: true })
    );
  });

  it('useApiDelete endpoint is set to /api/resources', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiDelete).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());

    renderHook(() => useResources());
    expect(vi.mocked(useApiDelete)).toHaveBeenCalledWith('/api/resources');
  });

  it('useApiPost for batch delete uses correct endpoint', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiDelete).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());

    renderHook(() => useResources());
    expect(vi.mocked(useApiPost)).toHaveBeenCalledWith(
      '/api/resources/batch-delete'
    );
  });

  it('combines multiple filters in query string', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiDelete).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());

    renderHook(() =>
      useResources({
        filter: { type: 'video', status: 'pending', search: 'AI' },
      })
    );
    const callArg = vi.mocked(useApiGet).mock.calls[0][0];
    expect(callArg).toContain('type=video');
    expect(callArg).toContain('status=pending');
    expect(callArg).toContain('search=AI');
  });
});

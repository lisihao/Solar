import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/hooks/core', () => ({
  useApiGet: vi.fn(),
  useApiPost: vi.fn(),
  useApiPut: vi.fn(),
  useApiDelete: vi.fn(),
  useApiMutation: vi.fn(),
}));

import { useApiGet, useApiPost, useApiPut, useApiDelete } from '@/hooks/core';
import { useAdminCollections } from '../useAdminCollections';
import type { Collection } from '../useAdminCollections';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeDefaultHook = (overrides = {}) => ({
  data: null,
  loading: false,
  error: null,
  execute: vi.fn().mockResolvedValue(undefined),
  refresh: vi.fn(),
  reset: vi.fn(),
  setData: vi.fn(),
  ...overrides,
});

const makeCollection = (overrides: Partial<Collection> = {}): Collection => ({
  id: 'col-1',
  name: 'Test Collection',
  description: 'A test collection',
  type: 'web',
  status: 'active',
  itemCount: 10,
  createdAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAdminCollections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiGet).mockReturnValue(makeDefaultHook());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultHook());
    vi.mocked(useApiPut).mockReturnValue(makeDefaultHook());
    vi.mocked(useApiDelete).mockReturnValue(makeDefaultHook());
  });

  it('returns empty array when data is null', () => {
    const { result } = renderHook(() => useAdminCollections());
    expect(result.current.collections).toEqual([]);
  });

  it('returns collections list when data is available', () => {
    const collections = [
      makeCollection(),
      makeCollection({ id: 'col-2', name: 'Second' }),
    ];
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultHook({ data: collections })
    );

    const { result } = renderHook(() => useAdminCollections());
    expect(result.current.collections).toHaveLength(2);
    expect(result.current.collections[0].name).toBe('Test Collection');
  });

  it('createCollection calls createApi and refreshes list on success', async () => {
    const mockExecute = vi.fn().mockResolvedValue(undefined);
    const mockCreateApi = vi
      .fn()
      .mockResolvedValue(makeCollection({ id: 'new-col' }));

    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultHook({ execute: mockExecute })
    );
    vi.mocked(useApiPost)
      .mockReturnValueOnce(makeDefaultHook({ execute: mockCreateApi })) // createApi
      .mockReturnValueOnce(makeDefaultHook()); // syncApi

    const { result } = renderHook(() => useAdminCollections());
    await act(async () => {
      await result.current.createCollection({
        name: 'New Collection',
        type: 'web',
      });
    });

    expect(mockCreateApi).toHaveBeenCalledWith({
      name: 'New Collection',
      type: 'web',
    });
    expect(mockExecute).toHaveBeenCalled();
  });

  it('createCollection does not refresh when API returns null', async () => {
    const mockExecute = vi.fn().mockResolvedValue(undefined);
    const mockCreateApi = vi.fn().mockResolvedValue(null);

    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultHook({ execute: mockExecute })
    );
    vi.mocked(useApiPost)
      .mockReturnValueOnce(makeDefaultHook({ execute: mockCreateApi }))
      .mockReturnValueOnce(makeDefaultHook());

    const { result } = renderHook(() => useAdminCollections());
    await act(async () => {
      await result.current.createCollection({ name: 'New Collection' });
    });

    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('updateCollection calls updateApi with merged data and refreshes on success', async () => {
    const mockExecute = vi.fn().mockResolvedValue(undefined);
    const mockUpdateApi = vi
      .fn()
      .mockResolvedValue(makeCollection({ name: 'Updated' }));

    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultHook({ execute: mockExecute })
    );
    vi.mocked(useApiPut).mockReturnValue(
      makeDefaultHook({ execute: mockUpdateApi })
    );
    vi.mocked(useApiPost).mockReturnValue(makeDefaultHook());

    const { result } = renderHook(() => useAdminCollections());
    await act(async () => {
      await result.current.updateCollection('col-1', { name: 'Updated' });
    });

    expect(mockUpdateApi).toHaveBeenCalledWith({
      name: 'Updated',
      id: 'col-1',
    });
    expect(mockExecute).toHaveBeenCalled();
  });

  it('deleteCollection calls deleteApi and refreshes list', async () => {
    const mockExecute = vi.fn().mockResolvedValue(undefined);
    const mockDeleteApi = vi.fn().mockResolvedValue(undefined);

    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultHook({ execute: mockExecute })
    );
    vi.mocked(useApiDelete).mockReturnValue(
      makeDefaultHook({ execute: mockDeleteApi })
    );
    vi.mocked(useApiPost).mockReturnValue(makeDefaultHook());

    const { result } = renderHook(() => useAdminCollections());
    await act(async () => {
      await result.current.deleteCollection('col-1');
    });

    expect(mockDeleteApi).toHaveBeenCalledWith({ id: 'col-1' });
    expect(mockExecute).toHaveBeenCalled();
  });

  it('syncCollection calls syncApi and refreshes list', async () => {
    const mockExecute = vi.fn().mockResolvedValue(undefined);
    const mockSyncApi = vi.fn().mockResolvedValue(undefined);

    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultHook({ execute: mockExecute })
    );
    vi.mocked(useApiPost)
      .mockReturnValueOnce(makeDefaultHook()) // createApi
      .mockReturnValueOnce(makeDefaultHook({ execute: mockSyncApi })); // syncApi

    const { result } = renderHook(() => useAdminCollections());
    await act(async () => {
      await result.current.syncCollection('col-1');
    });

    expect(mockSyncApi).toHaveBeenCalledWith({ id: 'col-1' });
    expect(mockExecute).toHaveBeenCalled();
  });

  it('aggregates loading states correctly', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultHook({ loading: true }));
    vi.mocked(useApiPost).mockReturnValue(makeDefaultHook({ loading: false }));
    vi.mocked(useApiPut).mockReturnValue(makeDefaultHook({ loading: false }));
    vi.mocked(useApiDelete).mockReturnValue(
      makeDefaultHook({ loading: false })
    );

    const { result } = renderHook(() => useAdminCollections());
    expect(result.current.loading).toBe(true);
  });

  it('exposes individual operation loading flags', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultHook());
    vi.mocked(useApiPost)
      .mockReturnValueOnce(makeDefaultHook({ loading: true })) // createApi
      .mockReturnValueOnce(makeDefaultHook()); // syncApi
    vi.mocked(useApiPut).mockReturnValue(makeDefaultHook({ loading: false }));
    vi.mocked(useApiDelete).mockReturnValue(makeDefaultHook({ loading: true }));

    const { result } = renderHook(() => useAdminCollections());
    expect(result.current.isCreating).toBe(true);
    expect(result.current.isDeleting).toBe(true);
  });
});

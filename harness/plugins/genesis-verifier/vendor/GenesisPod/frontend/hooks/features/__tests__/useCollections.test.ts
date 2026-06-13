import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCollections, ReadStatus } from '../useCollections';

// Mock dependencies
vi.mock('@/lib/utils/config', () => ({
  config: { apiBaseUrl: 'http://test-api' },
}));

vi.mock('@/lib/utils/auth', () => ({
  getAuthHeader: vi.fn(() => ({ Authorization: 'Bearer test-token' })),
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeFetchResponse(data: unknown, ok = true) {
  return {
    ok,
    json: () => Promise.resolve(data),
  };
}

const sampleCollection = {
  id: 'col-1',
  name: 'My Collection',
  isPublic: false,
  createdAt: '2026-01-01T00:00:00Z',
};

const sampleItem = {
  id: 'item-1',
  collectionId: 'col-1',
  resourceId: 'res-1',
  readStatus: ReadStatus.UNREAD,
  readProgress: 0,
  tags: [],
  position: 0,
  addedAt: '2026-01-01T00:00:00Z',
  resource: {
    id: 'res-1',
    type: 'ARTICLE',
    title: 'Test Article',
    publishedAt: '2026-01-01T00:00:00Z',
    sourceUrl: 'https://example.com',
  },
};

describe('useCollections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue(makeFetchResponse({ success: true, data: [] }));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ==================== Initial State ====================

  it('should return initial state with loading false and no error', () => {
    const { result } = renderHook(() => useCollections());
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should expose all required functions', () => {
    const { result } = renderHook(() => useCollections());
    expect(typeof result.current.getCollections).toBe('function');
    expect(typeof result.current.getCollection).toBe('function');
    expect(typeof result.current.createCollection).toBe('function');
    expect(typeof result.current.updateCollection).toBe('function');
    expect(typeof result.current.deleteCollection).toBe('function');
    expect(typeof result.current.addToCollection).toBe('function');
    expect(typeof result.current.removeFromCollection).toBe('function');
    expect(typeof result.current.updateItem).toBe('function');
    expect(typeof result.current.getTags).toBe('function');
    expect(typeof result.current.getStats).toBe('function');
    expect(typeof result.current.getItemsPaginated).toBe('function');
    expect(typeof result.current.batchMoveItems).toBe('function');
    expect(typeof result.current.batchDeleteItems).toBe('function');
    expect(typeof result.current.batchUpdateTags).toBe('function');
    expect(typeof result.current.batchUpdateStatus).toBe('function');
  });

  // ==================== getCollections ====================

  it('getCollections: returns unwrapped collection array on success', async () => {
    mockFetch.mockResolvedValue(
      makeFetchResponse({ success: true, data: [sampleCollection] })
    );
    const { result } = renderHook(() => useCollections());

    let collections: unknown;
    await act(async () => {
      collections = await result.current.getCollections();
    });

    expect(collections).toEqual([sampleCollection]);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://test-api/api/v1/collections',
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-token' },
      })
    );
  });

  it('getCollections: sets error and throws on non-ok response', async () => {
    mockFetch.mockResolvedValue(makeFetchResponse({}, false));
    const { result } = renderHook(() => useCollections());

    await act(async () => {
      await expect(result.current.getCollections()).rejects.toThrow(
        'Failed to fetch collections'
      );
    });

    expect(result.current.error).toBe('Failed to load collections');
    expect(result.current.loading).toBe(false);
  });

  it('getCollections: sets loading to false after completion', async () => {
    mockFetch.mockResolvedValue(makeFetchResponse({ success: true, data: [] }));
    const { result } = renderHook(() => useCollections());

    await act(async () => {
      await result.current.getCollections();
    });

    expect(result.current.loading).toBe(false);
  });

  // ==================== getCollection ====================

  it('getCollection: fetches single collection by id', async () => {
    mockFetch.mockResolvedValue(
      makeFetchResponse({ success: true, data: sampleCollection })
    );
    const { result } = renderHook(() => useCollections());

    let collection: unknown;
    await act(async () => {
      collection = await result.current.getCollection('col-1');
    });

    expect(collection).toEqual(sampleCollection);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://test-api/api/v1/collections/col-1',
      expect.any(Object)
    );
  });

  it('getCollection: throws and sets error on failure', async () => {
    mockFetch.mockResolvedValue(makeFetchResponse({}, false));
    const { result } = renderHook(() => useCollections());

    await act(async () => {
      await expect(result.current.getCollection('col-1')).rejects.toThrow();
    });

    expect(result.current.error).toBe('Failed to load collection');
  });

  // ==================== createCollection ====================

  it('createCollection: sends POST with correct body and returns created collection', async () => {
    mockFetch.mockResolvedValue(
      makeFetchResponse({ success: true, data: sampleCollection })
    );
    const { result } = renderHook(() => useCollections());

    let created: unknown;
    await act(async () => {
      created = await result.current.createCollection({
        name: 'My Collection',
        isPublic: false,
      });
    });

    expect(created).toEqual(sampleCollection);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://test-api/api/v1/collections',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ name: 'My Collection', isPublic: false }),
      })
    );
  });

  it('createCollection: sets error on failure', async () => {
    mockFetch.mockResolvedValue(makeFetchResponse({}, false));
    const { result } = renderHook(() => useCollections());

    await act(async () => {
      await expect(
        result.current.createCollection({ name: 'Test' })
      ).rejects.toThrow();
    });

    expect(result.current.error).toBe('Failed to create collection');
  });

  // ==================== updateCollection ====================

  it('updateCollection: sends PATCH to correct endpoint', async () => {
    const updated = { ...sampleCollection, name: 'Renamed' };
    mockFetch.mockResolvedValue(
      makeFetchResponse({ success: true, data: updated })
    );
    const { result } = renderHook(() => useCollections());

    let res: unknown;
    await act(async () => {
      res = await result.current.updateCollection('col-1', { name: 'Renamed' });
    });

    expect(res).toEqual(updated);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://test-api/api/v1/collections/col-1',
      expect.objectContaining({ method: 'PATCH' })
    );
  });

  // ==================== deleteCollection ====================

  it('deleteCollection: sends DELETE request', async () => {
    mockFetch.mockResolvedValue(makeFetchResponse({}, true));
    const { result } = renderHook(() => useCollections());

    await act(async () => {
      await result.current.deleteCollection('col-1');
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://test-api/api/v1/collections/col-1',
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('deleteCollection: throws and sets error on failure', async () => {
    mockFetch.mockResolvedValue(makeFetchResponse({}, false));
    const { result } = renderHook(() => useCollections());

    await act(async () => {
      await expect(result.current.deleteCollection('col-1')).rejects.toThrow();
    });

    expect(result.current.error).toBe('Failed to delete collection');
  });

  // ==================== addToCollection ====================

  it('addToCollection: sends POST with resourceId and note', async () => {
    mockFetch.mockResolvedValue(
      makeFetchResponse({
        success: true,
        data: { success: true, item: sampleItem },
      })
    );
    const { result } = renderHook(() => useCollections());

    await act(async () => {
      await result.current.addToCollection('col-1', 'res-1', 'A note');
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://test-api/api/v1/collections/col-1/items',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ resourceId: 'res-1', note: 'A note' }),
      })
    );
  });

  // ==================== removeFromCollection ====================

  it('removeFromCollection: sends DELETE to correct item endpoint', async () => {
    mockFetch.mockResolvedValue(makeFetchResponse({}, true));
    const { result } = renderHook(() => useCollections());

    await act(async () => {
      await result.current.removeFromCollection('col-1', 'res-1');
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://test-api/api/v1/collections/col-1/items/res-1',
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  // ==================== updateItem ====================

  it('updateItem: sends PATCH with correct payload', async () => {
    mockFetch.mockResolvedValue(
      makeFetchResponse({ success: true, data: sampleItem })
    );
    const { result } = renderHook(() => useCollections());

    await act(async () => {
      await result.current.updateItem('item-1', {
        readStatus: ReadStatus.READING,
        readProgress: 50,
      });
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://test-api/api/v1/collections/items/item-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          readStatus: ReadStatus.READING,
          readProgress: 50,
        }),
      })
    );
  });

  // ==================== getTags ====================

  it('getTags: fetches from tags/all endpoint', async () => {
    mockFetch.mockResolvedValue(
      makeFetchResponse({ success: true, data: [{ name: 'ai', count: 5 }] })
    );
    const { result } = renderHook(() => useCollections());

    let tags: unknown;
    await act(async () => {
      tags = await result.current.getTags();
    });

    expect(tags).toEqual([{ name: 'ai', count: 5 }]);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://test-api/api/v1/collections/tags/all',
      expect.any(Object)
    );
  });

  // ==================== getStats ====================

  it('getStats: fetches from stats/summary endpoint', async () => {
    const stats = { totalItems: 10, recentItems: 3, byStatus: {} };
    mockFetch.mockResolvedValue(
      makeFetchResponse({ success: true, data: stats })
    );
    const { result } = renderHook(() => useCollections());

    let result_: unknown;
    await act(async () => {
      result_ = await result.current.getStats();
    });

    expect(result_).toEqual(stats);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://test-api/api/v1/collections/stats/summary',
      expect.any(Object)
    );
  });

  // ==================== getItemsPaginated ====================

  it('getItemsPaginated: builds query params correctly', async () => {
    const paginatedResult = {
      items: [],
      pagination: {
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
        hasMore: false,
      },
    };
    mockFetch.mockResolvedValue(
      makeFetchResponse({ success: true, data: paginatedResult })
    );
    const { result } = renderHook(() => useCollections());

    await act(async () => {
      await result.current.getItemsPaginated({
        collectionId: 'col-1',
        page: 2,
        limit: 20,
        status: ReadStatus.UNREAD,
        search: 'test',
        sortBy: 'addedAt',
        sortOrder: 'desc',
      });
    });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('collectionId=col-1');
    expect(calledUrl).toContain('page=2');
    expect(calledUrl).toContain('limit=20');
    expect(calledUrl).toContain('status=UNREAD');
    expect(calledUrl).toContain('search=test');
    expect(calledUrl).toContain('sortBy=addedAt');
    expect(calledUrl).toContain('sortOrder=desc');
  });

  // ==================== Batch Operations ====================

  it('batchMoveItems: sends itemIds and targetCollectionId', async () => {
    mockFetch.mockResolvedValue(
      makeFetchResponse({
        success: true,
        data: { success: true, movedCount: 3 },
      })
    );
    const { result } = renderHook(() => useCollections());

    let res: unknown;
    await act(async () => {
      res = await result.current.batchMoveItems(
        ['item-1', 'item-2', 'item-3'],
        'col-2'
      );
    });

    expect(res).toEqual({ success: true, movedCount: 3 });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://test-api/api/v1/collections/items/batch/move',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          itemIds: ['item-1', 'item-2', 'item-3'],
          targetCollectionId: 'col-2',
        }),
      })
    );
  });

  it('batchDeleteItems: posts to batch/delete endpoint', async () => {
    mockFetch.mockResolvedValue(
      makeFetchResponse({
        success: true,
        data: { success: true, deletedCount: 2 },
      })
    );
    const { result } = renderHook(() => useCollections());

    let res: unknown;
    await act(async () => {
      res = await result.current.batchDeleteItems(['item-1', 'item-2']);
    });

    expect(res).toEqual({ success: true, deletedCount: 2 });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://test-api/api/v1/collections/items/batch/delete',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ itemIds: ['item-1', 'item-2'] }),
      })
    );
  });

  it('batchUpdateTags: defaults to "set" operation', async () => {
    mockFetch.mockResolvedValue(
      makeFetchResponse({
        success: true,
        data: { success: true, updatedCount: 1 },
      })
    );
    const { result } = renderHook(() => useCollections());

    await act(async () => {
      await result.current.batchUpdateTags(['item-1'], ['ai', 'research']);
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://test-api/api/v1/collections/items/batch/tags',
      expect.objectContaining({
        body: JSON.stringify({
          itemIds: ['item-1'],
          tags: ['ai', 'research'],
          operation: 'set',
        }),
      })
    );
  });

  it('batchUpdateTags: uses specified operation when provided', async () => {
    mockFetch.mockResolvedValue(
      makeFetchResponse({
        success: true,
        data: { success: true, updatedCount: 1 },
      })
    );
    const { result } = renderHook(() => useCollections());

    await act(async () => {
      await result.current.batchUpdateTags(['item-1'], ['ai'], 'add');
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.operation).toBe('add');
  });

  it('batchUpdateStatus: posts correct status update', async () => {
    mockFetch.mockResolvedValue(
      makeFetchResponse({
        success: true,
        data: { success: true, updatedCount: 2 },
      })
    );
    const { result } = renderHook(() => useCollections());

    await act(async () => {
      await result.current.batchUpdateStatus(
        ['item-1', 'item-2'],
        ReadStatus.COMPLETED
      );
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://test-api/api/v1/collections/items/batch/status',
      expect.objectContaining({
        body: JSON.stringify({
          itemIds: ['item-1', 'item-2'],
          status: 'COMPLETED',
        }),
      })
    );
  });

  // ==================== Auth headers ====================

  it('includes Authorization header in all requests', async () => {
    mockFetch.mockResolvedValue(makeFetchResponse({ success: true, data: [] }));
    const { result } = renderHook(() => useCollections());

    await act(async () => {
      await result.current.getCollections();
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      })
    );
  });

  // ==================== unwrapResponse ====================

  it('unwrapResponse: handles bare array (non-wrapped) response', async () => {
    mockFetch.mockResolvedValue(makeFetchResponse([sampleCollection]));
    const { result } = renderHook(() => useCollections());

    let collections: unknown;
    await act(async () => {
      collections = await result.current.getCollections();
    });

    // When the response is already an array (no { success, data } wrapper),
    // it should be returned as-is
    expect(collections).toEqual([sampleCollection]);
  });

  // ==================== Network Errors ====================

  it('handles network failure gracefully in getCollections', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => useCollections());

    await act(async () => {
      await expect(result.current.getCollections()).rejects.toThrow(
        'Network error'
      );
    });

    expect(result.current.error).toBe('Failed to load collections');
    expect(result.current.loading).toBe(false);
  });

  it('handles network failure gracefully in createCollection', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => useCollections());

    await act(async () => {
      await expect(
        result.current.createCollection({ name: 'Test' })
      ).rejects.toThrow('Network error');
    });

    expect(result.current.error).toBe('Failed to create collection');
  });
});

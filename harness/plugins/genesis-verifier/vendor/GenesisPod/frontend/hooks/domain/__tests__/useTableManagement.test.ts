import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/hooks/core', () => ({
  useApiGet: vi.fn(),
  useApiPost: vi.fn(),
  useApiPut: vi.fn(),
  useApiDelete: vi.fn(),
  useApiMutation: vi.fn(),
}));

vi.mock('@/lib/utils/config', () => ({
  config: { apiUrl: 'http://test-api', apiBaseUrl: 'http://test-api' },
}));

vi.mock('@/lib/utils/auth', () => ({
  getAuthHeader: vi.fn().mockReturnValue({ Authorization: 'Bearer test' }),
}));

import { useApiGet } from '@/hooks/core';
import { useTableManagement } from '../useTableManagement';

const makeDefaultGet = (overrides = {}) => ({
  data: null,
  loading: false,
  error: null,
  execute: vi.fn().mockResolvedValue(undefined),
  refresh: vi.fn(),
  reset: vi.fn(),
  setData: vi.fn(),
  ...overrides,
});

const makeTableListResponse = (overrides = {}) => ({
  tables: [
    {
      name: 'users',
      displayName: 'Users',
      category: 'USER' as const,
      rowCount: 100,
      sizeBytes: 1024,
      sizeFormatted: '1 KB',
      dataSizeBytes: 512,
      indexSizeBytes: 256,
      toastSizeBytes: 256,
      lastUpdated: '2026-01-01T00:00:00Z',
      cleanableRows: 5,
      cleanableBytes: 100,
      healthStatus: 'healthy' as const,
      hasCleanupPolicy: true,
    },
  ],
  total: 1,
  page: 1,
  pageSize: 50,
  stats: {
    totalTables: 1,
    totalRows: 100,
    totalSizeBytes: 1024,
    totalSizeFormatted: '1 KB',
    cleanableSizeBytes: 100,
    cleanableSizeFormatted: '100 B',
    lastAnalyzed: '2026-01-01T00:00:00Z',
    byCategory: {},
    healthSummary: { healthy: 1, warning: 0, critical: 0 },
  },
  ...overrides,
});

describe('useTableManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
  });

  it('returns empty tables array when data is null', () => {
    const { result } = renderHook(() => useTableManagement());
    expect(result.current.tables).toEqual([]);
    expect(result.current.total).toBe(0);
    expect(result.current.stats).toBeNull();
  });

  it('returns table list when data is available', () => {
    const listData = makeTableListResponse();
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet({ data: listData }));
    const { result } = renderHook(() => useTableManagement());
    expect(result.current.tables).toHaveLength(1);
    expect(result.current.tables[0].name).toBe('users');
    expect(result.current.total).toBe(1);
  });

  it('exposes stats from API response', () => {
    const listData = makeTableListResponse();
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet({ data: listData }));
    const { result } = renderHook(() => useTableManagement());
    expect(result.current.stats).not.toBeNull();
    expect(result.current.stats?.totalTables).toBe(1);
    expect(result.current.stats?.healthSummary.healthy).toBe(1);
  });

  it('exposes loading state', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet({ loading: true }));
    const { result } = renderHook(() => useTableManagement());
    expect(result.current.loading).toBe(true);
  });

  it('exposes error state', () => {
    const error = { message: 'Network error', status: 500 } as never;
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet({ error }));
    const { result } = renderHook(() => useTableManagement());
    expect(result.current.error).not.toBeNull();
  });

  it('initializes query with default values', () => {
    const { result } = renderHook(() => useTableManagement());
    expect(result.current.query.sortBy).toBe('size');
    expect(result.current.query.sortOrder).toBe('desc');
    expect(result.current.query.page).toBe(1);
    expect(result.current.query.pageSize).toBe(50);
    expect(result.current.query.search).toBe('');
  });

  it('merges initialQuery with defaults', () => {
    const { result } = renderHook(() =>
      useTableManagement({ page: 3, pageSize: 20 })
    );
    expect(result.current.query.page).toBe(3);
    expect(result.current.query.pageSize).toBe(20);
    expect(result.current.query.sortBy).toBe('size');
  });

  it('updateSearch updates search query and resets page to 1', () => {
    const { result } = renderHook(() => useTableManagement({ page: 3 }));
    act(() => {
      result.current.updateSearch('test-table');
    });
    expect(result.current.query.search).toBe('test-table');
    expect(result.current.query.page).toBe(1);
  });

  it('updateCategory updates category filter and resets page', () => {
    const { result } = renderHook(() => useTableManagement({ page: 5 }));
    act(() => {
      result.current.updateCategory('USER');
    });
    expect(result.current.query.category).toBe('USER');
    expect(result.current.query.page).toBe(1);
  });

  it('updateCategory with undefined clears the filter', () => {
    const { result } = renderHook(() =>
      useTableManagement({ category: 'USER' })
    );
    act(() => {
      result.current.updateCategory(undefined);
    });
    expect(result.current.query.category).toBeUndefined();
  });

  it('updateHealthStatus updates health status filter and resets page', () => {
    const { result } = renderHook(() => useTableManagement({ page: 3 }));
    act(() => {
      result.current.updateHealthStatus('critical');
    });
    expect(result.current.query.healthStatus).toBe('critical');
    expect(result.current.query.page).toBe(1);
  });

  it('updateSort sets new sort column with default desc order', () => {
    const { result } = renderHook(() => useTableManagement());
    act(() => {
      result.current.updateSort('rows');
    });
    expect(result.current.query.sortBy).toBe('rows');
    expect(result.current.query.sortOrder).toBe('desc');
  });

  it('updateSort toggles order when same column is clicked', () => {
    const { result } = renderHook(() =>
      useTableManagement({ sortBy: 'size', sortOrder: 'desc' })
    );
    act(() => {
      result.current.updateSort('size');
    });
    expect(result.current.query.sortOrder).toBe('asc');
  });

  it('updateSort respects explicit sortOrder parameter', () => {
    const { result } = renderHook(() => useTableManagement());
    act(() => {
      result.current.updateSort('name', 'asc');
    });
    expect(result.current.query.sortBy).toBe('name');
    expect(result.current.query.sortOrder).toBe('asc');
  });

  it('updatePage changes the current page', () => {
    const { result } = renderHook(() => useTableManagement());
    act(() => {
      result.current.updatePage(4);
    });
    expect(result.current.query.page).toBe(4);
  });

  it('updatePageSize changes page size and resets page to 1', () => {
    const { result } = renderHook(() => useTableManagement({ page: 3 }));
    act(() => {
      result.current.updatePageSize(25);
    });
    expect(result.current.query.pageSize).toBe(25);
    expect(result.current.query.page).toBe(1);
  });

  it('fetchTableDetail sets selectedTable and calls fetch', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        success: true,
        data: {
          name: 'users',
          displayName: 'Users',
          category: 'USER',
          rowCount: 100,
          sizeBytes: 1024,
          sizeFormatted: '1 KB',
          dataSizeBytes: 512,
          indexSizeBytes: 256,
          toastSizeBytes: 256,
          lastUpdated: null,
          cleanableRows: 0,
          cleanableBytes: 0,
          healthStatus: 'healthy',
          hasCleanupPolicy: false,
          schema: [],
          sampleData: [],
          relatedTables: [],
          constraints: [],
        },
      }),
    });
    global.fetch = mockFetch;

    const { result } = renderHook(() => useTableManagement());
    await act(async () => {
      await result.current.fetchTableDetail('users');
    });

    expect(result.current.selectedTable).toBe('users');
    expect(result.current.tableDetail).not.toBeNull();
    expect(result.current.tableDetail?.name).toBe('users');
    expect(result.current.detailLoading).toBe(false);
  });

  it('closeTableDetail clears selectedTable and tableDetail', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ success: false }),
    });
    global.fetch = mockFetch;

    const { result } = renderHook(() => useTableManagement());
    await act(async () => {
      await result.current.fetchTableDetail('users');
    });
    act(() => {
      result.current.closeTableDetail();
    });
    expect(result.current.selectedTable).toBeNull();
    expect(result.current.tableDetail).toBeNull();
  });

  it('diagnoseTable calls diagnose endpoint and sets diagnosis', async () => {
    const diagnosisData = {
      tableName: 'users',
      analyzedAt: '2026-01-01T00:00:00Z',
      issues: [],
      recommendations: ['Vacuum table'],
      healthScore: 95,
    };
    const mockFetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ success: true, data: diagnosisData }),
    });
    global.fetch = mockFetch;

    const { result } = renderHook(() => useTableManagement());
    await act(async () => {
      await result.current.diagnoseTable('users');
    });

    expect(result.current.diagnosingTable).toBe('users');
    expect(result.current.diagnosis?.tableName).toBe('users');
    expect(result.current.diagnosisLoading).toBe(false);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/admin/tables/users/diagnose'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('closeDiagnosis clears diagnosingTable and diagnosis', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ success: false }),
    });
    global.fetch = mockFetch;

    const { result } = renderHook(() => useTableManagement());
    await act(async () => {
      await result.current.diagnoseTable('users');
    });
    act(() => {
      result.current.closeDiagnosis();
    });
    expect(result.current.diagnosingTable).toBeNull();
    expect(result.current.diagnosis).toBeNull();
  });

  it('cleanupTable calls cleanup endpoint and refreshes list on success', async () => {
    const cleanupData = {
      success: true,
      tableName: 'users',
      deletedCount: 10,
      freedBytes: 1000,
      freedFormatted: '1 KB',
      message: 'Cleaned successfully',
      duration: 50,
    };
    const mockExecute = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ execute: mockExecute })
    );

    const mockFetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ success: true, data: cleanupData }),
    });
    global.fetch = mockFetch;

    const { result } = renderHook(() => useTableManagement());
    await act(async () => {
      await result.current.cleanupTable('users');
    });

    expect(result.current.cleanupResult?.deletedCount).toBe(10);
    expect(result.current.cleanupResult?.tableName).toBe('users');
    expect(mockExecute).toHaveBeenCalled();
  });

  it('clearCleanupResult sets cleanupResult to null', async () => {
    const cleanupData = {
      success: true,
      tableName: 'users',
      deletedCount: 5,
      freedBytes: 500,
      freedFormatted: '500 B',
      message: 'Done',
      duration: 20,
    };
    const mockFetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ success: true, data: cleanupData }),
    });
    global.fetch = mockFetch;

    const { result } = renderHook(() => useTableManagement());
    await act(async () => {
      await result.current.cleanupTable('users');
    });
    act(() => {
      result.current.clearCleanupResult();
    });
    expect(result.current.cleanupResult).toBeNull();
  });

  it('batchDiagnose calls batch-diagnose endpoint and returns results', async () => {
    const diagResults = [
      {
        tableName: 'users',
        analyzedAt: '2026-01-01T00:00:00Z',
        issues: [],
        recommendations: [],
        healthScore: 90,
      },
    ];
    const mockFetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ success: true, data: diagResults }),
    });
    global.fetch = mockFetch;

    const { result } = renderHook(() => useTableManagement());
    let returned: unknown;
    await act(async () => {
      returned = await result.current.batchDiagnose();
    });

    expect(returned).toEqual(diagResults);
    expect(result.current.batchDiagnoseLoading).toBe(false);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/admin/tables/batch-diagnose'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('batchDiagnose returns empty array on failure', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
    global.fetch = mockFetch;

    const { result } = renderHook(() => useTableManagement());
    let returned: unknown;
    await act(async () => {
      returned = await result.current.batchDiagnose();
    });

    expect(returned).toEqual([]);
    expect(result.current.batchDiagnoseLoading).toBe(false);
  });

  it('batchCleanup calls batch-cleanup endpoint and refreshes list on success', async () => {
    const cleanupResults = [
      {
        success: true,
        tableName: 'users',
        deletedCount: 10,
        freedBytes: 1000,
        freedFormatted: '1 KB',
        message: 'Done',
        duration: 50,
      },
    ];
    const mockExecute = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ execute: mockExecute })
    );

    const mockFetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        success: true,
        data: { results: cleanupResults },
      }),
    });
    global.fetch = mockFetch;

    const { result } = renderHook(() => useTableManagement());
    let returned: unknown;
    await act(async () => {
      returned = await result.current.batchCleanup();
    });

    expect(returned).toEqual(cleanupResults);
    expect(mockExecute).toHaveBeenCalled();
    expect(result.current.batchCleanupLoading).toBe(false);
  });

  it('batchCleanup returns empty array on error', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
    global.fetch = mockFetch;

    const { result } = renderHook(() => useTableManagement());
    let returned: unknown;
    await act(async () => {
      returned = await result.current.batchCleanup();
    });

    expect(returned).toEqual([]);
    expect(result.current.batchCleanupLoading).toBe(false);
  });

  it('exposes refresh function that calls fetchList', () => {
    const mockExecute = vi.fn();
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ execute: mockExecute })
    );
    const { result } = renderHook(() => useTableManagement());
    act(() => {
      void result.current.refresh();
    });
    expect(mockExecute).toHaveBeenCalled();
  });

  it('passes query params including category and healthStatus to API URL', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    renderHook(() =>
      useTableManagement({
        category: 'USER',
        healthStatus: 'warning',
        search: 'test',
      })
    );
    const callArg = vi.mocked(useApiGet).mock.calls[0][0];
    expect(callArg).toContain('category=USER');
    expect(callArg).toContain('healthStatus=warning');
    expect(callArg).toContain('search=test');
  });
});

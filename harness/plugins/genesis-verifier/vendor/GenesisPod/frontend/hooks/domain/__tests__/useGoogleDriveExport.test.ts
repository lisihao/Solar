import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/services/google-drive/api', () => ({
  exportResources: vi.fn(),
  getExportProgress: vi.fn(),
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public status?: number
    ) {
      super(message);
      this.name = 'ApiError';
    }
  },
}));

vi.mock('@/lib/cache', () => ({
  apiCache: {
    get: vi.fn().mockReturnValue(undefined),
    set: vi.fn(),
    delete: vi.fn(),
    clear: vi.fn(),
    keys: vi.fn().mockReturnValue([]),
  },
}));

vi.mock('../../core', () => ({
  useApiGet: vi.fn(),
  useApiPost: vi.fn(),
  useApiPut: vi.fn(),
  useApiDelete: vi.fn(),
  useApiMutation: vi.fn(),
}));

import { useGoogleDriveExport } from '../useGoogleDriveExport';
import { useApiGet, useApiPost } from '../../core';

const mockUseApiGet = vi.mocked(useApiGet);
const mockUseApiPost = vi.mocked(useApiPost);

const makeApiGetMock = (data?: unknown) => ({
  data,
  loading: false,
  error: null,
  execute: vi.fn().mockResolvedValue(data),
  refresh: vi.fn(),
  reset: vi.fn(),
  setData: vi.fn(),
});

const makeApiPostMock = (
  overrides?: Partial<ReturnType<typeof useApiPost>>
) => ({
  data: undefined,
  loading: false,
  error: null,
  execute: vi.fn().mockResolvedValue({
    exportId: 'export-123',
    totalResources: 2,
    status: 'pending',
    success: true,
  }),
  refresh: vi.fn(),
  reset: vi.fn(),
  setData: vi.fn(),
  ...overrides,
});

const defaultOptions = {
  connectionId: 'conn-123',
};

describe('useGoogleDriveExport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseApiGet.mockReturnValue(makeApiGetMock() as never);
    mockUseApiPost.mockReturnValue(makeApiPostMock() as never);
  });

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useGoogleDriveExport(defaultOptions));

    expect(result.current.exporting).toBe(false);
    expect(result.current.exportId).toBeNull();
    expect(result.current.progress).toBeNull();
    expect(result.current.progressPercent).toBe(0);
    expect(result.current.error).toBeNull();
    expect(result.current.isComplete).toBe(false);
    expect(result.current.hasFailed).toBe(false);
    expect(result.current.canExport).toBe(true);
  });

  it('should throw when exporting with no resources', async () => {
    const { result } = renderHook(() => useGoogleDriveExport(defaultOptions));

    await expect(
      act(async () => {
        await result.current.exportResources([], 'target-folder-id');
      })
    ).rejects.toThrow('No resources selected');
  });

  it('should call executeExport with correct params', async () => {
    const executeMock = vi.fn().mockResolvedValue({
      exportId: 'export-789',
      totalResources: 3,
      status: 'pending',
      success: true,
    });
    mockUseApiPost.mockReturnValue(
      makeApiPostMock({ execute: executeMock }) as never
    );

    const { result } = renderHook(() =>
      useGoogleDriveExport({
        connectionId: 'conn-abc',
        defaultFormat: 'pdf',
      })
    );

    await act(async () => {
      await result.current.exportResources(
        ['res-1', 'res-2'],
        'drive-folder-id',
        'pdf'
      );
    });

    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'conn-abc',
        resourceIds: ['res-1', 'res-2'],
        targetFolderId: 'drive-folder-id',
        format: 'pdf',
      })
    );
  });

  it('should use defaultFormat when no format specified', async () => {
    const executeMock = vi.fn().mockResolvedValue({
      exportId: 'export-abc',
      totalResources: 1,
      status: 'pending',
      success: true,
    });
    mockUseApiPost.mockReturnValue(
      makeApiPostMock({ execute: executeMock }) as never
    );

    const { result } = renderHook(() =>
      useGoogleDriveExport({
        connectionId: 'conn-123',
        defaultFormat: 'docx',
      })
    );

    await act(async () => {
      await result.current.exportResources(['res-1'], 'folder-id');
    });

    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'docx' })
    );
  });

  it('should use original format by default', async () => {
    const executeMock = vi.fn().mockResolvedValue({
      exportId: 'export-default',
      totalResources: 1,
      status: 'pending',
      success: true,
    });
    mockUseApiPost.mockReturnValue(
      makeApiPostMock({ execute: executeMock }) as never
    );

    const { result } = renderHook(() =>
      useGoogleDriveExport({ connectionId: 'conn-123' })
    );

    await act(async () => {
      await result.current.exportResources(['res-1'], 'folder-id');
    });

    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'original' })
    );
  });

  it('should reflect loading state as exporting', () => {
    mockUseApiPost.mockReturnValue(makeApiPostMock({ loading: true }) as never);

    const { result } = renderHook(() => useGoogleDriveExport(defaultOptions));

    expect(result.current.exporting).toBe(true);
    expect(result.current.canExport).toBe(false);
  });

  it('should cancel export and clear exportId', () => {
    const { result } = renderHook(() => useGoogleDriveExport(defaultOptions));

    act(() => {
      result.current.cancelExport();
    });

    expect(result.current.exportId).toBeNull();
  });

  it('should reset state', () => {
    const { result } = renderHook(() => useGoogleDriveExport(defaultOptions));

    act(() => {
      result.current.reset();
    });

    expect(result.current.exportId).toBeNull();
  });

  it('should compute progressPercent correctly', () => {
    mockUseApiGet.mockReturnValue(
      makeApiGetMock({
        progress: {
          exportId: 'export-123',
          status: 'processing',
          totalResources: 10,
          processedResources: 3,
          successCount: 3,
          failedCount: 0,
          errors: [],
          driveFileIds: [],
          targetFolderId: 'folder-id',
          startedAt: '2024-01-01T00:00:00Z',
          completedAt: null,
        },
      }) as never
    );

    const { result } = renderHook(() => useGoogleDriveExport(defaultOptions));

    expect(result.current.progressPercent).toBe(30);
  });

  it('should return 0 progressPercent when totalResources is 0', () => {
    mockUseApiGet.mockReturnValue(
      makeApiGetMock({
        progress: {
          exportId: 'export-123',
          status: 'processing',
          totalResources: 0,
          processedResources: 0,
          successCount: 0,
          failedCount: 0,
          errors: [],
          driveFileIds: [],
          targetFolderId: 'folder-id',
          startedAt: '2024-01-01T00:00:00Z',
          completedAt: null,
        },
      }) as never
    );

    const { result } = renderHook(() => useGoogleDriveExport(defaultOptions));

    expect(result.current.progressPercent).toBe(0);
  });

  it('should reflect isComplete when status is completed', () => {
    mockUseApiGet.mockReturnValue(
      makeApiGetMock({
        progress: {
          exportId: 'export-123',
          status: 'completed',
          totalResources: 2,
          processedResources: 2,
          successCount: 2,
          failedCount: 0,
          errors: [],
          driveFileIds: ['d1', 'd2'],
          targetFolderId: 'folder-id',
          startedAt: '2024-01-01T00:00:00Z',
          completedAt: '2024-01-01T01:00:00Z',
        },
      }) as never
    );

    const { result } = renderHook(() => useGoogleDriveExport(defaultOptions));

    expect(result.current.isComplete).toBe(true);
    expect(result.current.hasFailed).toBe(false);
  });

  it('should reflect hasFailed when status is failed', () => {
    mockUseApiGet.mockReturnValue(
      makeApiGetMock({
        progress: {
          exportId: 'export-123',
          status: 'failed',
          totalResources: 2,
          processedResources: 1,
          successCount: 1,
          failedCount: 1,
          errors: [
            {
              resourceId: 'r2',
              resourceTitle: 'Doc 2',
              error: 'Permission denied',
            },
          ],
          driveFileIds: [],
          targetFolderId: 'folder-id',
          startedAt: '2024-01-01T00:00:00Z',
          completedAt: null,
        },
      }) as never
    );

    const { result } = renderHook(() => useGoogleDriveExport(defaultOptions));

    expect(result.current.hasFailed).toBe(true);
    expect(result.current.isComplete).toBe(false);
  });

  it('should pass custom options to executeExport', async () => {
    const executeMock = vi.fn().mockResolvedValue({
      exportId: 'export-opt',
      totalResources: 1,
      status: 'pending',
      success: true,
    });
    mockUseApiPost.mockReturnValue(
      makeApiPostMock({ execute: executeMock }) as never
    );

    const { result } = renderHook(() => useGoogleDriveExport(defaultOptions));

    await act(async () => {
      await result.current.exportResources(['res-1'], 'folder-id', 'markdown', {
        createFolder: true,
        folderName: 'My Export',
      });
    });

    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        format: 'markdown',
        options: expect.objectContaining({
          createFolder: true,
          folderName: 'My Export',
        }),
      })
    );
  });
});

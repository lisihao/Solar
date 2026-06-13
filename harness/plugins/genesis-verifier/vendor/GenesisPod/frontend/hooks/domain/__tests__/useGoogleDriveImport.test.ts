import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/services/google-drive/api', () => ({
  importFiles: vi.fn(),
  getImportProgress: vi.fn(),
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

import { useGoogleDriveImport } from '../useGoogleDriveImport';
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
    importId: 'import-123',
    totalFiles: 3,
    status: 'pending',
  }),
  refresh: vi.fn(),
  reset: vi.fn(),
  setData: vi.fn(),
  ...overrides,
});

const defaultOptions = {
  connectionId: 'conn-123',
};

describe('useGoogleDriveImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseApiGet.mockReturnValue(makeApiGetMock() as never);
    mockUseApiPost.mockReturnValue(makeApiPostMock() as never);
  });

  it('should initialize with empty selection', () => {
    const { result } = renderHook(() => useGoogleDriveImport(defaultOptions));

    expect(result.current.selectedFiles).toEqual([]);
    expect(result.current.selectedCount).toBe(0);
    expect(result.current.importing).toBe(false);
    expect(result.current.importId).toBeNull();
    expect(result.current.progress).toBeNull();
    expect(result.current.progressPercent).toBe(0);
  });

  it('should select a file', () => {
    const { result } = renderHook(() => useGoogleDriveImport(defaultOptions));

    act(() => {
      result.current.selectFile('file-1');
    });

    expect(result.current.selectedFiles).toContain('file-1');
    expect(result.current.selectedCount).toBe(1);
    expect(result.current.isSelected('file-1')).toBe(true);
  });

  it('should not duplicate file selection', () => {
    const { result } = renderHook(() => useGoogleDriveImport(defaultOptions));

    act(() => {
      result.current.selectFile('file-1');
      result.current.selectFile('file-1');
    });

    expect(result.current.selectedFiles).toHaveLength(1);
  });

  it('should deselect a file', () => {
    const { result } = renderHook(() => useGoogleDriveImport(defaultOptions));

    act(() => {
      result.current.selectFile('file-1');
      result.current.selectFile('file-2');
    });

    act(() => {
      result.current.deselectFile('file-1');
    });

    expect(result.current.selectedFiles).not.toContain('file-1');
    expect(result.current.selectedFiles).toContain('file-2');
    expect(result.current.selectedCount).toBe(1);
  });

  it('should toggle file selection', () => {
    const { result } = renderHook(() => useGoogleDriveImport(defaultOptions));

    act(() => {
      result.current.toggleFile('file-1');
    });
    expect(result.current.isSelected('file-1')).toBe(true);

    act(() => {
      result.current.toggleFile('file-1');
    });
    expect(result.current.isSelected('file-1')).toBe(false);
  });

  it('should select all files', () => {
    const { result } = renderHook(() => useGoogleDriveImport(defaultOptions));

    act(() => {
      result.current.selectAll(['file-1', 'file-2', 'file-3']);
    });

    expect(result.current.selectedFiles).toEqual([
      'file-1',
      'file-2',
      'file-3',
    ]);
    expect(result.current.selectedCount).toBe(3);
  });

  it('should clear selection', () => {
    const { result } = renderHook(() => useGoogleDriveImport(defaultOptions));

    act(() => {
      result.current.selectAll(['file-1', 'file-2']);
    });

    act(() => {
      result.current.clearSelection();
    });

    expect(result.current.selectedFiles).toEqual([]);
    expect(result.current.selectedCount).toBe(0);
  });

  it('should throw when importing with no files selected', async () => {
    const { result } = renderHook(() => useGoogleDriveImport(defaultOptions));

    await expect(
      act(async () => {
        await result.current.importFiles();
      })
    ).rejects.toThrow('No files selected');
  });

  it('should call executeImport with correct params when importing', async () => {
    const executeMock = vi.fn().mockResolvedValue({
      importId: 'import-456',
      totalFiles: 2,
      status: 'pending',
      success: true,
    });
    mockUseApiPost.mockReturnValue(
      makeApiPostMock({ execute: executeMock }) as never
    );

    const { result } = renderHook(() =>
      useGoogleDriveImport({
        connectionId: 'conn-abc',
        targetFolderId: 'folder-xyz',
      })
    );

    act(() => {
      result.current.selectAll(['file-1', 'file-2']);
    });

    await act(async () => {
      await result.current.importFiles();
    });

    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'conn-abc',
        fileIds: ['file-1', 'file-2'],
        targetFolderId: 'folder-xyz',
      })
    );
  });

  it('should indicate canImport only when files are selected and not importing', () => {
    const { result } = renderHook(() => useGoogleDriveImport(defaultOptions));

    expect(result.current.canImport).toBe(false);

    act(() => {
      result.current.selectFile('file-1');
    });

    expect(result.current.canImport).toBe(true);
  });

  it('should cancel import', () => {
    const { result } = renderHook(() => useGoogleDriveImport(defaultOptions));

    act(() => {
      result.current.cancelImport();
    });

    expect(result.current.importId).toBeNull();
  });

  it('should reset to initial state', () => {
    const { result } = renderHook(() => useGoogleDriveImport(defaultOptions));

    act(() => {
      result.current.selectAll(['file-1', 'file-2']);
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.selectedFiles).toEqual([]);
    expect(result.current.importId).toBeNull();
  });

  it('should compute progressPercent correctly', () => {
    mockUseApiGet.mockReturnValue(
      makeApiGetMock({
        progress: {
          importId: 'import-123',
          status: 'processing',
          totalFiles: 4,
          processedFiles: 2,
          successCount: 2,
          failedCount: 0,
          errors: [],
          resourceIds: [],
          startedAt: '2024-01-01T00:00:00Z',
          completedAt: null,
        },
      }) as never
    );

    const { result } = renderHook(() => useGoogleDriveImport(defaultOptions));

    expect(result.current.progressPercent).toBe(50);
  });

  it('should return 0 progressPercent when totalFiles is 0', () => {
    mockUseApiGet.mockReturnValue(
      makeApiGetMock({
        progress: {
          importId: 'import-123',
          status: 'processing',
          totalFiles: 0,
          processedFiles: 0,
          successCount: 0,
          failedCount: 0,
          errors: [],
          resourceIds: [],
          startedAt: '2024-01-01T00:00:00Z',
          completedAt: null,
        },
      }) as never
    );

    const { result } = renderHook(() => useGoogleDriveImport(defaultOptions));

    expect(result.current.progressPercent).toBe(0);
  });

  it('should reflect isComplete and hasFailed from progress status', () => {
    mockUseApiGet.mockReturnValue(
      makeApiGetMock({
        progress: {
          importId: 'import-123',
          status: 'completed',
          totalFiles: 2,
          processedFiles: 2,
          successCount: 2,
          failedCount: 0,
          errors: [],
          resourceIds: ['r1', 'r2'],
          startedAt: '2024-01-01T00:00:00Z',
          completedAt: '2024-01-01T01:00:00Z',
        },
      }) as never
    );

    const { result } = renderHook(() => useGoogleDriveImport(defaultOptions));

    expect(result.current.isComplete).toBe(true);
    expect(result.current.hasFailed).toBe(false);
  });
});

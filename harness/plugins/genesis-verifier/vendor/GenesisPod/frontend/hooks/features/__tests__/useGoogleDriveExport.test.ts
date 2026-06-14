import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

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

vi.mock('@/hooks/core', () => ({
  useApiGet: vi.fn(),
  useApiPost: vi.fn(),
  useApiPut: vi.fn(),
  useApiDelete: vi.fn(),
  useApiMutation: vi.fn(),
}));

import {
  useGoogleDriveExport,
  type Resource,
  type ExportResult,
} from '../useGoogleDriveExport';
import { useApiPost } from '@/hooks/core';

const mockUseApiPost = vi.mocked(useApiPost);

const makeExportResult = (
  overrides: Partial<ExportResult> = {}
): ExportResult => ({
  totalResources: 2,
  exported: 2,
  failed: 0,
  errors: [],
  exportedFiles: [
    {
      resourceId: 'res-1',
      driveFileId: 'drive-1',
      webViewLink: 'https://drive.google.com/1',
    },
    {
      resourceId: 'res-2',
      driveFileId: 'drive-2',
      webViewLink: 'https://drive.google.com/2',
    },
  ],
  ...overrides,
});

const makeApiPostMock = (
  executeResult: ExportResult | null = makeExportResult()
) => ({
  data: undefined,
  loading: false,
  error: null,
  execute:
    executeResult === null
      ? vi.fn().mockResolvedValue(undefined)
      : vi.fn().mockResolvedValue(executeResult),
  refresh: vi.fn(),
  reset: vi.fn(),
  setData: vi.fn(),
});

const makeResources = (): Resource[] => [
  { id: 'res-1', title: 'Document 1' },
  { id: 'res-2', title: 'Document 2' },
];

describe('useGoogleDriveExport (features)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockUseApiPost.mockReturnValue(makeApiPostMock() as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initializes with default state', () => {
    const { result } = renderHook(() => useGoogleDriveExport());

    expect(result.current.isExporting).toBe(false);
    expect(result.current.progress).toEqual([]);
    expect(result.current.totalProgress).toBe(0);
    expect(typeof result.current.exportToDrive).toBe('function');
    expect(typeof result.current.reset).toBe('function');
  });

  it('sets isExporting to true during export', async () => {
    let resolveExport!: (v: ExportResult) => void;
    const exportPromise = new Promise<ExportResult>((resolve) => {
      resolveExport = resolve;
    });

    mockUseApiPost.mockReturnValue({
      ...makeApiPostMock(),
      execute: vi.fn().mockReturnValue(exportPromise),
    } as never);

    const { result } = renderHook(() => useGoogleDriveExport());

    // Start export without awaiting
    act(() => {
      void result.current.exportToDrive(makeResources());
    });

    // isExporting should be true while in progress
    expect(result.current.isExporting).toBe(true);

    // Complete the export
    resolveExport(makeExportResult());
    await act(async () => {
      await exportPromise;
    });

    expect(result.current.isExporting).toBe(false);
  });

  it('initializes progress entries with pending status', async () => {
    let resolveExport!: (v: ExportResult) => void;
    const exportPromise = new Promise<ExportResult>((resolve) => {
      resolveExport = resolve;
    });

    mockUseApiPost.mockReturnValue({
      ...makeApiPostMock(),
      execute: vi.fn().mockReturnValue(exportPromise),
    } as never);

    const resources = makeResources();
    const { result } = renderHook(() => useGoogleDriveExport());

    act(() => {
      void result.current.exportToDrive(resources);
    });

    expect(result.current.progress).toHaveLength(2);
    expect(result.current.progress[0].status).toBe('pending');
    expect(result.current.progress[0].resourceId).toBe('res-1');
    expect(result.current.progress[0].resourceTitle).toBe('Document 1');
    expect(result.current.progress[1].status).toBe('pending');

    resolveExport(makeExportResult());
    await act(async () => {
      await exportPromise;
    });
  });

  it('progress interval changes status to exporting', async () => {
    let resolveExport!: (v: ExportResult) => void;
    const exportPromise = new Promise<ExportResult>((resolve) => {
      resolveExport = resolve;
    });

    mockUseApiPost.mockReturnValue({
      ...makeApiPostMock(),
      execute: vi.fn().mockReturnValue(exportPromise),
    } as never);

    const { result } = renderHook(() => useGoogleDriveExport());

    act(() => {
      void result.current.exportToDrive(makeResources());
    });

    // Advance timer to trigger progress interval
    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(result.current.progress.some((p) => p.status === 'exporting')).toBe(
      true
    );
    expect(result.current.totalProgress).toBeGreaterThan(0);

    resolveExport(makeExportResult());
    await act(async () => {
      await exportPromise;
    });
  });

  it('sets progress to success on successful export', async () => {
    const { result } = renderHook(() => useGoogleDriveExport());

    await act(async () => {
      await result.current.exportToDrive(makeResources());
    });

    expect(result.current.progress).toHaveLength(2);
    expect(result.current.progress[0].status).toBe('success');
    expect(result.current.progress[1].status).toBe('success');
    expect(result.current.totalProgress).toBe(100);
  });

  it('sets progress to failed for resources with errors', async () => {
    const exportResult = makeExportResult({
      exported: 1,
      failed: 1,
      errors: [{ resourceId: 'res-1', error: 'Permission denied' }],
    });

    mockUseApiPost.mockReturnValue({
      ...makeApiPostMock(exportResult),
    } as never);

    const { result } = renderHook(() => useGoogleDriveExport());

    await act(async () => {
      await result.current.exportToDrive(makeResources());
    });

    const res1Progress = result.current.progress.find(
      (p) => p.resourceId === 'res-1'
    );
    const res2Progress = result.current.progress.find(
      (p) => p.resourceId === 'res-2'
    );

    expect(res1Progress?.status).toBe('failed');
    expect(res1Progress?.error).toBe('Permission denied');
    expect(res2Progress?.status).toBe('success');
  });

  it('throws and marks all as failed when API returns no result', async () => {
    mockUseApiPost.mockReturnValue(makeApiPostMock(null) as never);

    const { result } = renderHook(() => useGoogleDriveExport());

    await expect(
      act(async () => {
        await result.current.exportToDrive(makeResources());
      })
    ).rejects.toThrow('Export failed: No response from server');

    expect(result.current.progress.every((p) => p.status === 'failed')).toBe(
      true
    );
    expect(result.current.isExporting).toBe(false);
  });

  it('marks all as failed when API throws an error', async () => {
    mockUseApiPost.mockReturnValue({
      ...makeApiPostMock(),
      execute: vi.fn().mockRejectedValue(new Error('Network failure')),
    } as never);

    const { result } = renderHook(() => useGoogleDriveExport());

    let caughtError: unknown;
    await act(async () => {
      try {
        await result.current.exportToDrive(makeResources());
      } catch (e) {
        caughtError = e;
      }
    });

    expect(caughtError).toBeInstanceOf(Error);
    expect((caughtError as Error).message).toBe('Network failure');
    expect(result.current.progress.every((p) => p.status === 'failed')).toBe(
      true
    );
    expect(result.current.progress[0].error).toBe('Network failure');
    expect(result.current.isExporting).toBe(false);
  });

  it('passes folderId to the export API', async () => {
    const executeMock = vi.fn().mockResolvedValue(makeExportResult());
    mockUseApiPost.mockReturnValue({
      ...makeApiPostMock(),
      execute: executeMock,
    } as never);

    const { result } = renderHook(() => useGoogleDriveExport());

    await act(async () => {
      await result.current.exportToDrive(makeResources(), {
        folderId: 'target-folder-id',
      });
    });

    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        folderId: 'target-folder-id',
      })
    );
  });

  it('uses default format original when not specified', async () => {
    const executeMock = vi.fn().mockResolvedValue(makeExportResult());
    mockUseApiPost.mockReturnValue({
      ...makeApiPostMock(),
      execute: executeMock,
    } as never);

    const { result } = renderHook(() => useGoogleDriveExport());

    await act(async () => {
      await result.current.exportToDrive(makeResources());
    });

    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        format: 'original',
      })
    );
  });

  it('passes specified format to the export API', async () => {
    const executeMock = vi.fn().mockResolvedValue(makeExportResult());
    mockUseApiPost.mockReturnValue({
      ...makeApiPostMock(),
      execute: executeMock,
    } as never);

    const { result } = renderHook(() => useGoogleDriveExport());

    await act(async () => {
      await result.current.exportToDrive(makeResources(), { format: 'pdf' });
    });

    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'pdf' })
    );
  });

  it('passes resource IDs to the export API', async () => {
    const executeMock = vi.fn().mockResolvedValue(makeExportResult());
    mockUseApiPost.mockReturnValue({
      ...makeApiPostMock(),
      execute: executeMock,
    } as never);

    const { result } = renderHook(() => useGoogleDriveExport());

    await act(async () => {
      await result.current.exportToDrive(makeResources());
    });

    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceIds: ['res-1', 'res-2'],
      })
    );
  });

  it('reset clears all state', async () => {
    const { result } = renderHook(() => useGoogleDriveExport());

    await act(async () => {
      await result.current.exportToDrive(makeResources());
    });

    expect(result.current.progress).toHaveLength(2);
    expect(result.current.totalProgress).toBe(100);

    act(() => {
      result.current.reset();
    });

    expect(result.current.isExporting).toBe(false);
    expect(result.current.progress).toEqual([]);
    expect(result.current.totalProgress).toBe(0);
  });

  it('passes createFolders option to the API', async () => {
    const executeMock = vi.fn().mockResolvedValue(makeExportResult());
    mockUseApiPost.mockReturnValue({
      ...makeApiPostMock(),
      execute: executeMock,
    } as never);

    const { result } = renderHook(() => useGoogleDriveExport());

    await act(async () => {
      await result.current.exportToDrive(makeResources(), {
        createFolders: true,
        fileNamePrefix: 'export-',
      });
    });

    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        createFolders: true,
        fileNamePrefix: 'export-',
      })
    );
  });
});

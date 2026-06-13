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
  useGoogleDriveImport,
  type GoogleDriveFile,
  type ImportResult,
} from '../useGoogleDriveImport';
import { useApiPost } from '@/hooks/core';

const mockUseApiPost = vi.mocked(useApiPost);

const makeImportResult = (
  overrides: Partial<ImportResult> = {}
): ImportResult => ({
  totalFiles: 2,
  imported: 2,
  failed: 0,
  errors: [],
  ...overrides,
});

const makeApiPostMock = (
  executeResult: ImportResult | null = makeImportResult()
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

const makeFiles = (): GoogleDriveFile[] => [
  {
    id: 'file-1',
    name: 'Report.pdf',
    mimeType: 'application/pdf',
    size: 2048,
    createdTime: '2024-01-01T00:00:00Z',
    modifiedTime: '2024-01-02T00:00:00Z',
  },
  {
    id: 'file-2',
    name: 'Notes.docx',
    mimeType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size: 512,
  },
];

describe('useGoogleDriveImport (features)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockUseApiPost.mockReturnValue(makeApiPostMock() as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initializes with default state', () => {
    const { result } = renderHook(() => useGoogleDriveImport());

    expect(result.current.isImporting).toBe(false);
    expect(result.current.progress).toEqual([]);
    expect(result.current.totalProgress).toBe(0);
    expect(typeof result.current.importFromDrive).toBe('function');
    expect(typeof result.current.reset).toBe('function');
  });

  it('sets isImporting to true during import', async () => {
    let resolveImport!: (v: ImportResult) => void;
    const importPromise = new Promise<ImportResult>((resolve) => {
      resolveImport = resolve;
    });

    mockUseApiPost.mockReturnValue({
      ...makeApiPostMock(),
      execute: vi.fn().mockReturnValue(importPromise),
    } as never);

    const { result } = renderHook(() => useGoogleDriveImport());

    act(() => {
      void result.current.importFromDrive(makeFiles());
    });

    expect(result.current.isImporting).toBe(true);

    resolveImport(makeImportResult());
    await act(async () => {
      await importPromise;
    });

    expect(result.current.isImporting).toBe(false);
  });

  it('initializes progress entries with pending status', async () => {
    let resolveImport!: (v: ImportResult) => void;
    const importPromise = new Promise<ImportResult>((resolve) => {
      resolveImport = resolve;
    });

    mockUseApiPost.mockReturnValue({
      ...makeApiPostMock(),
      execute: vi.fn().mockReturnValue(importPromise),
    } as never);

    const files = makeFiles();
    const { result } = renderHook(() => useGoogleDriveImport());

    act(() => {
      void result.current.importFromDrive(files);
    });

    expect(result.current.progress).toHaveLength(2);
    expect(result.current.progress[0].status).toBe('pending');
    expect(result.current.progress[0].fileId).toBe('file-1');
    expect(result.current.progress[0].fileName).toBe('Report.pdf');
    expect(result.current.progress[1].status).toBe('pending');

    resolveImport(makeImportResult());
    await act(async () => {
      await importPromise;
    });
  });

  it('progress interval changes pending to importing status', async () => {
    let resolveImport!: (v: ImportResult) => void;
    const importPromise = new Promise<ImportResult>((resolve) => {
      resolveImport = resolve;
    });

    mockUseApiPost.mockReturnValue({
      ...makeApiPostMock(),
      execute: vi.fn().mockReturnValue(importPromise),
    } as never);

    const { result } = renderHook(() => useGoogleDriveImport());

    act(() => {
      void result.current.importFromDrive(makeFiles());
    });

    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(result.current.progress.some((p) => p.status === 'importing')).toBe(
      true
    );
    expect(result.current.totalProgress).toBeGreaterThan(0);

    resolveImport(makeImportResult());
    await act(async () => {
      await importPromise;
    });
  });

  it('totalProgress increments with interval but caps at 90', async () => {
    let resolveImport!: (v: ImportResult) => void;
    const importPromise = new Promise<ImportResult>((resolve) => {
      resolveImport = resolve;
    });

    mockUseApiPost.mockReturnValue({
      ...makeApiPostMock(),
      execute: vi.fn().mockReturnValue(importPromise),
    } as never);

    const { result } = renderHook(() => useGoogleDriveImport());

    act(() => {
      void result.current.importFromDrive(makeFiles());
    });

    // Advance timer 10 intervals (10 * 10% = 100% but caps at 90)
    act(() => {
      vi.advanceTimersByTime(5500);
    });

    expect(result.current.totalProgress).toBeLessThanOrEqual(90);

    resolveImport(makeImportResult());
    await act(async () => {
      await importPromise;
    });
  });

  it('sets progress to success on successful import', async () => {
    const { result } = renderHook(() => useGoogleDriveImport());

    await act(async () => {
      await result.current.importFromDrive(makeFiles());
    });

    expect(result.current.progress).toHaveLength(2);
    expect(result.current.progress[0].status).toBe('success');
    expect(result.current.progress[1].status).toBe('success');
    expect(result.current.totalProgress).toBe(100);
  });

  it('marks files with errors as failed', async () => {
    const importResult = makeImportResult({
      imported: 1,
      failed: 1,
      errors: [{ fileId: 'file-1', error: 'File too large' }],
    });

    mockUseApiPost.mockReturnValue({
      ...makeApiPostMock(importResult),
    } as never);

    const { result } = renderHook(() => useGoogleDriveImport());

    await act(async () => {
      await result.current.importFromDrive(makeFiles());
    });

    const file1Progress = result.current.progress.find(
      (p) => p.fileId === 'file-1'
    );
    const file2Progress = result.current.progress.find(
      (p) => p.fileId === 'file-2'
    );

    expect(file1Progress?.status).toBe('failed');
    expect(file1Progress?.error).toBe('File too large');
    expect(file2Progress?.status).toBe('success');
  });

  it('throws and marks all as failed when API returns no result', async () => {
    mockUseApiPost.mockReturnValue(makeApiPostMock(null) as never);

    const { result } = renderHook(() => useGoogleDriveImport());

    await expect(
      act(async () => {
        await result.current.importFromDrive(makeFiles());
      })
    ).rejects.toThrow('Import failed: No response from server');

    expect(result.current.progress.every((p) => p.status === 'failed')).toBe(
      true
    );
    expect(result.current.isImporting).toBe(false);
  });

  it('marks all as failed when API throws an error', async () => {
    mockUseApiPost.mockReturnValue({
      ...makeApiPostMock(),
      execute: vi.fn().mockRejectedValue(new Error('Connection refused')),
    } as never);

    const { result } = renderHook(() => useGoogleDriveImport());

    let caughtError: unknown;
    await act(async () => {
      try {
        await result.current.importFromDrive(makeFiles());
      } catch (e) {
        caughtError = e;
      }
    });

    expect(caughtError).toBeInstanceOf(Error);
    expect((caughtError as Error).message).toBe('Connection refused');
    expect(result.current.progress.every((p) => p.status === 'failed')).toBe(
      true
    );
    expect(result.current.progress[0].error).toBe('Connection refused');
    expect(result.current.isImporting).toBe(false);
  });

  it('marks all as failed with generic message for non-Error throws', async () => {
    mockUseApiPost.mockReturnValue({
      ...makeApiPostMock(),
      execute: vi.fn().mockRejectedValue('string error'),
    } as never);

    const { result } = renderHook(() => useGoogleDriveImport());

    let caughtError: unknown;
    await act(async () => {
      try {
        await result.current.importFromDrive(makeFiles());
      } catch (e) {
        caughtError = e;
      }
    });

    expect(caughtError).toBe('string error');
    expect(result.current.progress[0].error).toBe('Import failed');
  });

  it('passes fileIds and options to the import API', async () => {
    const executeMock = vi.fn().mockResolvedValue(makeImportResult());
    mockUseApiPost.mockReturnValue({
      ...makeApiPostMock(),
      execute: executeMock,
    } as never);

    const { result } = renderHook(() => useGoogleDriveImport());

    await act(async () => {
      await result.current.importFromDrive(makeFiles(), {
        extractContent: true,
        generateSummary: true,
        collectionId: 'col-123',
        tags: ['research', 'report'],
      });
    });

    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fileIds: ['file-1', 'file-2'],
        extractContent: true,
        generateSummary: true,
        collectionId: 'col-123',
        tags: ['research', 'report'],
      })
    );
  });

  it('uses default options when not specified', async () => {
    const executeMock = vi.fn().mockResolvedValue(makeImportResult());
    mockUseApiPost.mockReturnValue({
      ...makeApiPostMock(),
      execute: executeMock,
    } as never);

    const { result } = renderHook(() => useGoogleDriveImport());

    await act(async () => {
      await result.current.importFromDrive(makeFiles());
    });

    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        extractContent: true,
        generateSummary: false,
      })
    );
  });

  it('reset clears all state', async () => {
    const { result } = renderHook(() => useGoogleDriveImport());

    await act(async () => {
      await result.current.importFromDrive(makeFiles());
    });

    expect(result.current.progress).toHaveLength(2);
    expect(result.current.totalProgress).toBe(100);

    act(() => {
      result.current.reset();
    });

    expect(result.current.isImporting).toBe(false);
    expect(result.current.progress).toEqual([]);
    expect(result.current.totalProgress).toBe(0);
  });

  it('returns import result from importFromDrive', async () => {
    const importResult = makeImportResult({ totalFiles: 3, imported: 3 });
    mockUseApiPost.mockReturnValue({
      ...makeApiPostMock(importResult),
    } as never);

    const { result } = renderHook(() => useGoogleDriveImport());

    let returnValue!: ImportResult;
    await act(async () => {
      returnValue = await result.current.importFromDrive(makeFiles());
    });

    expect(returnValue.totalFiles).toBe(3);
    expect(returnValue.imported).toBe(3);
  });
});

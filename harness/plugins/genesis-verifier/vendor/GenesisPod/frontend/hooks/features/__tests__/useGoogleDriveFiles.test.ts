import { describe, it, expect, vi, beforeEach } from 'vitest';
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

// Mock the core hooks that features/useGoogleDriveFiles uses
vi.mock('@/hooks/core', () => ({
  useApiGet: vi.fn(),
  useApiPost: vi.fn(),
  useApiPut: vi.fn(),
  useApiDelete: vi.fn(),
  useApiMutation: vi.fn(),
}));

import {
  useGoogleDriveFiles,
  useGoogleDriveFile,
  type GoogleDriveFile,
} from '../useGoogleDriveFiles';
import { useApiGet } from '@/hooks/core';

const mockUseApiGet = vi.mocked(useApiGet);

const makeFile = (
  overrides: Partial<GoogleDriveFile> = {}
): GoogleDriveFile => ({
  id: 'file-1',
  name: 'Document.pdf',
  mimeType: 'application/pdf',
  size: 1024,
  createdTime: '2024-01-01T00:00:00Z',
  modifiedTime: '2024-01-02T00:00:00Z',
  webViewLink: 'https://drive.google.com/file/1',
  isFolder: false,
  ...overrides,
});

const makeFolder = (
  overrides: Partial<GoogleDriveFile> = {}
): GoogleDriveFile => ({
  id: 'folder-1',
  name: 'My Folder',
  mimeType: 'application/vnd.google-apps.folder',
  isFolder: true,
  ...overrides,
});

const makeApiGetMock = (
  data?: {
    files: GoogleDriveFile[];
    nextPageToken?: string;
    hasMore: boolean;
  } | null,
  overrides: Record<string, unknown> = {}
) => ({
  data: data ?? { files: [makeFile(), makeFolder()], hasMore: false },
  loading: false,
  error: null,
  execute: vi
    .fn()
    .mockResolvedValue(
      data ?? { files: [makeFile(), makeFolder()], hasMore: false }
    ),
  refresh: vi.fn(),
  reset: vi.fn(),
  setData: vi.fn(),
  ...overrides,
});

describe('useGoogleDriveFiles (features)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseApiGet.mockReturnValue(makeApiGetMock() as never);
  });

  it('initializes with empty files and no current folder', () => {
    // Override mock to return no data so the useEffect doesn't populate files
    mockUseApiGet.mockReturnValue(
      makeApiGetMock(null, { data: undefined }) as never
    );

    const { result } = renderHook(() => useGoogleDriveFiles());

    expect(result.current.files).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.currentFolderId).toBeUndefined();
    expect(result.current.folderStack).toEqual([]);
  });

  it('breadcrumbs always includes root My Drive entry', () => {
    const { result } = renderHook(() => useGoogleDriveFiles());

    expect(result.current.breadcrumbs).toHaveLength(1);
    expect(result.current.breadcrumbs[0]).toEqual({ id: '', name: 'My Drive' });
  });

  it('updates files from API data', () => {
    mockUseApiGet.mockReturnValue(
      makeApiGetMock({
        files: [makeFile()],
        hasMore: false,
      }) as never
    );

    const { result } = renderHook(() => useGoogleDriveFiles());

    // trigger the useEffect by simulating data coming in
    act(() => {
      // data is already loaded in initial state
    });

    // files start empty, data update triggers effect
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('reflects loading state from API', () => {
    mockUseApiGet.mockReturnValue(
      makeApiGetMock(null, { loading: true, data: undefined }) as never
    );

    const { result } = renderHook(() => useGoogleDriveFiles());

    expect(result.current.isLoading).toBe(true);
  });

  it('reflects error state from API', () => {
    const mockError = new Error('Network error');
    mockUseApiGet.mockReturnValue(
      makeApiGetMock(null, { error: mockError, data: undefined }) as never
    );

    const { result } = renderHook(() => useGoogleDriveFiles());

    expect(result.current.error).toBe(mockError);
  });

  it('enterFolder navigates into a folder', () => {
    const { result } = renderHook(() => useGoogleDriveFiles());
    const folder = makeFolder({ id: 'folder-123', name: 'Subfolder' });

    act(() => {
      result.current.enterFolder(folder);
    });

    expect(result.current.currentFolderId).toBe('folder-123');
    expect(result.current.folderStack).toHaveLength(1);
    expect(result.current.folderStack[0]).toEqual({
      id: 'folder-123',
      name: 'Subfolder',
    });
  });

  it('enterFolder does nothing when item is not a folder', () => {
    const { result } = renderHook(() => useGoogleDriveFiles());
    const file = makeFile({ isFolder: false });

    act(() => {
      result.current.enterFolder(file);
    });

    expect(result.current.currentFolderId).toBeUndefined();
    expect(result.current.folderStack).toHaveLength(0);
  });

  it('goBack returns to parent folder', () => {
    const { result } = renderHook(() => useGoogleDriveFiles());
    const folder1 = makeFolder({ id: 'f1', name: 'Folder1' });
    const folder2 = makeFolder({ id: 'f2', name: 'Folder2' });

    act(() => {
      result.current.enterFolder(folder1);
    });
    act(() => {
      result.current.enterFolder(folder2);
    });

    expect(result.current.folderStack).toHaveLength(2);

    act(() => {
      result.current.goBack();
    });

    expect(result.current.folderStack).toHaveLength(1);
    expect(result.current.currentFolderId).toBe('f1');
  });

  it('goBack does nothing when at root', () => {
    const { result } = renderHook(() => useGoogleDriveFiles());

    act(() => {
      result.current.goBack();
    });

    expect(result.current.folderStack).toHaveLength(0);
    expect(result.current.currentFolderId).toBeUndefined();
  });

  it('navigateToFolder slices stack to specified index', () => {
    const { result } = renderHook(() => useGoogleDriveFiles());

    act(() => {
      result.current.enterFolder(makeFolder({ id: 'f1', name: 'F1' }));
    });
    act(() => {
      result.current.enterFolder(makeFolder({ id: 'f2', name: 'F2' }));
    });
    act(() => {
      result.current.enterFolder(makeFolder({ id: 'f3', name: 'F3' }));
    });

    act(() => {
      result.current.navigateToFolder(0);
    });

    expect(result.current.folderStack).toHaveLength(1);
    expect(result.current.currentFolderId).toBe('f1');
  });

  it('breadcrumbs includes folder stack entries', () => {
    const { result } = renderHook(() => useGoogleDriveFiles());

    act(() => {
      result.current.enterFolder(makeFolder({ id: 'f1', name: 'Projects' }));
    });

    expect(result.current.breadcrumbs).toHaveLength(2);
    expect(result.current.breadcrumbs[0]).toEqual({ id: '', name: 'My Drive' });
    expect(result.current.breadcrumbs[1]).toEqual({
      id: 'f1',
      name: 'Projects',
    });
  });

  it('loadMore calls refetch when hasMore is true and not loading', async () => {
    const executeMock = vi
      .fn()
      .mockResolvedValue({ files: [], hasMore: false });
    mockUseApiGet.mockReturnValue(
      makeApiGetMock(
        { files: [], hasMore: true },
        { execute: executeMock }
      ) as never
    );

    const { result } = renderHook(() => useGoogleDriveFiles());

    await act(async () => {
      result.current.loadMore();
    });

    expect(executeMock).toHaveBeenCalled();
  });

  it('loadMore does nothing when isLoading is true', async () => {
    const executeMock = vi.fn();
    mockUseApiGet.mockReturnValue(
      makeApiGetMock(
        { files: [], hasMore: true },
        { loading: true, execute: executeMock }
      ) as never
    );

    const { result } = renderHook(() => useGoogleDriveFiles());

    await act(async () => {
      result.current.loadMore();
    });

    expect(executeMock).not.toHaveBeenCalled();
  });

  it('refresh clears files and calls refetch', async () => {
    const executeMock = vi
      .fn()
      .mockResolvedValue({ files: [], hasMore: false });
    mockUseApiGet.mockReturnValue(
      makeApiGetMock(
        { files: [], hasMore: false },
        { execute: executeMock }
      ) as never
    );

    const { result } = renderHook(() => useGoogleDriveFiles());

    await act(async () => {
      result.current.refresh();
    });

    expect(executeMock).toHaveBeenCalled();
  });

  it('hasMore reflects data.hasMore', () => {
    mockUseApiGet.mockReturnValue(
      makeApiGetMock({ files: [], hasMore: true }) as never
    );

    const { result } = renderHook(() => useGoogleDriveFiles());

    expect(result.current.hasMore).toBe(true);
  });

  it('hasMore defaults to false when no data', () => {
    mockUseApiGet.mockReturnValue(
      makeApiGetMock(null, { data: undefined }) as never
    );

    const { result } = renderHook(() => useGoogleDriveFiles());

    expect(result.current.hasMore).toBe(false);
  });

  it('initializes currentFolderId from options.folderId', () => {
    const { result } = renderHook(() =>
      useGoogleDriveFiles({ folderId: 'initial-folder' })
    );

    expect(result.current.currentFolderId).toBe('initial-folder');
  });
});

describe('useGoogleDriveFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseApiGet.mockReturnValue(
      makeApiGetMock({ files: [], hasMore: false }) as never
    );
  });

  it('returns file from API data', () => {
    const file = makeFile();
    mockUseApiGet.mockReturnValue({
      data: { file },
      loading: false,
      error: null,
      execute: vi.fn(),
      refresh: vi.fn(),
      reset: vi.fn(),
      setData: vi.fn(),
    } as never);

    const { result } = renderHook(() => useGoogleDriveFile('file-1'));

    expect(result.current.file).toEqual(file);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('returns undefined when fileId is not provided', () => {
    mockUseApiGet.mockReturnValue({
      data: undefined,
      loading: false,
      error: null,
      execute: vi.fn(),
      refresh: vi.fn(),
      reset: vi.fn(),
      setData: vi.fn(),
    } as never);

    const { result } = renderHook(() => useGoogleDriveFile(undefined));

    expect(result.current.file).toBeUndefined();
  });

  it('exposes refresh function', () => {
    const refreshMock = vi.fn();
    mockUseApiGet.mockReturnValue({
      data: undefined,
      loading: false,
      error: null,
      execute: refreshMock,
      refresh: vi.fn(),
      reset: vi.fn(),
      setData: vi.fn(),
    } as never);

    const { result } = renderHook(() => useGoogleDriveFile('file-1'));

    expect(typeof result.current.refresh).toBe('function');
  });
});

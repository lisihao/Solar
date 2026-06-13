import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock dependencies before importing the hook
vi.mock('@/services/google-drive/api', () => ({
  listFiles: vi.fn(),
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/utils/config', () => ({
  config: { apiUrl: 'http://test-api', apiBaseUrl: 'http://test-api' },
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

// Mock the core hooks
vi.mock('../../core', () => ({
  useApiGet: vi.fn(),
  useApiPost: vi.fn(),
  useApiPut: vi.fn(),
  useApiDelete: vi.fn(),
  useApiMutation: vi.fn(),
}));

import { useGoogleDriveFiles } from '../useGoogleDriveFiles';
import { useApiGet } from '../../core';
import type { ListFilesResponse } from '@/services/google-drive/api';

const mockUseApiGet = vi.mocked(useApiGet);

const makeMockFiles = (): ListFilesResponse => ({
  files: [
    {
      id: 'file1',
      driveFileId: 'drive1',
      name: 'Document.pdf',
      mimeType: 'application/pdf',
      size: 1024,
      iconUrl: null,
      thumbnailUrl: null,
      webViewLink: 'http://drive.google.com/file1',
      webContentLink: null,
      parentId: null,
      isFolder: false,
      description: null,
      driveCreatedAt: '2024-01-01T00:00:00Z',
      driveModifiedAt: '2024-01-01T00:00:00Z',
      syncStatus: 'SUCCESS',
      lastSyncedAt: null,
      linkedResourceId: null,
    },
    {
      id: 'folder1',
      driveFileId: 'driveFolder1',
      name: 'My Folder',
      mimeType: 'application/vnd.google-apps.folder',
      size: 0,
      iconUrl: null,
      thumbnailUrl: null,
      webViewLink: 'http://drive.google.com/folder1',
      webContentLink: null,
      parentId: null,
      isFolder: true,
      description: null,
      driveCreatedAt: '2024-01-01T00:00:00Z',
      driveModifiedAt: '2024-01-01T00:00:00Z',
      syncStatus: 'SUCCESS',
      lastSyncedAt: null,
      linkedResourceId: null,
    },
  ],
  pagination: { page: 1, limit: 50, total: 2, totalPages: 1 },
  folderPath: [],
});

const makeDefaultApiGetMock = (data?: ListFilesResponse) => ({
  data: data ?? makeMockFiles(),
  loading: false,
  error: null,
  execute: vi.fn().mockResolvedValue(data ?? makeMockFiles()),
  refresh: vi.fn(),
  reset: vi.fn(),
  setData: vi.fn(),
});

describe('useGoogleDriveFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseApiGet.mockReturnValue(makeDefaultApiGetMock());
  });

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useGoogleDriveFiles());

    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(50);
    expect(result.current.searchQuery).toBe('');
    expect(result.current.sortBy).toBe('name');
    expect(result.current.sortOrder).toBe('asc');
    expect(result.current.currentFolderId).toBeNull();
  });

  it('should return files and folders from API data', () => {
    const { result } = renderHook(() => useGoogleDriveFiles());

    expect(result.current.files).toHaveLength(2);
    expect(result.current.folders).toHaveLength(1);
    expect(result.current.folders[0].name).toBe('My Folder');
    expect(result.current.allItems).toHaveLength(2);
  });

  it('should separate folders from files', () => {
    const { result } = renderHook(() => useGoogleDriveFiles());

    const folders = result.current.folders;
    const nonFolderFiles = result.current.files.filter((f) => !f.isFolder);

    expect(folders.every((f) => f.isFolder)).toBe(true);
    expect(nonFolderFiles.every((f) => !f.isFolder)).toBe(true);
  });

  it('should reflect loading state from useApiGet', () => {
    mockUseApiGet.mockReturnValue({
      ...makeDefaultApiGetMock(),
      loading: true,
      data: undefined,
    });

    const { result } = renderHook(() => useGoogleDriveFiles());
    expect(result.current.loading).toBe(true);
  });

  it('should reflect error state from useApiGet', () => {
    const mockError = { message: 'Network error', status: 500 };
    mockUseApiGet.mockReturnValue({
      ...makeDefaultApiGetMock(),
      error: mockError as never,
      data: undefined,
    });

    const { result } = renderHook(() => useGoogleDriveFiles());
    expect(result.current.error).toEqual(mockError);
  });

  it('should navigate to a folder', () => {
    const { result } = renderHook(() => useGoogleDriveFiles());

    act(() => {
      result.current.navigateToFolder('folder-123');
    });

    expect(result.current.currentFolderId).toBe('folder-123');
    expect(result.current.page).toBe(1);
    expect(result.current.searchQuery).toBe('');
  });

  it('should navigate to null (root) when navigateToFolder called with null', () => {
    const { result } = renderHook(() =>
      useGoogleDriveFiles({ initialParentId: 'some-folder' })
    );

    act(() => {
      result.current.navigateToFolder(null);
    });

    expect(result.current.currentFolderId).toBeNull();
  });

  it('should set search query and reset page', () => {
    const { result } = renderHook(() => useGoogleDriveFiles());

    act(() => {
      result.current.setSearch('my document');
    });

    expect(result.current.searchQuery).toBe('my document');
    expect(result.current.page).toBe(1);
  });

  it('should set sorting and toggle direction for same field', () => {
    const { result } = renderHook(() =>
      useGoogleDriveFiles({ defaultSortBy: 'name', defaultSortOrder: 'asc' })
    );

    act(() => {
      result.current.setSorting('name');
    });

    expect(result.current.sortBy).toBe('name');
    expect(result.current.sortOrder).toBe('desc'); // toggled from asc
  });

  it('should set sorting with explicit order', () => {
    const { result } = renderHook(() => useGoogleDriveFiles());

    act(() => {
      result.current.setSorting('modifiedTime', 'desc');
    });

    expect(result.current.sortBy).toBe('modifiedTime');
    expect(result.current.sortOrder).toBe('desc');
  });

  it('should load more by incrementing page when hasMore is true', () => {
    mockUseApiGet.mockReturnValue({
      ...makeDefaultApiGetMock({
        files: makeMockFiles().files,
        pagination: { page: 1, limit: 50, total: 100, totalPages: 2 },
        folderPath: [],
      }),
      loading: false,
      error: null,
      execute: vi.fn(),
      refresh: vi.fn(),
      reset: vi.fn(),
      setData: vi.fn(),
    });

    const { result } = renderHook(() => useGoogleDriveFiles());

    expect(result.current.hasMore).toBe(true);

    act(() => {
      result.current.loadMore();
    });

    expect(result.current.page).toBe(2);
  });

  it('should not load more when loading is true', () => {
    mockUseApiGet.mockReturnValue({
      ...makeDefaultApiGetMock({
        files: [],
        pagination: { page: 1, limit: 50, total: 100, totalPages: 2 },
        folderPath: [],
      }),
      loading: true,
    });

    const { result } = renderHook(() => useGoogleDriveFiles());

    act(() => {
      result.current.loadMore();
    });

    expect(result.current.page).toBe(1);
  });

  it('should call execute on refresh', async () => {
    const executeMock = vi.fn().mockResolvedValue(makeMockFiles());
    mockUseApiGet.mockReturnValue({
      ...makeDefaultApiGetMock(),
      execute: executeMock,
    });

    const { result } = renderHook(() => useGoogleDriveFiles());

    await act(async () => {
      await result.current.refresh();
    });

    expect(executeMock).toHaveBeenCalled();
  });

  it('should find file by id with getFileById', () => {
    const { result } = renderHook(() => useGoogleDriveFiles());

    const found = result.current.getFileById('file1');
    expect(found?.name).toBe('Document.pdf');

    const notFound = result.current.getFileById('nonexistent');
    expect(notFound).toBeUndefined();
  });

  it('should correctly identify folders with isFolder helper', () => {
    const { result } = renderHook(() => useGoogleDriveFiles());

    const files = result.current.files;
    const folder = files.find((f) => f.isFolder);
    const file = files.find((f) => !f.isFolder);

    expect(result.current.isFolder(folder!)).toBe(true);
    expect(result.current.isFolder(file!)).toBe(false);
  });

  it('should return empty arrays when no data', () => {
    mockUseApiGet.mockReturnValue({
      ...makeDefaultApiGetMock(),
      data: undefined,
    });

    const { result } = renderHook(() => useGoogleDriveFiles());

    expect(result.current.files).toEqual([]);
    expect(result.current.folders).toEqual([]);
    expect(result.current.allItems).toEqual([]);
    expect(result.current.folderPath).toEqual([]);
  });

  it('should calculate canGoBack based on folderPath', () => {
    mockUseApiGet.mockReturnValue({
      ...makeDefaultApiGetMock({
        files: [],
        pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
        folderPath: [{ id: 'p1', name: 'Parent', driveFileId: 'drive-p1' }],
      }),
    });

    const { result } = renderHook(() => useGoogleDriveFiles());
    expect(result.current.canGoBack).toBe(true);
  });

  it('should navigate back to parent folder', () => {
    mockUseApiGet.mockReturnValue({
      ...makeDefaultApiGetMock({
        files: [],
        pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
        folderPath: [
          { id: 'root', name: 'Root', driveFileId: 'drive-root' },
          { id: 'child', name: 'Child', driveFileId: 'drive-child' },
        ],
      }),
    });

    const { result } = renderHook(() => useGoogleDriveFiles());

    act(() => {
      result.current.navigateBack();
    });

    expect(result.current.currentFolderId).toBe('drive-root');
  });

  it('should use initialParentId as starting folder', () => {
    const { result } = renderHook(() =>
      useGoogleDriveFiles({ initialParentId: 'my-parent-folder' })
    );

    expect(result.current.currentFolderId).toBe('my-parent-folder');
  });
});

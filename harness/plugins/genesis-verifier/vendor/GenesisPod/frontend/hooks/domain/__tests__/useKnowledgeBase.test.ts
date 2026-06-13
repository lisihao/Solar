import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/hooks/core', () => ({
  useApiGet: vi.fn(),
  useApiPost: vi.fn(),
  useApiMutation: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

import { useApiGet, useApiPost, useApiMutation } from '@/hooks/core';
import { apiClient } from '@/lib/api/client';
import {
  useKnowledgeBase,
  useKnowledgeBaseDetail,
  useGoogleDriveFolders,
  useRAGQuery,
} from '../useKnowledgeBase';

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

describe('useKnowledgeBase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty list and loading:false in initial state', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet({ data: [] }));
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());
    const { result } = renderHook(() => useKnowledgeBase());
    expect(result.current.knowledgeBases).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.creating).toBe(false);
    expect(result.current.deleting).toBe(false);
  });

  it('returns knowledge bases when API responds', () => {
    const mockKBs = [
      {
        id: 'kb-1',
        name: 'Test KB',
        sourceType: 'MANUAL',
        status: 'READY',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    ];
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet({ data: mockKBs }));
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());
    const { result } = renderHook(() => useKnowledgeBase());
    expect(result.current.knowledgeBases).toEqual(mockKBs);
  });

  it('calls the correct API endpoint for listing', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet({ data: [] }));
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());
    renderHook(() => useKnowledgeBase());
    expect(vi.mocked(useApiGet)).toHaveBeenCalledWith(
      '/rag/knowledge-bases',
      expect.objectContaining({ immediate: true, initialData: [] })
    );
  });

  it('reflects loading state from useApiGet', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet({ loading: true }));
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());
    const { result } = renderHook(() => useKnowledgeBase());
    expect(result.current.loading).toBe(true);
  });

  it('createKnowledgeBase calls post execute and then refreshes list', async () => {
    const mockFetchList = vi.fn().mockResolvedValue(undefined);
    const mockCreateExecute = vi
      .fn()
      .mockResolvedValue({ id: 'kb-new', name: 'New KB' });
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ execute: mockFetchList })
    );
    vi.mocked(useApiPost).mockReturnValue(
      makeDefaultMutation({ execute: mockCreateExecute })
    );

    const { result } = renderHook(() => useKnowledgeBase());
    await act(async () => {
      await result.current.createKnowledgeBase({
        name: 'New KB',
        sourceType: 'MANUAL',
      });
    });
    expect(mockCreateExecute).toHaveBeenCalledWith({
      name: 'New KB',
      sourceType: 'MANUAL',
    });
    expect(mockFetchList).toHaveBeenCalled();
  });

  it('deleteKnowledgeBase calls apiClient.delete and refreshes list', async () => {
    const mockFetchList = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ execute: mockFetchList })
    );
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());
    vi.mocked(apiClient.delete).mockResolvedValue(undefined);

    const { result } = renderHook(() => useKnowledgeBase());
    await act(async () => {
      await result.current.deleteKnowledgeBase('kb-1');
    });
    expect(apiClient.delete).toHaveBeenCalledWith('/rag/knowledge-bases/kb-1');
    expect(mockFetchList).toHaveBeenCalled();
  });

  it('sets deleting=true during deleteKnowledgeBase and false after', async () => {
    let resolveDelete: () => void;
    const deletePromise = new Promise<void>((res) => {
      resolveDelete = res;
    });
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet({ execute: vi.fn() }));
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());
    vi.mocked(apiClient.delete).mockReturnValue(
      deletePromise as ReturnType<typeof apiClient.delete>
    );

    const { result } = renderHook(() => useKnowledgeBase());
    // Initiate delete without awaiting
    act(() => {
      void result.current.deleteKnowledgeBase('kb-1');
    });
    // Deleting should be true during execution
    expect(result.current.deleting).toBe(true);
    // Resolve and wait
    await act(async () => {
      resolveDelete!();
      await deletePromise;
    });
    expect(result.current.deleting).toBe(false);
  });

  it('exposes refreshList as alias for fetchList', () => {
    const mockExecute = vi.fn();
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ execute: mockExecute })
    );
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());
    const { result } = renderHook(() => useKnowledgeBase());
    expect(result.current.refreshList).toBe(result.current.fetchList);
  });

  it('reports error state from useApiGet', () => {
    const mockError = new Error('Network error');
    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ error: mockError as never })
    );
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());
    const { result } = renderHook(() => useKnowledgeBase());
    expect(result.current.error).toBe(mockError);
  });
});

describe('useKnowledgeBaseDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns undefined when id is null', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiMutation).mockReturnValue(makeDefaultMutation());
    const { result } = renderHook(() => useKnowledgeBaseDetail(null));
    expect(result.current.knowledgeBase).toBeUndefined();
    expect(result.current.stats).toBeUndefined();
    expect(result.current.documents).toBeUndefined();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('returns knowledge base detail when id is provided', () => {
    const mockKB = {
      id: 'kb-1',
      name: 'Test KB',
      sourceType: 'MANUAL' as const,
      status: 'READY' as const,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    };
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet({ data: mockKB }));
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiMutation).mockReturnValue(makeDefaultMutation());
    const { result } = renderHook(() => useKnowledgeBaseDetail('kb-1'));
    expect(result.current.knowledgeBase).toEqual(mockKB);
  });

  it('calls the correct API endpoints for detail, stats, and documents', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiMutation).mockReturnValue(makeDefaultMutation());
    renderHook(() => useKnowledgeBaseDetail('kb-1'));
    const calls = vi.mocked(useApiGet).mock.calls.map((c) => c[0]);
    expect(calls).toContain('/rag/knowledge-bases/kb-1');
    expect(calls).toContain('/rag/knowledge-bases/kb-1/stats');
    expect(calls).toContain('/rag/knowledge-bases/kb-1/documents');
  });

  it('does not fetch when id is null (immediate=false)', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiMutation).mockReturnValue(makeDefaultMutation());
    renderHook(() => useKnowledgeBaseDetail(null));
    vi.mocked(useApiGet).mock.calls.forEach((call) => {
      expect(call[1]).toEqual(expect.objectContaining({ immediate: false }));
    });
  });

  it('deleteDocument calls apiClient.delete and refreshes stats and documents', async () => {
    const mockFetchStats = vi.fn().mockResolvedValue(undefined);
    const mockFetchDocuments = vi.fn().mockResolvedValue(undefined);

    // Return different mocks for each useApiGet call
    let callCount = 0;
    vi.mocked(useApiGet).mockImplementation(() => {
      callCount++;
      if (callCount === 2) return makeDefaultGet({ execute: mockFetchStats });
      if (callCount === 3)
        return makeDefaultGet({ execute: mockFetchDocuments });
      return makeDefaultGet();
    });
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiMutation).mockReturnValue(makeDefaultMutation());
    vi.mocked(apiClient.delete).mockResolvedValue(undefined);

    const { result } = renderHook(() => useKnowledgeBaseDetail('kb-1'));
    await act(async () => {
      await result.current.deleteDocument('doc-1');
    });
    expect(apiClient.delete).toHaveBeenCalledWith('/rag/documents/doc-1');
  });

  it('updateKnowledgeBase returns undefined when id is null', async () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiMutation).mockReturnValue(makeDefaultMutation());

    const { result } = renderHook(() => useKnowledgeBaseDetail(null));
    let ret: unknown;
    await act(async () => {
      ret = await result.current.updateKnowledgeBase({ name: 'Updated' });
    });
    expect(ret).toBeUndefined();
  });

  it('updateKnowledgeBase calls mutate execute and refreshes when id is provided', async () => {
    const mockRefresh = vi.fn().mockResolvedValue(undefined);
    const mockUpdateExecute = vi
      .fn()
      .mockResolvedValue({ id: 'kb-1', name: 'Updated KB' });

    vi.mocked(useApiGet).mockReturnValue(
      makeDefaultGet({ execute: mockRefresh })
    );
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiMutation).mockReturnValue(
      makeDefaultMutation({ execute: mockUpdateExecute })
    );

    const { result } = renderHook(() => useKnowledgeBaseDetail('kb-1'));
    await act(async () => {
      await result.current.updateKnowledgeBase({ name: 'Updated KB' });
    });
    expect(mockUpdateExecute).toHaveBeenCalledWith({ name: 'Updated KB' });
  });

  it('processDocuments returns undefined when id is null', async () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiMutation).mockReturnValue(makeDefaultMutation());

    const { result } = renderHook(() => useKnowledgeBaseDetail(null));
    let ret: unknown;
    await act(async () => {
      ret = await result.current.processDocuments();
    });
    expect(ret).toBeUndefined();
  });

  it('processDocuments calls execute when id is provided', async () => {
    const mockProcessExecute = vi.fn().mockResolvedValue({ processed: 5 });
    const mockRefresh = vi.fn().mockResolvedValue(undefined);

    let callCount = 0;
    vi.mocked(useApiGet).mockImplementation(() => {
      callCount++;
      return makeDefaultGet({ execute: mockRefresh });
    });
    vi.mocked(useApiPost).mockImplementation(() => {
      callCount++;
      if (callCount === 4)
        return makeDefaultMutation({ execute: mockProcessExecute });
      return makeDefaultMutation({ execute: mockProcessExecute });
    });
    vi.mocked(useApiMutation).mockReturnValue(makeDefaultMutation());

    const { result } = renderHook(() => useKnowledgeBaseDetail('kb-1'));
    await act(async () => {
      await result.current.processDocuments();
    });
    expect(mockProcessExecute).toHaveBeenCalled();
  });

  it('syncGoogleDrive returns undefined when id is null', async () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiMutation).mockReturnValue(makeDefaultMutation());

    const { result } = renderHook(() => useKnowledgeBaseDetail(null));
    let ret: unknown;
    await act(async () => {
      ret = await result.current.syncGoogleDrive();
    });
    expect(ret).toBeUndefined();
  });

  it('addDocument returns undefined when id is null', async () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiMutation).mockReturnValue(makeDefaultMutation());

    const { result } = renderHook(() => useKnowledgeBaseDetail(null));
    let ret: unknown;
    await act(async () => {
      ret = await result.current.addDocument({
        title: 'Doc',
        content: 'Content',
      });
    });
    expect(ret).toBeUndefined();
  });

  it('reflects updating state from useApiMutation', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultMutation());
    vi.mocked(useApiMutation).mockReturnValue(
      makeDefaultMutation({ loading: true })
    );

    const { result } = renderHook(() => useKnowledgeBaseDetail('kb-1'));
    expect(result.current.updating).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// useGoogleDriveFolders
// ---------------------------------------------------------------------------
describe('useGoogleDriveFolders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty folders and files in initial state', () => {
    const { result } = renderHook(() => useGoogleDriveFolders());
    expect(result.current.folders).toEqual([]);
    expect(result.current.files).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.parentStack).toEqual([]);
    expect(result.current.currentParentId).toBeUndefined();
  });

  it('fetchFolders without parentId calls /rag/google-drive/folders', async () => {
    const mockData = {
      folders: [{ id: 'folder-1', name: 'Documents', fileCount: 5 }],
      files: [
        { id: 'file-1', name: 'report.pdf', mimeType: 'application/pdf' },
      ],
    };
    vi.mocked(apiClient.get).mockResolvedValue(mockData);

    const { result } = renderHook(() => useGoogleDriveFolders());

    await act(async () => {
      await result.current.fetchFolders();
    });

    expect(apiClient.get).toHaveBeenCalledWith('/rag/google-drive/folders');
    expect(result.current.folders).toEqual(mockData.folders);
    expect(result.current.files).toEqual(mockData.files);
    expect(result.current.loading).toBe(false);
  });

  it('fetchFolders with parentId includes parentId in URL', async () => {
    const mockData = { folders: [], files: [] };
    vi.mocked(apiClient.get).mockResolvedValue(mockData);

    const { result } = renderHook(() => useGoogleDriveFolders());

    await act(async () => {
      await result.current.fetchFolders('parent-folder-id');
    });

    expect(apiClient.get).toHaveBeenCalledWith(
      '/rag/google-drive/folders?parentId=parent-folder-id'
    );
  });

  it('fetchFolders sets error and rethrows on failure', async () => {
    const mockError = new Error('Google Drive API error');
    vi.mocked(apiClient.get).mockRejectedValue(mockError);

    const { result } = renderHook(() => useGoogleDriveFolders());

    await act(async () => {
      try {
        await result.current.fetchFolders();
      } catch {
        // expected to throw
      }
    });

    expect(result.current.error).toBe(mockError);
    expect(result.current.loading).toBe(false);
  });

  it('navigateToFolder adds to parentStack and fetches subfolder', async () => {
    const mockData = {
      folders: [{ id: 'sub-1', name: 'Sub folder', fileCount: 0 }],
      files: [],
    };
    vi.mocked(apiClient.get).mockResolvedValue(mockData);

    const { result } = renderHook(() => useGoogleDriveFolders());

    const folder = { id: 'folder-1', name: 'Documents', fileCount: 3 };
    await act(async () => {
      await result.current.navigateToFolder(folder);
    });

    expect(result.current.parentStack).toEqual([
      { id: 'folder-1', name: 'Documents' },
    ]);
    expect(result.current.currentParentId).toBe('folder-1');
    expect(apiClient.get).toHaveBeenCalledWith(
      '/rag/google-drive/folders?parentId=folder-1'
    );
  });

  it('navigateBack does nothing when parentStack is empty', async () => {
    const { result } = renderHook(() => useGoogleDriveFolders());

    await act(async () => {
      await result.current.navigateBack();
    });

    expect(apiClient.get).not.toHaveBeenCalled();
    expect(result.current.parentStack).toEqual([]);
  });

  it('navigateBack pops last folder and fetches parent', async () => {
    const mockData = { folders: [], files: [] };
    vi.mocked(apiClient.get).mockResolvedValue(mockData);

    const { result } = renderHook(() => useGoogleDriveFolders());

    // First navigate into a folder
    const folderA = { id: 'folder-a', name: 'Folder A', fileCount: 0 };
    const folderB = { id: 'folder-b', name: 'Folder B', fileCount: 0 };
    await act(async () => {
      await result.current.navigateToFolder(folderA);
    });
    await act(async () => {
      await result.current.navigateToFolder(folderB);
    });

    expect(result.current.parentStack.length).toBe(2);

    // Navigate back - should go to folderA
    vi.mocked(apiClient.get).mockClear();
    vi.mocked(apiClient.get).mockResolvedValue(mockData);
    await act(async () => {
      await result.current.navigateBack();
    });

    expect(result.current.parentStack).toEqual([
      { id: 'folder-a', name: 'Folder A' },
    ]);
    expect(apiClient.get).toHaveBeenCalledWith(
      '/rag/google-drive/folders?parentId=folder-a'
    );
  });

  it('navigateBack to root when only one folder in stack', async () => {
    const mockData = { folders: [], files: [] };
    vi.mocked(apiClient.get).mockResolvedValue(mockData);

    const { result } = renderHook(() => useGoogleDriveFolders());

    const folder = { id: 'folder-1', name: 'Root folder', fileCount: 0 };
    await act(async () => {
      await result.current.navigateToFolder(folder);
    });

    vi.mocked(apiClient.get).mockClear();
    vi.mocked(apiClient.get).mockResolvedValue(mockData);
    await act(async () => {
      await result.current.navigateBack();
    });

    expect(result.current.parentStack).toEqual([]);
    expect(result.current.currentParentId).toBeUndefined();
    expect(apiClient.get).toHaveBeenCalledWith('/rag/google-drive/folders');
  });

  it('navigateToRoot clears parentStack and fetches root folders', async () => {
    const mockData = { folders: [], files: [] };
    vi.mocked(apiClient.get).mockResolvedValue(mockData);

    const { result } = renderHook(() => useGoogleDriveFolders());

    // Build up stack first
    const folder = { id: 'folder-1', name: 'Documents', fileCount: 0 };
    await act(async () => {
      await result.current.navigateToFolder(folder);
    });

    expect(result.current.parentStack.length).toBe(1);

    vi.mocked(apiClient.get).mockClear();
    vi.mocked(apiClient.get).mockResolvedValue(mockData);
    await act(async () => {
      await result.current.navigateToRoot();
    });

    expect(result.current.parentStack).toEqual([]);
    expect(result.current.currentParentId).toBeUndefined();
    expect(apiClient.get).toHaveBeenCalledWith('/rag/google-drive/folders');
  });

  it('currentParentId reflects last item in parentStack', async () => {
    const mockData = { folders: [], files: [] };
    vi.mocked(apiClient.get).mockResolvedValue(mockData);

    const { result } = renderHook(() => useGoogleDriveFolders());

    const folderA = { id: 'a', name: 'A', fileCount: 0 };
    const folderB = { id: 'b', name: 'B', fileCount: 0 };
    await act(async () => {
      await result.current.navigateToFolder(folderA);
    });
    await act(async () => {
      await result.current.navigateToFolder(folderB);
    });

    expect(result.current.currentParentId).toBe('b');
  });
});

describe('useRAGQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null result and loading:false in initial state', () => {
    const { result } = renderHook(() => useRAGQuery());
    expect(result.current.result).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('sets result after successful query', async () => {
    const mockResult = {
      context: { text: 'Relevant context', sources: [], totalTokens: 100 },
      searchResults: [],
      processingTime: { search: 50, total: 50 },
    };
    vi.mocked(apiClient.post).mockResolvedValue(mockResult);

    const { result } = renderHook(() => useRAGQuery());
    await act(async () => {
      await result.current.query('test query', ['kb-1']);
    });
    expect(result.current.result).toEqual(mockResult);
    expect(result.current.loading).toBe(false);
  });

  it('sets error when query fails', async () => {
    const mockError = new Error('Query failed');
    vi.mocked(apiClient.post).mockRejectedValue(mockError);

    const { result } = renderHook(() => useRAGQuery());
    await act(async () => {
      try {
        await result.current.query('test query', ['kb-1']);
      } catch {
        // expected throw
      }
    });
    expect(result.current.error).toBe(mockError);
    expect(result.current.result).toBeNull();
  });

  it('passes correct payload to apiClient.post', async () => {
    const mockResult = {
      context: { text: '', sources: [], totalTokens: 0 },
      searchResults: [],
      processingTime: { search: 10, total: 10 },
    };
    vi.mocked(apiClient.post).mockResolvedValue(mockResult);

    const { result } = renderHook(() => useRAGQuery());
    await act(async () => {
      await result.current.query('hello', ['kb-1', 'kb-2'], {
        topK: 5,
        useHyde: true,
      });
    });
    expect(apiClient.post).toHaveBeenCalledWith('/rag/query', {
      query: 'hello',
      knowledgeBaseIds: ['kb-1', 'kb-2'],
      topK: 5,
      useHyde: true,
    });
  });

  it('sets loading=true while querying', async () => {
    let resolveQuery: (v: unknown) => void;
    const queryPromise = new Promise((res) => {
      resolveQuery = res;
    });
    vi.mocked(apiClient.post).mockReturnValue(queryPromise);

    const { result } = renderHook(() => useRAGQuery());
    act(() => {
      void result.current.query('test', ['kb-1']);
    });
    expect(result.current.loading).toBe(true);
    await act(async () => {
      resolveQuery!({
        context: { text: '', sources: [], totalTokens: 0 },
        searchResults: [],
        processingTime: { search: 10, total: 10 },
      });
      await queryPromise;
    });
    expect(result.current.loading).toBe(false);
  });

  it('reset clears result and error', async () => {
    const mockResult = {
      context: { text: 'ctx', sources: [], totalTokens: 10 },
      searchResults: [],
      processingTime: { search: 10, total: 10 },
    };
    vi.mocked(apiClient.post).mockResolvedValue(mockResult);

    const { result } = renderHook(() => useRAGQuery());
    await act(async () => {
      await result.current.query('query', ['kb-1']);
    });
    expect(result.current.result).not.toBeNull();

    act(() => {
      result.current.reset();
    });
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
  });
});

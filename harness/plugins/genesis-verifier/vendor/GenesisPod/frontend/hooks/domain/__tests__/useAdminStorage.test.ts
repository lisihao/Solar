import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/hooks/core', () => ({
  useApiGet: vi.fn(),
  useApiPost: vi.fn(),
  useApiPut: vi.fn(),
  useApiDelete: vi.fn(),
  useApiMutation: vi.fn(),
}));

import { useApiGet, useApiPost, useApiDelete } from '@/hooks/core';
import { useAdminStorage } from '../useAdminStorage';
import type { StorageItem, StorageStats } from '../useAdminStorage';

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

const makeFile = (overrides: Partial<StorageItem> = {}): StorageItem => ({
  id: 'file-1',
  key: 'uploads/file-1.png',
  filename: 'file-1.png',
  mimeType: 'image/png',
  size: 204800,
  url: 'https://cdn.example.com/uploads/file-1.png',
  createdAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const makeStats = (overrides: Partial<StorageStats> = {}): StorageStats => ({
  totalSize: 1024 * 1024 * 100,
  fileCount: 42,
  usedQuota: 50,
  maxQuota: 1024 * 1024 * 1024,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAdminStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiGet).mockReturnValue(makeDefaultHook());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultHook());
    vi.mocked(useApiDelete).mockReturnValue(makeDefaultHook());
  });

  describe('initial state', () => {
    it('returns empty files array when data is null', () => {
      const { result } = renderHook(() => useAdminStorage());
      expect(result.current.files).toEqual([]);
    });

    it('returns null stats when data is null', () => {
      const { result } = renderHook(() => useAdminStorage());
      expect(result.current.stats).toBeNull();
    });

    it('starts with loading false when neither list nor stats is loading', () => {
      const { result } = renderHook(() => useAdminStorage());
      expect(result.current.loading).toBe(false);
    });
  });

  describe('data loading', () => {
    it('returns files list when data is available', () => {
      const files = [
        makeFile(),
        makeFile({ id: 'file-2', filename: 'file-2.jpg' }),
      ];
      vi.mocked(useApiGet)
        .mockReturnValueOnce(makeDefaultHook({ data: files })) // files
        .mockReturnValueOnce(makeDefaultHook()); // stats

      const { result } = renderHook(() => useAdminStorage());
      expect(result.current.files).toHaveLength(2);
      expect(result.current.files[0].filename).toBe('file-1.png');
    });

    it('returns stats when data is available', () => {
      const stats = makeStats({ fileCount: 100 });
      vi.mocked(useApiGet)
        .mockReturnValueOnce(makeDefaultHook()) // files
        .mockReturnValueOnce(makeDefaultHook({ data: stats })); // stats

      const { result } = renderHook(() => useAdminStorage());
      expect(result.current.stats?.fileCount).toBe(100);
    });

    it('aggregates loading from both list and stats fetches', () => {
      vi.mocked(useApiGet)
        .mockReturnValueOnce(makeDefaultHook({ loading: false })) // files
        .mockReturnValueOnce(makeDefaultHook({ loading: true })); // stats

      const { result } = renderHook(() => useAdminStorage());
      expect(result.current.loading).toBe(true);
    });
  });

  describe('deleteFile', () => {
    it('calls deleteFileApi with correct id and refreshes files and stats', async () => {
      const mockFilesExecute = vi.fn().mockResolvedValue(undefined);
      const mockStatsExecute = vi.fn().mockResolvedValue(undefined);
      const mockDeleteApi = vi.fn().mockResolvedValue(undefined);

      vi.mocked(useApiGet)
        .mockReturnValueOnce(makeDefaultHook({ execute: mockFilesExecute })) // files
        .mockReturnValueOnce(makeDefaultHook({ execute: mockStatsExecute })); // stats
      vi.mocked(useApiDelete).mockReturnValue(
        makeDefaultHook({ execute: mockDeleteApi })
      );
      vi.mocked(useApiPost).mockReturnValue(makeDefaultHook());

      const { result } = renderHook(() => useAdminStorage());
      await act(async () => {
        await result.current.deleteFile('file-1');
      });

      expect(mockDeleteApi).toHaveBeenCalledWith({ id: 'file-1' });
      expect(mockFilesExecute).toHaveBeenCalled();
      expect(mockStatsExecute).toHaveBeenCalled();
    });

    it('exposes isDeleting flag from deleteApi loading state', () => {
      vi.mocked(useApiGet).mockReturnValue(makeDefaultHook());
      vi.mocked(useApiDelete).mockReturnValue(
        makeDefaultHook({ loading: true })
      );
      vi.mocked(useApiPost).mockReturnValue(makeDefaultHook());

      const { result } = renderHook(() => useAdminStorage());
      expect(result.current.isDeleting).toBe(true);
    });
  });

  describe('cleanup', () => {
    it('calls cleanupApi and refreshes files and stats on success', async () => {
      const mockFilesExecute = vi.fn().mockResolvedValue(undefined);
      const mockStatsExecute = vi.fn().mockResolvedValue(undefined);
      const mockCleanupApi = vi.fn().mockResolvedValue({ deleted: 5 });

      vi.mocked(useApiGet)
        .mockReturnValueOnce(makeDefaultHook({ execute: mockFilesExecute }))
        .mockReturnValueOnce(makeDefaultHook({ execute: mockStatsExecute }));
      vi.mocked(useApiDelete).mockReturnValue(makeDefaultHook());
      vi.mocked(useApiPost).mockReturnValue(
        makeDefaultHook({ execute: mockCleanupApi })
      );

      const { result } = renderHook(() => useAdminStorage());
      let cleanupResult: { deleted: number } | null | undefined;
      await act(async () => {
        cleanupResult = await result.current.cleanup();
      });

      expect(mockCleanupApi).toHaveBeenCalled();
      expect(cleanupResult).toEqual({ deleted: 5 });
      expect(mockFilesExecute).toHaveBeenCalled();
      expect(mockStatsExecute).toHaveBeenCalled();
    });

    it('does not refresh when cleanupApi returns null', async () => {
      const mockFilesExecute = vi.fn().mockResolvedValue(undefined);
      const mockCleanupApi = vi.fn().mockResolvedValue(null);

      vi.mocked(useApiGet)
        .mockReturnValueOnce(makeDefaultHook({ execute: mockFilesExecute }))
        .mockReturnValueOnce(makeDefaultHook());
      vi.mocked(useApiDelete).mockReturnValue(makeDefaultHook());
      vi.mocked(useApiPost).mockReturnValue(
        makeDefaultHook({ execute: mockCleanupApi })
      );

      const { result } = renderHook(() => useAdminStorage());
      await act(async () => {
        await result.current.cleanup();
      });

      expect(mockFilesExecute).not.toHaveBeenCalled();
    });

    it('exposes isCleaning flag from cleanupApi loading state', () => {
      vi.mocked(useApiGet).mockReturnValue(makeDefaultHook());
      vi.mocked(useApiDelete).mockReturnValue(makeDefaultHook());
      vi.mocked(useApiPost).mockReturnValue(makeDefaultHook({ loading: true }));

      const { result } = renderHook(() => useAdminStorage());
      expect(result.current.isCleaning).toBe(true);
    });
  });
});

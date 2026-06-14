import { useApiGet, useApiPost, useApiDelete } from '../core';
import { useCallback } from 'react';

export interface StorageItem {
  id: string;
  key: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
  createdAt: string;
}

export interface StorageStats {
  totalSize: number;
  fileCount: number;
  usedQuota: number;
  maxQuota: number;
}

export function useAdminStorage() {
  const {
    data: files,
    loading: listLoading,
    error: listError,
    execute: refreshFiles,
  } = useApiGet<StorageItem[]>('/admin/storage/files', {
    immediate: true,
  });

  const {
    data: stats,
    loading: statsLoading,
    execute: refreshStats,
  } = useApiGet<StorageStats>('/admin/storage/stats', {
    immediate: true,
  });

  const { loading: deleteLoading, execute: deleteFileApi } = useApiDelete<
    void,
    { id: string }
  >('/admin/storage/files');

  const { loading: cleanupLoading, execute: cleanupApi } = useApiPost<{
    deleted: number;
  }>('/admin/storage/cleanup');

  const deleteFile = useCallback(
    async (id: string) => {
      await deleteFileApi({ id });
      await Promise.all([refreshFiles(), refreshStats()]);
    },
    [deleteFileApi, refreshFiles, refreshStats]
  );

  const cleanup = useCallback(async () => {
    const result = await cleanupApi({});
    if (result) await Promise.all([refreshFiles(), refreshStats()]);
    return result;
  }, [cleanupApi, refreshFiles, refreshStats]);

  return {
    files: files ?? [],
    stats,
    loading: listLoading || statsLoading,
    error: listError,
    refreshFiles,
    refreshStats,
    deleteFile,
    cleanup,
    isDeleting: deleteLoading,
    isCleaning: cleanupLoading,
  };
}

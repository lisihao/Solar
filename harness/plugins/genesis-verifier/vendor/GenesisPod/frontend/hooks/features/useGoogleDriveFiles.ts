'use client';

import { useState, useCallback, useEffect } from 'react';
import { useApiGet } from '@/hooks/core';

export interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  createdTime?: string;
  modifiedTime?: string;
  webViewLink?: string;
  thumbnailLink?: string;
  isFolder?: boolean;
  parents?: string[];
}

export interface ListFilesOptions {
  folderId?: string;
  pageSize?: number;
  query?: string;
  orderBy?: string;
}

export interface ListFilesResult {
  files: GoogleDriveFile[];
  nextPageToken?: string;
  hasMore: boolean;
}

/**
 * Google Drive 文件列表 Hook
 *
 * 功能：
 * - 获取文件和文件夹列表
 * - 支持分页加载
 * - 支持搜索和排序
 * - 文件夹导航
 */
export function useGoogleDriveFiles(options: ListFilesOptions = {}) {
  const [files, setFiles] = useState<GoogleDriveFile[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | undefined>(
    options.folderId
  );
  const [folderStack, setFolderStack] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();

  // 构建查询参数
  const queryParams = new URLSearchParams();
  if (currentFolderId) queryParams.set('folderId', currentFolderId);
  if (options.pageSize)
    queryParams.set('pageSize', options.pageSize.toString());
  if (options.query) queryParams.set('query', options.query);
  if (options.orderBy) queryParams.set('orderBy', options.orderBy);
  if (nextPageToken) queryParams.set('pageToken', nextPageToken);

  const {
    data,
    loading: isLoading,
    error,
    execute: refetch,
  } = useApiGet<ListFilesResult>(
    `/api/v1/google-drive/files?${queryParams.toString()}`,
    { immediate: true }
  );

  // 更新文件列表
  useEffect(() => {
    if (data) {
      if (nextPageToken) {
        // 追加加载
        setFiles((prev) => [...prev, ...data.files]);
      } else {
        // 新加载
        setFiles(data.files);
      }
      setNextPageToken(data.nextPageToken);
    }
  }, [data, nextPageToken]);

  /**
   * 进入文件夹
   */
  const enterFolder = useCallback((folder: GoogleDriveFile) => {
    if (folder.isFolder) {
      setFolderStack((prev) => [...prev, { id: folder.id, name: folder.name }]);
      setCurrentFolderId(folder.id);
      setNextPageToken(undefined);
      setFiles([]);
    }
  }, []);

  /**
   * 返回上级文件夹
   */
  const goBack = useCallback(() => {
    if (folderStack.length > 0) {
      const newStack = [...folderStack];
      newStack.pop();
      setFolderStack(newStack);
      setCurrentFolderId(newStack[newStack.length - 1]?.id);
      setNextPageToken(undefined);
      setFiles([]);
    }
  }, [folderStack]);

  /**
   * 导航到特定文件夹
   */
  const navigateToFolder = useCallback(
    (index: number) => {
      const newStack = folderStack.slice(0, index + 1);
      setFolderStack(newStack);
      setCurrentFolderId(newStack[newStack.length - 1]?.id);
      setNextPageToken(undefined);
      setFiles([]);
    },
    [folderStack]
  );

  /**
   * 加载更多
   */
  const loadMore = useCallback(() => {
    if (data?.hasMore && !isLoading) {
      refetch();
    }
  }, [data, isLoading, refetch]);

  /**
   * 刷新当前文件夹
   */
  const refresh = useCallback(() => {
    setNextPageToken(undefined);
    setFiles([]);
    refetch();
  }, [refetch]);

  /**
   * 获取文件夹路径（面包屑）
   */
  const breadcrumbs = [{ id: '', name: 'My Drive' }, ...folderStack];

  return {
    files,
    isLoading,
    error,
    currentFolderId,
    folderStack,
    breadcrumbs,
    hasMore: data?.hasMore ?? false,
    enterFolder,
    goBack,
    navigateToFolder,
    loadMore,
    refresh,
  };
}

/**
 * 获取单个文件信息
 */
export function useGoogleDriveFile(fileId?: string) {
  const {
    data,
    loading: isLoading,
    error,
    execute: refetch,
  } = useApiGet<{ file: GoogleDriveFile }>(
    fileId ? `/api/v1/google-drive/files/${fileId}` : '',
    { immediate: !!fileId }
  );

  return {
    file: data?.file,
    isLoading,
    error,
    refresh: refetch,
  };
}

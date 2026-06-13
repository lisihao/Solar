/**
 * useGoogleDriveFiles - Google Drive 文件浏览 Hook
 *
 * 功能：
 * 1. 文件/文件夹列表
 * 2. 导航和面包屑
 * 3. 搜索和排序
 * 4. 分页加载
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useApiGet } from '../core';
import type { ApiError } from '@/lib/api/client';
import {
  listFiles as listFilesApi,
  type GoogleDriveFile,
  type ListFilesParams,
  type ListFilesResponse,
  type FolderPathItem,
} from '@/services/google-drive/api';

// ==================== 类型定义 ====================

export interface UseGoogleDriveFilesOptions {
  /** 连接 ID */
  connectionId?: string;
  /** 初始父文件夹 ID */
  initialParentId?: string;
  /** 每页大小 */
  pageSize?: number;
  /** 是否立即加载 */
  immediate?: boolean;
  /** 文件类型过滤 */
  mimeType?: string;
  /** 默认排序 */
  defaultSortBy?: 'name' | 'modifiedTime' | 'createdTime' | 'size';
  /** 默认排序方向 */
  defaultSortOrder?: 'asc' | 'desc';
}

export interface UseGoogleDriveFilesResult {
  // 数据
  files: GoogleDriveFile[];
  folders: GoogleDriveFile[];
  allItems: GoogleDriveFile[];

  // 导航
  currentFolderId: string | null;
  folderPath: FolderPathItem[];
  canGoBack: boolean;

  // 分页
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;

  // 搜索和排序
  searchQuery: string;
  sortBy: 'name' | 'modifiedTime' | 'createdTime' | 'size';
  sortOrder: 'asc' | 'desc';

  // 加载状态
  loading: boolean;
  error: ApiError | null;

  // 操作方法
  navigateToFolder: (folderId: string | null) => void;
  navigateBack: () => void;
  navigateToPath: (pathIndex: number) => void;
  setSearch: (query: string) => void;
  setSorting: (sortBy: string, sortOrder?: 'asc' | 'desc') => void;
  setPage: (page: number) => void;
  loadMore: () => void;
  refresh: () => Promise<void>;

  // 辅助方法
  getFileById: (id: string) => GoogleDriveFile | undefined;
  isFolder: (file: GoogleDriveFile) => boolean;
}

// ==================== Hook 实现 ====================

/**
 * Google Drive 文件浏览 Hook
 */
export function useGoogleDriveFiles(
  options: UseGoogleDriveFilesOptions = {}
): UseGoogleDriveFilesResult {
  const {
    connectionId,
    initialParentId,
    pageSize = 50,
    immediate = true,
    mimeType,
    defaultSortBy = 'name',
    defaultSortOrder = 'asc',
  } = options;

  // 状态管理
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(
    initialParentId || null
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortByState] = useState(defaultSortBy);
  const [sortOrder, setSortOrderState] = useState(defaultSortOrder);
  const [page, setPage] = useState(1);

  // 构建查询参数
  const queryParams = useMemo(() => {
    const params: ListFilesParams = {
      page,
      limit: pageSize,
      sortBy,
      sortOrder,
    };
    if (connectionId) params.connectionId = connectionId;
    if (currentFolderId) params.parentId = currentFolderId;
    if (searchQuery) params.search = searchQuery;
    if (mimeType) params.mimeType = mimeType;
    return params;
  }, [
    connectionId,
    currentFolderId,
    searchQuery,
    mimeType,
    page,
    pageSize,
    sortBy,
    sortOrder,
  ]);

  // 构建 URL
  const apiUrl = useMemo(() => {
    const searchParams = new URLSearchParams();
    if (queryParams.connectionId)
      searchParams.set('connectionId', queryParams.connectionId);
    if (queryParams.parentId)
      searchParams.set('parentId', queryParams.parentId);
    if (queryParams.search) searchParams.set('search', queryParams.search);
    if (queryParams.mimeType)
      searchParams.set('mimeType', queryParams.mimeType);
    if (queryParams.page) searchParams.set('page', String(queryParams.page));
    if (queryParams.limit) searchParams.set('limit', String(queryParams.limit));
    if (queryParams.sortBy) searchParams.set('sortBy', queryParams.sortBy);
    if (queryParams.sortOrder)
      searchParams.set('sortOrder', queryParams.sortOrder);
    return `/google-drive/files?${searchParams.toString()}`;
  }, [queryParams]);

  // 获取文件列表
  const {
    data: filesData,
    loading,
    error,
    execute: fetchFiles,
  } = useApiGet<ListFilesResponse>(apiUrl, {
    immediate,
    deps: [apiUrl],
  });

  // 计算派生状态
  const files = useMemo(() => filesData?.files ?? [], [filesData]);

  const folders = useMemo(() => files.filter((f) => f.isFolder), [files]);

  const allItems = files;

  const folderPath = useMemo(() => filesData?.folderPath ?? [], [filesData]);

  const canGoBack = folderPath.length > 0;

  const pagination = useMemo(
    () =>
      filesData?.pagination ?? {
        page: 1,
        limit: pageSize,
        total: 0,
        totalPages: 0,
      },
    [filesData, pageSize]
  );

  const hasMore = pagination.page < pagination.totalPages;

  // 导航到文件夹
  const navigateToFolder = useCallback((folderId: string | null) => {
    setCurrentFolderId(folderId);
    setPage(1);
    setSearchQuery('');
  }, []);

  // 返回上一级
  const navigateBack = useCallback(() => {
    if (folderPath.length === 0) return;
    const parentFolder = folderPath[folderPath.length - 2];
    navigateToFolder(parentFolder?.driveFileId || null);
  }, [folderPath, navigateToFolder]);

  // 导航到路径中的某个文件夹
  const navigateToPath = useCallback(
    (pathIndex: number) => {
      if (pathIndex < 0 || pathIndex >= folderPath.length) return;
      const targetFolder = folderPath[pathIndex];
      navigateToFolder(targetFolder.driveFileId);
    },
    [folderPath, navigateToFolder]
  );

  // 设置搜索
  const setSearch = useCallback((query: string) => {
    setSearchQuery(query);
    setPage(1);
  }, []);

  // 设置排序
  const setSorting = useCallback(
    (newSortBy: string, newSortOrder?: 'asc' | 'desc') => {
      setSortByState(newSortBy as typeof sortBy);
      if (newSortOrder) {
        setSortOrderState(newSortOrder);
      } else {
        // 如果是同一个字段，切换方向
        if (newSortBy === sortBy) {
          setSortOrderState(sortOrder === 'asc' ? 'desc' : 'asc');
        }
      }
      setPage(1);
    },
    [sortBy, sortOrder]
  );

  // 加载更多
  const loadMore = useCallback(() => {
    if (!hasMore || loading) return;
    setPage((prev) => prev + 1);
  }, [hasMore, loading]);

  // 刷新
  const refresh = useCallback(async () => {
    await fetchFiles();
  }, [fetchFiles]);

  // 获取指定文件
  const getFileById = useCallback(
    (id: string) => files.find((f) => f.id === id),
    [files]
  );

  // 判断是否为文件夹
  const isFolder = useCallback((file: GoogleDriveFile) => file.isFolder, []);

  // 当连接 ID 变化时重置状态
  useEffect(() => {
    setCurrentFolderId(initialParentId || null);
    setSearchQuery('');
    setPage(1);
  }, [connectionId, initialParentId]);

  return {
    // 数据
    files,
    folders,
    allItems,

    // 导航
    currentFolderId,
    folderPath,
    canGoBack,

    // 分页
    page,
    pageSize,
    total: pagination.total,
    totalPages: pagination.totalPages,
    hasMore,

    // 搜索和排序
    searchQuery,
    sortBy,
    sortOrder,

    // 加载状态
    loading,
    error,

    // 操作方法
    navigateToFolder,
    navigateBack,
    navigateToPath,
    setSearch,
    setSorting,
    setPage,
    loadMore,
    refresh,

    // 辅助方法
    getFileById,
    isFolder,
  };
}

// ==================== 导出类型 ====================

export type { GoogleDriveFile, FolderPathItem };

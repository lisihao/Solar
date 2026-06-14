/**
 * useGoogleDriveImport - Google Drive 文件导入 Hook
 *
 * 功能：
 * 1. 文件选择管理
 * 2. 批量导入
 * 3. 进度追踪
 * 4. 错误处理
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useApiPost, useApiGet } from '../core';
import type { ApiError } from '@/lib/api/client';
import { logger } from '@/lib/utils/logger';
import {
  importFiles as importFilesApi,
  getImportProgress as getImportProgressApi,
  type ImportFilesParams,
  type ImportResult,
  type ImportProgress,
} from '@/services/google-drive/api';

// ==================== 类型定义 ====================

export interface UseGoogleDriveImportOptions {
  /** 连接 ID */
  connectionId: string;
  /** 目标文件夹 ID */
  targetFolderId?: string;
  /** 默认导入选项 */
  defaultOptions?: {
    includeMetadata?: boolean;
    generateSummary?: boolean;
    extractText?: boolean;
  };
  /** 导入完成回调 */
  onComplete?: (progress: ImportProgress) => void;
  /** 导入错误回调 */
  onError?: (error: Error) => void;
}

export interface UseGoogleDriveImportResult {
  // 选择状态
  selectedFiles: string[];
  selectedCount: number;
  isSelected: (fileId: string) => boolean;

  // 导入状态
  importing: boolean;
  importId: string | null;
  progress: ImportProgress | null;
  progressPercent: number;

  // 错误
  error: ApiError | null;

  // 操作方法
  selectFile: (fileId: string) => void;
  deselectFile: (fileId: string) => void;
  toggleFile: (fileId: string) => void;
  selectAll: (fileIds: string[]) => void;
  clearSelection: () => void;
  importFiles: (
    options?: Partial<ImportFilesParams['options']>
  ) => Promise<void>;
  cancelImport: () => void;
  reset: () => void;

  // 辅助方法
  canImport: boolean;
  isComplete: boolean;
  hasFailed: boolean;
}

// ==================== Hook 实现 ====================

/**
 * Google Drive 导入 Hook
 */
export function useGoogleDriveImport(
  options: UseGoogleDriveImportOptions
): UseGoogleDriveImportResult {
  const {
    connectionId,
    targetFolderId,
    defaultOptions = {
      includeMetadata: true,
      generateSummary: true,
      extractText: true,
    },
    onComplete,
    onError,
  } = options;

  // 状态管理
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [importId, setImportId] = useState<string | null>(null);
  const [pollingEnabled, setPollingEnabled] = useState(false);

  // 执行导入
  const {
    execute: executeImport,
    loading: importing,
    error: importError,
  } = useApiPost<ImportResult, ImportFilesParams>('/google-drive/import', {
    onSuccess: (result) => {
      setImportId(result.importId);
      setPollingEnabled(true);
    },
    onError: (err) => {
      logger.error('Import failed:', err);
      onError?.(err as Error);
    },
  });

  // 轮询获取进度
  const {
    data: progressData,
    error: progressError,
    execute: fetchProgress,
  } = useApiGet<{ progress: ImportProgress }>(
    importId ? `/google-drive/import/${importId}` : '',
    {
      immediate: false,
    }
  );

  // 计算进度
  const progress = useMemo(
    () => progressData?.progress ?? null,
    [progressData]
  );

  const progressPercent = useMemo(() => {
    if (!progress) return 0;
    if (progress.totalFiles === 0) return 0;
    return Math.round((progress.processedFiles / progress.totalFiles) * 100);
  }, [progress]);

  const isComplete = progress?.status === 'completed';
  const hasFailed = progress?.status === 'failed';

  // 选择/取消选择文件
  const selectFile = useCallback((fileId: string) => {
    setSelectedFiles((prev) => {
      if (prev.includes(fileId)) return prev;
      return [...prev, fileId];
    });
  }, []);

  const deselectFile = useCallback((fileId: string) => {
    setSelectedFiles((prev) => prev.filter((id) => id !== fileId));
  }, []);

  const toggleFile = useCallback((fileId: string) => {
    setSelectedFiles((prev) => {
      if (prev.includes(fileId)) {
        return prev.filter((id) => id !== fileId);
      }
      return [...prev, fileId];
    });
  }, []);

  const selectAll = useCallback((fileIds: string[]) => {
    setSelectedFiles(fileIds);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedFiles([]);
  }, []);

  // 执行导入
  const importFiles = useCallback(
    async (customOptions?: Partial<ImportFilesParams['options']>) => {
      if (selectedFiles.length === 0) {
        throw new Error('No files selected');
      }

      const params: ImportFilesParams = {
        connectionId,
        fileIds: selectedFiles,
        targetFolderId,
        options: {
          ...defaultOptions,
          ...customOptions,
        },
      };

      await executeImport(params);
    },
    [selectedFiles, connectionId, targetFolderId, defaultOptions, executeImport]
  );

  // 取消导入
  const cancelImport = useCallback(() => {
    setImportId(null);
    setPollingEnabled(false);
  }, []);

  // 重置状态
  const reset = useCallback(() => {
    setSelectedFiles([]);
    setImportId(null);
    setPollingEnabled(false);
  }, []);

  // 判断是否选中
  const isSelected = useCallback(
    (fileId: string) => selectedFiles.includes(fileId),
    [selectedFiles]
  );

  // 是否可以导入
  const canImport = selectedFiles.length > 0 && !importing;

  // 轮询进度
  const pollProgress = useCallback(async () => {
    if (!importId || !pollingEnabled) return;

    try {
      await fetchProgress();
    } catch (err) {
      logger.error('Failed to fetch progress:', err);
    }
  }, [importId, pollingEnabled, fetchProgress]);

  // 设置轮询
  useEffect(() => {
    if (!pollingEnabled || !importId) return;

    const interval = setInterval(pollProgress, 2000);
    return () => clearInterval(interval);
  }, [pollingEnabled, importId, pollProgress]);

  // 监听完成状态
  useEffect(() => {
    if (!progress) return;

    if (progress.status === 'completed') {
      setPollingEnabled(false);
      onComplete?.(progress);
      // 清空选择
      setSelectedFiles([]);
    } else if (progress.status === 'failed') {
      setPollingEnabled(false);
      onError?.(new Error('Import failed'));
    }
  }, [progress, onComplete, onError]);

  return {
    // 选择状态
    selectedFiles,
    selectedCount: selectedFiles.length,
    isSelected,

    // 导入状态
    importing,
    importId,
    progress,
    progressPercent,

    // 错误
    error: importError || progressError,

    // 操作方法
    selectFile,
    deselectFile,
    toggleFile,
    selectAll,
    clearSelection,
    importFiles,
    cancelImport,
    reset,

    // 辅助方法
    canImport,
    isComplete,
    hasFailed,
  };
}

// ==================== 导出类型 ====================

export type { ImportProgress, ImportFilesParams };

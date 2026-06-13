/**
 * useGoogleDriveExport - Google Drive 资源导出 Hook
 *
 * 功能：
 * 1. 资源导出到 Google Drive
 * 2. 格式转换
 * 3. 进度追踪
 * 4. 错误处理
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useApiPost, useApiGet } from '../core';
import type { ApiError } from '@/lib/api/client';
import { logger } from '@/lib/utils/logger';
import {
  exportResources as exportResourcesApi,
  getExportProgress as getExportProgressApi,
  type ExportParams,
  type ExportResult,
  type ExportProgress,
} from '@/services/google-drive/api';

// ==================== 类型定义 ====================

export interface UseGoogleDriveExportOptions {
  /** 连接 ID */
  connectionId: string;
  /** 默认导出格式 */
  defaultFormat?: 'original' | 'pdf' | 'docx' | 'markdown';
  /** 默认导出选项 */
  defaultOptions?: {
    includeMetadata?: boolean;
    createFolder?: boolean;
    folderName?: string;
  };
  /** 导出完成回调 */
  onComplete?: (progress: ExportProgress) => void;
  /** 导出错误回调 */
  onError?: (error: Error) => void;
}

export interface UseGoogleDriveExportResult {
  // 导出状态
  exporting: boolean;
  exportId: string | null;
  progress: ExportProgress | null;
  progressPercent: number;

  // 错误
  error: ApiError | null;

  // 操作方法
  exportResources: (
    resourceIds: string[],
    targetFolderId: string,
    format?: 'original' | 'pdf' | 'docx' | 'markdown',
    options?: Partial<ExportParams['options']>
  ) => Promise<void>;
  cancelExport: () => void;
  reset: () => void;

  // 辅助方法
  isComplete: boolean;
  hasFailed: boolean;
  canExport: boolean;
}

// ==================== Hook 实现 ====================

/**
 * Google Drive 导出 Hook
 */
export function useGoogleDriveExport(
  options: UseGoogleDriveExportOptions
): UseGoogleDriveExportResult {
  const {
    connectionId,
    defaultFormat = 'original',
    defaultOptions = {
      includeMetadata: true,
      createFolder: false,
    },
    onComplete,
    onError,
  } = options;

  // 状态管理
  const [exportId, setExportId] = useState<string | null>(null);
  const [pollingEnabled, setPollingEnabled] = useState(false);

  // 执行导出
  const {
    execute: executeExport,
    loading: exporting,
    error: exportError,
  } = useApiPost<ExportResult, ExportParams>('/google-drive/export', {
    onSuccess: (result) => {
      setExportId(result.exportId);
      setPollingEnabled(true);
    },
    onError: (err) => {
      logger.error('Export failed:', err);
      onError?.(err as Error);
    },
  });

  // 轮询获取进度
  const {
    data: progressData,
    error: progressError,
    execute: fetchProgress,
  } = useApiGet<{ progress: ExportProgress }>(
    exportId ? `/google-drive/export/${exportId}` : '',
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
    if (progress.totalResources === 0) return 0;
    return Math.round(
      (progress.processedResources / progress.totalResources) * 100
    );
  }, [progress]);

  const isComplete = progress?.status === 'completed';
  const hasFailed = progress?.status === 'failed';

  // 执行导出
  const exportResources = useCallback(
    async (
      resourceIds: string[],
      targetFolderId: string,
      format?: 'original' | 'pdf' | 'docx' | 'markdown',
      customOptions?: Partial<ExportParams['options']>
    ) => {
      if (resourceIds.length === 0) {
        throw new Error('No resources selected');
      }

      const params: ExportParams = {
        connectionId,
        resourceIds,
        targetFolderId,
        format: format || defaultFormat,
        options: {
          ...defaultOptions,
          ...customOptions,
        },
      };

      await executeExport(params);
    },
    [connectionId, defaultFormat, defaultOptions, executeExport]
  );

  // 取消导出
  const cancelExport = useCallback(() => {
    setExportId(null);
    setPollingEnabled(false);
  }, []);

  // 重置状态
  const reset = useCallback(() => {
    setExportId(null);
    setPollingEnabled(false);
  }, []);

  // 是否可以导出
  const canExport = !exporting;

  // 轮询进度
  const pollProgress = useCallback(async () => {
    if (!exportId || !pollingEnabled) return;

    try {
      await fetchProgress();
    } catch (err) {
      logger.error('Failed to fetch progress:', err);
    }
  }, [exportId, pollingEnabled, fetchProgress]);

  // 设置轮询
  useEffect(() => {
    if (!pollingEnabled || !exportId) return;

    const interval = setInterval(pollProgress, 2000);
    return () => clearInterval(interval);
  }, [pollingEnabled, exportId, pollProgress]);

  // 监听完成状态
  useEffect(() => {
    if (!progress) return;

    if (progress.status === 'completed') {
      setPollingEnabled(false);
      onComplete?.(progress);
    } else if (progress.status === 'failed') {
      setPollingEnabled(false);
      onError?.(new Error('Export failed'));
    }
  }, [progress, onComplete, onError]);

  return {
    // 导出状态
    exporting,
    exportId,
    progress,
    progressPercent,

    // 错误
    error: exportError || progressError,

    // 操作方法
    exportResources,
    cancelExport,
    reset,

    // 辅助方法
    isComplete,
    hasFailed,
    canExport,
  };
}

// ==================== 导出类型 ====================

export type { ExportProgress, ExportParams };

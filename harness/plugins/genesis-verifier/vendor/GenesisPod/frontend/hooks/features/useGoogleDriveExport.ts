'use client';

import { useState, useCallback } from 'react';
import { useApiPost } from '@/hooks/core';

export type ExportFormat =
  | 'original'
  | 'pdf'
  | 'markdown'
  | 'html'
  | 'docx'
  | 'txt';

export interface ExportOptions {
  format?: ExportFormat;
  folderId?: string;
  createFolders?: boolean;
  fileNamePrefix?: string;
  includeAISummary?: boolean;
  includeNotes?: boolean;
  includeMetadata?: boolean;
}

export interface ExportProgress {
  resourceId: string;
  resourceTitle: string;
  status: 'pending' | 'exporting' | 'success' | 'failed';
  error?: string;
}

export interface ExportResult {
  totalResources: number;
  exported: number;
  failed: number;
  errors: Array<{ resourceId: string; error: string }>;
  exportedFiles: Array<{
    resourceId: string;
    driveFileId: string;
    webViewLink: string;
  }>;
}

export interface Resource {
  id: string;
  title: string;
  type?: string;
}

/**
 * Google Drive 导出 Hook
 *
 * 功能：
 * - 批量导出 Library 资源到 Google Drive
 * - 多种导出格式支持
 * - 实时进度跟踪
 */
export function useGoogleDriveExport() {
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState<ExportProgress[]>([]);
  const [totalProgress, setTotalProgress] = useState(0);

  const { execute: exportResources } = useApiPost<ExportResult>(
    '/api/v1/google-drive/export'
  );

  /**
   * 导出资源
   */
  const exportToDrive = useCallback(
    async (
      resources: Resource[],
      options: ExportOptions = {}
    ): Promise<ExportResult> => {
      setIsExporting(true);

      // 初始化进度
      const initialProgress: ExportProgress[] = resources.map((resource) => ({
        resourceId: resource.id,
        resourceTitle: resource.title,
        status: 'pending',
      }));
      setProgress(initialProgress);
      setTotalProgress(0);

      try {
        const resourceIds = resources.map((r) => r.id);

        // 模拟实时进度更新
        const progressInterval = setInterval(() => {
          setProgress((prev) =>
            prev.map((p) =>
              p.status === 'pending'
                ? { ...p, status: 'exporting' as const }
                : p
            )
          );
          setTotalProgress((prev) => Math.min(prev + 10, 90));
        }, 500);

        const result = await exportResources({
          resourceIds,
          folderId: options.folderId,
          format: options.format || 'original',
          createFolders: options.createFolders ?? false,
          fileNamePrefix: options.fileNamePrefix,
        });

        clearInterval(progressInterval);

        // Handle undefined result (API error)
        if (!result) {
          throw new Error('Export failed: No response from server');
        }

        // 更新最终状态
        setProgress(
          resources.map((resource) => {
            const hasError = result.errors.some(
              (e: { resourceId: string }) => e.resourceId === resource.id
            );
            return {
              resourceId: resource.id,
              resourceTitle: resource.title,
              status: hasError ? 'failed' : 'success',
              error: hasError
                ? result.errors.find(
                    (e: { resourceId: string; error: string }) =>
                      e.resourceId === resource.id
                  )?.error
                : undefined,
            };
          })
        );
        setTotalProgress(100);

        return result;
      } catch (error) {
        // 全部标记为失败
        setProgress((prev) =>
          prev.map((p) => ({
            ...p,
            status: 'failed',
            error: error instanceof Error ? error.message : 'Export failed',
          }))
        );
        throw error;
      } finally {
        setIsExporting(false);
      }
    },
    [exportResources]
  );

  /**
   * 重置状态
   */
  const reset = useCallback(() => {
    setIsExporting(false);
    setProgress([]);
    setTotalProgress(0);
  }, []);

  return {
    exportToDrive,
    isExporting,
    progress,
    totalProgress,
    reset,
  };
}

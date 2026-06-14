'use client';

import { useState, useCallback } from 'react';
import { useApiPost } from '@/hooks/core';

export interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  createdTime?: string;
  modifiedTime?: string;
  webViewLink?: string;
  thumbnailLink?: string;
}

export interface ImportOptions {
  extractContent?: boolean;
  generateSummary?: boolean;
  collectionId?: string;
  tags?: string[];
}

export interface ImportProgress {
  fileId: string;
  fileName: string;
  status: 'pending' | 'importing' | 'success' | 'failed';
  error?: string;
}

export interface ImportResult {
  totalFiles: number;
  imported: number;
  failed: number;
  errors: Array<{ fileId: string; error: string }>;
}

/**
 * Google Drive 导入 Hook
 *
 * 功能：
 * - 批量导入 Google Drive 文件到 Library
 * - 实时进度跟踪
 * - 错误处理和重试
 */
export function useGoogleDriveImport() {
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState<ImportProgress[]>([]);
  const [totalProgress, setTotalProgress] = useState(0);

  const { execute: importFiles } = useApiPost<ImportResult>(
    '/api/v1/google-drive/import'
  );

  /**
   * 导入文件
   */
  const importFromDrive = useCallback(
    async (
      files: GoogleDriveFile[],
      options: ImportOptions = {}
    ): Promise<ImportResult> => {
      setIsImporting(true);

      // 初始化进度
      const initialProgress: ImportProgress[] = files.map((file) => ({
        fileId: file.id,
        fileName: file.name,
        status: 'pending',
      }));
      setProgress(initialProgress);
      setTotalProgress(0);

      try {
        const fileIds = files.map((f) => f.id);

        // 模拟实时进度更新
        const progressInterval = setInterval(() => {
          setProgress((prev) =>
            prev.map((p) =>
              p.status === 'pending'
                ? { ...p, status: 'importing' as const }
                : p
            )
          );
          setTotalProgress((prev) => Math.min(prev + 10, 90));
        }, 500);

        const result = await importFiles({
          fileIds,
          extractContent: options.extractContent ?? true,
          generateSummary: options.generateSummary ?? false,
          collectionId: options.collectionId,
          tags: options.tags,
        });

        clearInterval(progressInterval);

        // Handle undefined result (API error)
        if (!result) {
          throw new Error('Import failed: No response from server');
        }

        // 更新最终状态
        setProgress(
          files.map((file) => {
            const hasError = result.errors.some((e) => e.fileId === file.id);
            return {
              fileId: file.id,
              fileName: file.name,
              status: hasError ? 'failed' : 'success',
              error: hasError
                ? result.errors.find((e) => e.fileId === file.id)?.error
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
            error: error instanceof Error ? error.message : 'Import failed',
          }))
        );
        throw error;
      } finally {
        setIsImporting(false);
      }
    },
    [importFiles]
  );

  /**
   * 重置状态
   */
  const reset = useCallback(() => {
    setIsImporting(false);
    setProgress([]);
    setTotalProgress(0);
  }, []);

  return {
    importFromDrive,
    isImporting,
    progress,
    totalProgress,
    reset,
  };
}

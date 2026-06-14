/**
 * 统一导出系统 - 前端 Hook
 *
 * 提供统一的导出功能接口
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { apiClient } from '@/lib/api/client';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { toast } from '@/stores';
import { logger } from '@/lib/utils/logger';

// ==================== 类型定义 ====================

export type ExportFormat =
  | 'PDF'
  | 'DOCX'
  | 'PPTX'
  | 'XLSX'
  | 'MARKDOWN'
  | 'HTML';

export type ExportSourceType =
  | 'DOCUMENT'
  | 'RESEARCH'
  | 'REPORT'
  | 'RAW'
  | 'MISSION'
  | 'PLANNING'
  | 'WRITING'
  | 'SOCIAL'
  | 'SLIDES'
  | 'TOPIC_REPORT';

export type TemplateCategory =
  | 'REPORT'
  | 'PPT'
  | 'DOCUMENT'
  | 'ACADEMIC'
  | 'BUSINESS';

export interface ExportSource {
  type: ExportSourceType;
  documentId?: string;
  sessionId?: string;
  reportId?: string;
  missionId?: string;
  topicId?: string;
  planId?: string;
  contentId?: string;
  content?: string;
  contentType?: 'markdown' | 'html' | 'json';
  title?: string;
}

export interface ExportOptions {
  includeCover?: boolean;
  includeTableOfContents?: boolean;
  includeReferences?: boolean;
  includePageNumbers?: boolean;
  pageSize?: 'A4' | 'A3' | 'Letter' | 'Legal';
  orientation?: 'portrait' | 'landscape';
  watermark?: string;
  fileName?: string;
  // Mission 导出专用：简化模式只导出核心结果
  simplifiedMode?: boolean;
  // WYSIWYG 导出选项
  renderMode?: 'wysiwyg' | 'editable';
  wysiwygHtml?: string;
  wysiwygCss?: string;
  // 导出范围 (planning: 'full' = 全部阶段, undefined = 仅报告)
  exportScope?: 'full';
}

export interface ExportRequest {
  source: ExportSource;
  format: ExportFormat;
  templateId?: string;
  options?: ExportOptions;
}

export interface ExportJobResponse {
  jobId: string;
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  progress: number;
  estimatedTime?: number;
  downloadUrl?: string;
  expiresAt?: string;
  fileName?: string;
  fileSize?: number;
  error?: string;
}

export interface ExportTemplate {
  id: string;
  name: string;
  description?: string;
  category: TemplateCategory;
  supportedFormats: ExportFormat[];
  isBuiltIn: boolean;
  isDefault: boolean;
  previewImage?: string;
}

export interface ExportStatus {
  status: 'idle' | 'processing' | 'completed' | 'failed';
  progress?: number;
  downloadUrl?: string;
  fileName?: string;
  error?: string;
  jobId?: string;
}

export interface UseExportResult {
  // 状态
  exportStatus: ExportStatus;
  isExporting: boolean;
  error: string | null;

  // 操作
  exportDocument: (request: ExportRequest) => Promise<ExportJobResponse>;
  exportResearch: (
    sessionId: string,
    format: ExportFormat,
    options?: ExportOptions
  ) => Promise<ExportJobResponse>;
  exportMission: (
    missionId: string,
    topicId: string,
    format: ExportFormat,
    options?: ExportOptions
  ) => Promise<ExportJobResponse>;
  exportRaw: (
    content: string,
    format: ExportFormat,
    title?: string,
    options?: ExportOptions
  ) => Promise<ExportJobResponse>;

  // 模板
  getTemplates: (category?: TemplateCategory) => Promise<ExportTemplate[]>;

  // 下载
  downloadExport: (jobId: string) => Promise<void>;

  // 重置
  reset: () => void;
}

// ==================== Hook 实现 ====================

export function useExport(): UseExportResult {
  const [status, setStatus] = useState<ExportStatus>({ status: 'idle' });
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Cleanup: abort polling on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  /**
   * 轮询任务状态
   */
  const pollJobStatus = useCallback(
    async (
      jobId: string,
      onProgress?: (progress: number) => void
    ): Promise<ExportJobResponse | null> => {
      // Cancel any previous polling before starting a new one
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const maxAttempts = 120; // 最多轮询 2 分钟
      const interval = 1000; // 每秒轮询一次

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (controller.signal.aborted) return null;

        const result = await apiClient.get<ExportJobResponse>(
          `/export/${jobId}`
        );

        if (controller.signal.aborted) return null;

        if (onProgress) {
          onProgress(result.progress);
        }

        if (result.status === 'COMPLETED') {
          return result;
        }

        if (result.status === 'FAILED') {
          throw new Error(result.error || 'Export failed');
        }

        // 等待下一次轮询
        await new Promise((resolve) => setTimeout(resolve, interval));
      }

      throw new Error('Export timeout');
    },
    []
  );

  /**
   * 创建导出任务
   */
  const exportDocument = useCallback(
    async (request: ExportRequest): Promise<ExportJobResponse> => {
      setIsExporting(true);
      setError(null);
      setStatus({ status: 'processing', progress: 0 });

      try {
        // 1. 创建导出任务
        let actualRequest = request;

        // WYSIWYG body 可能很大（HTML + Tailwind CSS），先尝试发送
        // 如果失败则自动 fallback 到 editable 模式（后端自行渲染）
        let jobId: string;
        try {
          const res = await apiClient.post<{ jobId: string }>(
            '/export',
            actualRequest,
            { timeout: 120000 }
          );
          jobId = res.jobId;
        } catch (postError) {
          // WYSIWYG 请求失败（body 太大/连接中断），fallback 到 editable 模式
          if (
            actualRequest.options?.renderMode === 'wysiwyg' &&
            actualRequest.options?.wysiwygHtml
          ) {
            logger.warn(
              '[useExport] WYSIWYG export failed, falling back to editable mode:',
              postError
            );
            toast.warning(
              '导出模式降级',
              '所见所得导出失败（网络或请求体过大），已切换为标准模式导出'
            );

            const fallbackOptions = { ...actualRequest.options };
            delete fallbackOptions.wysiwygHtml;
            delete fallbackOptions.wysiwygCss;
            fallbackOptions.renderMode = 'editable';
            actualRequest = { ...actualRequest, options: fallbackOptions };

            const res = await apiClient.post<{ jobId: string }>(
              '/export',
              actualRequest,
              { timeout: 120000 }
            );
            jobId = res.jobId;
          } else {
            throw postError;
          }
        }

        // 2. 轮询任务状态
        const result = await pollJobStatus(jobId, (progress) => {
          setStatus({ status: 'processing', progress });
        });

        // 轮询被取消
        if (!result) {
          setStatus({ status: 'idle' });
          return { jobId, status: 'PROCESSING', progress: 0 };
        }

        // 3. 更新状态
        setStatus({
          status: 'completed',
          downloadUrl: result.downloadUrl,
          fileName: result.fileName,
          jobId,
        });

        return result;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Export failed';
        setError(errorMessage);
        setStatus({ status: 'failed', error: errorMessage });
        throw err;
      } finally {
        setIsExporting(false);
      }
    },
    [pollJobStatus]
  );

  /**
   * 导出研究报告（快捷方法）
   */
  const exportResearch = useCallback(
    async (
      sessionId: string,
      format: ExportFormat,
      options?: ExportOptions
    ): Promise<ExportJobResponse> => {
      return exportDocument({
        source: {
          type: 'RESEARCH',
          sessionId,
        },
        format,
        templateId: 'deep-research', // 使用深度研究专用模板
        options: {
          includeCover: true,
          includeTableOfContents: true,
          includeReferences: true,
          ...options,
        },
      });
    },
    [exportDocument]
  );

  /**
   * 导出 AI Teams 任务报告（快捷方法）
   */
  const exportMission = useCallback(
    async (
      missionId: string,
      topicId: string,
      format: ExportFormat,
      options?: ExportOptions
    ): Promise<ExportJobResponse> => {
      return exportDocument({
        source: {
          type: 'MISSION',
          missionId,
          topicId,
        },
        format,
        templateId: 'mission-report', // 使用 AI Teams 任务报告专用模板
        options: {
          includeCover: true,
          includeTableOfContents: true,
          ...options,
        },
      });
    },
    [exportDocument]
  );

  /**
   * 导出原始内容（快捷方法）
   */
  const exportRaw = useCallback(
    async (
      content: string,
      format: ExportFormat,
      title?: string,
      options?: ExportOptions
    ): Promise<ExportJobResponse> => {
      return exportDocument({
        source: {
          type: 'RAW',
          content,
          contentType: 'markdown',
          title,
        },
        format,
        options,
      });
    },
    [exportDocument]
  );

  /**
   * 获取模板列表
   */
  const getTemplates = useCallback(
    async (category?: TemplateCategory): Promise<ExportTemplate[]> => {
      const params = new URLSearchParams();
      if (category) {
        params.set('category', category);
      }

      return apiClient.get<ExportTemplate[]>(`/templates?${params.toString()}`);
    },
    []
  );

  /**
   * 下载导出文件
   */
  const downloadExport = useCallback(async (jobId: string) => {
    try {
      const response = await fetch(
        `${config.apiUrl}/export/${jobId}/download`,
        {
          headers: getAuthHeader(),
        }
      );
      if (!response.ok) throw new Error('Download failed');
      const blob = await response.blob();
      const contentDisposition = response.headers.get('Content-Disposition');
      // Parse RFC 5987 filename*=UTF-8''<encoded> or standard filename="<name>"
      let fileName = 'export';
      if (contentDisposition) {
        const rfc5987Match = contentDisposition.match(
          /filename\*=UTF-8''(.+?)(?:;|$)/i
        );
        if (rfc5987Match) {
          fileName = decodeURIComponent(rfc5987Match[1]);
        } else {
          const standardMatch = contentDisposition.match(
            /filename="?([^";]+)"?/
          );
          if (standardMatch) {
            fileName = standardMatch[1];
          }
        }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      setStatus((prev) => ({
        ...prev,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Download failed',
      }));
    }
  }, []);

  /**
   * 重置状态
   */
  const reset = useCallback(() => {
    setStatus({ status: 'idle' });
    setIsExporting(false);
    setError(null);
  }, []);

  return {
    exportStatus: status,
    isExporting,
    error,
    exportDocument,
    exportResearch,
    exportMission,
    exportRaw,
    getTemplates,
    downloadExport,
    reset,
  };
}

export default useExport;

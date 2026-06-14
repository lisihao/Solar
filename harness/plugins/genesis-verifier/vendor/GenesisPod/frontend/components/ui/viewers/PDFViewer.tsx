'use client';

import { useState, useEffect, useRef } from 'react';
import { config } from '@/lib/utils/config';

import { logger } from '@/lib/utils/logger';
interface PDFViewerProps {
  url: string;
  title?: string;
  className?: string;
}

/**
 * PDF查看器组件 - 使用Blob URL安全渲染PDF
 *
 * 功能特性:
 * - 客户端PDF渲染，避免跨域iframe阻止
 * - 通过后端代理获取PDF内容
 * - 使用Blob URL创建同源object/iframe
 * - 加载状态和错误处理
 * - 重试机制
 */
export default function PDFViewer({
  url,
  title = 'PDF Preview',
  className = '',
}: PDFViewerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  // 清理Blob URL - 仅在组件卸载时执行
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
      }
    };
  }, []);

  // 加载PDF内容
  useEffect(() => {
    const loadPDF = async () => {
      setLoading(true);
      setError(null);

      // 清理旧的blob URL - 使用ref确保不触发额外的重新渲染
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
      setBlobUrl(null);

      try {
        const proxyUrl = `${config.apiUrl}/proxy/pdf?url=${encodeURIComponent(url)}`;
        logger.debug(`Fetching PDF from proxy: ${proxyUrl}`);

        const response = await fetch(proxyUrl);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const pdfBlob = await response.blob();
        logger.debug(
          `PDF loaded successfully: ${pdfBlob.size} bytes from ${url}`
        );

        // 创建Blob URL - 同时保存到ref和state
        const newBlobUrl = URL.createObjectURL(pdfBlob);
        blobUrlRef.current = newBlobUrl;
        setBlobUrl(newBlobUrl);

        setLoading(false);
        setError(null);
      } catch (err) {
        logger.error(`Failed to load PDF from ${url}:`, err);
        setLoading(false);
        setError(
          err instanceof Error
            ? `Failed to load PDF: ${err.message}`
            : 'Failed to load PDF. The file may be unavailable.'
        );
      }
    };

    loadPDF();
  }, [url, retryCount]); // retryCount变化时重新加载

  const handleRetry = () => {
    setRetryCount((prev) => prev + 1);
  };

  const handleOpenInNewTab = () => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className={`relative flex h-full flex-col ${className}`}>
      {/* 紧凑控制栏 - 移除标题显示，最大化阅读区域 */}
      <div className="flex items-center justify-end gap-0.5 border-b bg-gray-50 px-1 py-0.5">
        {/* 刷新按钮 */}
        <button
          onClick={handleRetry}
          className="rounded p-1 transition-colors hover:bg-gray-200"
          title="刷新"
        >
          <svg
            className="h-3.5 w-3.5 text-gray-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>

        {/* 新标签页打开 */}
        <button
          onClick={handleOpenInNewTab}
          className="rounded p-1 transition-colors hover:bg-gray-200"
          title="在新标签页打开"
        >
          <svg
            className="h-3.5 w-3.5 text-gray-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
            />
          </svg>
        </button>
      </div>

      {/* PDF内容区域 */}
      <div className="relative flex-1 overflow-hidden">
        {/* Loading State */}
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white">
            <div className="text-center">
              <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-gray-200 border-t-primary"></div>
              <p className="mt-4 text-sm text-gray-600">Loading PDF...</p>
              <p className="mt-2 text-xs text-gray-500">
                This may take a few seconds
              </p>
            </div>
          </div>
        )}

        {/* Error State */}
        {error && !loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-50">
            <div className="max-w-md text-center">
              <svg
                className="mx-auto h-16 w-16 text-red-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <h3 className="mt-4 text-lg font-medium text-gray-900">
                PDF Unavailable
              </h3>
              <p className="mt-2 text-sm text-gray-600">{error}</p>
              <div className="mt-6 flex justify-center gap-3">
                <button
                  onClick={handleRetry}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  Retry{retryCount > 0 && ` (${retryCount})`}
                </button>
                <button
                  onClick={handleOpenInNewTab}
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                    />
                  </svg>
                  Open Original
                </button>
              </div>
            </div>
          </div>
        )}

        {/* PDF via object tag with Blob URL - 避免跨域问题 */}
        {/* 使用 #view=FitH 参数让PDF默认适应宽度显示，#toolbar=0 隐藏浏览器原生工具栏 */}
        {blobUrl && !loading && !error && (
          <object
            data={`${blobUrl}#view=FitH&toolbar=0`}
            type="application/pdf"
            className="h-full w-full"
            title={title}
          >
            <div className="flex h-full items-center justify-center bg-gray-50 p-8">
              <div className="max-w-md text-center">
                <svg
                  className="mx-auto h-16 w-16 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                <h3 className="mt-4 text-lg font-medium text-gray-900">
                  PDF Viewer Not Available
                </h3>
                <p className="mt-2 text-sm text-gray-600">
                  Your browser doesn't support embedded PDF viewing.
                </p>
                <button
                  onClick={handleOpenInNewTab}
                  className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                    />
                  </svg>
                  Open PDF in New Tab
                </button>
              </div>
            </div>
          </object>
        )}
      </div>
    </div>
  );
}

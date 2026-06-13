'use client';

import { useState, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { config } from '@/lib/utils/config';

import { logger } from '@/lib/utils/logger';
// Configure PDF.js worker (CSS is imported globally in globals.css)
// PDF.js 5.x uses .mjs extension and different build path
if (typeof window !== 'undefined') {
  // Use unpkg which has latest versions
  pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
}

interface PDFViewerClientProps {
  url: string;
  title?: string;
  className?: string;
}

/**
 * PDF查看器客户端组件 - 使用PDF.js在客户端渲染PDF
 * 仅在客户端运行，避免SSR问题
 */
export default function PDFViewerClient({
  url,
  title = 'PDF Preview',
  className = '',
}: PDFViewerClientProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState<number>(1.0);

  // 构建代理URL
  const proxyUrl = `${config.apiUrl}/proxy/pdf?url=${encodeURIComponent(url)}`;

  // 重置状态当URL改变时
  useEffect(() => {
    setLoading(true);
    setError(null);
    setPageNumber(1);
    setNumPages(0);
  }, [url]);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    logger.debug(`PDF loaded successfully: ${numPages} pages from ${url}`);
    setNumPages(numPages);
    setLoading(false);
    setError(null);
  };

  const onDocumentLoadError = (error: Error) => {
    logger.error(`PDF failed to load from ${url}:`, error);
    setLoading(false);
    setError('Failed to load PDF. The file may be unavailable or corrupted.');
  };

  const goToPrevPage = () => {
    setPageNumber((prev) => Math.max(1, prev - 1));
  };

  const goToNextPage = () => {
    setPageNumber((prev) => Math.min(numPages, prev + 1));
  };

  const zoomIn = () => {
    setScale((prev) => Math.min(3.0, prev + 0.2));
  };

  const zoomOut = () => {
    setScale((prev) => Math.max(0.5, prev - 0.2));
  };

  const resetZoom = () => {
    setScale(1.0);
  };

  const handleOpenInNewTab = () => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className={`relative flex h-full flex-col ${className}`}>
      {/* 控制栏 */}
      <div className="flex items-center justify-between border-b bg-gray-50 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700">{title}</span>
        </div>

        <div className="flex items-center gap-4">
          {/* 缩放控制 */}
          {!loading && !error && (
            <div className="flex items-center gap-2">
              <button
                onClick={zoomOut}
                disabled={scale <= 0.5}
                className="rounded p-1 hover:bg-gray-200 disabled:opacity-50"
                title="Zoom Out"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7"
                  />
                </svg>
              </button>
              <span className="text-sm text-gray-600">
                {Math.round(scale * 100)}%
              </span>
              <button
                onClick={resetZoom}
                className="rounded px-2 py-1 text-xs hover:bg-gray-200"
                title="Reset Zoom"
              >
                Reset
              </button>
              <button
                onClick={zoomIn}
                disabled={scale >= 3.0}
                className="rounded p-1 hover:bg-gray-200 disabled:opacity-50"
                title="Zoom In"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7"
                  />
                </svg>
              </button>
            </div>
          )}

          {/* 页面导航 */}
          {!loading && !error && numPages > 0 && (
            <div className="flex items-center gap-2">
              <button
                onClick={goToPrevPage}
                disabled={pageNumber <= 1}
                className="rounded p-1 hover:bg-gray-200 disabled:opacity-50"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
              </button>
              <span className="text-sm text-gray-600">
                Page {pageNumber} of {numPages}
              </span>
              <button
                onClick={goToNextPage}
                disabled={pageNumber >= numPages}
                className="rounded p-1 hover:bg-gray-200 disabled:opacity-50"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </button>
            </div>
          )}

          {/* 打开原始链接 */}
          <button
            onClick={handleOpenInNewTab}
            className="rounded p-1 hover:bg-gray-200"
            title="Open Original"
          >
            <svg
              className="h-5 w-5"
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
      </div>

      {/* PDF内容区域 */}
      <div className="relative flex-1 overflow-auto bg-gray-100">
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
              <div className="mt-6">
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

        {/* PDF Document */}
        {!error && (
          <div className="flex justify-center p-4">
            <Document
              file={proxyUrl}
              onLoadSuccess={onDocumentLoadSuccess}
              onLoadError={onDocumentLoadError}
              loading={null}
              error={null}
            >
              <Page
                pageNumber={pageNumber}
                scale={scale}
                renderTextLayer={true}
                renderAnnotationLayer={true}
                className="shadow-lg"
              />
            </Document>
          </div>
        )}
      </div>
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { config } from '@/lib/utils/config';

import { logger } from '@/lib/utils/logger';
interface PreviewFrameProps {
  url: string;
  type: 'pdf' | 'html';
  title?: string;
  className?: string;
}

/**
 * 预览框架组件 - 用于安全地预览PDF和HTML内容
 *
 * 功能特性:
 * - 通过后端代理绕过CORS和X-Frame-Options限制
 * - 加载状态和错误处理
 * - 适当的iframe sandbox属性
 * - 重试机制
 */
export default function PreviewFrame({
  url,
  type,
  title = 'Preview',
  className = '',
}: PreviewFrameProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  // 构建代理URL
  const proxyUrl = `${config.apiUrl}/proxy/${type}?url=${encodeURIComponent(url)}`;

  // 重置状态当URL改变时
  useEffect(() => {
    setLoading(true);
    setError(null);
    setRetryCount(0);
  }, [url, type]);

  // iframe加载完成
  const handleLoad = () => {
    logger.debug(`Preview loaded successfully: ${type} from ${url}`);
    setLoading(false);
    setError(null);
  };

  // iframe加载错误
  const handleError = () => {
    logger.error(`Preview failed to load: ${type} from ${url}`);
    setLoading(false);
    setError(
      'Failed to load preview. The content may be unavailable or blocked.'
    );
  };

  // 重试加载
  const handleRetry = () => {
    setLoading(true);
    setError(null);
    setRetryCount((prev) => prev + 1);
  };

  // 在新标签页打开
  const handleOpenInNewTab = () => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className={`relative ${className}`}>
      {/* Loading State */}
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white">
          <div className="text-center">
            <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-gray-200 border-t-primary"></div>
            <p className="mt-4 text-sm text-gray-600">
              Loading {type.toUpperCase()}...
            </p>
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
              Preview Unavailable
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

      {/* iframe - 使用key强制重新渲染当retryCount改变时 */}
      <iframe
        key={`${proxyUrl}-${retryCount}`}
        src={proxyUrl}
        title={title}
        className={`h-full w-full border-0 ${loading || error ? 'invisible' : 'visible'}`}
        onLoad={handleLoad}
        onError={handleError}
        // Sandbox属性 - 允许必要的功能同时保持安全
        sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-downloads"
        // 允许功能
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        // 安全属性
        referrerPolicy="no-referrer-when-downgrade"
        loading="lazy"
      />
    </div>
  );
}

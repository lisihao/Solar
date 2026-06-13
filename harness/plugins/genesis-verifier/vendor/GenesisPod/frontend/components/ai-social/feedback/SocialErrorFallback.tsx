'use client';

/**
 * AI Social 专用错误回退组件
 * 为 AI Social 模块提供友好的错误展示界面
 */

import { AlertTriangle, RefreshCw, Home, Share2 } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { config } from '@/lib/utils/config';

interface SocialErrorFallbackProps {
  error?: Error | null;
  errorInfo?: React.ErrorInfo | null;
  onReset?: () => void;
  onReload?: () => void;
  onGoHome?: () => void;
}

export function SocialErrorFallback({
  error,
  errorInfo,
  onReset,
  onReload,
  onGoHome,
}: SocialErrorFallbackProps) {
  const { t } = useTranslation();

  const handleReset = () => {
    if (onReset) {
      onReset();
    } else {
      window.location.reload();
    }
  };

  const handleReload = () => {
    if (onReload) {
      onReload();
    } else {
      window.location.reload();
    }
  };

  const handleGoHome = () => {
    if (onGoHome) {
      onGoHome();
    } else {
      window.location.href = '/';
    }
  };

  return (
    <div className="flex min-h-[600px] items-center justify-center bg-gradient-to-br from-rose-50 via-white to-pink-50 px-4 py-12">
      <div className="w-full max-w-2xl rounded-2xl bg-white p-8 shadow-xl">
        {/* 错误图标 */}
        <div className="mb-6 flex justify-center">
          <div className="relative">
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-500 to-pink-600 shadow-lg shadow-rose-500/25">
              <Share2 className="h-10 w-10 text-white" />
            </div>
            <div className="absolute -bottom-1 -right-1 flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
              <AlertTriangle className="h-5 w-5 text-red-600" />
            </div>
          </div>
        </div>

        {/* 错误标题 */}
        <h1 className="mb-2 text-center text-2xl font-bold text-gray-900">
          {t('aiSocial.error.title')}
        </h1>
        <p className="mb-6 text-center text-gray-600">
          {t('aiSocial.error.description')}
        </p>

        {/* 错误详情（开发模式显示） */}
        {process.env.NODE_ENV === 'development' && error && (
          <div className="mb-6 rounded-xl border-2 border-red-200 bg-red-50 p-4">
            <h3 className="mb-2 flex items-center gap-2 font-semibold text-red-900">
              <AlertTriangle className="h-4 w-4" />
              错误详情（仅开发模式显示）
            </h3>
            <pre className="mb-2 overflow-x-auto rounded-lg bg-white p-3 text-sm text-red-800">
              {error.toString()}
            </pre>
            {errorInfo && (
              <details className="mt-2">
                <summary className="cursor-pointer text-sm font-medium text-red-900 hover:text-red-700">
                  查看组件堆栈
                </summary>
                <pre className="mt-2 overflow-x-auto rounded-lg bg-white p-3 text-xs text-red-700">
                  {errorInfo.componentStack}
                </pre>
              </details>
            )}
          </div>
        )}

        {/* 常见原因提示 */}
        <div className="mb-6 rounded-xl bg-rose-50 p-4">
          <h3 className="mb-2 font-semibold text-rose-900">
            {t('aiSocial.error.possibleCauses')}
          </h3>
          <ul className="space-y-1 text-sm text-rose-700">
            <li>• {t('aiSocial.error.cause1')}</li>
            <li>• {t('aiSocial.error.cause2')}</li>
            <li>• {t('aiSocial.error.cause3')}</li>
          </ul>
        </div>

        {/* 操作按钮 */}
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            onClick={handleReset}
            className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-rose-500 to-pink-600 px-6 py-3 font-medium text-white shadow-lg shadow-rose-500/25 transition-all hover:shadow-xl hover:shadow-rose-500/30"
          >
            <RefreshCw className="h-5 w-5" />
            {t('aiSocial.error.retry')}
          </button>

          <button
            onClick={handleReload}
            className="flex items-center justify-center gap-2 rounded-xl border-2 border-gray-300 bg-white px-6 py-3 font-medium text-gray-700 transition-colors hover:border-gray-400 hover:bg-gray-50"
          >
            <RefreshCw className="h-5 w-5" />
            {t('aiSocial.error.reload')}
          </button>

          <button
            onClick={handleGoHome}
            className="flex items-center justify-center gap-2 rounded-xl border-2 border-gray-300 bg-white px-6 py-3 font-medium text-gray-700 transition-colors hover:border-gray-400 hover:bg-gray-50"
          >
            <Home className="h-5 w-5" />
            {t('aiSocial.error.goHome')}
          </button>
        </div>

        {/* 帮助信息 */}
        <div className="mt-6 border-t border-gray-200 pt-6">
          <p className="text-center text-sm text-gray-500">
            {t('aiSocial.error.helpText')}{' '}
            <a
              href={config.brand.githubIssuesUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-rose-600 hover:underline"
            >
              {t('aiSocial.error.reportIssue')}
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

export default SocialErrorFallback;

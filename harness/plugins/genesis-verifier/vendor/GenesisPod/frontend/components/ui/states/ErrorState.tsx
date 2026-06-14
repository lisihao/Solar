'use client';

import { AlertCircle, RefreshCw, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils/common';
import { Button } from '../primitives/button';

interface ErrorStateProps {
  /** 错误对象或消息 */
  error: Error | string | { message?: string; status?: number } | null;
  /** 重试回调 */
  onRetry?: () => void;
  /** 标题 */
  title?: string;
  /** 是否显示详情 */
  showDetails?: boolean;
  /** 是否全屏居中 */
  fullScreen?: boolean;
  /** 自定义类名 */
  className?: string;
}

export function ErrorState({
  error,
  onRetry,
  title = '加载失败',
  showDetails = true,
  fullScreen = false,
  className,
}: ErrorStateProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  const errorMessage =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : error?.message || null;
  const errorStack = error instanceof Error ? error.stack : undefined;

  const content = (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-4 p-6 text-center',
        className
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
        <AlertCircle className="h-6 w-6 text-red-600" />
      </div>

      <div className="space-y-1">
        <h3 className="font-semibold text-gray-900">{title}</h3>
        {errorMessage && (
          <p className="text-sm text-gray-500">{errorMessage}</p>
        )}
      </div>

      <div className="flex gap-3">
        {onRetry && (
          <Button onClick={onRetry} variant="outline" size="sm">
            <RefreshCw className="mr-2 h-4 w-4" />
            重试
          </Button>
        )}
      </div>

      {showDetails && errorStack && process.env.NODE_ENV === 'development' && (
        <div className="w-full max-w-md">
          <button
            onClick={() => setDetailsOpen(!detailsOpen)}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
          >
            <ChevronDown
              className={cn(
                'h-3 w-3 transition-transform',
                detailsOpen && 'rotate-180'
              )}
            />
            错误详情
          </button>
          {detailsOpen && (
            <pre className="mt-2 max-h-40 overflow-auto rounded bg-gray-100 p-2 text-left text-xs text-gray-600">
              {errorStack}
            </pre>
          )}
        </div>
      )}
    </div>
  );

  if (fullScreen) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        {content}
      </div>
    );
  }

  return content;
}

// 内联错误变体
export function ErrorInline({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700',
        className
      )}
    >
      <AlertCircle className="h-4 w-4 flex-shrink-0" />
      <span className="flex-1">{message}</span>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex-shrink-0 text-red-600 hover:text-red-800"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

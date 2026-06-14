'use client';

import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils/common';

interface LoadingStateProps {
  /** 加载提示文本 */
  text?: string;
  /** 尺寸: sm | md | lg */
  size?: 'sm' | 'md' | 'lg';
  /** 是否全屏居中 */
  fullScreen?: boolean;
  /** 是否显示背景遮罩 */
  overlay?: boolean;
  /** 自定义类名 */
  className?: string;
}

const sizeConfig = {
  sm: { icon: 'h-4 w-4', text: 'text-sm' },
  md: { icon: 'h-6 w-6', text: 'text-base' },
  lg: { icon: 'h-8 w-8', text: 'text-lg' },
};

export function LoadingState({
  text = '加载中...',
  size = 'md',
  fullScreen = false,
  overlay = false,
  className,
}: LoadingStateProps) {
  const config = sizeConfig[size];

  const content = (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3',
        className
      )}
    >
      <Loader2 className={cn('animate-spin text-primary', config.icon)} />
      {text && <p className={cn('text-gray-500', config.text)}>{text}</p>}
    </div>
  );

  if (fullScreen) {
    return (
      <div
        className={cn(
          'fixed inset-0 z-50 flex items-center justify-center',
          overlay && 'bg-white/80 backdrop-blur-sm'
        )}
      >
        {content}
      </div>
    );
  }

  return (
    <div className="flex min-h-[200px] items-center justify-center">
      {content}
    </div>
  );
}

// 骨架屏变体
export function LoadingSkeleton({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn('animate-pulse space-y-3', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-4 rounded bg-gray-200"
          style={{ width: `${100 - i * 15}%` }}
        />
      ))}
    </div>
  );
}

// 内联加载变体
export function LoadingInline({
  text = '加载中',
  className,
}: {
  text?: string;
  className?: string;
}) {
  return (
    <span
      className={cn('inline-flex items-center gap-2 text-gray-500', className)}
    >
      <Loader2 className="h-4 w-4 animate-spin" />
      {text}
    </span>
  );
}

'use client';

/**
 * SourceUpdateBadge - 来源已更新提示徽章
 *
 * 当 PPT 关联的来源（AI Insights / AI Research）发生更新时，
 * 显示此徽章提示用户刷新内容。
 */

import { RefreshCw } from 'lucide-react';

interface SourceUpdateBadgeProps {
  sourceName?: string;
  onRefresh?: () => void;
  className?: string;
}

export function SourceUpdateBadge({
  sourceName,
  onRefresh,
  className,
}: SourceUpdateBadgeProps) {
  return (
    <div
      className={`flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-700 ${className ?? ''}`}
    >
      <RefreshCw className="h-3 w-3 flex-shrink-0" />
      <span>{sourceName ? `来源「${sourceName}」已更新` : '来源已更新'}</span>
      {onRefresh && (
        <button
          onClick={onRefresh}
          className="font-medium underline hover:no-underline"
        >
          刷新
        </button>
      )}
    </div>
  );
}

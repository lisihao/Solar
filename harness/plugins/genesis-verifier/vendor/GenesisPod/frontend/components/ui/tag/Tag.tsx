'use client';

/**
 * Tag — 关键词 / 标签 chip（canonical，2026-05-22 提取）。
 *
 * **范围（重要）**：只收「关键词 / 标签」用途（如 #话题、技能标签、来源类型）。
 *   - 状态片（进行中/已完成/失败）→ 用 `StatusBadge`，不要用 Tag。
 *   - 计数徽标（12）→ 各自 badge / 内联，不要用 Tag。
 *   - 可点导航的不算 tag。
 * 保持极简，不做 Strategy/变体爆炸（Karpathy 反过度抽象）。
 */

import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils/common';

export interface TagProps {
  children: ReactNode;
  /** 前置小图标（可选） */
  icon?: ReactNode;
  /** 传入则显示移除按钮（可编辑标签场景） */
  onRemove?: () => void;
  removeLabel?: string;
  className?: string;
}

export function Tag({
  children,
  icon,
  onRemove,
  removeLabel = '移除',
  className,
}: TagProps) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600',
        className
      )}
    >
      {icon}
      <span className="truncate">{children}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="-mr-0.5 ml-0.5 shrink-0 rounded-full p-0.5 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

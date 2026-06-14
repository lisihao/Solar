'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/common';

/**
 * CardGrid — 标准卡片网格 canonical（单一事实来源）。
 *
 * 统一 AI App 各模块卡片网格的列数 + 间距，取代各页硬编码的
 * `grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4` 串
 * （此前 Wiki / 个人 KB / 团队 KB / 书签 各写各的，列数不一致 → 卡片大小不一）。
 * 配合 AssetCard 的 `h-full`（等高填充网格行），实现「卡片呈现归一」。
 *
 * 特殊密度（如图片墙 aspect-square 多列）可经 `className` 覆盖，但默认即标准网格。
 */
export interface CardGridProps {
  children: ReactNode;
  /** 覆盖/追加网格类（特殊密度场景）；不传即标准 1/2/3/4 列响应式。 */
  className?: string;
}

export function CardGrid({ children, className }: CardGridProps) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
        className
      )}
    >
      {children}
    </div>
  );
}

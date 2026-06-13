'use client';

import type { MouseEvent, ReactNode } from 'react';
import { cn } from '@/lib/utils/common';

/**
 * FeedCard —— 横版「信息流卡」canonical（卡设计系统第 8 类）。
 *
 * 区别于竖版 AssetCard：左侧大缩略图 + 右侧内容（meta 行 / 标题 / 摘要 / 底部带文字
 * 的动作条）。用于 explore 资源流等「feed 列表项」场景。结构骨架统一在此，领域内容
 * （徽章 / chip / 摘要 fallback / 动作集）由调用方经 slot 注入，不在平台层硬编码。
 */
export interface FeedCardAction {
  key: string;
  /** 图标节点（如 <ThumbsUp className="h-4 w-4" />） */
  icon: ReactNode;
  /** 图标后的文字（与 count 二者可并存；bookmark 用 label、upvote 用 count） */
  label?: ReactNode;
  /** 图标后的计数 */
  count?: number;
  /** 整个按钮的 className（由调用方按 active 态算好传入），覆盖默认灰色 */
  className?: string;
  onClick: (e: MouseEvent) => void;
  title?: string;
}

export interface FeedCardProps {
  /** 左侧缩略图 / 媒体（调用方自带组件，如 ResourceThumbnail） */
  thumbnail?: ReactNode;
  /** 缩略图宽度类（默认 w-64；窄图如 PAPER 传 w-36） */
  thumbnailWidthClassName?: string;
  /** 顶部 meta 行内容（日期 / 来源徽章 / 统计 / chip——调用方组合） */
  meta?: ReactNode;
  /** 标题 */
  title: ReactNode;
  /** 标题色等覆盖（explore 用 text-red-600；默认 text-gray-900） */
  titleClassName?: string;
  /** title 属性（hover 全文） */
  titleTooltip?: string;
  /** 摘要 / 描述区（调用方可传 fallback 逻辑） */
  description?: ReactNode;
  /** 底部动作条 */
  actions?: FeedCardAction[];
  /** 整卡点击 */
  onClick?: () => void;
  className?: string;
}

export function FeedCard({
  thumbnail,
  thumbnailWidthClassName = 'w-64',
  meta,
  title,
  titleClassName = 'text-gray-900',
  titleTooltip,
  description,
  actions,
  onClick,
  className,
}: FeedCardProps) {
  return (
    <article
      onClick={onClick}
      className={cn(
        'group w-full overflow-hidden rounded-xl border border-gray-200 bg-white transition-all hover:shadow-lg',
        onClick && 'cursor-pointer',
        className
      )}
    >
      <div className="flex h-48 w-full overflow-hidden">
        {thumbnail && (
          <div
            className={cn(
              'relative h-48 flex-shrink-0 overflow-hidden bg-gradient-to-br from-gray-50 to-gray-100',
              thumbnailWidthClassName
            )}
          >
            {thumbnail}
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden p-5">
          {meta && (
            <div className="mb-2 flex flex-shrink-0 flex-wrap items-center gap-2 text-xs text-gray-500">
              {meta}
            </div>
          )}

          <h2
            className={cn(
              'mb-2 flex-shrink-0 truncate text-xl font-semibold hover:underline',
              titleClassName
            )}
            title={titleTooltip}
          >
            {title}
          </h2>

          {description && (
            <p className="line-clamp-2 min-h-0 flex-shrink overflow-hidden text-ellipsis text-sm leading-relaxed text-gray-700">
              {description}
            </p>
          )}

          <div className="flex-1" />

          {actions && actions.length > 0 && (
            <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-t border-gray-100 pt-2 sm:gap-6">
              {actions.map((action) => (
                <button
                  key={action.key}
                  onClick={(e) => {
                    e.stopPropagation();
                    action.onClick(e);
                  }}
                  className={cn(
                    'flex items-center gap-2 text-sm transition-colors',
                    action.className ?? 'text-gray-600 hover:text-gray-900'
                  )}
                  title={action.title}
                >
                  {action.icon}
                  {action.label}
                  {action.count !== undefined && action.count}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

'use client';

/**
 * CitationListItem
 *
 * 引用/来源「列表行」canonical —— 与 CitationBadge（行内 [1] 徽章）互补：
 * Badge 用于 LLM 输出里的内联引用，ListItem 用于 References / Sources / Resources
 * 区块里 `.map` 渲染的一整行来源卡（标题 + 摘要 + 元信息 + 链接）。
 * 抽自 explore/report、library/rag、ai-research 等 ~27 处重复自写来源行（2026-05-20）。
 *
 * 设计原则（对齐 PageHeaderHero）：
 * - 字段全可选（仅 title 必填），同时覆盖 numbered（index）/ rich（thumbnail+desc+meta+actions）/
 *   simple（title+href）三种既有形态，迁移零改数据结构。
 * - 主题色由调用方注入（accentClass），平台不硬编码业务色（红/紫各异）。
 * - 不负责列表容器/间距 —— 由调用方在 .map 外层决定 grid/gap。
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/common';

export interface CitationListItemProps {
  /** 标题（必填） */
  title: string;
  /** 整项/标题链接；传入则标题渲染为新标签页链接 */
  href?: string;
  /** 编号引用 [n]；用于 numbered 列表，不传则不显示编号 */
  index?: number;
  /** 摘要 / 片段，自动 line-clamp-2 */
  description?: string;
  /** 左侧缩略图 URL */
  thumbnailUrl?: string;
  /** 元信息行（来源类型 / 域名 / 日期等，调用方组合） */
  meta?: ReactNode;
  /** 右侧动作槽（PDF / 查看 等链接或按钮） */
  actions?: ReactNode;
  /** hover 强调色类（默认中性灰边框；业务可注入主题色，如 'hover:border-red-300'） */
  accentClass?: string;
  /** 额外 className，加在根容器上 */
  className?: string;
  /** 整行点击回调（与 href 二选一；传入则根容器可点击） */
  onClick?: () => void;
}

export function CitationListItem({
  title,
  href,
  index,
  description,
  thumbnailUrl,
  meta,
  actions,
  accentClass = 'hover:border-gray-300',
  className,
  onClick,
}: CitationListItemProps) {
  const titleNode = href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-semibold text-gray-900 hover:text-violet-700 hover:underline"
    >
      {title}
    </a>
  ) : (
    <h3 className="font-semibold text-gray-900">{title}</h3>
  );

  return (
    <div
      className={cn(
        'flex gap-4 rounded-lg border border-gray-200 p-4 transition-colors',
        accentClass,
        onClick && 'cursor-pointer',
        className
      )}
      onClick={onClick}
    >
      {typeof index === 'number' && (
        <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-medium text-gray-600">
          {index}
        </span>
      )}

      {thumbnailUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumbnailUrl}
          alt=""
          className="h-20 w-16 flex-shrink-0 rounded object-cover"
        />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1">{titleNode}</div>
            {description && (
              <p className="mb-2 line-clamp-2 text-sm text-gray-600">
                {description}
              </p>
            )}
            {meta && (
              <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
                {meta}
              </div>
            )}
          </div>
          {actions && (
            <div className="flex flex-shrink-0 items-center gap-2">
              {actions}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

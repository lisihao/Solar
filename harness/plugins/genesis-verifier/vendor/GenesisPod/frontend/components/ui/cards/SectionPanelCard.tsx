'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/common';

export type SectionAccent =
  | 'red'
  | 'orange'
  | 'blue'
  | 'violet'
  | 'emerald'
  | 'amber'
  | 'gray';

const ACCENT: Record<SectionAccent, { header: string; icon: string }> = {
  red: { header: 'from-red-50 to-orange-50', icon: 'bg-red-600' },
  orange: { header: 'from-orange-50 to-yellow-50', icon: 'bg-orange-600' },
  blue: { header: 'from-blue-50 to-cyan-50', icon: 'bg-blue-600' },
  violet: { header: 'from-violet-50 to-purple-50', icon: 'bg-violet-600' },
  emerald: { header: 'from-emerald-50 to-teal-50', icon: 'bg-emerald-600' },
  amber: { header: 'from-amber-50 to-yellow-50', icon: 'bg-amber-600' },
  gray: { header: 'from-gray-50 to-slate-50', icon: 'bg-gray-600' },
};

export interface SectionPanelCardProps {
  /** 头部标题 */
  title: ReactNode;
  /** 副标题（标题下方一行小字，可选） */
  subtitle?: ReactNode;
  /** 头部图标（Lucide，如 <Sparkles className="h-4 w-4" />），随 accent 着色背景 */
  icon?: ReactNode;
  /** 配色（头部渐变 + 图标底色） */
  accent?: SectionAccent;
  /** 标题字号（默认 sm；个别用 xs） */
  titleSize?: 'xs' | 'sm';
  /** 头部右侧操作槽 */
  actions?: ReactNode;
  /** 卡片主体（调用方自控内边距/列表） */
  children: ReactNode;
  className?: string;
}

/**
 * SectionPanelCard — 内容/洞察「展示卡」canonical（渐变头 + 图标 + 标题 + 主体）。
 * 卡片设计系统第 5 类。抽自 explore AISummaryCard/AIInsightsCard/AIMethodologyCard 等同形态展示卡（2026-05-20）。
 * 只承担「外壳 + 头部」骨架；主体由调用方在 children 中自控。
 */
export function SectionPanelCard({
  title,
  subtitle,
  icon,
  accent = 'gray',
  titleSize = 'sm',
  actions,
  children,
  className,
}: SectionPanelCardProps) {
  const a = ACCENT[accent];
  return (
    <div
      className={cn(
        'rounded-xl border border-gray-200 bg-white shadow-sm',
        className
      )}
    >
      <div
        className={cn(
          'flex items-center justify-between gap-2 border-b border-gray-100 bg-gradient-to-r px-3 py-2.5',
          a.header
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          {icon && (
            <div
              className={cn(
                'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-white shadow-sm',
                a.icon
              )}
            >
              {icon}
            </div>
          )}
          <div className="min-w-0">
            <h3
              className={cn(
                'truncate font-bold text-gray-900',
                titleSize === 'xs' ? 'text-xs' : 'text-sm'
              )}
            >
              {title}
            </h3>
            {subtitle && (
              <p className="truncate text-xs font-normal text-gray-500">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {actions && <div className="flex-shrink-0">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

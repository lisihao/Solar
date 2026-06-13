'use client';

import { ArrowUpRight, type LucideIcon } from 'lucide-react';

interface ContentSummaryCardProps {
  icon: LucideIcon;
  iconBg: string; // tailwind class, e.g. 'bg-orange-50 text-orange-600'
  name: string;
  count: number;
  delta?: number; // 本月新增
  caption?: string;
  onClick: () => void;
}

/**
 * 我的内容卡（书签 / 笔记 / 图片）
 * 大数字 + 增量 + 主按钮，是连接器卡的"轻量版"
 */
export default function ContentSummaryCard({
  icon: Icon,
  iconBg,
  name,
  count,
  delta,
  caption,
  onClick,
}: ContentSummaryCardProps) {
  return (
    <button
      onClick={onClick}
      className="group relative flex h-full flex-col items-start gap-3 overflow-hidden rounded-2xl border border-gray-100 bg-white p-5 text-left shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-gray-200 hover:shadow-lg"
    >
      <div className="flex w-full items-start justify-between">
        <div
          className={`flex h-11 w-11 items-center justify-center rounded-xl ${iconBg} transition-transform duration-200 group-hover:scale-105`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <ArrowUpRight className="h-4 w-4 text-gray-300 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-violet-500" />
      </div>

      <div>
        <p className="text-sm font-medium text-gray-700">{name}</p>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-2xl font-bold text-gray-900">{count}</span>
          {typeof delta === 'number' && delta > 0 && (
            <span className="text-xs font-medium text-emerald-600">
              ↑ {delta} 本月
            </span>
          )}
        </div>
        {caption && (
          <p className="mt-1 line-clamp-1 text-xs text-gray-500">{caption}</p>
        )}
      </div>
    </button>
  );
}

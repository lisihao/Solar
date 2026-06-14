'use client';

import type { ReactNode } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils/common';

export type StatTone =
  | 'gray'
  | 'emerald'
  | 'blue'
  | 'violet'
  | 'amber'
  | 'slate'
  | 'red';

const TONE: Record<StatTone, { iconBg: string; value: string }> = {
  gray: { iconBg: 'bg-gray-100 text-gray-600', value: 'text-gray-900' },
  emerald: {
    iconBg: 'bg-emerald-100 text-emerald-600',
    value: 'text-emerald-700',
  },
  blue: { iconBg: 'bg-blue-100 text-blue-600', value: 'text-blue-700' },
  violet: { iconBg: 'bg-violet-100 text-violet-600', value: 'text-violet-700' },
  amber: { iconBg: 'bg-amber-100 text-amber-600', value: 'text-amber-700' },
  slate: { iconBg: 'bg-slate-100 text-slate-600', value: 'text-slate-700' },
  red: { iconBg: 'bg-red-100 text-red-600', value: 'text-red-700' },
};

const TREND_ICON = { up: TrendingUp, down: TrendingDown, flat: Minus } as const;
const TREND_COLOR = {
  up: 'text-emerald-600',
  down: 'text-red-600',
  flat: 'text-gray-400',
} as const;

export interface StatCardProps {
  /** 指标标签（小字） */
  label: ReactNode;
  /** 指标数值（大号 text-2xl font-bold） */
  value: ReactNode;
  /** 辅助说明（更小字，可选） */
  hint?: ReactNode;
  /** 图标节点（Lucide，如 <Database className="h-5 w-5" />），随 tone 着色 */
  icon?: ReactNode;
  /** 颜色语义 */
  tone?: StatTone;
  /** 趋势（上/下/平 + 数值） */
  trend?: { direction: 'up' | 'down' | 'flat'; value?: ReactNode };
  className?: string;
}

/**
 * StatCard — 统计/指标卡 canonical（数字 + 标签 tile）。卡片设计系统第 2 类。
 * 抽自 admin AdminStatsCards / office KpiCard 等重复自写统计卡（2026-05-20）。
 * 网格由调用方布局（`grid grid-cols-N gap-4`），每格放一个 <StatCard />。
 */
export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'gray',
  trend,
  className,
}: StatCardProps) {
  const t = TONE[tone];
  const TrendIcon = trend ? TREND_ICON[trend.direction] : null;
  return (
    <div
      className={cn(
        'rounded-lg border border-gray-200 bg-white p-4',
        className
      )}
    >
      {(icon || trend) && (
        <div className="flex items-start justify-between gap-2">
          {icon ? (
            <div
              className={cn(
                'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg',
                t.iconBg
              )}
            >
              {icon}
            </div>
          ) : (
            <span />
          )}
          {trend && TrendIcon && (
            <span
              className={cn(
                'inline-flex items-center gap-1 text-xs font-medium',
                TREND_COLOR[trend.direction]
              )}
            >
              <TrendIcon className="h-3.5 w-3.5" />
              {trend.value}
            </span>
          )}
        </div>
      )}
      <div className={cn('mt-3 text-2xl font-bold', t.value)}>{value}</div>
      <div className="mt-0.5 text-sm text-gray-500">{label}</div>
      {hint && <div className="mt-1 text-xs text-gray-400">{hint}</div>}
    </div>
  );
}

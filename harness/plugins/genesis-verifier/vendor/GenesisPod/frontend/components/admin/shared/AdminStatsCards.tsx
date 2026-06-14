'use client';

import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils/common';

export type StatSemantic =
  | 'emerald'
  | 'blue'
  | 'violet'
  | 'amber'
  | 'slate'
  | 'red';

export interface AdminStatCard {
  label: string;
  value: string | number;
  hint?: string;
  icon: LucideIcon;
  semantic?: StatSemantic;
}

interface AdminStatsCardsProps {
  cards: AdminStatCard[];
  loading?: boolean;
  className?: string;
  /**
   * Grid columns at lg breakpoint. Default 4 fits page top.
   * Use 2 in narrow containers like AdminDrawer (≤640px) where 4-col + large
   * numbers (e.g. 31,199,864) wrap mid-comma-group and look mangled.
   */
  columns?: 2 | 4;
}

const SEMANTIC_STYLES: Record<
  StatSemantic,
  { iconBg: string; valueText: string }
> = {
  emerald: {
    iconBg: 'bg-emerald-100 text-emerald-600',
    valueText: 'text-emerald-700',
  },
  blue: {
    iconBg: 'bg-blue-100 text-blue-600',
    valueText: 'text-blue-700',
  },
  violet: {
    iconBg: 'bg-violet-100 text-violet-600',
    valueText: 'text-violet-700',
  },
  amber: {
    iconBg: 'bg-amber-100 text-amber-600',
    valueText: 'text-amber-700',
  },
  slate: {
    iconBg: 'bg-slate-100 text-slate-600',
    valueText: 'text-slate-700',
  },
  red: {
    iconBg: 'bg-red-100 text-red-600',
    valueText: 'text-red-700',
  },
};

/**
 * AdminStatsCards — Top-of-page stat cards (≤4) per standards/20-admin-ui-design.md § 1.
 *
 * **Dev throws** when cards.length > 4 (避免静默截断丢数据)；prod 仍 slice 防 crash 但 console.error 上报。
 * 这是 UI 评审反馈：half-enforce 是反模式，要么类型层禁止，要么 dev 抛错让开发立即看到。
 */
export default function AdminStatsCards({
  cards,
  loading,
  className,
  columns = 4,
}: AdminStatsCardsProps) {
  if (cards.length > 4) {
    if (process.env.NODE_ENV !== 'production') {
      throw new Error(
        `[AdminStatsCards] cards.length must be ≤ 4 per standards/20 § 1, got ${cards.length}. Reduce or split into multiple AdminStatsCards.`
      );
    }
    // prod: 截断但报错，避免线上 crash
    // eslint-disable-next-line no-console
    console.error(
      `[AdminStatsCards] cards.length > 4 in production (${cards.length}); truncating to 4. Fix at dev time.`
    );
  }

  const visible = cards.slice(0, 4);
  const gridCols = columns === 2 ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-4';

  return (
    <div className={cn('grid gap-4', gridCols, className)}>
      {loading
        ? Array.from({ length: Math.max(visible.length, 4) }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-3 w-16 animate-pulse rounded bg-gray-200" />
                  <div className="h-7 w-20 animate-pulse rounded bg-gray-200" />
                </div>
                <div className="h-10 w-10 animate-pulse rounded-lg bg-gray-200" />
              </div>
            </div>
          ))
        : visible.map((card, i) => {
            const styles = SEMANTIC_STYLES[card.semantic ?? 'slate'];
            const Icon = card.icon;
            return (
              <div
                key={i}
                className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-500">
                      {card.label}
                    </p>
                    <p
                      className={cn(
                        'mt-1 truncate text-2xl font-bold tabular-nums',
                        styles.valueText
                      )}
                      title={String(card.value)}
                    >
                      {card.value}
                    </p>
                    {card.hint && (
                      <p className="mt-1 truncate text-xs text-gray-400">
                        {card.hint}
                      </p>
                    )}
                  </div>
                  <div className={cn('rounded-lg p-2.5', styles.iconBg)}>
                    <Icon className="h-5 w-5" />
                  </div>
                </div>
              </div>
            );
          })}
    </div>
  );
}

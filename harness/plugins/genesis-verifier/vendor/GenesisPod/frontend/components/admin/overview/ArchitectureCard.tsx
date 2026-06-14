'use client';

import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import {
  type ArchitectureCard as CardType,
  type CardStat,
  LAYER_STYLES,
} from '@/lib/features/admin/architecture';
import type { OverviewCardStatus } from '@/hooks/domain/useAdminStatus';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils/common';

interface ArchitectureCardProps {
  card: CardType;
  layerLevel: 1 | 2 | 3 | 4 | 5;
  fixedWidth?: boolean;
  overviewStats?: Record<string, number>;
  /** 实时状态（/admin/overview-status 的 cards[card.id]） */
  cardStatus?: OverviewCardStatus;
}

// 状态灯：healthy 绿 / degraded 黄（脉冲）/ down 红（脉冲）
const STATUS_DOT: Record<OverviewCardStatus['status'], string> = {
  healthy: 'bg-emerald-500',
  degraded: 'bg-amber-500 animate-pulse',
  down: 'bg-red-500 animate-pulse',
};

function formatStatValue(value: number, stat: CardStat): string {
  if (stat.format === 'percent') return `${value}%`;
  return value.toLocaleString();
}

export default function ArchitectureCard({
  card,
  layerLevel,
  fixedWidth = false,
  overviewStats,
  cardStatus,
}: ArchitectureCardProps) {
  const { t } = useTranslation();
  const Icon = card.icon;
  const styles = LAYER_STYLES[layerLevel];

  // 有实时状态时优先展示动态指标，否则回落到静态库存数
  const useLiveMetrics = Boolean(
    cardStatus && card.statusMetrics && card.statusMetrics.length > 0
  );
  const resolvedStats: Array<{ label: string; value: string }> | null =
    useLiveMetrics
      ? card.statusMetrics!.map((s) => ({
          label: s.label,
          value: formatStatValue(cardStatus!.metrics[s.key] ?? 0, s),
        }))
      : card.stats && overviewStats
        ? card.stats.map((s) => ({
            label: s.label,
            value: formatStatValue(overviewStats[s.key] ?? 0, s),
          }))
        : null;

  const cardContent = (
    <div
      className={cn(
        'group relative flex h-full flex-col rounded-xl border px-3.5 py-3 transition-all duration-200',
        fixedWidth && 'w-full',
        card.clickable
          ? [
              'cursor-pointer border-slate-200/80 bg-slate-50/60',
              'hover:-translate-y-px hover:border-slate-300 hover:bg-white hover:shadow-md hover:shadow-slate-200/60',
              styles.hoverBorder,
            ]
          : 'cursor-default border-slate-100 bg-slate-50/40 opacity-80',
        // 异常卡片高亮，扫一眼定位问题模块
        cardStatus?.status === 'down' &&
          'border-red-300 bg-red-50/50 hover:border-red-400',
        cardStatus?.status === 'degraded' &&
          'border-amber-300 bg-amber-50/50 hover:border-amber-400'
      )}
    >
      {/* Top row: icon + label + status dot / arrow */}
      <div className="flex items-center gap-2.5">
        <div
          className={cn(
            'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition-colors',
            card.clickable ? styles.iconBg : 'bg-slate-100 text-slate-400'
          )}
        >
          <Icon className="h-4 w-4" />
        </div>

        <span
          className={cn(
            'min-w-0 flex-1 truncate text-sm font-medium tracking-tight',
            card.clickable ? 'text-slate-800' : 'text-slate-500'
          )}
          title={t(card.i18nKey)}
        >
          {t(card.i18nKey)}
        </span>

        {/* Realtime status dot */}
        {cardStatus && (
          <span
            className={cn(
              'h-1.5 w-1.5 flex-shrink-0 rounded-full',
              STATUS_DOT[cardStatus.status]
            )}
            title={t(`admin.architecture.health.${cardStatus.status}`)}
            aria-label={t(`admin.architecture.health.${cardStatus.status}`)}
          />
        )}

        {card.clickable && (
          <ArrowUpRight className="h-3.5 w-3.5 flex-shrink-0 text-slate-300 opacity-0 transition-all duration-200 group-hover:translate-x-px group-hover:opacity-100" />
        )}
      </div>

      {/* Metrics row — 等宽数字，仪表盘读数感 */}
      {resolvedStats && resolvedStats.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-slate-100 pt-2">
          {resolvedStats.map((s) => (
            <span key={s.label} className="flex items-baseline gap-1.5">
              <span
                className={cn(
                  'font-mono text-sm font-semibold tabular-nums leading-none',
                  card.clickable ? 'text-slate-900' : 'text-slate-500'
                )}
              >
                {s.value}
              </span>
              <span className="text-xs leading-none text-slate-400">
                {s.label}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );

  if (card.clickable && card.href) {
    return (
      <Link href={card.href} className={cn('block', fixedWidth && 'w-full')}>
        {cardContent}
      </Link>
    );
  }

  return <div className={cn(fixedWidth && 'w-full')}>{cardContent}</div>;
}

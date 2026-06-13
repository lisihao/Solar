'use client';

import { TierBadge } from '@/components/common/badges/TierBadge';
import { SourceHealthSummary } from './SourceHealthSummary';

export interface CustomSectionTop1 {
  tier: 1 | 2 | 3;
  title: string;
}

export interface CustomSectionHealth {
  totalSources: number;
  okCount: number;
  failCount: number;
}

interface Props {
  top1: CustomSectionTop1 | null;
  health: CustomSectionHealth;
  /** 'HH:mm' */
  briefingTime: string;
  /** Already formatted string e.g. "6h" / "2d" */
  nextRefreshIn: string;
}

export function RadarTopicCardCustomSection({
  top1,
  health,
  briefingTime,
  nextRefreshIn,
}: Props) {
  return (
    <div className="space-y-1.5">
      {/* Line 1: TOP 1 signal or empty state */}
      <div className="flex items-center gap-2 truncate text-sm">
        {top1 ? (
          <>
            <TierBadge tier={top1.tier} size="sm" />
            <span className="truncate font-medium">{top1.title}</span>
          </>
        ) : (
          <span className="text-slate-400">今日 0 条 · 持续监控中</span>
        )}
      </div>
      {/* Line 2: health summary + briefing time / next refresh */}
      <div className="flex items-center justify-between text-xs">
        <SourceHealthSummary
          totalSources={health.totalSources}
          okCount={health.okCount}
          failCount={health.failCount}
        />
        <span className="text-slate-400">
          {briefingTime} 出炉 · 下次 {nextRefreshIn}
        </span>
      </div>
    </div>
  );
}

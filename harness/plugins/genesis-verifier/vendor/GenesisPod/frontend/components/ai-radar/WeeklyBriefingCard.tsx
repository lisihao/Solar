'use client';

import Link from 'next/link';
import { Calendar, Star } from 'lucide-react';

import { useTranslation } from '@/lib/i18n';

interface WeeklyBriefingCardProps {
  topicId: string;
  topicName: string;
  weekStart: string; // 'YYYY-MM-DD'
  weekEnd: string; // 'YYYY-MM-DD'
  tier3Count: number;
  narrativeCount: number;
  candidatesTotal: number;
}

export function WeeklyBriefingCard({
  topicId,
  topicName: _topicName,
  weekStart,
  weekEnd,
  tier3Count,
  narrativeCount,
  candidatesTotal,
}: WeeklyBriefingCardProps) {
  const { t } = useTranslation();
  const weeklyUrl = `/ai-radar/topic/${topicId}/weekly?week=${weekStart}`;

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-4">
      {/* Header */}
      <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-700">
        <Calendar className="h-4 w-4 text-violet-600" aria-hidden="true" />
        {t('radar.detail.weeklyTitle', { start: weekStart, end: weekEnd })}
      </div>

      {/* Body */}
      {tier3Count === 0 ? (
        <p className="text-sm text-slate-400">
          {t('radar.detail.weeklyEmpty')}
        </p>
      ) : (
        <p className="inline-flex items-center gap-1.5 text-sm text-slate-600">
          <span className="inline-flex items-center gap-0.5 text-violet-600">
            <Star className="h-3 w-3 fill-violet-600" aria-hidden="true" />
            <Star className="h-3 w-3 fill-violet-600" aria-hidden="true" />
            <Star className="h-3 w-3 fill-violet-600" aria-hidden="true" />
          </span>
          {t('radar.detail.weeklyStats', {
            tier3Count,
            narrativeCount,
            candidatesTotal,
          })}
        </p>
      )}

      {/* Footer link */}
      <div>
        <Link
          href={weeklyUrl}
          className="text-xs text-violet-600 hover:underline"
        >
          {t('radar.detail.weeklyView')}
        </Link>
      </div>
    </div>
  );
}

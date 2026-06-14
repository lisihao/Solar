'use client';

import { Calendar, RefreshCw } from 'lucide-react';

import { useTranslation } from '@/lib/i18n';
import { type DailySignalView } from './RadarBriefingCard';
import { BriefingCardConnected } from './BriefingCardConnected';
import { RadarBriefingSkeleton } from './RadarBriefingSkeleton';
import { RadarBriefingEmptyState } from './RadarBriefingEmptyState';
import { RadarBriefingErrorState } from './RadarBriefingErrorState';
import type { BriefingBucket } from '@/hooks/domain/useDailyBriefingRange';

/**
 * RadarBriefingPanel —— briefing 主体面板。
 *
 * R14 2026-05-19：支持 4 bucket 聚合（today/week/month/year）。
 * - bucket="today": 渲染单日（与旧版相同）
 * - bucket=week/month/year: 多天 briefing 分组渲染，每组日期 sub-header
 */

export interface RadarBriefingPanelGroup {
  briefingDate: string;
  status: 'completed' | 'no_signals' | 'generating';
  signals: DailySignalView[];
}

export interface RadarBriefingPanelProps {
  bucket: BriefingBucket;
  /** 区间内所有 briefing 分组（today 时长度=0 或 1） */
  groups: RadarBriefingPanelGroup[];
  /** loading / error 由外层 hook 控制 */
  loading?: boolean;
  errorMsg?: string | null;
  topicId: string;
  topicName: string;
  onRerun?: () => void;
  rerunCount?: number;
  onRetry?: () => void;
  favoritedIds?: Set<string>;
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const month = d.getMonth() + 1;
  const day = d.getDate();
  return `${month}月${day}日`;
}

function bucketTitle(bucket: BriefingBucket, groupCount: number): string {
  switch (bucket) {
    case 'today': {
      const todayStr = new Date().toISOString().slice(0, 10);
      return `${formatDateLabel(todayStr)} · 今日精选`;
    }
    case 'week':
      return `本周精选 · ${groupCount} 天有信号`;
    case 'month':
      return `本月精选 · ${groupCount} 天有信号`;
    case 'year':
      return `本年精选 · ${groupCount} 天有信号`;
  }
}

export function RadarBriefingPanel({
  bucket,
  groups,
  loading = false,
  errorMsg,
  topicId,
  topicName,
  onRerun,
  rerunCount = 0,
  onRetry,
  favoritedIds,
}: RadarBriefingPanelProps) {
  const { t } = useTranslation();
  const canRerun = (rerunCount ?? 0) < 2;
  const totalSignals = groups.reduce((sum, g) => sum + g.signals.length, 0);

  // 聚合状态：所有 group 都 generating → generating；有任何 completed → completed；
  // 全 no_signals 或空 → no_signals
  const aggregateStatus: 'completed' | 'no_signals' | 'generating' | 'error' =
    errorMsg
      ? 'error'
      : loading
        ? 'generating'
        : groups.some((g) => g.status === 'generating')
          ? 'generating'
          : totalSignals > 0
            ? 'completed'
            : 'no_signals';

  const isToday = bucket === 'today';
  const showEmpty = aggregateStatus === 'no_signals';

  return (
    <section className="flex flex-col gap-6">
      {/* Panel header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="inline-flex items-center gap-1.5 text-lg font-semibold text-slate-800 md:text-xl">
          <Calendar className="h-5 w-5 text-violet-600" aria-hidden="true" />
          {bucketTitle(
            bucket,
            groups.filter((g) => g.signals.length > 0).length
          )}
          {!isToday && totalSignals > 0 && (
            <span className="ml-1 text-sm font-normal text-slate-500">
              · {totalSignals} 条
            </span>
          )}
        </h1>

        {onRerun && isToday && (
          <div className="flex flex-col items-end gap-0.5">
            <button
              onClick={onRerun}
              disabled={!canRerun || aggregateStatus === 'generating'}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={t('radar.detail.rerunBriefing')}
            >
              <RefreshCw className="h-4 w-4" />
              {t('radar.detail.rerunBriefing')}
            </button>
            {rerunCount > 0 && (
              <span className="text-xs text-slate-400">
                {t('radar.detail.alreadyRerunToday', { count: rerunCount })}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Content area */}
      {aggregateStatus === 'generating' && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-slate-500">
            {t('radar.detail.generating')}
          </p>
          <RadarBriefingSkeleton />
        </div>
      )}

      {aggregateStatus === 'error' && (
        <RadarBriefingErrorState onRetry={onRetry} />
      )}

      {showEmpty && <RadarBriefingEmptyState />}

      {aggregateStatus === 'completed' && (
        <div className="flex flex-col gap-8">
          {groups
            .filter((g) => g.signals.length > 0)
            .sort((a, b) => (a.briefingDate < b.briefingDate ? 1 : -1))
            .map((g) => (
              <div key={g.briefingDate} className="flex flex-col gap-6">
                {/* 多天模式才显示日期 sub-header，今天模式直接展开 */}
                {!isToday && (
                  <h2 className="border-b border-gray-100 pb-1.5 text-sm font-semibold text-slate-600">
                    {formatDateLabel(g.briefingDate)}
                    <span className="ml-2 text-xs font-normal text-slate-400">
                      {g.signals.length} 条
                    </span>
                  </h2>
                )}
                {g.signals.map((signal, idx) => (
                  <BriefingCardConnected
                    key={signal.id}
                    signal={signal}
                    index={idx + 1}
                    topicId={topicId}
                    topicName={topicName}
                    detailUrl={`/ai-radar/topic/${topicId}/signal/${signal.id}`}
                    evidenceSources={signal.evidenceSources}
                    initiallyFavorited={favoritedIds?.has(signal.id)}
                  />
                ))}
              </div>
            ))}
        </div>
      )}
    </section>
  );
}

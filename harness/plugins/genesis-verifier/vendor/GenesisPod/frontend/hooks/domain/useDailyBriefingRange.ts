import { useCallback } from 'react';
import { useApiGet } from '@/hooks/core';
import type { ApiError } from '@/lib/api/client';
import type { DailySignalView } from '@/hooks/domain/useDailyBriefing';

/**
 * R14 2026-05-19: 4 bucket 聚合 briefing —— "今天 / 本周 / 本月 / 本年"
 *
 * 解决「今日精选 0 信号但本周其实有 5 条」的可见性问题。
 *
 * 后端：GET /radar/topics/:id/daily-briefing/range?bucket=...
 */

export type BriefingBucket = 'today' | 'week' | 'month' | 'year';

export interface BriefingDateGroup {
  id: string;
  briefingDate: string;
  status: 'completed' | 'no_signals' | 'generating';
  signals: DailySignalView[];
}

export interface BriefingRangeView {
  bucket: BriefingBucket;
  from: string;
  to: string;
  briefings: BriefingDateGroup[];
  totalSignals: number;
}

export function useDailyBriefingRange(
  topicId: string | null,
  bucket: BriefingBucket
): {
  data: BriefingRangeView | null;
  loading: boolean;
  error: ApiError | null;
  refresh: () => Promise<void>;
} {
  const path = topicId
    ? `/radar/topics/${topicId}/daily-briefing/range?bucket=${bucket}`
    : '';

  const {
    data,
    loading,
    error,
    refresh: apiRefresh,
  } = useApiGet<BriefingRangeView>(path, {
    immediate: !!topicId,
    deps: [topicId, bucket],
  });

  const refresh = useCallback(async () => {
    if (topicId) await apiRefresh();
  }, [topicId, apiRefresh]);

  return {
    data: data ?? null,
    loading: topicId ? loading : false,
    error,
    refresh,
  };
}

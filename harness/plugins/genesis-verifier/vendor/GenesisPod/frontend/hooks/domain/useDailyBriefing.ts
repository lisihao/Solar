import { useCallback } from 'react';
import { useApiGet } from '@/hooks/core';
import type { ApiError } from '@/lib/api/client';

export interface DailySignalView {
  id: string;
  tier: 1 | 2 | 3;
  title: string;
  oneLineTakeaway: string;
  whyItMatters: string;
  whatsNext: string;
  signalTags: string[];
  entities: string[];
  evidenceItemIds: string[];
  /** PR-DR2 收尾：原文来源（后端 join，多源全量），卡片用于追溯原始链接 */
  evidenceSources?: { name: string; url?: string; publishedAt: string }[];
  narrativeId?: string;
}

export interface DailyBriefingView {
  id: string;
  topicId: string;
  briefingDate: string;
  status: 'completed' | 'no_signals' | 'generating';
  signals: DailySignalView[];
  generationRunId?: string;
  /** FU-P2-4: 当日 rerun 计数（手动重新精选累计） */
  rerunCount?: number;
  /** FU-P2-4: 是否还可继续 rerun（false → 按钮禁用） */
  canRerun?: boolean;
}

export function useDailyBriefing(
  topicId: string | null,
  date?: string
): {
  data: DailyBriefingView | null;
  loading: boolean;
  error: ApiError | null;
  refresh: () => Promise<void>;
} {
  const params = date ? `?date=${date}` : '';
  // apiClient.baseUrl 已含 /api/v1 —— 这里只写 module-relative path，不带前缀
  const path = topicId
    ? `/radar/topics/${topicId}/daily-briefing${params}`
    : '';

  const {
    data,
    loading,
    error,
    refresh: apiRefresh,
  } = useApiGet<DailyBriefingView>(path, {
    immediate: !!topicId,
    deps: [topicId, date],
  });

  const refresh = useCallback(async () => {
    if (topicId) {
      await apiRefresh();
    }
  }, [topicId, apiRefresh]);

  return {
    data: data ?? null,
    loading: topicId ? loading : false,
    error: error,
    refresh,
  };
}

/**
 * useWeeklyBriefing — FC-5
 *
 * GET /radar/topics/:topicId/weekly-briefing[?week=YYYY-MM-DD]
 * （apiClient baseUrl 已含 /api/v1，调用时不带前缀）
 *   无 week → 取最新；带 week（周一 UTC date）→ 按周查
 */
import { useApiGet } from '@/hooks/core';
import type { ApiError } from '@/lib/api/client';

interface NarrativeMapEntry {
  narrativeId: string;
  label: string;
  episodes: Array<{ date: string; signalId: string; title: string }>;
  latestTitle: string;
}

interface TopSignalView {
  id: string;
  tier: 1 | 2 | 3;
  title: string;
  oneLineTakeaway: string;
  whyItMatters: string;
  whatsNext: string;
  signalTags: string[];
  entities: string[];
  evidenceItemIds: string[];
  narrativeId?: string;
  sourceBriefingDate: string;
}

export interface WeeklyPayloadView {
  candidatesTotal: number;
  tier3Count: number;
  tier2Count: number;
  narrativeMap: NarrativeMapEntry[];
  topSignals: TopSignalView[];
  newEntities: string[];
}

export interface WeeklyBriefingView {
  id: string;
  topicId: string;
  weekStart: string; // 'YYYY-MM-DD' (Monday UTC)
  weekEnd: string;
  payload: WeeklyPayloadView;
  generatedAt: string;
}

export function useWeeklyBriefing(
  topicId: string | null,
  week?: string
): {
  data: WeeklyBriefingView | null;
  loading: boolean;
  error: ApiError | null;
  refresh: () => Promise<void>;
} {
  const qs = week ? `?week=${week}` : '';
  // apiClient.baseUrl 已含 /api/v1
  const path = topicId ? `/radar/topics/${topicId}/weekly-briefing${qs}` : '';

  const { data, loading, error, refresh } = useApiGet<WeeklyBriefingView>(
    path,
    {
      immediate: !!topicId,
      deps: [topicId, week],
    }
  );

  return {
    data: data ?? null,
    loading: topicId ? loading : false,
    error,
    refresh: async () => {
      await refresh();
    },
  };
}

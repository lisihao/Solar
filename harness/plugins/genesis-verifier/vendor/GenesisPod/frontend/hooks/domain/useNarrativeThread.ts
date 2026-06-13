import { useApiGet } from '@/hooks/core';
import type { ApiError } from '@/lib/api/client';

export interface NarrativeEpisode {
  date: string;
  signalId: string;
  title: string;
  tier: 1 | 2 | 3;
}

export interface NarrativeThreadView {
  narrativeId: string;
  label: string;
  episodes: NarrativeEpisode[];
}

export function useNarrativeThread(
  topicId: string | null,
  narrativeId: string | null
): {
  data: NarrativeThreadView | null;
  loading: boolean;
  error: ApiError | null;
} {
  // apiClient.baseUrl 已含 /api/v1
  const path =
    topicId && narrativeId
      ? `/radar/topics/${topicId}/narratives/${narrativeId}`
      : '';

  const { data, loading, error } = useApiGet<NarrativeThreadView>(path, {
    immediate: !!(topicId && narrativeId),
    deps: [topicId, narrativeId],
  });

  // 404 means episodes < 2, treat as data=null, not an error
  const is404 = error?.status === 404;

  return {
    data: data ?? null,
    loading: topicId && narrativeId ? loading : false,
    error: is404 ? null : error,
  };
}

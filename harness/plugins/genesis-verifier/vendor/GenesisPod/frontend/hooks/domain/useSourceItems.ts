/**
 * useSourceItems — 从指定 data source 列 items（用于 SourceItemPicker）
 *
 * GET /api/v1/ai-social/data-sources/:id/items?search=&cursor=&limit=
 */

import useSWR from 'swr';
import { listSocialSourceItems } from '@/services/ai-social/task-api';
import type { SourceListResult } from '@/services/ai-social/task-types';

export function useSourceItems(
  sourceId: string | null,
  opts?: { search?: string; cursor?: string; limit?: number },
) {
  const key = sourceId
    ? ['ai-social', 'source-items', sourceId, opts?.search ?? '', opts?.cursor ?? '', opts?.limit ?? 30]
    : null;

  const { data, error, isLoading, mutate } = useSWR<SourceListResult>(
    key,
    () => listSocialSourceItems(sourceId!, opts),
    {
      revalidateOnFocus: false,
    },
  );

  return {
    items: data?.items ?? [],
    nextCursor: data?.nextCursor,
    error,
    isLoading,
    refresh: mutate,
  };
}

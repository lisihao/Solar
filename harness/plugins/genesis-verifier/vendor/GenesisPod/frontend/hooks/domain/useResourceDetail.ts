import { useApiGet, useApiPut, useApiDelete, useApiPost } from '../core';
import { useCallback } from 'react';
import type { Resource } from './useResources';

interface UseResourceDetailOptions {
  id: string;
  immediate?: boolean;
}

export function useResourceDetail({
  id,
  immediate = true,
}: UseResourceDetailOptions) {
  const {
    data: resource,
    loading,
    error,
    execute: refresh,
  } = useApiGet<Resource>(`/api/resources/${id}`, { immediate });

  const { loading: updateLoading, execute: updateApi } = useApiPut<
    Resource,
    Partial<Resource>
  >(`/api/resources/${id}`);

  const { loading: deleteLoading, execute: deleteApi } = useApiDelete<void>(
    `/api/resources/${id}`
  );

  const { loading: summarizeLoading, execute: summarizeApi } = useApiPost<{
    summary: string;
  }>(`/api/resources/${id}/summarize`);

  const { loading: translateLoading, execute: translateApi } = useApiPost<
    { content: string },
    { targetLang: string }
  >(`/api/resources/${id}/translate`);

  const update = useCallback(
    async (data: Partial<Resource>) => {
      const result = await updateApi(data);
      if (result) await refresh();
      return result;
    },
    [updateApi, refresh]
  );

  const remove = useCallback(async () => {
    await deleteApi();
  }, [deleteApi]);

  const summarize = useCallback(async () => {
    const result = await summarizeApi();
    if (result) await refresh();
    return result;
  }, [summarizeApi, refresh]);

  const translate = useCallback(
    async (targetLang: string) => {
      const result = await translateApi({ targetLang });
      return result;
    },
    [translateApi]
  );

  return {
    resource,
    loading,
    error,
    refresh,
    update,
    remove,
    summarize,
    translate,
    isUpdating: updateLoading,
    isDeleting: deleteLoading,
    isSummarizing: summarizeLoading,
    isTranslating: translateLoading,
  };
}

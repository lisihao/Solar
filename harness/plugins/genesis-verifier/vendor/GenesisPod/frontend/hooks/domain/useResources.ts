import { useApiGet, useApiPost, useApiDelete } from '../core';
import { useCallback, useMemo } from 'react';

export interface Resource {
  id: string;
  title: string;
  type: string;
  url?: string;
  content?: string;
  summary?: string;
  thumbnail?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ResourceFilter {
  type?: string;
  status?: string;
  search?: string;
}

interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

interface UseResourcesOptions {
  filter?: ResourceFilter;
  pageSize?: number;
  immediate?: boolean;
}

export function useResources(options: UseResourcesOptions = {}) {
  const { filter, pageSize = 20, immediate = true } = options;

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (filter?.type) params.set('type', filter.type);
    if (filter?.status) params.set('status', filter.status);
    if (filter?.search) params.set('search', filter.search);
    params.set('limit', String(pageSize));
    return params.toString();
  }, [filter, pageSize]);

  const {
    data,
    loading,
    error,
    execute: fetch,
  } = useApiGet<PaginatedResponse<Resource>>(`/api/resources?${queryParams}`, {
    immediate,
  });

  const { execute: deleteResourceApi, loading: deleting } = useApiDelete<
    void,
    { id: string }
  >('/api/resources');

  const { execute: batchDeleteApi, loading: batchDeleting } = useApiPost<
    void,
    { ids: string[] }
  >('/api/resources/batch-delete');

  const refresh = useCallback(() => fetch(), [fetch]);

  const deleteResource = useCallback(
    async (id: string) => {
      await deleteResourceApi({ id });
      await refresh();
    },
    [deleteResourceApi, refresh]
  );

  const batchDelete = useCallback(
    async (ids: string[]) => {
      await batchDeleteApi({ ids });
      await refresh();
    },
    [batchDeleteApi, refresh]
  );

  return {
    resources: data?.items ?? [],
    total: data?.total ?? 0,
    hasMore: data?.hasMore ?? false,
    loading,
    error,
    refresh,
    deleteResource,
    batchDelete,
    isDeleting: deleting || batchDeleting,
  };
}

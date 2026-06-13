import { useApiGet, useApiPost, useApiPut, useApiDelete } from '../core';
import { useCallback } from 'react';

export interface Collection {
  id: string;
  name: string;
  description?: string;
  type: string;
  status: 'active' | 'paused' | 'error';
  itemCount: number;
  lastSyncAt?: string;
  config?: Record<string, unknown>;
  createdAt: string;
}

export function useAdminCollections() {
  const {
    data: collections,
    loading: listLoading,
    error: listError,
    execute: refreshCollections,
  } = useApiGet<Collection[]>('/admin/collections', {
    immediate: true,
  });

  const { loading: createLoading, execute: createApi } = useApiPost<
    Collection,
    Partial<Collection>
  >('/admin/collections');

  const { loading: updateLoading, execute: updateApi } = useApiPut<
    Collection,
    Partial<Collection>
  >('/admin/collections');

  const { loading: deleteLoading, execute: deleteApi } = useApiDelete<
    void,
    { id: string }
  >('/admin/collections');

  const { loading: syncLoading, execute: syncApi } = useApiPost<
    void,
    { id: string }
  >('/admin/collections/sync');

  const createCollection = useCallback(
    async (data: Partial<Collection>) => {
      const result = await createApi(data);
      if (result) await refreshCollections();
      return result;
    },
    [createApi, refreshCollections]
  );

  const updateCollection = useCallback(
    async (id: string, data: Partial<Collection>) => {
      const result = await updateApi({ ...data, id });
      if (result) await refreshCollections();
      return result;
    },
    [updateApi, refreshCollections]
  );

  const deleteCollection = useCallback(
    async (id: string) => {
      await deleteApi({ id });
      await refreshCollections();
    },
    [deleteApi, refreshCollections]
  );

  const syncCollection = useCallback(
    async (id: string) => {
      await syncApi({ id });
      await refreshCollections();
    },
    [syncApi, refreshCollections]
  );

  return {
    collections: collections ?? [],
    loading: listLoading || createLoading || updateLoading || deleteLoading,
    error: listError,
    refreshCollections,
    createCollection,
    updateCollection,
    deleteCollection,
    syncCollection,
    isCreating: createLoading,
    isUpdating: updateLoading,
    isDeleting: deleteLoading,
    isSyncing: syncLoading,
  };
}

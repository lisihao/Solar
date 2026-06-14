import { useApiGet, useApiPost, useApiPut, useApiDelete } from '../core';
import { useCallback } from 'react';

export interface AIModel {
  id: string;
  name: string;
  provider: string;
  modelId: string;
  type: 'CHAT' | 'EMBEDDING' | 'IMAGE' | 'TTS' | 'STT';
  enabled: boolean;
  config?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export function useAdminModels() {
  // 列表查询
  const {
    data: models,
    loading: listLoading,
    error: listError,
    execute: refreshModels,
  } = useApiGet<AIModel[]>('/admin/ai-models', {
    immediate: true,
  });

  // 创建模型
  const {
    loading: createLoading,
    error: createError,
    execute: createModelApi,
  } = useApiPost<AIModel, Partial<AIModel>>('/admin/ai-models');

  // 更新模型
  const {
    loading: updateLoading,
    error: updateError,
    execute: updateModelApi,
  } = useApiPut<AIModel, Partial<AIModel>>('/admin/ai-models');

  // 删除模型
  const {
    loading: deleteLoading,
    error: deleteError,
    execute: deleteModelApi,
  } = useApiDelete<void, { id: string }>('/admin/ai-models');

  // 测试连接
  const {
    loading: testLoading,
    error: testError,
    execute: testConnectionApi,
  } = useApiPost<{ success: boolean; message: string }, { modelId: string }>(
    '/admin/ai-models/test'
  );

  const createModel = useCallback(
    async (data: Partial<AIModel>) => {
      const result = await createModelApi(data);
      if (result) await refreshModels();
      return result;
    },
    [createModelApi, refreshModels]
  );

  const updateModel = useCallback(
    async (id: string, data: Partial<AIModel>) => {
      const result = await updateModelApi({ ...data, id });
      if (result) await refreshModels();
      return result;
    },
    [updateModelApi, refreshModels]
  );

  const deleteModel = useCallback(
    async (id: string) => {
      await deleteModelApi({ id });
      await refreshModels();
    },
    [deleteModelApi, refreshModels]
  );

  const testConnection = useCallback(
    (modelId: string) => testConnectionApi({ modelId }),
    [testConnectionApi]
  );

  return {
    // 数据
    models: models ?? [],

    // 加载状态
    loading: listLoading || createLoading || updateLoading || deleteLoading,
    isRefreshing: listLoading,

    // 错误状态
    error: listError || createError || updateError || deleteError || testError,

    // 操作方法
    refreshModels,
    createModel,
    updateModel,
    deleteModel,
    testConnection,

    // 操作状态
    isCreating: createLoading,
    isUpdating: updateLoading,
    isDeleting: deleteLoading,
    isTesting: testLoading,
  };
}

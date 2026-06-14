import { useApiGet, useApiPost } from '../core';
import { apiClient } from '@/lib/api/client';
import { useCallback, useState } from 'react';

export interface ResearchTemplateConfig {
  id: string;
  templateId: string;
  name: string;
  description: string | null;
  category: string;
  dimensions: Record<string, unknown>;
  dataSources: string[];
  guidancePrompt: string | null;
  reportStructure: Record<string, unknown> | null;
  iterationCount: number;
  enabled: boolean;
  isBuiltIn: boolean;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateResearchTemplateDto {
  templateId: string;
  name: string;
  description?: string;
  category: string;
  dimensions: Record<string, unknown>;
  dataSources?: string[];
  guidancePrompt?: string;
  reportStructure?: Record<string, unknown>;
  iterationCount?: number;
  enabled?: boolean;
}

export interface UpdateResearchTemplateDto {
  name?: string;
  description?: string;
  category?: string;
  dimensions?: Record<string, unknown>;
  dataSources?: string[];
  guidancePrompt?: string;
  reportStructure?: Record<string, unknown>;
  iterationCount?: number;
  enabled?: boolean;
}

export function useAdminResearchTemplates(filters?: { category?: string }) {
  const [updateLoading, setUpdateLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [duplicateLoading, setDuplicateLoading] = useState(false);

  const queryParams = filters?.category ? `?category=${filters.category}` : '';

  // List query
  const {
    data: templates,
    loading: listLoading,
    error: listError,
    execute: refreshTemplates,
  } = useApiGet<ResearchTemplateConfig[]>(
    `/admin/research/templates${queryParams}`,
    {
      immediate: true,
    }
  );

  // Create template
  const {
    loading: createLoading,
    error: createError,
    execute: createTemplateApi,
  } = useApiPost<ResearchTemplateConfig, CreateResearchTemplateDto>(
    '/admin/research/templates'
  );

  const createTemplate = useCallback(
    async (data: CreateResearchTemplateDto) => {
      const result = await createTemplateApi(data);
      if (result) {
        await refreshTemplates();
      }
      return result;
    },
    [createTemplateApi, refreshTemplates]
  );

  const updateTemplate = useCallback(
    async (id: string, data: UpdateResearchTemplateDto) => {
      setUpdateLoading(true);
      try {
        const result = await apiClient.patch<ResearchTemplateConfig>(
          `/admin/research/templates/${id}`,
          data
        );
        await refreshTemplates();
        return result;
      } finally {
        setUpdateLoading(false);
      }
    },
    [refreshTemplates]
  );

  const deleteTemplate = useCallback(
    async (id: string) => {
      setDeleteLoading(true);
      try {
        await apiClient.delete(`/admin/research/templates/${id}`);
        await refreshTemplates();
      } finally {
        setDeleteLoading(false);
      }
    },
    [refreshTemplates]
  );

  const duplicateTemplate = useCallback(
    async (id: string) => {
      setDuplicateLoading(true);
      try {
        await apiClient.post(`/admin/research/templates/${id}/duplicate`);
        await refreshTemplates();
      } finally {
        setDuplicateLoading(false);
      }
    },
    [refreshTemplates]
  );

  return {
    // Data
    templates: templates ?? [],

    // Loading states
    loading:
      listLoading ||
      createLoading ||
      updateLoading ||
      deleteLoading ||
      duplicateLoading,
    isRefreshing: listLoading,

    // Error states
    error: listError || createError,

    // Actions
    refreshTemplates,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    duplicateTemplate,

    // Operation states
    isCreating: createLoading,
    isUpdating: updateLoading,
    isDeleting: deleteLoading,
    isDuplicating: duplicateLoading,
  };
}

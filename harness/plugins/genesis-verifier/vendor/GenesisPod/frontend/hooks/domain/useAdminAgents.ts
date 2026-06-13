import { useApiGet, useApiPost } from '../core';
import { apiClient } from '@/lib/api/client';
import { useCallback, useState } from 'react';

export interface AgentConfig {
  id: string;
  agentId: string;
  name: string;
  description: string | null;
  agentType: string;
  domain: string;
  systemPrompt: string;
  tools: string[];
  skills: string[];
  modelType: string | null;
  taskProfile: Record<string, unknown> | null;
  enabled: boolean;
  isBuiltIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentConfigDto {
  agentId: string;
  name: string;
  description?: string;
  agentType: string;
  domain: string;
  systemPrompt: string;
  tools?: string[];
  skills?: string[];
  modelType?: string;
  taskProfile?: Record<string, unknown>;
  enabled?: boolean;
}

export interface UpdateAgentConfigDto {
  name?: string;
  description?: string;
  systemPrompt?: string;
  tools?: string[];
  skills?: string[];
  modelType?: string;
  taskProfile?: Record<string, unknown>;
  enabled?: boolean;
}

export function useAdminAgents(filters?: { domain?: string }) {
  const [updateLoading, setUpdateLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const queryParams = filters?.domain ? `?domain=${filters.domain}` : '';

  // List query
  const {
    data: agents,
    loading: listLoading,
    error: listError,
    execute: refreshAgents,
  } = useApiGet<AgentConfig[]>(`/admin/agents${queryParams}`, {
    immediate: true,
  });

  // Create agent
  const {
    loading: createLoading,
    error: createError,
    execute: createAgentApi,
  } = useApiPost<AgentConfig, CreateAgentConfigDto>('/admin/agents');

  const createAgent = useCallback(
    async (data: CreateAgentConfigDto) => {
      const result = await createAgentApi(data);
      if (result) {
        await refreshAgents();
      }
      return result;
    },
    [createAgentApi, refreshAgents]
  );

  const updateAgent = useCallback(
    async (id: string, data: UpdateAgentConfigDto) => {
      setUpdateLoading(true);
      try {
        const result = await apiClient.patch<AgentConfig>(
          `/admin/agents/${id}`,
          data
        );
        await refreshAgents();
        return result;
      } finally {
        setUpdateLoading(false);
      }
    },
    [refreshAgents]
  );

  const deleteAgent = useCallback(
    async (id: string) => {
      setDeleteLoading(true);
      try {
        await apiClient.delete(`/admin/agents/${id}`);
        await refreshAgents();
      } finally {
        setDeleteLoading(false);
      }
    },
    [refreshAgents]
  );

  return {
    // Data
    agents: agents ?? [],

    // Loading states
    loading: listLoading || createLoading || updateLoading || deleteLoading,
    isRefreshing: listLoading,

    // Error states
    error: listError || createError,

    // Actions
    refreshAgents,
    createAgent,
    updateAgent,
    deleteAgent,

    // Operation states
    isCreating: createLoading,
    isUpdating: updateLoading,
    isDeleting: deleteLoading,
  };
}

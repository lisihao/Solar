import { useApiGet } from '@/hooks/core';
import { apiClient } from '@/lib/api/client';
import { useCallback, useState } from 'react';

export interface ExternalMCPServer {
  id: string;
  serverId: string;
  name: string;
  description?: string;
  transport: string;
  url?: string;
  enabled: boolean;
  autoConnect: boolean;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  connectionStatus: {
    status: 'connected' | 'disconnected' | 'error';
    error?: string;
    connectedAt?: string;
  };
}

export interface MCPExternalTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface CreateExternalServerData {
  serverId: string;
  name: string;
  description?: string;
  transport: string;
  url: string;
  enabled?: boolean;
  autoConnect?: boolean;
  metadata?: Record<string, unknown>;
}

export interface UpdateExternalServerData {
  name?: string;
  description?: string;
  transport?: string;
  url?: string;
  enabled?: boolean;
  autoConnect?: boolean;
  metadata?: Record<string, unknown>;
}

export function useAdminMCPExternal() {
  const [actionLoading, setActionLoading] = useState(false);

  const {
    data,
    loading: listLoading,
    error: listError,
    execute: refetch,
  } = useApiGet<ExternalMCPServer[]>('/admin/mcp/external-servers', {
    immediate: true,
  });

  const addServer = useCallback(
    async (serverData: CreateExternalServerData) => {
      setActionLoading(true);
      try {
        await apiClient.post('/admin/mcp/external-servers', serverData);
        await refetch();
      } finally {
        setActionLoading(false);
      }
    },
    [refetch]
  );

  const updateServer = useCallback(
    async (id: string, serverData: UpdateExternalServerData) => {
      setActionLoading(true);
      try {
        await apiClient.patch(`/admin/mcp/external-servers/${id}`, serverData);
        await refetch();
      } finally {
        setActionLoading(false);
      }
    },
    [refetch]
  );

  const removeServer = useCallback(
    async (id: string) => {
      setActionLoading(true);
      try {
        await apiClient.delete(`/admin/mcp/external-servers/${id}`);
        await refetch();
      } finally {
        setActionLoading(false);
      }
    },
    [refetch]
  );

  const connectServer = useCallback(
    async (id: string) => {
      setActionLoading(true);
      try {
        await apiClient.post(`/admin/mcp/external-servers/${id}/connect`);
        await refetch();
      } finally {
        setActionLoading(false);
      }
    },
    [refetch]
  );

  const disconnectServer = useCallback(
    async (id: string) => {
      setActionLoading(true);
      try {
        await apiClient.post(`/admin/mcp/external-servers/${id}/disconnect`);
        await refetch();
      } finally {
        setActionLoading(false);
      }
    },
    [refetch]
  );

  const listTools = useCallback(
    async (id: string): Promise<MCPExternalTool[]> => {
      const result = await apiClient.get<MCPExternalTool[]>(
        `/admin/mcp/external-servers/${id}/tools`
      );
      return result ?? [];
    },
    []
  );

  return {
    servers: data ?? [],
    loading: listLoading,
    actionLoading,
    error: listError,
    refetch,
    addServer,
    updateServer,
    removeServer,
    connectServer,
    disconnectServer,
    listTools,
  };
}

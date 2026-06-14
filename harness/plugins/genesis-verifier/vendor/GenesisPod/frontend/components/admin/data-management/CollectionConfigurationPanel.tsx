'use client';

import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CollectionConfigCard } from './CollectionConfigCard';
import { Plus, Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/primitives/button';

type ResourceType = 'PAPER' | 'BLOG' | 'REPORT' | 'YOUTUBE_VIDEO' | 'NEWS';

interface CollectionConfig {
  id: string;
  type: 'KEYWORD' | 'RSS' | 'URL_PATTERN';
  value: string;
  isActive: boolean;
  lastRunAt: string | null;
  documentCount: number;
}

interface CollectionConfigurationPanelProps {
  resourceType: ResourceType;
}

const fetchConfigs = async (
  resourceType: ResourceType
): Promise<CollectionConfig[]> => {
  const response = await fetch(
    `/api/data-management/configurations?resourceType=${resourceType}`
  );
  return response.json() as Promise<CollectionConfig[]>;
};

const updateConfigStatus = async ({
  id,
  isActive,
}: {
  id: string;
  isActive: boolean;
}) => {
  const response = await fetch(
    `/api/data-management/configurations/${id}/status`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ isActive }),
    }
  );
  if (!response.ok) {
    throw new Error('Failed to update configuration status');
  }
  return response.json();
};

const deleteConfig = async (id: string) => {
  const response = await fetch(`/api/data-management/configurations/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete configuration');
  }
};

export function CollectionConfigurationPanel({
  resourceType,
}: CollectionConfigurationPanelProps) {
  const queryClient = useQueryClient();

  const {
    data: configs,
    isLoading,
    isError,
    error,
  } = useQuery<CollectionConfig[], Error>({
    queryKey: ['collectionConfigs', resourceType],
    queryFn: () => fetchConfigs(resourceType),
  });

  const statusMutation = useMutation({
    mutationFn: updateConfigStatus,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['collectionConfigs', resourceType],
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteConfig,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['collectionConfigs', resourceType],
      });
    },
  });

  const handleStatusChange = (id: string, isActive: boolean) => {
    statusMutation.mutate({ id, isActive });
  };

  const handleDelete = (id: string) => {
    deleteMutation.mutate(id);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center text-red-700">
        <AlertTriangle className="mx-auto h-8 w-8" />
        <p className="mt-4 font-semibold">加载配置失败</p>
        <p className="mt-2 text-sm">{error?.message}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-end">
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          新增配置
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {configs?.map((config) => (
          <CollectionConfigCard
            key={config.id}
            config={config}
            onStatusChange={handleStatusChange}
            onDelete={handleDelete}
          />
        ))}
      </div>
      {configs?.length === 0 && (
        <div className="rounded-lg border-2 border-dashed border-gray-300 py-12 text-center">
          <p className="text-gray-500">暂无采集配置</p>
          <Button variant="outline" className="mt-4">
            <Plus className="mr-2 h-4 w-4" />
            创建第一个配置
          </Button>
        </div>
      )}
    </div>
  );
}

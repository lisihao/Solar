'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { config } from '@/lib/utils/config';
import {
  createWorkspace,
  getWorkspace,
  updateWorkspaceResources,
  WorkspaceResponse,
} from '@/services/workspace/api';
import { useReportWorkspace } from './useReportWorkspace';

interface UseWorkspaceSyncOptions {
  autoSync?: boolean;
  minResources?: number;
}

interface UseWorkspaceSyncResult {
  workspace: WorkspaceResponse | null;
  syncing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  ensureWorkspace: () => Promise<void>;
  isEnabled: boolean;
}

const defaultOptions: UseWorkspaceSyncOptions = {
  autoSync: true,
  minResources: 2,
};

export function useWorkspaceSync(
  options: UseWorkspaceSyncOptions = {}
): UseWorkspaceSyncResult {
  const { autoSync, minResources } = { ...defaultOptions, ...options };
  const isEnabled = config.workspaceAiV2Enabled;

  const { resources, workspaceId, setWorkspaceId, setResources } =
    useReportWorkspace();

  const [workspace, setWorkspace] = useState<WorkspaceResponse | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pendingSyncRef = useRef<boolean>(false);

  const resourceIds = useMemo(() => resources.map((r) => r.id), [resources]);

  const syncWorkspace = useCallback(async () => {
    if (!isEnabled) {
      return;
    }

    if (pendingSyncRef.current) {
      return;
    }

    pendingSyncRef.current = true;
    setSyncing(true);
    setError(null);

    try {
      if (!workspaceId) {
        if (resourceIds.length === 0) {
          setWorkspace(null);
          return;
        }

        if (resourceIds.length < (minResources ?? 0)) {
          return;
        }

        const created = await createWorkspace(resourceIds);
        setWorkspaceId(created.id);
        setWorkspace(created);

        setResources(
          created.resources.map((item) => ({
            id: item.resource.id,
            type: item.resource.type,
            title: item.resource.title,
            abstract:
              item.resource.aiSummary ?? item.resource.abstract ?? undefined,
            thumbnailUrl: item.resource.thumbnailUrl ?? undefined,
          }))
        );
        return;
      }

      const current = await getWorkspace(workspaceId);
      setWorkspace(current);

      const backendIds = new Set(
        current.resources.map((item) => item.resource.id)
      );
      const storeIds = new Set(resourceIds);

      const addIds = resourceIds.filter((id) => !backendIds.has(id));
      const removeIds = current.resources
        .map((item) => item.resource.id)
        .filter((id) => !storeIds.has(id));

      if (addIds.length === 0 && removeIds.length === 0) {
        return;
      }

      const updated = await updateWorkspaceResources(workspaceId, {
        addResourceIds: addIds.length > 0 ? addIds : undefined,
        removeResourceIds: removeIds.length > 0 ? removeIds : undefined,
      });
      setWorkspace(updated);

      setResources(
        updated.resources.map((item) => ({
          id: item.resource.id,
          type: item.resource.type,
          title: item.resource.title,
          abstract:
            item.resource.aiSummary ?? item.resource.abstract ?? undefined,
          thumbnailUrl: item.resource.thumbnailUrl ?? undefined,
        }))
      );
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('工作区同步失败');
      }
    } finally {
      pendingSyncRef.current = false;
      setSyncing(false);
    }
  }, [
    isEnabled,
    workspaceId,
    resourceIds,
    minResources,
    setWorkspaceId,
    setResources,
  ]);

  useEffect(() => {
    if (!isEnabled) {
      return;
    }
    if (!autoSync) {
      return;
    }
    if (resourceIds.length === 0) {
      setWorkspace(null);
      if (workspaceId) {
        setWorkspaceId(null);
      }
      return;
    }

    syncWorkspace().catch(() => {
      /* 错误已在 syncWorkspace 内处理 */
    });
  }, [
    isEnabled,
    autoSync,
    resourceIds.join(','),
    workspaceId,
    syncWorkspace,
    setWorkspaceId,
  ]);

  const refresh = useCallback(async () => {
    if (!isEnabled || !workspaceId) {
      return;
    }

    setSyncing(true);
    setError(null);
    try {
      const current = await getWorkspace(workspaceId);
      setWorkspace(current);
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('工作区刷新失败');
      }
    } finally {
      setSyncing(false);
    }
  }, [isEnabled, workspaceId]);

  return {
    workspace,
    syncing,
    error,
    refresh,
    ensureWorkspace: syncWorkspace,
    isEnabled,
  };
}

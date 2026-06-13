import { useApiGet, useApiPost } from '../core';
import { apiClient } from '@/lib/api/client';
import { useCallback, useState } from 'react';

export type SecretCategory =
  | 'AI_MODEL'
  | 'SEARCH'
  | 'EXTRACTION'
  | 'YOUTUBE'
  | 'TTS'
  | 'SKILLSMP'
  | 'POLICY'
  | 'FINANCE'
  | 'ACADEMIC'
  | 'WEATHER'
  | 'IMAGE_SEARCH'
  | 'DEV_TOOLS'
  | 'MCP'
  | 'OTHER';

export type SecretAggregateStatus = 'ok' | 'failed' | 'unknown' | 'disabled';

export interface Secret {
  id: string;
  name: string;
  displayName: string;
  category: SecretCategory;
  description: string | null;
  provider: string | null;
  isActive: boolean;
  maskedValue: string;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string | null;
  accessCount: number;
  expiresAt: string | null;
  lastRotatedAt: string | null;
  /** ★ 4 态聚合状态（从所有 SecretKey 聚合） */
  aggregateStatus?: SecretAggregateStatus;
  totalKeys?: number;
  activeKeys?: number;
}

export interface SecretAccessLog {
  id: string;
  secretId: string | null;
  action: string;
  actionStatus: string;
  secretName: string | null;
  userId: string | null;
  userEmail: string | null;
  ipAddress: string | null;
  timestamp: string;
}

export interface SecretVersion {
  id: string;
  version: number;
  checksum: string;
  createdBy: string | null;
  createdAt: string;
  changeNote: string | null;
  isCurrent: boolean;
}

export interface ExpectedSecretItem {
  name: string;
  displayName: string;
  category: string;
  provider: string;
  description?: string;
  setupGuideUrl?: string;
  freeTierAvailable: boolean;
  status: 'configured' | 'missing';
  secretId?: string;
  relatedToolIds: string[];
}

export interface ExpectedSecretsOrphan {
  name: string;
  displayName: string;
  secretId: string;
}

export interface ExpectedSecretsSummary {
  total: number;
  configured: number;
  missing: number;
}

export interface LlmProviderSecret {
  secretId: string;
  name: string;
  displayName: string;
  category: string;
  provider: string;
}

export interface CustomSecret {
  secretId: string;
  name: string;
  displayName: string;
  category: string;
  provider: string | null;
}

export interface ExpectedSecretsResponse {
  /** A class: platform tool keys */
  presetTools: {
    items: ExpectedSecretItem[];
    summary: ExpectedSecretsSummary;
  };
  /** B class: LLM provider keys */
  llmProviders: LlmProviderSecret[];
  /** C class: user-defined custom secrets */
  customSecrets: CustomSecret[];
  /** D class: decommissioned orphans (reserved slot, always empty for now) */
  orphans: ExpectedSecretsOrphan[];
  /** Legacy flat shape — kept for backward compat */
  items: ExpectedSecretItem[];
  summary: ExpectedSecretsSummary;
}

export interface CreateSecretDto {
  name: string;
  displayName: string;
  value: string;
  category?: SecretCategory;
  description?: string;
  provider?: string;
  expiresAt?: string;
  isActive?: boolean;
}

export interface UpdateSecretDto {
  displayName?: string;
  description?: string;
  category?: SecretCategory;
  provider?: string;
  expiresAt?: string;
  isActive?: boolean;
  value?: string;
}

export function useAdminSecrets() {
  const [updateLoading, setUpdateLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [getValueLoading, setGetValueLoading] = useState(false);
  const [getValueError, setGetValueError] = useState<string | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [rollbackLoading, setRollbackLoading] = useState(false);

  // 列表查询
  const {
    data: secrets,
    loading: listLoading,
    error: listError,
    execute: refreshSecrets,
  } = useApiGet<Secret[]>('/admin/secrets', {
    immediate: true,
  });

  // 获取密钥名称列表
  const { data: secretNames, execute: refreshSecretNames } = useApiGet<
    string[]
  >('/admin/secrets/names', {
    immediate: true,
  });

  // 预置卡槽查询
  const {
    data: expectedSecrets,
    loading: expectedLoading,
    execute: refreshExpectedSecrets,
  } = useApiGet<ExpectedSecretsResponse>('/admin/secrets/expected', {
    immediate: true,
  });

  // 创建密钥
  const {
    loading: createLoading,
    error: createError,
    execute: createSecretApi,
  } = useApiPost<Secret, CreateSecretDto>('/admin/secrets');

  const createSecret = useCallback(
    async (data: CreateSecretDto) => {
      const result = await createSecretApi(data);
      if (result) {
        await refreshSecrets();
        await refreshSecretNames();
      }
      return result;
    },
    [createSecretApi, refreshSecrets, refreshSecretNames]
  );

  const updateSecret = useCallback(
    async (name: string, data: UpdateSecretDto) => {
      setUpdateLoading(true);
      try {
        const result = await apiClient.patch<Secret>(
          `/admin/secrets/${name}`,
          data
        );
        await refreshSecrets();
        return result;
      } finally {
        setUpdateLoading(false);
      }
    },
    [refreshSecrets]
  );

  const deleteSecret = useCallback(
    async (name: string) => {
      setDeleteLoading(true);
      try {
        await apiClient.delete(`/admin/secrets/${name}`);
        await refreshSecrets();
        await refreshSecretNames();
      } finally {
        setDeleteLoading(false);
      }
    },
    [refreshSecrets, refreshSecretNames]
  );

  // C3 Fix: Add proper error handling for getSecretValue
  const getSecretValue = useCallback(
    async (name: string): Promise<string | null> => {
      setGetValueLoading(true);
      setGetValueError(null);
      try {
        const result = await apiClient.get<{ value: string }>(
          `/admin/secrets/${encodeURIComponent(name)}/value`
        );
        return result?.value ?? null;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Failed to fetch secret value';
        setGetValueError(message);
        return null;
      } finally {
        setGetValueLoading(false);
      }
    },
    []
  );

  const getAccessLogs = useCallback(
    async (name: string, limit = 50): Promise<SecretAccessLog[]> => {
      setLogsLoading(true);
      try {
        const result = await apiClient.get<SecretAccessLog[]>(
          `/admin/secrets/${name}/logs?limit=${limit}`
        );
        return result ?? [];
      } finally {
        setLogsLoading(false);
      }
    },
    []
  );

  const getVersions = useCallback(
    async (name: string): Promise<SecretVersion[]> => {
      setVersionsLoading(true);
      try {
        const result = await apiClient.get<SecretVersion[]>(
          `/admin/secrets/${name}/versions`
        );
        return result ?? [];
      } finally {
        setVersionsLoading(false);
      }
    },
    []
  );

  const getVersionValue = useCallback(
    async (name: string, version: number): Promise<string | null> => {
      setGetValueLoading(true);
      setGetValueError(null);
      try {
        const result = await apiClient.get<{ value: string }>(
          `/admin/secrets/${encodeURIComponent(name)}/versions/${version}/value`
        );
        return result?.value ?? null;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Failed to fetch version value';
        setGetValueError(message);
        return null;
      } finally {
        setGetValueLoading(false);
      }
    },
    []
  );

  const rollbackVersion = useCallback(
    async (name: string, version: number) => {
      setRollbackLoading(true);
      try {
        await apiClient.post(`/admin/secrets/${name}/rollback/${version}`);
        await refreshSecrets();
      } finally {
        setRollbackLoading(false);
      }
    },
    [refreshSecrets]
  );

  return {
    // 数据
    secrets: secrets ?? [],
    secretNames: secretNames ?? [],

    // 预置卡槽
    expectedSecrets: expectedSecrets ?? null,
    expectedLoading,
    refreshExpectedSecrets,

    // 加载状态
    loading: listLoading || createLoading || updateLoading || deleteLoading,
    isRefreshing: listLoading,

    // 错误状态
    error: listError || createError,
    getValueError,

    // 操作方法
    refreshSecrets,
    refreshSecretNames,
    createSecret,
    updateSecret,
    deleteSecret,
    getSecretValue,
    getAccessLogs,

    // 操作状态
    isCreating: createLoading,
    isUpdating: updateLoading,
    isDeleting: deleteLoading,
    isGettingValue: getValueLoading,
    isLoadingLogs: logsLoading,

    // 版本管理
    getVersions,
    getVersionValue,
    rollbackVersion,
    isLoadingVersions: versionsLoading,
    isRollingBack: rollbackLoading,
  };
}

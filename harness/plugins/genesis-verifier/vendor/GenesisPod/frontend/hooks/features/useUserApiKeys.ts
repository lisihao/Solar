import { useCallback, useState } from 'react';
import { useApiGet } from '@/hooks/core';
import { apiClient } from '@/lib/api/client';
import { toast } from '@/stores';
import { clearAIModelsCache } from '@/hooks/features/useAIModels';

export interface UserApiKeyInfo {
  id: string;
  provider: string;
  /** PR-2 multi-key 标签：default / backup-1 / etc */
  label: string;
  mode: 'personal';
  apiEndpoint: string | null;
  preferredModelId: string | null;
  isActive: boolean;
  /** ★ 2026-05-12 (C方案): 真实"最后使用"时间(业务流量 + 手动 Test 都写).
   *  取代旧 lastTestedAt. UI 唯一的"上次使用"字段. */
  lastUsedAt: string | null;
  testStatus: string | null;
  /** ★ 2026-05-29 W3+: 与 admin key 能力对齐——按 key 测试后的错误码/信息 */
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
  keyHint: string;
}

export interface ProviderInfo {
  id: string;
  name: string;
  endpoint: string;
  /** 调用协议（openai / anthropic / google / cohere）；驱动「添加模型」下拉自动填充 */
  apiFormat?: string;
  capabilities?: string[];
  scope?: string;
  isCustom?: boolean;
}

interface UserApiKeysResponse {
  keys: UserApiKeyInfo[];
  providers: ProviderInfo[];
}

interface TestResult {
  success: boolean;
  message: string;
}

export function useUserApiKeys() {
  const {
    data,
    loading,
    error,
    execute: refresh,
  } = useApiGet<UserApiKeysResponse>('/user/api-keys', { immediate: true });

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const keys = data?.keys || [];
  const providers = data?.providers || [];

  const saveKey = useCallback(
    async (
      provider: string,
      apiKey: string,
      mode: 'personal',
      preferredModelId?: string,
      apiEndpoint?: string,
      label?: string
    ): Promise<boolean> => {
      setSaving(true);
      try {
        await apiClient.put(`/user/api-keys/${provider}`, {
          apiKey,
          mode,
          preferredModelId,
          apiEndpoint,
          label,
        });
        clearAIModelsCache();
        await refresh();
        return true;
      } catch (err) {
        toast.error((err as Error).message || 'Failed to save API key');
        return false;
      } finally {
        setSaving(false);
      }
    },
    [refresh]
  );

  const deleteKey = useCallback(
    async (provider: string, label?: string): Promise<boolean> => {
      setSaving(true);
      try {
        const url = label
          ? `/user/api-keys/${provider}?label=${encodeURIComponent(label)}`
          : `/user/api-keys/${provider}`;
        await apiClient.delete(url);
        clearAIModelsCache();
        await refresh();
        return true;
      } catch (err) {
        toast.error((err as Error).message || 'Failed to delete API key');
        return false;
      } finally {
        setSaving(false);
      }
    },
    [refresh]
  );

  const testKey = useCallback(
    async (
      provider: string,
      apiKey: string,
      apiEndpoint?: string
    ): Promise<TestResult> => {
      setTesting(true);
      try {
        const result = await apiClient.post<TestResult>(
          `/user/api-keys/${provider}/test`,
          { apiKey, apiEndpoint }
        );
        return result || { success: false, message: 'Unknown error' };
      } catch {
        return { success: false, message: 'Connection failed' };
      } finally {
        setTesting(false);
      }
    },
    []
  );

  /** ★ 2026-05-29 W3+: 按已存储 key 的 id 主动测试（与 admin 能力对齐），写回 testStatus/错误码 */
  const testKeyById = useCallback(
    async (
      provider: string,
      keyId: string
    ): Promise<{ ok: boolean; errorCode?: string }> => {
      setTesting(true);
      try {
        const result = await apiClient.post<{
          ok: boolean;
          errorCode?: string;
        }>(`/user/api-keys/${provider}/keys/${keyId}/test`, {});
        await refresh();
        return result || { ok: false };
      } catch (err) {
        toast.error((err as Error).message || 'Failed to test API key');
        return { ok: false };
      } finally {
        setTesting(false);
      }
    },
    [refresh]
  );

  const getKeyForProvider = useCallback(
    (provider: string) => keys.find((k) => k.provider === provider),
    [keys]
  );

  /** Multi-key 视图：返回某 provider 下全部 label 的 keys（按 label 排序） */
  const getKeysForProvider = useCallback(
    (provider: string) =>
      keys
        .filter((k) => k.provider === provider)
        .sort((a, b) => a.label.localeCompare(b.label)),
    [keys]
  );

  return {
    keys,
    providers,
    loading,
    error,
    saving,
    testing,
    refresh,
    saveKey,
    deleteKey,
    testKey,
    testKeyById,
    getKeyForProvider,
    getKeysForProvider,
  };
}

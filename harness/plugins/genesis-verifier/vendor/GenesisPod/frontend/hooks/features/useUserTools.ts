import { useCallback, useState } from 'react';
import { useApiGet } from '@/hooks/core';
import { apiClient } from '@/lib/api/client';
import { toast } from '@/stores';
import { useTranslation } from '@/lib/i18n';

export interface UserToolItem {
  toolId: string;
  name: string;
  category: string;
  secretName: string;
  userConfigurable: boolean;
  configured: boolean;
  systemConfigured: boolean;
  granted: boolean;
  /** 该用户现在能否直接使用此工具 */
  usable: boolean;
  /** 可用来源：user=自有 key, granted=被授权平台 key, platform=FALLBACK 平台兜底, none=需配置 */
  source: 'user' | 'granted' | 'platform' | 'none';
}

interface UserToolsResponse {
  items: UserToolItem[];
}

interface TestKeyResult {
  success: boolean;
  message: string;
  testedAt: string;
}

export function useUserTools() {
  const { t } = useTranslation();
  const { data, loading, error, execute } = useApiGet<UserToolsResponse>(
    '/user/tools',
    { immediate: true }
  );
  const [testingToolId, setTestingToolId] = useState<string | null>(null);

  /** 测试工具 Key（通过 secret id 调 /user/secrets/secret/:id/test）。 */
  const testToolKey = useCallback(
    async (secretId: string): Promise<void> => {
      setTestingToolId(secretId);
      try {
        const res = await apiClient.post<TestKeyResult>(
          `/user/secrets/secret/${secretId}/test`
        );
        if (res.success) {
          toast.success(t('me.apiKeys.testSuccess'));
        } else {
          toast.error(
            res.message || t('me.apiKeys.testFailed')
          );
        }
      } catch (err) {
        toast.error((err as Error).message || t('me.apiKeys.testFailed'));
      } finally {
        setTestingToolId(null);
      }
    },
    [t]
  );

  return {
    tools: data?.items ?? [],
    loading,
    error,
    refresh: execute,
    testToolKey,
    testingToolId,
  };
}

export async function requestToolGrant(
  toolId: string,
  reason?: string
): Promise<void> {
  await apiClient.post('/user/authorization/requests', {
    type: 'TOOL_GRANT',
    targetId: toolId,
    reason,
  });
}

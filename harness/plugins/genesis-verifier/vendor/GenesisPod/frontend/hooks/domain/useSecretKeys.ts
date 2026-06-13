/**
 * 多 KEY 管理 hook（admin /admin/secrets/:secretId/keys/*）
 *
 * 一个 secret 下 N 个 KEY 行 CRUD + test。
 * 与 useAdminSecrets 是兄弟关系，独立加载。
 */

import { useState, useCallback, useEffect } from 'react';
import { apiClient } from '@/lib/api/client';
import { toast } from '@/stores';

export interface SecretKeyRow {
  id: string;
  secretId: string;
  label: string;
  keyHint: string | null;
  isActive: boolean;
  priority: number;
  testStatus: 'success' | 'failed' | null;
  /** ★ 2026-05-12 (C方案): 真实"最后使用"时间(业务流量 + 手动 Test 都写).
   *  UI 唯一的"上次使用"字段, 取代旧 lastTestedAt. */
  lastUsedAt: string | null;
  /** ★ 2026-05-06: 归一化错误码 — AUTH_FAILED / RATE_LIMIT_KEY / QUOTA_EXCEEDED /
   *   PROVIDER_DOWN / TIMEOUT / NETWORK_ERROR / DECRYPTION_FAILED / UNKNOWN */
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  accessCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AddKeyInput {
  label: string;
  value: string;
  priority?: number;
  isActive?: boolean;
}

export interface UpdateKeyMetaInput {
  label?: string;
  priority?: number;
  isActive?: boolean;
}

/**
 * @param baseUrl 多 Key 子资源根路径。默认 admin（/admin/secrets）；
 *   BYOK 用户侧传 '/user/secrets'（同款契约，owner 作用域由后端按 req.user.id 强制）。
 */
export function useSecretKeys(
  secretId: string | null,
  baseUrl: string = '/admin/secrets'
) {
  const [keys, setKeys] = useState<SecretKeyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
    if (!secretId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get<SecretKeyRow[]>(
        `${baseUrl}/${secretId}/keys`
      );
      setKeys(data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load keys');
    } finally {
      setLoading(false);
    }
  }, [secretId, baseUrl]);

  useEffect(() => {
    if (secretId) void load();
    else setKeys([]);
  }, [secretId, load]);

  const runAction = useCallback(
    async (verb: string, fn: () => Promise<unknown>) => {
      setActionLoading(true);
      try {
        await fn();
        await load();
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : `Failed to ${verb} key`;
        toast.error(msg);
        throw err;
      } finally {
        setActionLoading(false);
      }
    },
    [load]
  );

  const addKey = useCallback(
    async (input: AddKeyInput) => {
      if (!secretId) return;
      await runAction('add', () =>
        apiClient.post(`${baseUrl}/${secretId}/keys`, input)
      );
    },
    [secretId, runAction, baseUrl]
  );

  const updateKeyMeta = useCallback(
    async (keyId: string, meta: UpdateKeyMetaInput) => {
      if (!secretId) return;
      await runAction('update', () =>
        apiClient.patch(`${baseUrl}/${secretId}/keys/${keyId}`, meta)
      );
    },
    [secretId, runAction, baseUrl]
  );

  const replaceKeyValue = useCallback(
    async (keyId: string, value: string) => {
      if (!secretId) return;
      await runAction('replace', () =>
        apiClient.put(`${baseUrl}/${secretId}/keys/${keyId}/value`, {
          value,
        })
      );
    },
    [secretId, runAction, baseUrl]
  );

  const deleteKey = useCallback(
    async (keyId: string) => {
      if (!secretId) return;
      await runAction('delete', () =>
        apiClient.delete(`${baseUrl}/${secretId}/keys/${keyId}`)
      );
    },
    [secretId, runAction, baseUrl]
  );

  const testKey = useCallback(
    async (keyId: string) => {
      if (!secretId) return;
      await runAction('test', () =>
        apiClient.post(`${baseUrl}/${secretId}/keys/${keyId}/test`, {})
      );
    },
    [secretId, runAction, baseUrl]
  );

  return {
    keys,
    loading,
    error,
    actionLoading,
    refresh: load,
    addKey,
    updateKeyMeta,
    replaceKeyValue,
    deleteKey,
    testKey,
  };
}

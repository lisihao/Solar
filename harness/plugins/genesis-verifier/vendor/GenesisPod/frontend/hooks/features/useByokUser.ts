'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useApiGet } from '@/hooks/core';
import { apiClient } from '@/lib/api/client';
import { toast } from '@/stores';
import { clearAIModelsCache } from '@/hooks/features/useAIModels';

// ─── Types ───────────────────────────────────────────────────────────────────

// 2026-05-08 v5（drop_distributable_keys）后，KeyAssignment 直接关联 AIModel：
// 删除了 keyId / keyLabel / keyHint / poolRemainingCents（旧 DistributableKey 时代字段），
// 新增 modelId / modelDbId / modelDisplayName / modelEnabled / validityType /
// recurrence* / nextRenewalAt / assignedBy / revoked* —— 与后端
// `key-assignments.service.ts:UserAssignmentView` 完全对齐。
export type AssignmentStatus =
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'EXPIRED'
  | 'REVOKED'
  | 'STALE';

export interface UserAssignmentView {
  id: string;
  modelDbId: string;
  modelId: string;
  provider: string;
  userId: string;
  userQuotaCents: number | null;
  userSpendCents: number;
  status: AssignmentStatus;
  validityType: string;
  recurrenceUnit: string | null;
  recurrenceInterval: number | null;
  nextRenewalAt: string | null;
  assignedAt: string;
  assignedBy: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  revokedReason: string | null;
  note: string | null;
  modelDisplayName: string;
  modelEnabled: boolean;
  // 扩展字段：让"我的模型"tab 的 SYSTEM-granted 行能与 PERSONAL 行同列展示
  modelType: string;
  modelIsReasoning: boolean;
  modelMaxTokens: number;
  modelSupportsTemperature: boolean;
  modelSupportsStreaming: boolean;
  modelSupportsFunctionCalling: boolean;
  modelSupportsVision: boolean;
}

export interface MyKeyRequest {
  id: string;
  // 2026-05-08: 用户提交时不再选 provider；后端字段保留 nullable 仅为兼容历史数据
  provider: string | null;
  reason: string | null;
  estimatedUsage: 'LIGHT' | 'MEDIUM' | 'HEAVY' | null;
  note: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  rejectionReason: string | null;
  createdAt: string;
  handledAt: string | null;
}

export interface AvailableModelsResponse {
  availableProviders: string[];
  modelType: string;
  models: Array<{
    id: string;
    name: string;
    displayName: string;
    modelId: string;
    provider: string;
    modelType: string;
    isReasoning: boolean;
    maxTokens: number;
    priority: number;
  }>;
}

export interface OnboardingStatus {
  byokOnboardedAt: string | null;
  isAdmin: boolean;
  requiresOnboarding: boolean;
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

export function useMyKeyAssignments() {
  const {
    data,
    loading,
    error,
    execute: refresh,
  } = useApiGet<{
    items: UserAssignmentView[];
  }>('/user/key-assignments', { immediate: true });

  // assignment 影响 /ai/models 的输出（业务下拉里能不能看到系统授权的模型）。
  // useAIModels 在 SPA 内有 5min 模块级缓存，admin 端 grant/revoke 后用户 SPA
  // 不会自动刷新业务下拉。这里：每当本 hook 拿到的 assignment 列表内容变化
  // （ID/status/modelDbId 任一变），主动 bust useAIModels 缓存 → 下次 chat
  // 页面挂载 useAIModels 会重新拉 /ai/models。
  const lastSignatureRef = useRef('');
  useEffect(() => {
    if (!data?.items) return;
    const signature = data.items
      .map((a) => `${a.id}:${a.status}:${a.modelDbId}`)
      .sort()
      .join(',');
    if (signature !== lastSignatureRef.current) {
      lastSignatureRef.current = signature;
      clearAIModelsCache();
    }
  }, [data?.items]);

  return { assignments: data?.items ?? [], loading, error, refresh };
}

export function useMyKeyRequests() {
  const {
    data,
    loading,
    error,
    execute: refresh,
  } = useApiGet<{
    items: MyKeyRequest[];
  }>('/user/key-requests', { immediate: true });

  const submit = useCallback(
    async (input: {
      reason?: string;
      estimatedUsage?: 'LIGHT' | 'MEDIUM' | 'HEAVY';
      note?: string;
    }): Promise<MyKeyRequest | null> => {
      try {
        const req = await apiClient.post<MyKeyRequest>(
          '/user/key-requests',
          input
        );
        await refresh();
        toast.success('申请已提交，管理员处理后会通知你');
        return req;
      } catch (err) {
        toast.error((err as Error).message || '申请失败');
        return null;
      }
    },
    [refresh]
  );

  const cancel = useCallback(
    async (id: string) => {
      try {
        await apiClient.delete(`/user/key-requests/${id}`);
        await refresh();
        toast.success('已撤销申请');
        return true;
      } catch (err) {
        toast.error((err as Error).message || '撤销失败');
        return false;
      }
    },
    [refresh]
  );

  return {
    requests: data?.items ?? [],
    loading,
    error,
    refresh,
    submit,
    cancel,
  };
}

export function useAvailableModels(modelType?: string) {
  const qs = modelType ? `?modelType=${encodeURIComponent(modelType)}` : '';
  const {
    data,
    loading,
    error,
    execute: refresh,
  } = useApiGet<AvailableModelsResponse>(`/user/available-models${qs}`, {
    immediate: true,
    cacheKey: `available-models-${modelType ?? 'CHAT'}`,
    cacheTTL: 60_000,
  });
  return {
    availableProviders: data?.availableProviders ?? [],
    models: data?.models ?? [],
    modelType: data?.modelType ?? 'CHAT',
    loading,
    error,
    refresh,
  };
}

export function useOnboardingStatus() {
  const {
    data,
    loading,
    error,
    execute: refresh,
  } = useApiGet<OnboardingStatus>('/user/onboarding/status', {
    immediate: true,
  });

  const complete = useCallback(async () => {
    try {
      await apiClient.patch('/user/onboarding/complete', {});
      await refresh();
      return true;
    } catch (err) {
      toast.error((err as Error).message || '标记引导完成失败');
      return false;
    }
  }, [refresh]);

  return {
    status: data,
    loading,
    error,
    refresh,
    complete,
  };
}

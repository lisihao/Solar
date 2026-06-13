'use client';

import { useCallback } from 'react';
import { useApiGet } from '@/hooks/core';
import { apiClient } from '@/lib/api/client';
import { toast } from '@/stores';

// ─── Types ───────────────────────────────────────────────────────────────────
//
// 2026-05-08 v5（drop_distributable_keys）:
//   - 删除 DistributableKeyView 类型 + useDistributableKeys/useDistributableKeyDetail hook
//   - AssignmentView：keyId → modelDbId（FK 改 AIModel.id），加 modelId / modelDisplayName
//   - ByokDashboardMetrics：池级指标 → 模型级指标
//   - approve 入参：keyId → modelDbId

export interface AssignmentView {
  id: string;
  modelDbId: string;
  provider: string;
  modelId: string;
  userId: string;
  userQuotaCents: number | null;
  userSpendCents: number;
  status: 'ACTIVE' | 'SUSPENDED' | 'EXPIRED' | 'REVOKED' | 'STALE';
  validityType: 'ONE_TIME' | 'RECURRING';
  recurrenceUnit: 'WEEK' | 'MONTH' | 'YEAR' | null;
  recurrenceInterval: number | null;
  nextRenewalAt: string | null;
  assignedAt: string;
  assignedBy: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  revokedReason: string | null;
  note: string | null;
}

export interface KeyRequestView {
  id: string;
  userId: string;
  // 2026-05-08: 用户提交时不再选 provider；admin 在审批界面自由选 AIModel 授权
  provider: string | null;
  reason: string | null;
  estimatedUsage: 'LIGHT' | 'MEDIUM' | 'HEAVY' | null;
  note: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  handledBy: string | null;
  handledAt: string | null;
  rejectionReason: string | null;
  resultingAssignmentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ByokDashboardMetrics {
  totalModels: number;
  enabledModels: number;
  activeAssignments: number;
  pendingRequests: number;
  totalSpendCents: number;
  totalQuotaCents: number | null;
  utilizationPercent: number | null;
}

// ─── Admin Assignments ───────────────────────────────────────────────────────

export function useAdminKeyAssignments(filters?: {
  status?: string;
  provider?: string;
}) {
  const query = new URLSearchParams();
  if (filters?.status) query.set('status', filters.status);
  if (filters?.provider) query.set('provider', filters.provider);
  const qs = query.toString();
  const {
    data,
    loading,
    error,
    execute: refresh,
  } = useApiGet<{
    items: AssignmentView[];
  }>(`/admin/key-assignments${qs ? `?${qs}` : ''}`, { immediate: true });

  const revoke = useCallback(
    async (id: string, reason?: string) => {
      try {
        await apiClient.delete(`/admin/key-assignments/${id}`, {
          body: JSON.stringify({ reason }),
          headers: { 'Content-Type': 'application/json' },
        });
        await refresh();
        toast.success('授权已撤销');
        return true;
      } catch (err) {
        toast.error((err as Error).message || '撤销失败');
        return false;
      }
    },
    [refresh]
  );

  const updateAssignment = useCallback(
    async (
      id: string,
      patch: {
        userQuotaCents?: number | null;
        expiresAt?: string | null;
        note?: string | null;
        status?: 'ACTIVE' | 'SUSPENDED';
      }
    ) => {
      try {
        await apiClient.patch(`/admin/key-assignments/${id}`, patch);
        await refresh();
        toast.success('已更新');
        return true;
      } catch (err) {
        toast.error((err as Error).message || '更新失败');
        return false;
      }
    },
    [refresh]
  );

  return {
    assignments: data?.items || [],
    loading,
    error,
    refresh,
    revoke,
    updateAssignment,
  };
}

// ─── Admin Key Requests ──────────────────────────────────────────────────────

export function useAdminKeyRequests(filters?: { status?: string }) {
  const query = new URLSearchParams();
  if (filters?.status) query.set('status', filters.status);
  const qs = query.toString();
  const {
    data,
    loading,
    error,
    execute: refresh,
  } = useApiGet<{
    items: KeyRequestView[];
  }>(`/admin/key-requests${qs ? `?${qs}` : ''}`, { immediate: true });

  const approve = useCallback(
    async (
      id: string,
      input: {
        modelDbId: string;
        userQuotaCents?: number | null;
        expiresAt?: string | null;
        note?: string;
      }
    ) => {
      try {
        await apiClient.post(`/admin/key-requests/${id}/approve`, input);
        await refresh();
        toast.success('申请已批准并完成授权');
        return true;
      } catch (err) {
        toast.error((err as Error).message || '批准失败');
        return false;
      }
    },
    [refresh]
  );

  const reject = useCallback(
    async (id: string, reason: string) => {
      try {
        await apiClient.post(`/admin/key-requests/${id}/reject`, { reason });
        await refresh();
        toast.success('申请已拒绝');
        return true;
      } catch (err) {
        toast.error((err as Error).message || '拒绝失败');
        return false;
      }
    },
    [refresh]
  );

  return {
    requests: data?.items || [],
    loading,
    error,
    refresh,
    approve,
    reject,
  };
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

export function useByokDashboard() {
  const {
    data,
    loading,
    error,
    execute: refresh,
  } = useApiGet<ByokDashboardMetrics>('/admin/byok-dashboard', {
    immediate: true,
    cacheKey: 'byok-dashboard',
    cacheTTL: 60_000,
  });
  return { metrics: data, loading, error, refresh };
}

// ─── Util ────────────────────────────────────────────────────────────────────

export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '无限';
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * useAdminStatus - 管理后台实时状态轮询 hooks
 *
 * 架构图（/admin/overview）与租户状态页（/admin/tenants）共用的
 * 30s 轮询数据源。后台 tab 不轮询，回到前台立即刷新。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useApiGet } from '@/hooks/core';

// ==================== 类型（与后端 DTO 对齐） ====================

export type CardHealth = 'healthy' | 'degraded' | 'down';

export interface OverviewCardStatus {
  status: CardHealth;
  metrics: Record<string, number>;
}

export interface OverviewStatus {
  timestamp: string;
  global: {
    healthScore: number;
    status: 'healthy' | 'degraded' | 'unhealthy';
    dbStatus: 'healthy' | 'unhealthy';
    dbLatencyMs: number;
    errors24h: number;
    critical24h: number;
    llmCalls24h: number;
    llmSuccessRate24h: number;
    runningProcesses: number;
    openBreakers: number;
  };
  cards: Record<string, OverviewCardStatus>;
}

export type TenantActivityStatus = 'attention' | 'running' | 'active' | 'idle';

export interface TenantStatusRow {
  userId: string;
  email: string;
  username: string | null;
  fullName: string | null;
  role: string;
  isActive: boolean;
  subscriptionTier: string;
  status: TenantActivityStatus;
  lastActiveAt: string | null;
  runningProcesses: number;
  failedProcesses: number;
  llmCalls: number;
  llmFailures: number;
  tokens: number;
  creditsBalance: number;
  creditsSpentToday: number;
  errors: number;
}

export interface TenantStatusResponse {
  timestamp: string;
  windowHours: number;
  total: number;
  capped: boolean;
  summary: {
    totalTenants: number;
    activeTenants: number;
    runningProcesses: number;
    llmCalls: number;
    llmFailures: number;
    errors: number;
  };
  tenants: TenantStatusRow[];
}

// ==================== 轮询基础 hook ====================

const DEFAULT_INTERVAL_MS = 30_000;

function usePolledApiGet<T>(path: string, intervalMs = DEFAULT_INTERVAL_MS) {
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  // useApiGet 把 onSuccess 放进 fetchData 依赖，必须保持引用稳定，
  // 否则每次 render 重建回调 → 自动执行 effect 反复触发 → 无限请求
  const onSuccess = useCallback(() => setLastUpdatedAt(new Date()), []);

  const api = useApiGet<T>(path, { onSuccess });

  const refreshRef = useRef(api.refresh);
  refreshRef.current = api.refresh;

  useEffect(() => {
    const tick = () => {
      if (!document.hidden) {
        void refreshRef.current();
      }
    };
    const timer = setInterval(tick, intervalMs);
    const onVisibilityChange = () => {
      if (!document.hidden) {
        void refreshRef.current();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [intervalMs]);

  return { ...api, lastUpdatedAt };
}

// ==================== 业务 hooks ====================

/** 架构图实时状态（卡片健康 + 全局健康分），30s 轮询 */
export function useOverviewStatus() {
  return usePolledApiGet<OverviewStatus>('/admin/overview-status');
}

export interface TenantStatusParams {
  hours?: number;
  limit?: number;
  offset?: number;
  search?: string;
}

/** 全租户状态总览，30s 轮询；参数变化即时重取 */
export function useTenantStatus(params: TenantStatusParams = {}) {
  const query = new URLSearchParams();
  if (params.hours) query.set('hours', String(params.hours));
  if (params.limit) query.set('limit', String(params.limit));
  if (params.offset) query.set('offset', String(params.offset));
  if (params.search) query.set('search', params.search);
  const qs = query.toString();
  return usePolledApiGet<TenantStatusResponse>(
    `/admin/tenants/status${qs ? `?${qs}` : ''}`
  );
}

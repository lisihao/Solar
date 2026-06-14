/**
 * Provider Quotas Hook
 * 获取和管理 AI Provider 配额信息
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { logger } from '@/lib/utils/logger';

// 配额状态
export type QuotaStatus =
  | 'normal'
  | 'warning'
  | 'critical'
  | 'unavailable'
  | 'error';

// 配额数据来源
export type QuotaDataSource = 'api' | 'estimated' | 'unavailable';

// 配额类型
export type QuotaType = 'tokens' | 'credits' | 'requests';

// 配额周期
export type QuotaPeriod = 'daily' | 'monthly' | 'unlimited';

// Provider 配额信息
export interface ProviderQuota {
  provider: string;
  providerDisplayName: string;
  providerIcon: string;
  quotaType: QuotaType;
  usage: number;
  limit: number | null;
  remaining: number | null;
  usagePercentage: number | null;
  unit: string;
  period: QuotaPeriod;
  status: QuotaStatus;
  statusMessage: string;
  lastUpdated: string;
  dataSource: QuotaDataSource;
  consoleUrl: string;
}

// API 响应类型
interface QuotaResponse {
  quotas: ProviderQuota[];
  lastUpdated: string | null;
}

export function useProviderQuotas() {
  const [quotas, setQuotas] = useState<ProviderQuota[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // 防止组件卸载后更新状态导致内存泄漏
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * 获取所有 Provider 的配额信息
   */
  const fetchQuotas = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${config.apiUrl}/admin/quota/providers`, {
        headers: { ...getAuthHeader() },
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error('需要管理员权限');
        }
        throw new Error('获取配额信息失败');
      }

      const result = await response.json();
      // Handle wrapped response { success: true, data: {...} }
      const data: QuotaResponse = result?.data ?? result;

      if (mountedRef.current) {
        setQuotas(data.quotas || []);
        setLastUpdated(data.lastUpdated ? new Date(data.lastUpdated) : null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '未知错误';
      logger.error('[useProviderQuotas] fetchQuotas failed:', err);
      if (mountedRef.current) {
        setError(message);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  /**
   * 刷新所有 Provider 的配额
   */
  const refreshQuotas = useCallback(async () => {
    setRefreshing(true);
    setError(null);

    try {
      const response = await fetch(`${config.apiUrl}/admin/quota/refresh`, {
        method: 'POST',
        headers: { ...getAuthHeader() },
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error('需要管理员权限');
        }
        throw new Error('刷新配额信息失败');
      }

      const result = await response.json();
      // Handle wrapped response { success: true, data: {...} }
      const data: QuotaResponse = result?.data ?? result;

      if (mountedRef.current) {
        setQuotas(data.quotas || []);
        setLastUpdated(
          data.lastUpdated ? new Date(data.lastUpdated) : new Date()
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '未知错误';
      logger.error('[useProviderQuotas] refreshQuotas failed:', err);
      if (mountedRef.current) {
        setError(message);
      }
    } finally {
      if (mountedRef.current) {
        setRefreshing(false);
      }
    }
  }, []);

  /**
   * 刷新单个 Provider 的配额
   */
  const refreshProviderQuota = useCallback(async (provider: string) => {
    try {
      const response = await fetch(
        `${config.apiUrl}/admin/quota/refresh/${provider}`,
        {
          method: 'POST',
          headers: { ...getAuthHeader() },
        }
      );

      if (!response.ok) {
        throw new Error(`刷新 ${provider} 配额失败`);
      }

      const result = await response.json();
      // Handle wrapped response { success: true, data: {...} }
      const updatedQuota: ProviderQuota = result?.data ?? result;

      if (mountedRef.current) {
        setQuotas((prev) =>
          prev.map((q) => (q.provider === provider ? updatedQuota : q))
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '未知错误';
      logger.error(
        `[useProviderQuotas] refreshProviderQuota ${provider} failed:`,
        err
      );
      if (mountedRef.current) {
        setError(message);
      }
    }
  }, []);

  return {
    quotas,
    loading,
    refreshing,
    error,
    lastUpdated,
    fetchQuotas,
    refreshQuotas,
    refreshProviderQuota,
  };
}

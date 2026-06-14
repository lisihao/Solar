import { useEffect, useCallback } from 'react';
import { useApiGet, useApiPost } from '../core';
import { useCreditsStore, CreditTransaction } from '@/stores';
import { getAuthHeader } from '@/lib/utils/auth';
import { config } from '@/lib/utils/config';

/**
 * 积分统计信息
 */
export interface CreditsStats {
  totalEarned: number;
  totalSpent: number;
  currentBalance: number;
  todaySpent: number;
  weekSpent: number;
  monthSpent: number;
  topModules: Array<{ module: string; spent: number }>;
}

/**
 * 积分规则
 */
export interface CreditRule {
  moduleType: string;
  operationType: string;
  baseCredits: number;
  name: string;
  isActive: boolean;
}

/**
 * 交易记录分页响应（后端返回格式包含 success 和 data）
 */
interface TransactionsResponse {
  success?: boolean;
  data: CreditTransaction[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * 积分 Hook
 * 提供完整的积分管理功能
 */
export function useCredits() {
  const store = useCreditsStore();

  // 初始化加载
  useEffect(() => {
    if (!store.account) {
      store.fetchAccount();
      store.fetchCheckinStatus();
    }
  }, []);

  // 刷新余额
  const refreshBalance = useCallback(() => {
    return store.fetchBalance();
  }, [store.fetchBalance]);

  // 刷新账户
  const refreshAccount = useCallback(() => {
    return store.fetchAccount();
  }, [store.fetchAccount]);

  return {
    // 账户信息
    account: store.account,
    balance: store.account?.balance ?? 0,
    isLow: store.account?.isLow ?? false,
    isCritical: store.account?.isCritical ?? false,
    isLoading: store.isLoading,
    error: store.error,

    // 签到相关
    checkinStatus: store.checkinStatus,
    isCheckingIn: store.isCheckingIn,
    performCheckin: store.performCheckin,

    // 刷新
    refreshBalance,
    refreshAccount,
    refreshCheckinStatus: store.fetchCheckinStatus,

    // 余额更新（供 AI 模块使用）
    updateBalance: store.updateBalance,

    // 弹窗控制
    showInsufficientModal: store.showInsufficientModal,
    hideInsufficientModal: store.hideInsufficientModal,
    insufficientModalOpen: store.insufficientModalOpen,
    insufficientData: store.insufficientData,

    showCheckinModal: store.showCheckinModal,
    hideCheckinModal: store.hideCheckinModal,
    checkinModalOpen: store.checkinModalOpen,
    checkinResult: store.checkinResult,
  };
}

/**
 * 交易记录 Hook
 */
export function useCreditsTransactions(options?: {
  type?: string;
  moduleType?: string;
  limit?: number;
}) {
  // Build query string from options
  const queryParams = new URLSearchParams();
  if (options?.type) queryParams.set('type', options.type);
  if (options?.moduleType) queryParams.set('moduleType', options.moduleType);
  queryParams.set('limit', String(options?.limit || 20));
  const queryString = queryParams.toString();

  const {
    data,
    loading,
    error,
    execute: refresh,
  } = useApiGet<TransactionsResponse>(`/credits/transactions?${queryString}`, {
    immediate: true,
  });

  const loadMore = useCallback(
    async (offset: number) => {
      const response = await fetch(
        `/api/v1/credits/transactions?offset=${offset}&limit=${options?.limit || 20}`,
        { headers: { ...getAuthHeader() } }
      );
      return response.json();
    },
    [options?.limit]
  );

  return {
    transactions: data?.data ?? [],
    total: data?.total ?? 0,
    hasMore: data?.hasMore ?? false,
    loading,
    error,
    refresh,
    loadMore,
  };
}

/**
 * 积分统计 Hook
 */
export function useCreditsStats() {
  const {
    data,
    loading,
    error,
    execute: refresh,
  } = useApiGet<CreditsStats>('/credits/stats', { immediate: true });

  return {
    stats: data,
    loading,
    error,
    refresh,
  };
}

/**
 * 积分规则 Hook
 */
export function useCreditRules() {
  const { data, loading, error } = useApiGet<CreditRule[]>('/credits/rules', {
    immediate: true,
  });

  return {
    rules: data ?? [],
    loading,
    error,
  };
}

/**
 * 签到历史 Hook
 */
export function useCheckinHistory(limit: number = 30) {
  const {
    data,
    loading,
    error,
    execute: refresh,
  } = useApiGet<Array<{ date: string; credits: number; streakDays: number }>>(
    `/credits/checkin/history?limit=${limit}`,
    {
      immediate: true,
    }
  );

  return {
    history: data ?? [],
    loading,
    error,
    refresh,
  };
}

/**
 * 预估积分消耗 Hook
 */
export function useEstimateCredits() {
  const { loading, execute } = useApiGet<{ estimatedCredits: number }>(
    '/credits/estimate',
    { immediate: false }
  );

  const estimate = useCallback(
    async (
      moduleType: string,
      operationType: string,
      tokenCount?: number,
      modelName?: string
    ) => {
      const params = new URLSearchParams({
        moduleType,
        operationType,
        ...(tokenCount && { tokenCount: String(tokenCount) }),
        ...(modelName && { modelName }),
      });

      const response = await fetch(
        `${config.apiUrl}/credits/estimate?${params}`,
        {
          headers: { ...getAuthHeader() },
        }
      );
      const result = await response.json();
      return result.success ? result.data.estimatedCredits : 0;
    },
    []
  );

  return {
    loading,
    estimate,
  };
}

/**
 * 检查余额是否足够
 * 如果不足则显示弹窗
 */
export function useCreditsCheck() {
  const { balance, showInsufficientModal } = useCredits();

  const checkBalance = useCallback(
    (required: number): boolean => {
      if (balance < required) {
        showInsufficientModal({
          required,
          available: balance,
          deficit: required - balance,
        });
        return false;
      }
      return true;
    },
    [balance, showInsufficientModal]
  );

  return { checkBalance, balance };
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';

export interface ByokStatus {
  configured: boolean;
  activeProviders: string[];
  hasModelConfig: boolean;
}

// 用于跨组件通知"key 配置完成，请重新拉 status"
export const BYOK_REFRESH_EVENT = 'byok-status-refresh';

/** 发广播：任何保存 key 成功的地方都该调一次，让 banner 自动消失 */
export function broadcastByokStatusRefresh(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(BYOK_REFRESH_EVENT));
}

const DISMISS_KEY = 'byok-onboarding-dismissed-at';
const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // dismiss 后 30 天不再提示

/**
 * 全站共享的 BYOK 状态查询 hook。
 *
 * 返回：
 * - status: { configured, activeProviders, hasModelConfig, firstTime } | null
 * - loading
 * - error
 * - shouldShowBanner: boolean — 结合 dismiss 记录算出要不要显示引导 banner
 * - dismissBanner(): void — 用户主动关掉 banner，写 localStorage 30 天生效
 * - refresh(): void — 手动重拉
 *
 * 缓存策略：组件挂载时 fetch 一次，配好 key 后调用 refresh() 让状态立刻更新。
 */
export function useByokStatus() {
  const [status, setStatus] = useState<ByokStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  // 初始读 dismiss 时间（SSR 不可用 localStorage，放 useEffect）
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (raw) {
      const ts = parseInt(raw, 10);
      if (!Number.isNaN(ts)) setDismissedAt(ts);
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch(`${config.apiUrl}/user/api-keys/status`, {
        headers: getAuthHeader(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = (await res.json()) as
        | ByokStatus
        | { success?: boolean; data?: ByokStatus };
      const payload =
        (raw as { data?: ByokStatus }).data ?? (raw as ByokStatus);
      setStatus(payload);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  // 监听全局"配好 key 了"事件 → 自动 refresh banner 状态
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => void fetchStatus();
    window.addEventListener(BYOK_REFRESH_EVENT, handler);
    return () => window.removeEventListener(BYOK_REFRESH_EVENT, handler);
  }, [fetchStatus]);

  const dismissBanner = useCallback(() => {
    if (typeof window === 'undefined') return;
    const now = Date.now();
    window.localStorage.setItem(DISMISS_KEY, String(now));
    setDismissedAt(now);
  }, []);

  // 显示 banner 条件：已加载完 + 未配置 + 未在 30 天 dismiss 窗口内
  const shouldShowBanner =
    !loading &&
    status !== null &&
    !status.configured &&
    (dismissedAt === null || Date.now() - dismissedAt > DISMISS_TTL_MS);

  return {
    status,
    loading,
    error,
    shouldShowBanner,
    dismissBanner,
    refresh: fetchStatus,
  };
}

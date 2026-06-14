/**
 * useAdminAIProviders —— 拉 admin 维护的 ai_providers 列表
 *
 * 2026-05-11 P8 拆分：原本内联在 AIModelSettings.tsx (god-class 3047 行)，
 * 拆到独立 hook 减少耦合 + 让 ProviderDiscoverModal 等其它组件复用。
 */
'use client';

import { useEffect, useState } from 'react';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';

export interface AdminAIProviderRow {
  slug: string;
  name: string;
  endpoint: string;
  apiFormat: string;
  iconUrl: string | null;
}

export function useAdminAIProviders() {
  const [providers, setProviders] = useState<AdminAIProviderRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(`${config.apiUrl}/admin/ai-providers`, {
      headers: getAuthHeader(),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((raw) => {
        // 后端全局 ResponseTransformInterceptor 包了 { success, data, metadata }，
        // 这里要解一层；同时容错 raw 直接是数组（非生产路径）。
        const rows = Array.isArray(raw)
          ? raw
          : Array.isArray(raw?.data)
            ? raw.data
            : [];
        setProviders(rows);
        setLoaded(true);
      })
      .catch(() => {
        setLoaded(true);
      });
  }, []);

  return { providers, loaded };
}

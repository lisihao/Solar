'use client';

/**
 * useBudgetTiers —— 调研规模档位 + 预算字段上下限的前端读取(单一源:后端)。
 *
 * ★ 2026-05-22 ③J/K 契约单一源:前端不再手写 SCALE_TIERS 镜像后端 DEPTH_BUDGET_TIERS。
 *   改 fetch GET /agent-playground/budget-tiers。模块级缓存 → 全应用只请求一次。
 */

import { useEffect, useState } from 'react';
import {
  fetchBudgetTiers,
  type BudgetTiersResponse,
  type BudgetTier,
} from '@/services/agent-playground/api';

let cache: BudgetTiersResponse | null = null;
let inflight: Promise<BudgetTiersResponse> | null = null;

export function useBudgetTiers(): {
  data: BudgetTiersResponse | null;
  loading: boolean;
} {
  const [data, setData] = useState<BudgetTiersResponse | null>(cache);
  const [loading, setLoading] = useState<boolean>(!cache);

  useEffect(() => {
    if (cache) {
      setData(cache);
      setLoading(false);
      return;
    }
    let alive = true;
    inflight = inflight ?? fetchBudgetTiers();
    inflight
      .then((r) => {
        cache = r;
        if (alive) {
          setData(r);
          setLoading(false);
        }
      })
      .catch(() => {
        // fetch 失败时不缓存(下次重试);调用方按 data===null 兜底
        inflight = null;
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return { data, loading };
}

/** 按 depth 取单个档位(data 未就绪时返回 undefined)。 */
export function pickTier(
  data: BudgetTiersResponse | null,
  depth: BudgetTier['depth']
): BudgetTier | undefined {
  return data?.tiers.find((t) => t.depth === depth);
}

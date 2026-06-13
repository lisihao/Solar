/**
 * 工具 ID 别名映射（admin 单源真理拉取）
 *
 * ★ 2026-05-07 (PR-S0a, design v1.4 §2.4): backend `tool-id-aliases.ts` 是
 *   provider id ↔ registry id 的唯一真理源。前端过去硬编码的
 *   `PROVIDER_TO_TOOL_ID`（28 项）与后端 (21 项) 已发生漂移；本 hook 启动
 *   时拉一次 `GET /admin/ai/tool-aliases`，驱动 ToolsManagement bridge 等
 *   全部前端逻辑。
 *
 * 不可用时（未登录 / 服务挂）fallback 空 map —— 此时前端 ToolsManagement
 * 进入"无 alias 推断"模式，bridge 跳过；admin 看到的 secret/tool 关联仍
 * 来自后端 ToolConfig 直读，不会引入幻觉链接。
 */

import { useEffect, useState, useMemo } from 'react';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('useToolAliases');

export interface ToolAliasesResponse {
  /** alias (provider id) → registry id 完整映射 */
  aliasToRegistry: Record<string, string>;
  /**
   * 反向计算：≥2 个 provider 映射到的 registry id（N:1 父）。
   * Bridge 不从这些 parent 继承 secretKey 给 sibling provider，
   * 避免 Tavily 的 key 漂染到 Perplexity（Screenshot_5 类事故）。
   */
  multiProviderRegistryIds: string[];
}

const EMPTY: ToolAliasesResponse = {
  aliasToRegistry: {},
  multiProviderRegistryIds: [],
};

let inFlight: Promise<ToolAliasesResponse> | null = null;
let cached: ToolAliasesResponse | null = null;

async function fetchAliases(): Promise<ToolAliasesResponse> {
  if (cached) return cached;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const res = await fetch(`${config.apiUrl}/admin/ai/tool-aliases`, {
        headers: { ...getAuthHeader() },
      });
      if (!res.ok) {
        logger.warn(
          `[useToolAliases] fetch returned ${res.status}, falling back to empty map`
        );
        return EMPTY;
      }
      const json = await res.json();
      // backend 用 success/data 包装：{ success: true, data: {...} } 或裸返
      const data: ToolAliasesResponse = json?.data ?? json;
      if (
        !data ||
        typeof data.aliasToRegistry !== 'object' ||
        !Array.isArray(data.multiProviderRegistryIds)
      ) {
        logger.warn('[useToolAliases] response shape mismatch, fallback empty');
        return EMPTY;
      }
      cached = data;
      return data;
    } catch (err) {
      logger.warn(
        '[useToolAliases] fetch failed, fallback empty:',
        (err as Error).message
      );
      return EMPTY;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export function useToolAliases(): {
  aliasToRegistry: Record<string, string>;
  multiProviderRegistryIds: Set<string>;
  loading: boolean;
} {
  const [data, setData] = useState<ToolAliasesResponse>(cached ?? EMPTY);
  const [loading, setLoading] = useState(!cached);

  useEffect(() => {
    let alive = true;
    void fetchAliases().then((d) => {
      if (alive) {
        setData(d);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  // multiProviderRegistryIds 用 Set 暴露，bridge .has(id) 性能更好
  const set = useMemo(
    () => new Set<string>(data.multiProviderRegistryIds),
    [data.multiProviderRegistryIds]
  );

  return {
    aliasToRegistry: data.aliasToRegistry,
    multiProviderRegistryIds: set,
    loading,
  };
}

/**
 * 测试用：显式清空模块级缓存（Jest beforeEach / 切换 admin 账号场景）。
 */
export function __resetToolAliasesCacheForTesting(): void {
  cached = null;
  inFlight = null;
}

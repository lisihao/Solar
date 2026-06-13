/**
 * Key Health Hook
 * 获取密钥的健康状态
 */

import { useApiGet } from '../core';
import type { KeyHealthStatus } from '@/lib/types/admin';

interface UseKeyHealthOptions {
  /** 是否立即加载 */
  immediate?: boolean;
}

/**
 * 获取指定 Secret 的多密钥健康状态
 *
 * @param secretName - Secret 名称（如 'tavily-api-key'）
 * @param options - 配置选项
 * @returns 密钥健康状态列表和操作方法
 *
 * @example
 * ```tsx
 * const { keyHealth, isLoading, refetch } = useKeyHealth('tavily-api-key');
 * ```
 */
export function useKeyHealth(
  secretName: string | null,
  options: UseKeyHealthOptions = {}
) {
  const { immediate = true } = options;

  // 将 secretName 映射到 serviceId（后端 API 使用 serviceId）
  const serviceIdMap: Record<string, string> = {
    // SEARCH 分类
    'tavily-api-key': 'tavily',
    'tavily-search-api-key': 'tavily',
    tavily: 'tavily',
    'serper-api-key': 'serper',
    serper: 'serper',
    // EXTRACTION 分类
    'jina-api-key': 'jina',
    jina: 'jina',
    'firecrawl-api-key': 'firecrawl',
    firecrawl: 'firecrawl',
    'tavily-extraction-api-key': 'tavily-extract',
    'tavily-extract': 'tavily-extract',
    // YOUTUBE 分类
    'supadata-api-key': 'supadata',
    supadata: 'supadata',
    // TTS 分类
    'elevenlabs-api-key': 'elevenlabs',
    elevenlabs: 'elevenlabs',
  };

  const serviceId = secretName ? serviceIdMap[secretName] || null : null;

  // 只在 serviceId 存在时发起请求
  const apiPath = serviceId
    ? `/admin/ai/services/${encodeURIComponent(serviceId)}/key-health`
    : '/admin/ai/services/__placeholder__/key-health';

  const shouldFetch = immediate && !!serviceId;

  const {
    data: keyHealth,
    loading: isLoading,
    error,
    execute: refetch,
  } = useApiGet<KeyHealthStatus[]>(apiPath, {
    immediate: shouldFetch,
  });

  // 计算健康统计
  const stats = keyHealth
    ? {
        total: keyHealth.length,
        healthy: keyHealth.filter((k) => k.isHealthy).length,
        unhealthy: keyHealth.filter((k) => !k.isHealthy).length,
      }
    : null;

  return {
    /** 密钥健康状态列表 */
    keyHealth: keyHealth ?? [],
    /** 健康统计 */
    stats,
    /** 是否正在加载 */
    isLoading: shouldFetch ? isLoading : false,
    /** 错误信息 */
    error: shouldFetch ? error : null,
    /** 刷新数据 - 仅当 serviceId 有效时才执行 */
    refetch: serviceId ? refetch : () => Promise.resolve(undefined),
  };
}

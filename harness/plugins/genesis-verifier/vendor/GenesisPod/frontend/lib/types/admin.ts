/**
 * Admin Types
 * 管理后台相关类型定义
 */

/**
 * API Key 健康状态
 * 用于显示多 Key 配置的健康状况
 */
export interface KeyHealthStatus {
  /** 密钥序号 (0-indexed) */
  index: number;
  /** 脱敏显示的密钥 (如 tvly-abcd****xyz) */
  maskedKey: string;
  /** 是否健康可用 */
  isHealthy: boolean;
  /** 最近错误码 (如 HTTP 429) */
  lastError?: string;
  /** 冷却结束时间 (ISO 格式) */
  cooldownUntil?: string;
}

/**
 * 支持多密钥配置的 Secret 名称
 * 按具体服务判断，而不是整个分类（如 TTS 中只有 ElevenLabs 需要，Google TTS 配额充足）
 */
export const MULTI_KEY_SECRETS = [
  // SEARCH 分类 - 全部需要
  'tavily-search-api-key',
  'tavily-api-key',
  'serper-api-key',
  // EXTRACTION 分类 - 全部需要
  'jina-api-key',
  'firecrawl-api-key',
  'tavily-extraction-api-key',
  // YOUTUBE 分类
  'supadata-api-key',
  // TTS 分类 - 只有 ElevenLabs 需要（Google TTS 配额充足）
  'elevenlabs-api-key',
] as const;

export type MultiKeySecretName = (typeof MULTI_KEY_SECRETS)[number];

/**
 * 判断 Secret 是否支持多密钥配置
 */
export function isMultiKeySecret(secretName: string): boolean {
  return (MULTI_KEY_SECRETS as readonly string[]).includes(secretName);
}

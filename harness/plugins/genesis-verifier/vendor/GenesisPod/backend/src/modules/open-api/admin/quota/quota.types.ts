/**
 * Provider Quota Types
 * API 配额监控的类型定义
 */

/**
 * 配额类型
 */
export enum QuotaType {
  TOKENS = "tokens",
  REQUESTS = "requests",
  CREDITS = "credits",
  DOLLARS = "dollars",
}

/**
 * 配额单位
 */
export enum QuotaUnit {
  TOKENS = "tokens",
  REQUESTS = "requests",
  CREDITS = "credits",
  USD = "USD",
}

/**
 * 统计周期
 */
export enum QuotaPeriod {
  DAILY = "daily",
  MONTHLY = "monthly",
  UNLIMITED = "unlimited",
}

/**
 * 配额状态
 */
export enum QuotaStatus {
  NORMAL = "normal", // 正常 (< 60%)
  WARNING = "warning", // 警告 (60-80%)
  CRITICAL = "critical", // 危险 (>= 80%)
  UNAVAILABLE = "unavailable", // 不可用（无法查询）
  ERROR = "error", // 错误
}

/**
 * 数据来源
 */
export enum QuotaDataSource {
  API = "api", // 通过 API 获取
  ESTIMATED = "estimated", // 本地估算
  MANUAL = "manual", // 手动配置
  UNAVAILABLE = "unavailable", // 不可获取
}

/**
 * Provider 配额信息
 */
export interface ProviderQuota {
  // 基本信息
  provider: string; // Provider 标识（openai, anthropic, google 等）
  providerDisplayName: string; // 显示名称
  providerIcon: string; // 图标 URL

  // 配额数据
  quotaType: QuotaType; // 配额类型
  usage: number; // 已使用量
  limit: number | null; // 配额限制（null 表示无限制或不可查）
  remaining: number | null; // 剩余量
  usagePercentage: number | null; // 使用率百分比

  // 单位和周期
  unit: QuotaUnit; // 单位类型
  period: QuotaPeriod; // 统计周期

  // 状态
  status: QuotaStatus; // 状态
  statusMessage: string; // 状态消息

  // 元数据
  lastUpdated: Date; // 最后更新时间
  dataSource: QuotaDataSource; // 数据来源
  consoleUrl: string; // 官方控制台链接
}

/**
 * Provider 配置信息（用于查询配额）
 */
export interface ProviderConfig {
  provider: string;
  apiKey: string;
  organizationId?: string;
}

/**
 * 配额查询响应
 */
export interface QuotaFetchResult {
  success: boolean;
  quota?: Partial<ProviderQuota>;
  error?: string;
  rawData?: unknown;
}

/**
 * API 响应结构
 */
export interface GetProviderQuotasResponse {
  success: boolean;
  data: {
    quotas: ProviderQuota[];
    lastGlobalUpdate: Date | null;
  };
}

export interface RefreshQuotasRequest {
  provider?: string; // 不传则刷新全部
}

export interface RefreshQuotasResponse {
  success: boolean;
  message: string;
  data?: ProviderQuota | ProviderQuota[];
}

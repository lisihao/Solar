/**
 * Mission Configuration Constants
 *
 * 任务执行相关的配置常量
 * 从 team-mission.service.ts 提取，便于统一管理和调整
 */

/**
 * 重试配置
 */
export const RETRY_CONFIG = {
  /** 最大重试次数 */
  maxRetries: 3,
  /** 初始延迟（毫秒） */
  initialDelayMs: 1000,
  /** 最大延迟（毫秒） */
  maxDelayMs: 10000,
  /** 退避系数（指数退避） */
  backoffMultiplier: 2,

  /**
   * 可重试的错误模式（临时性错误）
   * ★ 注意：Rate Limit 错误已移至 nonRetryablePatterns
   * 因为重试只会让限速情况更糟，应该直接走 CircuitBreaker 切换 Agent
   */
  retryablePatterns: [
    /timeout/i,
    /timed?\s*out/i,
    /5\d{2}/, // 5xx 服务器错误（非 429）
    /ECONNRESET/i,
    /ETIMEDOUT/i,
    /ENOTFOUND/i,
    /network/i,
    /socket hang up/i,
    /connection.*refused/i,
    /temporarily unavailable/i,
    /service unavailable/i,
    /overloaded/i,
  ] as RegExp[],

  /**
   * 不可重试的错误模式（永久性错误 + 限速错误）
   * ★ Rate Limit 错误不应重试，应该立即切换 Agent
   */
  nonRetryablePatterns: [
    // Rate Limit - 需要立即停止并切换 Agent
    /rate.?limit/i,
    /too many requests/i,
    /429/,
    /quota/i,
    // 永久性错误
    /context.*(too large|overflow|exceed)/i,
    /token.*(limit|exceed|max)/i,
    /invalid.*(request|api.?key|model)/i,
    /authentication/i,
    /authorization/i,
    /forbidden/i,
    /not found/i,
    /model.*not.*available/i,
    /content.*policy/i,
    /403/,
    /401/,
    /404/,
  ] as RegExp[],
} as const;

/**
 * Agent 切换配置
 */
export const AGENT_SWITCH_CONFIG = {
  /** 允许切换的最大次数 */
  maxSwitches: 2,
  /** 是否允许 Leader 作为最后备选 */
  allowLeaderFallback: true,
  /** 任务负载权重（优先选择负载低的 Agent） */
  loadBalancingEnabled: true,
} as const;

/**
 * 任务执行超时配置
 */
export const TASK_TIMEOUT_CONFIG = {
  /** Mission 级别卡住检测超时（10 分钟） - 用于 retryMission 判断整体任务是否卡住 */
  missionStuckTimeoutMs: 10 * 60 * 1000,
  /** Task 级别卡住检测超时（5 分钟） - 用于 handleLeaderMentionCommand 判断单个任务是否卡住 */
  taskStuckTimeoutMs: 5 * 60 * 1000,
  /** 服务重启恢复超时（30 分钟） - 用于 onModuleInit 恢复卡住的任务 */
  recoveryTimeoutMs: 30 * 60 * 1000,
  /** 依赖松弛超时（30 分钟） */
  dependencyRelaxTimeoutMs: 30 * 60 * 1000,
  /** 强制完成阈值（85%） - 达到此完成率时可强制完成剩余任务 */
  forceCompleteThreshold: 0.85,
} as const;

/**
 * Leader 审核配置
 */
export const LEADER_REVIEW_CONFIG = {
  /** 默认最大修改次数 */
  defaultMaxRevisions: 3,
  /** 摘要生成阈值（字符数） */
  summaryThreshold: 3000,
  /** 质量预警阈值（字符数） */
  qualityWarningMinLength: 100,
} as const;

/**
 * 并发控制配置
 */
export const CONCURRENCY_CONFIG = {
  /** AI 调用并发限制 */
  aiConcurrencyLimit: 3,
  /** 消息发送并发限制 */
  messageConcurrencyLimit: 5,
} as const;

// 导出类型定义
export type RetryConfig = typeof RETRY_CONFIG;
export type AgentSwitchConfig = typeof AGENT_SWITCH_CONFIG;
export type TaskTimeoutConfig = typeof TASK_TIMEOUT_CONFIG;
export type LeaderReviewConfig = typeof LEADER_REVIEW_CONFIG;
export type ConcurrencyConfig = typeof CONCURRENCY_CONFIG;

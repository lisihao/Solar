/**
 * Intent Detection Types — engine 自有
 *
 * 2026-05-01 (PR-X-L2): 从 ai-harness/runner/executor/interfaces.ts 搬到
 * engine（intent detection 是 L2 LLM 能力，不是 L2.5 runtime concern）。
 * harness/facade 通过 re-export 保持 ai-app 调用向后兼容。
 */

/** 用户意图类型 */
export enum UserIntent {
  /** 发起新会话（需要隔离历史） */
  START_NEW_SESSION = "START_NEW_SESSION",
  /** 总结 */
  SUMMARIZE = "SUMMARIZE",
  /** 生成内容 */
  GENERATE = "GENERATE",
  /** 分析 */
  ANALYZE = "ANALYZE",
  /** 继续/追问 */
  CONTINUE = "CONTINUE",
  /** 普通对话 */
  GENERAL_CHAT = "GENERAL_CHAT",
}

/** 上下文策略 */
export enum ContextStrategy {
  /** 完全隔离，不使用历史 */
  ISOLATED = "ISOLATED",
  /** 引用最近内容 */
  REFERENCE_RECENT = "REFERENCE_RECENT",
  /** 标准上下文 */
  STANDARD = "STANDARD",
  /** 相关性检索 */
  RELEVANCE_BASED = "RELEVANCE_BASED",
}

/** 意图检测配置 */
export interface IntentDetectionConfig {
  newSessionKeywords?: string[];
  summarizeKeywords?: string[];
  generateKeywords?: string[];
  analyzeKeywords?: string[];
  continueKeywords?: string[];
  referenceKeywords?: string[];
  customRules?: Array<{
    intent: UserIntent;
    condition: (content: string, metadata?: Record<string, unknown>) => boolean;
  }>;
}

/** 意图检测结果 */
export interface IntentDetectionResult {
  intent: UserIntent;
  strategy: ContextStrategy;
  confidence: number;
  matchedKeywords?: string[];
}

/** 意图检测服务接口 */
export interface IIntentDetectionService {
  detectIntent(
    content: string,
    metadata?: Record<string, unknown>,
  ): IntentDetectionResult;
  selectStrategy(intent: UserIntent): ContextStrategy;
  updateConfig(config: Partial<IntentDetectionConfig>): void;
}

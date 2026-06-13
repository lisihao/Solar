/**
 * 滑动窗口上下文管理接口
 * Sliding Window Context Interfaces
 */

/**
 * 任务摘要
 */
export interface TaskSummary {
  /** 任务 ID */
  taskId: string;
  /** 任务标题 */
  title: string;
  /** 摘要内容 */
  summary: string;
  /** 关键词 */
  keywords: string[];
  /** 字数 */
  wordCount: number;
  /** 完成时间 */
  completedAt: Date;
  /** 质量分数（可选） */
  qualityScore?: number;
}

/**
 * 相关历史片段
 */
export interface RelevantHistoryChunk {
  /** 来源任务 ID */
  sourceTaskId: string;
  /** 来源任务标题 */
  sourceTaskTitle: string;
  /** 内容片段 */
  content: string;
  /** 相关性分数 (0-1) */
  relevanceScore: number;
  /** 匹配的关键词 */
  matchedKeywords?: string[];
}

/**
 * Token 使用统计
 */
export interface TokenUsage {
  /** 全局摘要 token 数 */
  globalSummary: number;
  /** 最近任务摘要 token 数 */
  recentSummaries: number;
  /** 当前任务 token 数 */
  currentTask: number;
  /** 相关历史 token 数 */
  relevantHistory: number;
  /** 总计 token 数 */
  total: number;
  /** 上限 */
  limit: number;
  /** 使用率 */
  utilizationRate: number;
}

/**
 * 工作记忆上下文
 */
export interface WorkingMemoryContext {
  /** 项目 ID */
  projectId: string;

  /** 当前任务 ID */
  currentTaskId: string;

  /** 全局摘要 */
  globalSummary: string;

  /** 最近完成的任务摘要 */
  recentTaskSummaries: TaskSummary[];

  /** 当前任务完整内容（待审核） */
  currentTaskContent: string;

  /** 相关历史检索结果 */
  relevantHistory: RelevantHistoryChunk[];

  /** Token 使用统计 */
  tokenUsage: TokenUsage;

  /** 上下文构建时间 */
  builtAt: Date;
}

/**
 * 窗口配置
 */
export interface SlidingWindowConfig {
  /** 最大总 token 数 */
  maxTotalTokens: number;

  /** 全局摘要最大 token 数 */
  maxGlobalSummaryTokens: number;

  /** 最近任务摘要最大 token 数 */
  maxRecentSummaryTokens: number;

  /** 当前任务最大 token 数 */
  maxCurrentTaskTokens: number;

  /** 相关历史最大 token 数 */
  maxRelevantHistoryTokens: number;

  /** 预留缓冲 token 数 */
  reservedBufferTokens: number;

  /** 保留最近 N 个任务摘要 */
  recentTaskCount: number;

  /** 检索相关历史数量 */
  relevantChunkCount: number;

  /** 每 N 个任务更新一次全局摘要 */
  globalSummaryUpdateInterval: number;

  /** 相关性阈值 (0-1) */
  relevanceThreshold: number;
}

/**
 * 默认窗口配置
 */
export const DEFAULT_SLIDING_WINDOW_CONFIG: SlidingWindowConfig = {
  maxTotalTokens: 8000,
  maxGlobalSummaryTokens: 500,
  maxRecentSummaryTokens: 1500,
  maxCurrentTaskTokens: 4000,
  maxRelevantHistoryTokens: 1500,
  reservedBufferTokens: 500,
  recentTaskCount: 5,
  relevantChunkCount: 3,
  globalSummaryUpdateInterval: 10,
  relevanceThreshold: 0.6,
};

/**
 * 项目上下文存储
 */
export interface ProjectContextStore {
  /** 项目 ID */
  projectId: string;

  /** 全局摘要 */
  globalSummary: string;

  /** 全局摘要最后更新时间 */
  globalSummaryUpdatedAt: Date;

  /** 已完成任务数 */
  completedTaskCount: number;

  /** 最近任务摘要环形缓冲 */
  recentSummaries: TaskSummary[];

  /** 总字数 */
  totalWordCount: number;

  /** 创建时间 */
  createdAt: Date;

  /** 最后活动时间 */
  lastActivityAt: Date;
}

/**
 * 滑动操作结果
 */
export interface SlideResult {
  /** 是否成功 */
  success: boolean;

  /** 新的全局摘要（如果更新了） */
  newGlobalSummary?: string;

  /** 被移出窗口的任务摘要 */
  evictedSummaries: TaskSummary[];

  /** 当前窗口状态 */
  windowState: {
    recentSummaryCount: number;
    totalCompletedTasks: number;
    globalSummaryAge: number; // 距上次更新的任务数
  };
}

/**
 * 摘要生成选项
 */
export interface SummaryGenerationOptions {
  /** 摘要最大长度（字符） */
  maxLength?: number;
  /** 是否提取关键词 */
  extractKeywords?: boolean;
  /** 关键词数量 */
  keywordCount?: number;
  /** 摘要风格 */
  style?: "brief" | "detailed" | "structured";
  /** 关注点（用于引导摘要方向） */
  focusAreas?: string[];
}

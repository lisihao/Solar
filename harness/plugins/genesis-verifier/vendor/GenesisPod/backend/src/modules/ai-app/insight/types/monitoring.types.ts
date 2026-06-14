/**
 * Monitoring Types
 *
 * Type definitions for research monitoring services:
 * - Agent Activity
 * - Mission Health
 * - Checkpoint/Resume
 */

import type { ResearchMissionStatus } from "@prisma/client";

// ==================== Agent Activity ====================

/**
 * 搜索结果记录
 */
export interface SearchResultsRecord {
  total: number; // 搜索到的总数
  filtered: number; // 过滤后的数量
  searchTool?: string; // 使用的搜索工具 (tavily, serper, google, bing, etc.)
  query?: string; // 搜索查询
  searchedAt?: string; // 搜索时间 (ISO string)
  freshnessInfo?: {
    newestDate?: string; // 最新结果的日期
    oldestDate?: string; // 最旧结果的日期
    avgAgeInDays?: number; // 平均结果年龄（天）
  };
  // ★ 知识库搜索记录（用于溯源）
  knowledgeBaseInfo?: {
    enabled: boolean; // 是否启用了知识库
    knowledgeBaseIds?: string[]; // 使用的知识库ID列表
    matchedCount: number; // 匹配到的结果数
    avgSimilarity?: number; // 平均相似度
  };
  sources: Array<{
    title: string;
    url: string;
    domain?: string;
    sourceType: string;
    credibilityScore?: number; // 可信度评分 (0-100)
    relevanceScore?: number; // 相关度评分 (0-100)
    publishedDate?: string; // 发布日期
    // ★ 知识库来源标记
    isKnowledgeBase?: boolean; // 是否来自知识库
    similarity?: number; // 相似度（知识库结果）
    documentId?: string; // 文档ID（知识库结果）
  }>;
}

/**
 * 写作进度记录
 */
export interface WritingProgressRecord {
  sections: Array<{
    id: string;
    title: string;
    status: "pending" | "writing" | "reviewing" | "completed";
    revisionCount?: number;
    wordCount?: number;
  }>;
  current?: string; // 当前正在写的章节ID
  totalWordCount: number;
  completedSections: number;
  totalSections: number;
}

/**
 * 按维度分组的活动
 */
export interface DimensionActivities {
  dimensionId: string;
  dimensionName: string;
  activities: AgentActivityWithTiming[];
  totalDuration: number; // 总耗时（毫秒）
}

/**
 * 带时间信息的活动记录
 */
export interface AgentActivityWithTiming {
  id: string;
  agentId: string;
  agentName: string;
  agentRole: string;
  activityType: string;
  phase?: string;
  content: string;
  progress: number;
  thinkingPhase?: string;
  thinkingContent?: string;
  searchResults?: SearchResultsRecord;
  writingProgress?: WritingProgressRecord;
  actionTaken?: string;
  actionResult?: Record<string, unknown>;
  phaseStartedAt?: Date;
  phaseEndedAt?: Date;
  durationMs?: number;
  createdAt: Date;
}

// ==================== Mission Health ====================

export interface HealthCheckResult {
  checkedAt: Date;
  totalMissions: number;
  stuckMissions: number;
  recoveredMissions: number;
  failedMissions: number;
  details: MissionHealthDetail[];
}

export interface MissionHealthDetail {
  missionId: string;
  topicId: string;
  status: ResearchMissionStatus;
  startedAt: Date | null;
  lastActivityAt: Date | null;
  stuckDurationMs: number;
  action: "none" | "marked_failed" | "recovery_attempted";
  reason?: string;
}

export interface MissionHealthStatus {
  missionId: string;
  isHealthy: boolean;
  status: ResearchMissionStatus;
  progress: number;
  startedAt: Date | null;
  lastActivityAt: Date | null;
  stuckDurationMs: number;
  estimatedRecoveryPossible: boolean;
  issues: string[];
}

/**
 * ★ Phase 5: 自动恢复结果
 */
export interface RecoveryResult {
  checkedAt: Date;
  interruptedMissions: number;
  recoveredMissions: number;
  failedRecoveries: number;
  details: RecoveryDetail[];
}

export interface RecoveryDetail {
  missionId: string;
  topicId: string;
  action: "recovered" | "failed" | "skipped";
  reason: string;
}

// ==================== Checkpoint ====================

/**
 * Checkpoint data structure for research missions
 */
export interface ResearchCheckpoint {
  /** Mission ID */
  missionId: string;
  /** Topic ID */
  topicId: string;
  /** Completed task IDs */
  completedTasks: string[];
  /** Completed dimension IDs */
  completedDimensions: string[];
  /** Current executing task ID */
  currentTask: string | null;
  /** Current dimension ID being researched */
  currentDimensionId: string | null;
  /** Execution context (any intermediate state, including V5 fields) */
  context: Record<string, unknown>;
  /** Timestamp when checkpoint was saved */
  savedAt: Date;
  /** V5: Current phase for crash recovery */
  currentPhase?:
    | "L1_design"
    | "L2_knowledge"
    | "L3_analysis"
    | "L4_writing"
    | "L5_editing";
  /** V5: Research depth for this mission */
  researchDepth?: import("./research-depth.types").ResearchDepth;
}

/**
 * Resumable mission info for display
 */
export interface ResumableMissionInfo {
  missionId: string;
  topicId: string;
  topicName: string;
  status: ResearchMissionStatus;
  progress: number;
  completedTasks: number;
  totalTasks: number;
  lastActivityAt: Date;
  canResume: boolean;
  resumeReason: string;
}

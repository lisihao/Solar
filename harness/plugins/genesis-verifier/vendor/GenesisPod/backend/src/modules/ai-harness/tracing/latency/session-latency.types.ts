/**
 * Session Latency Tracking Types
 *
 * 会话级端到端时延跟踪的核心类型定义。
 *
 * 四级结构（业界规范）：
 *   Session → Step → Action
 *
 * - Session: 一次完整的端到端执行（如一次 Topic Insights 研究）
 * - Step: 一个业务语义单元（如 "搜索数据"、"章节写作"、"报告合成"）
 *         一个 Step 可包含 0~N 个 Action
 * - Action: 一次原子操作（LLM 调用或工具调用）
 *
 * 设计为通用基础能力，可被任何 AI App 模块实例化使用。
 */

// ==================== Core Types ====================

/** 会话类型标识 */
export type LatencySessionType =
  | "topic_insights_refresh"
  | "team_execution"
  | "research_mission"
  | "ai_ask"
  | "ai_writing"
  | string;

/** 会话状态 */
export type LatencySessionStatus = "running" | "completed" | "failed";

/**
 * 时延会话 — 一次完整的端到端执行
 */
export interface LatencySession {
  id: string;
  type: LatencySessionType;
  status: LatencySessionStatus;
  userId?: string;
  /** 业务实体 ID（topicId、teamId 等） */
  entityId?: string;
  metadata: Record<string, unknown>;
  startTime: number; // Date.now() ms
  endTime?: number;
  steps: LatencyStep[];
}

// ==================== Step ====================

/**
 * Step — 一个业务语义单元
 *
 * 例如: "搜索数据"、"大纲规划"、"章节1写作"、"报告合成"
 * 一个 Step 内部可包含多次 LLM 调用和工具调用
 */
export interface LatencyStep {
  id: string;
  /** Step 名称（如 "TTLT定义与指标边界/搜索数据"） */
  name: string;
  /** 父 Step ID（支持嵌套） */
  parentStepId?: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  /** 是否并行 Step */
  parallel?: boolean;
  /** 并行数量 */
  parallelCount?: number;
  metadata?: Record<string, unknown>;
  /** Step 内的原子操作列表 */
  actions: LatencyAction[];
}

// ==================== Action ====================

/** Action 类型 */
export type ActionType = "llm_call" | "tool_call";

/**
 * Action — 一次原子操作（LLM 调用或工具调用）
 */
export interface LatencyAction {
  id: string;
  stepId: string;
  type: ActionType;
  /** 操作名称（LLM: operationName 如 "章节写作"; Tool: 工具名如 "web_search"） */
  name: string;
  /** 模型名（LLM 调用）或工具名（工具调用） */
  model: string;
  provider: string;
  streaming: boolean;
  /** Time To First Token (ms) — 仅流式 LLM 调用 */
  ttftMs?: number;
  /** Time To Last Token (ms) */
  ttltMs: number;
  /** 端到端总耗时 (ms) */
  totalDurationMs: number;
  /** 输入 Token 数 */
  inputTokens: number;
  /** 输出 Token 数 */
  outputTokens: number;
  /** 输出吞吐量 (tokens/sec) */
  tokenThroughputPerSec: number;
  timestamp: number;
}

// ==================== Summary ====================

/** Step 摘要 */
export interface StepSummary {
  name: string;
  durationMs: number;
  percentOfTotal: number;
  /** 该 Step 内的 Action 数量 */
  actionCount: number;
  /** 该 Step 内 LLM 调用的平均 TTLT (ms) */
  avgTtltMs?: number;
}

/** 时延百分位统计 */
export interface LatencyPercentileStats {
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
}

/** @deprecated Use LatencyPercentileStats */
export type TTFTStats = LatencyPercentileStats;

/**
 * 会话摘要 — endSession() 时自动计算
 */
export interface LatencySessionSummary {
  sessionId: string;
  type: LatencySessionType;
  status: LatencySessionStatus;
  totalDurationMs: number;
  /** Step 耗时分解 */
  steps: StepSummary[];
  /** LLM 调用总数 */
  llmCallCount: number;
  /** LLM 总耗时 (ms) */
  llmTotalTimeMs: number;
  /** LLM 时间占总时间百分比 */
  llmTimePercent: number;
  /** 非 LLM 开销 (ms) */
  overheadMs: number;
  /** TTFT 统计（仅流式调用） */
  ttft?: LatencyPercentileStats;
  /** TTLT 统计（所有 LLM 调用） */
  ttlt?: LatencyPercentileStats;
  /** Token 统计 */
  totalInputTokens: number;
  totalOutputTokens: number;
  /** 平均输出吞吐量 (tokens/sec) */
  avgTokenThroughput: number;
}

// ==================== Input Types ====================

/** 创建会话参数 */
export interface StartSessionInput {
  type: LatencySessionType;
  userId?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

/** 开始 Step 参数 */
export interface StartStepInput {
  name: string;
  parentStepId?: string;
  parallel?: boolean;
  parallelCount?: number;
  metadata?: Record<string, unknown>;
}

/** 记录 Action（LLM 调用）参数 */
export interface RecordActionInput {
  stepId?: string;
  /** 操作名称（如 "章节写作"、"web_search"） */
  name: string;
  type?: ActionType;
  model: string;
  provider: string;
  streaming: boolean;
  ttftMs?: number;
  ttltMs: number;
  totalDurationMs: number;
  inputTokens: number;
  outputTokens: number;
}

/** 查询会话列表参数 */
export interface ListSessionsFilter {
  type?: LatencySessionType;
  userId?: string;
  entityId?: string;
  status?: LatencySessionStatus;
  since?: number;
  limit?: number;
}

// ==================== Legacy compatibility ====================

/** @deprecated Use LatencyStep */
export type LatencyPhase = LatencyStep;
/** @deprecated Use StartStepInput */
export type StartPhaseInput = StartStepInput;
/** @deprecated Use RecordActionInput */
export type RecordLLMLatencyInput = RecordActionInput;
/** @deprecated Use LatencyAction */
export type LLMLatencyRecord = LatencyAction;
/** @deprecated Use StepSummary */
export type PhaseDurationSummary = StepSummary;
/** @deprecated Use LatencyCheckpoint */
export interface LatencyCheckpoint {
  name: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

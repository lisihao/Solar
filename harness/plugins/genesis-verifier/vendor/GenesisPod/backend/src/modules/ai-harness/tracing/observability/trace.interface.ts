/**
 * AI Engine Trace Interfaces
 * 用于可视化 AI 执行链路的 trace 和 span 定义
 */

/**
 * Trace 类型
 */
export type TraceType =
  | "research" // 深度研究会话
  | "research_mission" // 研究任务
  | "team_execution" // 团队协作执行
  | "tool_call" // 工具调用
  | "mcp_request" // MCP 请求
  | "a2a_task"; // Agent-to-Agent 任务

/**
 * Span 类型
 */
export type SpanType =
  | "llm_call" // LLM 调用
  | "tool_execution" // 工具执行
  | "search" // 搜索
  | "analysis" // 分析
  | "synthesis" // 综合
  | "review" // 审查
  | "planning" // 规划
  | "phase" // 研究阶段（ideation / execution / findings / synthesis）
  | "evaluation"; // 评估（replanning等）

/**
 * 执行状态
 */
export type ExecutionStatus = "running" | "success" | "error";

/**
 * Span 数据
 */
export interface SpanData {
  /** Span ID */
  id: string;
  /** 所属 Trace ID */
  traceId: string;
  /** 父 Span ID（可选，用于嵌套） */
  parentSpanId?: string;
  /** Span 名称 */
  name: string;
  /** Span 类型 */
  type: SpanType;
  /** 执行状态 */
  status: ExecutionStatus;
  /** 开始时间 */
  startTime: Date;
  /** 结束时间 */
  endTime?: Date;
  /** 执行时长（毫秒） */
  duration?: number;
  /** 元数据（如模型、token、工具参数等） */
  metadata: Record<string, unknown>;
  /** 输出结果 */
  output?: unknown;
  /** 错误信息 */
  error?: string;
}

/**
 * Trace 数据
 */
export interface TraceData {
  /** Trace ID */
  id: string;
  /** Trace 名称 */
  name: string;
  /** Trace 类型 */
  type: TraceType;
  /** 执行状态 */
  status: ExecutionStatus;
  /** 开始时间 */
  startTime: Date;
  /** 结束时间 */
  endTime?: Date;
  /** 总执行时长（毫秒） */
  duration?: number;
  /** 元数据（如用户、任务ID等） */
  metadata: Record<string, unknown>;
  /** 所有 Span */
  spans: SpanData[];
}

/**
 * Trace 摘要（用于列表）
 */
export interface TraceSummary {
  /** Trace ID */
  id: string;
  /** Trace 名称 */
  name: string;
  /** Trace 类型 */
  type: TraceType;
  /** 执行状态 */
  status: ExecutionStatus;
  /** 开始时间 */
  startTime: Date;
  /** 总执行时长（毫秒） */
  duration?: number;
  /** Span 数量 */
  spanCount: number;
}

/**
 * 创建 Trace 的输入
 */
export interface CreateTraceInput {
  /** Trace 名称 */
  name: string;
  /** Trace 类型 */
  type: TraceType;
  /** 父 Trace ID（可选，用于嵌套 trace） */
  parentId?: string;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 创建 Span 的输入
 */
export interface CreateSpanInput {
  /** Span 名称 */
  name: string;
  /** Span 类型 */
  type: SpanType;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 结束 Span 的输入
 */
export interface EndSpanInput {
  /** 执行状态 */
  status: "success" | "error";
  /** 执行时长（毫秒，可选，未提供则自动计算） */
  duration?: number;
  /** 输出结果 */
  output?: unknown;
  /** 错误信息 */
  error?: string;
}

/**
 * 结束 Trace 的输入
 */
export interface EndTraceInput {
  /** 执行状态 */
  status: "success" | "error";
  /** 总执行时长（毫秒，可选，未提供则自动计算） */
  totalDuration?: number;
}

/**
 * 列出 Trace 的选项
 */
export interface ListTracesOptions {
  /** 按类型筛选 */
  type?: TraceType;
  /** 返回数量限制 */
  limit?: number;
}

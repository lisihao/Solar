/**
 * Legacy ReAct-mode Agent abstractions (migrated from ai-harness/agents/abstractions)
 *
 * @deprecated Use IAgent / IAgentTask from agent.interface.ts (harness runtime model).
 * These types support the legacy BaseAgent / ReactiveAgent / PlanAgent hierarchy.
 * New agents should implement IAgent via HarnessedAgent / SpecBasedAgent.
 *
 * Migrated: PR-X5 (ai-harness/agents/abstractions → ai-harness/agents/abstractions)
 */

import { JsonObject } from "@/modules/ai-engine/facade/index";
import { ExecutionMode } from "@/modules/ai-harness/agents/abstractions/agent.types";
import {
  AgentId,
  ToolId,
  SkillId,
  AgentInput,
  UploadedFile,
  Artifact,
} from "@/modules/ai-harness/agents/abstractions/agent.types";
// v3 R0-A1-a: BUILTIN_AGENTS / BuiltinAgentId 已下推到各 ai-app *.constants.ts
// 与 ai-app/contracts/agent-catalog.ts（PlatformAgentId）

// ==================== 重导出核心类型 ====================
export type { AgentId, ToolId, SkillId, AgentInput, UploadedFile, Artifact };

// ==================== Agent 上下文 ====================

/**
 * Agent 上下文
 */
export interface AgentContext {
  /** 执行 ID */
  executionId: string;

  /** Agent ID */
  agentId: string;

  /** 用户 ID */
  userId?: string;

  /** 会话 ID */
  sessionId?: string;

  /** 执行模式 */
  mode?: ExecutionMode;

  /** 取消信号 */
  signal?: AbortSignal;

  /** 超时时间 */
  timeout?: number;

  /** 可用工具列表 */
  availableTools?: string[];

  /** 可用技能列表 */
  availableSkills?: string[];

  /** 可用 Agent 列表 */
  availableAgents?: string[];

  /** 共享状态 */
  sharedState?: JsonObject;

  /** 会话记忆 */
  memory?: AgentMemory;

  /** 元数据 */
  metadata?: JsonObject;

  /** 创建时间 */
  createdAt: Date;
}

/**
 * Agent 记忆接口
 */
export interface AgentMemory {
  /** 对话历史 */
  messages: AgentMessage[];

  /** 工作记忆 */
  workingMemory?: JsonObject;

  /** 长期记忆键值存储 */
  longTermMemory?: Record<string, unknown>;
}

/**
 * Agent 消息
 */
export interface AgentMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCallId?: string;
  timestamp?: Date;
}

// ==================== Agent 输出 ====================

/**
 * Agent 输出
 */
export interface AgentOutput {
  /** 回复消息 */
  message: string;

  /** 生成的制品 */
  artifacts?: AgentArtifact[];

  /** 工具调用记录 */
  toolCalls?: ToolCallRecord[];

  /** 技能调用记录 */
  skillCalls?: SkillCallRecord[];

  /** 元数据 */
  metadata?: JsonObject;
}

/**
 * Agent 制品
 */
export interface AgentArtifact {
  id: string;
  type: string;
  name: string;
  content: unknown;
  mimeType?: string;
}

/**
 * 工具调用记录
 */
export interface ToolCallRecord {
  toolId: string;
  input: unknown;
  output: unknown;
  duration: number;
  success: boolean;
}

/**
 * 技能调用记录
 */
export interface SkillCallRecord {
  skillId: string;
  input: unknown;
  output: unknown;
  duration: number;
  success: boolean;
}

// ==================== Agent 结果 ====================

/**
 * Agent 结果
 */
export interface AgentResult<T = AgentOutput> {
  /** 是否成功 */
  success: boolean;

  /** 返回数据 */
  data?: T;

  /** 错误信息 */
  error?: AgentResultError;

  /** 执行元数据 */
  metadata: AgentResultMetadata;
}

/**
 * Agent 结果错误
 */
export interface AgentResultError {
  code: string;
  message: string;
  details?: JsonObject;
  retryable?: boolean;
}

/**
 * Agent 结果元数据
 */
export interface AgentResultMetadata {
  executionId: string;
  startTime: Date;
  endTime: Date;
  duration: number;
  tokensUsed?: number;
  toolsCalled?: string[];
  skillsCalled?: string[];
  iterationCount?: number;
}

// ==================== 执行计划（ReAct 模式） ====================

/**
 * 执行计划
 */
export interface ExecutionPlan {
  id: string;
  agentId: string;
  steps: ReActPlanStep[];
  estimatedDuration?: number;
  metadata?: JsonObject;
}

/**
 * 计划步骤（ReAct 模式）
 */
export interface ReActPlanStep {
  id: string;
  type: "tool" | "skill" | "agent" | "decision" | "wait" | "parallel";
  executor: string;
  input?: unknown;
  dependsOn?: string[];
  condition?: string;
  description?: string;
}

// ==================== Agent 事件（ReAct 模式） ====================

/**
 * Agent 事件类型
 */
export type AgentEventType =
  | "started"
  | "thinking"
  | "tool_call"
  | "tool_result"
  | "skill_call"
  | "skill_result"
  | "message"
  | "artifact"
  | "error"
  | "completed";

/**
 * Agent 事件（ReAct 模式）
 * 注意：Plan-Based 模式使用 core/types/agent.types 中的 AgentEvent
 */
export interface AgentEvent {
  type: AgentEventType;
  agentId: string;
  executionId: string;
  timestamp: Date;
  data?: unknown;
}

// ==================== Agent 能力 ====================

/**
 * Agent 能力
 */
export interface AgentCapability {
  id: string;
  name: string;
  description: string;
  category: string;
}

// ==================== Agent 接口 ====================

/**
 * Agent 接口（ReAct 模式）
 * 使用统一的 AgentInput
 */
export interface IAgent<TInput = AgentInput, TOutput = AgentOutput> {
  /** 唯一标识符 */
  readonly id: string;

  /** 名称 */
  readonly name: string;

  /** 描述 */
  readonly description: string;

  /** 支持的执行模式 */
  readonly supportedModes: ExecutionMode[];

  /** Agent 能力 */
  readonly capabilities: AgentCapability[];

  /** 依赖的工具 */
  readonly requiredTools?: string[];

  /** 依赖的技能 */
  readonly requiredSkills?: string[];

  /** 版本 */
  readonly version?: string;

  /** 标签 */
  readonly tags?: string[];

  /**
   * 执行 Agent
   */
  execute(input: TInput, context: AgentContext): Promise<AgentResult<TOutput>>;

  /**
   * 流式执行
   */
  executeStream?(
    input: TInput,
    context: AgentContext,
  ): AsyncGenerator<AgentEvent, AgentResult<TOutput>>;

  /**
   * 生成执行计划
   */
  plan?(input: TInput, context: AgentContext): Promise<ExecutionPlan>;

  /**
   * 验证输入
   */
  validateInput?(input: TInput): { valid: boolean; errors?: string[] };
}

/**
 * Agent 定义（用于注册）
 */
export interface AgentDefinition<TInput = AgentInput, TOutput = AgentOutput> {
  id: string;
  name: string;
  description: string;
  supportedModes: ExecutionMode[];
  capabilities: AgentCapability[];
  requiredTools?: string[];
  requiredSkills?: string[];
  version?: string;
  factory?: () => IAgent<TInput, TOutput>;
}

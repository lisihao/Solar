/**
 * AI Capability Resolver Types
 * AI 能力解析器类型定义
 */

import {
  FunctionDefinition,
  ToolCategory,
  CompactToolSummary,
} from "../../../ai-engine/tools/abstractions/tool.interface";
import { SkillLayer } from "../../../ai-engine/skills/abstractions/skill.interface";

/**
 * 能力使用日志
 */
export interface CapabilityUsageLog {
  /**
   * 能力类型
   */
  capabilityType: "tool" | "skill" | "mcp";

  /**
   * 能力 ID
   */
  capabilityId: string;

  /**
   * 用户 ID
   */
  userId?: string;

  /**
   * 团队 ID
   */
  teamId?: string;

  /**
   * Agent ID
   */
  agentId?: string;

  /**
   * 任务 ID
   */
  missionId?: string;

  /**
   * 是否成功
   */
  success: boolean;

  /**
   * 执行时长（毫秒）
   */
  duration?: number;

  /**
   * Token 使用量
   */
  tokensUsed?: number;

  /**
   * 错误码
   */
  errorCode?: string;

  /**
   * 输入数据（可选，用于审计）
   */
  input?: unknown;

  /**
   * 输出数据（可选，用于审计）
   */
  output?: unknown;
}

/**
 * 技能 Prompt 包
 */
export interface SkillPromptBundle {
  /**
   * 组装后的 System Prompt 内容
   */
  content: string;

  /**
   * 使用的 Skill IDs
   */
  usedSkills: string[];

  /**
   * 预估的 Token 消耗
   */
  estimatedTokens: number;

  /**
   * 是否被裁剪
   */
  wasTrimmed: boolean;

  /**
   * 被跳过的 Skills（因 Token 限制）
   */
  skippedSkills: string[];
}

/**
 * 能力总结
 */
export interface CapabilitySummary {
  /**
   * 工具列表
   */
  tools: ToolSummary[];

  /**
   * 技能列表
   */
  skills: SkillSummary[];

  /**
   * MCP 工具列表
   */
  mcpTools: MCPToolSummary[];
}

/**
 * 工具摘要
 */
export interface ToolSummary {
  /**
   * 工具 ID
   */
  id: string;

  /**
   * 名称
   */
  name: string;

  /**
   * 描述
   */
  description: string;

  /**
   * 类别
   */
  category: ToolCategory;

  /**
   * 是否启用
   */
  enabled: boolean;

  /**
   * Function Definition（用于 LLM Function Calling）
   */
  functionDefinition: FunctionDefinition;
}

/**
 * 技能摘要
 */
export interface SkillSummary {
  /**
   * 技能 ID
   */
  id: string;

  /**
   * 名称
   */
  name: string;

  /**
   * 描述
   */
  description: string;

  /**
   * 领域
   */
  domain: string;

  /**
   * 层次
   */
  layer: SkillLayer;

  /**
   * 是否启用
   */
  enabled: boolean;
}

/**
 * MCP 工具摘要
 */
export interface MCPToolSummary {
  /**
   * 服务器 ID
   */
  serverId: string;

  /**
   * 工具名称
   */
  toolName: string;

  /**
   * 描述
   */
  description?: string;
}

/**
 * K4: Skill Prompt 构建选项
 * 支持动态 Token 预算配置
 */
export interface SkillPromptOptions {
  /**
   * 最大 Token 预算（默认 4000）
   * 用于限制 Skill Prompts 的总 Token 消耗
   */
  maxTokenBudget?: number;

  /**
   * 是否包含元数据（默认 false）
   */
  includeMetadata?: boolean;

  /**
   * 优先技能 IDs（这些技能优先分配 Token）
   */
  prioritySkillIds?: string[];
}

/**
 * K4: Token 预算配置
 * 定义不同场景的 Token 预算
 */
export interface TokenBudgetConfig {
  /**
   * Skill Prompts 默认预算
   */
  skillPromptDefault: number;

  /**
   * Skill Prompts 最大预算
   */
  skillPromptMax: number;

  /**
   * Tool Definitions 默认预算
   */
  toolDefinitionDefault: number;

  /**
   * 系统消息预留预算
   */
  systemMessageReserved: number;
}

/**
 * 工具包（用于 Agent 运行时）
 * 类似于 SkillPromptBundle，用于管理工具列表和 Token 消耗
 */
export interface ToolBundle {
  /**
   * 精简工具摘要列表（默认）
   * 用于 LLM 工具选择，节省 Token
   */
  compactTools: CompactToolSummary[];

  /**
   * 完整工具定义列表（按需获取）
   * 仅在 LLM 决定调用某工具时获取
   */
  fullDefinitions?: FunctionDefinition[];

  /**
   * 使用的工具 IDs
   */
  usedTools: string[];

  /**
   * 预估的 Token 消耗
   */
  estimatedTokens: number;

  /**
   * 是否使用精简模式
   */
  isCompact: boolean;
}

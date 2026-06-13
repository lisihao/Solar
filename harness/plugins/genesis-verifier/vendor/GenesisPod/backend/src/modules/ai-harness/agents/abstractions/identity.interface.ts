/**
 * Agent Identity — Agent 的身份蓝图
 *
 * 组合 Role（做什么）+ Persona（怎么说话）+ Goal（为什么）+ Constraints（边界）
 * + Skills（激活的能力包）。身份是 Agent 的语义层，与运行时实例 IAgent 分离。
 */

export type WorkStyle = "initiative" | "structured" | "adaptive";

/** 简化的 Role 描述（Harness 级别） */
export interface IAgentRole {
  id: string;
  name: string;
  description: string;
  workStyle?: WorkStyle;
}

/** Persona 决定语气与输出风格 */
export interface IAgentPersona {
  tone?: "formal" | "casual" | "technical" | "empathetic";
  language?: string; // "zh-CN" / "en-US"
  style?: string; // 自由文本
}

/** Agent 的目标（由 App 层注入） */
export interface IAgentGoal {
  summary: string;
  successCriteria?: string[];
}

/** Agent 的约束（预算、长度、安全级别） */
export interface IAgentConstraints {
  maxTokens?: number;
  maxIterations?: number;
  maxWallTimeMs?: number;
  safetyLevel?: "strict" | "standard" | "permissive";
  /**
   * ★ 工具前置闸：为 true 时 agent 必须先成功调用一次真实工具才能 finalize。
   * researcher 等"先检索再产出"角色启用，杜绝 0 工具幻觉 finalize。默认 false。
   */
  requireToolBeforeFinalize?: boolean;
}

/** Agent 激活的 Skill id 列表（SKILL.md 系统） */
export type SkillRef = string;

/** Agent 白名单的 Tool id 列表 */
export type ToolRef = string;

/**
 * Agent Identity —— Agent 的静态蓝图。
 *
 * 注意：Identity 本身不持有运行时状态；运行时由 IAgent 承载。
 */
export interface IAgentIdentity {
  readonly role: IAgentRole;
  readonly persona?: IAgentPersona;
  readonly goal?: IAgentGoal;
  readonly constraints?: IAgentConstraints;
  readonly skills?: readonly SkillRef[];
  /**
   * 白名单：agent 执行期可调用的工具。未设置/空 = 允许全部已注册工具。
   */
  readonly tools?: readonly ToolRef[];
  /**
   * 黑名单：**绝对不能调用**的工具（即使出现在 tools 白名单中也不行）。
   * 用于 access matrix 强校验——如 Synthesizer 禁用 evidence-save 防越权。
   * ToolInvoker 在 invoke 前检查；命中抛 AgentAccessDeniedError。
   */
  readonly forbiddenTools?: readonly ToolRef[];
}

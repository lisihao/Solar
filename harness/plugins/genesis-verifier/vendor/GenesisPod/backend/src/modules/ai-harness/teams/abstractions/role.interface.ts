/**
 * AI Engine - Role Interface
 * 角色抽象接口定义
 */

import {
  ToolId,
  SkillId,
} from "@/modules/ai-harness/agents/abstractions/agent.types";

// ==================== Role ID ====================

export type RoleId = string;

// ==================== 预定义角色常量 ====================

// v3 R0-A1-d: 业务 leader 角色（research-lead / content-lead / tech-lead / slides-lead）
// 已下推到各 ai-app（research/teams/research-roles.config.ts、office/teams/office-roles.config.ts）。
// base layer 仅保留通用 SDK 角色（researcher/writer/reviewer/...），不再硬编码业务身份。
export const BUILTIN_ROLES = {
  // 协调角色（通用）
  MODERATOR: "moderator",

  // 执行角色（通用）
  RESEARCHER: "researcher",
  ANALYST: "analyst",
  WRITER: "writer",
  DESIGNER: "designer",
  RENDERER: "renderer",
  REVIEWER: "reviewer",
  ADVOCATE: "advocate",
} as const;

export type BuiltinRoleId = (typeof BUILTIN_ROLES)[keyof typeof BUILTIN_ROLES];

// ==================== 角色类型 ====================

export type RoleType = "leader" | "member";

// ==================== 工作风格 ====================

export interface WorkStyle {
  /** 思考深度 */
  thinkingDepth: "quick" | "standard" | "deep";

  /** 输出风格 */
  outputStyle: "concise" | "balanced" | "detailed";

  /** 协作倾向 */
  collaborationStyle: "independent" | "cooperative" | "directive";

  /** 风险偏好 */
  riskTolerance: "conservative" | "moderate" | "aggressive";
}

// ==================== 角色定义 ====================

/**
 * 角色定义
 */
export interface IRole {
  /** 角色 ID */
  readonly id: RoleId;

  /** 角色名称 */
  readonly name: string;

  /** 角色描述 */
  readonly description: string;

  /** 角色类型 */
  readonly type: RoleType;

  /** 角色图标 */
  readonly icon?: string;

  /** 核心技能（必须具备） */
  readonly coreSkills: SkillId[];

  /** 可选技能 */
  readonly optionalSkills: SkillId[];

  /** 核心工具（必须可用） */
  readonly coreTools: ToolId[];

  /** 可选工具 */
  readonly optionalTools: ToolId[];

  /** 职责范围 */
  readonly responsibilities: string[];

  /** 能力边界（不应该做的事） */
  readonly limitations: string[];

  /** 默认工作风格 */
  readonly defaultWorkStyle: WorkStyle;

  /** 系统提示词模板 */
  readonly systemPromptTemplate: string;

  /** 元数据 */
  readonly metadata?: Record<string, unknown>;
}

// ==================== 角色配置 ====================

/**
 * 角色配置（用于创建角色）
 */
export interface RoleConfig {
  id: RoleId;
  name: string;
  description: string;
  type: RoleType;
  icon?: string;
  coreSkills: SkillId[];
  optionalSkills?: SkillId[];
  coreTools: ToolId[];
  optionalTools?: ToolId[];
  responsibilities: string[];
  limitations?: string[];
  defaultWorkStyle?: Partial<WorkStyle>;
  systemPromptTemplate: string;
  metadata?: Record<string, unknown>;
}

// ==================== 预定义角色配置 ====================

/**
 * 默认工作风格
 */
export const DEFAULT_WORK_STYLE: WorkStyle = {
  thinkingDepth: "standard",
  outputStyle: "balanced",
  collaborationStyle: "cooperative",
  riskTolerance: "moderate",
};

/**
 * Leader 工作风格
 */
export const LEADER_WORK_STYLE: WorkStyle = {
  thinkingDepth: "deep",
  outputStyle: "detailed",
  collaborationStyle: "directive",
  riskTolerance: "conservative",
};

/**
 * 预定义角色描述（仅通用 SDK 角色；业务 leader 描述在各 ai-app role config）
 */
export const ROLE_DESCRIPTIONS: Record<BuiltinRoleId, string> = {
  [BUILTIN_ROLES.MODERATOR]:
    "主持人，负责设定议题、控制节奏、总结观点、输出建议",
  [BUILTIN_ROLES.RESEARCHER]:
    "研究员，负责信息检索、资料整理、可信度判断、数据收集",
  [BUILTIN_ROLES.ANALYST]: "分析师，负责数据分析、趋势洞察、逻辑推理、综合判断",
  [BUILTIN_ROLES.WRITER]:
    "写作者，负责内容创作、结构组织、语言润色、多风格写作",
  [BUILTIN_ROLES.DESIGNER]:
    "设计师，负责视觉设计、创意构思、用户体验、排版美化",
  [BUILTIN_ROLES.RENDERER]:
    "渲染师，负责页面渲染、模板应用、HTML 生成、视觉呈现",
  [BUILTIN_ROLES.REVIEWER]:
    "审核员，负责质量检查、风险识别、合规审核、一致性校验",
  [BUILTIN_ROLES.ADVOCATE]: "辩手，负责观点构建、论证推理、反驳应对、立场陈述",
};

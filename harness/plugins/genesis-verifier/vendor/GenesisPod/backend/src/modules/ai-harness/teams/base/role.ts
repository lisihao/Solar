/**
 * AI Engine - Role Implementation
 * 角色实现类
 */

import { ToolId, SkillId } from "@/modules/ai-harness/agents/abstractions/agent.types";
import {
  IRole,
  RoleId,
  RoleType,
  RoleConfig,
  WorkStyle,
  DEFAULT_WORK_STYLE,
  LEADER_WORK_STYLE,
} from "../abstractions/role.interface";

/**
 * 角色实现类
 */
export class Role implements IRole {
  readonly id: RoleId;
  readonly name: string;
  readonly description: string;
  readonly type: RoleType;
  readonly icon?: string;
  readonly coreSkills: SkillId[];
  readonly optionalSkills: SkillId[];
  readonly coreTools: ToolId[];
  readonly optionalTools: ToolId[];
  readonly responsibilities: string[];
  readonly limitations: string[];
  readonly defaultWorkStyle: WorkStyle;
  readonly systemPromptTemplate: string;
  readonly metadata?: Record<string, unknown>;

  constructor(config: RoleConfig) {
    this.id = config.id;
    this.name = config.name;
    this.description = config.description;
    this.type = config.type;
    this.icon = config.icon;
    this.coreSkills = config.coreSkills;
    this.optionalSkills = config.optionalSkills || [];
    this.coreTools = config.coreTools;
    this.optionalTools = config.optionalTools || [];
    this.responsibilities = config.responsibilities;
    this.limitations = config.limitations || [];
    this.defaultWorkStyle = this.mergeWorkStyle(
      config.type === "leader" ? LEADER_WORK_STYLE : DEFAULT_WORK_STYLE,
      config.defaultWorkStyle,
    );
    this.systemPromptTemplate = config.systemPromptTemplate;
    this.metadata = config.metadata;
  }

  /**
   * 合并工作风格
   */
  private mergeWorkStyle(
    base: WorkStyle,
    override?: Partial<WorkStyle>,
  ): WorkStyle {
    if (!override) return base;
    return { ...base, ...override };
  }

  /**
   * 获取所有技能（核心 + 可选）
   */
  getAllSkills(): SkillId[] {
    return [...this.coreSkills, ...this.optionalSkills];
  }

  /**
   * 获取所有工具（核心 + 可选）
   */
  getAllTools(): ToolId[] {
    return [...this.coreTools, ...this.optionalTools];
  }

  /**
   * 检查是否有某技能
   */
  hasSkill(skillId: SkillId): boolean {
    return (
      this.coreSkills.includes(skillId) || this.optionalSkills.includes(skillId)
    );
  }

  /**
   * 检查是否有某工具
   */
  hasTool(toolId: ToolId): boolean {
    return (
      this.coreTools.includes(toolId) || this.optionalTools.includes(toolId)
    );
  }

  /**
   * 生成系统提示词
   */
  generateSystemPrompt(context?: Record<string, unknown>): string {
    let prompt = this.systemPromptTemplate;

    // 替换模板变量
    const variables: Record<string, string> = {
      role_name: this.name,
      role_description: this.description,
      responsibilities: this.responsibilities.map((r) => `- ${r}`).join("\n"),
      limitations: this.limitations.map((l) => `- ${l}`).join("\n"),
      ...Object.fromEntries(
        Object.entries(context || {}).map(([k, v]) => [k, String(v)]),
      ),
    };

    for (const [key, value] of Object.entries(variables)) {
      prompt = prompt.replace(new RegExp(`{{${key}}}`, "g"), value);
    }

    return prompt;
  }

  /**
   * 转换为 JSON
   */
  toJSON(): RoleConfig {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      type: this.type,
      icon: this.icon,
      coreSkills: this.coreSkills,
      optionalSkills: this.optionalSkills,
      coreTools: this.coreTools,
      optionalTools: this.optionalTools,
      responsibilities: this.responsibilities,
      limitations: this.limitations,
      defaultWorkStyle: this.defaultWorkStyle,
      systemPromptTemplate: this.systemPromptTemplate,
      metadata: this.metadata,
    };
  }
}

/**
 * 创建角色工厂函数
 */
export function createRole(config: RoleConfig): Role {
  return new Role(config);
}

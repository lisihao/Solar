/**
 * AI Engine - Role Registry
 * 角色注册表
 */

import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import {
  IRole,
  RoleId,
  RoleConfig,
  BUILTIN_ROLES,
  ROLE_DESCRIPTIONS,
} from "../abstractions/role.interface";
import { createRole } from "../base/role";
import { BUILTIN_TOOLS } from "@/modules/ai-harness/agents/abstractions/agent.types";

/**
 * 角色注册表服务
 */
@Injectable()
export class RoleRegistry implements OnModuleInit {
  private readonly logger = new Logger(RoleRegistry.name);
  private readonly roles = new Map<RoleId, IRole>();

  /**
   * 模块初始化时注册内置角色
   */
  onModuleInit() {
    this.registerBuiltinRoles();
  }

  /**
   * 注册角色
   */
  register(role: IRole): void {
    // 如果已经注册，静默跳过（正常情况，无需告警）
    if (this.roles.has(role.id)) {
      return;
    }
    this.roles.set(role.id, role);
    this.logger.log(`Registered role: ${role.id}`);
  }

  /**
   * 从配置注册角色
   */
  registerFromConfig(config: RoleConfig): IRole {
    const role = createRole(config);
    this.register(role);
    return role;
  }

  /**
   * 获取角色
   */
  get(roleId: RoleId): IRole {
    const role = this.roles.get(roleId);
    if (!role) {
      throw new Error(`Role ${roleId} not found`);
    }
    return role;
  }

  /**
   * 尝试获取角色
   */
  tryGet(roleId: RoleId): IRole | undefined {
    return this.roles.get(roleId);
  }

  /**
   * 检查角色是否存在
   */
  has(roleId: RoleId): boolean {
    return this.roles.has(roleId);
  }

  /**
   * 获取所有角色
   */
  getAll(): IRole[] {
    return Array.from(this.roles.values());
  }

  /**
   * 获取所有 Leader 角色
   */
  getLeaderRoles(): IRole[] {
    return this.getAll().filter((r) => r.type === "leader");
  }

  /**
   * 获取所有 Member 角色
   */
  getMemberRoles(): IRole[] {
    return this.getAll().filter((r) => r.type === "member");
  }

  /**
   * 注销角色
   */
  unregister(roleId: RoleId): boolean {
    const result = this.roles.delete(roleId);
    if (result) {
      this.logger.log(`Unregistered role: ${roleId}`);
    }
    return result;
  }

  /**
   * 获取注册数量
   */
  size(): number {
    return this.roles.size;
  }

  /**
   * 清空注册表
   */
  clear(): void {
    this.roles.clear();
    this.logger.log("Role registry cleared");
  }

  /**
   * 注册内置角色（v3 R0-A1-d：仅通用 SDK 角色；业务 leader 由各 ai-app 自行注册）
   */
  private registerBuiltinRoles(): void {
    // Moderator（通用主持/协调角色）
    this.registerFromConfig({
      id: BUILTIN_ROLES.MODERATOR,
      name: "主持人",
      description: ROLE_DESCRIPTIONS[BUILTIN_ROLES.MODERATOR],
      type: "leader",
      icon: "mic",
      coreSkills: [
        "debate-moderation",
        "consensus-building",
        "summary-generation",
      ],
      coreTools: [BUILTIN_TOOLS.TEXT_GENERATION],
      responsibilities: [
        "设定辩论/讨论主题",
        "控制讨论节奏",
        "总结各方观点",
        "输出决策建议",
      ],
      systemPromptTemplate: `你是{{role_name}}，{{role_description}}

你的职责：
{{responsibilities}}

请保持中立、公正，引导讨论深入进行。`,
    });

    // Researcher
    this.registerFromConfig({
      id: BUILTIN_ROLES.RESEARCHER,
      name: "研究员",
      description: ROLE_DESCRIPTIONS[BUILTIN_ROLES.RESEARCHER],
      type: "member",
      icon: "🔍",
      coreSkills: [
        "information-retrieval",
        "source-validation",
        "data-collection",
      ],
      coreTools: [
        BUILTIN_TOOLS.WEB_SEARCH,
        BUILTIN_TOOLS.WEB_SCRAPER,
        BUILTIN_TOOLS.RAG_SEARCH,
      ],
      responsibilities: [
        "执行信息检索任务",
        "整理和归纳收集的资料",
        "验证信息来源可信度",
        "提供原始数据支撑",
      ],
      systemPromptTemplate: `你是{{role_name}}，{{role_description}}

你的职责：
{{responsibilities}}

请确保信息准确、来源可靠。`,
    });

    // Analyst
    this.registerFromConfig({
      id: BUILTIN_ROLES.ANALYST,
      name: "分析师",
      description: ROLE_DESCRIPTIONS[BUILTIN_ROLES.ANALYST],
      type: "member",
      icon: "📊",
      coreSkills: ["data-analysis", "trend-insight", "logical-reasoning"],
      coreTools: [BUILTIN_TOOLS.DATA_ANALYSIS, BUILTIN_TOOLS.STRUCTURED_OUTPUT],
      responsibilities: [
        "分析数据和信息",
        "发现趋势和洞察",
        "进行逻辑推理和论证",
        "输出分析结论",
      ],
      systemPromptTemplate: `你是{{role_name}}，{{role_description}}

你的职责：
{{responsibilities}}

请基于数据和事实进行分析，保持客观严谨。`,
    });

    // Writer
    this.registerFromConfig({
      id: BUILTIN_ROLES.WRITER,
      name: "写作者",
      description: ROLE_DESCRIPTIONS[BUILTIN_ROLES.WRITER],
      type: "member",
      icon: "✍️",
      coreSkills: [
        "content-creation",
        "structure-organization",
        "language-polish",
        "slides-content-compression",
        "slides-four-step-design",
        "slides-page-pipeline", // 逐页生成流水线，协调 content-filling 阶段
      ],
      coreTools: [
        BUILTIN_TOOLS.TEXT_GENERATION,
        BUILTIN_TOOLS.EXPORT_DOCX,
        BUILTIN_TOOLS.EXPORT_PDF,
      ],
      responsibilities: [
        "撰写高质量内容",
        "组织文章结构",
        "润色语言表达",
        "适应不同写作风格",
      ],
      systemPromptTemplate: `你是{{role_name}}，{{role_description}}

你的职责：
{{responsibilities}}

请确保内容清晰、结构合理、语言流畅。`,
    });

    // Designer
    this.registerFromConfig({
      id: BUILTIN_ROLES.DESIGNER,
      name: "设计师",
      description: ROLE_DESCRIPTIONS[BUILTIN_ROLES.DESIGNER],
      type: "member",
      icon: "🎨",
      coreSkills: [
        "visual-design",
        "creative-thinking",
        "user-experience",
        "slides-image-fetcher",
        "slides-chart-renderer",
      ],
      coreTools: [BUILTIN_TOOLS.IMAGE_GENERATION, BUILTIN_TOOLS.EXPORT_IMAGE],
      responsibilities: [
        "进行视觉设计",
        "提出创意方案",
        "优化用户体验",
        "美化内容呈现",
      ],
      systemPromptTemplate: `你是{{role_name}}，{{role_description}}

你的职责：
{{responsibilities}}

请注重美观和用户体验。`,
    });

    // Renderer (页面渲染师)
    this.registerFromConfig({
      id: BUILTIN_ROLES.RENDERER,
      name: "渲染师",
      description: ROLE_DESCRIPTIONS[BUILTIN_ROLES.RENDERER],
      type: "member",
      icon: "🖼️",
      coreSkills: [
        "slides-page-pipeline", // 页面生成流水线（逐页流式输出）
        "slides-template-rendering",
        "slides-template-matcher",
        "slides-layout-optimizer",
      ],
      coreTools: [
        BUILTIN_TOOLS.TEXT_GENERATION,
        BUILTIN_TOOLS.STRUCTURED_OUTPUT,
      ],
      responsibilities: [
        "使用模板渲染页面",
        "生成高质量 HTML 代码",
        "应用主题样式",
        "确保视觉呈现一致",
      ],
      systemPromptTemplate: `你是{{role_name}}，{{role_description}}

你的职责：
{{responsibilities}}

请确保生成的 HTML 布局美观、响应式、无溢出。`,
    });

    // Reviewer
    this.registerFromConfig({
      id: BUILTIN_ROLES.REVIEWER,
      name: "审核员",
      description: ROLE_DESCRIPTIONS[BUILTIN_ROLES.REVIEWER],
      type: "member",
      icon: "✅",
      coreSkills: [
        "quality-check",
        "risk-identification",
        "compliance-review",
        "slides-quality-audit",
        "slides-terminology-unifier",
        "slides-transition-checker",
      ],
      coreTools: [BUILTIN_TOOLS.DATA_VALIDATION],
      responsibilities: [
        "检查内容质量",
        "识别潜在风险",
        "确保合规性",
        "提出改进建议",
      ],
      systemPromptTemplate: `你是{{role_name}}，{{role_description}}

你的职责：
{{responsibilities}}

请仔细审核，确保质量和合规。`,
    });

    // Advocate
    this.registerFromConfig({
      id: BUILTIN_ROLES.ADVOCATE,
      name: "辩手",
      description: ROLE_DESCRIPTIONS[BUILTIN_ROLES.ADVOCATE],
      type: "member",
      icon: "🗣️",
      coreSkills: ["argument-building", "logical-reasoning", "rebuttal"],
      coreTools: [BUILTIN_TOOLS.WEB_SEARCH, BUILTIN_TOOLS.TEXT_GENERATION],
      responsibilities: [
        "构建有力论点",
        "进行逻辑论证",
        "应对反驳",
        "陈述立场观点",
      ],
      systemPromptTemplate: `你是{{role_name}}，{{role_description}}

你的职责：
{{responsibilities}}

请用清晰的逻辑和有力的证据支持你的观点。`,
    });

    this.logger.log(`Registered ${this.roles.size} builtin roles`);
  }
}

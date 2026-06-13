/**
 * Office lead role configs (v3 R0-A1-d)
 *
 * 业务 leader 角色定义从 harness BUILTIN_ROLES 下推到 ai-app。
 * CONTENT_LEAD: report / visual-design 团队 leader
 * SLIDES_LEAD : slides 团队 leader（PPT 架构师）
 *
 * 注册由 OfficeModule.onModuleInit 完成；RoleRegistry.register 自身幂等。
 */
import { BUILTIN_TOOLS } from "@/modules/ai-harness/facade";
import type { RoleConfig } from "@/modules/ai-harness/facade";

export const CONTENT_LEAD_ROLE_ID = "content-lead" as const;

export const CONTENT_LEAD_ROLE_CONFIG: RoleConfig = {
  id: CONTENT_LEAD_ROLE_ID,
  name: "内容领导",
  description: "内容团队领导，负责理解需求、规划结构、审核质量、把控风格",
  type: "leader",
  icon: "edit-3",
  coreSkills: ["content-planning", "style-control", "quality-review"],
  coreTools: [BUILTIN_TOOLS.TEXT_GENERATION],
  responsibilities: [
    "理解内容创作需求",
    "规划内容结构和风格",
    "审核内容质量",
    "把控整体风格一致性",
  ],
  systemPromptTemplate: `你是{{role_name}}，{{role_description}}

你的职责：
{{responsibilities}}

请确保内容专业、准确、符合用户需求。`,
};

export const SLIDES_LEAD_ROLE_ID = "slides-lead" as const;

export const SLIDES_LEAD_ROLE_CONFIG: RoleConfig = {
  id: SLIDES_LEAD_ROLE_ID,
  name: "PPT 架构师",
  description: "PPT 团队架构师，负责任务分解、大纲规划、页面设计、质量把控",
  type: "leader",
  icon: "layout-presentation",
  coreSkills: ["slides-task-decomposition", "slides-outline-planning"],
  coreTools: [BUILTIN_TOOLS.TEXT_GENERATION, BUILTIN_TOOLS.STRUCTURED_OUTPUT],
  responsibilities: [
    "分析源文本并制定 PPT 结构",
    "规划每页的观点、逻辑和数据",
    "协调团队成员完成内容生成",
    "审核整体质量和一致性",
  ],
  limitations: ["不直接生成页面 HTML", "不进行图像创作"],
  systemPromptTemplate: `你是{{role_name}}，{{role_description}}

你的职责：
{{responsibilities}}

注意事项：
{{limitations}}

请以专业、高效的态度领导 PPT 生成团队。`,
};

export const OFFICE_LEAD_ROLE_CONFIGS: RoleConfig[] = [
  CONTENT_LEAD_ROLE_CONFIG,
  SLIDES_LEAD_ROLE_CONFIG,
];

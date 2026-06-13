/**
 * AI App - Report Team Configuration
 * 报告撰写团队配置
 *
 * 从 AI Engine 迁移到 AI Apps 层
 * 遵循架构原则：业务配置属于 Apps 层，框架属于 Engine 层
 */

import {
  BUILTIN_ROLES,
  BUILTIN_TOOLS,
  createConstraintProfile,
} from "@/modules/ai-harness/facade";
import { REPORT_TEAM_ID } from "../office.constants";
import { CONTENT_LEAD_ROLE_ID } from "./office-roles.config";
import type { TeamConfig, WorkflowConfig } from "@/modules/ai-harness/facade";

/**
 * 报告团队工作流配置
 */
export const REPORT_WORKFLOW: WorkflowConfig = {
  id: "report-workflow",
  name: "报告撰写工作流",
  type: "sequential",
  steps: [
    {
      id: "requirement",
      name: "需求理解",
      description: "理解写作需求，确定报告结构",
      type: "task",
      executorRoles: [CONTENT_LEAD_ROLE_ID],
      parallel: false,
      dependsOn: [],
    },
    {
      id: "outline",
      name: "大纲规划",
      description: "规划报告大纲和内容结构",
      type: "task",
      executorRoles: [CONTENT_LEAD_ROLE_ID],
      parallel: false,
      dependsOn: ["requirement"],
    },
    {
      id: "writing",
      name: "内容创作",
      description: "撰写报告主体内容",
      type: "task",
      executorRoles: [BUILTIN_ROLES.WRITER],
      parallel: false,
      dependsOn: ["outline"],
    },
    {
      id: "visual",
      name: "视觉美化",
      description: "添加图表和视觉元素",
      type: "task",
      executorRoles: [BUILTIN_ROLES.DESIGNER],
      parallel: true,
      dependsOn: ["writing"],
    },
    {
      id: "review",
      name: "质量审核",
      description: "审核内容质量和格式",
      type: "review",
      executorRoles: [BUILTIN_ROLES.REVIEWER],
      parallel: false,
      dependsOn: ["visual"],
      reviewConfig: {
        reviewerRole: BUILTIN_ROLES.REVIEWER,
        criteria: [
          { name: "内容质量", description: "内容准确、逻辑清晰", weight: 0.3 },
          { name: "结构组织", description: "结构合理、层次分明", weight: 0.25 },
          { name: "语言表达", description: "语言流畅、专业规范", weight: 0.25 },
          { name: "视觉呈现", description: "排版美观、图表清晰", weight: 0.2 },
        ],
        passThreshold: 0.7,
        maxReworks: 2,
      },
    },
    {
      id: "finalize",
      name: "最终确认",
      description: "Leader 最终确认和导出",
      type: "task",
      executorRoles: [CONTENT_LEAD_ROLE_ID],
      parallel: false,
      dependsOn: ["review"],
    },
  ],
  timeout: 2 * 60 * 60 * 1000, // 2 小时
};

/**
 * 报告团队配置
 */
export const REPORT_TEAM_CONFIG: TeamConfig = {
  id: REPORT_TEAM_ID,
  name: "报告撰写",
  description: "高效生成各类商业报告和文档",
  type: "predefined",
  icon: "file-text",
  color: "#10B981",
  leaderRoleId: CONTENT_LEAD_ROLE_ID,
  memberRoles: [
    {
      roleId: BUILTIN_ROLES.WRITER,
      minCount: 1,
      maxCount: 2,
      required: true,
    },
    {
      roleId: BUILTIN_ROLES.DESIGNER,
      minCount: 1,
      maxCount: 1,
      required: false,
    },
    {
      roleId: BUILTIN_ROLES.REVIEWER,
      minCount: 1,
      maxCount: 1,
      required: true,
    },
  ],
  workflow: REPORT_WORKFLOW,
  availableSkills: [
    "content-planning",
    "content-creation",
    "structure-organization",
    "language-polish",
    "visual-design",
    "quality-check",
  ],
  availableTools: [
    BUILTIN_TOOLS.TEXT_GENERATION,
    BUILTIN_TOOLS.IMAGE_GENERATION,
    BUILTIN_TOOLS.STRUCTURED_OUTPUT,
    BUILTIN_TOOLS.EXPORT_DOCX,
    BUILTIN_TOOLS.EXPORT_PDF,
    BUILTIN_TOOLS.EXPORT_PPTX,
  ],
  constraintProfile: createConstraintProfile("balanced", {
    quality: {
      depth: "standard",
      accuracy: "prefer_evidence",
      reviewRequired: true,
      minReviewScore: 7,
      maxReworks: 2,
    },
  }),
  deliverableTypes: ["report", "presentation", "summary"],
  metadata: {
    category: "content",
    typicalDuration: "30min-2h",
    suitableFor: ["商业报告", "工作总结", "项目文档", "演示文稿"],
  },
};

/**
 * 创建报告团队工厂函数
 */
export function createReportTeamConfig(
  overrides?: Partial<TeamConfig>,
): TeamConfig {
  return {
    ...REPORT_TEAM_CONFIG,
    ...overrides,
    id: overrides?.id || REPORT_TEAM_CONFIG.id,
  };
}

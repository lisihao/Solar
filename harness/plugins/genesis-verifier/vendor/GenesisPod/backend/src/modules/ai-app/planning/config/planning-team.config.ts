/**
 * AI Planning Team Configuration
 */

import {
  BUILTIN_ROLES,
  BUILTIN_TOOLS,
  createConstraintProfile,
} from "@/modules/ai-harness/facade";
import { RESEARCH_LEAD_ROLE_ID } from "../../research/teams";
import type { TeamConfig, WorkflowConfig } from "@/modules/ai-harness/facade";

export const PLANNING_WORKFLOW: WorkflowConfig = {
  id: "planning-workflow",
  name: "策划工作流",
  type: "sequential",
  steps: [
    {
      id: "goal-analysis",
      name: "目标分析",
      description: "分析策划目标，识别关键需求、约束条件和成功标准",
      type: "task",
      executorRoles: [RESEARCH_LEAD_ROLE_ID],
      parallel: false,
      dependsOn: [],
    },
    {
      id: "research",
      name: "调研洞察",
      description: "围绕策划目标进行调研，收集相关数据、案例和行业趋势",
      type: "task",
      executorRoles: [BUILTIN_ROLES.RESEARCHER],
      parallel: true,
      dependsOn: ["goal-analysis"],
    },
    {
      id: "brainstorm",
      name: "头脑风暴",
      description: "基于调研结果，进行头脑风暴，提出多种可行方案",
      type: "task",
      executorRoles: [
        BUILTIN_ROLES.RESEARCHER,
        BUILTIN_ROLES.ANALYST,
        BUILTIN_ROLES.WRITER,
      ],
      parallel: false,
      dependsOn: ["research"],
    },
    {
      id: "debate",
      name: "辩论推演",
      description: "对各方案进行辩论评估，分析优劣势和风险",
      type: "task",
      executorRoles: [BUILTIN_ROLES.ADVOCATE],
      parallel: false,
      dependsOn: ["brainstorm"],
    },
    {
      id: "synthesis",
      name: "方案综合",
      description: "综合辩论结论，整合最优方案，形成完整策划",
      type: "task",
      executorRoles: [BUILTIN_ROLES.ANALYST],
      parallel: false,
      dependsOn: ["debate"],
    },
    {
      id: "delivery",
      name: "输出交付",
      description: "输出最终策划文档，包含执行计划和关键里程碑",
      type: "task",
      executorRoles: [BUILTIN_ROLES.WRITER],
      parallel: false,
      dependsOn: ["synthesis"],
    },
  ],
  timeout: 3 * 60 * 60 * 1000,
};

export const PLANNING_TEAM_CONFIG: TeamConfig = {
  id: "planning",
  name: "AI 策划",
  description: "多阶段策划流程，从目标分析到方案交付",
  type: "predefined",
  icon: "lightbulb",
  color: "#F59E0B",
  leaderRoleId: RESEARCH_LEAD_ROLE_ID,
  memberRoles: [
    {
      roleId: BUILTIN_ROLES.RESEARCHER,
      minCount: 1,
      maxCount: 2,
      required: true,
    },
    { roleId: BUILTIN_ROLES.ANALYST, minCount: 1, maxCount: 1, required: true },
    { roleId: BUILTIN_ROLES.WRITER, minCount: 1, maxCount: 1, required: true },
    {
      roleId: BUILTIN_ROLES.ADVOCATE,
      minCount: 2,
      maxCount: 2,
      required: false,
    },
  ],
  workflow: PLANNING_WORKFLOW,
  availableSkills: [
    "goal-analysis",
    "market-research",
    "brainstorming",
    "debate-facilitation",
    "synthesis",
    "document-writing",
  ],
  availableTools: [
    BUILTIN_TOOLS.WEB_SEARCH,
    BUILTIN_TOOLS.TEXT_GENERATION,
    BUILTIN_TOOLS.DATA_ANALYSIS,
    BUILTIN_TOOLS.STRUCTURED_OUTPUT,
  ],
  constraintProfile: createConstraintProfile("balanced", {
    quality: {
      depth: "comprehensive",
      accuracy: "prefer_evidence",
      reviewRequired: true,
      minReviewScore: 7,
      maxReworks: 2,
    },
  }),
  deliverableTypes: ["plan", "report", "analysis"],
  metadata: {
    category: "planning",
    typicalDuration: "2-3h",
    suitableFor: ["营销策划", "产品策划", "活动策划", "业务规划"],
  },
};

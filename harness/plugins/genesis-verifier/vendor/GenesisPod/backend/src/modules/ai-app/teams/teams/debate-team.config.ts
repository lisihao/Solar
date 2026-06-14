/**
 * AI App - Debate Team Configuration
 * 辩论推演团队配置
 *
 * 从 AI Engine 迁移到 AI Apps 层
 * 遵循架构原则：业务配置属于 Apps 层，框架属于 Engine 层
 */

import {
  BUILTIN_ROLES,
  BUILTIN_TOOLS,
  createConstraintProfile,
} from "@/modules/ai-harness/facade";
import { DEBATE_TEAM_ID } from "../teams.constants";
import type { TeamConfig, WorkflowConfig } from "@/modules/ai-harness/facade";

/**
 * 辩论团队工作流配置
 */
export const DEBATE_WORKFLOW: WorkflowConfig = {
  id: "debate-workflow",
  name: "辩论推演工作流",
  type: "hybrid",
  steps: [
    {
      id: "topic-setup",
      name: "议题设定",
      description: "设定辩论主题和规则",
      type: "task",
      executorRoles: [BUILTIN_ROLES.MODERATOR],
      parallel: false,
      dependsOn: [],
    },
    {
      id: "stance-pro",
      name: "正方立场陈述",
      description: "正方阐述立场和核心论点",
      type: "task",
      executorRoles: [BUILTIN_ROLES.ADVOCATE],
      parallel: true,
      dependsOn: ["topic-setup"],
    },
    {
      id: "stance-con",
      name: "反方立场陈述",
      description: "反方阐述立场和核心论点",
      type: "task",
      executorRoles: [BUILTIN_ROLES.ADVOCATE],
      parallel: true,
      dependsOn: ["topic-setup"],
    },
    {
      id: "debate-round-1",
      name: "第一轮辩论",
      description: "双方针对对方论点进行反驳",
      type: "task",
      executorRoles: [BUILTIN_ROLES.ADVOCATE],
      parallel: false,
      dependsOn: ["stance-pro", "stance-con"],
    },
    {
      id: "debate-round-2",
      name: "第二轮辩论",
      description: "深入辩论和补充论证",
      type: "task",
      executorRoles: [BUILTIN_ROLES.ADVOCATE],
      parallel: false,
      dependsOn: ["debate-round-1"],
    },
    {
      id: "analysis",
      name: "综合分析",
      description: "分析双方论点的优劣",
      type: "task",
      executorRoles: [BUILTIN_ROLES.ANALYST],
      parallel: false,
      dependsOn: ["debate-round-2"],
    },
    {
      id: "conclusion",
      name: "结论总结",
      description: "主持人总结辩论并给出建议",
      type: "task",
      executorRoles: [BUILTIN_ROLES.MODERATOR],
      parallel: false,
      dependsOn: ["analysis"],
    },
  ],
  timeout: 2 * 60 * 60 * 1000, // 2 小时
};

/**
 * 辩论团队配置
 */
export const DEBATE_TEAM_CONFIG: TeamConfig = {
  id: DEBATE_TEAM_ID,
  name: "辩论推演",
  description: "多视角论证，支持决策分析",
  type: "predefined",
  icon: "scale",
  color: "#EF4444",
  leaderRoleId: BUILTIN_ROLES.MODERATOR,
  memberRoles: [
    {
      roleId: BUILTIN_ROLES.ADVOCATE,
      minCount: 2,
      maxCount: 4,
      required: true,
    },
    {
      roleId: BUILTIN_ROLES.ANALYST,
      minCount: 1,
      maxCount: 1,
      required: true,
    },
  ],
  workflow: DEBATE_WORKFLOW,
  availableSkills: [
    "debate-moderation",
    "argument-building",
    "logical-reasoning",
    "rebuttal",
    "consensus-building",
    "summary-generation",
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
      reviewRequired: false, // 辩论本身就是互相审核
      minReviewScore: 7,
      maxReworks: 1,
    },
  }),
  deliverableTypes: ["analysis", "summary", "report"],
  metadata: {
    category: "simulation",
    typicalDuration: "1-2h",
    suitableFor: ["方案论证", "红蓝对抗", "决策支持", "风险评估"],
  },
};

/**
 * 创建辩论团队工厂函数
 */
export function createDebateTeamConfig(
  overrides?: Partial<TeamConfig>,
): TeamConfig {
  return {
    ...DEBATE_TEAM_CONFIG,
    ...overrides,
    id: overrides?.id || DEBATE_TEAM_CONFIG.id,
  };
}

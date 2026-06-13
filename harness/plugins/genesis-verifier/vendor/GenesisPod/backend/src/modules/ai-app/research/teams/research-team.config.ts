/**
 * AI App - Research Team Configuration
 * 深度研究团队配置
 *
 * 从 AI Engine 迁移到 AI Apps 层
 * 遵循架构原则：业务配置属于 Apps 层，框架属于 Engine 层
 */

import {
  BUILTIN_ROLES,
  BUILTIN_TOOLS,
  createConstraintProfile,
} from "@/modules/ai-harness/facade";
import { RESEARCH_TEAM_ID } from "../research.constants";
import { RESEARCH_LEAD_ROLE_ID } from "./research-roles.config";
import type { TeamConfig, WorkflowConfig } from "@/modules/ai-harness/facade";

/**
 * 研究团队工作流配置
 */
export const RESEARCH_WORKFLOW: WorkflowConfig = {
  id: "research-workflow",
  name: "深度研究工作流",
  type: "hybrid",
  steps: [
    {
      id: "framework",
      name: "研究框架",
      description: "制定研究框架和方法论",
      type: "task",
      executorRoles: [RESEARCH_LEAD_ROLE_ID],
      parallel: false,
      dependsOn: [],
    },
    {
      id: "info-gathering-1",
      name: "信息收集-行业概况",
      description: "收集行业基础数据和概况信息",
      type: "task",
      executorRoles: [BUILTIN_ROLES.RESEARCHER],
      parallel: true,
      dependsOn: ["framework"],
    },
    {
      id: "info-gathering-2",
      name: "信息收集-竞争格局",
      description: "收集主要玩家和竞争格局信息",
      type: "task",
      executorRoles: [BUILTIN_ROLES.RESEARCHER],
      parallel: true,
      dependsOn: ["framework"],
    },
    {
      id: "info-gathering-3",
      name: "信息收集-趋势动态",
      description: "收集最新趋势和动态信息",
      type: "task",
      executorRoles: [BUILTIN_ROLES.RESEARCHER],
      parallel: true,
      dependsOn: ["framework"],
    },
    {
      id: "analysis",
      name: "分析整合",
      description: "分析和整合收集的信息",
      type: "task",
      executorRoles: [BUILTIN_ROLES.ANALYST],
      parallel: false,
      dependsOn: ["info-gathering-1", "info-gathering-2", "info-gathering-3"],
    },
    {
      id: "writing",
      name: "报告撰写",
      description: "撰写研究报告",
      type: "task",
      executorRoles: [BUILTIN_ROLES.WRITER],
      parallel: false,
      dependsOn: ["analysis"],
    },
    {
      id: "review",
      name: "质量审核",
      description: "Leader 审核报告质量",
      type: "review",
      executorRoles: [RESEARCH_LEAD_ROLE_ID],
      parallel: false,
      dependsOn: ["writing"],
      reviewConfig: {
        reviewerRole: RESEARCH_LEAD_ROLE_ID,
        criteria: [
          {
            name: "准确性",
            description: "信息来源可靠，数据准确",
            weight: 0.3,
          },
          { name: "完整性", description: "覆盖所有研究维度", weight: 0.25 },
          { name: "深度", description: "分析深入，有独到见解", weight: 0.25 },
          { name: "可读性", description: "结构清晰，表达流畅", weight: 0.2 },
        ],
        passThreshold: 0.7,
        maxReworks: 2,
      },
    },
  ],
  timeout: 4 * 60 * 60 * 1000, // 4 小时
};

/**
 * 研究团队配置
 */
export const RESEARCH_TEAM_CONFIG: TeamConfig = {
  id: RESEARCH_TEAM_ID,
  name: "深度研究",
  description: "专业级深度研究，输出高质量调研报告",
  type: "predefined",
  icon: "search",
  color: "#EC4899",
  leaderRoleId: RESEARCH_LEAD_ROLE_ID,
  memberRoles: [
    {
      roleId: BUILTIN_ROLES.RESEARCHER,
      minCount: 1,
      maxCount: 3,
      required: true,
    },
    {
      roleId: BUILTIN_ROLES.ANALYST,
      minCount: 1,
      maxCount: 1,
      required: true,
    },
    {
      roleId: BUILTIN_ROLES.WRITER,
      minCount: 1,
      maxCount: 1,
      required: true,
    },
  ],
  workflow: RESEARCH_WORKFLOW,
  availableSkills: [
    // 规划类
    "research-planning",
    "research-direction-planning",
    "gap-analysis",
    // 分析类
    "critical-thinking",
    "data-interpretation",
    "synthesis",
    "comparison",
    "cause-effect",
    "trend-analysis",
    "deep-dive",
    // 验证类
    "fact-check",
    "consistency-check",
    "claim-extraction",
    "fact-verification",
    "cross-reference-validation",
    "source-credibility",
    // 写作类
    "report-synthesis",
    "evidence-summarization",
    "executive-summary-writing",
    "content-critique",
    "section-depth-evaluation",
  ],
  availableTools: [
    BUILTIN_TOOLS.WEB_SEARCH,
    BUILTIN_TOOLS.WEB_SCRAPER,
    BUILTIN_TOOLS.RAG_SEARCH,
    BUILTIN_TOOLS.DATA_ANALYSIS,
    BUILTIN_TOOLS.TEXT_GENERATION,
    BUILTIN_TOOLS.EXPORT_DOCX,
    BUILTIN_TOOLS.EXPORT_PDF,
    // ★ 专业领域搜索工具（由 ResearchToolRouter 按主题分类调度）
    "arxiv-search",
    "semantic-scholar",
    "pubmed",
    "github-search",
    "hackernews-search",
    "finance-api",
    "federal-register",
    "congress-gov",
  ],
  constraintProfile: createConstraintProfile("thorough", {
    quality: {
      depth: "comprehensive",
      accuracy: "require_evidence",
      reviewRequired: true,
      minReviewScore: 8,
      maxReworks: 2,
    },
  }),
  deliverableTypes: ["report", "data", "summary"],
  metadata: {
    category: "research",
    typicalDuration: "1-4h",
    suitableFor: ["战略分析", "行业研究", "技术调研", "竞品分析"],
  },
};

/**
 * 创建研究团队工厂函数
 */
export function createResearchTeamConfig(
  overrides?: Partial<TeamConfig>,
): TeamConfig {
  return {
    ...RESEARCH_TEAM_CONFIG,
    ...overrides,
    id: overrides?.id || RESEARCH_TEAM_CONFIG.id,
  };
}

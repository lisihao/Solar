/**
 * AI App - Topic Insights Team Configuration
 * 深度洞察研究团队配置
 *
 * 遵循架构原则：业务配置属于 Apps 层，框架属于 Engine 层
 */

import {
  BUILTIN_ROLES,
  BUILTIN_TOOLS,
  createConstraintProfile,
} from "@/modules/ai-harness/facade";
import { TOPIC_INSIGHTS_TEAM_ID } from "../topic-insights.constants";
import { RESEARCH_LEAD_ROLE_ID } from "../../research/teams";
import type { TeamConfig, WorkflowConfig } from "@/modules/ai-harness/facade";

/**
 * 深度洞察研究工作流配置
 */
export const TOPIC_INSIGHTS_WORKFLOW: WorkflowConfig = {
  id: "topic-insights-workflow",
  name: "深度洞察研究工作流",
  type: "hybrid",
  steps: [
    {
      id: "planning",
      name: "研究规划",
      description: "Leader 分析主题并规划研究维度和任务",
      type: "task",
      executorRoles: [RESEARCH_LEAD_ROLE_ID],
      parallel: false,
      dependsOn: [],
    },
    {
      id: "dimension-research",
      name: "维度研究",
      description: "并行执行各维度的深度研究",
      type: "task",
      executorRoles: [BUILTIN_ROLES.RESEARCHER],
      parallel: true,
      dependsOn: ["planning"],
    },
    {
      id: "quality-review",
      name: "质量审核",
      description: "Leader 审核各维度研究质量，评估准确性和完整性",
      type: "review",
      executorRoles: [RESEARCH_LEAD_ROLE_ID],
      parallel: false,
      dependsOn: ["dimension-research"],
      reviewConfig: {
        reviewerRole: RESEARCH_LEAD_ROLE_ID,
        criteria: [
          {
            name: "准确性",
            description: "信息来源可靠，数据准确，事实核查通过",
            weight: 0.3,
          },
          {
            name: "完整性",
            description: "覆盖所有研究维度，无遗漏关键信息",
            weight: 0.25,
          },
          {
            name: "深度",
            description: "分析深入，有独到见解，超越表面信息",
            weight: 0.25,
          },
          {
            name: "可读性",
            description: "结构清晰，表达流畅，图表适当",
            weight: 0.2,
          },
        ],
        passThreshold: 0.7,
        maxReworks: 3,
      },
    },
    {
      id: "report-synthesis",
      name: "报告综合",
      description: "综合各维度研究结果生成完整报告",
      type: "task",
      executorRoles: [BUILTIN_ROLES.WRITER],
      parallel: false,
      dependsOn: ["quality-review"],
    },
  ],
  timeout: 6 * 60 * 60 * 1000, // 6 hours
};

/**
 * 深度洞察研究团队配置
 */
export const TOPIC_INSIGHTS_TEAM_CONFIG: TeamConfig = {
  id: TOPIC_INSIGHTS_TEAM_ID,
  name: "深度洞察研究",
  description: "多维度深度研究与专业报告生成",
  type: "predefined",
  icon: "lightbulb",
  color: "#8B5CF6",
  leaderRoleId: RESEARCH_LEAD_ROLE_ID,
  memberRoles: [
    {
      roleId: BUILTIN_ROLES.RESEARCHER,
      minCount: 1,
      maxCount: 5,
      required: true,
    },
    {
      roleId: BUILTIN_ROLES.ANALYST,
      minCount: 1,
      maxCount: 2,
      required: true,
    },
    {
      roleId: BUILTIN_ROLES.WRITER,
      minCount: 1,
      maxCount: 1,
      required: true,
    },
  ],
  workflow: TOPIC_INSIGHTS_WORKFLOW,
  availableSkills: [
    // ── 规划和策略 ──
    "research-planning",
    "plan-adjuster",
    // ── 维度研究 ──
    "dimension-analysis",
    "deep-dive",
    "cause-effect",
    "comparison",
    "competitive-analysis",
    "trend-analysis",
    "future-projection",
    "swot-analysis",
    // ── 数据和检索 ──
    "information-retrieval",
    "data-interpretation",
    "data-analysis",
    "data-enrichment",
    "rag-fusion-query",
    // ── 质量和验证 ──
    "fact-checking",
    "fact-verification",
    "claim-extraction",
    "consistency-check",
    "dedup-checker",
    "source-validation",
    // ── 分析和推理 ──
    "critical-thinking",
    "multi-path-reasoning",
    "cross-dimension-correlation",
    "trend-insight",
    // ── 审核和综合 ──
    "quality-review",
    "dimension-review",
    "section-review",
    "task-quality-evaluator",
    // ── 内容生成 ──
    "content-creation",
    "content-critique",
    "content-refine",
    "report-synthesis",
    "dimension-synthesizer",
    "multi-view-synthesizer",
    "synthesis",
    // ── 辩论 ──
    "debate-argument-generator",
    "debate-judge-assessor",
    "debate-verdict-synthesizer",
    // ── 专业角色 ──
    "specialized-role-analysis",
    // ── 其他 ──
    "citation-formatting",
    "multi-language-research",
    "figure-extraction",
    "interactive-research",
    "evidence-management",
  ],
  availableTools: [
    BUILTIN_TOOLS.WEB_SEARCH,
    BUILTIN_TOOLS.WEB_SCRAPER,
    BUILTIN_TOOLS.RAG_SEARCH,
    BUILTIN_TOOLS.DATA_ANALYSIS,
    BUILTIN_TOOLS.TEXT_GENERATION,
    BUILTIN_TOOLS.EXPORT_DOCX,
    BUILTIN_TOOLS.EXPORT_PDF,
  ],
  constraintProfile: createConstraintProfile("thorough", {
    quality: {
      depth: "comprehensive",
      accuracy: "require_evidence",
      reviewRequired: true,
      minReviewScore: 7,
      maxReworks: 3,
    },
  }),
  deliverableTypes: ["report", "data", "summary", "insight"],
  metadata: {
    category: "research",
    typicalDuration: "2-6h",
    suitableFor: [
      "主题深度研究",
      "行业洞察分析",
      "技术趋势追踪",
      "竞品对比分析",
      "市场宏观分析",
    ],
  },
};

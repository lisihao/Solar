/**
 * AI App - Slides Team Configuration
 * PPT 生成团队配置
 *
 * 从 AI Engine 迁移到 AI Apps 层
 * 遵循架构原则：业务配置属于 Apps 层，框架属于 Engine 层
 *
 * 5-Agent 团队：
 * - Architect (Leader): 任务分解、大纲规划
 * - Writer: 内容填充、文本润色
 * - Renderer: 模板渲染、HTML 生成
 * - Designer: 图表设计、图片生成
 * - Reviewer: 质量审核、一致性检查
 */

import {
  BUILTIN_ROLES,
  BUILTIN_TOOLS,
  createConstraintProfile,
} from "@/modules/ai-harness/facade";
import { SLIDES_LEAD_ROLE_ID } from "./office-roles.config";
import { SLIDES_TEAM_ID } from "../office.constants";
import type { TeamConfig, WorkflowConfig } from "@/modules/ai-harness/facade";

/**
 * Slides 团队工作流配置
 * 三阶段流水线：分解 → 规划 → 渲染
 */
export const SLIDES_WORKFLOW: WorkflowConfig = {
  id: "slides-workflow",
  name: "PPT 生成工作流",
  type: "sequential",
  steps: [
    // Phase 1: 任务分解
    {
      id: "task-decomposition",
      name: "任务分解",
      description: "分析源文本，确定页数、章节结构、设计策略",
      type: "task",
      executorRoles: [SLIDES_LEAD_ROLE_ID],
      parallel: false,
      dependsOn: [],
      timeout: 30000, // 30s
    },
    // Phase 2: 大纲规划
    {
      id: "outline-planning",
      name: "大纲规划",
      description: "为每页规划观点、逻辑类型、模板类型、数据需求",
      type: "task",
      executorRoles: [SLIDES_LEAD_ROLE_ID],
      parallel: false,
      dependsOn: ["task-decomposition"],
      timeout: 60000, // 60s
    },
    // Phase 3: 页面渲染循环（包含子步骤）
    {
      id: "content-filling",
      name: "内容填充",
      description: "压缩源文本为幻灯片内容，确保信息密度合适",
      type: "task",
      executorRoles: [BUILTIN_ROLES.WRITER],
      parallel: false,
      dependsOn: ["outline-planning"],
      timeout: 120000, // 2min per page
    },
    {
      id: "image-generation",
      name: "图片生成",
      description: "生成或搜索配图、图表",
      type: "task",
      executorRoles: [BUILTIN_ROLES.DESIGNER],
      parallel: true, // 可与内容填充并行
      dependsOn: ["outline-planning"],
      timeout: 60000,
    },
    {
      id: "page-rendering",
      name: "页面渲染",
      description: "使用模板渲染页面 HTML，应用主题样式",
      type: "task",
      executorRoles: [BUILTIN_ROLES.RENDERER],
      parallel: false,
      dependsOn: ["content-filling", "image-generation"],
      timeout: 30000,
    },
    // Phase 4: 批量审核（每 5 页）
    {
      id: "batch-review",
      name: "批量审核",
      description: "检查内容质量、布局一致性、数据准确性",
      type: "review",
      executorRoles: [BUILTIN_ROLES.REVIEWER],
      parallel: false,
      dependsOn: ["page-rendering"],
      reviewConfig: {
        reviewerRole: BUILTIN_ROLES.REVIEWER,
        criteria: [
          {
            name: "内容完整性",
            description: "观点、逻辑、数据三要素齐全",
            weight: 0.25,
          },
          {
            name: "布局美观",
            description: "布局合理、无溢出、间距适当",
            weight: 0.25,
          },
          {
            name: "数据准确",
            description: "数据真实、无占位符、无重复",
            weight: 0.25,
          },
          {
            name: "风格一致",
            description: "主题一致、配色协调、字体统一",
            weight: 0.25,
          },
        ],
        passThreshold: 0.7,
        maxReworks: 2,
      },
      timeout: 60000,
    },
    // Phase 5: 最终确认
    {
      id: "finalize",
      name: "最终确认",
      description: "Leader 最终确认，准备导出",
      type: "task",
      executorRoles: [SLIDES_LEAD_ROLE_ID],
      parallel: false,
      dependsOn: ["batch-review"],
      timeout: 15000,
    },
  ],
  timeout: 10 * 60 * 1000, // 10 分钟总超时
};

/**
 * Slides 团队配置
 */
export const SLIDES_TEAM_CONFIG: TeamConfig = {
  id: SLIDES_TEAM_ID,
  name: "PPT 生成",
  description:
    "AI 驱动的专业 PPT 生成团队，5 个专业 Agent 协作完成高质量演示文稿",
  type: "predefined",
  icon: "presentation",
  color: "#6366F1", // Indigo
  leaderRoleId: SLIDES_LEAD_ROLE_ID,
  memberRoles: [
    {
      roleId: BUILTIN_ROLES.WRITER,
      minCount: 1,
      maxCount: 2,
      required: true,
    },
    {
      roleId: BUILTIN_ROLES.RENDERER,
      minCount: 1,
      maxCount: 1,
      required: true,
    },
    {
      roleId: BUILTIN_ROLES.DESIGNER,
      minCount: 1,
      maxCount: 1,
      required: true,
    },
    {
      roleId: BUILTIN_ROLES.REVIEWER,
      minCount: 1,
      maxCount: 1,
      required: true,
    },
  ],
  workflow: SLIDES_WORKFLOW,
  availableSkills: [
    // Layer 0: Orchestration (页面生成流水线)
    "slides-page-pipeline",
    // Layer 1: Intent Understanding
    "intent-analyzer",
    // Layer 2: Narrative Planning
    "narrative-planner",
    "rhythm-controller",
    // Layer 3: Template Dispatch
    "template-matcher",
    // Layer 4: Content Generation
    "task-decomposition",
    "outline-planning",
    "four-step-design",
    "content-compression",
    "data-supplement",
    "template-rendering",
    "chart-renderer",
    "image-fetcher",
    // Layer 4.5: Content-Driven Layout
    "content-analyzer",
    "layout-optimizer",
    // Layer 5: Consistency
    "terminology-unifier",
    "transition-checker",
    // Layer 6: Quality Assurance
    "quality-audit",
    // Layer 7: Review
    "scenario-deduction",
  ],
  availableTools: [
    BUILTIN_TOOLS.TEXT_GENERATION,
    BUILTIN_TOOLS.IMAGE_GENERATION,
    BUILTIN_TOOLS.WEB_SEARCH,
    BUILTIN_TOOLS.STRUCTURED_OUTPUT,
    BUILTIN_TOOLS.EXPORT_PPTX,
    BUILTIN_TOOLS.EXPORT_PDF,
  ],
  constraintProfile: createConstraintProfile("balanced", {
    quality: {
      depth: "standard",
      accuracy: "prefer_evidence",
      reviewRequired: true,
      minReviewScore: 7,
      maxReworks: 2,
    },
    efficiency: {
      maxDuration: 10 * 60 * 1000, // 10 分钟最大
      priority: "normal" as const,
      allowParallel: true,
      maxParallelism: 3,
    },
  }),
  deliverableTypes: ["pptx", "pdf", "png", "html"],
  metadata: {
    category: "presentation",
    typicalDuration: "1-5min",
    maxPages: 30,
    supportedTemplates: 32,
    suitableFor: [
      "商业演示",
      "工作汇报",
      "产品介绍",
      "培训课件",
      "方案展示",
      "竞标答辩",
    ],
    capabilities: [
      "多模板智能匹配",
      "内容自动压缩",
      "图表自动生成",
      "配图智能搜索",
      "主题一键切换",
      "多格式导出",
    ],
  },
};

/**
 * 创建 Slides 团队工厂函数
 */
export function createSlidesTeamConfig(
  overrides?: Partial<TeamConfig>,
): TeamConfig {
  return {
    ...SLIDES_TEAM_CONFIG,
    ...overrides,
    id: overrides?.id || SLIDES_TEAM_CONFIG.id,
  };
}

/**
 * Tool Strategy Configuration
 * 每个 ResearchTopicType 对应的默认工具列表和优先级
 * 配置与逻辑分离，供 ResearchToolRouterService 使用
 */

import type {
  ResearchTopicType,
  ToolAssignment,
  ToolResolution,
} from "../search/research-tool-router.types";

// ============================================================================
// 单个工具分配定义
// ============================================================================

const WEB_SEARCH_PRIMARY: ToolAssignment = {
  toolId: "web-search",
  maxResults: 15,
  priority: 1,
  required: true,
  queryTransform: "none",
};

const WEB_SEARCH_SECONDARY: ToolAssignment = {
  toolId: "web-search",
  maxResults: 10,
  priority: 2,
  required: true,
  queryTransform: "none",
};

const ARXIV_PRIMARY: ToolAssignment = {
  toolId: "arxiv-search",
  maxResults: 10,
  priority: 1,
  required: false,
  queryTransform: "academic",
};

const SEMANTIC_SCHOLAR_PRIMARY: ToolAssignment = {
  toolId: "semantic-scholar",
  maxResults: 10,
  priority: 2,
  required: false,
  queryTransform: "academic",
};

const PUBMED_SECONDARY: ToolAssignment = {
  toolId: "pubmed",
  maxResults: 5,
  priority: 3,
  required: false,
  queryTransform: "academic",
};

const WEB_SEARCH_ACADEMIC_FALLBACK: ToolAssignment = {
  toolId: "web-search",
  maxResults: 10,
  priority: 4,
  required: false,
  queryTransform: "academic",
};

const FEDERAL_REGISTER_SECONDARY: ToolAssignment = {
  toolId: "federal-register",
  maxResults: 5,
  priority: 2,
  required: false,
  queryTransform: "policy",
};

const CONGRESS_GOV_SECONDARY: ToolAssignment = {
  toolId: "congress-gov",
  maxResults: 5,
  priority: 3,
  required: false,
  queryTransform: "policy",
};

const WEB_SEARCH_POLICY: ToolAssignment = {
  toolId: "web-search",
  maxResults: 15,
  priority: 1,
  required: true,
  queryTransform: "policy",
};

const GITHUB_SEARCH_SECONDARY: ToolAssignment = {
  toolId: "github-search",
  maxResults: 10,
  priority: 2,
  required: false,
  queryTransform: "technical",
};

const HACKERNEWS_SEARCH_SECONDARY: ToolAssignment = {
  toolId: "hackernews-search",
  maxResults: 5,
  priority: 3,
  required: false,
  queryTransform: "none",
};

const WEB_SEARCH_TECHNICAL: ToolAssignment = {
  toolId: "web-search",
  maxResults: 15,
  priority: 1,
  required: true,
  queryTransform: "technical",
};

const FINANCE_API_SECONDARY: ToolAssignment = {
  toolId: "finance-api",
  maxResults: 5,
  priority: 2,
  required: false,
  queryTransform: "none",
};

const ARXIV_MIXED_SECONDARY: ToolAssignment = {
  toolId: "arxiv-search",
  maxResults: 5,
  priority: 2,
  required: false,
  queryTransform: "academic",
};

const GITHUB_MIXED_SECONDARY: ToolAssignment = {
  toolId: "github-search",
  maxResults: 5,
  priority: 3,
  required: false,
  queryTransform: "none",
};

// ============================================================================
// Step 覆盖工具分配
// ============================================================================

const ACADEMIC_STEP_ARXIV: ToolAssignment = {
  toolId: "arxiv-search",
  maxResults: 10,
  priority: 1,
  required: false,
  queryTransform: "academic",
};

const ACADEMIC_STEP_SEMANTIC: ToolAssignment = {
  toolId: "semantic-scholar",
  maxResults: 10,
  priority: 2,
  required: false,
  queryTransform: "academic",
};

const ACADEMIC_STEP_WEB_FALLBACK: ToolAssignment = {
  toolId: "web-search",
  maxResults: 10,
  priority: 3,
  required: true,
  queryTransform: "academic",
};

const VERIFICATION_WEB_SEARCH: ToolAssignment = {
  toolId: "web-search",
  maxResults: 15,
  priority: 1,
  required: true,
  queryTransform: "none",
};

const INITIAL_SEARCH_WEB: ToolAssignment = {
  toolId: "web-search",
  maxResults: 20,
  priority: 1,
  required: true,
  queryTransform: "none",
};

// ============================================================================
// 默认工具解析策略表
// ============================================================================

/**
 * 每个 ResearchTopicType 的默认工具解析配置
 */
export const DEFAULT_TOOL_RESOLUTIONS: Record<
  ResearchTopicType,
  ToolResolution
> = {
  academic: {
    tools: [
      ARXIV_PRIMARY,
      SEMANTIC_SCHOLAR_PRIMARY,
      PUBMED_SECONDARY,
      WEB_SEARCH_ACADEMIC_FALLBACK,
    ],
    mode: "parallel",
    maxTotalResults: 25,
  },

  policy: {
    tools: [
      WEB_SEARCH_POLICY,
      FEDERAL_REGISTER_SECONDARY,
      CONGRESS_GOV_SECONDARY,
    ],
    mode: "parallel",
    maxTotalResults: 20,
  },

  technical: {
    tools: [
      WEB_SEARCH_TECHNICAL,
      GITHUB_SEARCH_SECONDARY,
      HACKERNEWS_SEARCH_SECONDARY,
    ],
    mode: "parallel",
    maxTotalResults: 25,
  },

  financial: {
    tools: [WEB_SEARCH_PRIMARY, FINANCE_API_SECONDARY],
    mode: "parallel",
    maxTotalResults: 20,
  },

  general: {
    tools: [WEB_SEARCH_PRIMARY],
    mode: "primary-with-fallback",
    maxTotalResults: 15,
  },

  mixed: {
    tools: [
      WEB_SEARCH_SECONDARY,
      ARXIV_MIXED_SECONDARY,
      GITHUB_MIXED_SECONDARY,
    ],
    mode: "parallel",
    maxTotalResults: 20,
  },
};

// ============================================================================
// Step 类型覆盖配置
// ============================================================================

/**
 * academic step 覆盖：总是包含 arxiv-search 或 semantic-scholar
 */
export const ACADEMIC_STEP_OVERRIDE: ToolResolution = {
  tools: [
    ACADEMIC_STEP_ARXIV,
    ACADEMIC_STEP_SEMANTIC,
    ACADEMIC_STEP_WEB_FALLBACK,
  ],
  mode: "parallel",
  maxTotalResults: 20,
};

/**
 * verification step 覆盖：总是包含 web-search 做权威来源确认
 */
export const VERIFICATION_STEP_OVERRIDE: ToolResolution = {
  tools: [VERIFICATION_WEB_SEARCH],
  mode: "primary-with-fallback",
  maxTotalResults: 15,
};

/**
 * initial_search step 覆盖：用 web-search 做广度搜索
 */
export const INITIAL_SEARCH_STEP_OVERRIDE: ToolResolution = {
  tools: [INITIAL_SEARCH_WEB],
  mode: "primary-with-fallback",
  maxTotalResults: 20,
};

// ============================================================================
// 关键词分类规则
// ============================================================================

/**
 * 各主题类型的关键词匹配规则
 */
export const TOPIC_CLASSIFICATION_RULES: Record<
  Exclude<ResearchTopicType, "general" | "mixed">,
  RegExp
> = {
  academic:
    /论文|paper|研究|research|学术|academic|实验|experiment|模型|model|算法|algorithm|arxiv|pubmed|semantic.?scholar|科研|期刊|journal|dissertation|hypothesis/i,
  policy:
    /政策|policy|法规|regulation|法律|law|政府|government|监管|compliance|联邦|federal|congress|立法|legislation|条例|ordinance|statute/i,
  technical:
    /开源|opensource|open.?source|github|框架|framework|API|SDK|编程|programming|代码|code|架构|architecture|软件|software|库|library|deployment|devops|kubernetes|docker/i,
  financial:
    /股票|stock|market|市场|投资|invest|金融|finance|经济|economy|GDP|收入|revenue|资产|asset|债券|bond|证券|securities|基金|fund|利率|interest.?rate/i,
};

/**
 * mixed 分类阈值：最高分和次高分的最大差距比例
 * 如果差距小于此值，归类为 mixed
 */
export const MIXED_CLASSIFICATION_THRESHOLD = 0.3;

/**
 * Fallback 工具 ID（当 Registry 中无可用工具时使用）
 */
export const FALLBACK_TOOL_ID = "web-search";

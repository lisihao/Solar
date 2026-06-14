/**
 * Leader Types
 *
 * Type definitions for research leader service
 */

// ==================== Core Plan Types ====================

export interface LeaderPlan {
  /** 任务理解 */
  taskUnderstanding: {
    topic: string;
    scope: string;
    objectives: string[];
    constraints?: string[];
  };
  /** Leader 规划的维度列表 */
  dimensions: LeaderPlannedDimension[];
  /** 执行策略 */
  executionStrategy: {
    parallelism: number; // 并行 Agent 数量
    priorityOrder: string[]; // 维度执行优先级
    estimatedTime?: string; // 预估时间
  };
  /** Agent 分配 */
  agentAssignments: AgentAssignment[];
}

export interface LeaderPlannedDimension {
  id: string;
  name: string;
  description: string;
  searchQueries: string[];
  dataSources: string[];
  priority: number;
}

export interface AgentAssignment {
  agentId: string;
  /** Agent 显示名称（用于日志和 UI 展示） */
  agentName?: string;
  agentType: "dimension_researcher" | "quality_reviewer" | "report_writer";
  assignedDimensions?: string[];
  role: string;
  /** ★ Leader 为此 Agent 选择的模型 ID（实现多元化） */
  modelId?: string;
  /** ★ v8.0: Leader 分配给此 Agent 的技能（用于 UI 展示） */
  skills?: string[];
  /** ★ v8.0: Leader 分配给此 Agent 的工具（用于 UI 展示） */
  tools?: string[];
  /** ★ v8.1: Leader 分配此 Agent 和模型的理由 */
  assignmentReason?: {
    agentReason?: string;
    modelReason?: string;
  };
}

export interface ReviewDecision {
  taskId: string;
  status: "approved" | "needs_revision" | "rejected";
  feedback: string;
  suggestions?: string[];
  revisionInstructions?: string;
}

// ==================== Dimension Analysis Types ====================

/**
 * Leader 对维度研究意图的理解
 */
export interface DimensionIntentUnderstanding {
  /** 用户真正想知道什么 */
  coreQuestion: string;
  /** 研究范围 */
  scope: {
    included: string[];
    excluded: string[];
  };
  /** 期望深度 */
  expectedDepth: "overview" | "detailed" | "comprehensive";
  /** 目标受众 */
  targetAudience: string;
  /** 关键关注点 */
  keyFocusAreas: string[];
}

/**
 * Agent 可用的分析技能（语义层面的能力）
 * 这些技能指导 Agent 如何分析和思考问题
 */
export type AnalysisSkill =
  | "trend_analysis" // 趋势分析：识别和预测发展趋势
  | "swot_analysis" // SWOT 分析：优势、劣势、机会、威胁
  | "competitive_analysis" // 竞争分析：分析竞争格局和策略
  | "deep_dive" // 深度调研：深入挖掘特定主题
  | "data_interpretation" // 数据解读：解读数字和统计数据
  | "synthesis" // 综合归纳：整合多源信息形成洞察
  | "critical_thinking" // 批判性思维：质疑和验证信息
  | "future_projection" // 未来预测：基于现状预测发展
  | "cause_effect" // 因果分析：分析原因和影响
  | "comparison" // 对比分析：比较不同方案或事物
  | "dimension_research" // 维度深度研究：结构化维度分析
  | "entity_extraction" // 实体关系提取：知识图谱实体和语义关系
  | "fact_check" // 引用事实核查：核对引用与证据一致性
  | "hypothesis_verification" // 假设验证：根据证据验证研究假设
  | "report_editing"; // 报告编辑：重写、润色、扩展、压缩

/**
 * ★ v8.1: 分析技能定义（用于动态展示）
 * 包含技能 ID、名称和描述
 */
export const ANALYSIS_SKILL_DEFINITIONS: Array<{
  id: AnalysisSkill;
  name: string;
  description: string;
}> = [
  { id: "trend_analysis", name: "趋势分析", description: "识别和预测发展趋势" },
  {
    id: "swot_analysis",
    name: "SWOT分析",
    description: "分析优势、劣势、机会、威胁",
  },
  {
    id: "competitive_analysis",
    name: "竞争分析",
    description: "分析竞争格局和策略",
  },
  { id: "deep_dive", name: "深度调研", description: "深入挖掘特定主题" },
  {
    id: "data_interpretation",
    name: "数据解读",
    description: "解读数字和统计数据",
  },
  {
    id: "synthesis",
    name: "综合归纳",
    description: "整合多源信息形成洞察",
  },
  {
    id: "critical_thinking",
    name: "批判性思维",
    description: "质疑和验证信息",
  },
  {
    id: "future_projection",
    name: "未来预测",
    description: "基于现状预测发展",
  },
  { id: "cause_effect", name: "因果分析", description: "分析原因和影响" },
  { id: "comparison", name: "对比分析", description: "比较不同方案或事物" },
  {
    id: "dimension_research",
    name: "维度深度研究",
    description: "结构化维度分析，含核心发现、趋势、挑战、机会",
  },
  {
    id: "entity_extraction",
    name: "实体关系提取",
    description: "从文本中提取知识图谱实体和语义关系",
  },
  {
    id: "fact_check",
    name: "引用事实核查",
    description: "核对报告引用与原始证据的一致性",
  },
  {
    id: "hypothesis_verification",
    name: "假设验证",
    description: "根据证据验证研究假设",
  },
  {
    id: "report_editing",
    name: "报告编辑",
    description: "重写、润色、扩展、压缩和风格调整",
  },
];

/**
 * Agent 章节配置
 * Leader 为 Agent 指定的执行配置
 */
export interface AgentSectionConfig {
  /**
   * AI Engine 工具列表（可选）
   * 使用 AI Engine 的 BUILTIN_TOOLS 常量
   * 如: "web-search", "data-analysis", "rag-search"
   */
  tools?: string[];

  /**
   * 分析技能列表
   * 指导 Agent 如何分析问题
   */
  skills?: AnalysisSkill[];

  /**
   * 分析指导
   * Leader 对 Agent 的具体指导，如分析角度、注意事项
   */
  analysisGuidance?: string;

  /**
   * 数据源偏好
   * 指定优先使用的数据源类型
   */
  preferredDataSources?: ("web" | "academic" | "news" | "internal")[];

  /**
   * 输出风格
   * 指导输出的风格和语气
   */
  outputStyle?: "analytical" | "narrative" | "concise" | "detailed";
}

/**
 * Leader 预分配给章节的图表
 */
export interface AllocatedFigure {
  /** 图表唯一 ID（如 FIG-1），从可用图表列表中选择 */
  figureId: string;
  /** 图片 URL — 由系统从 figureRegistry 回填，LLM 不输出此字段 */
  imageUrl: string;
  /** 图表标题/说明 */
  caption: string;
  /** 为什么分配给这个章节 */
  relevanceReason: string;
}

/**
 * Leader 规划的章节
 */
export interface SectionPlan {
  id: string;
  title: string;
  description: string;
  keyPoints: string[];
  targetWords: number;
  evidenceRequirements: {
    minReferences: number;
    preferredSources?: string[];
  };
  dependsOn?: string[];
  /** Agent 执行配置 */
  agentConfig?: AgentSectionConfig;
  /** ★ Leader 预分配的图表（避免写手重复选图） */
  allocatedFigures?: AllocatedFigure[];
}

/**
 * Leader 规划的维度分析大纲
 */
export interface DimensionOutline {
  /** 意图理解 */
  intentUnderstanding: DimensionIntentUnderstanding;
  /** 章节列表 */
  sections: SectionPlan[];
  /** 执行策略 */
  executionPlan: {
    parallelGroups: string[][];
    estimatedTotalWords: number;
  };
  /**
   * ★ 动态证据权重提示
   * Leader 根据维度特征指定证据来源偏好，用于 filterEvidenceForSection 阶段的加权排序
   */
  evidenceWeightHint?: {
    freshnessSensitivity: "high" | "medium" | "low";
    preferredSources: string[];
    deprioritizedSources?: string[];
    reason: string;
  };
}

/**
 * 章节审核决策
 */
export interface SectionReviewDecision {
  sectionId: string;
  approved: boolean;
  score: number;
  feedback: string;
  revisionInstructions?: string;
}

/**
 * 整合后的维度分析结果
 */
export interface IntegratedDimensionResult {
  content: string;
  metadata: {
    summary: string;
    keyFindings: string[];
    confidenceLevel: "high" | "medium" | "low";
  };
  evidenceUsed: string[];
  totalWords: number;
}

export interface LeaderModelInfo {
  modelId: string;
  modelName: string;
  provider: string;
  isReasoning: boolean;
}

/**
 * 全局协调的大纲（Phase 2）
 */
export interface GlobalOutline {
  /** 各维度的协调大纲 */
  dimensions: Array<{
    dimensionId: string;
    dimensionName: string;
    outline: DimensionOutline;
    crossDimensionNotes: string;
  }>;
  /** 全局主题（跨维度共同发现） */
  globalThemes: string[];
  /** 去重规则（避免重复覆盖） */
  deduplicationRules: string[];
  /** V5: 研究设计 */
  researchDesign?: import("./research-depth.types").ResearchDesign;
}

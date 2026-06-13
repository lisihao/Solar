/**
 * Research Template Types
 *
 * P1: 研究模板库
 * 行业/场景预设模板，快速启动不同类型的研究
 */

/**
 * 模板类别
 */
export enum TemplateCategory {
  /** 行业分析 */
  INDUSTRY_ANALYSIS = "industry_analysis",
  /** 竞品分析 */
  COMPETITIVE_ANALYSIS = "competitive_analysis",
  /** 市场调研 */
  MARKET_RESEARCH = "market_research",
  /** 技术评估 */
  TECHNOLOGY_EVALUATION = "technology_evaluation",
  /** 政策分析 */
  POLICY_ANALYSIS = "policy_analysis",
  /** 投资研究 */
  INVESTMENT_RESEARCH = "investment_research",
  /** 学术文献综述 */
  LITERATURE_REVIEW = "literature_review",
  /** 趋势预测 */
  TREND_FORECAST = "trend_forecast",
  /** SWOT 分析 */
  SWOT_ANALYSIS = "swot_analysis",
  /** 风险评估 */
  RISK_ASSESSMENT = "risk_assessment",
}

/**
 * 研究模板定义
 */
export interface ResearchTemplate {
  /** 模板 ID */
  id: string;
  /** 模板名称 */
  name: string;
  /** 模板描述 */
  description: string;
  /** 模板类别 */
  category: TemplateCategory;
  /** 适用行业/场景标签 */
  tags: string[];
  /** 预设维度列表 */
  dimensions: TemplateDimension[];
  /** 推荐数据源 */
  recommendedSources: string[];
  /** 推荐研究深度 */
  recommendedDepth: "quick" | "standard" | "deep" | "comprehensive";
  /** 模板参数（需要用户填充） */
  parameters: TemplateParameter[];
  /** 研究指导语 */
  guidancePrompt: string;
  /** 报告结构模板 */
  reportStructure?: ReportStructureTemplate;
  /** 使用次数 */
  usageCount: number;
  /** 是否内置 */
  isBuiltIn: boolean;
  /** 创建者用户 ID（自定义模板） */
  createdBy?: string;
}

/**
 * 模板维度
 */
export interface TemplateDimension {
  /** 维度名称 */
  name: string;
  /** 维度描述 */
  description: string;
  /** 搜索查询关键词模板 */
  queryTemplates: string[];
  /** 推荐数据源 */
  sources: string[];
  /** 是否必须 */
  required: boolean;
  /** 排序权重 */
  weight: number;
}

/**
 * 模板参数
 */
export interface TemplateParameter {
  /** 参数名 */
  key: string;
  /** 显示名称 */
  label: string;
  /** 参数类型 */
  type: "text" | "select" | "multiselect" | "number" | "date";
  /** 是否必填 */
  required: boolean;
  /** 默认值 */
  defaultValue?: string | number;
  /** 可选项（select/multiselect） */
  options?: Array<{ label: string; value: string }>;
  /** 占位符 */
  placeholder?: string;
  /** 帮助文本 */
  helpText?: string;
}

/**
 * 报告结构模板
 */
export interface ReportStructureTemplate {
  /** 报告标题模板 */
  titleTemplate: string;
  /** 章节结构 */
  sections: Array<{
    title: string;
    description: string;
    required: boolean;
  }>;
  /** 是否包含执行摘要 */
  includeExecutiveSummary: boolean;
  /** 是否包含可信度报告 */
  includeCredibilityReport: boolean;
  /** 是否包含参考文献 */
  includeBibliography: boolean;
}

/**
 * 模板应用结果
 */
export interface TemplateApplicationResult {
  /** 生成的专题名称 */
  topicName: string;
  /** 生成的维度列表 */
  dimensions: Array<{
    name: string;
    description: string;
    searchQueries: string[];
    searchSources: string[];
  }>;
  /** 研究配置 */
  researchConfig: {
    depth: string;
    sources: string[];
    guidancePrompt: string;
  };
}

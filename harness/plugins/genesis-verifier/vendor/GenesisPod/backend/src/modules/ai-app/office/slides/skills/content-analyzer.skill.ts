/**
 * Slides Engine v4.0 - Content Analyzer Skill
 *
 * 内容分析技能：分析内容的"形状"，提取布局决策所需的特征
 * 这是内容驱动架构的核心组件，用于替代硬编码的模板容量配置
 */

import { Injectable, Logger } from "@nestjs/common";
import {
  ISkill,
  SkillContext,
  SkillResult,
  SkillLayer,
  SKILL_LAYERS,
} from "@/modules/ai-harness/facade";
import {
  PageContent,
  ContentSection,
  StatContent,
} from "../checkpoint/checkpoint.types";

// ============================================================================
// Content Features Types
// ============================================================================

/**
 * 内容类型分布
 */
export interface SectionTypeDistribution {
  /** 统计数字数量 */
  stat: number;
  /** 列表数量 */
  list: number;
  /** 文本段落数量 */
  text: number;
  /** 图表数量 */
  chart: number;
  /** 图片数量 */
  image: number;
  /** 引用数量 */
  quote: number;
}

/**
 * 对比分析结果
 */
export interface ComparisonAnalysis {
  /** 是否检测到对比结构 */
  detected: boolean;
  /** 对比项数量 */
  count: number;
  /** 对比类型 */
  type: "binary" | "multi" | "none";
  /** 对比维度 */
  dimensions: string[];
}

/**
 * 支柱分析结果
 */
export interface PillarAnalysis {
  /** 是否检测到支柱结构 */
  detected: boolean;
  /** 支柱数量 */
  count: number;
  /** 支柱标题列表 */
  titles: string[];
  /** 是否有层级关系 */
  hasHierarchy: boolean;
}

/**
 * 时间线分析结果
 */
export interface TimelineAnalysis {
  /** 是否检测到时间线结构 */
  detected: boolean;
  /** 时间节点数量 */
  nodeCount: number;
  /** 时间范围 */
  timeRange?: {
    start: string;
    end: string;
  };
  /** 是否有明确的时间顺序 */
  hasSequence: boolean;
}

/**
 * 数据密度分析
 */
export interface DataDensity {
  /** 数据点总数 */
  dataPointCount: number;
  /** 数字密度（每100字符的数字数量） */
  numericDensity: number;
  /** 百分比数量 */
  percentageCount: number;
  /** 货币数量 */
  currencyCount: number;
  /** 是否有关键洞察 */
  hasKeyInsight: boolean;
  /** 关键洞察内容 */
  keyInsights: string[];
}

/**
 * 视觉复杂度等级
 */
export type VisualComplexity = "simple" | "moderate" | "complex" | "dense";

/**
 * 推荐布局类型
 */
export type RecommendedLayout =
  | "single-focus" // 单焦点（封面、章节页）
  | "data-dashboard" // 数据仪表盘
  | "comparison-grid" // 对比网格（支持2-4列）
  | "content-flow" // 内容流（列表+文本）
  | "visual-story" // 视觉故事（图片+文字）
  | "pillar-showcase" // 支柱展示（支持2-6个）
  | "timeline-progress" // 时间线/进度
  | "insight-highlight" // 洞察高亮
  | "mixed-content"; // 混合内容

/**
 * MissionOrchestrator 传递的输入格式
 */
interface OrchestratorInput {
  task?: string;
  context?: {
    pageContent?: PageContent;
    [key: string]: unknown;
  };
  previousOutputs?: Record<string, unknown>;
}

/**
 * 内容分析结果（ContentAnalyzer 的输出）
 * 注意：与 page-type-selection.skill.ts 中的 ContentFeatures 不同
 */
export interface ContentAnalysisResult {
  // === 内容类型分布 ===
  sectionTypes: SectionTypeDistribution;

  // === 内容量指标 ===
  totalSections: number;
  totalCharacters: number;
  averageSectionLength: number;
  maxSectionLength: number;
  minSectionLength: number;

  // === 逻辑结构 ===
  comparison: ComparisonAnalysis;
  pillars: PillarAnalysis;
  timeline: TimelineAnalysis;

  // === 数据密度 ===
  dataDensity: DataDensity;

  // === 视觉建议 ===
  visualComplexity: VisualComplexity;
  recommendedLayout: RecommendedLayout;

  // === 网格建议 ===
  suggestedGrid: {
    columns: number;
    rows: number;
    reason: string;
  };

  // === 容量估算 ===
  estimatedCapacity: {
    fitsOnOnePage: boolean;
    suggestedPageCount: number;
    overflowSections: number;
  };

  // === 元数据 ===
  analyzedAt: Date;
  analysisVersion: string;
}

// ============================================================================
// Content Analyzer Service
// ============================================================================

@Injectable()
export class ContentAnalyzerSkill implements ISkill<
  PageContent,
  ContentAnalysisResult
> {
  private readonly logger = new Logger(ContentAnalyzerSkill.name);
  private readonly ANALYSIS_VERSION = "4.0.0";

  // ============================================================================
  // ISkill Implementation - Required Properties
  // ============================================================================

  readonly id = "slides-content-analyzer";
  readonly name = "内容分析";
  readonly description = "分析文本内容，提取关键信息和结构";
  readonly layer: SkillLayer = SKILL_LAYERS.UNDERSTANDING;
  readonly domain = "slides";
  readonly tags = ["slides", "content", "analysis", "understanding"];
  readonly version = "4.0.0";

  // ============================================================================
  // Configuration
  // ============================================================================

  // 页面最大容量配置（基于视觉舒适度，而非硬编码）
  private readonly MAX_SECTIONS_PER_PAGE = 6;
  private readonly MAX_CHARS_PER_PAGE = 800;
  private readonly OPTIMAL_SECTIONS = { min: 2, max: 4 };

  // ============================================================================
  // ISkill execute method
  // ============================================================================

  /**
   * 执行技能 - ISkill 接口实现
   * 执行内容分析并返回标准化的 SkillResult
   *
   * 支持两种输入格式：
   * 1. 直接调用: PageContent
   * 2. MissionOrchestrator 格式: { task, context, previousOutputs }
   */
  async execute(
    input: PageContent | OrchestratorInput,
    context: SkillContext,
  ): Promise<SkillResult<ContentAnalysisResult>> {
    const startTime = new Date();

    // 处理 Orchestrator 输入格式
    const content = this.normalizeInput(input);
    if (!content?.title) {
      return {
        success: false,
        error: {
          code: "INVALID_INPUT",
          message: "Missing or invalid PageContent in input",
          retryable: false,
        },
        metadata: {
          executionId: context.executionId,
          startTime,
          endTime: new Date(),
          duration: Date.now() - startTime.getTime(),
        },
      };
    }

    try {
      this.logger.debug(
        `[execute] Starting content analysis - executionId: ${context.executionId}`,
      );

      // 执行分析逻辑
      const result = this.analyze(content);

      const endTime = new Date();

      this.logger.log(
        `[execute] Content analysis completed - executionId: ${context.executionId}, duration: ${endTime.getTime() - startTime.getTime()}ms`,
      );

      // 返回标准化的 SkillResult
      return {
        success: true,
        data: result,
        metadata: {
          executionId: context.executionId,
          startTime,
          endTime,
          duration: endTime.getTime() - startTime.getTime(),
        },
      };
    } catch (error) {
      const endTime = new Date();
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(
        `[execute] Content analysis failed - executionId: ${context.executionId}, error: ${errorMessage}`,
        error instanceof Error ? error.stack : undefined,
      );

      return {
        success: false,
        error: {
          code: "CONTENT_ANALYSIS_ERROR",
          message: errorMessage,
          details: {
            executionId: context.executionId,
          },
        },
        metadata: {
          executionId: context.executionId,
          startTime,
          endTime,
          duration: endTime.getTime() - startTime.getTime(),
        },
      };
    }
  }

  /**
   * 规范化输入格式
   * 支持直接调用格式和 MissionOrchestrator 格式
   */
  private normalizeInput(input: PageContent | OrchestratorInput): PageContent {
    // 检查是否是直接调用格式（PageContent 有 title 和 sections）
    if ("title" in input && "sections" in input) {
      return input;
    }

    // 处理 Orchestrator 格式
    const orchestratorInput = input;
    const context = orchestratorInput.context || {};

    // 尝试从 context 获取 pageContent
    if (context.pageContent) {
      return context.pageContent;
    }

    // 返回空的 PageContent，让调用者处理错误
    this.logger.warn(
      `[normalizeInput] Could not extract PageContent from input`,
    );
    return { title: "", sections: [] } as unknown as PageContent;
  }

  // ============================================================================
  // Existing public methods (for backward compatibility)
  // ============================================================================

  /**
   * 分析页面内容，提取布局决策所需的特征
   * 注：推荐使用 execute() 方法以获取标准化的 SkillResult
   */
  analyze(content: PageContent): ContentAnalysisResult {
    this.logger.debug(
      `[analyze] Starting content analysis for: "${content.title}"`,
    );

    const sections = content.sections || [];

    // 1. 统计内容类型分布
    const sectionTypes = this.countSectionTypes(sections);

    // 2. 计算内容量指标
    const contentMetrics = this.calculateContentMetrics(content);

    // 3. 检测逻辑结构
    const comparison = this.detectComparison(sections, content);
    const pillars = this.detectPillars(sections, content);
    const timeline = this.detectTimeline(sections, content);

    // 4. 分析数据密度
    const dataDensity = this.analyzeDataDensity(content);

    // 5. 评估视觉复杂度
    const visualComplexity = this.assessVisualComplexity(
      sectionTypes,
      contentMetrics,
      dataDensity,
    );

    // 6. 推荐布局类型
    const recommendedLayout = this.recommendLayout(
      sectionTypes,
      comparison,
      pillars,
      timeline,
      dataDensity,
    );

    // 7. 计算网格建议
    const suggestedGrid = this.calculateGridSuggestion(
      sections.length,
      comparison,
      pillars,
      recommendedLayout,
    );

    // 8. 估算容量
    const estimatedCapacity = this.estimateCapacity(contentMetrics);

    const features: ContentAnalysisResult = {
      sectionTypes,
      ...contentMetrics,
      comparison,
      pillars,
      timeline,
      dataDensity,
      visualComplexity,
      recommendedLayout,
      suggestedGrid,
      estimatedCapacity,
      analyzedAt: new Date(),
      analysisVersion: this.ANALYSIS_VERSION,
    };

    this.logger.log(
      `[analyze] Analysis complete: layout=${recommendedLayout}, grid=${suggestedGrid.columns}x${suggestedGrid.rows}, complexity=${visualComplexity}`,
    );

    return features;
  }

  /**
   * 统计内容类型分布
   */
  private countSectionTypes(
    sections: ContentSection[],
  ): SectionTypeDistribution {
    const types: SectionTypeDistribution = {
      stat: 0,
      list: 0,
      text: 0,
      chart: 0,
      image: 0,
      quote: 0,
    };

    for (const section of sections) {
      if (section.type in types) {
        types[section.type as keyof SectionTypeDistribution]++;
      }
    }

    return types;
  }

  /**
   * 计算内容量指标
   */
  private calculateContentMetrics(content: PageContent): {
    totalSections: number;
    totalCharacters: number;
    averageSectionLength: number;
    maxSectionLength: number;
    minSectionLength: number;
  } {
    const sections = content.sections || [];
    const lengths = sections.map((s) => this.getSectionLength(s));

    const totalSections = sections.length;
    const totalCharacters =
      (content.title?.length || 0) +
      (content.subtitle?.length || 0) +
      lengths.reduce((a, b) => a + b, 0);

    return {
      totalSections,
      totalCharacters,
      averageSectionLength:
        lengths.length > 0
          ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length)
          : 0,
      maxSectionLength: lengths.length > 0 ? Math.max(...lengths) : 0,
      minSectionLength: lengths.length > 0 ? Math.min(...lengths) : 0,
    };
  }

  /**
   * 获取单个 section 的字符长度
   */
  private getSectionLength(section: ContentSection): number {
    if (typeof section.content === "string") {
      return section.content.length;
    }
    if (Array.isArray(section.content)) {
      return section.content.join("").length;
    }
    if (typeof section.content === "object" && section.content !== null) {
      // StatContent
      if ("value" in section.content && "label" in section.content) {
        const stat = section.content;
        return (stat.value || "").length + (stat.label || "").length;
      }
      // ChartContent
      if ("type" in section.content && "data" in section.content) {
        const chart = section.content as { title?: string };
        return (chart.title || "").length + 50; // 图表估算
      }
    }
    return 0;
  }

  /**
   * 检测对比结构
   */
  private detectComparison(
    sections: ContentSection[],
    content: PageContent,
  ): ComparisonAnalysis {
    const result: ComparisonAnalysis = {
      detected: false,
      count: 0,
      type: "none",
      dimensions: [],
    };

    // 检查标题是否包含对比关键词
    const title = (content.title || "").toLowerCase();
    const comparisonKeywords = [
      "vs",
      "对比",
      "比较",
      "versus",
      "与",
      "和",
      "相比",
      "差异",
      "区别",
      "优劣",
    ];
    const hasComparisonTitle = comparisonKeywords.some((kw) =>
      title.includes(kw),
    );

    // 检查是否有多个并列的 stat 或 list sections
    const statSections = sections.filter((s) => s.type === "stat");
    const listSections = sections.filter((s) => s.type === "list");

    // 左右对称的 sections 表示对比
    const leftSections = sections.filter((s) => s.position === "left");
    const rightSections = sections.filter((s) => s.position === "right");
    const hasSymmetricLayout =
      leftSections.length > 0 &&
      rightSections.length > 0 &&
      leftSections.length === rightSections.length;

    if (hasComparisonTitle || hasSymmetricLayout) {
      result.detected = true;
      result.count = hasSymmetricLayout
        ? leftSections.length + rightSections.length
        : Math.max(statSections.length, listSections.length, 2);
      result.type = result.count === 2 ? "binary" : "multi";

      // 提取对比维度
      if (hasSymmetricLayout) {
        result.dimensions = [
          ...leftSections.map(() => "left"),
          ...rightSections.map(() => "right"),
        ];
      }
    }

    return result;
  }

  /**
   * 检测支柱结构
   */
  private detectPillars(
    sections: ContentSection[],
    content: PageContent,
  ): PillarAnalysis {
    const result: PillarAnalysis = {
      detected: false,
      count: 0,
      titles: [],
      hasHierarchy: false,
    };

    // 检查标题是否包含支柱关键词
    const title = (content.title || "").toLowerCase();
    const pillarKeywords = [
      "支柱",
      "核心",
      "要素",
      "关键",
      "基础",
      "pillar",
      "core",
      "key",
      "foundation",
      "原则",
      "维度",
      "方面",
    ];
    const hasPillarTitle = pillarKeywords.some((kw) => title.includes(kw));

    // 检查是否有多个并列的 stat 类型
    const statSections = sections.filter((s) => s.type === "stat");
    if (statSections.length >= 3) {
      result.detected = true;
      result.count = statSections.length;
      result.titles = statSections.map((s) => {
        const stat = s.content as StatContent;
        return stat.label || "";
      });
    }

    // 检查是否有编号列表
    const listSections = sections.filter((s) => s.type === "list");
    for (const listSection of listSections) {
      if (Array.isArray(listSection.content)) {
        const items = listSection.content;
        // 检查是否有编号模式
        const hasNumbering = items.some((item) => /^[\d①②③④⑤⑥⑦⑧⑨⑩]/.test(item));
        if (hasNumbering && items.length >= 3) {
          result.detected = true;
          result.count = Math.max(result.count, items.length);
          result.titles = items.map((item) =>
            item.replace(/^[\d①②③④⑤⑥⑦⑧⑨⑩][.、:：\s]*/, "").slice(0, 20),
          );
        }
      }
    }

    // 如果标题暗示支柱但未检测到，使用 sections 数量
    if (hasPillarTitle && !result.detected && sections.length >= 2) {
      result.detected = true;
      result.count = sections.length;
    }

    return result;
  }

  /**
   * 检测时间线结构
   */
  private detectTimeline(
    sections: ContentSection[],
    content: PageContent,
  ): TimelineAnalysis {
    const result: TimelineAnalysis = {
      detected: false,
      nodeCount: 0,
      hasSequence: false,
    };

    // 检查标题是否包含时间线关键词
    const title = (content.title || "").toLowerCase();
    const timelineKeywords = [
      "时间线",
      "路线图",
      "发展史",
      "历程",
      "演进",
      "进化",
      "阶段",
      "里程碑",
      "timeline",
      "roadmap",
      "evolution",
      "history",
      "phase",
      "milestone",
    ];
    const hasTimelineTitle = timelineKeywords.some((kw) => title.includes(kw));

    // 检查内容中是否有年份模式
    const yearPattern = /\b(19|20)\d{2}\b/g;
    const allContent = this.extractAllText(content);
    const years = allContent.match(yearPattern) || [];
    const uniqueYears = [...new Set(years)];

    if (uniqueYears.length >= 2) {
      result.detected = true;
      result.nodeCount = uniqueYears.length;
      result.hasSequence = true;
      const sortedYears = uniqueYears.sort();
      result.timeRange = {
        start: sortedYears[0],
        end: sortedYears[sortedYears.length - 1],
      };
    }

    // 检查是否有阶段性关键词
    const stagePattern =
      /第[一二三四五六七八九十\d]+阶段|Phase\s*\d+|Step\s*\d+/gi;
    const stages = allContent.match(stagePattern) || [];
    if (stages.length >= 2) {
      result.detected = true;
      result.nodeCount = Math.max(result.nodeCount, stages.length);
      result.hasSequence = true;
    }

    if (hasTimelineTitle && !result.detected) {
      result.detected = true;
      result.nodeCount = sections.length;
    }

    return result;
  }

  /**
   * 分析数据密度
   */
  private analyzeDataDensity(content: PageContent): DataDensity {
    const allText = this.extractAllText(content);

    // 计数各类数据点
    const numberPattern = /\d+(\.\d+)?/g;
    const percentagePattern = /\d+(\.\d+)?%/g;
    const currencyPattern =
      /[\$\¥\€\£]\d+|\d+[\$\¥\€\£]|亿|万|billion|million/gi;

    const numbers = allText.match(numberPattern) || [];
    const percentages = allText.match(percentagePattern) || [];
    const currencies = allText.match(currencyPattern) || [];

    // 提取关键洞察（包含数字的完整句子）
    const sentences = allText.split(/[。.!！?？\n]/);
    const keyInsights = sentences.filter(
      (s) => s.length > 10 && /\d+/.test(s) && s.length < 100,
    );

    const textLength = allText.length || 1;

    return {
      dataPointCount: numbers.length,
      numericDensity: (numbers.length / textLength) * 100,
      percentageCount: percentages.length,
      currencyCount: currencies.length,
      hasKeyInsight: keyInsights.length > 0,
      keyInsights: keyInsights.slice(0, 3),
    };
  }

  /**
   * 提取所有文本内容
   */
  private extractAllText(content: PageContent): string {
    const parts: string[] = [content.title || "", content.subtitle || ""];

    for (const section of content.sections || []) {
      if (typeof section.content === "string") {
        parts.push(section.content);
      } else if (Array.isArray(section.content)) {
        parts.push(...section.content);
      } else if (
        typeof section.content === "object" &&
        section.content !== null
      ) {
        // StatContent
        if ("value" in section.content) {
          const stat = section.content;
          parts.push(stat.value || "");
          parts.push(stat.label || "");
        }
        // ChartContent
        if ("title" in section.content) {
          const chart = section.content as { title?: string };
          parts.push(chart.title || "");
        }
      }
    }

    return parts.join(" ");
  }

  /**
   * 评估视觉复杂度
   */
  private assessVisualComplexity(
    types: SectionTypeDistribution,
    metrics: { totalSections: number; totalCharacters: number },
    dataDensity: DataDensity,
  ): VisualComplexity {
    const score =
      metrics.totalSections * 2 +
      types.chart * 3 +
      types.stat * 1 +
      (dataDensity.dataPointCount > 5 ? 2 : 0) +
      (metrics.totalCharacters > 500 ? 2 : 0);

    if (score <= 4) return "simple";
    if (score <= 8) return "moderate";
    if (score <= 12) return "complex";
    return "dense";
  }

  /**
   * 推荐布局类型
   */
  private recommendLayout(
    types: SectionTypeDistribution,
    comparison: ComparisonAnalysis,
    pillars: PillarAnalysis,
    timeline: TimelineAnalysis,
    dataDensity: DataDensity,
  ): RecommendedLayout {
    // 优先级顺序：时间线 > 对比 > 支柱 > 数据 > 内容流

    if (timeline.detected && timeline.nodeCount >= 3) {
      return "timeline-progress";
    }

    if (comparison.detected && comparison.count >= 2) {
      return "comparison-grid";
    }

    if (pillars.detected && pillars.count >= 3) {
      return "pillar-showcase";
    }

    if (types.stat >= 3 || types.chart >= 1) {
      return "data-dashboard";
    }

    if (dataDensity.hasKeyInsight && dataDensity.keyInsights.length >= 2) {
      return "insight-highlight";
    }

    if (types.image >= 1 && types.text >= 1) {
      return "visual-story";
    }

    if (types.list >= 1 || types.text >= 2) {
      return "content-flow";
    }

    // 默认
    return "mixed-content";
  }

  /**
   * 计算网格建议
   */
  private calculateGridSuggestion(
    sectionCount: number,
    comparison: ComparisonAnalysis,
    pillars: PillarAnalysis,
    layout: RecommendedLayout,
  ): { columns: number; rows: number; reason: string } {
    // 根据布局类型决定网格
    switch (layout) {
      case "comparison-grid":
        const compCols = Math.min(comparison.count, 4);
        return {
          columns: compCols,
          rows: 1,
          reason: `${comparison.count} 个对比项，使用 ${compCols} 列网格`,
        };

      case "pillar-showcase":
        if (pillars.count <= 3) {
          return {
            columns: pillars.count,
            rows: 1,
            reason: `${pillars.count} 个支柱，单行展示`,
          };
        } else if (pillars.count <= 6) {
          const cols = Math.ceil(pillars.count / 2);
          return {
            columns: cols,
            rows: 2,
            reason: `${pillars.count} 个支柱，使用 ${cols}x2 网格`,
          };
        } else {
          return {
            columns: 3,
            rows: Math.ceil(pillars.count / 3),
            reason: `${pillars.count} 个支柱，使用 3 列多行网格`,
          };
        }

      case "data-dashboard":
        if (sectionCount <= 2) {
          return { columns: 2, rows: 1, reason: "数据仪表盘，双列布局" };
        } else if (sectionCount <= 4) {
          return { columns: 2, rows: 2, reason: "数据仪表盘，2x2 网格" };
        } else {
          return { columns: 3, rows: 2, reason: "数据仪表盘，3x2 网格" };
        }

      case "timeline-progress":
        return {
          columns: 1,
          rows: 1,
          reason: "时间线布局，全宽单行",
        };

      case "content-flow":
        return {
          columns: sectionCount <= 2 ? 1 : 2,
          rows: 1,
          reason: "内容流布局",
        };

      case "visual-story":
        return { columns: 2, rows: 1, reason: "图文混排，双列布局" };

      case "insight-highlight":
        return { columns: 1, rows: 2, reason: "洞察高亮，上下布局" };

      default:
        // 根据 section 数量动态计算
        if (sectionCount <= 2) {
          return { columns: sectionCount, rows: 1, reason: "少量内容，单行" };
        } else if (sectionCount <= 4) {
          return { columns: 2, rows: 2, reason: "适中内容，2x2 网格" };
        } else {
          return {
            columns: 3,
            rows: Math.ceil(sectionCount / 3),
            reason: "较多内容，3 列网格",
          };
        }
    }
  }

  /**
   * 估算容量
   */
  private estimateCapacity(metrics: {
    totalSections: number;
    totalCharacters: number;
  }): {
    fitsOnOnePage: boolean;
    suggestedPageCount: number;
    overflowSections: number;
  } {
    const sectionsOverflow = Math.max(
      0,
      metrics.totalSections - this.MAX_SECTIONS_PER_PAGE,
    );
    const charsOverflow = Math.max(
      0,
      metrics.totalCharacters - this.MAX_CHARS_PER_PAGE,
    );

    const fitsOnOnePage = sectionsOverflow === 0 && charsOverflow === 0;

    let suggestedPageCount = 1;
    if (!fitsOnOnePage) {
      // 根据溢出量计算需要的页数
      const pagesBySection = Math.ceil(
        metrics.totalSections / this.OPTIMAL_SECTIONS.max,
      );
      const pagesByChars = Math.ceil(
        metrics.totalCharacters / this.MAX_CHARS_PER_PAGE,
      );
      suggestedPageCount = Math.max(pagesBySection, pagesByChars);
    }

    return {
      fitsOnOnePage,
      suggestedPageCount,
      overflowSections: sectionsOverflow,
    };
  }

  /**
   * 快速检查是否需要拆分页面
   */
  needsSplit(content: PageContent): boolean {
    const features = this.analyze(content);
    return !features.estimatedCapacity.fitsOnOnePage;
  }

  /**
   * 获取拆分建议
   */
  getSplitSuggestion(content: PageContent): {
    shouldSplit: boolean;
    suggestedPageCount: number;
    sectionsPerPage: number;
  } {
    const features = this.analyze(content);
    const totalSections = features.totalSections;

    if (features.estimatedCapacity.fitsOnOnePage) {
      return {
        shouldSplit: false,
        suggestedPageCount: 1,
        sectionsPerPage: totalSections,
      };
    }

    const pageCount = features.estimatedCapacity.suggestedPageCount;
    const sectionsPerPage = Math.ceil(totalSections / pageCount);

    return {
      shouldSplit: true,
      suggestedPageCount: pageCount,
      sectionsPerPage: Math.min(sectionsPerPage, this.MAX_SECTIONS_PER_PAGE),
    };
  }
}

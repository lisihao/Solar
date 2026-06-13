/**
 * Slides Engine v3.0 - Page Type Selection Skill
 *
 * 页面类型选择技能：根据内容特征选择最合适的模板类型
 * 使用规则引擎 + AI 辅助决策
 */

import { Injectable, Logger } from "@nestjs/common";
import { PageTemplateType, PageOutline } from "../checkpoint/checkpoint.types";
import {
  ISkill,
  SkillContext,
  SkillResult,
  SkillLayer,
  SKILL_LAYERS,
} from "@/modules/ai-harness/facade";

/**
 * MissionOrchestrator 输入格式
 */
export interface PageTypeSelectionOrchestratorInput {
  task?: string;
  context?: {
    input?: {
      pageOutlines?: PageOutline[];
    };
    [key: string]: unknown;
  };
  previousOutputs?: Record<string, unknown>;
}

/**
 * 内容特征分析结果
 */
export interface ContentFeatures {
  /** 是否有标题 */
  hasTitle: boolean;
  /** 是否有副标题 */
  hasSubtitle: boolean;
  /** 是否有列表 */
  hasList: boolean;
  /** 列表项数量 */
  listItemCount: number;
  /** 是否有数据 */
  hasData: boolean;
  /** 数据点数量 */
  dataPointCount: number;
  /** 是否有时间线 */
  hasTimeline: boolean;
  /** 时间点数量 */
  timelinePointCount: number;
  /** 是否有对比 */
  hasComparison: boolean;
  /** 对比项数量 */
  comparisonItemCount: number;
  /** 是否有引用 */
  hasQuote: boolean;
  /** 是否有图表需求 */
  hasChartRequirement: boolean;
  /** 图表类型 */
  chartTypes: string[];
  /** 内容复杂度 (1-5) */
  complexityScore: number;
  /** 是否为章节开头 */
  isChapterStart: boolean;
  /** 是否为章节结尾 */
  isChapterEnd: boolean;
  /** 关键词 */
  keywords: string[];
}

/**
 * 模板匹配规则
 */
interface TemplateRule {
  templateType: PageTemplateType;
  conditions: (features: ContentFeatures) => boolean;
  priority: number;
  description: string;
}

/**
 * 模板匹配规则定义
 */
const TEMPLATE_RULES: TemplateRule[] = [
  // 封面页 - 页码为 1
  {
    templateType: "cover",
    conditions: (f) =>
      f.isChapterStart &&
      f.keywords.some((k) => k.includes("封面") || k.includes("标题")),
    priority: 100,
    description: "封面页",
  },
  // 目录页 - 有多个章节列表
  {
    templateType: "toc",
    conditions: (f) =>
      f.keywords.some((k) => k.includes("目录") || k.includes("内容")),
    priority: 99,
    description: "目录页",
  },
  // 问题页 - 有多个问题
  {
    templateType: "questions",
    conditions: (f) =>
      f.hasList &&
      f.listItemCount >= 3 &&
      f.keywords.some((k) => k.includes("问题") || k.includes("挑战")),
    priority: 85,
    description: "核心问题页",
  },
  // 支柱页 - 3-5 个核心支柱
  {
    templateType: "pillars",
    conditions: (f) =>
      f.hasList &&
      f.listItemCount >= 3 &&
      f.listItemCount <= 5 &&
      f.keywords.some(
        (k) => k.includes("支柱") || k.includes("核心") || k.includes("要素"),
      ),
    priority: 80,
    description: "核心支柱页",
  },
  // 框架页 - 概念框架
  {
    templateType: "framework",
    conditions: (f) =>
      f.keywords.some(
        (k) => k.includes("框架") || k.includes("架构") || k.includes("模型"),
      ),
    priority: 78,
    description: "框架页",
  },
  // 时间线页 - 有时间序列
  {
    templateType: "timeline",
    conditions: (f) => f.hasTimeline && f.timelinePointCount >= 3,
    priority: 90,
    description: "时间线页",
  },
  // 演进路线图 - 发展轨迹
  {
    templateType: "evolutionRoadmap",
    conditions: (f) =>
      f.hasTimeline &&
      f.keywords.some(
        (k) => k.includes("演进") || k.includes("发展") || k.includes("路线"),
      ),
    priority: 88,
    description: "演进路线图",
  },
  // 仪表板页 - 多个 KPI
  {
    templateType: "dashboard",
    conditions: (f) => f.hasData && f.dataPointCount >= 4,
    priority: 85,
    description: "仪表板页",
  },
  // 对比页 - 两方对比
  {
    templateType: "comparison",
    conditions: (f) => f.hasComparison && f.comparisonItemCount === 2,
    priority: 82,
    description: "对比页",
  },
  // 分栏布局 - 左右分栏
  {
    templateType: "splitLayout",
    conditions: (f) => f.hasData && f.dataPointCount <= 3 && !f.hasTimeline,
    priority: 60,
    description: "分栏布局页",
  },
  // 案例研究页 - 具体案例
  {
    templateType: "caseStudy",
    conditions: (f) =>
      f.keywords.some(
        (k) => k.includes("案例") || k.includes("示例") || k.includes("实践"),
      ),
    priority: 75,
    description: "案例研究页",
  },
  // 多列布局 - 3-4 列内容
  {
    templateType: "multiColumn",
    conditions: (f) =>
      f.hasList &&
      f.listItemCount >= 3 &&
      f.listItemCount <= 4 &&
      !f.hasTimeline,
    priority: 65,
    description: "多列布局页",
  },
  // 建议页 - 行动建议
  {
    templateType: "recommendations",
    conditions: (f) =>
      f.keywords.some(
        (k) => k.includes("建议") || k.includes("行动") || k.includes("下一步"),
      ),
    priority: 83,
    description: "建议页",
  },
  // 成熟度模型 - 阶段模型
  {
    templateType: "maturityModel",
    conditions: (f) =>
      f.keywords.some(
        (k) => k.includes("成熟度") || k.includes("阶段") || k.includes("等级"),
      ),
    priority: 76,
    description: "成熟度模型页",
  },
  // 风险/机遇页 - 正反两面
  {
    templateType: "riskOpportunity",
    conditions: (f) =>
      f.keywords.some(
        (k) =>
          k.includes("风险") ||
          k.includes("机遇") ||
          k.includes("优势") ||
          k.includes("劣势"),
      ),
    priority: 74,
    description: "风险/机遇页",
  },
];

@Injectable()
export class PageTypeSelectionSkill implements ISkill<
  PageOutline[],
  Map<number, PageTemplateType>
> {
  private readonly logger = new Logger(PageTypeSelectionSkill.name);

  // ISkill Implementation - Required Properties
  readonly id = "slides-page-type-selection";
  readonly name = "页面类型选择";
  readonly description = "根据内容自动选择合适的幻灯片页面类型";
  readonly layer: SkillLayer = SKILL_LAYERS.DESIGN;
  readonly domain = "slides";
  readonly tags = ["slides", "page", "type", "selection", "design"];
  readonly version = "4.0.0";

  /**
   * 将 MissionOrchestrator 输入格式转换为直接输入格式
   */
  private normalizeInput(
    input: PageOutline[] | PageTypeSelectionOrchestratorInput,
  ): PageOutline[] | null {
    // 如果已经是数组格式，直接返回
    if (Array.isArray(input)) {
      return input;
    }

    // 尝试从 orchestrator 格式提取
    const orchestratorInput = input;
    const contextInput = orchestratorInput.context?.input;

    if (
      !contextInput?.pageOutlines ||
      !Array.isArray(contextInput.pageOutlines)
    ) {
      this.logger.warn(
        "[normalizeInput] Missing required fields in orchestrator input: " +
          `pageOutlines=${!!contextInput?.pageOutlines}`,
      );
      return null;
    }

    return contextInput.pageOutlines;
  }

  /**
   * 执行技能 - ISkill interface implementation
   * Executes page type selection for multiple page outlines
   */
  async execute(
    input: PageOutline[] | PageTypeSelectionOrchestratorInput,
    context: SkillContext,
  ): Promise<SkillResult<Map<number, PageTemplateType>>> {
    const startTime = new Date();

    // Normalize input from orchestrator format if needed
    const pageOutlines = this.normalizeInput(input);
    if (!pageOutlines) {
      return {
        success: false,
        error: {
          code: "INVALID_INPUT",
          message:
            "Failed to normalize input: missing required fields (pageOutlines)",
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
      // Call the existing batch selection method
      const result = this.selectTemplateTypes(pageOutlines);

      this.logger.debug(
        `[execute] Completed page type selection for ${pageOutlines.length} pages in ${Date.now() - startTime.getTime()}ms`,
      );

      return {
        success: true,
        data: result,
        metadata: {
          executionId: context.executionId,
          startTime,
          endTime: new Date(),
          duration: Date.now() - startTime.getTime(),
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";

      this.logger.error(
        `[execute] Page type selection failed: ${errorMessage}`,
        error instanceof Error ? error.stack : "",
      );

      return {
        success: false,
        error: {
          code: "PAGE_TYPE_SELECTION_FAILED",
          message: errorMessage,
          retryable: true,
        },
        metadata: {
          executionId: context.executionId,
          startTime,
          endTime: new Date(),
          duration: Date.now() - startTime.getTime(),
        },
      };
    }
  }

  /**
   * 选择最合适的页面模板类型
   */
  selectTemplateType(pageOutline: PageOutline): PageTemplateType {
    const features = this.analyzeContentFeatures(pageOutline);

    this.logger.debug(
      `[selectTemplateType] Page ${pageOutline.pageNumber}: ${JSON.stringify(features)}`,
    );

    // 按优先级排序规则
    const sortedRules = [...TEMPLATE_RULES].sort(
      (a, b) => b.priority - a.priority,
    );

    // 找到第一个匹配的规则
    for (const rule of sortedRules) {
      if (rule.conditions(features)) {
        this.logger.log(
          `[selectTemplateType] Page ${pageOutline.pageNumber}: Selected ${rule.templateType} (${rule.description})`,
        );
        return rule.templateType;
      }
    }

    // 默认使用 splitLayout
    this.logger.log(
      `[selectTemplateType] Page ${pageOutline.pageNumber}: Using default splitLayout`,
    );
    return "splitLayout";
  }

  /**
   * 批量选择模板类型
   */
  selectTemplateTypes(
    pageOutlines: PageOutline[],
  ): Map<number, PageTemplateType> {
    const results = new Map<number, PageTemplateType>();

    // 第一遍：强制规则
    for (const outline of pageOutlines) {
      if (outline.pageNumber === 1) {
        results.set(outline.pageNumber, "cover");
      } else if (outline.pageNumber === 2 && outline.title.includes("目录")) {
        results.set(outline.pageNumber, "toc");
      }
    }

    // 第二遍：智能选择
    for (const outline of pageOutlines) {
      if (!results.has(outline.pageNumber)) {
        results.set(outline.pageNumber, this.selectTemplateType(outline));
      }
    }

    // 第三遍：去重优化（避免连续使用相同模板）
    this.optimizeTemplateSequence(pageOutlines, results);

    return results;
  }

  /**
   * 分析内容特征
   */
  private analyzeContentFeatures(pageOutline: PageOutline): ContentFeatures {
    const title = pageOutline.title.toLowerCase();
    const contentBrief = pageOutline.contentBrief.toLowerCase();
    const keyElements = pageOutline.keyElements.map((e) => e.toLowerCase());
    const allText = [title, contentBrief, ...keyElements].join(" ");

    // 提取关键词
    const keywords = [title, ...keyElements];

    // 分析特征
    const features: ContentFeatures = {
      hasTitle: !!pageOutline.title,
      hasSubtitle: !!pageOutline.subtitle,
      hasList: keyElements.length > 0,
      listItemCount: keyElements.length,
      hasData: this.detectData(allText, pageOutline.dataRequirements),
      dataPointCount: pageOutline.dataRequirements?.length || 0,
      hasTimeline: this.detectTimeline(allText),
      timelinePointCount: this.countTimelinePoints(allText),
      hasComparison: this.detectComparison(allText),
      comparisonItemCount: this.countComparisonItems(allText),
      hasQuote: this.detectQuote(allText),
      hasChartRequirement:
        pageOutline.dataRequirements?.some((d) => d.type === "chart") || false,
      chartTypes: this.extractChartTypes(pageOutline.dataRequirements),
      complexityScore: this.calculateComplexity(pageOutline),
      isChapterStart: pageOutline.pageNumber <= 2,
      isChapterEnd: false, // 需要上下文判断
      keywords,
    };

    return features;
  }

  /**
   * 检测是否包含数据
   */
  private detectData(
    text: string,
    dataRequirements?: { type: string }[],
  ): boolean {
    if (dataRequirements && dataRequirements.length > 0) return true;

    const dataPatterns = [
      /\d+%/, // 百分比
      /\d+\.\d+/, // 小数
      /\$\d+/, // 货币
      /\d+亿/, // 大数字
      /增长|下降|上升/, // 趋势词
    ];

    return dataPatterns.some((p) => p.test(text));
  }

  /**
   * 检测时间线
   */
  private detectTimeline(text: string): boolean {
    const timelinePatterns = [
      /\d{4}年/, // 年份
      /阶段[一二三四五]/, // 阶段
      /第[一二三四五]步/, // 步骤
      /时间线|演进|发展历程/,
    ];

    return timelinePatterns.some((p) => p.test(text));
  }

  /**
   * 统计时间点数量
   */
  private countTimelinePoints(text: string): number {
    const yearMatches = text.match(/\d{4}年/g);
    const stageMatches = text.match(/阶段[一二三四五六七八九十]/g);
    const stepMatches = text.match(/第[一二三四五六七八九十]步/g);

    return Math.max(
      yearMatches?.length || 0,
      stageMatches?.length || 0,
      stepMatches?.length || 0,
    );
  }

  /**
   * 检测对比
   */
  private detectComparison(text: string): boolean {
    const comparisonPatterns = [
      /vs\.?|对比|比较/,
      /优势.*劣势|pros.*cons/i,
      /前.*后|before.*after/i,
    ];

    return comparisonPatterns.some((p) => p.test(text));
  }

  /**
   * 统计对比项数量
   */
  private countComparisonItems(text: string): number {
    if (text.includes("vs") || text.includes("对比")) return 2;
    return 0;
  }

  /**
   * 检测引用
   */
  private detectQuote(text: string): boolean {
    return text.includes('"') || text.includes('"') || text.includes("引用");
  }

  /**
   * 提取图表类型
   */
  private extractChartTypes(dataRequirements?: { type: string }[]): string[] {
    if (!dataRequirements) return [];
    return dataRequirements.filter((d) => d.type === "chart").map(() => "bar"); // 默认为柱状图
  }

  /**
   * 计算内容复杂度
   */
  private calculateComplexity(pageOutline: PageOutline): number {
    let score = 1;

    if (pageOutline.keyElements.length > 3) score++;
    if (pageOutline.dataRequirements && pageOutline.dataRequirements.length > 0)
      score++;
    if (
      pageOutline.imageRequirements &&
      pageOutline.imageRequirements.length > 0
    )
      score++;
    if (pageOutline.contentBrief.length > 100) score++;

    return Math.min(score, 5);
  }

  /**
   * 优化模板序列（避免连续重复）
   */
  private optimizeTemplateSequence(
    pageOutlines: PageOutline[],
    results: Map<number, PageTemplateType>,
  ): void {
    const sortedPages = [...pageOutlines].sort(
      (a, b) => a.pageNumber - b.pageNumber,
    );
    let prevType: PageTemplateType | null = null;
    let repeatCount = 0;

    for (const outline of sortedPages) {
      const currentType = results.get(outline.pageNumber);

      if (currentType === prevType) {
        repeatCount++;

        // 如果连续 3 次使用相同模板，尝试替换
        if (
          repeatCount >= 2 &&
          currentType !== "cover" &&
          currentType !== "toc"
        ) {
          const alternativeType = this.findAlternativeTemplate(currentType);
          results.set(outline.pageNumber, alternativeType);
          this.logger.debug(
            `[optimizeTemplateSequence] Changed page ${outline.pageNumber} from ${currentType} to ${alternativeType}`,
          );
        }
      } else {
        repeatCount = 0;
      }

      prevType = results.get(outline.pageNumber) || null;
    }
  }

  /**
   * 找到替代模板
   */
  private findAlternativeTemplate(
    currentType: PageTemplateType,
  ): PageTemplateType {
    const alternatives: Record<PageTemplateType, PageTemplateType> = {
      splitLayout: "multiColumn",
      multiColumn: "splitLayout",
      pillars: "framework",
      framework: "pillars",
      timeline: "evolutionRoadmap",
      evolutionRoadmap: "timeline",
      dashboard: "splitLayout",
      comparison: "riskOpportunity",
      riskOpportunity: "comparison",
      caseStudy: "splitLayout",
      recommendations: "pillars",
      maturityModel: "timeline",
      questions: "pillars",
      cover: "cover",
      toc: "toc",
      chapterTitle: "chapterTitle", // v3.5: 章节分隔页不替换
      closing: "cover", // 感谢页的替代是封面页
    };

    return alternatives[currentType] || "splitLayout";
  }
}

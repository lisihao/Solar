/**
 * Slides Engine v3.0 - Template Matcher Skill
 *
 * 语义模板匹配技能 (Layer 3)：基于内容语义和上下文选择最佳模板
 * 替代简单的 PageTypeSelectionSkill，使用加权匹配算法
 */

import { Injectable, Logger } from "@nestjs/common";
import {
  PageOutline,
  PageTemplateType,
  NarrativePlan,
} from "../checkpoint/checkpoint.types";
import { templateRegistry, SlideTemplate } from "../templates";
import {
  ISkill,
  SkillContext,
  SkillResult,
  SkillLayer,
  SKILL_LAYERS,
} from "@/modules/ai-harness/facade";

/**
 * 模板匹配上下文
 */
export interface TemplateMatchingContext {
  /** 当前页面大纲 */
  pageOutline: PageOutline;
  /** 前面的页面 (用于避免重复) */
  previousPages: { pageNumber: number; templateId: string }[];
  /** 下一页预计内容 (可选) */
  nextPageHint?: string;
  /** 在故事中的位置 */
  positionInStory: "opening" | "middle" | "closing";
  /** 叙事规划 (可选) */
  narrativePlan?: NarrativePlan;
  /** 已使用的模板 ID 列表 */
  usedTemplates: string[];
  /** 强制使用的模板类型（硬性规则） */
  forcedTemplateType?: PageTemplateType | null;
}

/**
 * MissionOrchestrator 输入格式
 */
export interface TemplateMatcherOrchestratorInput {
  task?: string;
  context?: {
    input?: {
      pageOutline?: PageOutline;
      previousPages?: { pageNumber: number; templateId: string }[];
      nextPageHint?: string;
      positionInStory?: "opening" | "middle" | "closing";
      narrativePlan?: NarrativePlan;
      usedTemplates?: string[];
      forcedTemplateType?: PageTemplateType | null;
    };
    [key: string]: unknown;
  };
  previousOutputs?: Record<string, unknown>;
}

/**
 * 模板匹配结果
 */
export interface TemplateMatchResult {
  /** 推荐的模板 */
  recommended: {
    templateId: string;
    templateType: PageTemplateType;
    confidence: number;
    reason: string;
  };
  /** 备选模板 */
  alternatives: {
    templateId: string;
    templateType: PageTemplateType;
    confidence: number;
    reason: string;
  }[];
  /** 匹配详情 */
  matchDetails: {
    keywordScore: number;
    capacityScore: number;
    positionScore: number;
    contextScore: number;
    diversityScore: number;
    emotionalScore: number;
  };
}

/**
 * 匹配权重配置
 */
const MATCH_WEIGHTS = {
  keywordMatch: 0.3, // 内容关键词 vs 模板 useCases
  contentCapacity: 0.2, // 内容量 vs maxContentBlocks
  narrativePosition: 0.15, // 叙事位置 vs positionFit
  contextFit: 0.15, // 前后页兼容性
  diversity: 0.1, // 避免重复
  emotionalMatch: 0.1, // 情感基调对齐
};

/**
 * 位置适配度配置 (默认值，用于没有 positionFit 的模板)
 */
const DEFAULT_POSITION_FIT: Record<
  PageTemplateType,
  { opening: number; middle: number; closing: number }
> = {
  cover: { opening: 1.0, middle: 0.0, closing: 0.3 },
  toc: { opening: 0.9, middle: 0.2, closing: 0.1 },
  chapterTitle: { opening: 0.6, middle: 0.8, closing: 0.2 }, // v3.5: 章节分隔页
  questions: { opening: 0.7, middle: 0.5, closing: 0.3 },
  pillars: { opening: 0.5, middle: 0.9, closing: 0.6 },
  framework: { opening: 0.6, middle: 0.9, closing: 0.5 },
  timeline: { opening: 0.3, middle: 0.9, closing: 0.4 },
  evolutionRoadmap: { opening: 0.3, middle: 0.9, closing: 0.5 },
  dashboard: { opening: 0.2, middle: 0.9, closing: 0.4 },
  comparison: { opening: 0.3, middle: 0.9, closing: 0.5 },
  splitLayout: { opening: 0.4, middle: 0.9, closing: 0.5 },
  caseStudy: { opening: 0.2, middle: 0.9, closing: 0.4 },
  multiColumn: { opening: 0.4, middle: 0.9, closing: 0.5 },
  recommendations: { opening: 0.2, middle: 0.6, closing: 0.95 },
  maturityModel: { opening: 0.3, middle: 0.9, closing: 0.5 },
  riskOpportunity: { opening: 0.3, middle: 0.8, closing: 0.7 },
  closing: { opening: 0.0, middle: 0.0, closing: 1.0 }, // 结尾/感谢页只能放在最后
};

/**
 * 内容关键词到模板的映射
 */
const KEYWORD_TO_TEMPLATE: Record<string, PageTemplateType[]> = {
  // 封面/标题
  封面: ["cover"],
  标题: ["cover"],
  // 目录/大纲
  目录: ["toc"],
  大纲: ["toc"],
  概览: ["toc", "multiColumn"],
  // 问题/挑战
  问题: ["questions", "riskOpportunity"],
  挑战: ["questions", "riskOpportunity"],
  痛点: ["questions", "riskOpportunity"],
  // 核心/支柱/要素
  支柱: ["pillars"],
  核心: ["pillars", "multiColumn"],
  要素: ["pillars", "multiColumn"],
  关键: ["pillars", "multiColumn"],
  // 影响/效果/作用/价值
  影响: ["pillars", "multiColumn", "splitLayout"],
  影响力: ["pillars", "multiColumn"],
  效果: ["pillars", "multiColumn"],
  作用: ["pillars", "multiColumn"],
  价值: ["pillars", "multiColumn", "splitLayout"],
  贡献: ["pillars", "multiColumn"],
  意义: ["pillars", "splitLayout"],
  // 分布/占比/构成
  分布: ["comparison", "multiColumn", "dashboard"],
  占比: ["comparison", "dashboard"],
  比例: ["comparison", "dashboard"],
  构成: ["comparison", "multiColumn"],
  组成: ["comparison", "multiColumn"],
  // 框架/架构
  框架: ["framework", "pillars"],
  架构: ["framework"],
  模型: ["framework", "maturityModel"],
  体系: ["framework", "pillars"],
  // 流程/步骤
  流程: ["framework", "timeline"],
  步骤: ["framework"],
  过程: ["framework", "timeline"],
  // 时间/发展/演进
  时间: ["timeline", "evolutionRoadmap"],
  演进: ["evolutionRoadmap", "timeline"],
  发展: ["evolutionRoadmap", "timeline"],
  历程: ["timeline", "evolutionRoadmap"],
  路线: ["evolutionRoadmap", "timeline"],
  规划: ["timeline", "evolutionRoadmap"],
  // 数据/指标
  数据: ["dashboard"],
  指标: ["dashboard"],
  KPI: ["dashboard"],
  统计: ["dashboard"],
  趋势: ["dashboard"],
  // 对比/比较
  对比: ["comparison"],
  比较: ["comparison"],
  差异: ["comparison"],
  优劣: ["comparison", "riskOpportunity"],
  // 案例/示例
  案例: ["caseStudy", "splitLayout"],
  示例: ["caseStudy"],
  实践: ["caseStudy", "splitLayout"],
  成功: ["caseStudy"],
  // 特点/优势/功能
  特点: ["multiColumn", "pillars"],
  优势: ["multiColumn", "pillars"],
  功能: ["multiColumn", "splitLayout"],
  特性: ["multiColumn"],
  亮点: ["multiColumn", "pillars"],
  // 建议/行动
  建议: ["recommendations"],
  行动: ["recommendations"],
  下一步: ["recommendations"],
  措施: ["recommendations"],
  方案: ["recommendations", "multiColumn"],
  // 成熟度/阶段
  成熟度: ["maturityModel"],
  阶段: ["maturityModel", "timeline"],
  等级: ["maturityModel"],
  层次: ["maturityModel", "pillars"],
  // 风险/机遇
  风险: ["riskOpportunity"],
  机遇: ["riskOpportunity"],
  机会: ["riskOpportunity"],
  威胁: ["riskOpportunity"],
  // 总结/结论
  总结: ["recommendations", "multiColumn"],
  结论: ["recommendations", "pillars"],
  要点: ["multiColumn", "pillars"],
  // 感谢/结束
  感谢: ["closing"],
  谢谢: ["closing"],
  结束: ["closing"],
};

@Injectable()
export class TemplateMatcherSkill implements ISkill<
  TemplateMatchingContext,
  TemplateMatchResult
> {
  private readonly logger = new Logger(TemplateMatcherSkill.name);

  /**
   * Skill Interface Implementation
   */
  readonly id = "slides-template-matcher";
  readonly name = "模板匹配";
  readonly description = "根据内容特征匹配最佳幻灯片模板";
  readonly layer: SkillLayer = SKILL_LAYERS.DESIGN;
  readonly domain = "slides";
  readonly tags = ["slides", "template", "matching", "design"];
  readonly version = "4.0.0";

  /**
   * 将 MissionOrchestrator 输入格式转换为直接输入格式
   */
  private normalizeInput(
    input: TemplateMatchingContext | TemplateMatcherOrchestratorInput,
  ): TemplateMatchingContext | null {
    // 如果已经是直接格式，直接返回
    if (
      "pageOutline" in input &&
      "positionInStory" in input &&
      "usedTemplates" in input
    ) {
      return input;
    }

    // 尝试从 orchestrator 格式提取
    const orchestratorInput = input;
    const contextInput = orchestratorInput.context?.input;

    if (
      !contextInput?.pageOutline ||
      !contextInput?.positionInStory ||
      !contextInput?.usedTemplates
    ) {
      this.logger.warn(
        "[normalizeInput] Missing required fields in orchestrator input: " +
          `pageOutline=${!!contextInput?.pageOutline}, ` +
          `positionInStory=${!!contextInput?.positionInStory}, ` +
          `usedTemplates=${!!contextInput?.usedTemplates}`,
      );
      return null;
    }

    return {
      pageOutline: contextInput.pageOutline,
      previousPages: contextInput.previousPages || [],
      nextPageHint: contextInput.nextPageHint,
      positionInStory: contextInput.positionInStory,
      narrativePlan: contextInput.narrativePlan,
      usedTemplates: contextInput.usedTemplates,
      forcedTemplateType: contextInput.forcedTemplateType,
    };
  }

  /**
   * Execute the skill (ISkill interface implementation)
   */
  async execute(
    input: TemplateMatchingContext | TemplateMatcherOrchestratorInput,
    context: SkillContext,
  ): Promise<SkillResult<TemplateMatchResult>> {
    const startTime = new Date();

    // Normalize input from orchestrator format if needed
    const normalizedInput = this.normalizeInput(input);
    if (!normalizedInput) {
      return {
        success: false,
        error: {
          code: "INVALID_INPUT",
          message:
            "Failed to normalize input: missing required fields (pageOutline, positionInStory, usedTemplates)",
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
      const result = this.match(normalizedInput);

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
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[execute] Error during template matching: ${errorMessage}`,
        error instanceof Error ? error.stack : undefined,
      );

      return {
        success: false,
        error: {
          code: "TEMPLATE_MATCH_ERROR",
          message: errorMessage,
          details: {
            skillId: this.id,
            executionId: context.executionId,
          },
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
   * 匹配最佳模板
   */
  match(context: TemplateMatchingContext): TemplateMatchResult {
    const {
      pageOutline,
      previousPages,
      positionInStory,
      usedTemplates,
      forcedTemplateType,
    } = context;

    this.logger.log(
      `[match] Matching template for page ${pageOutline.pageNumber}: "${pageOutline.title}"`,
    );

    // 获取所有可用模板
    let allTemplates = templateRegistry.getAll();

    // 【硬性规则】如果指定了强制模板类型，只考虑该类型的模板
    if (forcedTemplateType) {
      allTemplates = allTemplates.filter(
        (t) => t.metadata.type === forcedTemplateType,
      );
      this.logger.log(
        `[match] 强制使用 ${forcedTemplateType} 类型，筛选后剩余 ${allTemplates.length} 个模板`,
      );
    }

    const scores: {
      template: SlideTemplate;
      score: number;
      details: TemplateMatchResult["matchDetails"];
    }[] = [];

    // 计算每个模板的匹配分数
    for (const template of allTemplates) {
      const details = this.calculateMatchDetails(
        template,
        pageOutline,
        positionInStory,
        previousPages,
        usedTemplates,
        context.narrativePlan,
      );

      const totalScore =
        details.keywordScore * MATCH_WEIGHTS.keywordMatch +
        details.capacityScore * MATCH_WEIGHTS.contentCapacity +
        details.positionScore * MATCH_WEIGHTS.narrativePosition +
        details.contextScore * MATCH_WEIGHTS.contextFit +
        details.diversityScore * MATCH_WEIGHTS.diversity +
        details.emotionalScore * MATCH_WEIGHTS.emotionalMatch;

      scores.push({ template, score: totalScore, details });
    }

    // 排序并选择最佳
    scores.sort((a, b) => b.score - a.score);

    const best = scores[0];
    const alternatives = scores.slice(1, 4);

    const result: TemplateMatchResult = {
      recommended: {
        templateId: best.template.metadata.id,
        templateType: best.template.metadata.type,
        confidence: Math.min(1, best.score),
        reason: this.generateReason(best.template, best.details),
      },
      alternatives: alternatives.map((alt) => ({
        templateId: alt.template.metadata.id,
        templateType: alt.template.metadata.type,
        confidence: Math.min(1, alt.score),
        reason: this.generateReason(alt.template, alt.details),
      })),
      matchDetails: best.details,
    };

    this.logger.log(
      `[match] Best match: ${result.recommended.templateId} (${result.recommended.confidence.toFixed(2)})`,
    );

    return result;
  }

  /**
   * 批量匹配
   */
  matchAll(
    pageOutlines: PageOutline[],
    narrativePlan?: NarrativePlan,
  ): Map<number, TemplateMatchResult> {
    const results = new Map<number, TemplateMatchResult>();
    const previousPages: { pageNumber: number; templateId: string }[] = [];
    const usedTemplates: string[] = [];

    for (let i = 0; i < pageOutlines.length; i++) {
      const outline = pageOutlines[i];
      const isFirstPage = i === 0;
      const isLastPage = i === pageOutlines.length - 1;

      // 确定叙事位置
      let positionInStory: "opening" | "middle" | "closing" = "middle";
      if (i < 2) {
        positionInStory = "opening";
      } else if (i >= pageOutlines.length - 2) {
        positionInStory = "closing";
      }

      // 【硬性规则】第一页必须是 cover，最后一页必须是 closing
      let forcedTemplateType: PageTemplateType | null = null;
      if (isFirstPage) {
        forcedTemplateType = "cover";
        this.logger.log(`[matchAll] 硬性规则：第一页强制使用 cover 模板`);
      } else if (isLastPage) {
        forcedTemplateType = "closing";
        this.logger.log(`[matchAll] 硬性规则：最后一页强制使用 closing 模板`);
      }

      const context: TemplateMatchingContext = {
        pageOutline: outline,
        previousPages: [...previousPages],
        positionInStory,
        narrativePlan,
        usedTemplates: [...usedTemplates],
        nextPageHint: pageOutlines[i + 1]?.title,
        forcedTemplateType, // 传递强制模板类型
      };

      const result = this.match(context);
      results.set(outline.pageNumber, result);

      // 更新已使用列表
      previousPages.push({
        pageNumber: outline.pageNumber,
        templateId: result.recommended.templateId,
      });
      usedTemplates.push(result.recommended.templateId);
    }

    return results;
  }

  /**
   * 计算匹配详情
   */
  private calculateMatchDetails(
    template: SlideTemplate,
    pageOutline: PageOutline,
    positionInStory: "opening" | "middle" | "closing",
    previousPages: { pageNumber: number; templateId: string }[],
    usedTemplates: string[],
    narrativePlan?: NarrativePlan,
  ): TemplateMatchResult["matchDetails"] {
    const metadata = template.metadata;

    // 1. 关键词匹配分数
    const keywordScore = this.calculateKeywordScore(pageOutline, metadata);

    // 2. 容量匹配分数
    const capacityScore = this.calculateCapacityScore(pageOutline, metadata);

    // 3. 位置匹配分数 - 使用模板自己的 positionFit（如果有）
    const positionScore = this.calculatePositionScore(
      template,
      positionInStory,
    );

    // 4. 上下文兼容分数
    const contextScore = this.calculateContextScore(
      template,
      previousPages,
      metadata,
    );

    // 5. 多样性分数
    const diversityScore = this.calculateDiversityScore(
      metadata.id,
      usedTemplates,
    );

    // 6. 情感匹配分数
    const emotionalScore = this.calculateEmotionalScore(
      pageOutline,
      narrativePlan,
      metadata,
    );

    return {
      keywordScore,
      capacityScore,
      positionScore,
      contextScore,
      diversityScore,
      emotionalScore,
    };
  }

  /**
   * 计算关键词匹配分数
   */
  private calculateKeywordScore(
    pageOutline: PageOutline,
    metadata: SlideTemplate["metadata"],
  ): number {
    const title = pageOutline.title.toLowerCase();
    const brief = pageOutline.contentBrief.toLowerCase();
    const keywords = pageOutline.keyElements.map((e) => e.toLowerCase());
    const allText = [title, brief, ...keywords].join(" ");

    let score = 0;
    let matches = 0;

    // 检查模板的 useCases
    for (const useCase of metadata.useCases) {
      if (allText.includes(useCase.toLowerCase())) {
        matches++;
      }
    }

    // 检查关键词映射
    for (const [keyword, templates] of Object.entries(KEYWORD_TO_TEMPLATE)) {
      if (allText.includes(keyword)) {
        if (templates.includes(metadata.type)) {
          matches += 2; // 强匹配
        }
      }
    }

    // 归一化分数
    score = Math.min(1, matches / 3);

    return score;
  }

  /**
   * 计算容量匹配分数
   */
  private calculateCapacityScore(
    pageOutline: PageOutline,
    metadata: SlideTemplate["metadata"],
  ): number {
    const elementCount = pageOutline.keyElements.length;
    const maxBlocks = metadata.maxContentBlocks;

    // 理想情况：元素数量接近最大容量的 70-90%
    const idealRatio = 0.8;
    const actualRatio = elementCount / maxBlocks;

    if (actualRatio <= 0) return 0.3; // 太少
    if (actualRatio <= idealRatio)
      return 0.5 + (actualRatio / idealRatio) * 0.5;
    if (actualRatio <= 1) return 1; // 刚好
    return Math.max(0, 1 - (actualRatio - 1) * 0.5); // 超出则降低
  }

  /**
   * 计算位置匹配分数 - 优先使用模板自己定义的 positionFit
   */
  private calculatePositionScore(
    template: SlideTemplate,
    position: "opening" | "middle" | "closing",
  ): number {
    // 优先使用模板自己的 positionFit，否则使用默认值
    const positionFit =
      template.metadata.positionFit ||
      DEFAULT_POSITION_FIT[template.metadata.type] ||
      DEFAULT_POSITION_FIT.splitLayout;
    return positionFit[position];
  }

  /**
   * 计算上下文兼容分数
   */
  private calculateContextScore(
    _template: SlideTemplate,
    previousPages: { pageNumber: number; templateId: string }[],
    metadata: SlideTemplate["metadata"],
  ): number {
    if (previousPages.length === 0) return 0.8;

    const lastTemplate = previousPages[previousPages.length - 1];

    // 检查是否在 avoidNear 列表中
    const compatibility = metadata.compatibility;

    if (compatibility?.avoidNear?.includes(lastTemplate.templateId)) {
      return 0.2;
    }

    // 检查是否在 goodAfter 列表中
    if (compatibility?.goodAfter?.includes(lastTemplate.templateId)) {
      return 1.0;
    }

    // 默认中等兼容
    return 0.7;
  }

  /**
   * 计算多样性分数
   */
  private calculateDiversityScore(
    templateId: string,
    usedTemplates: string[],
  ): number {
    const usageCount = usedTemplates.filter((t) => t === templateId).length;

    if (usageCount === 0) return 1.0;
    if (usageCount === 1) return 0.7;
    if (usageCount === 2) return 0.4;
    return 0.2;
  }

  /**
   * 计算情感匹配分数
   */
  private calculateEmotionalScore(
    pageOutline: PageOutline,
    narrativePlan: NarrativePlan | undefined,
    metadata: SlideTemplate["metadata"],
  ): number {
    if (!narrativePlan) return 0.5;

    // 找到当前页的情感
    const emotionalNode = narrativePlan.emotionalArc.find(
      (node) => node.page === pageOutline.pageNumber,
    );

    if (!emotionalNode) return 0.5;

    // 获取模板的 tone
    const templateTone = metadata.tone;

    // 情感到 tone 的映射
    const emotionToTone: Record<string, string[]> = {
      curiosity: ["neutral", "inspiring"],
      concern: ["warning", "analytical"],
      hope: ["positive", "inspiring"],
      confidence: ["positive", "analytical"],
      urgency: ["warning", "inspiring"],
    };

    const matchingTones = emotionToTone[emotionalNode.emotion] || [];

    if (templateTone && matchingTones.includes(templateTone)) {
      return 1.0;
    }

    return 0.5;
  }

  /**
   * 生成匹配原因
   */
  private generateReason(
    template: SlideTemplate,
    details: TemplateMatchResult["matchDetails"],
  ): string {
    const reasons: string[] = [];

    if (details.keywordScore > 0.7) {
      reasons.push("内容关键词高度匹配");
    }
    if (details.positionScore > 0.8) {
      reasons.push("适合当前叙事位置");
    }
    if (details.diversityScore > 0.8) {
      reasons.push("增加模板多样性");
    }
    if (details.capacityScore > 0.8) {
      reasons.push("容量适配");
    }

    if (reasons.length === 0) {
      reasons.push(`${template.metadata.name}是通用选择`);
    }

    return reasons.join("；");
  }

  /**
   * 获取页面类型 (兼容旧接口)
   */
  getTemplateType(context: TemplateMatchingContext): PageTemplateType {
    const result = this.match(context);
    return result.recommended.templateType;
  }
}

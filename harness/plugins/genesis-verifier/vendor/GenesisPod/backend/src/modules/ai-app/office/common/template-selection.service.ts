/**
 * 模板选择服务
 * 基于内容特征智能选择最佳模板
 */

import { Injectable } from "@nestjs/common";
import { ContentAnalysisService } from "../content-analysis/content-analysis.service";
import {
  ContentFeatures,
  ContentComplexity,
  DataDensity,
  ContentAnalysisInput,
} from "../content-analysis/content-analysis.types";
import {
  SlideTemplateType,
  DocsTemplateType,
  DecisionRule,
  SLIDE_TEMPLATE_RULES,
  ImageRequirement,
  ImageType,
  ImagePlacement,
  ReadingExperienceConfig,
  getReadingExperienceForComplexity,
  VisualBreakType,
} from "./template-selection.types";

/**
 * 幻灯片规划项
 */
export interface SlidePlanItem {
  index: number;
  templateType: SlideTemplateType;
  title: string;
  chapterNumber?: number;
  isChapterStart?: boolean;
  contentOutline: string[];
  imageRequirements: ImageRequirement[];
  reasoning: string;
}

/**
 * 文档章节规划项
 */
export interface DocsSectionPlanItem {
  order: number;
  templateType: DocsTemplateType;
  title: string;
  level: 1 | 2 | 3;
  estimatedWordCount: number;
  imageRequirements: ImageRequirement[];
  visualBreaks: VisualBreakType[];
  reasoning: string;
}

/**
 * 完整规划结果
 */
export interface PlanningResult {
  slides?: {
    totalSlides: number;
    chapters: Array<{
      number: number;
      title: string;
      slides: SlidePlanItem[];
    }>;
    allSlides: SlidePlanItem[];
  };
  docs?: {
    totalSections: number;
    estimatedWordCount: number;
    sections: DocsSectionPlanItem[];
  };
  imageStrategy: {
    totalImages: number;
    types: ImageType[];
    density: "sparse" | "balanced" | "rich";
  };
  readingExperience: ReadingExperienceConfig;
}

@Injectable()
export class TemplateSelectionService {
  constructor(
    private readonly contentAnalysisService: ContentAnalysisService,
  ) {}

  /**
   * 为内容选择模板并生成完整规划
   */
  async planDocument(
    content: string,
    options: {
      outputType: "slides" | "docs" | "both";
      detailLevel?: 1 | 2 | 3;
      targetAudience?: string;
      title?: string;
    },
  ): Promise<PlanningResult> {
    // 1. 分析内容
    const analysisInput: ContentAnalysisInput = {
      content,
      context: {
        title: options.title,
        targetAudience: options.targetAudience,
      },
    };

    const analysis =
      await this.contentAnalysisService.analyzeContent(analysisInput);
    const { features } = analysis;

    // 2. 生成规划
    const result: PlanningResult = {
      imageStrategy: this.planImageStrategy(features),
      readingExperience: getReadingExperienceForComplexity(features.complexity),
    };

    if (options.outputType === "slides" || options.outputType === "both") {
      result.slides = this.planSlides(features, options.detailLevel || 2);
    }

    if (options.outputType === "docs" || options.outputType === "both") {
      result.docs = this.planDocs(features, options.detailLevel || 2);
    }

    return result;
  }

  /**
   * 规划幻灯片结构
   */
  private planSlides(
    features: ContentFeatures,
    detailLevel: 1 | 2 | 3,
  ): PlanningResult["slides"] {
    const slides: SlidePlanItem[] = [];
    let slideIndex = 0;

    // 1. 封面
    slides.push({
      index: slideIndex++,
      templateType: SlideTemplateType.COVER,
      title: "封面",
      contentOutline: ["标题", "副标题", "作者/日期"],
      imageRequirements: [
        {
          type: ImageType.BACKGROUND,
          placement: ImagePlacement.BACKGROUND,
          description: "专业背景图",
          keywords: ["professional", "abstract"],
          priority: "optional",
        },
      ],
      reasoning: "报告开篇使用封面",
    });

    // 2. 目录（标准和详细模式）
    if (detailLevel >= 2) {
      slides.push({
        index: slideIndex++,
        templateType: SlideTemplateType.TABLE_OF_CONTENTS,
        title: "目录",
        contentOutline: ["章节列表"],
        imageRequirements: [],
        reasoning: "帮助读者了解报告结构",
      });
    }

    // 3. 根据内容特征生成章节
    const chapters = this.generateChapters(features, detailLevel);

    chapters.forEach((chapter, chapterIndex) => {
      // 章节标题页（标准和详细模式）
      if (detailLevel >= 2) {
        slides.push({
          index: slideIndex++,
          templateType: SlideTemplateType.CHAPTER_TITLE,
          title: chapter.title,
          chapterNumber: chapterIndex + 1,
          isChapterStart: true,
          contentOutline: ["章节标题", "章节描述"],
          imageRequirements: [],
          reasoning: `第${chapterIndex + 1}章开始`,
        });
      }

      // 章节内容页
      chapter.contentSlides.forEach((contentSlide) => {
        const template = this.selectTemplateForContent(contentSlide, features);
        slides.push({
          index: slideIndex++,
          templateType: template.type,
          title: contentSlide.title,
          chapterNumber: chapterIndex + 1,
          contentOutline: contentSlide.outline,
          imageRequirements: template.imageRequirements,
          reasoning: template.reasoning,
        });
      });

      // 章节摘要（详细模式）
      if (detailLevel >= 3 && chapter.contentSlides.length > 2) {
        slides.push({
          index: slideIndex++,
          templateType: SlideTemplateType.CHAPTER_SUMMARY,
          title: `${chapter.title} - 要点`,
          chapterNumber: chapterIndex + 1,
          contentOutline: ["关键要点总结"],
          imageRequirements: [],
          reasoning: "总结本章核心内容",
        });
      }
    });

    // 4. 结论
    slides.push({
      index: slideIndex++,
      templateType: SlideTemplateType.CONCLUSION,
      title: "结论",
      contentOutline: ["关键发现", "建议", "行动号召"],
      imageRequirements: [],
      reasoning: "总结报告核心观点",
    });

    // 组织成章节结构
    const chapterStructure = this.organizeIntoChapters(slides);

    return {
      totalSlides: slides.length,
      chapters: chapterStructure,
      allSlides: slides,
    };
  }

  /**
   * 生成章节结构
   */
  private generateChapters(
    features: ContentFeatures,
    detailLevel: 1 | 2 | 3,
  ): Array<{
    title: string;
    contentSlides: Array<{ title: string; outline: string[]; type?: string }>;
  }> {
    const chapters: Array<{
      title: string;
      contentSlides: Array<{ title: string; outline: string[]; type?: string }>;
    }> = [];

    // 根据内容特征决定章节
    if (features.keyTopics.length > 0) {
      // 基于提取的主题生成章节
      features.keyTopics.slice(0, 4).forEach((topic) => {
        chapters.push({
          title: topic,
          contentSlides: [
            {
              title: `${topic}概述`,
              outline: ["背景", "现状"],
              type: "splitLayout",
            },
            {
              title: `${topic}分析`,
              outline: ["数据", "洞察"],
              type: "multiColumn",
            },
          ],
        });
      });
    } else {
      // 基于内容特征生成默认章节
      // 现状分析
      if (features.hasStatistics) {
        chapters.push({
          title: "现状分析",
          contentSlides: [
            { title: "关键指标", outline: ["KPI概览"], type: "dashboard" },
            { title: "数据洞察", outline: ["趋势分析"], type: "splitLayout" },
          ],
        });
      }

      // 时间线/发展历程
      if (features.hasTimeline) {
        chapters.push({
          title: "发展历程",
          contentSlides: [
            { title: "里程碑", outline: ["关键节点"], type: "timeline" },
            {
              title: "未来规划",
              outline: ["下一阶段"],
              type: "evolutionRoadmap",
            },
          ],
        });
      }

      // 对比分析
      if (features.hasComparison) {
        chapters.push({
          title: "对比分析",
          contentSlides: [
            { title: "方案对比", outline: ["多维度比较"], type: "comparison" },
          ],
        });
      }

      // 案例研究
      if (features.hasCaseStudy) {
        chapters.push({
          title: "案例研究",
          contentSlides: [
            {
              title: "成功案例",
              outline: ["背景", "解决方案", "成果"],
              type: "caseStudy",
            },
          ],
        });
      }

      // 风险分析
      if (features.hasRiskAnalysis) {
        chapters.push({
          title: "风险与机会",
          contentSlides: [
            {
              title: "风险评估",
              outline: ["风险矩阵"],
              type: "riskOpportunity",
            },
          ],
        });
      }

      // 建议
      if (features.hasRecommendations) {
        chapters.push({
          title: "建议与行动",
          contentSlides: [
            {
              title: "行动建议",
              outline: ["优先级", "实施计划"],
              type: "recommendations",
            },
          ],
        });
      }

      // 如果没有特殊内容，添加默认章节
      if (chapters.length === 0) {
        chapters.push({
          title: "核心内容",
          contentSlides: [
            { title: "概述", outline: ["背景", "目的"], type: "splitLayout" },
            {
              title: "详细分析",
              outline: ["要点1", "要点2", "要点3"],
              type: "multiColumn",
            },
            { title: "总结", outline: ["关键发现"], type: "splitLayout" },
          ],
        });
      }
    }

    // 根据详细程度调整
    if (detailLevel === 1) {
      // 简洁模式：每章最多2页
      chapters.forEach((ch) => {
        ch.contentSlides = ch.contentSlides.slice(0, 2);
      });
    } else if (detailLevel === 3) {
      // 详细模式：每章可以更多页
      chapters.forEach((ch) => {
        if (ch.contentSlides.length < 3) {
          ch.contentSlides.push({
            title: `${ch.title}深入分析`,
            outline: ["详细数据", "深度洞察"],
            type: "splitLayout",
          });
        }
      });
    }

    return chapters;
  }

  /**
   * 为内容选择合适的模板
   */
  private selectTemplateForContent(
    contentSlide: { title: string; outline: string[]; type?: string },
    features: ContentFeatures,
  ): {
    type: SlideTemplateType;
    imageRequirements: ImageRequirement[];
    reasoning: string;
  } {
    // 如果已经指定类型，直接使用
    if (contentSlide.type) {
      const templateType = contentSlide.type as SlideTemplateType;
      return {
        type: templateType,
        imageRequirements: this.getImageRequirementsForTemplate(templateType),
        reasoning: `根据内容类型选择 ${contentSlide.type}`,
      };
    }

    // 使用规则引擎匹配
    for (const rule of SLIDE_TEMPLATE_RULES) {
      if (this.evaluateRule(rule, features)) {
        return {
          type: rule.slideTemplate!,
          imageRequirements: rule.imageRecommendations || [],
          reasoning: rule.description,
        };
      }
    }

    // 默认使用分屏布局
    return {
      type: SlideTemplateType.SPLIT_LAYOUT,
      imageRequirements: [
        {
          type: ImageType.ILLUSTRATION_FLAT,
          placement: ImagePlacement.SIDE,
          description: "主题相关插画",
          keywords: [],
          priority: "recommended",
        },
      ],
      reasoning: "默认使用图文分屏布局",
    };
  }

  /**
   * 评估规则是否匹配
   */
  private evaluateRule(rule: DecisionRule, features: ContentFeatures): boolean {
    const results = rule.conditions.map((condition) => {
      const fieldValue = features[condition.field as keyof ContentFeatures];

      switch (condition.operator) {
        case "equals":
          return fieldValue === condition.value;
        case "not_equals":
          return fieldValue !== condition.value;
        case "greater_than":
          return (fieldValue as number) > (condition.value as number);
        case "less_than":
          return (fieldValue as number) < (condition.value as number);
        case "in":
          return (condition.value as unknown[]).includes(fieldValue);
        case "exists":
          return fieldValue !== undefined && fieldValue !== null;
        default:
          return false;
      }
    });

    if (rule.logic === "and") {
      return results.every((r) => r);
    } else {
      return results.some((r) => r);
    }
  }

  /**
   * 获取模板的图片需求
   */
  private getImageRequirementsForTemplate(
    templateType: SlideTemplateType,
  ): ImageRequirement[] {
    const requirements: Record<SlideTemplateType, ImageRequirement[]> = {
      [SlideTemplateType.COVER]: [
        {
          type: ImageType.BACKGROUND,
          placement: ImagePlacement.BACKGROUND,
          description: "封面背景",
          keywords: ["professional", "abstract"],
          priority: "optional",
        },
      ],
      [SlideTemplateType.SPLIT_LAYOUT]: [
        {
          type: ImageType.ILLUSTRATION_FLAT,
          placement: ImagePlacement.SIDE,
          description: "主题插画",
          keywords: [],
          priority: "recommended",
        },
      ],
      [SlideTemplateType.DASHBOARD]: [
        {
          type: ImageType.CHART,
          placement: ImagePlacement.HERO,
          description: "数据图表",
          keywords: ["data", "metrics"],
          priority: "required",
        },
      ],
      [SlideTemplateType.TIMELINE]: [
        {
          type: ImageType.DIAGRAM,
          placement: ImagePlacement.HERO,
          description: "时间线图",
          keywords: ["timeline", "process"],
          priority: "required",
        },
      ],
      [SlideTemplateType.CASE_STUDY]: [
        {
          type: ImageType.PHOTO_BUSINESS,
          placement: ImagePlacement.SIDE,
          description: "案例照片",
          keywords: ["business", "success"],
          priority: "recommended",
        },
      ],
      // 其他模板使用空数组
      [SlideTemplateType.TABLE_OF_CONTENTS]: [],
      [SlideTemplateType.CHAPTER_TITLE]: [],
      [SlideTemplateType.CHAPTER_SUMMARY]: [],
      [SlideTemplateType.CONCLUSION]: [],
      [SlideTemplateType.MULTI_COLUMN]: [],
      [SlideTemplateType.EVOLUTION_ROADMAP]: [],
      [SlideTemplateType.COMPARISON]: [],
      [SlideTemplateType.MATURITY_MODEL]: [],
      [SlideTemplateType.RISK_OPPORTUNITY]: [],
      [SlideTemplateType.RECOMMENDATIONS]: [],
    };

    return requirements[templateType] || [];
  }

  /**
   * 组织幻灯片为章节结构
   */
  private organizeIntoChapters(
    slides: SlidePlanItem[],
  ): Array<{ number: number; title: string; slides: SlidePlanItem[] }> {
    const chapters: Array<{
      number: number;
      title: string;
      slides: SlidePlanItem[];
    }> = [];
    let currentChapter: {
      number: number;
      title: string;
      slides: SlidePlanItem[];
    } | null = null;

    slides.forEach((slide) => {
      if (slide.isChapterStart) {
        if (currentChapter) {
          chapters.push(currentChapter);
        }
        currentChapter = {
          number: slide.chapterNumber || chapters.length + 1,
          title: slide.title,
          slides: [slide],
        };
      } else if (currentChapter) {
        currentChapter.slides.push(slide);
      } else {
        // 封面、目录等没有章节的页面
        if (!chapters.find((c) => c.number === 0)) {
          chapters.push({ number: 0, title: "开篇", slides: [] });
        }
        chapters[0].slides.push(slide);
      }
    });

    if (currentChapter) {
      chapters.push(currentChapter);
    }

    return chapters;
  }

  /**
   * 规划文档结构
   */
  private planDocs(
    features: ContentFeatures,
    detailLevel: 1 | 2 | 3,
  ): PlanningResult["docs"] {
    const sections: DocsSectionPlanItem[] = [];
    let order = 0;

    // 1. 执行摘要
    sections.push({
      order: order++,
      templateType: DocsTemplateType.EXECUTIVE_SUMMARY,
      title: "执行摘要",
      level: 1,
      estimatedWordCount:
        detailLevel === 1 ? 300 : detailLevel === 2 ? 500 : 800,
      imageRequirements: [
        {
          type: ImageType.INFOGRAPHIC,
          placement: ImagePlacement.HERO,
          description: "关键发现可视化",
          keywords: ["summary", "key findings"],
          priority: "recommended",
        },
      ],
      visualBreaks: [VisualBreakType.CALLOUT],
      reasoning: "为决策者提供快速概览",
    });

    // 2. 引言
    sections.push({
      order: order++,
      templateType: DocsTemplateType.INTRODUCTION,
      title: "背景与目的",
      level: 1,
      estimatedWordCount: detailLevel === 1 ? 400 : 600,
      imageRequirements: [],
      visualBreaks: [VisualBreakType.DIVIDER],
      reasoning: "设定研究上下文",
    });

    // 3. 根据内容特征添加章节
    if (features.hasStatistics) {
      sections.push({
        order: order++,
        templateType: DocsTemplateType.DATA_REPORT,
        title: "数据分析",
        level: 1,
        estimatedWordCount:
          detailLevel === 1 ? 600 : detailLevel === 2 ? 1000 : 1500,
        imageRequirements: [
          {
            type: ImageType.CHART,
            placement: ImagePlacement.INLINE,
            description: "数据图表",
            keywords: ["data", "chart", "metrics"],
            priority: "required",
          },
        ],
        visualBreaks: [VisualBreakType.INFOGRAPHIC],
        reasoning: "内容包含统计数据，使用数据报告模板",
      });
    }

    if (features.hasComparison) {
      sections.push({
        order: order++,
        templateType: DocsTemplateType.COMPARISON,
        title: "对比分析",
        level: 1,
        estimatedWordCount: detailLevel === 1 ? 500 : 800,
        imageRequirements: [
          {
            type: ImageType.INFOGRAPHIC,
            placement: ImagePlacement.HERO,
            description: "对比图表",
            keywords: ["comparison", "versus"],
            priority: "required",
          },
        ],
        visualBreaks: [VisualBreakType.INFOGRAPHIC],
        reasoning: "内容包含对比分析",
      });
    }

    if (features.hasCaseStudy) {
      sections.push({
        order: order++,
        templateType: DocsTemplateType.CASE_STUDY,
        title: "案例研究",
        level: 1,
        estimatedWordCount:
          detailLevel === 1 ? 600 : detailLevel === 2 ? 1000 : 1500,
        imageRequirements: [
          {
            type: ImageType.PHOTO_BUSINESS,
            placement: ImagePlacement.SIDE,
            description: "案例相关照片",
            keywords: ["case study", "business"],
            priority: "recommended",
          },
        ],
        visualBreaks: [VisualBreakType.QUOTE, VisualBreakType.CALLOUT],
        reasoning: "内容包含案例研究",
      });
    }

    if (features.hasRiskAnalysis) {
      sections.push({
        order: order++,
        templateType: DocsTemplateType.RISK_ASSESSMENT,
        title: "风险评估",
        level: 1,
        estimatedWordCount: detailLevel === 1 ? 500 : 800,
        imageRequirements: [
          {
            type: ImageType.INFOGRAPHIC,
            placement: ImagePlacement.HERO,
            description: "风险矩阵",
            keywords: ["risk", "matrix"],
            priority: "required",
          },
        ],
        visualBreaks: [VisualBreakType.CALLOUT],
        reasoning: "内容包含风险分析",
      });
    }

    if (features.hasRecommendations) {
      sections.push({
        order: order++,
        templateType: DocsTemplateType.RECOMMENDATIONS,
        title: "建议与行动计划",
        level: 1,
        estimatedWordCount:
          detailLevel === 1 ? 400 : detailLevel === 2 ? 700 : 1000,
        imageRequirements: [
          {
            type: ImageType.ICON,
            placement: ImagePlacement.ICON,
            description: "建议图标",
            keywords: ["action", "recommendation"],
            priority: "recommended",
          },
        ],
        visualBreaks: [VisualBreakType.CALLOUT],
        reasoning: "内容包含建议",
      });
    }

    // 4. 结论
    sections.push({
      order: order++,
      templateType: DocsTemplateType.CONCLUSION,
      title: "结论",
      level: 1,
      estimatedWordCount: detailLevel === 1 ? 300 : 500,
      imageRequirements: [],
      visualBreaks: [VisualBreakType.CALLOUT],
      reasoning: "总结核心观点和行动号召",
    });

    // 计算总字数
    const estimatedWordCount = sections.reduce(
      (sum, s) => sum + s.estimatedWordCount,
      0,
    );

    return {
      totalSections: sections.length,
      estimatedWordCount,
      sections,
    };
  }

  /**
   * 规划图片策略
   */
  private planImageStrategy(
    features: ContentFeatures,
  ): PlanningResult["imageStrategy"] {
    const types: ImageType[] = [];

    // 根据内容特征确定需要的图片类型
    if (features.hasStatistics) {
      types.push(ImageType.CHART, ImageType.INFOGRAPHIC);
    }
    if (features.hasTimeline) {
      types.push(ImageType.DIAGRAM);
    }
    if (features.hasCaseStudy) {
      types.push(ImageType.PHOTO_BUSINESS);
    }
    if (features.hasComparison) {
      types.push(ImageType.INFOGRAPHIC);
    }

    // 如果没有特殊需求，添加通用类型
    if (types.length === 0) {
      types.push(ImageType.ILLUSTRATION_FLAT, ImageType.PHOTO_ABSTRACT);
    }

    // 确定图片密度
    let density: "sparse" | "balanced" | "rich" = "balanced";
    if (features.dataDensity === DataDensity.DATA_HEAVY) {
      density = "rich";
    } else if (features.dataDensity === DataDensity.TEXT_HEAVY) {
      density = "sparse";
    }

    // 估算图片数量
    const baseCount =
      features.complexity === ContentComplexity.LOW
        ? 5
        : features.complexity === ContentComplexity.HIGH
          ? 15
          : 10;

    return {
      totalImages: baseCount,
      types: [...new Set(types)],
      density,
    };
  }
}

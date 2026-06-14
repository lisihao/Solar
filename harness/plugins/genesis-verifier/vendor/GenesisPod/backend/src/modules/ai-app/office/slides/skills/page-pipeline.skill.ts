/**
 * Slides Engine v6.0 - Page Generation Pipeline Skill
 *
 * 页面生成流水线：协调逐页生成和渲染
 *
 * v6.0 重构：AI 自适应 HTML 生成
 * - 每页先搜索图片（ImageFetcherSkill）
 * - AI 直接生成完整 HTML（SlideHtmlGenerationSkill）
 * - 后处理验证和保护（html-post-processor）
 * - 失败时降级到旧 TemplateRendering 流程
 *
 * 这是实现"完成一页发送一页"的核心组件
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import {
  ISkill,
  SkillContext,
  SkillResult,
  SkillLayer,
} from "@/modules/ai-harness/facade";
import {
  OutlinePlan,
  PageOutline,
  PageContent,
} from "../checkpoint/checkpoint.types";
import { TemplateRenderingSkill } from "./template-rendering.skill";
import { ContentCompressionSkill } from "./content-compression.skill";
import { ImageFetcherSkill } from "./image-fetcher.skill";
import { SlideHtmlGenerationSkill } from "./slide-html-generation.skill";
import { DesignTokenInjectorSkill } from "./design-token-injector.skill";
import { SmartContentExtractorSkill } from "./smart-content-extractor.skill";
import { SlideVisualValidatorSkill } from "./slide-visual-validator.skill";
import { SlideIterativeRefinerSkill } from "./slide-iterative-refiner.skill";
import { SlideSelfHealerSkill } from "./slide-self-healer.skill";

/**
 * 单页生成结果
 */
export interface PageGenerationResult {
  pageNumber: number;
  title: string;
  html: string;
  templateId: string;
  status: "completed" | "failed";
  error?: string;
  duration: number;
}

/**
 * 页面流水线输出
 */
export interface PagePipelineOutput {
  pages: PageGenerationResult[];
  totalPages: number;
  completedPages: number;
  failedPages: number;
  totalDuration: number;
}

/**
 * 页面设计思考数据（同步到 Thinking TAB）
 */
export interface PageDesignThinking {
  step1_drafting: {
    style: string;
    coreElements: string[];
    mood: string;
  };
  step2_refiningLayout: {
    alignment: string;
    graphicsPosition: string;
    spacing: string;
  };
  step3_planningVisuals: {
    backgroundColor: string;
    accentColors: string[];
    decorations: string[];
  };
  step4_formulatingHTML: {
    templateUsed: string;
    sectionsCount: number;
    hasImages: boolean;
  };
  reasoning: string; // 整体思考过程
}

/**
 * 页面生成事件（用于流式输出）
 */
export interface PageGeneratedEvent {
  type: "page:generated";
  pageNumber: number;
  totalPages: number;
  title: string;
  html: string;
  templateId: string;
  sessionId: string;
  /** 页面设计思考数据 */
  design?: PageDesignThinking;
  /** 页面大纲关键点 */
  keyPoints?: string[];
}

/**
 * MissionOrchestrator 传递的输入格式
 */
interface OrchestratorInput {
  task?: string;
  context?: {
    input?: {
      sourceText?: string;
      userRequirement?: string;
      themeId?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  previousOutputs?: Record<string, unknown>;
}

@Injectable()
export class PagePipelineSkill implements ISkill<
  OrchestratorInput,
  PagePipelineOutput
> {
  private readonly logger = new Logger(PagePipelineSkill.name);

  readonly id = "slides-page-pipeline";
  readonly name = "页面生成流水线";
  readonly description = "协调逐页生成内容和渲染 HTML，支持流式输出";
  readonly layer: SkillLayer = "orchestration";
  readonly domain = "slides";
  readonly tags = ["slides", "pipeline", "streaming", "generation"];
  readonly version = "6.0.0";

  constructor(
    private readonly templateRendering: TemplateRenderingSkill,
    private readonly contentCompression: ContentCompressionSkill,
    private readonly eventEmitter: EventEmitter2,
    @Optional() private readonly imageFetcher?: ImageFetcherSkill,
    @Optional() private readonly slideHtmlGeneration?: SlideHtmlGenerationSkill,
    @Optional() private readonly designTokenInjector?: DesignTokenInjectorSkill,
    @Optional()
    private readonly smartContentExtractor?: SmartContentExtractorSkill,
    @Optional() private readonly visualValidator?: SlideVisualValidatorSkill,
    @Optional() private readonly iterativeRefiner?: SlideIterativeRefinerSkill,
    @Optional() private readonly selfHealer?: SlideSelfHealerSkill,
  ) {}

  /**
   * 执行页面生成流水线
   */
  async execute(
    input: OrchestratorInput,
    context: SkillContext,
  ): Promise<SkillResult<PagePipelineOutput>> {
    const startTime = Date.now();
    const sessionId = context.sessionId || "unknown";

    this.logger.log(
      `[execute] Starting page pipeline v6.0 for session ${sessionId}`,
    );

    // 1. 提取必要数据
    const { outlinePlan, sourceText, themeId } = this.extractInputData(input);

    if (!outlinePlan?.pages || outlinePlan.pages.length === 0) {
      this.logger.error("[execute] No outline plan or pages found");
      return {
        success: false,
        error: {
          code: "NO_OUTLINE_PLAN",
          message: "未找到大纲规划或页面列表",
          retryable: false,
        },
        metadata: {
          executionId: context.executionId,
          startTime: new Date(startTime),
          endTime: new Date(),
          duration: Date.now() - startTime,
        },
      };
    }

    const totalPages = outlinePlan.pages.length;
    const pages: PageGenerationResult[] = [];
    let completedPages = 0;
    let failedPages = 0;
    let previousPageSummary: string | undefined;

    // 检测是否可用 AI HTML 生成
    const useAiHtmlGeneration = !!this.slideHtmlGeneration;
    this.logger.log(
      `[execute] AI HTML generation: ${useAiHtmlGeneration ? "enabled" : "disabled (fallback to template)"}`,
    );

    // 2. 逐页生成
    for (let i = 0; i < totalPages; i++) {
      const pageOutline = outlinePlan.pages[i];
      const pageNumber = pageOutline.pageNumber || i + 1;
      const pageStartTime = Date.now();

      this.logger.log(
        `[execute] Processing page ${pageNumber}/${totalPages}: ${pageOutline.title}`,
      );

      // 发送页面开始生成事件
      this.eventEmitter.emit("slides.page.generating", {
        pageNumber,
        totalPages,
        title: pageOutline.title,
        templateType: pageOutline.templateType || "content",
        sessionId,
      });

      try {
        let html: string;
        let templateId: string;
        let designDecisions: string | undefined;
        let hasImages = false;

        if (useAiHtmlGeneration) {
          // ★ v6.0 新流程：图片搜索 → AI HTML 生成
          const result = await this.generateWithAi(
            pageOutline,
            sourceText,
            themeId,
            i,
            totalPages,
            previousPageSummary,
            context,
          );
          html = result.html;
          templateId = "ai-generated";
          designDecisions = result.designDecisions;
          hasImages = result.hasImages;
        } else {
          // 降级：旧流程（ContentCompression → TemplateRendering）
          const result = await this.generateWithTemplate(
            pageOutline,
            sourceText,
            themeId,
            context,
          );
          html = result.html;
          templateId = result.templateId;
        }

        // P1 Enhancement: Visual Validation + Iterative Refinement
        if (html && this.visualValidator) {
          try {
            const validationResult = await this.visualValidator.execute(
              { html, themeId },
              {
                ...context,
                executionId: `${context.executionId}-validate-${pageNumber}`,
              },
            );

            if (
              validationResult.success &&
              validationResult.data &&
              !validationResult.data.passed
            ) {
              this.logger.log(
                `[execute] Page ${pageNumber} validation failed (score=${validationResult.data.score}), attempting refinement`,
              );

              if (this.iterativeRefiner) {
                const refineResult = await this.iterativeRefiner.execute(
                  {
                    html,
                    validationReport: validationResult.data,
                    pageOutline,
                    themeId,
                    slideIndex: pageOutline.pageNumber - 1,
                    totalSlides: totalPages,
                    maxIterations: 2,
                  },
                  {
                    ...context,
                    executionId: `${context.executionId}-refine-${pageNumber}`,
                  },
                );

                if (refineResult.success && refineResult.data?.improved) {
                  html = refineResult.data.html;
                  this.logger.log(
                    `[execute] Page ${pageNumber} refined: score ${validationResult.data.score} -> ${refineResult.data.finalScore}`,
                  );
                }
              }
            }
          } catch (validationError) {
            this.logger.warn(
              `[execute] Page ${pageNumber} validation/refinement failed: ${validationError}`,
            );
          }
        }

        const htmlLength = html?.length || 0;
        this.logger.log(
          `[execute] Page ${pageNumber} rendered successfully, HTML length: ${htmlLength}`,
        );

        const result: PageGenerationResult = {
          pageNumber,
          title: pageOutline.title,
          html,
          templateId,
          status: "completed",
          duration: Date.now() - pageStartTime,
        };

        pages.push(result);
        completedPages++;

        // 生成设计思考数据
        const designThinking = this.generateDesignThinking(
          pageOutline,
          templateId,
          designDecisions,
          hasImages,
        );

        // 更新上一页摘要（用于 AI 生成时保持连贯性）
        previousPageSummary = `Page ${pageNumber}: "${pageOutline.title}" - ${pageOutline.templateType} layout, ${designDecisions || templateId}`;

        // 发送页面生成事件（流式输出的关键）
        this.emitPageGenerated({
          type: "page:generated",
          pageNumber,
          totalPages,
          title: pageOutline.title,
          html,
          templateId,
          sessionId,
          design: designThinking,
          keyPoints: pageOutline.keyElements || [],
        });

        this.logger.log(
          `[execute] Page ${pageNumber} completed in ${result.duration}ms`,
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "未知错误";

        this.logger.error(
          `[execute] Page ${pageNumber} failed: ${errorMessage}`,
        );

        // P2 Enhancement: Try self-healing before marking as failed
        if (this.selfHealer) {
          try {
            const healResult = await this.selfHealer.execute(
              {
                failedHtml: "",
                error: errorMessage,
                pageOutline,
                themeId,
                slideIndex: pageOutline.pageNumber - 1,
                totalSlides: totalPages,
              },
              {
                ...context,
                executionId: `${context.executionId}-heal-${pageNumber}`,
              },
            );

            if (healResult.success && healResult.data?.healed) {
              this.logger.log(
                `[execute] Page ${pageNumber} healed with strategy: ${healResult.data.strategy} (confidence: ${healResult.data.confidence})`,
              );
              pages.push({
                pageNumber,
                title: pageOutline.title,
                html: healResult.data.html,
                templateId: `healed-${healResult.data.strategy}`,
                status: "completed",
                duration: Date.now() - pageStartTime,
              });
              completedPages++;

              this.emitPageGenerated({
                type: "page:generated",
                pageNumber,
                totalPages,
                title: pageOutline.title,
                html: healResult.data.html,
                templateId: `healed-${healResult.data.strategy}`,
                sessionId,
                design: undefined,
                keyPoints: pageOutline.keyElements || [],
              });
              continue;
            }
          } catch (healError) {
            this.logger.warn(
              `[execute] Self-healing also failed: ${healError}`,
            );
          }
        }

        pages.push({
          pageNumber,
          title: pageOutline.title,
          html: "",
          templateId: "",
          status: "failed",
          error: errorMessage,
          duration: Date.now() - pageStartTime,
        });

        failedPages++;

        // 发送失败事件
        this.eventEmitter.emit("slides.page.failed", {
          pageNumber,
          totalPages,
          title: pageOutline.title,
          error: errorMessage,
          sessionId,
        });
      }
    }

    // 3. 返回结果
    const output: PagePipelineOutput = {
      pages,
      totalPages,
      completedPages,
      failedPages,
      totalDuration: Date.now() - startTime,
    };

    this.logger.log(
      `[execute] Pipeline completed: ${completedPages}/${totalPages} pages, ${failedPages} failed`,
    );

    return {
      success: failedPages === 0,
      data: output,
      metadata: {
        executionId: context.executionId,
        startTime: new Date(startTime),
        endTime: new Date(),
        duration: Date.now() - startTime,
      },
    };
  }

  /**
   * v6.0 新流程：图片搜索 → AI HTML 生成
   * 失败时自动降级到旧 TemplateRendering 流程
   */
  private async generateWithAi(
    pageOutline: PageOutline,
    sourceText: string,
    themeHint: string,
    slideIndex: number,
    totalSlides: number,
    previousPageSummary: string | undefined,
    context: SkillContext,
  ): Promise<{ html: string; designDecisions: string; hasImages: boolean }> {
    // Detect language from source text
    const language = this.detectLanguage(sourceText);

    // P0 Enhancement: Design Token Injection
    let themePromptFragment: string | undefined;
    if (this.designTokenInjector) {
      try {
        const tokenResult = await this.designTokenInjector.execute(
          { themeId: themeHint || "genspark-dark" },
          {
            ...context,
            executionId: `${context.executionId}-tokens-${pageOutline.pageNumber}`,
          },
        );
        if (tokenResult.success && tokenResult.data) {
          themePromptFragment = tokenResult.data.promptFragment;
        }
      } catch (error) {
        this.logger.warn(
          `[generateWithAi] Design token injection failed: ${error}`,
        );
      }
    }

    // P0 Enhancement: Smart Content Extraction
    let extractedContent: string | undefined;
    if (this.smartContentExtractor && sourceText) {
      try {
        const extractResult = await this.smartContentExtractor.execute(
          { pageOutline, sourceText },
          {
            ...context,
            executionId: `${context.executionId}-extract-${pageOutline.pageNumber}`,
          },
        );
        if (extractResult.success && extractResult.data?.promptFragment) {
          extractedContent = extractResult.data.promptFragment;
        }
      } catch (error) {
        this.logger.warn(
          `[generateWithAi] Smart content extraction failed: ${error}`,
        );
      }
    }

    // Step 1: 搜索图片
    let imageUrls: string[] = [];
    if (this.imageFetcher) {
      try {
        const keywords = this.imageFetcher.extractKeywords(
          pageOutline.title,
          pageOutline.contentBrief,
        );
        if (keywords.length > 0) {
          const imageResult = await this.imageFetcher.searchImages({
            keywords,
            size: "medium",
            orientation: "landscape",
            count: 2,
          });
          imageUrls = imageResult.map((img) => img.url);
          this.logger.log(
            `[generateWithAi] Found ${imageUrls.length} images for page "${pageOutline.title}"`,
          );
        }
      } catch (error) {
        this.logger.warn(
          `[generateWithAi] Image search failed, proceeding without images: ${error}`,
        );
      }
    }

    // Step 2: AI 生成完整 HTML
    try {
      if (!this.slideHtmlGeneration) {
        throw new Error("SlideHtmlGenerationSkill not available");
      }
      const aiResult = await this.slideHtmlGeneration.execute(
        {
          pageOutline,
          sourceText,
          imageUrls,
          themeHint: this.resolveThemeHint(themeHint),
          previousPageSummary,
          slideIndex,
          totalSlides,
          language,
          themePromptFragment,
          extractedContent,
        },
        {
          ...context,
          executionId: `${context.executionId}-ai-html-${pageOutline.pageNumber}`,
        },
      );

      if (aiResult.success && aiResult.data?.html) {
        return {
          html: aiResult.data.html,
          designDecisions: aiResult.data.designDecisions,
          hasImages: imageUrls.length > 0,
        };
      }

      this.logger.warn(
        `[generateWithAi] AI HTML generation returned no data, falling back to template`,
      );
    } catch (error) {
      this.logger.warn(
        `[generateWithAi] AI HTML generation failed, falling back to template: ${error}`,
      );
    }

    // Step 3: 降级到旧 TemplateRendering 流程
    this.logger.log(
      `[generateWithAi] Fallback: using template rendering for page "${pageOutline.title}"`,
    );
    const fallback = await this.generateWithTemplate(
      pageOutline,
      sourceText,
      themeHint,
      context,
    );
    return {
      html: fallback.html,
      designDecisions: `Fallback to template: ${fallback.templateId}`,
      hasImages: false,
    };
  }

  /**
   * 旧流程：ContentCompression → TemplateRendering（降级方案）
   */
  private async generateWithTemplate(
    pageOutline: PageOutline,
    sourceText: string,
    themeId: string,
    context: SkillContext,
  ): Promise<{ html: string; templateId: string }> {
    // Generate page content
    const pageContent = await this.generatePageContent(
      pageOutline,
      sourceText,
      context,
    );

    // Render HTML with template
    const renderResult = await this.templateRendering.execute(
      {
        pageOutline,
        pageContent,
        themeId,
      },
      {
        ...context,
        executionId: `${context.executionId}-render-${pageOutline.pageNumber}`,
      },
    );

    if (renderResult.success && renderResult.data) {
      return {
        html: renderResult.data.html,
        templateId: renderResult.data.templateId,
      };
    }

    throw new Error(renderResult.error?.message || "Template rendering failed");
  }

  /**
   * 提取输入数据
   */
  private extractInputData(input: OrchestratorInput): {
    outlinePlan: OutlinePlan | null;
    sourceText: string;
    themeId: string;
  } {
    const previousOutputs = input.previousOutputs || {};
    const contextInput = input.context?.input || {};

    const inputWithOutline = input as OrchestratorInput & {
      outline?: OutlinePlan;
      sourceText?: string;
      themeId?: string;
    };

    let outlinePlan =
      inputWithOutline.outline ||
      (previousOutputs["slides-outline-planning"] as OutlinePlan) ||
      (previousOutputs["outline-planning"] as OutlinePlan) ||
      (input.context?.outlinePlan as OutlinePlan) ||
      (input.context?.outline as OutlinePlan) ||
      null;

    // 如果大纲在 data 字段中（嵌套结构）
    if (!outlinePlan && previousOutputs["slides-outline-planning"]) {
      const maybeNested = previousOutputs["slides-outline-planning"] as {
        data?: OutlinePlan;
      };
      if (maybeNested.data?.pages) {
        outlinePlan = maybeNested.data;
      }
    }

    const sourceText =
      inputWithOutline.sourceText ||
      (contextInput.sourceText as string) ||
      (input.context?.sourceText as string) ||
      "";
    const themeId =
      inputWithOutline.themeId ||
      (contextInput.themeId as string) ||
      (input.context?.themeId as string) ||
      "genspark-dark";

    this.logger.log(
      `[extractInputData] Found outline: ${!!outlinePlan}, pages: ${outlinePlan?.pages?.length || 0}, sourceText: ${sourceText.length} chars, themeId: ${themeId}`,
    );
    if (!outlinePlan) {
      this.logger.error(
        `[extractInputData] OUTLINE NOT FOUND! input keys: ${Object.keys(input).join(", ")}, previousOutputs keys: ${Object.keys(input.previousOutputs || {}).join(", ")}`,
      );
    }

    return { outlinePlan, sourceText, themeId };
  }

  /**
   * 生成页面内容（旧流程降级用）
   */
  private async generatePageContent(
    pageOutline: PageOutline,
    sourceText: string,
    context: SkillContext,
  ): Promise<PageContent> {
    try {
      const result = await this.contentCompression.execute(
        {
          pageOutline,
          sourceText,
          maxCharacters: 500,
        },
        {
          ...context,
          executionId: `${context.executionId}-compress-${pageOutline.pageNumber}`,
        },
      );

      if (result.success && result.data?.pageContent) {
        return result.data.pageContent;
      }
    } catch (error) {
      this.logger.warn(
        `[generatePageContent] ContentCompression failed: ${error}`,
      );
    }

    return this.createBasicPageContent(pageOutline);
  }

  /**
   * 创建基础页面内容（降级方案）
   */
  private createBasicPageContent(pageOutline: PageOutline): PageContent {
    return {
      title: pageOutline.title,
      subtitle: pageOutline.subtitle,
      sections:
        pageOutline.keyElements?.map((element) => ({
          type: "text" as const,
          position: "center" as const,
          content: element,
        })) || [],
    };
  }

  /**
   * 生成页面设计思考数据
   * v6.0: 支持 AI 生成模式和模板模式的设计思考
   */
  private generateDesignThinking(
    pageOutline: PageOutline,
    templateId: string,
    designDecisions?: string,
    hasImages?: boolean,
  ): PageDesignThinking {
    const templateType = pageOutline.templateType || "content";
    const isAiGenerated = templateId === "ai-generated";

    const styleMap: Record<string, string> = {
      cover: "大标题居中，强调视觉冲击",
      chapterTitle: "章节标题突出，引导阅读",
      toc: "目录结构清晰，便于导航",
      questions: "问题导向，引发思考",
      pillars: "支柱结构，层次分明",
      framework: "框架展示，逻辑清晰",
      timeline: "时间线结构，流程清晰",
      evolutionRoadmap: "演进路线图，发展脉络",
      dashboard: "数据仪表盘，指标突出",
      comparison: "对比布局，差异突出",
      splitLayout: "分栏布局，内容均衡",
      caseStudy: "案例分析，深度剖析",
      multiColumn: "多栏布局，信息密集",
      recommendations: "建议方案，行动导向",
      maturityModel: "成熟度模型，阶段清晰",
      riskOpportunity: "风险机遇分析，决策支持",
      closing: "总结归纳，要点突出",
    };

    const moodMap: Record<string, string> = {
      cover: "专业、大气、引人注目",
      chapterTitle: "过渡、引导、承上启下",
      toc: "结构化、导航感、全局视角",
      pillars: "稳固、支撑、核心要素",
      framework: "系统化、结构化、逻辑性",
      timeline: "有序、流程感、时间感",
      dashboard: "数据驱动、量化、精确",
      comparison: "对比、选择、决策导向",
      closing: "归纳、重点、收尾",
    };

    const coreElements: string[] = [
      `标题: ${pageOutline.title}`,
      ...(pageOutline.subtitle ? [`副标题: ${pageOutline.subtitle}`] : []),
      ...(pageOutline.keyElements?.slice(0, 3).map((e) => `要点: ${e}`) || []),
    ];

    const decorations: string[] = isAiGenerated
      ? [
          "AI 自适应布局",
          "Font Awesome 图标",
          hasImages ? "Unsplash 图片" : "色彩块",
        ]
      : ["列表图标", "分隔线"];

    const reasoning = isAiGenerated
      ? `
【页面 ${pageOutline.pageNumber} AI 自适应设计】

1. 图片搜索: ${hasImages ? "已获取相关图片" : "无图片，使用图标替代"}
2. AI HTML 生成: 根据设计系统规范直接生成完整 HTML
3. 配色方案: AI 根据内容主题自适应选择
4. 布局决策: ${designDecisions || "AI 自适应"}

页面类型: ${templateType}
核心内容: ${pageOutline.title}
`.trim()
      : `
【页面 ${pageOutline.pageNumber} 模板渲染】

使用模板: ${templateId}
页面类型: ${templateType}
核心内容: ${pageOutline.title}
`.trim();

    return {
      step1_drafting: {
        style: styleMap[templateType] || "标准内容布局",
        coreElements,
        mood: moodMap[templateType] || "专业、清晰",
      },
      step2_refiningLayout: {
        alignment: isAiGenerated ? "AI 自适应对齐" : "模板预设对齐",
        graphicsPosition: hasImages ? "包含图片" : "无图片",
        spacing: "标准间距 (24px)",
      },
      step3_planningVisuals: {
        backgroundColor: isAiGenerated ? "AI 自适应配色" : "继承主题背景色",
        accentColors: isAiGenerated ? ["AI 自选强调色"] : ["主题强调色"],
        decorations,
      },
      step4_formulatingHTML: {
        templateUsed: templateId,
        sectionsCount: pageOutline.keyElements?.length || 0,
        hasImages: hasImages || false,
      },
      reasoning,
    };
  }

  /**
   * 检测源文本语言
   */
  private detectLanguage(sourceText: string): string | undefined {
    if (!sourceText) return undefined;
    // Count Chinese characters in the first 500 chars
    const sample = sourceText.substring(0, 500);
    const chineseChars = (sample.match(/[\u4e00-\u9fa5]/g) || []).length;
    const ratio = chineseChars / sample.length;
    if (ratio > 0.1) return "Chinese (Simplified)";
    return undefined; // Default: let AI decide based on content
  }

  /**
   * 将内部 themeId 转为 AI 可理解的风格描述
   */
  private resolveThemeHint(themeId: string): string {
    const themeDescriptions: Record<string, string> = {
      "genspark-dark":
        "Dark prestige theme with gold accents, navy backgrounds for cover/closing, light backgrounds for content pages",
      "corporate-blue": "Professional business blue theme, clean and corporate",
      "tech-modern": "Modern tech purple theme, innovative and forward-looking",
      "nature-green": "Natural green theme, sustainability-focused and calming",
      "warm-creative": "Warm orange creative theme, energetic and engaging",
    };
    return themeDescriptions[themeId] || themeId;
  }

  /**
   * 发送页面生成事件
   */
  private emitPageGenerated(event: PageGeneratedEvent): void {
    this.logger.log(
      `[emitPageGenerated] Emitting event for page=${event.pageNumber}, htmlLength=${event.html?.length || 0}`,
    );

    if (!this.eventEmitter) {
      this.logger.error("[emitPageGenerated] eventEmitter is NULL!");
      return;
    }

    this.eventEmitter.emit("slides.page.generated", event);
  }
}

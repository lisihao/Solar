/**
 * Slides Engine v3.0 - Template Rendering Skill
 *
 * 确定性模板渲染：将 PageContent.sections 映射到模板变量，生成 HTML
 * 完全不依赖 AI，确保输出稳定可控
 */

import { Injectable, Logger } from "@nestjs/common";
import {
  PageOutline,
  PageContent,
  ContentSection,
  StatContent,
  PageTemplateType,
} from "../checkpoint/checkpoint.types";
import { templateRegistry, applyVariables, SlideTemplate } from "../templates";
import { CARD_STYLE, COLORS } from "../templates/base/common-styles";
import {
  getTheme,
  getThemeContainerStyle,
  getThemeDecorationHtml,
  ThemeConfig,
} from "../templates/base/themes";
import { ChartRendererSkill } from "./chart-renderer.skill";
import {
  MISSING_PLACEHOLDER,
  MISSING_NUMBER_PLACEHOLDER,
  MISSING_ICON_PLACEHOLDER,
} from "../templates/base/template-requirements";
import {
  ISkill,
  SkillContext,
  SkillResult,
  SkillLayer,
  SKILL_LAYERS,
} from "@/modules/ai-harness/facade";

/**
 * 模板渲染输入
 */
export interface TemplateRenderingInput {
  pageOutline: PageOutline;
  pageContent: PageContent;
  /** 使用的已用数据值集合（用于防止重复） */
  usedValues?: Set<string>;
  /** 主题ID，默认为 'genspark-dark' */
  themeId?: string;
}

/**
 * MissionOrchestrator 传递的输入格式
 */
interface OrchestratorInput {
  task?: string;
  context?: {
    input?: {
      themeId?: string;
      [key: string]: unknown;
    };
    pageOutline?: PageOutline;
    pageContent?: PageContent;
    [key: string]: unknown;
  };
  previousOutputs?: Record<string, unknown>;
}

/**
 * 模板渲染结果
 */
export interface TemplateRenderingResult {
  html: string;
  templateId: string;
  variables: Record<string, string>;
  themeId: string;
}

@Injectable()
export class TemplateRenderingSkill implements ISkill<
  TemplateRenderingInput,
  TemplateRenderingResult
> {
  private readonly logger = new Logger(TemplateRenderingSkill.name);

  // ISkill interface implementation
  readonly id = "slides-template-rendering";
  readonly name = "模板渲染";
  readonly description = "将内容渲染到幻灯片模板中生成最终 HTML";
  readonly layer: SkillLayer = SKILL_LAYERS.RENDERING;
  readonly domain = "slides";
  readonly tags = ["slides", "template", "rendering", "html"];
  readonly version = "4.0.0";

  constructor(private readonly chartRenderer: ChartRendererSkill) {}

  /**
   * ISkill 接口实现：执行技能
   *
   * 支持两种输入格式：
   * 1. 直接调用: { pageOutline, pageContent, usedValues?, themeId? }
   * 2. MissionOrchestrator 格式: { task, context, previousOutputs }
   */
  async execute(
    input: TemplateRenderingInput | OrchestratorInput,
    context: SkillContext,
  ): Promise<SkillResult<TemplateRenderingResult>> {
    const startTime = new Date();

    // 处理 Orchestrator 输入格式
    const actualInput = this.normalizeInput(input);
    // 检查必需的属性是否存在（不只是检查对象是否存在，因为空对象 {} 也是 truthy）
    if (
      !actualInput.pageOutline?.templateType ||
      !actualInput.pageContent?.title
    ) {
      this.logger.error(
        `[execute] Invalid input: pageOutline.templateType=${actualInput.pageOutline?.templateType}, pageContent.title=${actualInput.pageContent?.title}`,
      );
      return {
        success: false,
        error: {
          code: "INVALID_INPUT",
          message:
            "Missing pageOutline.templateType or pageContent.title in input",
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
      const result = this.render(actualInput);

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
        error instanceof Error ? error.message : "模板渲染失败：未知错误";

      this.logger.error(
        `[execute] Template rendering failed: ${errorMessage}`,
        error,
      );

      const details =
        error instanceof Error && error.stack
          ? { stack: error.stack }
          : undefined;

      return {
        success: false,
        error: {
          code: "TEMPLATE_RENDERING_ERROR",
          message: errorMessage,
          details,
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
   * 规范化输入格式
   * 支持直接调用格式和 MissionOrchestrator 格式
   */
  private normalizeInput(
    input: TemplateRenderingInput | OrchestratorInput,
  ): TemplateRenderingInput {
    // 检查是否是直接调用格式（有 pageOutline 属性且类型正确）
    if (
      "pageOutline" in input &&
      input.pageOutline &&
      typeof input.pageOutline === "object" &&
      "templateType" in input.pageOutline
    ) {
      return input;
    }

    // 处理 Orchestrator 格式
    const orchestratorInput = input as OrchestratorInput;
    const previousOutputs = orchestratorInput.previousOutputs || {};
    const context = orchestratorInput.context || {};

    // 尝试从多个位置获取 pageOutline 和 pageContent
    let pageOutline = context.pageOutline;
    let pageContent = context.pageContent;

    // 如果 context 中没有，尝试从 previousOutputs 获取
    if (!pageOutline && previousOutputs["slides-outline-planning"]) {
      const outlinePlan = previousOutputs["slides-outline-planning"] as {
        pages?: PageOutline[];
      };
      // 取第一个 page 作为当前处理的 page（实际场景可能需要更复杂的逻辑）
      if (outlinePlan.pages && outlinePlan.pages.length > 0) {
        pageOutline = outlinePlan.pages[0];
      }
    }

    // 尝试从 context 中的其他字段获取
    if (!pageOutline && context.input) {
      const ctxInput = context.input as Record<string, unknown>;
      if (ctxInput.pageOutline) {
        pageOutline = ctxInput.pageOutline as PageOutline;
      }
    }

    if (!pageContent && context.input) {
      const ctxInput = context.input as Record<string, unknown>;
      if (ctxInput.pageContent) {
        pageContent = ctxInput.pageContent as PageContent;
      }
    }

    const themeId = context.input?.themeId || "genspark-dark";

    if (pageOutline && pageContent) {
      return {
        pageOutline,
        pageContent,
        themeId,
      };
    }

    // 返回不完整输入，让调用者处理错误
    this.logger.warn(
      `[normalizeInput] Could not extract required data. pageOutline: ${!!pageOutline}, pageContent: ${!!pageContent}`,
    );
    return {
      pageOutline: pageOutline || ({} as PageOutline),
      pageContent: pageContent || ({} as PageContent),
      themeId,
    };
  }

  /**
   * 渲染页面 - 主入口
   */
  render(input: TemplateRenderingInput): TemplateRenderingResult {
    const {
      pageOutline,
      pageContent,
      usedValues,
      themeId = "genspark-dark",
    } = input;
    const templateType = pageOutline.templateType;

    this.logger.log(
      `[render] Rendering page ${pageOutline.pageNumber} with template type: ${templateType}, theme: ${themeId}`,
    );

    // 0. 获取主题配置
    const theme = getTheme(themeId);

    // 1. 获取模板
    const template = this.selectTemplate(templateType);
    if (!template) {
      this.logger.warn(
        `[render] No template found for type: ${templateType}, using fallback`,
      );
      return this.renderFallback(pageOutline, pageContent, themeId);
    }

    const templateId = template.metadata.id;

    // 2. 提取变量 - 根据模板ID精确匹配变量提取逻辑
    const variables = this.extractVariablesByTemplateId(
      templateId,
      templateType,
      pageOutline,
      pageContent,
      usedValues,
    );

    // 3. 应用变量到模板
    let contentHtml = applyVariables(template, variables);

    // 4. 注入图表 SVG（如果模板包含图表占位符）
    contentHtml = this.injectChartSvg(contentHtml, pageContent, theme);

    // 5. 添加脚本（如果有）
    if (template.script) {
      contentHtml += `\n<script>\n${template.script}\n</script>`;
    }

    // 6. 包装主题容器和装饰元素
    const html = this.wrapWithTheme(contentHtml, theme);

    this.logger.log(
      `[render] Page ${pageOutline.pageNumber} rendered with template ${templateId}, theme ${themeId}`,
    );

    return {
      html,
      templateId,
      variables,
      themeId,
    };
  }

  /**
   * 包装HTML内容到主题容器，添加装饰元素
   * 增强：添加全局溢出保护样式
   */
  private wrapWithTheme(contentHtml: string, theme: ThemeConfig): string {
    const containerStyle = getThemeContainerStyle(theme);
    const decorationHtml = getThemeDecorationHtml(theme);

    // 全局溢出保护 CSS（增强版 v3.2）
    const overflowProtectionStyles = `
<style>
  /* 基础盒模型 */
  .slide-container * {
    box-sizing: border-box;
  }

  /* 标题溢出保护 */
  .slide-container h1, .slide-container h2, .slide-container h3, .slide-container h4 {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* 段落文字限制行数 */
  .slide-container p {
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    -webkit-box-orient: vertical;
    line-height: 1.5;
  }

  /* 列表溢出保护 */
  .slide-container ul, .slide-container ol {
    overflow: hidden;
    margin: 0;
    padding-left: 20px;
  }
  .slide-container li {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-bottom: 4px;
  }

  /* 内容区域溢出保护 */
  .slide-content > div {
    overflow: hidden;
  }

  /* ⭐ 图片溢出保护（v3.2 新增） */
  .slide-container img {
    max-width: 100%;
    max-height: 100%;
    width: auto;
    height: auto;
    object-fit: contain;
    display: block;
  }

  /* 图片容器强制限制 */
  .slide-container [class*="image"],
  .slide-container [style*="background-image"] {
    overflow: hidden;
    background-size: contain;
    background-position: center;
    background-repeat: no-repeat;
  }

  /* SVG 溢出保护 */
  .slide-container svg {
    max-width: 100%;
    max-height: 100%;
    overflow: hidden;
  }

  /* Flex 子元素防溢出 */
  .slide-container [style*="display: flex"] > * {
    min-width: 0;
    min-height: 0;
    flex-shrink: 1;
  }

  /* Grid 子元素防溢出 */
  .slide-container [style*="display: grid"] > * {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
</style>`;

    return `
${overflowProtectionStyles}
<div class="slide-container" style="${containerStyle.replace(/\n/g, " ").trim()}">
  ${decorationHtml}
  <div class="slide-content" style="position: relative; z-index: 1; height: 100%; display: flex; flex-direction: column; overflow: hidden;">
    ${contentHtml}
  </div>
</div>
    `.trim();
  }

  /**
   * 注入图表 SVG 到 HTML
   * 查找图表占位符（id="chart-*" 的 div）并替换为实际图表
   * 增强版：更灵活的匹配 + 失败时提供占位图表
   */
  private injectChartSvg(
    html: string,
    pageContent: PageContent,
    theme: ThemeConfig,
  ): string {
    // 更灵活的匹配模式：支持各种属性顺序和可选内容
    const chartPlaceholderPatterns = [
      // 模式1: id="chart-xxx" style="..." (空div)
      /<div\s+id="chart-(\w+)"[^>]*>\s*<\/div>/gi,
      // 模式2: style="..." id="chart-xxx" (空div)
      /<div\s+[^>]*id="chart-(\w+)"[^>]*>\s*<\/div>/gi,
      // 模式3: 包含占位文本的div
      /<div\s+id="chart-(\w+)"[^>]*>[^<]*<\/div>/gi,
    ];

    let processedHtml = html;

    for (const pattern of chartPlaceholderPatterns) {
      processedHtml = processedHtml.replace(pattern, (_match, chartType) => {
        return this.renderChartReplacement(chartType, pageContent, theme);
      });
    }

    return processedHtml;
  }

  /**
   * 渲染图表替换内容
   */
  private renderChartReplacement(
    chartType: string,
    pageContent: PageContent,
    theme: ThemeConfig,
  ): string {
    const mappedType = this.mapChartType(chartType);
    const themeMode =
      theme.id.includes("white") || theme.id.includes("light")
        ? "light"
        : "dark";

    try {
      // 从内容中提取图表数据，或生成示例数据
      const chartData =
        this.chartRenderer.extractChartData(
          pageContent.sections || [],
          mappedType,
        ) || this.chartRenderer.generateSampleData(mappedType);

      // 渲染 SVG
      const svgStr = this.chartRenderer.renderToSvg(chartData, {
        width: 500,
        height: 300,
        theme: themeMode,
        showLegend: true,
      });

      this.logger.log(`[injectChartSvg] Injected ${chartType} chart SVG`);
      return `<div id="chart-${chartType}" style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;">${svgStr}</div>`;
    } catch (error) {
      this.logger.warn(`[injectChartSvg] Failed to render chart: ${error}`);
      // 失败时返回占位图表，而非空div
      return this.renderFallbackChart(chartType, mappedType, themeMode);
    }
  }

  /**
   * 渲染降级占位图表
   */
  private renderFallbackChart(
    chartType: string,
    mappedType: string,
    themeMode: "dark" | "light",
  ): string {
    const bgColor = themeMode === "dark" ? "#1E293B" : "#F1F5F9";
    const textColor = themeMode === "dark" ? "#94A3B8" : "#475569";
    const accentColor = "#F97316";

    const typeLabels: Record<string, string> = {
      line: "趋势图",
      bar: "柱状图",
      pie: "饼图",
      radar: "雷达图",
      trend: "趋势图",
    };
    const label = typeLabels[mappedType] || "数据图表";

    // 生成简单的占位图表 SVG
    const fallbackSvg = `
<svg width="500" height="300" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="${bgColor}" rx="8"/>
  <g transform="translate(250, 120)">
    <circle r="40" fill="${accentColor}20" stroke="${accentColor}" stroke-width="2"/>
    <text text-anchor="middle" y="5" fill="${textColor}" font-size="24">📊</text>
  </g>
  <text x="50%" y="200" text-anchor="middle" fill="${textColor}" font-size="16" font-weight="500">${label}</text>
  <text x="50%" y="230" text-anchor="middle" fill="${textColor}80" font-size="12">数据可视化</text>
</svg>`.trim();

    return `<div id="chart-${chartType}" style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;">${fallbackSvg}</div>`;
  }

  /**
   * 映射图表类型名称到 ChartData 类型
   */
  private mapChartType(typeName: string): "line" | "bar" | "pie" | "radar" {
    const mapping: Record<string, "line" | "bar" | "pie" | "radar"> = {
      trend: "line",
      line: "line",
      bar: "bar",
      column: "bar",
      pie: "pie",
      donut: "pie",
      radar: "radar",
      spider: "radar",
    };
    return mapping[typeName.toLowerCase()] || "bar";
  }

  /**
   * 选择模板
   */
  private selectTemplate(templateType: PageTemplateType): SlideTemplate | null {
    const templates = templateRegistry.getByType(templateType);
    if (templates.length > 0) {
      // 优先选择 medium 密度的模板
      const medium = templates.find(
        (t) => t.metadata.contentDensity === "medium",
      );
      return medium || templates[0];
    }
    return null;
  }

  /**
   * 根据模板ID精确提取变量
   * 解决同一类型多个模板变量不一致的问题
   */
  private extractVariablesByTemplateId(
    templateId: string,
    templateType: PageTemplateType,
    pageOutline: PageOutline,
    pageContent: PageContent,
    usedValues?: Set<string>,
  ): Record<string, string> {
    const baseVars: Record<string, string> = {
      TITLE: pageContent.title || pageOutline.title,
      SUBTITLE: pageContent.subtitle || pageOutline.subtitle || "",
      DATE: new Date().toLocaleDateString("zh-CN"),
    };

    // 根据具体模板ID精确匹配变量提取逻辑
    switch (templateId) {
      // ========== Data Templates (D-001 ~ D-006) ==========
      case "D-001": // Big Number
        return { ...baseVars, ...this.extractBigNumberVariables(pageContent) };
      case "D-002": // Dashboard 4KPI
        return {
          ...baseVars,
          ...this.extractDashboardVariables(pageContent, usedValues),
        };
      case "D-003": // Trend Chart
        return {
          ...baseVars,
          ...this.extractTrendChartVariables(pageContent),
        };
      case "D-004": // Comparison Dual
        return {
          ...baseVars,
          ...this.extractComparisonDualVariables(pageContent),
        };
      case "D-005": // Comparison Table
        return {
          ...baseVars,
          ...this.extractComparisonTableVariables(pageContent),
        };
      case "D-006": // Ranking List
        return {
          ...baseVars,
          ...this.extractRankingListVariables(pageContent),
        };

      // ========== Structural Templates (S-001 ~ S-009) ==========
      case "S-001": // TOC Dual
        return {
          ...baseVars,
          ...this.extractTocVariables(pageContent, pageOutline),
        };
      case "S-002": // Section Divider (章节分隔页)
        // v3.5.3: 使用专门的章节变量提取，修复章节号总是1的问题
        return {
          ...baseVars,
          ...this.extractChapterTitleVariables(pageOutline, pageContent),
        };
      case "S-003": // 3-Pillar
      case "S-004": // 4-Pillar
      case "S-005": // 5-Pillar
        return {
          ...baseVars,
          ...this.extractPillarsVariables(pageContent, usedValues),
        };
      case "S-006": // Timeline Horizontal
        return { ...baseVars, ...this.extractTimelineVariables(pageContent) };
      case "S-007": // Timeline Card (Evolution Roadmap)
        return { ...baseVars, ...this.extractTimelineVariables(pageContent) };
      case "S-008": // Process Steps
        return { ...baseVars, ...this.extractFrameworkVariables(pageContent) };
      case "S-009": // Pyramid
        return { ...baseVars, ...this.extractFrameworkVariables(pageContent) };

      // ========== Content Templates (C-001 ~ C-007) ==========
      case "C-001": // Image Left Text Right
      case "C-002": // Text Left Image Right
      case "C-003": // Bullet List
        return {
          ...baseVars,
          ...this.extractMultiColumnVariables(pageContent),
        };
      case "C-004": // Card Grid 2
      case "C-005": // Card Grid 3
      case "C-006": // Card Grid 4
        return {
          ...baseVars,
          ...this.extractMultiColumnVariables(pageContent),
        };
      case "C-007": // Case Detail
        return {
          ...baseVars,
          ...this.extractCaseStudyVariables(pageContent),
        };

      // ========== Narrative Templates (N-001 ~ N-005) ==========
      case "N-001": // Cover
        return { ...baseVars, ...this.extractCoverVariables(pageContent) };
      case "N-002": // Closing
        return {
          ...baseVars,
          ...this.extractCoverVariables(pageContent),
          TITLE: pageContent.title || MISSING_PLACEHOLDER,
        };
      case "N-003": // Chapter Divider
        return {
          ...baseVars,
          ...this.extractFrameworkVariables(pageContent),
          CHAPTER_NUM: "01",
          CHAPTER_EN: "CHAPTER ONE",
        };
      case "N-004": // Table of Contents
        return {
          ...baseVars,
          ...this.extractTocVariables(pageContent, pageOutline),
        };
      case "N-005": // Closing with Contact
        return {
          ...baseVars,
          ...this.extractCoverVariables(pageContent),
          TITLE: pageContent.title || MISSING_PLACEHOLDER,
        };

      // ========== Action Templates (A-001 ~ A-005) ==========
      case "A-001": // Recommendations 3Col
        return {
          ...baseVars,
          ...this.extractRecommendations3ColVariables(pageContent),
        };
      case "A-002": // Risk-Opportunity
        return {
          ...baseVars,
          ...this.extractRiskOpportunityVariables(pageContent),
        };
      case "A-003": // Key Conclusions
        return {
          ...baseVars,
          ...this.extractKeyConclusionsVariables(pageContent),
        };
      case "A-004": // Next Steps
        return {
          ...baseVars,
          ...this.extractNextStepsVariables(pageContent),
        };
      case "A-005": // Thank-You
        // v3.6 重构: 移除硬编码，使用 MISSING_PLACEHOLDER
        return {
          ...baseVars,
          ...this.extractCoverVariables(pageContent),
          TITLE: pageContent.title || MISSING_PLACEHOLDER,
          SUBTITLE: pageContent.subtitle || MISSING_PLACEHOLDER,
          PRESENTER: MISSING_PLACEHOLDER,
          EMAIL: MISSING_PLACEHOLDER,
          COMPANY: MISSING_PLACEHOLDER,
        };

      default:
        // 降级到按类型提取
        return this.extractVariables(
          templateType,
          pageOutline,
          pageContent,
          usedValues,
        );
    }
  }

  /**
   * 提取变量 - 根据模板类型从 sections 中提取（降级方案）
   */
  private extractVariables(
    templateType: PageTemplateType,
    pageOutline: PageOutline,
    pageContent: PageContent,
    usedValues?: Set<string>,
  ): Record<string, string> {
    const baseVars: Record<string, string> = {
      TITLE: pageContent.title || pageOutline.title,
      SUBTITLE: pageContent.subtitle || pageOutline.subtitle || "",
      DATE: new Date().toLocaleDateString("zh-CN"),
    };

    // 根据模板类型提取特定变量
    switch (templateType) {
      case "pillars":
        return {
          ...baseVars,
          ...this.extractPillarsVariables(pageContent, usedValues),
        };
      case "dashboard":
        return {
          ...baseVars,
          ...this.extractDashboardVariables(pageContent, usedValues),
        };
      case "timeline":
      case "evolutionRoadmap":
        return { ...baseVars, ...this.extractTimelineVariables(pageContent) };
      case "comparison":
      case "riskOpportunity":
        return {
          ...baseVars,
          ...this.extractComparisonDualVariables(pageContent),
        };
      case "chapterTitle":
        // v3.5: 章节分隔页特殊处理
        return {
          ...baseVars,
          ...this.extractChapterTitleVariables(pageOutline, pageContent),
        };
      case "framework":
        return { ...baseVars, ...this.extractFrameworkVariables(pageContent) };
      case "cover":
        return { ...baseVars, ...this.extractCoverVariables(pageContent) };
      case "closing":
        // v3.6 重构: closing 模板使用与 cover 类似的变量，无硬编码默认值
        return {
          ...baseVars,
          ...this.extractCoverVariables(pageContent),
          TITLE: pageContent.title || MISSING_PLACEHOLDER,
        };
      case "toc":
        return {
          ...baseVars,
          ...this.extractTocVariables(pageContent, pageOutline),
        };
      case "recommendations":
        return {
          ...baseVars,
          ...this.extractRecommendationsVariables(pageContent),
        };
      case "multiColumn":
        return {
          ...baseVars,
          ...this.extractMultiColumnVariables(pageContent),
        };
      case "splitLayout":
        // splitLayout 使用与 multiColumn 相同的变量
        return {
          ...baseVars,
          ...this.extractMultiColumnVariables(pageContent),
        };
      case "caseStudy":
        return {
          ...baseVars,
          ...this.extractCaseStudyVariables(pageContent),
        };
      case "questions":
        // questions 类型使用基础变量 + 列表提取
        return {
          ...baseVars,
          ...this.extractQuestionsVariables(pageContent),
        };
      case "maturityModel":
        // maturityModel 类型使用层级变量
        return {
          ...baseVars,
          ...this.extractMaturityModelVariables(pageContent),
        };
      default:
        return { ...baseVars, ...this.extractDefaultVariables(pageContent) };
    }
  }

  /**
   * 提取 Pillars 模板变量
   * 同时生成 PILLAR{N} 和 P{N} 两套变量名，兼容 S-003/S-004 和 S-005 模板
   * v3.6 重构: 不再使用硬编码默认值，缺失内容显示明确占位符
   */
  private extractPillarsVariables(
    pageContent: PageContent,
    _usedValues?: Set<string>,
  ): Record<string, string> {
    const sections = pageContent.sections || [];
    const vars: Record<string, string> = {};
    const pageTitle = pageContent.title || "";

    // v3.6: 副标题从 pageContent 提取，无默认值
    vars["SUBTITLE"] = pageContent.subtitle || "";
    if (!vars["SUBTITLE"]) {
      this.logger.warn(
        `[extractPillarsVariables] Missing SUBTITLE for page "${pageTitle}"`,
      );
    }

    // v3.6: 图标保留默认（视觉元素，可接受）
    const defaultIcons = ["🎯", "⚡", "👥", "🌐", "💡"];

    // 支持最多5个支柱（三支柱、四支柱、五支柱模板）
    for (let i = 0; i < 5; i++) {
      const section = sections[i];
      const pillarNum = i + 1;

      // v3.6 重构: 从 section 提取数据，无硬编码默认值
      let title = "";
      let desc = "";
      let stat = "";
      let label = "";

      if (section) {
        if (section.type === "stat" && this.isStatContent(section.content)) {
          const statContent = section.content;
          title = statContent.label || "";
          desc = this.getDescriptionFromSections(sections, i);
          stat = statContent.value || "";
          label = statContent.trend ? `${statContent.trend}` : "";
        } else if (section.type === "list" && Array.isArray(section.content)) {
          title = section.content[0] || "";
          desc = section.content.slice(1, 3).join("；");
          // 尝试从 citations 获取数据
          stat = pageContent.citations?.[i] || "";
        } else if (
          section.type === "text" &&
          typeof section.content === "string"
        ) {
          title = section.content.slice(0, 25);
          desc = section.content.slice(25, 120);
          stat = pageContent.citations?.[i] || "";
        }
      }

      // v3.6: 缺失必需内容时记录警告，使用占位符
      if (!title && i < 3) {
        this.logger.warn(
          `[extractPillarsVariables] Missing PILLAR${pillarNum}_TITLE for "${pageTitle}"`,
        );
        title = MISSING_PLACEHOLDER;
      }
      if (!stat && i < 3) {
        this.logger.warn(
          `[extractPillarsVariables] Missing PILLAR${pillarNum}_STAT for "${pageTitle}"`,
        );
        stat = MISSING_NUMBER_PLACEHOLDER;
      }

      const icon = defaultIcons[i] || MISSING_ICON_PLACEHOLDER;

      // PILLAR{N} 格式 (用于 S-003, S-004)
      vars[`PILLAR${pillarNum}_TITLE`] = title;
      vars[`PILLAR${pillarNum}_DESC`] = desc;
      vars[`PILLAR${pillarNum}_STAT`] = stat;
      vars[`PILLAR${pillarNum}_LABEL`] = label;
      vars[`PILLAR${pillarNum}_ICON`] = icon;

      // P{N} 格式 (用于 S-005 五支柱模板)
      vars[`P${pillarNum}_TITLE`] = title;
      vars[`P${pillarNum}_DESC`] = desc;
      vars[`P${pillarNum}_ICON`] = icon;
    }

    return vars;
  }

  /**
   * 提取 Dashboard 模板变量
   * v3.6 重构: 不再使用硬编码默认值
   */
  private extractDashboardVariables(
    pageContent: PageContent,
    _usedValues?: Set<string>,
  ): Record<string, string> {
    const sections = pageContent.sections || [];
    const vars: Record<string, string> = {};
    const pageTitle = pageContent.title || "";

    // 从 sections 中提取 stat 类型的数据
    const statSections = sections.filter(
      (s) => s.type === "stat" && this.isStatContent(s.content),
    );

    for (let i = 0; i < 4; i++) {
      const kpiNum = i + 1;
      const statSection = statSections[i];

      if (statSection && this.isStatContent(statSection.content)) {
        const stat = statSection.content;
        vars[`KPI${kpiNum}_VALUE`] = stat.value || "";
        vars[`KPI${kpiNum}_LABEL`] = stat.label || "";
        vars[`KPI${kpiNum}_CHANGE`] = stat.change || "";
      } else {
        // v3.6: 缺失数据时使用占位符，不使用假数据
        vars[`KPI${kpiNum}_VALUE`] = MISSING_NUMBER_PLACEHOLDER;
        vars[`KPI${kpiNum}_LABEL`] = "";
        vars[`KPI${kpiNum}_CHANGE`] = "";
        this.logger.warn(
          `[extractDashboardVariables] Missing KPI${kpiNum} for "${pageTitle}"`,
        );
      }
    }

    // 趋势图表额外变量（D-003 模板）
    if (statSections.length > 0) {
      const firstStat = statSections[0].content as StatContent;
      vars["CURRENT_VALUE"] = firstStat.value || MISSING_NUMBER_PLACEHOLDER;
      vars["MOM_CHANGE"] = firstStat.change || "";
      vars["YOY_CHANGE"] = statSections[1]
        ? (statSections[1].content as StatContent).change || ""
        : "";
    } else {
      vars["CURRENT_VALUE"] = MISSING_NUMBER_PLACEHOLDER;
      vars["MOM_CHANGE"] = "";
      vars["YOY_CHANGE"] = "";
      this.logger.warn(
        `[extractDashboardVariables] Missing trend data for "${pageTitle}"`,
      );
    }

    // 洞察和周期
    const textSection = sections.find(
      (s) => s.type === "text" && typeof s.content === "string",
    );
    vars["INSIGHT"] = (textSection?.content as string)?.slice(0, 100) || "";
    vars["PERIOD"] = pageContent.footer || "";

    return vars;
  }

  /**
   * 提取 Timeline 模板变量
   * v3.6 重构: 移除所有硬编码默认值，缺失数据使用占位符
   */
  private extractTimelineVariables(
    pageContent: PageContent,
  ): Record<string, string> {
    const sections = pageContent.sections || [];
    const vars: Record<string, string> = {};

    for (let i = 0; i < 4; i++) {
      const section = sections[i];
      const mNum = i + 1;

      let date = "";
      let title = "";
      let desc = "";

      if (section) {
        if (section.type === "stat" && this.isStatContent(section.content)) {
          const stat = section.content;
          date = stat.value || "";
          title = stat.label || "";
          desc = stat.change || ""; // 使用 change 字段作为描述
        } else if (section.type === "list" && Array.isArray(section.content)) {
          date = section.content[0] || "";
          title = section.content[1] || section.content[0] || "";
          desc = section.content[2] || section.content[1] || "";
        } else if (
          section.type === "text" &&
          typeof section.content === "string"
        ) {
          // 尝试解析 "日期: 标题 - 描述" 格式
          const parts = section.content.split(/[-:：]/);
          date = parts[0]?.trim() || "";
          title = parts[1]?.trim() || section.content.slice(0, 20);
          desc = parts[2]?.trim() || section.content.slice(20, 70);
        }
      }

      // v3.6: 缺失数据使用占位符，不使用假数据
      if (!date) {
        this.logger.warn(
          `[extractTimelineVariables] Missing M${mNum}_DATE for "${pageContent.title}"`,
        );
        date = `阶段${mNum}`;
      }
      if (!title) {
        this.logger.warn(
          `[extractTimelineVariables] Missing M${mNum}_TITLE for "${pageContent.title}"`,
        );
        title = MISSING_PLACEHOLDER;
      }
      if (!desc) {
        desc = ""; // 描述可选，不警告
      }

      vars[`M${mNum}_DATE`] = date;
      vars[`M${mNum}_TITLE`] = title;
      vars[`M${mNum}_DESC`] = desc;

      // 也设置 STAGE 变量（用于 evolutionRoadmap 模板）
      vars[`STAGE${mNum}_TITLE`] = vars[`M${mNum}_TITLE`];
      vars[`STAGE${mNum}_DESC`] = vars[`M${mNum}_DESC`];
    }

    // Vision 变量 - 从 pageContent 提取，无硬编码
    vars["VISION_TITLE"] = pageContent.title || MISSING_PLACEHOLDER;
    vars["VISION_DESC"] = pageContent.subtitle || "";

    if (!pageContent.title) {
      this.logger.warn(`[extractTimelineVariables] Missing VISION_TITLE`);
    }

    return vars;
  }

  /**
   * 提取 Framework 模板变量
   * v3.6 重构: 移除所有硬编码默认值
   */
  private extractFrameworkVariables(
    pageContent: PageContent,
  ): Record<string, string> {
    const sections = pageContent.sections || [];
    const vars: Record<string, string> = {};

    // 章节编号 - 尝试从内容中提取
    vars["CHAPTER_NUM"] = "1";

    for (let i = 0; i < 4; i++) {
      const section = sections[i];
      const stepNum = i + 1;

      let title = "";
      let desc = "";

      if (section) {
        if (section.type === "text" && typeof section.content === "string") {
          // 尝试解析 "标题: 描述" 或 "标题 - 描述" 格式
          const parts = section.content.split(/[-:：]/);
          title = parts[0]?.trim() || section.content.slice(0, 15);
          desc = parts[1]?.trim() || section.content.slice(15, 60);
        } else if (section.type === "list" && Array.isArray(section.content)) {
          title = section.content[0] || "";
          desc = section.content.slice(1).join("；") || "";
        } else if (
          section.type === "stat" &&
          this.isStatContent(section.content)
        ) {
          const stat = section.content;
          title = stat.label || "";
          desc = stat.value || "";
        }
      }

      // v3.6: 缺失数据使用占位符
      if (!title) {
        this.logger.warn(
          `[extractFrameworkVariables] Missing STEP${stepNum}_TITLE for "${pageContent.title}"`,
        );
        title = MISSING_PLACEHOLDER;
      }

      vars[`STEP${stepNum}_TITLE`] = title;
      vars[`STEP${stepNum}_DESC`] = desc;

      // 金字塔层级变量
      vars[`L${stepNum}_TITLE`] = vars[`STEP${stepNum}_TITLE`];
      vars[`L${stepNum}_DESC`] = vars[`STEP${stepNum}_DESC`];
    }

    return vars;
  }

  /**
   * 提取章节分隔页变量 (v3.5 新增)
   * 正确提取章节编号，避免总是显示"1"
   */
  private extractChapterTitleVariables(
    pageOutline: PageOutline,
    pageContent: PageContent,
  ): Record<string, string> {
    // 从 subtitle 提取章节编号（格式：CHAPTER 02）
    const subtitleMatch = pageContent.subtitle?.match(/CHAPTER\s*(\d+)/i);
    const outlineMatch = pageOutline.subtitle?.match(/CHAPTER\s*(\d+)/i);

    // 尝试从页面编号推断（如果是第3页之后的chapterTitle，计算实际章节号）
    let chapterNum = "01";

    if (subtitleMatch) {
      chapterNum = subtitleMatch[1].padStart(2, "0");
    } else if (outlineMatch) {
      chapterNum = outlineMatch[1].padStart(2, "0");
    } else {
      // 从 keyElements 或内容推断
      const firstSection = pageContent.sections?.[0];
      if (
        firstSection?.type === "text" &&
        typeof firstSection.content === "string"
      ) {
        const numMatch = firstSection.content.match(
          /第(\d+)章|Chapter\s*(\d+)/i,
        );
        if (numMatch) {
          chapterNum = (numMatch[1] || numMatch[2]).padStart(2, "0");
        }
      }
    }

    // v3.6: 生成有意义的章节描述，替代"章节分隔页 - XXX"模式
    const cleanTitle =
      pageContent.title?.replace(/CHAPTER\s*\d+\s*[:：]?\s*/gi, "").trim() ||
      pageOutline.title?.replace(/CHAPTER\s*\d+\s*[:：]?\s*/gi, "").trim() ||
      "章节标题";

    // 清理 contentBrief 中的模板化前缀
    let subtitle =
      pageContent.subtitle?.replace(/CHAPTER\s*\d+\s*[:：]?\s*/gi, "").trim() ||
      "";

    if (!subtitle && pageOutline.contentBrief) {
      // 移除 "章节分隔页 -" 等模板化前缀
      subtitle = pageOutline.contentBrief
        .replace(/^章节分隔页\s*[-–—:：]\s*/gi, "")
        .trim();
    }

    // v3.6 重构: 如果副标题为空或与标题相同，保持为空
    // 章节分隔页的副标题应由 Writer AI 提供，不再生成虚假描述
    if (subtitle === cleanTitle) {
      subtitle = ""; // 与标题相同时清空
    }

    if (!subtitle) {
      this.logger.debug(
        `[extractChapterDividerVariables] No subtitle for chapter "${cleanTitle}"`,
      );
    }

    return {
      CHAPTER_NUM: chapterNum,
      TITLE: cleanTitle,
      SUBTITLE: subtitle,
    };
  }

  /**
   * 提取 Cover 模板变量（也用于感谢聆听页面）
   * v3.6 重构: 移除硬编码默认值，使用 MISSING_PLACEHOLDER
   */
  private extractCoverVariables(
    pageContent: PageContent,
  ): Record<string, string> {
    // v3.6: 所有内容应从 pageContent 提取，缺失时使用占位符
    const title = pageContent.title || MISSING_PLACEHOLDER;
    const subtitle = pageContent.subtitle || "";

    if (!pageContent.title) {
      this.logger.warn(`[extractCoverVariables] Missing title for cover slide`);
    }

    return {
      MAIN_TITLE: title,
      SUB_TITLE: subtitle,
      AUTHOR: MISSING_PLACEHOLDER, // 应由 Writer 提供
      DATE: new Date().toLocaleDateString("zh-CN"), // 日期可以自动生成
      // 感谢聆听页面额外变量 (N-005 closing 模板)
      PRESENTER: MISSING_PLACEHOLDER,
      EMAIL: MISSING_PLACEHOLDER,
      COMPANY: MISSING_PLACEHOLDER,
      // N-005 模板专用变量
      MESSAGE: subtitle || MISSING_PLACEHOLDER,
      CONTACT_NAME: MISSING_PLACEHOLDER,
      CONTACT_EMAIL: MISSING_PLACEHOLDER,
      CONTACT_PHONE: MISSING_PLACEHOLDER,
    };
  }

  /**
   * 提取 TOC 模板变量
   * 优先使用 sections，如果为空或不足则回退到 keyElements
   */
  private extractTocVariables(
    pageContent: PageContent,
    pageOutline?: PageOutline,
  ): Record<string, string> {
    const sections = pageContent.sections || [];

    // 获取章节标题列表：优先使用 sections，不足时回退到 keyElements
    let chapterTitles: string[] = [];

    if (sections.length >= 2) {
      // 从 sections 提取章节标题
      chapterTitles = sections.map((section, index) => {
        if (Array.isArray(section.content)) {
          return section.content[0] || `章节 ${index + 1}`;
        }
        return typeof section.content === "string"
          ? section.content
          : `章节 ${index + 1}`;
      });
    } else if (
      pageOutline?.keyElements &&
      pageOutline.keyElements.length >= 2
    ) {
      // 回退到 keyElements（通常包含所有章节标题）
      chapterTitles = pageOutline.keyElements;
    } else if (sections.length === 1) {
      // 只有 1 个 section，使用它
      const section = sections[0];
      chapterTitles = [
        Array.isArray(section.content)
          ? section.content[0]
          : typeof section.content === "string"
            ? section.content
            : "章节 1",
      ];
    }

    // 生成 chaptersHtml
    let chaptersHtml = "";
    chapterTitles.forEach((title, index) => {
      chaptersHtml += `
        <div style="display: flex; align-items: center; gap: 16px;">
          <div style="width: 40px; height: 40px; background: linear-gradient(135deg, ${COLORS.primary}, rgba(212, 175, 55, 0.7)); border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 18px;">${String(index + 1).padStart(2, "0")}</div>
          <div style="flex: 1;">
            <div style="font-size: 18px; font-weight: 600;">${title}</div>
          </div>
        </div>
      `;
    });

    // 生成 OVERVIEW 变量
    const overview =
      pageContent.subtitle ||
      chapterTitles.slice(0, 3).join("、") ||
      "本报告涵盖多个关键主题的深度分析";

    return {
      CHAPTERS: chaptersHtml,
      OVERVIEW: overview,
    };
  }

  /**
   * 提取 A-001 Recommendations 3Col 模板变量
   * v3.6 重构: 移除所有硬编码默认值
   * 需要: URGENT1/2_TITLE/DESC, SHORT1/2/3_TITLE/DESC, LONG1/2/3_TITLE/DESC, OWNER
   */
  private extractRecommendations3ColVariables(
    pageContent: PageContent,
  ): Record<string, string> {
    const sections = pageContent.sections || [];
    const vars: Record<string, string> = {};

    // 从 sections 提取内容
    const listSections = sections.filter(
      (s) => s.type === "list" && Array.isArray(s.content),
    );

    // 辅助函数: 提取建议变量
    const extractRecommendation = (
      prefix: string,
      index: number,
      sectionIndex: number,
    ) => {
      const num = index + 1;
      const section = listSections[sectionIndex];
      let title = "";
      let desc = "";

      if (section && Array.isArray(section.content)) {
        title = section.content[0] || "";
        desc = section.content[1] || section.content.slice(1).join("；") || "";
      }

      if (!title) {
        this.logger.warn(
          `[extractRecommendations3ColVariables] Missing ${prefix}${num}_TITLE for "${pageContent.title}"`,
        );
        title = MISSING_PLACEHOLDER;
      }

      vars[`${prefix}${num}_TITLE`] = title;
      vars[`${prefix}${num}_DESC`] = desc;
    };

    // 紧急建议 (2个)
    for (let i = 0; i < 2; i++) {
      extractRecommendation("URGENT", i, i);
    }

    // 短期建议 (3个)
    for (let i = 0; i < 3; i++) {
      extractRecommendation("SHORT", i, 2 + i);
    }

    // 长期建议 (3个)
    for (let i = 0; i < 3; i++) {
      extractRecommendation("LONG", i, 5 + i);
    }

    // OWNER 从 pageContent 提取，无默认值
    vars["OWNER"] = pageContent.subtitle || "";

    return vars;
  }

  /**
   * 提取 A-002 Risk-Opportunity 模板变量
   * v3.6 重构: 移除所有硬编码默认值
   * 需要: RISK1/2/3_TITLE/DESC, OPP1/2/3_TITLE/DESC
   */
  private extractRiskOpportunityVariables(
    pageContent: PageContent,
  ): Record<string, string> {
    const sections = pageContent.sections || [];
    const vars: Record<string, string> = {};

    const listSections = sections.filter(
      (s) => s.type === "list" && Array.isArray(s.content),
    );

    // 辅助函数: 提取风险/机遇变量
    const extractItem = (
      prefix: string,
      index: number,
      sectionIndex: number,
    ) => {
      const num = index + 1;
      const section = listSections[sectionIndex];
      let title = "";
      let desc = "";

      if (section && Array.isArray(section.content)) {
        title = section.content[0] || "";
        desc = section.content.slice(1).join("；") || "";
      }

      if (!title) {
        this.logger.warn(
          `[extractRiskOpportunityVariables] Missing ${prefix}${num}_TITLE for "${pageContent.title}"`,
        );
        title = MISSING_PLACEHOLDER;
      }

      vars[`${prefix}${num}_TITLE`] = title;
      vars[`${prefix}${num}_DESC`] = desc;
    };

    // 风险 (3个)
    for (let i = 0; i < 3; i++) {
      extractItem("RISK", i, i);
    }

    // 机遇 (3个)
    for (let i = 0; i < 3; i++) {
      extractItem("OPP", i, 3 + i);
    }

    return vars;
  }

  /**
   * 提取 A-003 Key Conclusions 模板变量
   * v3.6 重构: 移除所有硬编码默认值
   * 需要: CONCLUSION1/2/3/4_TITLE/DESC
   */
  private extractKeyConclusionsVariables(
    pageContent: PageContent,
  ): Record<string, string> {
    const sections = pageContent.sections || [];
    const vars: Record<string, string> = {};

    const listSections = sections.filter(
      (s) => s.type === "list" && Array.isArray(s.content),
    );
    const textSections = sections.filter(
      (s) => s.type === "text" && typeof s.content === "string",
    );

    for (let i = 0; i < 4; i++) {
      const num = i + 1;
      const listSection = listSections[i];
      const textSection = textSections[i];

      let title = "";
      let desc = "";

      if (listSection && Array.isArray(listSection.content)) {
        title = listSection.content[0] || "";
        desc = listSection.content.slice(1).join("；") || "";
      } else if (textSection && typeof textSection.content === "string") {
        const parts = textSection.content.split(/[：:]/);
        title = parts[0]?.slice(0, 20) || "";
        desc = parts[1] || textSection.content.slice(0, 80) || "";
      }

      if (!title) {
        this.logger.warn(
          `[extractKeyConclusionsVariables] Missing CONCLUSION${num}_TITLE for "${pageContent.title}"`,
        );
        title = MISSING_PLACEHOLDER;
      }

      vars[`CONCLUSION${num}_TITLE`] = title;
      vars[`CONCLUSION${num}_DESC`] = desc;
    }

    return vars;
  }

  /**
   * 提取 A-004 Next Steps 模板变量
   * v3.6 重构: 移除所有硬编码默认值
   * 需要: STEP1/2/3_TITLE/DESC/OWNER/DUE, MILESTONE1/2/3_DATE/TITLE
   */
  private extractNextStepsVariables(
    pageContent: PageContent,
  ): Record<string, string> {
    const sections = pageContent.sections || [];
    const vars: Record<string, string> = {};

    const listSections = sections.filter(
      (s) => s.type === "list" && Array.isArray(s.content),
    );

    // 步骤 (3个)
    for (let i = 0; i < 3; i++) {
      const num = i + 1;
      const section = listSections[i];
      let title = "";
      let desc = "";
      let owner = "";
      let due = "";

      if (section && Array.isArray(section.content)) {
        title = section.content[0] || "";
        desc = section.content[1] || "";
        owner = section.content[2] || "";
        due = section.content[3] || "";
      }

      if (!title) {
        this.logger.warn(
          `[extractNextStepsVariables] Missing STEP${num}_TITLE for "${pageContent.title}"`,
        );
        title = MISSING_PLACEHOLDER;
      }

      vars[`STEP${num}_TITLE`] = title;
      vars[`STEP${num}_DESC`] = desc;
      vars[`STEP${num}_OWNER`] = owner;
      vars[`STEP${num}_DUE`] = due;
    }

    // 里程碑 (3个)
    for (let i = 0; i < 3; i++) {
      const num = i + 1;
      const section = listSections[3 + i];
      let date = "";
      let title = "";

      if (section && Array.isArray(section.content)) {
        date = section.content[0] || "";
        title = section.content[1] || "";
      }

      if (!date) {
        this.logger.warn(
          `[extractNextStepsVariables] Missing MILESTONE${num}_DATE for "${pageContent.title}"`,
        );
        date = `M${num}`;
      }
      if (!title) {
        title = MISSING_PLACEHOLDER;
      }

      vars[`MILESTONE${num}_DATE`] = date;
      vars[`MILESTONE${num}_TITLE`] = title;
    }

    return vars;
  }

  /**
   * 提取 Recommendations 模板变量 (旧版兼容)
   * v3.6 重构: 移除硬编码默认值
   */
  private extractRecommendationsVariables(
    pageContent: PageContent,
  ): Record<string, string> {
    // 使用新的 3Col 变量提取，同时保持 ITEMS 兼容
    const vars = this.extractRecommendations3ColVariables(pageContent);

    // 兼容旧的 ITEMS 格式
    const sections = pageContent.sections || [];
    let itemsHtml = "";

    const listSection = sections.find((s) => s.type === "list");
    const items =
      listSection && Array.isArray(listSection.content)
        ? listSection.content
        : [MISSING_PLACEHOLDER];

    if (!listSection) {
      this.logger.warn(
        `[extractRecommendationsVariables] Missing recommendations list for "${pageContent.title}"`,
      );
    }

    items.slice(0, 5).forEach((item, index) => {
      itemsHtml += `
        <div style="flex: 1; background: rgba(30, 41, 59, 0.6); border-radius: 12px; padding: 20px; display: flex; align-items: center; gap: 20px;">
          <div style="width: 48px; height: 48px; background: linear-gradient(135deg, ${COLORS.primary}, #B8962E); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #0F172A; font-weight: 900; font-size: 20px;">${index + 1}</div>
          <div style="flex: 1;">
            <h4 style="font-size: 18px; font-weight: 600; margin: 0 0 8px 0;">${item}</h4>
          </div>
        </div>
      `;
    });

    return { ...vars, ITEMS: itemsHtml };
  }

  /**
   * 提取默认变量
   */
  private extractDefaultVariables(
    pageContent: PageContent,
  ): Record<string, string> {
    const sections = pageContent.sections || [];
    let contentHtml = "";

    sections.forEach((section) => {
      if (section.type === "list" && Array.isArray(section.content)) {
        contentHtml += `<ul style="list-style: none; padding: 0; margin: 0 0 16px 0;">`;
        section.content.forEach((item) => {
          contentHtml += `<li style="display: flex; align-items: flex-start; gap: 12px; margin-bottom: 12px;"><span style="color: ${COLORS.primary};">•</span> ${item}</li>`;
        });
        contentHtml += `</ul>`;
      } else if (
        section.type === "text" &&
        typeof section.content === "string"
      ) {
        contentHtml += `<p style="font-size: 16px; color: #94A3B8; margin: 0 0 16px 0; line-height: 1.6;">${section.content}</p>`;
      }
    });

    return { CONTENT: contentHtml };
  }

  /**
   * 降级渲染 - 当没有匹配模板时
   */
  private renderFallback(
    pageOutline: PageOutline,
    pageContent: PageContent,
    themeId: string = "genspark-dark",
  ): TemplateRenderingResult {
    const theme = getTheme(themeId);
    const sections = pageContent.sections || [];
    let contentHtml = "";

    sections.forEach((section) => {
      if (section.type === "stat" && this.isStatContent(section.content)) {
        const stat = section.content;
        contentHtml += `
          <div style="${CARD_STYLE} margin-bottom: 16px;">
            <div style="font-size: 48px; font-weight: 900; color: ${theme.colors.accent.primary};">${stat.value}</div>
            <div style="font-size: 16px; color: ${theme.colors.text.muted};">${stat.label}</div>
          </div>
        `;
      } else if (section.type === "list" && Array.isArray(section.content)) {
        contentHtml += `<ul style="list-style: none; padding: 0; margin: 0 0 16px 0;">`;
        section.content.forEach((item) => {
          contentHtml += `<li style="display: flex; align-items: flex-start; gap: 12px; margin-bottom: 12px;"><span style="color: ${theme.colors.accent.primary};">•</span> ${item}</li>`;
        });
        contentHtml += `</ul>`;
      } else if (
        section.type === "text" &&
        typeof section.content === "string"
      ) {
        contentHtml += `<p style="font-size: 16px; color: ${theme.colors.text.muted}; margin: 0 0 16px 0;">${section.content}</p>`;
      }
    });

    const fallbackContentHtml = `
  <h1 style="font-size: 36px; font-weight: 900; margin: 0 0 8px 0; color: ${theme.colors.text.primary};">${pageContent.title || pageOutline.title}</h1>
  <p style="font-size: 18px; color: ${theme.colors.text.muted}; margin: 0 0 32px 0;">${pageContent.subtitle || ""}</p>
  <div style="height: calc(100% - 160px); overflow: hidden;">
    ${contentHtml || `<p style='color: ${theme.colors.text.subtle};'>内容生成中...</p>`}
  </div>
  <div style="position: absolute; bottom: 24px; left: 80px; right: 80px; font-size: 12px; color: ${theme.colors.text.subtle};">${pageContent.footer || pageOutline.title}</div>
    `.trim();

    // 使用主题包装
    const html = this.wrapWithTheme(fallbackContentHtml, theme);

    return {
      html,
      templateId: "fallback",
      variables: {},
      themeId,
    };
  }

  /**
   * 辅助：检查是否为 StatContent
   */
  private isStatContent(content: unknown): content is StatContent {
    return (
      typeof content === "object" &&
      content !== null &&
      "value" in content &&
      "label" in content
    );
  }

  /**
   * 辅助：从 sections 获取描述文本
   * v3.6 重构: 移除所有硬编码默认值，缺失时返回 MISSING_PLACEHOLDER
   */
  private getDescriptionFromSections(
    sections: ContentSection[],
    index: number,
  ): string {
    const section = sections[index];

    // v3.6: 没有 section 时返回占位符
    if (!section) {
      return MISSING_PLACEHOLDER;
    }

    if (section.type === "text" && typeof section.content === "string") {
      return section.content.slice(0, 100) || MISSING_PLACEHOLDER;
    }
    if (section.type === "list" && Array.isArray(section.content)) {
      const joined = section.content.slice(0, 2).join("；");
      return joined || MISSING_PLACEHOLDER;
    }

    // 对于 stat 类型，使用 label
    if (section.type === "stat" && this.isStatContent(section.content)) {
      const statContent = section.content;
      return statContent.label || MISSING_PLACEHOLDER;
    }

    return MISSING_PLACEHOLDER;
  }

  /**
   * 提取 MultiColumn 模板变量
   * v3.6 重构: 移除所有硬编码默认值
   * 同时生成 POINT{N} 和 CARD{N} 两套变量名，兼容多种模板
   */
  private extractMultiColumnVariables(
    pageContent: PageContent,
  ): Record<string, string> {
    const sections = pageContent.sections || [];
    const vars: Record<string, string> = {};

    // 图标保留默认（视觉元素，可接受）
    const defaultIcons = ["🎯", "⚡", "🛡️", "💡", "🌐", "🤝"];

    // 支持最多6个要点（2列、3列、4列、6列布局）
    for (let i = 0; i < 6; i++) {
      const section = sections[i];
      const num = i + 1;

      let title = "";
      let desc = "";
      let stat = "";
      let label = "";

      if (section) {
        if (section.type === "list" && Array.isArray(section.content)) {
          title = section.content[0] || "";
          desc = section.content.slice(1).join("；") || "";
        } else if (
          section.type === "text" &&
          typeof section.content === "string"
        ) {
          const parts = section.content.split(/[：:]/);
          title = parts[0]?.slice(0, 20) || "";
          desc = parts[1] || section.content.slice(0, 80) || "";
        } else if (
          section.type === "stat" &&
          this.isStatContent(section.content)
        ) {
          const statContent = section.content;
          title = statContent.label || "";
          desc = statContent.change || "";
          stat = statContent.value || "";
          label = statContent.label || "";
        }
      }

      // v3.6: 缺失数据使用占位符
      if (!title && i < 3) {
        this.logger.warn(
          `[extractMultiColumnVariables] Missing POINT${num}_TITLE for "${pageContent.title}"`,
        );
        title = MISSING_PLACEHOLDER;
      }

      // POINT{N} 格式 (用于 C-001, C-002, C-003)
      vars[`POINT${num}_TITLE`] = title;
      vars[`POINT${num}_DESC`] = desc;

      // CARD{N} 格式 (用于 C-004, C-005, C-006)
      vars[`CARD${num}_TITLE`] = title;
      vars[`CARD${num}_DESC`] = desc;
      vars[`CARD${num}_ICON`] = defaultIcons[i] || "📌";
      vars[`CARD${num}_STAT`] = stat || MISSING_NUMBER_PLACEHOLDER;
      vars[`CARD${num}_LABEL`] = label;
    }

    // 图片占位符
    vars["IMAGE_PLACEHOLDER"] = "📊";

    return vars;
  }

  /**
   * 提取 Questions 模板变量
   * v3.6 重构: 移除硬编码默认值
   */
  private extractQuestionsVariables(
    pageContent: PageContent,
  ): Record<string, string> {
    const sections = pageContent.sections || [];
    const vars: Record<string, string> = {};

    // 从 sections 中提取问题列表
    let questionsHtml = "";
    const listSection = sections.find(
      (s) => s.type === "list" && Array.isArray(s.content),
    );

    if (!listSection || !Array.isArray(listSection.content)) {
      this.logger.warn(
        `[extractQuestionsVariables] Missing questions list for "${pageContent.title}"`,
      );
    }

    const questions =
      listSection && Array.isArray(listSection.content)
        ? listSection.content
        : [MISSING_PLACEHOLDER];

    questions.slice(0, 6).forEach((q, index) => {
      questionsHtml += `
        <div style="display: flex; align-items: flex-start; gap: 16px; margin-bottom: 16px;">
          <div style="width: 32px; height: 32px; background: ${COLORS.primary}; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-weight: 700;">${index + 1}</div>
          <div style="font-size: 16px; line-height: 1.6;">${q}</div>
        </div>
      `;
      vars[`Q${index + 1}`] = String(q);
    });

    vars["QUESTIONS"] = questionsHtml;
    vars["QUESTIONS_COUNT"] = String(questions.length);

    return vars;
  }

  /**
   * 提取 MaturityModel 模板变量
   * v3.6 重构: 移除硬编码默认值
   */
  private extractMaturityModelVariables(
    pageContent: PageContent,
  ): Record<string, string> {
    const sections = pageContent.sections || [];
    const vars: Record<string, string> = {};

    // 生成5个成熟度等级的变量
    for (let i = 0; i < 5; i++) {
      const section = sections[i];
      const levelNum = i + 1;

      let title = "";
      let desc = "";

      if (section) {
        if (section.type === "list" && Array.isArray(section.content)) {
          title = section.content[0] || "";
          desc = section.content.slice(1).join("；") || "";
        } else if (
          section.type === "text" &&
          typeof section.content === "string"
        ) {
          const parts = section.content.split(/[：:]/);
          title = parts[0]?.slice(0, 15) || "";
          desc = parts[1] || section.content.slice(0, 60) || "";
        } else if (
          section.type === "stat" &&
          this.isStatContent(section.content)
        ) {
          const stat = section.content;
          title = stat.label || "";
          desc = stat.value || "";
        }
      }

      // v3.6: 缺失数据使用占位符
      if (!title) {
        this.logger.warn(
          `[extractMaturityModelVariables] Missing LEVEL${levelNum}_TITLE for "${pageContent.title}"`,
        );
        title = `L${levelNum}`;
      }

      vars[`LEVEL${levelNum}_TITLE`] = title;
      vars[`LEVEL${levelNum}_DESC`] = desc;
      vars[`L${levelNum}_TITLE`] = title;
      vars[`L${levelNum}_DESC`] = desc;
    }

    // 当前等级和目标等级从 sections 提取
    const statSections = sections.filter(
      (s) => s.type === "stat" && this.isStatContent(s.content),
    );
    vars["CURRENT_LEVEL"] =
      statSections[0] && this.isStatContent(statSections[0].content)
        ? statSections[0].content.value || "?"
        : "?";
    vars["TARGET_LEVEL"] =
      statSections[1] && this.isStatContent(statSections[1].content)
        ? statSections[1].content.value || "?"
        : "?";

    return vars;
  }

  /**
   * 提取 CaseStudy 模板变量
   * v3.6 重构: 移除硬编码默认值
   */
  private extractCaseStudyVariables(
    pageContent: PageContent,
  ): Record<string, string> {
    const sections = pageContent.sections || [];
    const vars: Record<string, string> = {};

    // 基础信息 - 从 pageContent 提取
    vars["INDUSTRY"] = pageContent.subtitle || "";
    vars["CLIENT_NAME"] =
      pageContent.title?.split(/[：:]/)[0] || MISSING_PLACEHOLDER;

    // 从 sections 提取挑战、解决方案、成果
    const textSections = sections.filter(
      (s) => s.type === "text" && typeof s.content === "string",
    );
    const listSections = sections.filter(
      (s) => s.type === "list" && Array.isArray(s.content),
    );

    const challenge = textSections[0]?.content?.toString().slice(0, 150) || "";
    const solution = textSections[1]?.content?.toString().slice(0, 150) || "";
    const result = textSections[2]?.content?.toString().slice(0, 150) || "";

    if (!challenge) {
      this.logger.warn(
        `[extractCaseStudyVariables] Missing CHALLENGE for "${pageContent.title}"`,
      );
    }

    vars["CHALLENGE"] = challenge || MISSING_PLACEHOLDER;
    vars["SOLUTION"] = solution || MISSING_PLACEHOLDER;
    vars["RESULT"] = result || MISSING_PLACEHOLDER;

    // 统计数据
    const statSections = sections.filter(
      (s) => s.type === "stat" && this.isStatContent(s.content),
    );

    for (let i = 0; i < 3; i++) {
      const stat = statSections[i];
      if (stat && this.isStatContent(stat.content)) {
        const s = stat.content;
        vars[`STAT${i + 1}_VALUE`] = s.value || MISSING_NUMBER_PLACEHOLDER;
        vars[`STAT${i + 1}_LABEL`] = s.label || "";
      } else {
        vars[`STAT${i + 1}_VALUE`] = MISSING_NUMBER_PLACEHOLDER;
        vars[`STAT${i + 1}_LABEL`] = "";
      }
    }

    // 客户评价
    const firstListContent = listSections[0]?.content;
    const testimonial =
      (Array.isArray(firstListContent) ? firstListContent[0] : null) || "";

    vars["TESTIMONIAL"] = testimonial;
    // C-007 模板使用 QUOTE 和 AUTHOR
    vars["QUOTE"] = testimonial;
    vars["AUTHOR"] = pageContent.subtitle || "";

    return vars;
  }

  /**
   * 提取 D-001 Big Number 模板变量
   * v3.6 重构: 移除硬编码默认值
   */
  private extractBigNumberVariables(
    pageContent: PageContent,
  ): Record<string, string> {
    const sections = pageContent.sections || [];
    const vars: Record<string, string> = {};

    // 查找 stat 类型的 section
    const statSection = sections.find(
      (s) => s.type === "stat" && this.isStatContent(s.content),
    );

    if (statSection && this.isStatContent(statSection.content)) {
      const stat = statSection.content;
      vars["NUMBER"] = stat.value || MISSING_NUMBER_PLACEHOLDER;
      vars["LABEL"] = stat.label || "";
      vars["CHANGE"] = stat.change || "";
    } else {
      this.logger.warn(
        `[extractBigNumberVariables] Missing stat section for "${pageContent.title}"`,
      );
      vars["NUMBER"] = MISSING_NUMBER_PLACEHOLDER;
      vars["LABEL"] = "";
      vars["CHANGE"] = "";
    }

    return vars;
  }

  /**
   * 提取 D-003 Trend Chart 模板变量
   * v3.6 重构: 移除硬编码默认值
   */
  private extractTrendChartVariables(
    pageContent: PageContent,
  ): Record<string, string> {
    const sections = pageContent.sections || [];
    const vars: Record<string, string> = {};

    // 查找 stat 类型的 sections
    const statSections = sections.filter(
      (s) => s.type === "stat" && this.isStatContent(s.content),
    );

    if (statSections.length > 0) {
      const firstStat = statSections[0].content as StatContent;
      vars["CURRENT_VALUE"] = firstStat.value || MISSING_NUMBER_PLACEHOLDER;
      vars["MOM_CHANGE"] = firstStat.change || "";
      vars["YOY_CHANGE"] = statSections[1]
        ? (statSections[1].content as StatContent).change || ""
        : "";
    } else {
      this.logger.warn(
        `[extractTrendChartVariables] Missing stat sections for "${pageContent.title}"`,
      );
      vars["CURRENT_VALUE"] = MISSING_NUMBER_PLACEHOLDER;
      vars["MOM_CHANGE"] = "";
      vars["YOY_CHANGE"] = "";
    }

    // 洞察和周期
    const textSection = sections.find(
      (s) => s.type === "text" && typeof s.content === "string",
    );
    vars["INSIGHT"] = (textSection?.content as string)?.slice(0, 100) || "";
    vars["PERIOD"] = pageContent.subtitle || "";

    // 图表数据 - 从 sections 提取或留空
    vars["X_DATA"] = "[]";
    vars["Y_DATA"] = "[]";

    return vars;
  }

  /**
   * 提取 D-004 Comparison Dual 模板变量
   * v3.6 重构: 移除所有硬编码默认值，完全从 sections 提取
   */
  private extractComparisonDualVariables(
    pageContent: PageContent,
  ): Record<string, string> {
    const sections = pageContent.sections || [];
    const vars: Record<string, string> = {};

    // 从 sections 提取数据 - 只保留 list 类型的 sections
    const listSections = sections.filter(
      (s) => s.type === "list" && Array.isArray(s.content),
    );

    // 提取 Option A 的内容
    const optionAContent =
      listSections[0] && Array.isArray(listSections[0].content)
        ? listSections[0].content
        : [];

    const aTitle = optionAContent[0] || "";
    if (!aTitle) {
      this.logger.warn(
        `[extractComparisonDualVariables] Missing OPTION_A_TITLE for "${pageContent.title}"`,
      );
    }
    vars["OPTION_A_TITLE"] = aTitle || MISSING_PLACEHOLDER;
    vars["A_PRO1"] = optionAContent[1] || "";
    vars["A_PRO2"] = optionAContent[2] || "";
    vars["A_CON1"] = optionAContent[3] || "";
    vars["A_COST"] = optionAContent[4] || "";

    // 提取 Option B 的内容
    const optionBContent =
      listSections[1] && Array.isArray(listSections[1].content)
        ? listSections[1].content
        : [];

    const bTitle = optionBContent[0] || "";
    if (!bTitle) {
      this.logger.warn(
        `[extractComparisonDualVariables] Missing OPTION_B_TITLE for "${pageContent.title}"`,
      );
    }
    vars["OPTION_B_TITLE"] = bTitle || MISSING_PLACEHOLDER;
    vars["B_PRO1"] = optionBContent[1] || "";
    vars["B_PRO2"] = optionBContent[2] || "";
    vars["B_CON1"] = optionBContent[3] || "";
    vars["B_COST"] = optionBContent[4] || "";

    // 也提供 LEFT_ITEMS 和 RIGHT_ITEMS 用于兼容性
    if (optionAContent.length > 0) {
      vars["LEFT_ITEMS"] = optionAContent
        .map(
          (item) =>
            `<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;"><span style="color: #EF4444;">✗</span> ${item}</div>`,
        )
        .join("");
    }
    if (optionBContent.length > 0) {
      vars["RIGHT_ITEMS"] = optionBContent
        .map(
          (item) =>
            `<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;"><span style="color: #10B981;">✓</span> ${item}</div>`,
        )
        .join("");
    }

    return vars;
  }

  /**
   * 提取 D-005 Comparison Table 模板变量
   * v3.6 重构: 移除所有硬编码默认值
   */
  private extractComparisonTableVariables(
    pageContent: PageContent,
  ): Record<string, string> {
    const sections = pageContent.sections || [];
    const vars: Record<string, string> = {};

    // 从 sections 提取数据
    const listSections = sections.filter(
      (s) => s.type === "list" && Array.isArray(s.content),
    );

    // 表头从第一个 section 提取（如果有）
    const headerSection = listSections[0];
    if (headerSection && Array.isArray(headerSection.content)) {
      vars["COL1_HEADER"] = headerSection.content[1] || MISSING_PLACEHOLDER;
      vars["COL2_HEADER"] = headerSection.content[2] || MISSING_PLACEHOLDER;
      vars["COL3_HEADER"] = headerSection.content[3] || MISSING_PLACEHOLDER;
    } else {
      this.logger.warn(
        `[extractComparisonTableVariables] Missing column headers for "${pageContent.title}"`,
      );
      vars["COL1_HEADER"] = MISSING_PLACEHOLDER;
      vars["COL2_HEADER"] = MISSING_PLACEHOLDER;
      vars["COL3_HEADER"] = MISSING_PLACEHOLDER;
    }

    // 如果有足够的 list sections，用来填充表格
    for (let i = 0; i < 5; i++) {
      const rowNum = i + 1;
      const section = listSections[i + 1]; // 跳过第一个表头

      let label = "";
      let col1 = "";
      let col2 = "";
      let col3 = "";

      if (section && Array.isArray(section.content)) {
        const items = section.content;
        label = items[0] || "";
        col1 = items[1] || "";
        col2 = items[2] || "";
        col3 = items[3] || "";
      }

      if (!label) {
        this.logger.warn(
          `[extractComparisonTableVariables] Missing ROW${rowNum}_LABEL for "${pageContent.title}"`,
        );
        label = MISSING_PLACEHOLDER;
      }

      vars[`ROW${rowNum}_LABEL`] = label;
      vars[`ROW${rowNum}_COL1`] = col1;
      vars[`ROW${rowNum}_COL2`] = col2;
      vars[`ROW${rowNum}_COL3`] = col3;
    }

    return vars;
  }

  /**
   * 提取 D-006 Ranking List 模板变量
   * v3.6 重构: 移除所有硬编码默认值
   */
  private extractRankingListVariables(
    pageContent: PageContent,
  ): Record<string, string> {
    const sections = pageContent.sections || [];
    const vars: Record<string, string> = {};

    // 从 sections 提取数据
    const listSections = sections.filter(
      (s) => s.type === "list" && Array.isArray(s.content),
    );
    const statSections = sections.filter(
      (s) => s.type === "stat" && this.isStatContent(s.content),
    );

    for (let i = 0; i < 5; i++) {
      const rankNum = i + 1;
      const listSection = listSections[i];
      const statSection = statSections[i];

      let name = "";
      let desc = "";
      let value = "";

      if (listSection && Array.isArray(listSection.content)) {
        const items = listSection.content;
        name = items[0] || "";
        desc = items[1] || "";
        value = items[2] || "";
      } else if (statSection && this.isStatContent(statSection.content)) {
        const stat = statSection.content;
        name = stat.label || "";
        value = stat.value || "";
      }

      if (!name) {
        this.logger.warn(
          `[extractRankingListVariables] Missing RANK${rankNum}_NAME for "${pageContent.title}"`,
        );
        name = MISSING_PLACEHOLDER;
      }

      vars[`RANK${rankNum}_NAME`] = name;
      vars[`RANK${rankNum}_DESC`] = desc;
      vars[`RANK${rankNum}_VALUE`] = value || MISSING_NUMBER_PLACEHOLDER;
    }

    // 洞察 - v3.6: 无硬编码默认值
    const textSection = sections.find(
      (s) => s.type === "text" && typeof s.content === "string",
    );
    const insight = (textSection?.content as string)?.slice(0, 150) || "";
    if (!insight) {
      this.logger.warn(
        `[extractRankingListVariables] Missing INSIGHT for "${pageContent.title}"`,
      );
    }
    vars["INSIGHT"] = insight || "";

    return vars;
  }
}

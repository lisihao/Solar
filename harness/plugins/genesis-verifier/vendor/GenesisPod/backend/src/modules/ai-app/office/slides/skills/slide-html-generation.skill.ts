/**
 * Slides Engine v6.0 - Slide HTML Generation Skill
 *
 * AI 直接生成完整 HTML 幻灯片（核心重构）
 * - 合并内容压缩 + 渲染为一步
 * - AI 输出 standalone 1280x720 HTML
 * - 使用设计系统 prompt 约束输出质量
 * - 降级到旧 TemplateRenderingSkill
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import {
  ISkill,
  SkillContext,
  SkillResult,
  SkillLayer,
  SKILL_LAYERS,
  ChatMessage,
} from "@/modules/ai-harness/facade";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { AIModelType } from "@prisma/client";
import { PageOutline, CDN_RESOURCES } from "../checkpoint/checkpoint.types";
import {
  SLIDE_DESIGN_SYSTEM_PROMPT,
  SLIDE_DESIGN_SYSTEM_BASE_PROMPT,
  buildSlideHtmlUserPrompt,
} from "../../prompts/slide-design-system.prompt";
import { postProcessSlideHtml } from "./html-post-processor";

// ============================================================================
// Types
// ============================================================================

export interface SlideHtmlGenerationInput {
  /** 页面大纲（标题、类型、关键元素） */
  pageOutline: PageOutline;
  /** 源文本（用于提取具体内容） */
  sourceText: string;
  /** 已搜索到的图片 URL */
  imageUrls: string[];
  /** 用户指定的风格偏好 */
  themeHint?: string;
  /** 上一页摘要（保持连贯性） */
  previousPageSummary?: string;
  /** 当前页索引（0-based） */
  slideIndex: number;
  /** 总页数 */
  totalSlides: number;
  /** 语言 */
  language?: string;
  /** Theme prompt fragment from DesignTokenInjectorSkill */
  themePromptFragment?: string;
  /** Pre-extracted content from SmartContentExtractorSkill */
  extractedContent?: string;
}

export interface SlideHtmlGenerationOutput {
  /** 完整 standalone HTML */
  html: string;
  /** AI 的设计决策说明 */
  designDecisions: string;
}

@Injectable()
export class SlideHtmlGenerationSkill implements ISkill<
  SlideHtmlGenerationInput,
  SlideHtmlGenerationOutput
> {
  private readonly logger = new Logger(SlideHtmlGenerationSkill.name);

  readonly id = "slides-html-generation";
  readonly name = "AI HTML 幻灯片生成";
  readonly description =
    "AI 直接生成完整 standalone HTML 幻灯片，含图片、图标、自适应配色";
  readonly layer: SkillLayer = SKILL_LAYERS.CONTENT;
  readonly domain = "slides";
  readonly tags = ["slides", "html", "generation", "ai-adaptive"];
  readonly version = "6.0.0";

  constructor(@Optional() private readonly chatFacade?: ChatFacade) {}

  async execute(
    input: SlideHtmlGenerationInput,
    context: SkillContext,
  ): Promise<SkillResult<SlideHtmlGenerationOutput>> {
    const startTime = new Date();

    if (!this.chatFacade) {
      return {
        success: false,
        error: {
          code: "NO_AI_FACADE",
          message: "AIFacade not available",
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
      this.logger.log(
        `[execute] Generating HTML for slide ${input.slideIndex + 1}/${input.totalSlides}: "${input.pageOutline.title}"`,
      );

      // Build the user prompt
      const userPrompt = buildSlideHtmlUserPrompt({
        pageOutline: {
          pageNumber: input.pageOutline.pageNumber,
          title: input.pageOutline.title,
          subtitle: input.pageOutline.subtitle,
          templateType: input.pageOutline.templateType,
          contentBrief: input.pageOutline.contentBrief,
          keyElements: input.pageOutline.keyElements || [],
          logicType: input.pageOutline.logicType,
        },
        sourceText: input.sourceText,
        imageUrls: input.imageUrls,
        themeHint: input.themeHint,
        previousPageSummary: input.previousPageSummary,
        slideIndex: input.slideIndex,
        totalSlides: input.totalSlides,
        language: input.language,
        extractedContent: input.extractedContent,
      });

      // Use base prompt + injected theme tokens if available, else full prompt
      const systemPrompt = input.themePromptFragment
        ? SLIDE_DESIGN_SYSTEM_BASE_PROMPT + "\n\n" + input.themePromptFragment
        : SLIDE_DESIGN_SYSTEM_PROMPT;

      // Call AI via AIFacade
      const messages: ChatMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ];

      const response = await this.chatFacade.chat({
        messages,
        modelType: "CHAT" as AIModelType,
        taskProfile: {
          creativity: "medium",
          outputLength: "long",
        },
      });

      if (response.isError || !response.content) {
        throw new Error(
          `AI response error: ${response.content || "empty response"}`,
        );
      }

      // Parse HTML from AI response
      const { html, designDecisions } = this.parseAiResponse(response.content);

      if (!html) {
        throw new Error("Failed to extract HTML from AI response");
      }

      // Post-process the HTML
      const processedHtml = postProcessSlideHtml(html, {
        slideIndex: input.slideIndex,
        totalSlides: input.totalSlides,
      });

      this.logger.log(
        `[execute] Successfully generated HTML for slide ${input.slideIndex + 1}, length: ${processedHtml.length}`,
      );

      return {
        success: true,
        data: {
          html: processedHtml,
          designDecisions,
        },
        metadata: {
          executionId: context.executionId,
          startTime,
          endTime: new Date(),
          duration: Date.now() - startTime.getTime(),
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      this.logger.error(
        `[execute] Failed to generate HTML for slide ${input.slideIndex + 1}: ${errorMessage}`,
      );

      return {
        success: false,
        error: {
          code: "HTML_GENERATION_FAILED",
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
   * 解析 AI 响应，提取 HTML 和设计决策
   */
  private parseAiResponse(content: string): {
    html: string;
    designDecisions: string;
  } {
    let html = "";
    let designDecisions = "";

    // Try to extract HTML from ```html code block
    const htmlBlockMatch = content.match(/```html\s*\n([\s\S]*?)\n\s*```/);
    if (htmlBlockMatch) {
      html = htmlBlockMatch[1].trim();
      // Everything after the code block is design decisions
      const afterBlock = content
        .substring(content.indexOf("```", content.indexOf("```html") + 7) + 3)
        .trim();
      designDecisions = afterBlock || "AI-generated slide";
    } else {
      // Fallback: try to find <!DOCTYPE or <html directly
      const doctypeMatch = content.match(/(<!DOCTYPE[\s\S]*<\/html>)/i);
      if (doctypeMatch) {
        html = doctypeMatch[1].trim();
        designDecisions = "AI-generated slide (no code block wrapper)";
      } else {
        // Last resort: look for slide-container div
        const containerMatch = content.match(
          /(<div[^>]*class="slide-container"[\s\S]*)/i,
        );
        if (containerMatch) {
          html = this.wrapPartialHtml(containerMatch[1]);
          designDecisions = "AI-generated slide (partial HTML, auto-wrapped)";
        }
      }
    }

    return { html, designDecisions };
  }

  /**
   * 包装不完整的 HTML（只有 slide-container div 的情况）
   */
  private wrapPartialHtml(partialHtml: string): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800;900&family=Noto+Sans+SC:wght@300;400;500;700;900&display=swap" rel="stylesheet">
  <link href="${CDN_RESOURCES.fontAwesome}" rel="stylesheet">
</head>
<body style="margin:0;padding:0;overflow:hidden;">
  ${partialHtml}
</body>
</html>`;
  }
}

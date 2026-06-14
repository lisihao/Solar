/**
 * Slide Self-Healer Skill (P2)
 *
 * Recovers from slide generation failures with targeted strategies:
 * - EMPTY_CONTENT -> minimal template from pageOutline
 * - TIMEOUT -> simplified LLM retry (title + 3 keyElements only)
 * - AI_REFUSAL -> minimal template fallback
 * - HTML_MALFORMED -> tag cleanup + wrapPartialHtml
 * - OVERFLOW -> regex trim + font-size reduction
 * - IMAGE_BROKEN -> replace <img> with FA icons
 *
 * Replaces the blunt `generateWithTemplate()` fallback.
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
import { postProcessSlideHtml } from "./html-post-processor";
import { getTheme } from "../templates/base/themes";
import type {
  SlideSelfHealerInput,
  SlideSelfHealerOutput,
  HealErrorType,
  HealStrategy,
} from "./types/enhancement-types";

@Injectable()
export class SlideSelfHealerSkill implements ISkill<
  SlideSelfHealerInput,
  SlideSelfHealerOutput
> {
  private readonly logger = new Logger(SlideSelfHealerSkill.name);

  readonly id = "slides-self-healer";
  readonly name = "Slide Self-Healer";
  readonly description =
    "Recovers from slide generation failures with targeted error-specific strategies";
  readonly layer: SkillLayer = SKILL_LAYERS.OPTIMIZATION;
  readonly domain = "slides";
  readonly tags = ["slides", "recovery", "fallback", "healing"];
  readonly version = "1.0.0";

  constructor(@Optional() private readonly chatFacade?: ChatFacade) {}

  async execute(
    input: SlideSelfHealerInput,
    context: SkillContext,
  ): Promise<SkillResult<SlideSelfHealerOutput>> {
    const startTime = new Date();

    try {
      const errorType = this.classifyError(input.failedHtml, input.error);
      this.logger.log(
        `[execute] Error classified as: ${errorType} for page "${input.pageOutline.title}"`,
      );

      const strategy = this.selectStrategy(errorType);
      let html: string;
      let confidence: number;

      switch (strategy) {
        case "wrap_partial":
          ({ html, confidence } = this.healMalformedHtml(
            input.failedHtml,
            input,
          ));
          break;

        case "trim_overflow":
          ({ html, confidence } = this.healOverflow(input.failedHtml, input));
          break;

        case "minimal_template":
          ({ html, confidence } = this.generateMinimalTemplate(input));
          break;

        case "replace_images":
          ({ html, confidence } = this.healBrokenImages(
            input.failedHtml,
            input,
          ));
          break;

        case "simplified_retry":
          ({ html, confidence } = await this.simplifiedRetry(input, context));
          break;

        default:
          ({ html, confidence } = this.generateMinimalTemplate(input));
          break;
      }

      // Post-process the healed HTML
      html = postProcessSlideHtml(html, {
        slideIndex: input.slideIndex,
        totalSlides: input.totalSlides,
      });

      return {
        success: true,
        data: {
          html,
          healed: true,
          errorType,
          strategy,
          confidence,
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
      this.logger.error(`[execute] Self-healing failed: ${errorMessage}`);

      return {
        success: false,
        error: {
          code: "SELF_HEALING_FAILED",
          message: errorMessage,
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
  }

  /**
   * Classify the error type
   */
  private classifyError(failedHtml: string, error: string): HealErrorType {
    if (!failedHtml || failedHtml.trim().length === 0) {
      return "EMPTY_CONTENT";
    }

    const errorLower = error.toLowerCase();

    if (errorLower.includes("timeout") || errorLower.includes("timed out")) {
      return "TIMEOUT";
    }

    if (
      errorLower.includes("refused") ||
      errorLower.includes("content policy") ||
      errorLower.includes("safety")
    ) {
      return "AI_REFUSAL";
    }

    // Check for malformed HTML (no closing tags)
    if (!failedHtml.includes("</")) {
      return "HTML_MALFORMED";
    }

    // Check for overflow indicators in the HTML or error
    if (errorLower.includes("overflow") || errorLower.includes("exceed")) {
      return "OVERFLOW";
    }

    // Check for broken images
    if (
      errorLower.includes("image") ||
      errorLower.includes("img") ||
      errorLower.includes("broken")
    ) {
      return "IMAGE_BROKEN";
    }

    // Default to HTML_MALFORMED if HTML exists but is problematic
    return "HTML_MALFORMED";
  }

  /**
   * Select recovery strategy based on error type
   */
  private selectStrategy(errorType: HealErrorType): HealStrategy {
    const strategyMap: Record<HealErrorType, HealStrategy> = {
      HTML_MALFORMED: "wrap_partial",
      OVERFLOW: "trim_overflow",
      EMPTY_CONTENT: "minimal_template",
      IMAGE_BROKEN: "replace_images",
      TIMEOUT: "simplified_retry",
      AI_REFUSAL: "minimal_template",
    };
    return strategyMap[errorType];
  }

  /**
   * Heal malformed HTML by cleaning tags and wrapping
   */
  private healMalformedHtml(
    failedHtml: string,
    input: SlideSelfHealerInput,
  ): { html: string; confidence: number } {
    let cleaned = failedHtml;

    // Remove any markdown artifacts
    cleaned = cleaned
      .replace(/^```html\s*\n?/i, "")
      .replace(/\n?```\s*$/i, "")
      .trim();

    // Try to close unclosed tags
    const openTags: string[] = [];
    const tagPattern = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi;
    let match;
    while ((match = tagPattern.exec(cleaned)) !== null) {
      const isClosing = match[0].startsWith("</");
      const tagName = match[1].toLowerCase();
      const selfClosing = /\/\s*>$/.test(match[0]);

      if (selfClosing) continue;
      if (isClosing) {
        const idx = openTags.lastIndexOf(tagName);
        if (idx >= 0) openTags.splice(idx, 1);
      } else {
        openTags.push(tagName);
      }
    }

    // Close unclosed tags in reverse order
    for (let i = openTags.length - 1; i >= 0; i--) {
      cleaned += `</${openTags[i]}>`;
    }

    // If no slide-container, wrap it
    if (!cleaned.includes("slide-container")) {
      cleaned = this.wrapInSlideContainer(cleaned, input);
    }

    return { html: cleaned, confidence: 0.8 };
  }

  /**
   * Heal overflow by trimming content and reducing font sizes
   */
  private healOverflow(
    failedHtml: string,
    _input: SlideSelfHealerInput,
  ): { html: string; confidence: number } {
    let html = failedHtml;

    // Reduce font sizes
    html = html.replace(
      /font-size:\s*(\d+)px/g,
      (_match: string, size: string) => {
        const px = parseInt(size, 10);
        if (px > 36) return `font-size:${Math.floor(px * 0.85)}px`;
        if (px > 24) return `font-size:${Math.floor(px * 0.9)}px`;
        return `font-size:${px}px`;
      },
    );

    // Remove last bullet point if there are many
    const bulletPattern = /<li[^>]*>[\s\S]*?<\/li>/gi;
    const bullets = html.match(bulletPattern);
    if (bullets && bullets.length > 4) {
      // Remove last 1-2 bullets
      const lastBullet = bullets[bullets.length - 1];
      html = html.replace(lastBullet, "");
    }

    return { html, confidence: 0.7 };
  }

  /**
   * Generate minimal template from pageOutline
   */
  private generateMinimalTemplate(input: SlideSelfHealerInput): {
    html: string;
    confidence: number;
  } {
    const theme = getTheme(input.themeId || "genspark-dark");
    const { pageOutline } = input;

    const keyElements = (pageOutline.keyElements || []).slice(0, 4);
    const elementsHtml = keyElements
      .map(
        (el, i) =>
          `<div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:16px;">
            <div style="width:32px;height:32px;border-radius:50%;background:${theme.colors.accent.primary};color:white;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex-shrink:0;">${i + 1}</div>
            <p style="margin:0;font-size:16px;color:${theme.colors.text.secondary};line-height:1.5;">${this.escapeHtml(el)}</p>
          </div>`,
      )
      .join("\n");

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800;900&family=Noto+Sans+SC:wght@300;400;500;700;900&display=swap" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
</head>
<body style="margin:0;padding:0;overflow:hidden;">
  <div class="slide-container" style="width:1280px;height:720px;overflow:hidden;position:relative;font-family:'Montserrat','Noto Sans SC',sans-serif;box-sizing:border-box;background:${theme.colors.background.gradient};padding:60px 80px;">
    <div style="margin-bottom:40px;">
      <h2 style="font-size:36px;font-weight:800;color:${theme.colors.text.primary};margin:0 0 8px 0;letter-spacing:-0.01em;">${this.escapeHtml(pageOutline.title)}</h2>
      ${pageOutline.subtitle ? `<p style="font-size:18px;color:${theme.colors.text.muted};margin:0;">${this.escapeHtml(pageOutline.subtitle)}</p>` : ""}
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;">
      ${elementsHtml}
    </div>
    <div style="position:absolute;bottom:20px;left:80px;right:80px;border-top:1px solid ${theme.colors.card.border};padding-top:12px;">
      <p style="font-size:12px;color:${theme.colors.text.muted};margin:0;">${this.escapeHtml(pageOutline.contentBrief || "")}</p>
    </div>
  </div>
</body>
</html>`;

    return { html, confidence: 0.6 };
  }

  /**
   * Heal broken images by replacing with FA icons
   */
  private healBrokenImages(
    failedHtml: string,
    _unused: SlideSelfHealerInput,
  ): { html: string; confidence: number } {
    const html = failedHtml.replace(
      /<img\s+[^>]*src="[^"]*"[^>]*>/gi,
      `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#f0f0f0,#e0e0e0);border-radius:8px;min-height:120px;"><i class="fas fa-image" style="font-size:48px;color:#ccc;"></i></div>`,
    );

    return { html, confidence: 0.8 };
  }

  /**
   * Simplified LLM retry with minimal prompt
   */
  private async simplifiedRetry(
    input: SlideSelfHealerInput,
    _context: SkillContext,
  ): Promise<{ html: string; confidence: number }> {
    if (!this.chatFacade) {
      return this.generateMinimalTemplate(input);
    }

    const { pageOutline } = input;
    const keyElements = (pageOutline.keyElements || []).slice(0, 3);

    const messages: ChatMessage[] = [
      {
        role: "system",
        content: `Generate a simple, clean HTML slide (1280x720px) with inline styles only.
Use a .slide-container div wrapper. Include Google Fonts and Font Awesome CDN links.
Keep it minimal and professional. Return ONLY the HTML.`,
      },
      {
        role: "user",
        content: `Create a "${pageOutline.templateType}" slide:
Title: "${pageOutline.title}"
Key points: ${keyElements.map((e) => `- ${e}`).join("\n")}`,
      },
    ];

    try {
      const response = await this.chatFacade.chat({
        messages,
        modelType: "CHAT" as AIModelType,
        taskProfile: {
          creativity: "low",
          outputLength: "medium",
        },
      });

      if (response.isError || !response.content) {
        return this.generateMinimalTemplate(input);
      }

      // Extract HTML
      let html = response.content;
      const htmlMatch = html.match(/```html\s*\n([\s\S]*?)\n\s*```/);
      if (htmlMatch) {
        html = htmlMatch[1].trim();
      }

      return { html, confidence: 0.5 };
    } catch {
      return this.generateMinimalTemplate(input);
    }
  }

  /**
   * Wrap partial HTML in a slide container
   */
  private wrapInSlideContainer(
    content: string,
    input: SlideSelfHealerInput,
  ): string {
    const theme = getTheme(input.themeId || "genspark-dark");
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800;900&family=Noto+Sans+SC:wght@300;400;500;700;900&display=swap" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
</head>
<body style="margin:0;padding:0;overflow:hidden;">
  <div class="slide-container" style="width:1280px;height:720px;overflow:hidden;position:relative;font-family:'Montserrat','Noto Sans SC',sans-serif;box-sizing:border-box;background:${theme.colors.background.gradient};padding:60px 80px;">
    ${content}
  </div>
</body>
</html>`;
  }

  /**
   * Escape HTML entities
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
}

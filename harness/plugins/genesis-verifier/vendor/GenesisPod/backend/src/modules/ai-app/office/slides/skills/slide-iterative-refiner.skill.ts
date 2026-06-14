/**
 * Slide Iterative Refiner Skill (P1)
 *
 * Refines slide HTML based on visual validation issues:
 * 1. Programmatic quick fixes (no LLM needed):
 *    - broken images -> Font Awesome icon replacement
 *    - overflow -> font size reduction
 * 2. LLM-targeted fixes (only for specific issues, not full regeneration)
 * 3. Re-validates after fix, loops up to maxIterations
 * 4. Returns the best-scoring version
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
import { SlideVisualValidatorSkill } from "./slide-visual-validator.skill";
import type {
  SlideIterativeRefinerInput,
  SlideIterativeRefinerOutput,
  SlideVisualValidatorOutput,
} from "./types/enhancement-types";

@Injectable()
export class SlideIterativeRefinerSkill implements ISkill<
  SlideIterativeRefinerInput,
  SlideIterativeRefinerOutput
> {
  private readonly logger = new Logger(SlideIterativeRefinerSkill.name);

  readonly id = "slides-iterative-refiner";
  readonly name = "Slide Iterative Refiner";
  readonly description =
    "Iteratively refines slide HTML based on visual validation issues";
  readonly layer: SkillLayer = SKILL_LAYERS.OPTIMIZATION;
  readonly domain = "slides";
  readonly tags = ["slides", "refiner", "iterative", "quality"];
  readonly version = "1.0.0";

  constructor(
    @Optional() private readonly chatFacade?: ChatFacade,
    @Optional()
    private readonly visualValidator?: SlideVisualValidatorSkill,
  ) {}

  async execute(
    input: SlideIterativeRefinerInput,
    context: SkillContext,
  ): Promise<SkillResult<SlideIterativeRefinerOutput>> {
    const startTime = new Date();
    const maxIterations = input.maxIterations ?? 2;

    try {
      let currentHtml = input.html;
      let currentReport = input.validationReport;
      let bestHtml = input.html;
      let bestScore = currentReport.score;
      const allFixes: string[] = [];
      let iterations = 0;

      for (let i = 0; i < maxIterations; i++) {
        if (currentReport.passed) break;

        iterations++;
        this.logger.log(
          `[execute] Iteration ${i + 1}/${maxIterations}, current score: ${currentReport.score}`,
        );

        // 1. Apply programmatic quick fixes
        const { html: quickFixed, fixes: quickFixes } = this.applyQuickFixes(
          currentHtml,
          currentReport,
        );
        allFixes.push(...quickFixes);

        // 2. If there are remaining non-programmatic issues, use LLM
        const remainingIssues = currentReport.issues.filter(
          (issue) =>
            issue.type !== "image_broken" &&
            !(
              issue.type === "overflow" &&
              quickFixes.some((f) => f.includes("font-size"))
            ),
        );

        let refinedHtml = quickFixed;
        if (remainingIssues.length > 0 && this.chatFacade) {
          try {
            const llmFixed = await this.llmRefine(
              quickFixed,
              remainingIssues,
              input,
              context,
            );
            if (llmFixed) {
              refinedHtml = llmFixed;
              allFixes.push("LLM-targeted fix for remaining issues");
            }
          } catch (error) {
            this.logger.warn(
              `[execute] LLM refinement failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }

        // 3. Post-process
        refinedHtml = postProcessSlideHtml(refinedHtml, {
          slideIndex: input.slideIndex,
          totalSlides: input.totalSlides,
        });

        // 4. Re-validate
        if (this.visualValidator) {
          const revalidation = await this.visualValidator.execute(
            { html: refinedHtml, themeId: input.themeId },
            {
              ...context,
              executionId: `${context.executionId}-revalidate-${i}`,
            },
          );

          if (revalidation.success && revalidation.data) {
            currentReport = revalidation.data;
            currentHtml = refinedHtml;

            if (currentReport.score > bestScore) {
              bestScore = currentReport.score;
              bestHtml = refinedHtml;
            }

            this.logger.log(
              `[execute] After iteration ${i + 1}: score=${currentReport.score}, passed=${currentReport.passed}`,
            );
          }
        } else {
          // Without validator, just use the refined HTML
          bestHtml = refinedHtml;
          break;
        }
      }

      const improved = bestScore > input.validationReport.score;

      return {
        success: true,
        data: {
          html: bestHtml,
          improved,
          finalScore: bestScore,
          iterations,
          fixes: allFixes,
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
      this.logger.error(`[execute] Refinement failed: ${errorMessage}`);

      return {
        success: false,
        error: {
          code: "ITERATIVE_REFINEMENT_FAILED",
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
   * Apply programmatic quick fixes (no LLM needed)
   */
  private applyQuickFixes(
    html: string,
    report: SlideVisualValidatorOutput,
  ): { html: string; fixes: string[] } {
    let result = html;
    const fixes: string[] = [];

    for (const issue of report.issues) {
      switch (issue.type) {
        case "image_broken": {
          // Replace broken <img> tags with Font Awesome icon placeholders
          const imgPattern = /<img\s+[^>]*src="[^"]*"[^>]*>/gi;
          const matches = result.match(imgPattern);
          if (matches) {
            for (const match of matches) {
              const replacement = `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#f0f0f0,#e0e0e0);border-radius:8px;"><i class="fas fa-image" style="font-size:48px;color:#ccc;"></i></div>`;
              result = result.replace(match, replacement);
            }
            fixes.push(
              `Replaced ${matches.length} broken image(s) with icon placeholders`,
            );
          }
          break;
        }

        case "overflow": {
          // Reduce large font sizes
          result = result.replace(
            /font-size:\s*(\d+)px/g,
            (_match: string, size: string) => {
              const px = parseInt(size, 10);
              if (px > 36) return `font-size:${px - 4}px`;
              if (px > 24) return `font-size:${px - 2}px`;
              return `font-size:${px}px`;
            },
          );
          fixes.push("Reduced oversized font sizes to prevent overflow");
          break;
        }
      }
    }

    return { html: result, fixes };
  }

  /**
   * Use LLM for targeted fixes (not full regeneration)
   */
  private async llmRefine(
    html: string,
    issues: SlideVisualValidatorOutput["issues"],
    input: SlideIterativeRefinerInput,
    _context: SkillContext,
  ): Promise<string | null> {
    if (!this.chatFacade) return null;

    const issueList = issues
      .map((issue, i) => `${i + 1}. [${issue.type}] ${issue.message}`)
      .join("\n");

    const messages: ChatMessage[] = [
      {
        role: "system",
        content: `You are an HTML slide fixer. Fix the specific issues listed below in the HTML.
ONLY modify the problematic areas. Keep the overall design, structure, and content intact.
The slide is 1280x720px. Return ONLY the complete fixed HTML wrapped in \`\`\`html code block.`,
      },
      {
        role: "user",
        content: `Fix these specific issues in the HTML:\n${issueList}\n\nSlide title: "${input.pageOutline.title}"\n\n\`\`\`html\n${html}\n\`\`\``,
      },
    ];

    const response = await this.chatFacade.chat({
      messages,
      modelType: "CHAT" as AIModelType,
      taskProfile: {
        creativity: "low",
        outputLength: "long",
      },
    });

    if (response.isError || !response.content) return null;

    // Extract HTML from response
    const htmlMatch = response.content.match(/```html\s*\n([\s\S]*?)\n\s*```/);
    if (htmlMatch) {
      return htmlMatch[1].trim();
    }

    // Fallback: try to find DOCTYPE
    const doctypeMatch = response.content.match(/(<!DOCTYPE[\s\S]*<\/html>)/i);
    if (doctypeMatch) {
      return doctypeMatch[1].trim();
    }

    return null;
  }
}

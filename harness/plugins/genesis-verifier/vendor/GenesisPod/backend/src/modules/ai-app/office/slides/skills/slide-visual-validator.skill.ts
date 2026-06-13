/**
 * Slide Visual Validator Skill (P1)
 *
 * Validates generated slide HTML using Puppeteer headless browser:
 * - Overflow detection (scrollWidth/scrollHeight vs 1280/720)
 * - Blank area ratio
 * - Text density analysis
 * - Image integrity check
 * - Accent color extraction
 *
 * Weighted scoring: overflow 30 + blank 20 + density 20 + images 15 + colors 15
 * No LLM calls — pure programmatic analysis.
 */

import { Injectable, Logger } from "@nestjs/common";
import { PuppeteerPoolService } from "../../../../../common/browser/puppeteer-pool.service";
import {
  ISkill,
  SkillContext,
  SkillResult,
  SkillLayer,
  SKILL_LAYERS,
} from "@/modules/ai-harness/facade";
import type {
  SlideVisualValidatorInput,
  SlideVisualValidatorOutput,
  ValidationIssue,
} from "./types/enhancement-types";

@Injectable()
export class SlideVisualValidatorSkill implements ISkill<
  SlideVisualValidatorInput,
  SlideVisualValidatorOutput
> {
  private readonly logger = new Logger(SlideVisualValidatorSkill.name);

  constructor(private readonly browserPool: PuppeteerPoolService) {}

  readonly id = "slides-visual-validator";
  readonly name = "Slide Visual Validator";
  readonly description =
    "Validates slide HTML for overflow, blank areas, text density, and image integrity using Puppeteer";
  readonly layer: SkillLayer = SKILL_LAYERS.QUALITY;
  readonly domain = "slides";
  readonly tags = ["slides", "validation", "visual", "puppeteer"];
  readonly version = "1.0.0";

  async execute(
    input: SlideVisualValidatorInput,
    context: SkillContext,
  ): Promise<SkillResult<SlideVisualValidatorOutput>> {
    const startTime = new Date();

    if (!input.html || input.html.length === 0) {
      return {
        success: true,
        data: {
          passed: false,
          score: 0,
          issues: [
            {
              type: "overflow",
              severity: "error",
              message: "Empty HTML content",
            },
          ],
          metrics: {
            hasOverflow: false,
            blankRatio: 1,
            textDensity: 0,
            imageCount: 0,
            brokenImages: 0,
            accentColors: [],
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

    try {
      const browser = await this.browserPool.getBrowser();
      const page = await browser.newPage();
      await page.setViewport({
        width: 1280,
        height: 720,
        deviceScaleFactor: 2,
      });
      await page.setContent(input.html, { waitUntil: "domcontentloaded" });

      // Wait for fonts to load (with timeout)
      await page
        .evaluate(() => document.fonts.ready)
        .catch(() => {
          /* font loading timeout is non-fatal */
        });

      // Run all checks in a single page.evaluate
      const metrics = await page.evaluate(() => {
        const container =
          document.querySelector<HTMLElement>(".slide-container");

        if (!container) {
          return {
            hasOverflow: false,
            blankRatio: 1,
            textDensity: 0,
            imageCount: 0,
            brokenImages: 0,
            accentColors: [] as string[],
            containerFound: false,
          };
        }

        // 1. Overflow detection
        const hasOverflow =
          container.scrollWidth > 1280 || container.scrollHeight > 720;

        // 2. Text density: total text characters / available area
        const textNodes: string[] = [];
        const walker = document.createTreeWalker(
          container,
          NodeFilter.SHOW_TEXT,
        );
        let node: Node | null;
        while ((node = walker.nextNode())) {
          const text = (node.textContent || "").trim();
          if (text.length > 0) {
            textNodes.push(text);
          }
        }
        const totalChars = textNodes.join("").length;
        const availableArea = 1280 * 720;
        const textDensity = totalChars / (availableArea / 1000); // chars per 1000 sq px

        // 3. Image checks
        const images = container.querySelectorAll("img");
        let brokenImages = 0;
        images.forEach((img) => {
          if (
            img.naturalWidth === 0 &&
            img.src &&
            !img.src.startsWith("data:")
          ) {
            brokenImages++;
          }
        });

        // 4. Accent color extraction (from inline styles)
        const colorSet = new Set<string>();
        const allElements = container.querySelectorAll("*");
        allElements.forEach((el) => {
          const style = (el as HTMLElement).style;
          if (style.color && style.color !== "inherit") {
            colorSet.add(style.color);
          }
          if (style.backgroundColor && style.backgroundColor !== "inherit") {
            colorSet.add(style.backgroundColor);
          }
          if (style.borderColor && style.borderColor !== "inherit") {
            colorSet.add(style.borderColor);
          }
        });

        // 5. Blank ratio estimation: elements covering area vs total
        let coveredArea = 0;
        const childElements = container.querySelectorAll(
          "div, p, ul, ol, table, svg, img, h1, h2, h3, h4, h5, h6, span",
        );
        childElements.forEach((el) => {
          const rect = el.getBoundingClientRect();
          if (rect.width > 10 && rect.height > 10) {
            coveredArea += rect.width * rect.height;
          }
        });
        // Clamp to avoid >1 from overlapping elements
        const blankRatio = Math.max(
          0,
          1 - Math.min(coveredArea / availableArea, 1),
        );

        return {
          hasOverflow,
          blankRatio,
          textDensity,
          imageCount: images.length,
          brokenImages,
          accentColors: Array.from(colorSet).slice(0, 20),
          containerFound: true,
        };
      });

      await page.close();

      // Generate issues and score
      const issues: ValidationIssue[] = [];

      if (!metrics.containerFound) {
        issues.push({
          type: "overflow",
          severity: "error",
          message: "No .slide-container found in HTML",
        });
      }

      if (metrics.hasOverflow) {
        issues.push({
          type: "overflow",
          severity: "error",
          message: "Content overflows the 1280x720 container",
        });
      }

      if (metrics.blankRatio > 0.65) {
        issues.push({
          type: "blank_area",
          severity: "warning",
          message: `Excessive blank area: ${Math.round(metrics.blankRatio * 100)}% empty space`,
          details: { blankRatio: metrics.blankRatio },
        });
      }

      if (metrics.textDensity > 2.5) {
        issues.push({
          type: "text_density",
          severity: "warning",
          message: `Text density too high: ${metrics.textDensity.toFixed(1)} chars per 1000 sq px`,
          details: { textDensity: metrics.textDensity },
        });
      }

      if (metrics.brokenImages > 0) {
        issues.push({
          type: "image_broken",
          severity: "warning",
          message: `${metrics.brokenImages} broken image(s) detected`,
          details: { brokenImages: metrics.brokenImages },
        });
      }

      // Weighted scoring
      const overflowScore = metrics.hasOverflow ? 0 : 30;
      const blankScore =
        metrics.blankRatio > 0.7 ? 5 : metrics.blankRatio > 0.5 ? 15 : 20;
      const densityScore =
        metrics.textDensity > 3 ? 5 : metrics.textDensity > 2 ? 15 : 20;
      const imageScore =
        metrics.brokenImages > 0
          ? Math.max(0, 15 - metrics.brokenImages * 5)
          : 15;
      const colorScore = metrics.accentColors.length > 0 ? 15 : 5;

      const score =
        overflowScore + blankScore + densityScore + imageScore + colorScore;
      const passed = score >= 70;

      this.logger.log(
        `[execute] Validation: score=${score}, passed=${passed}, issues=${issues.length}`,
      );

      return {
        success: true,
        data: {
          passed,
          score,
          issues,
          metrics: {
            hasOverflow: metrics.hasOverflow,
            blankRatio: metrics.blankRatio,
            textDensity: metrics.textDensity,
            imageCount: metrics.imageCount,
            brokenImages: metrics.brokenImages,
            accentColors: metrics.accentColors,
          },
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
      this.logger.error(`[execute] Validation failed: ${errorMessage}`);

      return {
        success: false,
        error: {
          code: "VISUAL_VALIDATION_FAILED",
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
}

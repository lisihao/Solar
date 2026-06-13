/**
 * Deck Consistency Auditor Skill (P2)
 *
 * Audits the entire slide deck for consistency:
 * - Color drift detection (accent colors deviating from theme)
 * - Font drift detection (title font sizes varying between pages)
 * - Layout repetition detection (adjacent pages with identical layouts)
 * - Narrative flow checks (cover at start, closing at end)
 *
 * No LLM calls — pure HTML parsing and analysis.
 * Replaces the hardcoded `{ passed: true, overallScore: 85 }` in Phase 4.
 */

import { Injectable, Logger } from "@nestjs/common";
import {
  ISkill,
  SkillContext,
  SkillResult,
  SkillLayer,
  SKILL_LAYERS,
} from "@/modules/ai-harness/facade";
import { getTheme } from "../templates/base/themes";
import type {
  DeckConsistencyInput,
  DeckConsistencyOutput,
  ConsistencyIssue,
  FixSuggestion,
} from "./types/enhancement-types";

@Injectable()
export class DeckConsistencyAuditorSkill implements ISkill<
  DeckConsistencyInput,
  DeckConsistencyOutput
> {
  private readonly logger = new Logger(DeckConsistencyAuditorSkill.name);

  readonly id = "slides-deck-consistency-auditor";
  readonly name = "Deck Consistency Auditor";
  readonly description =
    "Audits slide deck for color, font, layout consistency and narrative flow";
  readonly layer: SkillLayer = SKILL_LAYERS.QUALITY;
  readonly domain = "slides";
  readonly tags = ["slides", "consistency", "audit", "deck"];
  readonly version = "1.0.0";

  async execute(
    input: DeckConsistencyInput,
    context: SkillContext,
  ): Promise<SkillResult<DeckConsistencyOutput>> {
    const startTime = new Date();

    try {
      if (!input.pages || input.pages.length === 0) {
        return {
          success: true,
          data: {
            passed: true,
            overallScore: 100,
            scores: {
              colorConsistency: 100,
              fontConsistency: 100,
              layoutDiversity: 100,
              narrativeFlow: 100,
            },
            issues: [],
            fixSuggestions: [],
          },
          metadata: {
            executionId: context.executionId,
            startTime,
            endTime: new Date(),
            duration: Date.now() - startTime.getTime(),
          },
        };
      }

      const theme = input.themeId ? getTheme(input.themeId) : null;
      const issues: ConsistencyIssue[] = [];
      const fixSuggestions: FixSuggestion[] = [];

      // Extract per-page data
      const pageData = input.pages.map((page) => ({
        pageNumber: page.pageNumber,
        templateType: page.templateType,
        title: page.title,
        ...this.extractStyleData(page.html),
      }));

      // 1. Color consistency check (30 points)
      const colorScore = this.checkColorConsistency(
        pageData,
        theme,
        issues,
        fixSuggestions,
      );

      // 2. Font consistency check (25 points)
      const fontScore = this.checkFontConsistency(
        pageData,
        issues,
        fixSuggestions,
      );

      // 3. Layout diversity check (25 points)
      const layoutScore = this.checkLayoutDiversity(pageData, issues);

      // 4. Narrative flow check (20 points)
      const narrativeScore = this.checkNarrativeFlow(pageData, issues);

      const overallScore = Math.round(
        colorScore * 0.3 +
          fontScore * 0.25 +
          layoutScore * 0.25 +
          narrativeScore * 0.2,
      );
      const passed = overallScore >= 70;

      this.logger.log(
        `[execute] Consistency audit: score=${overallScore}, passed=${passed}, ` +
          `color=${colorScore}, font=${fontScore}, layout=${layoutScore}, narrative=${narrativeScore}, ` +
          `issues=${issues.length}`,
      );

      return {
        success: true,
        data: {
          passed,
          overallScore,
          scores: {
            colorConsistency: colorScore,
            fontConsistency: fontScore,
            layoutDiversity: layoutScore,
            narrativeFlow: narrativeScore,
          },
          issues,
          fixSuggestions,
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
      this.logger.error(`[execute] Audit failed: ${errorMessage}`);

      return {
        success: false,
        error: {
          code: "CONSISTENCY_AUDIT_FAILED",
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
   * Extract style data from HTML using regex
   */
  private extractStyleData(html: string): {
    accentColors: string[];
    titleFontSize: number | null;
    titleFontWeight: number | null;
    backgroundColors: string[];
    borderRadius: string[];
    layoutSignature: string;
  } {
    // Extract hex colors from inline styles
    const hexColors = html.match(/#[0-9A-Fa-f]{6}/g) || [];
    const rgbColors = html.match(/rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)/g) || [];
    const allColors = [...hexColors, ...rgbColors];

    // Extract title font size (look for h1/h2 or large font-size near title areas)
    const titleFontMatch = html.match(
      /font-size:\s*(\d+)px[^>]*?(?:font-weight:\s*(\d+))?/,
    );
    const titleFontSize = titleFontMatch
      ? parseInt(titleFontMatch[1], 10)
      : null;
    const titleFontWeight = titleFontMatch?.[2]
      ? parseInt(titleFontMatch[2], 10)
      : null;

    // Extract background colors
    const bgColors =
      html
        .match(/background(?:-color)?:\s*(#[0-9A-Fa-f]{6})/g)
        ?.map((m) => m.match(/#[0-9A-Fa-f]{6}/)?.[0] || "") || [];

    // Extract border-radius values
    const borderRadius =
      html
        .match(/border-radius:\s*(\d+px)/g)
        ?.map((m) => m.replace("border-radius:", "").trim()) || [];

    // Generate a simple layout signature based on HTML structure
    const divCount = (html.match(/<div/g) || []).length;
    const hasGrid = html.includes("grid");
    const hasFlex = html.includes("flex");
    const hasColumns = html.includes("column");
    const layoutSignature = `d${divCount}-${hasGrid ? "g" : ""}${hasFlex ? "f" : ""}${hasColumns ? "c" : ""}`;

    return {
      accentColors: [...new Set(allColors)],
      titleFontSize,
      titleFontWeight,
      backgroundColors: bgColors,
      borderRadius: [...new Set(borderRadius)],
      layoutSignature,
    };
  }

  /**
   * Check color consistency across pages
   */
  private checkColorConsistency(
    pages: Array<{
      pageNumber: number;
      accentColors: string[];
      backgroundColors: string[];
    }>,
    theme: ReturnType<typeof getTheme> | null,
    issues: ConsistencyIssue[],
    fixSuggestions: FixSuggestion[],
  ): number {
    let score = 100;

    if (!theme || pages.length < 2) return score;

    const themeColors = new Set(
      [
        theme.colors.accent.primary.toLowerCase(),
        theme.colors.accent.secondary.toLowerCase(),
        theme.colors.accent.tertiary?.toLowerCase(),
        theme.colors.background.primary.toLowerCase(),
        theme.colors.background.secondary.toLowerCase(),
        theme.colors.text.primary.toLowerCase(),
        theme.colors.text.secondary.toLowerCase(),
        theme.colors.card.border.toLowerCase(),
        theme.colors.functional.success.toLowerCase(),
        theme.colors.functional.warning.toLowerCase(),
        theme.colors.functional.error.toLowerCase(),
        theme.colors.functional.info.toLowerCase(),
      ].filter(Boolean) as string[],
    );

    // Check each page for off-theme colors
    for (const page of pages) {
      const offThemeColors = page.accentColors.filter((c) => {
        const lower = c.toLowerCase();
        // Skip common neutrals (black, white, grays)
        if (
          lower === "#000000" ||
          lower === "#ffffff" ||
          lower.match(/^#[0-9a-f]{6}$/) === null
        ) {
          return false;
        }
        const r = parseInt(lower.slice(1, 3), 16);
        const g = parseInt(lower.slice(3, 5), 16);
        const b = parseInt(lower.slice(5, 7), 16);
        // Skip near-white and near-black (neutrals)
        if (r > 200 && g > 200 && b > 200) return false;
        if (r < 40 && g < 40 && b < 40) return false;

        return !themeColors.has(lower);
      });

      if (offThemeColors.length > 3) {
        score -= 15;
        issues.push({
          type: "color_drift",
          severity: "warning",
          message: `Page ${page.pageNumber} has ${offThemeColors.length} colors not in theme palette`,
          pages: [page.pageNumber],
          suggestion: `Use theme accent colors: ${theme.colors.accent.primary}, ${theme.colors.accent.secondary}`,
        });
        fixSuggestions.push({
          pageNumber: page.pageNumber,
          type: "color_drift",
          description: "Replace off-theme colors with theme palette",
          expectedValue: theme.colors.accent.primary,
        });
      }
    }

    return Math.max(0, score);
  }

  /**
   * Check font consistency across content pages
   */
  private checkFontConsistency(
    pages: Array<{
      pageNumber: number;
      templateType: string;
      titleFontSize: number | null;
      titleFontWeight: number | null;
    }>,
    issues: ConsistencyIssue[],
    fixSuggestions: FixSuggestion[],
  ): number {
    let score = 100;

    // Filter to content pages only (skip cover, toc, closing)
    const contentPages = pages.filter(
      (p) =>
        p.templateType !== "cover" &&
        p.templateType !== "toc" &&
        p.templateType !== "closing" &&
        p.templateType !== "chapterTitle" &&
        p.titleFontSize !== null,
    );

    if (contentPages.length < 2) return score;

    // Check title font size consistency (tolerance ±2px)
    const fontSizes = contentPages
      .map((p) => p.titleFontSize)
      .filter((s): s is number => s !== null);

    if (fontSizes.length >= 2) {
      const median = fontSizes.sort((a, b) => a - b)[
        Math.floor(fontSizes.length / 2)
      ];

      const driftPages = contentPages.filter(
        (p) =>
          p.titleFontSize !== null && Math.abs(p.titleFontSize - median) > 2,
      );

      if (driftPages.length > 0) {
        score -= driftPages.length * 10;
        issues.push({
          type: "font_drift",
          severity: "warning",
          message: `Title font size varies across content pages (median: ${median}px, drifting pages: ${driftPages.map((p) => p.pageNumber).join(", ")})`,
          pages: driftPages.map((p) => p.pageNumber),
          suggestion: `Standardize content page title font-size to ${median}px`,
        });

        for (const p of driftPages) {
          fixSuggestions.push({
            pageNumber: p.pageNumber,
            type: "font_drift",
            description: `Title font-size is ${p.titleFontSize}px, expected ~${median}px`,
            cssProperty: "font-size",
            expectedValue: `${median}px`,
            actualValue: `${p.titleFontSize}px`,
          });
        }
      }
    }

    return Math.max(0, score);
  }

  /**
   * Check layout diversity (adjacent pages should not repeat)
   */
  private checkLayoutDiversity(
    pages: Array<{
      pageNumber: number;
      templateType: string;
      layoutSignature: string;
    }>,
    issues: ConsistencyIssue[],
  ): number {
    let score = 100;

    if (pages.length < 3) return score;

    // Check adjacent pages for identical layout signatures
    let consecutiveRepeats = 0;
    for (let i = 1; i < pages.length; i++) {
      if (
        pages[i].layoutSignature === pages[i - 1].layoutSignature &&
        pages[i].templateType === pages[i - 1].templateType
      ) {
        consecutiveRepeats++;
      }
    }

    if (consecutiveRepeats > 1) {
      score -= consecutiveRepeats * 10;
      issues.push({
        type: "layout_repetition",
        severity: "warning",
        message: `${consecutiveRepeats} pairs of adjacent pages use identical layouts`,
        pages: [],
        suggestion:
          "Vary page layouts for visual interest — alternate between grid, split, centered layouts",
      });
    }

    // Check template type diversity
    const templateTypes = pages.map((p) => p.templateType);
    const uniqueTypes = new Set(templateTypes);
    if (pages.length > 5 && uniqueTypes.size < 3) {
      score -= 15;
      issues.push({
        type: "layout_repetition",
        severity: "info",
        message: `Only ${uniqueTypes.size} unique template types across ${pages.length} pages`,
        pages: [],
        suggestion: "Use more diverse page types for visual variety",
      });
    }

    return Math.max(0, score);
  }

  /**
   * Check narrative flow (cover at start, closing at end)
   */
  private checkNarrativeFlow(
    pages: Array<{
      pageNumber: number;
      templateType: string;
    }>,
    issues: ConsistencyIssue[],
  ): number {
    let score = 100;

    if (pages.length === 0) return score;

    // Cover should be first page
    if (pages[0].templateType !== "cover") {
      score -= 20;
      issues.push({
        type: "narrative_flow",
        severity: "warning",
        message: "First page is not a cover slide",
        pages: [pages[0].pageNumber],
        suggestion: "Ensure the first page uses a cover template",
      });
    }

    // Closing should be last page
    const lastPage = pages[pages.length - 1];
    if (
      lastPage.templateType !== "closing" &&
      lastPage.templateType !== "recommendations"
    ) {
      score -= 10;
      issues.push({
        type: "narrative_flow",
        severity: "info",
        message: "Last page is not a closing or recommendations slide",
        pages: [lastPage.pageNumber],
        suggestion: "End with a closing or recommendations slide",
      });
    }

    return Math.max(0, score);
  }
}

/**
 * Design Token Injector Skill (P0)
 *
 * Flattens ThemeConfig from themes.ts into compact design tokens
 * and generates a prompt fragment to replace the hardcoded
 * "Adaptive Color System" section in the system prompt.
 *
 * - No LLM calls (pure computation)
 * - No DI dependencies
 * - Ensures themes.ts is the single source of truth for colors
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
  CompactDesignTokens,
  DesignTokenInjectorInput,
  DesignTokenInjectorOutput,
} from "./types/enhancement-types";

@Injectable()
export class DesignTokenInjectorSkill implements ISkill<
  DesignTokenInjectorInput,
  DesignTokenInjectorOutput
> {
  private readonly logger = new Logger(DesignTokenInjectorSkill.name);

  readonly id = "slides-design-token-injector";
  readonly name = "Design Token Injector";
  readonly description =
    "Flattens theme config into compact design tokens for AI prompt injection";
  readonly layer: SkillLayer = SKILL_LAYERS.DESIGN;
  readonly domain = "slides";
  readonly tags = ["slides", "design", "theme", "tokens"];
  readonly version = "1.0.0";

  async execute(
    input: DesignTokenInjectorInput,
    context: SkillContext,
  ): Promise<SkillResult<DesignTokenInjectorOutput>> {
    const startTime = new Date();

    try {
      const theme = getTheme(input.themeId);
      this.logger.log(
        `[execute] Generating tokens for theme: ${theme.id} (${theme.name})`,
      );

      const tokens = this.flattenToCompactTokens(theme);
      const promptFragment = this.generatePromptFragment(tokens);

      return {
        success: true,
        data: { tokens, promptFragment },
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
      this.logger.error(`[execute] Failed: ${errorMessage}`);

      return {
        success: false,
        error: {
          code: "TOKEN_INJECTION_FAILED",
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
   * Flatten ThemeConfig to CompactDesignTokens
   */
  private flattenToCompactTokens(
    theme: ReturnType<typeof getTheme>,
  ): CompactDesignTokens {
    return {
      themeId: theme.id,
      themeName: theme.name,
      background: {
        primary: theme.colors.background.primary,
        secondary: theme.colors.background.secondary,
        gradient: theme.colors.background.gradient,
      },
      accent: {
        primary: theme.colors.accent.primary,
        secondary: theme.colors.accent.secondary,
        tertiary: theme.colors.accent.tertiary,
      },
      text: {
        primary: theme.colors.text.primary,
        secondary: theme.colors.text.secondary,
        muted: theme.colors.text.muted,
      },
      card: {
        background: theme.colors.card.background,
        border: theme.colors.card.border,
      },
      effects: {
        borderRadius: theme.effects.borderRadius,
        cardShadow: theme.effects.cardShadow,
      },
      fontFamily: theme.typography.fontFamily,
    };
  }

  /**
   * Generate prompt fragment that replaces "Adaptive Color System" section
   */
  private generatePromptFragment(tokens: CompactDesignTokens): string {
    const isDark = this.isDarkTheme(tokens.background.primary);

    return `## Theme Design Tokens (${tokens.themeName})

Use EXACTLY these colors — do NOT deviate or improvise:

**Backgrounds:**
- Dark/Cover: ${tokens.background.primary}
- Secondary: ${tokens.background.secondary}
- Light/Content: ${isDark ? "#F8FAFC" : tokens.background.primary}
- Gradient: ${tokens.background.gradient}

**Accent Colors (use for icons, KPI numbers, borders, highlights):**
- Primary Accent: ${tokens.accent.primary}
- Secondary Accent: ${tokens.accent.secondary}${tokens.accent.tertiary ? `\n- Tertiary Accent: ${tokens.accent.tertiary}` : ""}

**Text Colors:**
- Primary: ${tokens.text.primary}
- Secondary: ${tokens.text.secondary}
- Muted: ${tokens.text.muted}
- Text on dark backgrounds: #FFFFFF
- Text on light backgrounds: #1A1A2E

**Card Styles:**
- Card background: ${isDark ? "#FFFFFF" : tokens.card.background}
- Card border: ${tokens.card.border}
- Card shadow: ${tokens.effects.cardShadow}
- Border radius: ${tokens.effects.borderRadius}

**Font Family:** ${tokens.fontFamily}

**Guidelines:**
- Cover and Closing pages: use dark background (${tokens.background.primary}) with accent highlights
- Content pages: use light backgrounds for readability
- Use Primary Accent (${tokens.accent.primary}) for main highlights, icons, KPI numbers
- Use Secondary Accent (${tokens.accent.secondary}) for contrast panels, secondary categories
- Maintain consistent color usage across all slides — every accent color MUST come from this list`;
  }

  /**
   * Detect if a hex color is dark (for choosing content page background)
   */
  private isDarkTheme(bgColor: string): boolean {
    const hex = bgColor.replace("#", "");
    if (hex.length < 6) return true;
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance < 0.5;
  }
}

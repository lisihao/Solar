import { Logger } from "@nestjs/common";
import { InfographicContent, InfographicStyle } from "../infographic.types";
import {
  STYLE_PRESETS,
  FONT_STYLES,
  CARD_GRADIENTS,
} from "../infographic.constants";
import {
  escapeHtml,
  truncateText,
  adjustColor,
  getIcon,
} from "../infographic.utils";
import { APP_CONFIG } from "../../../../../common/config/app.config";

/**
 * Base helper class for all infographic templates
 * Provides common configuration and utility methods
 */
export class TemplateBaseHelper {
  protected readonly logger = new Logger(TemplateBaseHelper.name);

  /**
   * Get style configuration for content
   */
  protected getStyleConfig(content: InfographicContent) {
    const styleKey = content.styleOptions?.style || "consulting";
    const stylePreset = STYLE_PRESETS[styleKey] || STYLE_PRESETS.consulting;

    const colors = {
      primary: content.colorScheme?.primary || stylePreset.colors.primary,
      accent: content.colorScheme?.accent || stylePreset.colors.accent,
      background:
        content.colorScheme?.background || stylePreset.colors.background,
      text: content.colorScheme?.text || stylePreset.colors.text,
    };

    const fontStyle = content.styleOptions?.fontStyle || "sans";
    const fontFamily = FONT_STYLES[fontStyle] || FONT_STYLES.sans;

    const borderRadiusMap = { none: 0, small: 4, medium: 12, large: 24 };
    const baseBorderRadius =
      borderRadiusMap[content.styleOptions?.borderRadius || "medium"] ||
      stylePreset.borderRadius;

    const shadowMap = {
      none: "none",
      subtle: "0 1px 3px rgba(0,0,0,0.05)",
      medium: "0 2px 8px rgba(0,0,0,0.08)",
      strong: "0 8px 30px rgba(0,0,0,0.15)",
    };
    const boxShadow =
      shadowMap[content.styleOptions?.shadowStyle || "medium"] ||
      stylePreset.shadow;

    const isDarkMode =
      styleKey === "dark" ||
      styleKey === "genspark" ||
      styleKey === "tech_gradient";

    const isGlassmorphism =
      styleKey === "genspark" || styleKey === "tech_gradient";

    return {
      styleKey,
      stylePreset,
      colors,
      fontFamily,
      baseBorderRadius,
      boxShadow,
      isDarkMode,
      isGlassmorphism,
    };
  }

  /**
   * Get background style CSS
   */
  protected getBackgroundStyle(
    styleKey: InfographicStyle,
    colors: Record<string, string | string[]>,
    isDarkMode: boolean,
    backgroundImageBase64?: string,
  ): string {
    const overlayColor = isDarkMode
      ? "rgba(15, 23, 42, 0.92)"
      : "rgba(247, 249, 252, 0.92)";

    const gensparkGradientBg =
      styleKey === "genspark"
        ? `linear-gradient(135deg, #0A2B4E 0%, #0F3460 50%, #16213E 100%)`
        : styleKey === "tech_gradient"
          ? `linear-gradient(135deg, #0F172A 0%, #1E1B4B 50%, #0F172A 100%)`
          : null;

    if (backgroundImageBase64) {
      return `background-image: linear-gradient(${overlayColor}, ${overlayColor}), url(${backgroundImageBase64});
         background-size: cover;
         background-position: center;`;
    } else if (gensparkGradientBg) {
      return `background: ${gensparkGradientBg};`;
    } else {
      return `background: ${colors.background};`;
    }
  }

  /**
   * Calculate responsive scale values
   */
  protected calculateScale(width: number, height: number) {
    const aspectRatio = width / height;
    const scale = width / 1200;
    const isWideScreen = aspectRatio >= 1.5;
    const isVertical = height > width;

    return {
      scale,
      aspectRatio,
      isWideScreen,
      isVertical,
    };
  }

  /**
   * Get common constants
   */
  protected getConstants() {
    return {
      CARD_GRADIENTS,
    };
  }

  /**
   * Get brand configuration
   */
  protected getBrand() {
    return {
      name: APP_CONFIG.brand.name,
      fullName: APP_CONFIG.brand.fullName,
    };
  }

  /**
   * Utility functions exposed for templates
   */
  protected utils = {
    escapeHtml,
    truncateText,
    adjustColor,
    getIcon,
  };
}

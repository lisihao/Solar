/**
 * Slides Engine v3.0 - Template Library
 *
 * 模板库入口文件，统一导出所有模板和注册器
 * 包含 32+ 专业 HTML 模板
 */

// ============================================================================
// Re-export Base Components
// ============================================================================

export {
  templateRegistry,
  applyVariables,
  getFullHtml,
  type TemplateMetadata,
  type SlideTemplate,
  type TemplateSelectionCriteria,
  type TemplateTone,
  type PositionFit,
  type TemplateCompatibility,
} from "./base/template-registry";

export {
  COMMON_CONTAINER,
  CARD_STYLE,
  CARD_STYLE_HIGHLIGHT,
  STAT_LARGE,
  STAT_MEDIUM,
  TITLE_STYLE,
  SUBTITLE_STYLE,
  FOOTER_STYLE,
  COLORS,
  GRADIENTS,
} from "./base/common-styles";

// ============================================================================
// Theme and Decoration Systems (v3.1)
// ============================================================================

export {
  // Theme system
  THEMES,
  getTheme,
  getAllThemes,
  getThemeIds,
  generateThemeCSS,
  generateThemeCSSVariables,
  getThemeContainerStyle,
  getThemeCardStyle,
  getThemeDecorationHtml,
  getHeadingStyle,
  getBodyStyle,
  getStatStyle,
  getAccentColors,
  getAccentColorByIndex,
  type ThemeConfig,
  type ThemeColors,
  type ThemeTypography,
  // Decoration system
  DECORATION_PRESETS,
  generateDecorationCSS,
  generateDecorationHtml,
  getDecorationPreset,
  getCornerAccentInlineStyle,
  getGradientBarInlineStyle,
  getStatGlowInlineStyle,
  getCardGlowInlineStyle,
  type DecorationConfig,
  type CornerAccentConfig,
  type GlowEffectConfig,
  type GradientBarConfig,
  type GeometricShapeConfig,
  // Animation system
  ANIMATIONS,
  getAnimationCSS,
  // Layout helpers
  TYPOGRAPHY_ENHANCED,
  GRID,
  LAYOUT,
  selectGridLayout,
} from "./base/design-tokens";

// ============================================================================
// Import All Template Categories
// ============================================================================

import { STRUCTURAL_TEMPLATES } from "./categories/structural.templates";
import { DATA_TEMPLATES } from "./categories/data.templates";
import { CONTENT_TEMPLATES } from "./categories/content.templates";
import { ACTION_TEMPLATES } from "./categories/action.templates";
import { NARRATIVE_TEMPLATES } from "./categories/narrative.templates";
import { templateRegistry, SlideTemplate } from "./base/template-registry";

// ============================================================================
// Register All Templates
// ============================================================================

// Combine all templates
const ALL_TEMPLATES: SlideTemplate[] = [
  ...NARRATIVE_TEMPLATES, // cover/closing/toc 等核心叙事模板
  ...STRUCTURAL_TEMPLATES,
  ...DATA_TEMPLATES,
  ...CONTENT_TEMPLATES,
  ...ACTION_TEMPLATES,
];

// Register each template
for (const template of ALL_TEMPLATES) {
  templateRegistry.register(template);
}

// ============================================================================
// Re-export Template Arrays for Direct Access
// ============================================================================

export { NARRATIVE_TEMPLATES } from "./categories/narrative.templates";
export { STRUCTURAL_TEMPLATES } from "./categories/structural.templates";
export { DATA_TEMPLATES } from "./categories/data.templates";
export { CONTENT_TEMPLATES } from "./categories/content.templates";
export { ACTION_TEMPLATES } from "./categories/action.templates";

// ============================================================================
// Convenience Functions
// ============================================================================

import { PageTemplateType } from "../checkpoint/checkpoint.types";

/**
 * 获取指定类型的第一个匹配模板（兼容旧接口）
 */
export function getTemplate(type: PageTemplateType): SlideTemplate {
  const templates = templateRegistry.getByType(type);
  if (templates.length > 0) {
    return templates[0];
  }
  // 返回默认模板
  const allTemplates = templateRegistry.getAll();
  return allTemplates[0];
}

/**
 * 获取指定类型的所有模板
 */
export function getTemplatesByType(type: PageTemplateType): SlideTemplate[] {
  return templateRegistry.getByType(type);
}

/**
 * 获取指定 ID 的模板
 */
export function getTemplateById(id: string): SlideTemplate | undefined {
  return templateRegistry.get(id);
}

/**
 * 获取所有已注册的模板
 */
export function getAllTemplates(): SlideTemplate[] {
  return templateRegistry.getAll();
}

/**
 * 获取模板统计信息
 */
export function getTemplateStats(): {
  total: number;
  byType: Record<string, number>;
  byTone: Record<string, number>;
  byDensity: Record<string, number>;
} {
  const templates = templateRegistry.getAll();

  const byType: Record<string, number> = {};
  const byTone: Record<string, number> = {};
  const byDensity: Record<string, number> = {};

  for (const template of templates) {
    const { type, tone, contentDensity } = template.metadata;

    byType[type] = (byType[type] || 0) + 1;
    byTone[tone] = (byTone[tone] || 0) + 1;
    byDensity[contentDensity] = (byDensity[contentDensity] || 0) + 1;
  }

  return {
    total: templates.length,
    byType,
    byTone,
    byDensity,
  };
}

// ============================================================================
// Template Library Info
// ============================================================================

/**
 * 模板库版本信息
 */
export const TEMPLATE_LIBRARY_INFO = {
  version: "3.0.0",
  totalTemplates: ALL_TEMPLATES.length,
  categories: {
    narrative: NARRATIVE_TEMPLATES.length,
    structural: STRUCTURAL_TEMPLATES.length,
    data: DATA_TEMPLATES.length,
    content: CONTENT_TEMPLATES.length,
    action: ACTION_TEMPLATES.length,
  },
  lastUpdated: "2024-12-30",
};

// Log registration summary in development
if (process.env.NODE_ENV !== "production") {
  // Use dynamic import to avoid type issues with Logger in module scope
  const { Logger } = require("@nestjs/common");
  const logger = new Logger("TemplateLibrary");
  logger.log(
    `Registered ${ALL_TEMPLATES.length} templates: ` +
      `Narrative(${NARRATIVE_TEMPLATES.length}), ` +
      `Structural(${STRUCTURAL_TEMPLATES.length}), ` +
      `Data(${DATA_TEMPLATES.length}), ` +
      `Content(${CONTENT_TEMPLATES.length}), ` +
      `Action(${ACTION_TEMPLATES.length})`,
  );
}

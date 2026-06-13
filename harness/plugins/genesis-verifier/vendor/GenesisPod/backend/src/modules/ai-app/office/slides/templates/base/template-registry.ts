/**
 * Slides Engine v3.0 - Template Registry
 *
 * 模板注册器 - 管理所有可用模板，支持智能选择
 */

import { PageTemplateType } from "../../checkpoint/checkpoint.types";

// ============================================================================
// Template Metadata Interface
// ============================================================================

/**
 * 模板情感基调
 */
export type TemplateTone =
  | "positive"
  | "neutral"
  | "analytical"
  | "warning"
  | "inspiring";

/**
 * 位置适配度配置
 */
export interface PositionFit {
  /** 适合开头 (0-1) */
  opening: number;
  /** 适合中间 (0-1) */
  middle: number;
  /** 适合结尾 (0-1) */
  closing: number;
}

/**
 * 模板兼容性配置
 */
export interface TemplateCompatibility {
  /** 此模板前推荐的模板 ID */
  goodBefore: string[];
  /** 此模板后推荐的模板 ID */
  goodAfter: string[];
  /** 避免相邻的模板 ID */
  avoidNear: string[];
}

/**
 * 模板元数据 - 用于智能选择和匹配
 */
export interface TemplateMetadata {
  /** 模板唯一标识 */
  id: string;

  /** 模板类型 */
  type: PageTemplateType;

  /** 模板名称 */
  name: string;

  /** 模板描述 */
  description: string;

  /** 适用场景 */
  useCases: string[];

  /** 内容密度: low(简洁) | medium(适中) | high(丰富) */
  contentDensity: "low" | "medium" | "high";

  /** 视觉风格: professional(专业) | creative(创意) | data-driven(数据驱动) */
  visualStyle: "professional" | "creative" | "data-driven";

  /** 推荐内容类型 */
  recommendedFor: string[];

  /** 最大内容块数量 */
  maxContentBlocks: number;

  /** 支持的变量列表 */
  variables: string[];

  // ========== v3.0 新增字段 ==========

  /** 语义匹配关键词 */
  keywords: string[];

  /** 位置适配度 (0-1) */
  positionFit: PositionFit;

  /** 上下文兼容性 */
  compatibility: TemplateCompatibility;

  /** 情感基调 */
  tone: TemplateTone;
}

/**
 * 完整模板定义
 */
export interface SlideTemplate {
  /** 元数据 */
  metadata: TemplateMetadata;

  /** HTML 模板内容 */
  html: string;

  /** 可选的脚本（如 ECharts） */
  script?: string;
}

// ============================================================================
// Template Registry
// ============================================================================

class TemplateRegistry {
  private templates: Map<string, SlideTemplate> = new Map();
  private typeIndex: Map<PageTemplateType, string[]> = new Map();

  /**
   * 注册模板
   */
  register(template: SlideTemplate): void {
    const { id, type } = template.metadata;

    // 注册到主映射
    this.templates.set(id, template);

    // 更新类型索引
    const typeTemplates = this.typeIndex.get(type) || [];
    if (!typeTemplates.includes(id)) {
      typeTemplates.push(id);
      this.typeIndex.set(type, typeTemplates);
    }
  }

  /**
   * 获取指定 ID 的模板
   */
  get(id: string): SlideTemplate | undefined {
    return this.templates.get(id);
  }

  /**
   * 获取指定类型的所有模板
   */
  getByType(type: PageTemplateType): SlideTemplate[] {
    const ids = this.typeIndex.get(type) || [];
    return ids.map((id) => this.templates.get(id)!).filter(Boolean);
  }

  /**
   * 智能选择最佳模板
   */
  selectBest(criteria: TemplateSelectionCriteria): SlideTemplate | null {
    const candidates = this.getByType(criteria.type);

    if (candidates.length === 0) {
      return null;
    }

    if (candidates.length === 1) {
      return candidates[0];
    }

    // 评分选择
    let bestTemplate = candidates[0];
    let bestScore = 0;

    for (const template of candidates) {
      const score = this.calculateMatchScore(template, criteria);
      if (score > bestScore) {
        bestScore = score;
        bestTemplate = template;
      }
    }

    return bestTemplate;
  }

  /**
   * 计算模板匹配分数
   */
  private calculateMatchScore(
    template: SlideTemplate,
    criteria: TemplateSelectionCriteria,
  ): number {
    let score = 0;
    const meta = template.metadata;

    // 内容密度匹配 (+10)
    if (
      criteria.contentDensity &&
      meta.contentDensity === criteria.contentDensity
    ) {
      score += 10;
    }

    // 视觉风格匹配 (+10)
    if (criteria.visualStyle && meta.visualStyle === criteria.visualStyle) {
      score += 10;
    }

    // 使用场景匹配 (+5 per match)
    if (criteria.useCase) {
      for (const uc of meta.useCases) {
        if (uc.toLowerCase().includes(criteria.useCase.toLowerCase())) {
          score += 5;
        }
      }
    }

    // 内容块数量适配 (+5)
    if (
      criteria.contentBlockCount &&
      criteria.contentBlockCount <= meta.maxContentBlocks
    ) {
      score += 5;
    }

    return score;
  }

  /**
   * 获取所有已注册的模板
   */
  getAll(): SlideTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * 获取所有可用类型
   */
  getAvailableTypes(): PageTemplateType[] {
    return Array.from(this.typeIndex.keys());
  }
}

/**
 * 模板选择条件
 */
export interface TemplateSelectionCriteria {
  /** 模板类型（必需） */
  type: PageTemplateType;

  /** 内容密度偏好 */
  contentDensity?: "low" | "medium" | "high";

  /** 视觉风格偏好 */
  visualStyle?: "professional" | "creative" | "data-driven";

  /** 使用场景描述 */
  useCase?: string;

  /** 内容块数量 */
  contentBlockCount?: number;
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const templateRegistry = new TemplateRegistry();

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * 替换模板变量
 * 增强版：处理未提供的变量，防止 {{VAR}} 直接暴露给用户
 */
export function applyVariables(
  template: SlideTemplate,
  variables: Record<string, string>,
): string {
  let html = template.html;

  // 1. 替换所有提供的变量
  for (const [key, value] of Object.entries(variables)) {
    html = html.replace(new RegExp(`{{${key}}}`, "g"), value);
  }

  // 2. 检测并处理未替换的变量（防止 {{VAR}} 暴露给用户）
  const unreplacedPattern = /\{\{(\w+)\}\}/g;
  const unreplacedVars: string[] = [];
  let match;
  while ((match = unreplacedPattern.exec(html)) !== null) {
    unreplacedVars.push(match[1]);
  }

  if (unreplacedVars.length > 0) {
    // 使用智能降级策略替换未匹配的变量
    html = html.replace(unreplacedPattern, (_match, varName: string) => {
      return getFallbackValue(varName);
    });
  }

  return html;
}

/**
 * 获取变量的降级值
 * 根据变量名模式推断合理的默认值
 */
function getFallbackValue(varName: string): string {
  // TITLE 类变量
  if (varName.includes("TITLE")) {
    const numMatch = varName.match(/(\d+)/);
    if (numMatch) {
      return `要点 ${numMatch[1]}`;
    }
    return "核心要点";
  }

  // DESC/DESCRIPTION 类变量
  if (varName.includes("DESC")) {
    return "详细说明请参考源文档";
  }

  // VALUE/STAT/NUMBER 类变量
  if (
    varName.includes("VALUE") ||
    varName.includes("STAT") ||
    varName.includes("NUMBER")
  ) {
    return "—";
  }

  // LABEL 类变量
  if (varName.includes("LABEL")) {
    return "指标";
  }

  // CHANGE 类变量
  if (varName.includes("CHANGE")) {
    return "—";
  }

  // DATE 类变量
  if (varName.includes("DATE")) {
    return new Date().toLocaleDateString("zh-CN");
  }

  // ICON 类变量
  if (varName.includes("ICON")) {
    return "●";
  }

  // 默认：返回短划线，表示数据待补充
  return "—";
}

/**
 * 获取模板的完整 HTML（包含脚本）
 */
export function getFullHtml(template: SlideTemplate): string {
  if (template.script) {
    return `${template.html}\n<script>\n${template.script}\n</script>`;
  }
  return template.html;
}

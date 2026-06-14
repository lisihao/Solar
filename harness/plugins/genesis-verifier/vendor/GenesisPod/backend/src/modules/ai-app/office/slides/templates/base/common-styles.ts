/**
 * Slides Engine v3.0 - Common Styles
 *
 * 共享样式常量，用于所有模板
 * 设计原则：不同类型的页面应该有明显的视觉差异
 */

// ============================================================================
// Container Styles - 差异化背景
// ============================================================================

/** 通用字体栈 (包含 emoji 支持) */
export const FONT_STACK =
  "'Noto Sans SC', 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif";

/** 标准内容页容器 - 深蓝渐变 (含安全边距) */
export const COMMON_CONTAINER = `
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, #0F172A 0%, #1E293B 100%);
  font-family: ${FONT_STACK};
  color: #F8FAFC;
  padding: 50px 80px 80px 80px;
  box-sizing: border-box;
  position: relative;
  overflow: hidden;
`;

/** 封面页容器 - 深色 + 金色装饰 (含安全边距) */
export const COVER_CONTAINER = `
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 50%, #16213e 100%);
  font-family: ${FONT_STACK};
  color: #F8FAFC;
  padding: 60px 80px 80px 80px;
  box-sizing: border-box;
  position: relative;
  overflow: hidden;
`;

/** 数据页容器 - 深灰专业风 (含安全边距) */
export const DATA_CONTAINER = `
  width: 100%;
  height: 100%;
  background: linear-gradient(180deg, #111827 0%, #1F2937 100%);
  font-family: ${FONT_STACK};
  color: #F8FAFC;
  padding: 50px 80px 80px 80px;
  box-sizing: border-box;
  position: relative;
  overflow: hidden;
`;

/** 对比页容器 - 分割式设计 (含安全边距) */
export const COMPARISON_CONTAINER = `
  width: 100%;
  height: 100%;
  background: #0F172A;
  font-family: ${FONT_STACK};
  color: #F8FAFC;
  padding: 50px 80px 80px 80px;
  box-sizing: border-box;
  position: relative;
  overflow: hidden;
`;

/** 结论页容器 - 渐变强调 (含安全边距) */
export const CONCLUSION_CONTAINER = `
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, #1E3A5F 0%, #0F172A 50%, #1E293B 100%);
  font-family: ${FONT_STACK};
  color: #F8FAFC;
  padding: 50px 80px 80px 80px;
  box-sizing: border-box;
  position: relative;
  overflow: hidden;
`;

// ============================================================================
// Card Styles
// ============================================================================

export const CARD_STYLE = `
  background: rgba(30, 41, 59, 0.8);
  border: 1px solid #334155;
  border-radius: 12px;
  padding: 24px;
  overflow: hidden;
  min-height: 0;
`;

export const CARD_STYLE_HIGHLIGHT = `
  background: rgba(30, 41, 59, 0.8);
  border: 1px solid #D4AF37;
  border-radius: 12px;
  padding: 24px;
  overflow: hidden;
  min-height: 0;
`;

// ============================================================================
// Typography Styles
// ============================================================================

export const STAT_LARGE = `
  font-size: 56px;
  font-weight: 900;
  color: #D4AF37;
  line-height: 1;
`;

export const STAT_MEDIUM = `
  font-size: 32px;
  font-weight: 900;
  color: #3B82F6;
  line-height: 1;
`;

export const TITLE_STYLE = `
  font-size: 36px;
  font-weight: 900;
  margin: 0 0 8px 0;
`;

export const SUBTITLE_STYLE = `
  font-size: 18px;
  color: #94A3B8;
  margin: 0 0 32px 0;
`;

// ============================================================================
// Footer Styles
// ============================================================================

export const FOOTER_STYLE = `
  position: absolute;
  bottom: 24px;
  left: 80px;
  right: 80px;
  font-size: 12px;
  color: #64748B;
`;

// ============================================================================
// Color Constants
// ============================================================================

export const COLORS = {
  primary: "#D4AF37",
  secondary: "#3B82F6",
  success: "#10B981",
  warning: "#F59E0B",
  danger: "#EF4444",
  purple: "#8B5CF6",
  text: "#F8FAFC",
  textMuted: "#94A3B8",
  textDim: "#64748B",
  border: "#334155",
  background: "#0F172A",
  backgroundLight: "#1E293B",
};

// ============================================================================
// Gradient Constants
// ============================================================================

export const GRADIENTS = {
  primary: "linear-gradient(90deg, #D4AF37, #3B82F6)",
  rainbow: "linear-gradient(90deg, #D4AF37, #3B82F6, #10B981, #8B5CF6)",
  gold: "linear-gradient(135deg, #D4AF37, #B8962E)",
  blue: "linear-gradient(135deg, #3B82F6, #2563EB)",
  green: "linear-gradient(135deg, #10B981, #059669)",
};

// ============================================================================
// Text Overflow Styles (防止文字溢出)
// ============================================================================

export const TEXT_TRUNCATE = `
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const TEXT_CLAMP_2 = `
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
`;

export const TEXT_CLAMP_3 = `
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
`;

export const TEXT_CLAMP_4 = `
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
`;

// ============================================================================
// Content Container Styles (内容容器样式)
// ============================================================================

export const CONTENT_CONTAINER = `
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
  flex: 1;
`;

export const FLEX_ROW_CONTAINER = `
  display: flex;
  gap: 24px;
  overflow: hidden;
  min-height: 0;
`;

export const GRID_CONTAINER = `
  display: grid;
  gap: 24px;
  overflow: hidden;
  min-height: 0;
`;

// ============================================================================
// Visual Enhancement Styles v3.1 (视觉增强样式)
// ============================================================================

/** 金色装饰竖条 - 用于标题左侧 */
export const ACCENT_BAR_TITLE = `
  position: absolute;
  left: 60px;
  width: 5px;
  height: 40px;
  background: linear-gradient(180deg, #D4AF37 0%, #B8962E 100%);
  border-radius: 3px;
`;

/** 金色装饰竖条 - 用于卡片左侧 */
export const ACCENT_BAR_CARD = `
  position: absolute;
  left: 0;
  top: 0;
  width: 4px;
  height: 100%;
  background: linear-gradient(180deg, #D4AF37 0%, #B8962E 100%);
  border-radius: 4px 0 0 4px;
`;

/** 透明边框装饰框 */
export const TRANSPARENT_BORDER_BOX = `
  position: absolute;
  width: 120px;
  height: 120px;
  border: 2px solid rgba(212, 175, 55, 0.3);
  pointer-events: none;
`;

/** 章节分隔页大号数字样式 */
export const CHAPTER_NUMBER_GIANT = `
  font-size: 180px;
  font-weight: 900;
  color: rgba(100, 116, 139, 0.15);
  line-height: 1;
  position: absolute;
`;

/** 章节分隔页居中数字样式 (更突出) */
export const CHAPTER_NUMBER_CENTERED = `
  font-size: 135px;
  font-weight: 900;
  background: linear-gradient(180deg, #F8FAFC 0%, #64748B 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  line-height: 1;
`;

/** 洞察框样式 - 底部位置 */
export const INSIGHT_BOX_STYLE = `
  position: absolute;
  bottom: 60px;
  left: 80px;
  right: 80px;
  padding: 12px 20px 12px 24px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 12px;
`;

/** 洞察框类型颜色配置 */
export const INSIGHT_COLORS = {
  insight: { bg: "rgba(16, 185, 129, 0.1)", bar: "#10B981", text: "#D1FAE5" },
  warning: { bg: "rgba(245, 158, 11, 0.1)", bar: "#F59E0B", text: "#FEF3C7" },
  tip: { bg: "rgba(59, 130, 246, 0.1)", bar: "#3B82F6", text: "#DBEAFE" },
  summary: { bg: "rgba(212, 175, 55, 0.1)", bar: "#D4AF37", text: "#FEF9C3" },
};

/** 生成洞察框HTML */
export function generateInsightBoxHTML(
  type: "insight" | "warning" | "tip" | "summary",
  text: string,
  icon?: string,
): string {
  const colors = INSIGHT_COLORS[type];
  const defaultIcons = {
    insight: "💡",
    warning: "⚠️",
    tip: "💭",
    summary: "📌",
  };
  const finalIcon = icon || defaultIcons[type];

  return `
    <div style="${INSIGHT_BOX_STYLE} background: ${colors.bg};">
      <div style="position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: ${colors.bar}; border-radius: 8px 0 0 8px;"></div>
      <span style="font-size: 16px;">${finalIcon}</span>
      <span style="font-size: 13px; color: ${colors.text}; line-height: 1.4;">${text}</span>
    </div>
  `;
}

/** 生成金色装饰竖条HTML (用于标题左侧) */
export function generateAccentBarHTML(topOffset: number = 0): string {
  return `<div style="${ACCENT_BAR_TITLE} top: ${50 + topOffset}px;"></div>`;
}

/** 生成透明边框装饰框HTML */
export function generateTransparentBorderHTML(
  position: "top-right" | "bottom-left",
): string {
  const positionStyle =
    position === "top-right"
      ? "top: 50px; right: 80px;"
      : "bottom: 80px; left: 80px;";
  return `<div style="${TRANSPARENT_BORDER_BOX} ${positionStyle}"></div>`;
}

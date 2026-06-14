import { Injectable, Logger } from "@nestjs/common";
import { PuppeteerPoolService } from "../../../../common/browser/puppeteer-pool.service";
import { APP_CONFIG } from "../../../../common/config/app.config";
import { BrandLogoService } from "../../../../common/config/brand-logo.service";

// 信息图内容结构
export interface InfographicSection {
  title: string;
  summary?: string;
  bullets: string[];
  metrics: { label: string; value: string; comparison?: string }[];
  iconType?: string;
  sectionType?: "main" | "summary"; // AI-determined: main content vs summary/conclusion
}

// 支持的设计风格
export type InfographicStyle =
  | "consulting" // 咨询风格：McKinsey/BCG 风格，专业商务
  | "tech" // 科技风格：现代科技感，渐变色
  | "minimal" // 极简风格：大量留白，简洁
  | "creative" // 创意风格：活泼配色，圆角
  | "dark" // 暗黑风格：深色背景
  | "academic" // 学术风格：严谨正式
  | "business" // 商务简约：专业简洁，蓝灰色调
  | "genspark" // Genspark风格：深蓝渐变背景 + 玻璃态卡片
  | "tech_gradient"; // 科技渐变：紫蓝渐变 + 现代科技感

// 字体风格
export type FontStyle =
  | "sans" // 无衬线：现代感
  | "serif" // 衬线：经典正式
  | "mono" // 等宽：科技感
  | "rounded"; // 圆角：友好亲切

// 模板布局类型
export type TemplateLayout =
  | "cards" // 卡片网格布局（当前默认）
  | "center_visual" // 中心视觉图形 + 周围要点
  | "timeline" // 时间线/流程布局
  | "comparison" // 对比布局（仅限2项对比）
  | "pyramid" // 金字塔/层级布局
  | "radial" // 放射状布局
  | "statistics" // 统计数据展示
  | "checklist" // 清单/要点列表
  | "funnel" // 漏斗图
  | "matrix" // 2x2矩阵/象限图
  | "ranking"; // 排行榜/横向比较表格

export interface InfographicStyleOptions {
  style?: InfographicStyle;
  fontStyle?: FontStyle;
  templateLayout?: TemplateLayout; // 模板布局类型
  borderRadius?: "none" | "small" | "medium" | "large";
  shadowStyle?: "none" | "subtle" | "medium" | "strong";
  iconStyle?: "outline" | "filled" | "duotone";
  // 中心视觉相关配置
  centerVisualTitle?: string; // 中心图形的标题
  centerVisualItems?: string[]; // 中心图形周围的要点
}

export interface InfographicContent {
  title: string;
  subtitle?: string;
  heroStatement?: string;
  sections: InfographicSection[];
  callToAction?: string;
  colorScheme?: {
    primary: string;
    accent: string;
    background: string;
    text: string;
  };
  styleOptions?: InfographicStyleOptions;
}

// 预设风格配置
const STYLE_PRESETS: Record<
  InfographicStyle,
  {
    colors: {
      primary: string;
      accent: string;
      background: string;
      text: string;
    };
    font: string;
    borderRadius: number;
    shadow: string;
  }
> = {
  consulting: {
    colors: {
      primary: "#1e3a5f",
      accent: "#0891b2",
      background: "#f8fafc",
      text: "#334155",
    },
    font: "'Noto Sans SC', 'Microsoft YaHei', sans-serif",
    borderRadius: 12,
    shadow: "0 2px 8px rgba(0,0,0,0.06)",
  },
  tech: {
    colors: {
      primary: "#6366f1",
      accent: "#22d3ee",
      background: "#f0f9ff",
      text: "#1e293b",
    },
    font: "'Inter', 'Noto Sans SC', sans-serif",
    borderRadius: 16,
    shadow: "0 4px 20px rgba(99,102,241,0.15)",
  },
  minimal: {
    colors: {
      primary: "#18181b",
      accent: "#a1a1aa",
      background: "#ffffff",
      text: "#3f3f46",
    },
    font: "'Noto Sans SC', 'Helvetica Neue', sans-serif",
    borderRadius: 4,
    shadow: "none",
  },
  creative: {
    colors: {
      primary: "#ec4899",
      accent: "#f59e0b",
      background: "#fdf4ff",
      text: "#581c87",
    },
    font: "'Noto Sans SC', 'Comic Sans MS', sans-serif",
    borderRadius: 24,
    shadow: "0 8px 30px rgba(236,72,153,0.2)",
  },
  dark: {
    colors: {
      primary: "#e2e8f0",
      accent: "#38bdf8",
      background: "#0f172a",
      text: "#cbd5e1",
    },
    font: "'Noto Sans SC', 'Segoe UI', sans-serif",
    borderRadius: 12,
    shadow: "0 4px 20px rgba(0,0,0,0.4)",
  },
  academic: {
    colors: {
      primary: "#1e40af",
      accent: "#059669",
      background: "#fffbeb",
      text: "#1f2937",
    },
    font: "'Noto Serif SC', 'Times New Roman', serif",
    borderRadius: 2,
    shadow: "0 1px 3px rgba(0,0,0,0.1)",
  },
  business: {
    colors: {
      primary: "#374151", // 深灰 - 商务稳重
      accent: "#3b82f6", // 蓝色 - 专业信任
      background: "#f9fafb", // 浅灰白 - 干净
      text: "#111827", // 深黑 - 清晰
    },
    font: "'Noto Sans SC', 'Segoe UI', sans-serif",
    borderRadius: 8,
    shadow: "0 1px 2px rgba(0,0,0,0.05)",
  },
  // Genspark风格：深蓝渐变背景 + 玻璃态卡片
  genspark: {
    colors: {
      primary: "#0A2B4E", // 深海军蓝 (Genspark背景色)
      accent: "#3B82F6", // 亮蓝色强调
      background: "#0A2B4E", // 深色背景
      text: "#E5E7EB", // 浅灰正文
    },
    font: "'Noto Sans SC', 'Inter', sans-serif",
    borderRadius: 12,
    shadow: "0 8px 32px rgba(0,0,0,0.3)",
  },
  // 科技渐变风格：紫蓝渐变 + 现代科技感
  tech_gradient: {
    colors: {
      primary: "#6366F1", // 靛蓝
      accent: "#8B5CF6", // 紫色
      background: "#0F172A", // 深色背景
      text: "#F1F5F9", // 浅色文字
    },
    font: "'Inter', 'Noto Sans SC', sans-serif",
    borderRadius: 16,
    shadow: "0 12px 40px rgba(99,102,241,0.25)",
  },
};

// 字体映射
const FONT_STYLES: Record<FontStyle, string> = {
  sans: "'Noto Sans SC', 'Microsoft YaHei', 'PingFang SC', sans-serif",
  serif: "'Noto Serif SC', 'SimSun', 'Times New Roman', serif",
  mono: "'JetBrains Mono', 'Noto Sans SC', 'Consolas', monospace",
  rounded: "'Nunito', 'Noto Sans SC', 'Comic Sans MS', sans-serif",
};

// 图标SVG映射
const ICONS: Record<string, string> = {
  target: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`,
  chart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>`,
  briefcase: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/></svg>`,
  shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
  lightbulb: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6M10 22h4M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0018 8 6 6 0 006 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 019 14"/></svg>`,
  gear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>`,
  users: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>`,
  globe: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`,
  trending: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/></svg>`,
  star: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>`,
};

const DEFAULT_ICON = ICONS.star;

@Injectable()
export class InfographicTemplateService {
  private readonly logger = new Logger(InfographicTemplateService.name);

  constructor(
    private readonly brandLogoService: BrandLogoService,
    private readonly browserPool: PuppeteerPoolService,
  ) {}

  /**
   * 获取图标 SVG
   */
  private getIcon(type?: string): string {
    if (!type) return DEFAULT_ICON;
    const normalized = type.toLowerCase().replace(/[^a-z]/g, "");
    return ICONS[normalized] || DEFAULT_ICON;
  }

  /**
   * 生成信息图 HTML
   * 支持多种风格：consulting, tech, minimal, creative, dark, academic
   * 布局：根据宽高比智能调整列数
   */
  generateConsultingInfographicHTML(
    content: InfographicContent,
    backgroundImageBase64?: string,
    width: number = 1200,
    height: number = 800,
  ): string {
    // 获取风格配置
    const styleKey = content.styleOptions?.style || "consulting";
    const stylePreset = STYLE_PRESETS[styleKey] || STYLE_PRESETS.consulting;

    // 优先使用用户指定的颜色，否则使用风格预设
    const colors = {
      primary: content.colorScheme?.primary || stylePreset.colors.primary,
      accent: content.colorScheme?.accent || stylePreset.colors.accent,
      background:
        content.colorScheme?.background || stylePreset.colors.background,
      text: content.colorScheme?.text || stylePreset.colors.text,
    };

    // 获取字体配置
    const fontStyle = content.styleOptions?.fontStyle || "sans";
    const fontFamily = FONT_STYLES[fontStyle] || FONT_STYLES.sans;

    // 获取圆角配置
    const borderRadiusMap = { none: 0, small: 4, medium: 12, large: 24 };
    const baseBorderRadius =
      borderRadiusMap[content.styleOptions?.borderRadius || "medium"] ||
      stylePreset.borderRadius;

    // 获取阴影配置
    const shadowMap = {
      none: "none",
      subtle: "0 1px 3px rgba(0,0,0,0.05)",
      medium: "0 2px 8px rgba(0,0,0,0.08)",
      strong: "0 8px 30px rgba(0,0,0,0.15)",
    };
    const boxShadow =
      shadowMap[content.styleOptions?.shadowStyle || "medium"] ||
      stylePreset.shadow;

    // 暗黑模式特殊处理 - 包括 genspark 和 tech_gradient
    const isDarkMode =
      styleKey === "dark" ||
      styleKey === "genspark" ||
      styleKey === "tech_gradient";

    // Genspark风格：玻璃态卡片
    const isGlassmorphism =
      styleKey === "genspark" || styleKey === "tech_gradient";

    // 卡片背景和边框 - 玻璃态效果
    const cardBackground = isGlassmorphism
      ? "rgba(255, 255, 255, 0.08)"
      : isDarkMode
        ? "#1e293b"
        : "white";
    const cardBorder = isGlassmorphism
      ? "rgba(255, 255, 255, 0.15)"
      : isDarkMode
        ? "rgba(255,255,255,0.1)"
        : "rgba(0,0,0,0.06)";
    const bulletBorderColor = isDarkMode ? "#334155" : "#f1f5f9";

    // 玻璃态额外样式
    const glassmorphismStyles = isGlassmorphism
      ? `backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);`
      : "";

    // Genspark风格的渐变色数组（用于不同卡片的图标）
    const cardGradients = [
      "linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%)", // 蓝色
      "linear-gradient(135deg, #10B981 0%, #059669 100%)", // 绿色
      "linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)", // 紫色
      "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)", // 橙色
      "linear-gradient(135deg, #EF4444 0%, #DC2626 100%)", // 红色
      "linear-gradient(135deg, #06B6D4 0%, #0891B2 100%)", // 青色
    ];

    this.logger.log(
      `[generateInfographicHTML] Using style: ${styleKey}, font: ${fontStyle}, colors: ${JSON.stringify(colors)}`,
    );

    // 计算宽高比
    const aspectRatio = width / height;
    const isWideScreen = aspectRatio >= 1.5; // 16:9 = 1.78, 4:3 = 1.33
    const isVertical = height > width; // 9:16 等竖屏

    // 智能分配卡片 - 基于 AI 的 sectionType 分类
    const aiMainSections = content.sections.filter(
      (s) => s.sectionType !== "summary",
    );
    const aiSummarySections = content.sections.filter(
      (s) => s.sectionType === "summary",
    );

    // 根据实际内容数量和宽高比动态决定列数
    const totalMainItems = aiMainSections.length || content.sections.length;
    let numColumns: number;

    if (isVertical) {
      // 竖屏：最多2列
      numColumns = Math.min(totalMainItems, 2);
    } else if (totalMainItems <= 2) {
      // 横屏2项以下：并排显示
      numColumns = totalMainItems;
    } else if (totalMainItems === 4) {
      // 4项：2x2网格
      numColumns = 2;
    } else if (totalMainItems <= 6) {
      // 5-6项：3列网格
      numColumns = 3;
    } else if (totalMainItems <= 8) {
      // 7-8项：4列网格
      numColumns = 4;
    } else if (totalMainItems <= 10) {
      // 9-10项：5列网格
      numColumns = 5;
    } else {
      // 超过10项：5列，多行
      numColumns = 5;
    }

    // 主卡片：动态计算最大显示数量，根据内容量自适应
    // 横屏：最多15个（5列×3行），竖屏：最多12个（2列×6行）
    const maxMainCards = isVertical ? 12 : 15;
    const mainSections =
      aiMainSections.length > 0
        ? aiMainSections.slice(0, maxMainCards)
        : content.sections
            .filter((s) => s.sectionType !== "summary")
            .slice(0, maxMainCards);

    // 根据实际显示数量动态调整布局紧凑度
    const isCompactCards = mainSections.length > 8;
    const isVeryCompactCards = mainSections.length > 12;

    // 总结卡片：仅当明确标记为summary时才显示
    const summarySection =
      aiSummarySections.length > 0 ? aiSummarySections[0] : null;

    this.logger.log(
      `[Cards] 内容数: ${totalMainItems}, 列数: ${numColumns}, 显示: main=${mainSections.length}, summary=${summarySection ? 1 : 0}`,
    );

    // 根据尺寸调整字体和间距
    const scale = width / 1200;
    // 宽屏需要稍微紧凑的布局，但不要太极端
    const compactScale = isWideScreen ? 0.85 : 1;
    const padding = Math.round(32 * scale * (isWideScreen ? 0.6 : 0.85));
    const titleSize = Math.round(32 * scale * (isWideScreen ? 0.9 : 1));
    const subtitleSize = Math.round(16 * scale * (isWideScreen ? 0.9 : 1));
    const sectionTitleSize = Math.round(18 * scale * compactScale);
    const bulletSize = Math.round(14 * scale * compactScale);

    // 根据内容数量和宽高比动态调整截断参数
    // 数据越多，每个卡片显示的内容越精简，但保证核心数据完整
    const summaryMaxLen = isVeryCompactCards
      ? 30
      : isCompactCards
        ? 40
        : isWideScreen
          ? 45
          : 60;
    const bulletMaxLen = isVeryCompactCards
      ? 25
      : isCompactCards
        ? 30
        : isWideScreen
          ? 35
          : 50;
    // 动态计算bullets和metrics显示数量：内容多时精简，但至少显示关键信息
    const bulletsToShow = isVeryCompactCards
      ? 1
      : isCompactCards
        ? 2
        : isWideScreen
          ? 2
          : 3;
    // metrics是核心数据，尽量完整显示
    const metricsToShow = isVeryCompactCards
      ? 2
      : isCompactCards
        ? 3
        : isWideScreen
          ? 2
          : 3;

    // 动态背景样式（支持暗黑模式的遮罩颜色）
    const overlayColor = isDarkMode
      ? "rgba(15, 23, 42, 0.92)"
      : "rgba(247, 249, 252, 0.92)";

    // Genspark风格的渐变背景
    const gensparkGradientBg =
      styleKey === "genspark"
        ? `linear-gradient(135deg, #0A2B4E 0%, #0F3460 50%, #16213E 100%)`
        : styleKey === "tech_gradient"
          ? `linear-gradient(135deg, #0F172A 0%, #1E1B4B 50%, #0F172A 100%)`
          : null;

    const backgroundStyle = backgroundImageBase64
      ? `background-image: linear-gradient(${overlayColor}, ${overlayColor}), url(${backgroundImageBase64});
         background-size: cover;
         background-position: center;`
      : gensparkGradientBg
        ? `background: ${gensparkGradientBg};`
        : `background: ${colors.background};`;

    // 计算动态圆角
    const scaledBorderRadius = Math.round(
      baseBorderRadius * scale * (isWideScreen ? 0.7 : 1),
    );

    return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=${width}">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600;700&family=Noto+Serif+SC:wght@400;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Nunito:wght@400;600;700&display=swap');

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: ${fontFamily};
      ${backgroundStyle}
      color: ${colors.text};
      width: ${width}px;
      height: ${height}px;
      padding: 0;
      overflow: hidden;
    }

    .infographic {
      padding: ${padding}px;
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: space-evenly;
      box-sizing: border-box;
    }

    /* 顶部品牌栏 */
    .brand-bar {
      display: flex;
      align-items: center;
      gap: ${Math.round(8 * scale)}px;
      padding: 0 4px;
      flex-shrink: 0;
    }

    .brand-logo {
      width: ${Math.round((isWideScreen ? 20 : 28) * scale)}px;
      height: ${Math.round((isWideScreen ? 20 : 28) * scale)}px;
      color: ${colors.primary};
    }

    .brand-name {
      font-size: ${Math.round((isWideScreen ? 11 : 14) * scale)}px;
      font-weight: 600;
      color: ${colors.primary};
      letter-spacing: 0.5px;
    }

    /* 顶部标题区 */
    .header {
      background: linear-gradient(135deg, ${colors.primary} 0%, ${this.adjustColor(colors.primary, 20)} 100%);
      color: white;
      padding: ${Math.round((isWideScreen ? 14 : 20) * scale)}px ${Math.round((isWideScreen ? 24 : 32) * scale)}px;
      border-radius: ${Math.round((isWideScreen ? 10 : 12) * scale)}px;
      position: relative;
      overflow: hidden;
      flex-shrink: 0;
    }

    .header::before {
      content: '';
      position: absolute;
      top: 0;
      right: 0;
      width: ${Math.round(300 * scale)}px;
      height: 100%;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.1));
    }

    .header-content {
      position: relative;
      z-index: 1;
    }

    .main-title {
      font-size: ${titleSize}px;
      font-weight: 700;
      margin-bottom: ${Math.round((isWideScreen ? 4 : 6) * scale)}px;
      line-height: 1.2;
    }

    .subtitle {
      font-size: ${subtitleSize}px;
      opacity: 0.9;
      font-weight: 400;
    }

    .hero-statement {
      margin-top: ${Math.round((isWideScreen ? 10 : 14) * scale)}px;
      padding: ${Math.round((isWideScreen ? 8 : 10) * scale)}px ${Math.round((isWideScreen ? 12 : 16) * scale)}px;
      background: rgba(255,255,255,0.15);
      border-left: 3px solid ${colors.accent};
      border-radius: 0 ${Math.round(6 * scale)}px ${Math.round(6 * scale)}px 0;
      font-size: ${Math.round((isWideScreen ? 12 : 14) * scale)}px;
      font-style: italic;
      max-width: ${isWideScreen ? "100%" : "80%"};
    }

    /* 主内容区 - 并排卡片，等高 */
    .main-cards {
      display: grid;
      grid-template-columns: repeat(${numColumns}, 1fr);
      gap: ${Math.round((isWideScreen ? 16 : 24) * scale)}px;
      align-items: stretch;
    }

    /* Section 卡片 - 等高，支持玻璃态 */
    .section-card {
      background: ${cardBackground};
      border-radius: ${scaledBorderRadius}px;
      padding: ${Math.round((isWideScreen ? 16 : 24) * scale)}px;
      box-shadow: ${isGlassmorphism ? "0 8px 32px rgba(0,0,0,0.25)" : boxShadow};
      border: 1px solid ${cardBorder};
      display: flex;
      flex-direction: column;
      height: 100%;
      ${glassmorphismStyles}
      ${isGlassmorphism ? "position: relative; overflow: hidden;" : ""}
    }

    /* 卡片内容区 - 弹性填充 */
    .section-body {
      flex: 1;
      display: flex;
      flex-direction: column;
    }

    /* 卡片底部区域 - 固定在底部 */
    .section-footer {
      margin-top: auto;
      padding-top: ${Math.round(12 * scale)}px;
    }

    ${
      isGlassmorphism
        ? `
    /* 玻璃态卡片顶部装饰条 */
    .section-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: var(--card-accent-gradient);
    }

    /* 玻璃态卡片发光效果 */
    .section-card::after {
      content: '';
      position: absolute;
      top: -50%;
      right: -50%;
      width: 100%;
      height: 100%;
      background: radial-gradient(circle, rgba(255,255,255,0.05) 0%, transparent 70%);
      pointer-events: none;
    }
    `
        : ""
    }

    /* 总结卡片 - 横跨底部，不同风格 */
    .summary-card {
      background: ${isGlassmorphism ? "rgba(255, 255, 255, 0.05)" : `linear-gradient(135deg, ${colors.accent}15 0%, ${colors.primary}10 100%)`};
      border-radius: ${scaledBorderRadius}px;
      padding: ${Math.round((isWideScreen ? 16 : 20) * scale)}px ${Math.round((isWideScreen ? 24 : 32) * scale)}px;
      border: ${isGlassmorphism ? "1px solid rgba(255, 255, 255, 0.1)" : `2px solid ${colors.accent}40`};
      display: flex;
      align-items: center;
      gap: ${Math.round((isWideScreen ? 20 : 28) * scale)}px;
      flex-shrink: 0;
      ${glassmorphismStyles}
    }

    .summary-icon {
      width: ${Math.round((isWideScreen ? 48 : 56) * scale)}px;
      height: ${Math.round((isWideScreen ? 48 : 56) * scale)}px;
      min-width: ${Math.round((isWideScreen ? 48 : 56) * scale)}px;
      background: linear-gradient(135deg, ${colors.accent} 0%, ${this.adjustColor(colors.accent, -20)} 100%);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
    }

    .summary-icon svg {
      width: ${Math.round((isWideScreen ? 24 : 28) * scale)}px;
      height: ${Math.round((isWideScreen ? 24 : 28) * scale)}px;
    }

    .summary-content {
      flex: 1;
    }

    .summary-title {
      font-size: ${Math.round((isWideScreen ? 16 : 20) * scale)}px;
      font-weight: 700;
      color: ${colors.primary};
      margin-bottom: ${Math.round(4 * scale)}px;
    }

    .summary-text {
      font-size: ${Math.round((isWideScreen ? 12 : 14) * scale)}px;
      color: ${colors.text};
      opacity: 0.85;
      line-height: 1.5;
    }

    .summary-bullets {
      display: flex;
      flex-wrap: wrap;
      gap: ${Math.round(8 * scale)}px ${Math.round(16 * scale)}px;
      margin-top: ${Math.round(8 * scale)}px;
    }

    .summary-bullet {
      display: flex;
      align-items: center;
      gap: ${Math.round(6 * scale)}px;
      font-size: ${Math.round((isWideScreen ? 11 : 13) * scale)}px;
      color: ${colors.text};
    }

    .summary-bullet-dot {
      width: ${Math.round(6 * scale)}px;
      height: ${Math.round(6 * scale)}px;
      background: ${colors.accent};
      border-radius: 50%;
    }

    .section-header {
      display: flex;
      align-items: flex-start;
      gap: ${Math.round((isWideScreen ? 10 : 14) * scale)}px;
      margin-bottom: ${Math.round((isWideScreen ? 10 : 16) * scale)}px;
    }

    .section-icon {
      width: ${Math.round((isWideScreen ? 36 : 44) * scale)}px;
      height: ${Math.round((isWideScreen ? 36 : 44) * scale)}px;
      min-width: ${Math.round((isWideScreen ? 36 : 44) * scale)}px;
      background: linear-gradient(135deg, ${colors.primary} 0%, ${this.adjustColor(colors.primary, 15)} 100%);
      border-radius: ${Math.round((isWideScreen ? 8 : 10) * scale)}px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
    }

    .section-icon svg {
      width: ${Math.round((isWideScreen ? 18 : 24) * scale)}px;
      height: ${Math.round((isWideScreen ? 18 : 24) * scale)}px;
    }

    .section-number {
      position: absolute;
      top: ${Math.round(-4 * scale)}px;
      right: ${Math.round(-4 * scale)}px;
      width: ${Math.round((isWideScreen ? 18 : 22) * scale)}px;
      height: ${Math.round((isWideScreen ? 18 : 22) * scale)}px;
      background: ${colors.accent};
      color: white;
      border-radius: 50%;
      font-size: ${Math.round((isWideScreen ? 10 : 12) * scale)}px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .section-icon-wrapper {
      position: relative;
    }

    .section-title {
      font-size: ${sectionTitleSize}px;
      font-weight: 700;
      color: ${colors.primary};
      line-height: 1.3;
    }

    .section-summary {
      font-size: ${bulletSize}px;
      color: #64748b;
      margin-top: ${Math.round(2 * scale)}px;
      line-height: 1.4;
    }

    /* 要点列表 */
    .bullets {
      list-style: none;
      margin-bottom: ${Math.round((isWideScreen ? 10 : 16) * scale)}px;
    }

    .bullet-item {
      display: flex;
      align-items: flex-start;
      gap: ${Math.round((isWideScreen ? 8 : 10) * scale)}px;
      padding: ${Math.round((isWideScreen ? 5 : 8) * scale)}px 0;
      font-size: ${bulletSize}px;
      line-height: 1.4;
      border-bottom: 1px solid ${bulletBorderColor};
    }

    .bullet-item:last-child {
      border-bottom: none;
    }

    .bullet-dot {
      width: ${Math.round((isWideScreen ? 6 : 8) * scale)}px;
      height: ${Math.round((isWideScreen ? 6 : 8) * scale)}px;
      min-width: ${Math.round((isWideScreen ? 6 : 8) * scale)}px;
      background: ${colors.accent};
      border-radius: 50%;
      margin-top: ${Math.round((isWideScreen ? 5 : 6) * scale)}px;
    }

    /* 指标展示 */
    .metrics {
      display: flex;
      flex-wrap: wrap;
      gap: ${Math.round((isWideScreen ? 8 : 12) * scale)}px;
    }

    .metric {
      background: linear-gradient(135deg, ${colors.primary}08 0%, ${colors.primary}15 100%);
      border: 1px solid ${colors.primary}20;
      border-radius: ${Math.round((isWideScreen ? 6 : 8) * scale)}px;
      padding: ${Math.round((isWideScreen ? 8 : 12) * scale)}px ${Math.round((isWideScreen ? 12 : 16) * scale)}px;
      flex: 1;
      min-width: ${Math.round((isWideScreen ? 80 : 100) * scale)}px;
    }

    .metric-value {
      font-size: ${Math.round((isWideScreen ? 18 : 24) * scale)}px;
      font-weight: 700;
      color: ${colors.primary};
      line-height: 1.2;
    }

    .metric-label {
      font-size: ${Math.round((isWideScreen ? 10 : 12) * scale)}px;
      color: #64748b;
      margin-top: ${Math.round(2 * scale)}px;
    }

    .metric-comparison {
      font-size: ${Math.round((isWideScreen ? 9 : 11) * scale)}px;
      color: ${colors.accent};
      font-weight: 600;
      margin-top: ${Math.round(2 * scale)}px;
    }

    /* 底部行动号召 */
    .cta {
      background: linear-gradient(135deg, ${colors.accent} 0%, ${this.adjustColor(colors.accent, -15)} 100%);
      color: white;
      text-align: center;
      padding: ${Math.round((isWideScreen ? 14 : 20) * scale)}px ${Math.round((isWideScreen ? 30 : 40) * scale)}px;
      border-radius: ${Math.round((isWideScreen ? 10 : 12) * scale)}px;
      font-size: ${Math.round((isWideScreen ? 14 : 18) * scale)}px;
      font-weight: 600;
      margin-top: ${Math.round((isWideScreen ? 12 : 16) * scale)}px;
      flex-shrink: 0;
    }

    /* 水印/品牌 */
    .watermark {
      text-align: center;
      margin-top: ${Math.round(24 * scale)}px;
      font-size: ${Math.round(12 * scale)}px;
      color: #94a3b8;
    }
  </style>
</head>
<body>
  <div class="infographic">
    <!-- 品牌栏 -->
    <div class="brand-bar">
      <div class="brand-logo">${this.brandLogoService.getLogoSvg()}</div>
      <span class="brand-name">${APP_CONFIG.brand.fullName}</span>
    </div>

    <!-- 标题区 -->
    <div class="header">
      <div class="header-content">
        <h1 class="main-title">${this.escapeHtml(content.title)}</h1>
        ${content.subtitle ? `<p class="subtitle">${this.escapeHtml(content.subtitle)}</p>` : ""}
        ${content.heroStatement ? `<div class="hero-statement">${this.escapeHtml(content.heroStatement)}</div>` : ""}
      </div>
    </div>

    <!-- 主内容卡片 - 并排等高 -->
    <div class="main-cards">
      ${mainSections
        .map(
          (section, idx) => `
        <div class="section-card" style="--card-accent-gradient: ${cardGradients[idx % cardGradients.length]}">
          <div class="section-header">
            <div class="section-icon-wrapper">
              <div class="section-icon" ${isGlassmorphism ? `style="background: ${cardGradients[idx % cardGradients.length]}"` : ""}>
                ${this.getIcon(section.iconType)}
              </div>
              <span class="section-number">${idx + 1}</span>
            </div>
            <div>
              <h3 class="section-title">${this.escapeHtml(this.truncateText(section.title, isWideScreen ? 25 : 40))}</h3>
              ${section.summary ? `<p class="section-summary">${this.escapeHtml(this.truncateText(section.summary, summaryMaxLen))}</p>` : ""}
            </div>
          </div>

          <div class="section-body">
          ${
            section.bullets.length > 0
              ? `
            <ul class="bullets">
              ${section.bullets
                .slice(0, bulletsToShow)
                .map(
                  (bullet) => `
                <li class="bullet-item">
                  <span class="bullet-dot"></span>
                  <span>${this.escapeHtml(this.truncateText(bullet, bulletMaxLen))}</span>
                </li>
              `,
                )
                .join("")}
            </ul>
          `
              : ""
          }
          </div>

          ${
            section.metrics.length > 0
              ? `
            <div class="section-footer">
              <div class="metrics">
                ${section.metrics
                  .slice(0, metricsToShow)
                  .map(
                    (metric) => `
                  <div class="metric">
                    <div class="metric-value">${this.escapeHtml(metric.value)}</div>
                    <div class="metric-label">${this.escapeHtml(this.truncateText(metric.label, isWideScreen ? 15 : 20))}</div>
                  </div>
                `,
                  )
                  .join("")}
              </div>
            </div>
          `
              : ""
          }
        </div>
      `,
        )
        .join("")}
    </div>

    <!-- 总结卡片 - 横跨底部，不同风格 -->
    ${
      summarySection
        ? `
      <div class="summary-card">
        <div class="summary-icon">
          ${this.getIcon(summarySection.iconType || "star")}
        </div>
        <div class="summary-content">
          <h3 class="summary-title">${this.escapeHtml(summarySection.title)}</h3>
          ${summarySection.summary ? `<p class="summary-text">${this.escapeHtml(summarySection.summary)}</p>` : ""}
          ${
            summarySection.bullets.length > 0
              ? `
            <div class="summary-bullets">
              ${summarySection.bullets
                .slice(0, 3)
                .map(
                  (bullet) => `
                <span class="summary-bullet">
                  <span class="summary-bullet-dot"></span>
                  <span>${this.escapeHtml(this.truncateText(bullet, 50))}</span>
                </span>
              `,
                )
                .join("")}
            </div>
          `
              : ""
          }
        </div>
      </div>
    `
        : ""
    }

    <!-- 行动号召 -->
    ${content.callToAction && !summarySection ? `<div class="cta">${this.escapeHtml(this.truncateText(content.callToAction, isWideScreen ? 50 : 80))}</div>` : ""}
  </div>
</body>
</html>`;
  }

  /**
   * HTML 转义
   */
  private escapeHtml(text: string): string {
    const escapeMap: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return text.replace(/[&<>"']/g, (char) => escapeMap[char]);
  }

  /**
   * 处理文本（不再截断，完整显示）
   */
  private truncateText(text: string, _maxLength: number): string {
    // 不再截断文本，完整显示所有内容
    return text;
  }

  /**
   * 调整颜色亮度
   */
  private adjustColor(hex: string, amount: number): string {
    const num = parseInt(hex.replace("#", ""), 16);
    const r = Math.min(255, Math.max(0, (num >> 16) + amount));
    const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00ff) + amount));
    const b = Math.min(255, Math.max(0, (num & 0x0000ff) + amount));
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
  }

  /**
   * 将 HTML 渲染为 PNG 图片（Base64）
   * 严格按照指定的 width x height 尺寸渲染
   */
  async renderToImage(
    html: string,
    width: number = 1200,
    height: number = 800,
  ): Promise<string> {
    const browser = await this.browserPool.getBrowser();
    const page = await browser.newPage();

    this.logger.log(
      `[renderToImage] Rendering with dimensions: ${width}x${height}`,
    );

    try {
      // 设置视口为目标尺寸
      await page.setViewport({ width, height, deviceScaleFactor: 2 });

      // 加载 HTML
      await page.setContent(html, {
        waitUntil: "load",
        timeout: 30000,
      });

      // 等待字体加载
      await page.evaluate(() => document.fonts.ready);

      // 截图 - 使用 clip 确保精确尺寸，不使用 fullPage
      const screenshot = await page.screenshot({
        type: "png",
        encoding: "base64",
        clip: {
          x: 0,
          y: 0,
          width: width,
          height: height,
        },
      });

      this.logger.log(
        `[renderToImage] Screenshot completed with exact dimensions: ${width}x${height}`,
      );

      return `data:image/png;base64,${screenshot}`;
    } finally {
      await page.close();
    }
  }

  /**
   * 从 AI 分析结果生成信息图
   * 这是主要入口方法
   */
  /**
   * 生成中心视觉布局 HTML（类似 NotebookLM 风格）
   * 中心是一个大的视觉图形，周围环绕着关键要点
   */
  generateCenterVisualHTML(
    content: InfographicContent,
    backgroundImageBase64?: string,
    width: number = 1200,
    height: number = 800,
  ): string {
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

    // 暗黑模式检测 - 包括 genspark 和 tech_gradient
    const isDarkMode =
      styleKey === "dark" ||
      styleKey === "genspark" ||
      styleKey === "tech_gradient";

    // Genspark风格：玻璃态效果
    const isGlassmorphism =
      styleKey === "genspark" || styleKey === "tech_gradient";

    // Genspark风格的渐变色数组（用于不同节点）
    const nodeGradients = [
      "linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%)", // 蓝色
      "linear-gradient(135deg, #10B981 0%, #059669 100%)", // 绿色
      "linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)", // 紫色
      "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)", // 橙色
      "linear-gradient(135deg, #EF4444 0%, #DC2626 100%)", // 红色
      "linear-gradient(135deg, #06B6D4 0%, #0891B2 100%)", // 青色
      "linear-gradient(135deg, #EC4899 0%, #DB2777 100%)", // 粉色
      "linear-gradient(135deg, #84CC16 0%, #65A30D 100%)", // 柠檬绿
    ];

    const scale = width / 1200;
    const padding = Math.round(40 * scale);
    const titleSize = Math.round(32 * scale);
    const subtitleSize = Math.round(16 * scale);

    // 中心视觉配置
    const centerTitle =
      content.styleOptions?.centerVisualTitle || content.title;
    // 获取完整的section数据，包含title和bullets
    const centerSections = content.sections.slice(0, 8);
    const centerItems =
      content.styleOptions?.centerVisualItems ||
      centerSections.map((s) => s.title);

    const overlayColor = isDarkMode
      ? "rgba(15, 23, 42, 0.92)"
      : "rgba(247, 249, 252, 0.92)";

    // Genspark风格的渐变背景
    const gensparkGradientBg =
      styleKey === "genspark"
        ? `linear-gradient(135deg, #0A2B4E 0%, #0F3460 50%, #16213E 100%)`
        : styleKey === "tech_gradient"
          ? `linear-gradient(135deg, #0F172A 0%, #1E1B4B 50%, #0F172A 100%)`
          : null;

    const backgroundStyle = backgroundImageBase64
      ? `background-image: linear-gradient(${overlayColor}, ${overlayColor}), url(${backgroundImageBase64});
         background-size: cover;
         background-position: center;`
      : gensparkGradientBg
        ? `background: ${gensparkGradientBg};`
        : `background: ${colors.background};`;

    // 玻璃态额外样式
    const glassmorphismStyles = isGlassmorphism
      ? `backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);`
      : "";

    // ========== 精确空间计算 ==========
    const itemCount = Math.min(centerItems.length, 8);

    // 布局区域划分（固定比例）
    const headerHeight = Math.round(90 * scale); // 品牌+标题区域
    const footerHeight = Math.round(70 * scale); // 底部时间线区域
    const visualAreaHeight = height - headerHeight - footerHeight - padding * 2;
    const visualAreaWidth = width - padding * 2;

    // 中心圆尺寸：基于可视区域的较小边，根据元素数量调整
    const minDimension = Math.min(visualAreaWidth, visualAreaHeight);
    const centerRadiusRatio =
      itemCount <= 4 ? 0.2 : itemCount <= 6 ? 0.17 : 0.15;
    const centerRadius = Math.round(minDimension * centerRadiusRatio);

    // 卡片尺寸：统一固定尺寸，确保所有卡片大小一致
    const cardWidth = Math.round(155 * scale);
    const cardHeight = Math.round(100 * scale); // 固定高度
    const cardPadding = Math.round(10 * scale);
    const cardFontSize = Math.round(11 * scale);
    const bulletFontSize = Math.round(8 * scale);
    const numberSize = Math.round(20 * scale);

    // 轨道半径：确保卡片不与中心圆和边界重叠
    const horizontalMargin = Math.round(15 * scale);
    const verticalMargin = Math.round(18 * scale);
    const horizontalRadius =
      (visualAreaWidth - cardWidth) / 2 - horizontalMargin;
    const verticalRadius = (visualAreaHeight - cardHeight) / 2 - verticalMargin;

    return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600;700&display=swap');

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: ${fontFamily};
      ${backgroundStyle}
      color: ${colors.text};
      width: ${width}px;
      height: ${height}px;
      overflow: hidden;
    }

    .container {
      padding: ${padding}px;
      height: 100%;
      display: flex;
      flex-direction: column;
    }

    /* 头部区域：品牌+标题 */
    .header-section {
      height: ${headerHeight}px;
      flex-shrink: 0;
    }

    /* 品牌栏 */
    .brand-bar {
      display: flex;
      align-items: center;
      gap: ${Math.round(6 * scale)}px;
      margin-bottom: ${Math.round(8 * scale)}px;
    }

    .brand-logo {
      width: ${Math.round(22 * scale)}px;
      height: ${Math.round(22 * scale)}px;
      color: ${colors.primary};
    }

    .brand-name {
      font-size: ${Math.round(12 * scale)}px;
      font-weight: 600;
      color: ${colors.primary};
    }

    /* 标题区 */
    .header {
      text-align: center;
    }

    .main-title {
      font-size: ${titleSize}px;
      font-weight: 700;
      color: ${colors.primary};
      margin-bottom: ${Math.round(4 * scale)}px;
      line-height: 1.2;
    }

    .subtitle {
      font-size: ${subtitleSize}px;
      color: ${isDarkMode ? "#94a3b8" : "#64748b"};
      line-height: 1.3;
    }

    /* 中心视觉区域 - 精确尺寸 */
    .visual-area {
      height: ${visualAreaHeight}px;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    /* 中心圆形图形 */
    .center-visual {
      width: ${centerRadius * 2}px;
      height: ${centerRadius * 2}px;
      border-radius: 50%;
      background: linear-gradient(135deg, ${colors.primary} 0%, ${this.adjustColor(colors.primary, 30)} 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      box-shadow: 0 ${Math.round(15 * scale)}px ${Math.round(40 * scale)}px ${colors.primary}40;
      z-index: 10;
    }

    .center-visual::before {
      content: '';
      position: absolute;
      inset: -${Math.round(10 * scale)}px;
      border-radius: 50%;
      border: 2px dashed ${colors.accent}50;
    }

    .center-visual::after {
      content: '';
      position: absolute;
      inset: -${Math.round(25 * scale)}px;
      border-radius: 50%;
      border: 1px solid ${colors.primary}20;
    }

    .center-title {
      color: white;
      font-size: ${Math.round(18 * scale)}px;
      font-weight: 700;
      text-align: center;
      padding: ${Math.round(15 * scale)}px;
      line-height: 1.3;
    }

    /* 周围卡片 - 固定尺寸确保一致性 */
    .orbit-item {
      position: absolute;
      width: ${cardWidth}px;
      min-height: ${cardHeight}px;
      background: ${isGlassmorphism ? "rgba(255, 255, 255, 0.08)" : isDarkMode ? "#1e293b" : "white"};
      border-radius: ${Math.round(8 * scale)}px;
      padding: ${cardPadding}px;
      box-shadow: ${isGlassmorphism ? "0 6px 24px rgba(0,0,0,0.25)" : isDarkMode ? "0 3px 15px rgba(0,0,0,0.4)" : "0 3px 15px rgba(0,0,0,0.08)"};
      border: 1px solid ${isGlassmorphism ? "rgba(255,255,255,0.15)" : isDarkMode ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.05)"};
      text-align: center;
      transform: translate(-50%, -50%);
      z-index: 15;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      ${glassmorphismStyles}
    }

    .orbit-item .number {
      width: ${numberSize}px;
      height: ${numberSize}px;
      background: var(--node-gradient, ${colors.accent});
      color: white;
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: ${Math.round(numberSize * 0.5)}px;
      font-weight: 700;
      margin-bottom: ${Math.round(4 * scale)}px;
      ${isGlassmorphism ? "box-shadow: 0 3px 10px rgba(0,0,0,0.2);" : ""}
    }

    .orbit-item .text {
      font-size: ${cardFontSize}px;
      color: ${colors.text};
      font-weight: 600;
      line-height: 1.2;
      word-break: break-word;
      margin-bottom: ${Math.round(3 * scale)}px;
      width: 100%;
    }

    .orbit-item .bullets {
      text-align: left;
      width: 100%;
      flex: 1;
    }

    .orbit-item .bullet {
      font-size: ${bulletFontSize}px;
      color: ${isDarkMode ? "#94a3b8" : "#64748b"};
      line-height: 1.3;
      margin-bottom: ${Math.round(1 * scale)}px;
      display: flex;
      align-items: flex-start;
      gap: ${Math.round(3 * scale)}px;
    }

    .orbit-item .bullet::before {
      content: '•';
      color: ${colors.accent};
      font-weight: bold;
      flex-shrink: 0;
    }

    /* 底部时间线区域 - 精确高度 */
    .footer-section {
      height: ${footerHeight}px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .bottom-timeline {
      display: flex;
      justify-content: center;
      gap: ${Math.round(20 * scale)}px;
      padding: ${Math.round(12 * scale)}px ${Math.round(20 * scale)}px;
      background: ${isDarkMode ? "rgba(30,41,59,0.8)" : "rgba(255,255,255,0.8)"};
      border-radius: ${Math.round(10 * scale)}px;
    }

    .timeline-step {
      display: flex;
      align-items: center;
      gap: ${Math.round(6 * scale)}px;
    }

    .step-icon {
      width: ${Math.round(26 * scale)}px;
      height: ${Math.round(26 * scale)}px;
      background: ${colors.primary};
      color: white;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .step-icon svg {
      width: ${Math.round(14 * scale)}px;
      height: ${Math.round(14 * scale)}px;
    }

    .step-text {
      font-size: ${Math.round(11 * scale)}px;
      color: ${colors.text};
      font-weight: 500;
    }

    .step-arrow {
      color: ${colors.accent};
      font-size: ${Math.round(16 * scale)}px;
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- 头部区域 -->
    <div class="header-section">
      <div class="brand-bar">
        <div class="brand-logo">${this.brandLogoService.getLogoSvg()}</div>
        <span class="brand-name">${APP_CONFIG.brand.fullName}</span>
      </div>
      <div class="header">
        <h1 class="main-title">${this.escapeHtml(content.title)}</h1>
        ${content.subtitle ? `<p class="subtitle">${this.escapeHtml(content.subtitle)}</p>` : ""}
      </div>
    </div>

    <!-- 视觉区域 -->
    <div class="visual-area">
      <div class="center-visual">
        <span class="center-title">${this.escapeHtml(centerTitle)}</span>
      </div>

      ${centerItems
        .map((item, idx) => {
          // 从右侧开始（0度），顺时针均匀分布，避免正上方和正下方有卡片
          const angleStep = (2 * Math.PI) / itemCount;
          // 偏移半个步长，使卡片分布在对角线位置
          const startAngle = angleStep / 2 - Math.PI / 2;
          const angle = startAngle + angleStep * idx;
          // 计算卡片中心位置（百分比）
          const xPercent =
            50 + ((Math.cos(angle) * horizontalRadius) / visualAreaWidth) * 100;
          const yPercent =
            50 + ((Math.sin(angle) * verticalRadius) / visualAreaHeight) * 100;
          // 为每个节点分配不同的渐变色
          const nodeGradient = nodeGradients[idx % nodeGradients.length];
          // 获取该section的关键点（最多显示2个，严格截断）
          const section = centerSections[idx];
          const bullets = section?.bullets?.slice(0, 2) || [];
          // 截断标题（最多15个字符）
          const truncatedTitle =
            item.length > 15 ? item.substring(0, 13) + "..." : item;
          // 截断bullet（最多12个字符）
          const bulletsHtml =
            bullets.length > 0
              ? `<div class="bullets">${bullets.map((b) => `<div class="bullet">${this.escapeHtml(b.length > 12 ? b.substring(0, 10) + "..." : b)}</div>`).join("")}</div>`
              : "";
          return `
          <div class="orbit-item" style="left: ${xPercent.toFixed(2)}%; top: ${yPercent.toFixed(2)}%; --node-gradient: ${nodeGradient}">
            <div class="number">${idx + 1}</div>
            <div class="text">${this.escapeHtml(truncatedTitle)}</div>
            ${bulletsHtml}
          </div>
        `;
        })
        .join("")}
    </div>

    <!-- 底部区域 -->
    <div class="footer-section">
    ${
      content.sections.length > 0 && content.sections[0].metrics?.length > 0
        ? `
      <div class="bottom-timeline">
        ${content.sections
          .slice(0, 4)
          .map(
            (section, idx) => `
          <div class="timeline-step">
            <div class="step-icon">${this.getIcon(section.iconType)}</div>
            <span class="step-text">${this.escapeHtml(section.title)}</span>
          </div>
          ${idx < Math.min(content.sections.length, 4) - 1 ? '<span class="step-arrow">→</span>' : ""}
        `,
          )
          .join("")}
      </div>
        `
        : ""
    }
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * 生成时间线布局 HTML
   * 适合流程、步骤、发展历程等内容
   */
  generateTimelineHTML(
    content: InfographicContent,
    backgroundImageBase64?: string,
    width: number = 1200,
    height: number = 800,
  ): string {
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

    // 暗黑模式检测 - 包括 genspark 和 tech_gradient
    const isDarkMode =
      styleKey === "dark" ||
      styleKey === "genspark" ||
      styleKey === "tech_gradient";

    // Genspark风格：玻璃态效果
    const isGlassmorphism =
      styleKey === "genspark" || styleKey === "tech_gradient";

    // Genspark风格的渐变色数组（用于不同步骤节点）
    const stepGradients = [
      "linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%)", // 蓝色
      "linear-gradient(135deg, #10B981 0%, #059669 100%)", // 绿色
      "linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)", // 紫色
      "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)", // 橙色
      "linear-gradient(135deg, #EF4444 0%, #DC2626 100%)", // 红色
      "linear-gradient(135deg, #06B6D4 0%, #0891B2 100%)", // 青色
    ];

    const scale = width / 1200;
    const padding = Math.round(40 * scale);
    const isVertical = height > width;

    const overlayColor = isDarkMode
      ? "rgba(15, 23, 42, 0.92)"
      : "rgba(247, 249, 252, 0.92)";

    // Genspark风格的渐变背景
    const gensparkGradientBg =
      styleKey === "genspark"
        ? `linear-gradient(135deg, #0A2B4E 0%, #0F3460 50%, #16213E 100%)`
        : styleKey === "tech_gradient"
          ? `linear-gradient(135deg, #0F172A 0%, #1E1B4B 50%, #0F172A 100%)`
          : null;

    const backgroundStyle = backgroundImageBase64
      ? `background-image: linear-gradient(${overlayColor}, ${overlayColor}), url(${backgroundImageBase64});
         background-size: cover;
         background-position: center;`
      : gensparkGradientBg
        ? `background: ${gensparkGradientBg};`
        : `background: ${colors.background};`;

    // 玻璃态额外样式
    const glassmorphismStyles = isGlassmorphism
      ? `backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);`
      : "";

    return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600;700&display=swap');

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: ${fontFamily};
      ${backgroundStyle}
      color: ${colors.text};
      width: ${width}px;
      height: ${height}px;
      overflow: hidden;
    }

    .container {
      padding: ${padding}px;
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: space-evenly;
    }

    .brand-bar {
      display: flex;
      align-items: center;
      gap: ${Math.round(8 * scale)}px;
    }

    .brand-logo {
      width: ${Math.round(24 * scale)}px;
      height: ${Math.round(24 * scale)}px;
      color: ${colors.primary};
    }

    .brand-name {
      font-size: ${Math.round(12 * scale)}px;
      font-weight: 600;
      color: ${colors.primary};
    }

    .header {
      background: linear-gradient(135deg, ${colors.primary} 0%, ${this.adjustColor(colors.primary, 20)} 100%);
      color: white;
      padding: ${Math.round(24 * scale)}px ${Math.round(32 * scale)}px;
      border-radius: ${Math.round(12 * scale)}px;
      text-align: center;
    }

    .main-title {
      font-size: ${Math.round(28 * scale)}px;
      font-weight: 700;
      margin-bottom: ${Math.round(6 * scale)}px;
    }

    .subtitle {
      font-size: ${Math.round(14 * scale)}px;
      opacity: 0.9;
    }

    .timeline-container {
      flex: 1;
      display: flex;
      ${isVertical ? "flex-direction: column;" : "flex-direction: row;"}
      align-items: ${isVertical ? "flex-start" : "center"};
      justify-content: space-between;
      position: relative;
      padding: ${Math.round(20 * scale)}px 0;
    }

    /* 时间线主轴 */
    .timeline-axis {
      position: absolute;
      ${
        isVertical
          ? `
        left: ${Math.round(40 * scale)}px;
        top: 0;
        bottom: 0;
        width: 4px;
      `
          : `
        left: 0;
        right: 0;
        top: 50%;
        height: 4px;
        transform: translateY(-50%);
      `
      }
      background: linear-gradient(${isVertical ? "to bottom" : "to right"}, ${colors.primary}, ${colors.accent});
      border-radius: 2px;
    }

    .timeline-item {
      display: flex;
      ${isVertical ? "flex-direction: row;" : "flex-direction: column;"}
      align-items: ${isVertical ? "flex-start" : "center"};
      position: relative;
      ${isVertical ? `padding-left: ${Math.round(80 * scale)}px;` : ""}
      flex: 1;
    }

    .timeline-node {
      width: ${Math.round(48 * scale)}px;
      height: ${Math.round(48 * scale)}px;
      background: ${isGlassmorphism ? "var(--step-gradient)" : isDarkMode ? "#1e293b" : "white"};
      border: ${isGlassmorphism ? "none" : `3px solid ${colors.primary}`};
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: ${isGlassmorphism ? "white" : colors.primary};
      z-index: 2;
      ${isGlassmorphism ? "box-shadow: 0 8px 24px rgba(0,0,0,0.3);" : ""}
      ${
        isVertical
          ? `
        position: absolute;
        left: ${Math.round(16 * scale)}px;
      `
          : ""
      }
    }

    .timeline-node svg {
      width: ${Math.round(24 * scale)}px;
      height: ${Math.round(24 * scale)}px;
    }

    .timeline-content {
      background: ${isGlassmorphism ? "rgba(255, 255, 255, 0.08)" : isDarkMode ? "#1e293b" : "white"};
      border-radius: ${Math.round(12 * scale)}px;
      padding: ${Math.round(16 * scale)}px;
      box-shadow: ${isGlassmorphism ? "0 8px 32px rgba(0,0,0,0.25)" : isDarkMode ? "0 4px 20px rgba(0,0,0,0.4)" : "0 4px 20px rgba(0,0,0,0.08)"};
      border: 1px solid ${isGlassmorphism ? "rgba(255,255,255,0.15)" : isDarkMode ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.05)"};
      ${isVertical ? "" : `margin-top: ${Math.round(20 * scale)}px;`}
      max-width: ${Math.round((isVertical ? 300 : 200) * scale)}px;
      ${glassmorphismStyles}
    }

    .timeline-title {
      font-size: ${Math.round(16 * scale)}px;
      font-weight: 700;
      color: ${colors.primary};
      margin-bottom: ${Math.round(8 * scale)}px;
    }

    .timeline-summary {
      font-size: ${Math.round(13 * scale)}px;
      color: ${isDarkMode ? "#94a3b8" : "#64748b"};
      line-height: 1.5;
      margin-bottom: ${Math.round(8 * scale)}px;
    }

    .timeline-bullets {
      list-style: none;
    }

    .timeline-bullet {
      font-size: ${Math.round(12 * scale)}px;
      color: ${colors.text};
      padding: ${Math.round(4 * scale)}px 0;
      display: flex;
      align-items: flex-start;
      gap: ${Math.round(6 * scale)}px;
    }

    .bullet-dot {
      width: ${Math.round(6 * scale)}px;
      height: ${Math.round(6 * scale)}px;
      background: ${colors.accent};
      border-radius: 50%;
      margin-top: ${Math.round(5 * scale)}px;
      flex-shrink: 0;
    }

    .cta {
      background: linear-gradient(135deg, ${colors.accent} 0%, ${this.adjustColor(colors.accent, -15)} 100%);
      color: white;
      text-align: center;
      padding: ${Math.round(16 * scale)}px;
      border-radius: ${Math.round(10 * scale)}px;
      font-size: ${Math.round(14 * scale)}px;
      font-weight: 600;
      margin-top: ${Math.round(16 * scale)}px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="brand-bar">
      <div class="brand-logo">${this.brandLogoService.getLogoSvg()}</div>
      <span class="brand-name">${APP_CONFIG.brand.fullName}</span>
    </div>

    <div class="header">
      <h1 class="main-title">${this.escapeHtml(content.title)}</h1>
      ${content.subtitle ? `<p class="subtitle">${this.escapeHtml(content.subtitle)}</p>` : ""}
    </div>

    <div class="timeline-container">
      <div class="timeline-axis"></div>

      ${content.sections
        .slice(0, 5)
        .map(
          (section, idx) => `
        <div class="timeline-item" style="--step-gradient: ${stepGradients[idx % stepGradients.length]}">
          <div class="timeline-node">${this.getIcon(section.iconType)}</div>
          <div class="timeline-content">
            <h3 class="timeline-title">${this.escapeHtml(section.title)}</h3>
            ${section.summary ? `<p class="timeline-summary">${this.escapeHtml(section.summary)}</p>` : ""}
            ${
              section.bullets.length > 0
                ? `
              <ul class="timeline-bullets">
                ${section.bullets
                  .slice(0, 3)
                  .map(
                    (bullet) => `
                  <li class="timeline-bullet">
                    <span class="bullet-dot"></span>
                    <span>${this.escapeHtml(bullet)}</span>
                  </li>
                `,
                  )
                  .join("")}
              </ul>
            `
                : ""
            }
          </div>
        </div>
      `,
        )
        .join("")}
    </div>

    ${content.callToAction ? `<div class="cta">${this.escapeHtml(content.callToAction)}</div>` : ""}
  </div>
</body>
</html>`;
  }

  /**
   * 对比模板 - 左右两栏对比布局
   * 适合展示对比、优缺点、前后对比等内容
   */
  generateComparisonHTML(
    content: InfographicContent,
    backgroundImageBase64?: string,
    width: number = 1200,
    height: number = 800,
  ): string {
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
    const isDarkMode = styleKey === "dark";

    const scale = width / 1200;
    const padding = Math.round(40 * scale);
    const isVertical = height > width;

    const overlayColor = isDarkMode
      ? "rgba(15, 23, 42, 0.92)"
      : "rgba(247, 249, 252, 0.92)";
    const backgroundStyle = backgroundImageBase64
      ? `background-image: linear-gradient(${overlayColor}, ${overlayColor}), url(${backgroundImageBase64});
         background-size: cover;
         background-position: center;`
      : `background: ${colors.background};`;

    // 将 sections 分成两组进行对比
    const midPoint = Math.ceil(content.sections.length / 2);
    const leftSections = content.sections.slice(0, midPoint);
    const rightSections = content.sections.slice(midPoint);

    // 对比颜色
    const leftColor = colors.primary;
    const rightColor = colors.accent;

    return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600;700&display=swap');

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: ${fontFamily};
      ${backgroundStyle}
      color: ${colors.text};
      width: ${width}px;
      height: ${height}px;
      overflow: hidden;
    }

    .container {
      padding: ${padding}px;
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: space-evenly;
    }

    .brand-bar {
      display: flex;
      align-items: center;
      gap: ${Math.round(8 * scale)}px;
    }

    .brand-logo {
      width: ${Math.round(24 * scale)}px;
      height: ${Math.round(24 * scale)}px;
      color: ${colors.primary};
    }

    .brand-name {
      font-size: ${Math.round(12 * scale)}px;
      font-weight: 600;
      color: ${colors.primary};
    }

    .header {
      text-align: center;
    }

    .main-title {
      font-size: ${Math.round(32 * scale)}px;
      font-weight: 700;
      color: ${colors.primary};
      margin-bottom: ${Math.round(8 * scale)}px;
    }

    .subtitle {
      font-size: ${Math.round(14 * scale)}px;
      color: ${colors.text};
      opacity: 0.8;
    }

    .comparison-container {
      display: flex;
      ${isVertical ? "flex-direction: column;" : "flex-direction: row;"}
      gap: ${Math.round(24 * scale)}px;
    }

    .comparison-side {
      flex: 1;
      display: flex;
      flex-direction: column;
      border-radius: ${Math.round(16 * scale)}px;
      overflow: hidden;
      background: ${isDarkMode ? "#1e293b" : "white"};
      box-shadow: 0 4px 20px ${isDarkMode ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.08)"};
    }

    .side-header {
      padding: ${Math.round(16 * scale)}px ${Math.round(20 * scale)}px;
      color: white;
      font-size: ${Math.round(18 * scale)}px;
      font-weight: 700;
      text-align: center;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: ${Math.round(10 * scale)}px;
    }

    .side-header-icon {
      width: ${Math.round(24 * scale)}px;
      height: ${Math.round(24 * scale)}px;
    }

    .left-side .side-header {
      background: linear-gradient(135deg, ${leftColor} 0%, ${this.adjustColor(leftColor, 20)} 100%);
    }

    .right-side .side-header {
      background: linear-gradient(135deg, ${rightColor} 0%, ${this.adjustColor(rightColor, -15)} 100%);
    }

    .side-content {
      flex: 1;
      padding: ${Math.round(20 * scale)}px;
      display: flex;
      flex-direction: column;
      gap: ${Math.round(16 * scale)}px;
    }

    .compare-item {
      display: flex;
      align-items: flex-start;
      gap: ${Math.round(12 * scale)}px;
    }

    .compare-icon {
      width: ${Math.round(32 * scale)}px;
      height: ${Math.round(32 * scale)}px;
      border-radius: ${Math.round(8 * scale)}px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .left-side .compare-icon {
      background: ${this.adjustColor(leftColor, 80)};
      color: ${leftColor};
    }

    .right-side .compare-icon {
      background: ${this.adjustColor(rightColor, 60)};
      color: ${rightColor};
    }

    .compare-icon svg {
      width: ${Math.round(18 * scale)}px;
      height: ${Math.round(18 * scale)}px;
    }

    .compare-text {
      flex: 1;
    }

    .compare-title {
      font-size: ${Math.round(14 * scale)}px;
      font-weight: 600;
      color: ${colors.text};
      margin-bottom: ${Math.round(4 * scale)}px;
    }

    .compare-desc {
      font-size: ${Math.round(12 * scale)}px;
      color: ${colors.text};
      opacity: 0.7;
      line-height: 1.4;
    }

    .vs-divider {
      display: flex;
      align-items: center;
      justify-content: center;
      ${isVertical ? `height: ${Math.round(40 * scale)}px;` : `width: ${Math.round(40 * scale)}px; flex-direction: column;`}
    }

    .vs-badge {
      width: ${Math.round(48 * scale)}px;
      height: ${Math.round(48 * scale)}px;
      border-radius: 50%;
      background: linear-gradient(135deg, ${leftColor} 0%, ${rightColor} 100%);
      color: white;
      font-size: ${Math.round(14 * scale)}px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }

    .cta {
      background: linear-gradient(135deg, ${colors.accent} 0%, ${this.adjustColor(colors.accent, -15)} 100%);
      color: white;
      text-align: center;
      padding: ${Math.round(14 * scale)}px;
      border-radius: ${Math.round(10 * scale)}px;
      font-size: ${Math.round(13 * scale)}px;
      font-weight: 600;
      margin-top: ${Math.round(16 * scale)}px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="brand-bar">
      <div class="brand-logo">${this.brandLogoService.getLogoSvg()}</div>
      <span class="brand-name">${APP_CONFIG.brand.fullName}</span>
    </div>

    <div class="header">
      <h1 class="main-title">${this.escapeHtml(content.title)}</h1>
      ${content.subtitle ? `<p class="subtitle">${this.escapeHtml(content.subtitle)}</p>` : ""}
    </div>

    <div class="comparison-container">
      <div class="comparison-side left-side">
        <div class="side-header">
          <span class="side-header-icon">${this.getIcon(leftSections[0]?.iconType || "target")}</span>
          <span>${leftSections[0]?.title || "Option A"}</span>
        </div>
        <div class="side-content">
          ${leftSections
            .map(
              (section, idx) => `
            ${
              section.bullets.length > 0
                ? section.bullets
                    .slice(0, 4)
                    .map(
                      (bullet) => `
                <div class="compare-item">
                  <div class="compare-icon">${this.getIcon(section.iconType || "check")}</div>
                  <div class="compare-text">
                    <div class="compare-desc">${this.escapeHtml(bullet)}</div>
                  </div>
                </div>
              `,
                    )
                    .join("")
                : section.summary
                  ? `
                <div class="compare-item">
                  <div class="compare-icon">${this.getIcon(section.iconType || "check")}</div>
                  <div class="compare-text">
                    ${idx > 0 ? `<div class="compare-title">${this.escapeHtml(section.title)}</div>` : ""}
                    <div class="compare-desc">${this.escapeHtml(section.summary)}</div>
                  </div>
                </div>
              `
                  : ""
            }
          `,
            )
            .join("")}
        </div>
      </div>

      <div class="vs-divider">
        <div class="vs-badge">VS</div>
      </div>

      <div class="comparison-side right-side">
        <div class="side-header">
          <span class="side-header-icon">${this.getIcon(rightSections[0]?.iconType || "chart")}</span>
          <span>${rightSections[0]?.title || "Option B"}</span>
        </div>
        <div class="side-content">
          ${rightSections
            .map(
              (section, idx) => `
            ${
              section.bullets.length > 0
                ? section.bullets
                    .slice(0, 4)
                    .map(
                      (bullet) => `
                <div class="compare-item">
                  <div class="compare-icon">${this.getIcon(section.iconType || "check")}</div>
                  <div class="compare-text">
                    <div class="compare-desc">${this.escapeHtml(bullet)}</div>
                  </div>
                </div>
              `,
                    )
                    .join("")
                : section.summary
                  ? `
                <div class="compare-item">
                  <div class="compare-icon">${this.getIcon(section.iconType || "check")}</div>
                  <div class="compare-text">
                    ${idx > 0 ? `<div class="compare-title">${this.escapeHtml(section.title)}</div>` : ""}
                    <div class="compare-desc">${this.escapeHtml(section.summary)}</div>
                  </div>
                </div>
              `
                  : ""
            }
          `,
            )
            .join("")}
        </div>
      </div>
    </div>

    ${content.callToAction ? `<div class="cta">${this.escapeHtml(content.callToAction)}</div>` : ""}
  </div>
</body>
</html>`;
  }

  /**
   * 统计数据模板 - 突出展示关键数字和指标
   */
  generateStatisticsHTML(
    content: InfographicContent,
    backgroundImageBase64?: string,
    width: number = 1200,
    height: number = 800,
  ): string {
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
    const isDarkMode = styleKey === "dark";
    const scale = width / 1200;
    const padding = Math.round(40 * scale);

    const overlayColor = isDarkMode
      ? "rgba(15, 23, 42, 0.92)"
      : "rgba(247, 249, 252, 0.92)";
    const backgroundStyle = backgroundImageBase64
      ? `background-image: linear-gradient(${overlayColor}, ${overlayColor}), url(${backgroundImageBase64}); background-size: cover; background-position: center;`
      : `background: ${colors.background};`;

    // 收集所有指标（动态支持最多12个，适配TOP 10等场景）
    const allMetrics = content.sections.flatMap((s) => s.metrics || []);
    const totalMetrics = allMetrics.length;

    // 动态布局策略：根据指标数量选择最佳布局
    let mainStats: typeof allMetrics;
    let secondaryStats: typeof allMetrics;
    let mainColumns: number;
    let secondaryColumns: number;

    if (totalMetrics <= 3) {
      // 1-3个：单行大卡片
      mainStats = allMetrics.slice(0, 3);
      secondaryStats = [];
      mainColumns = totalMetrics;
      secondaryColumns = 0;
    } else if (totalMetrics <= 6) {
      // 4-6个：3+3布局（原有逻辑）
      mainStats = allMetrics.slice(0, 3);
      secondaryStats = allMetrics.slice(3, 6);
      mainColumns = 3;
      secondaryColumns = Math.min(secondaryStats.length, 3);
    } else if (totalMetrics <= 9) {
      // 7-9个：3+3+3布局（两行主卡片+一行次卡片）
      mainStats = allMetrics.slice(0, 6);
      secondaryStats = allMetrics.slice(6, 9);
      mainColumns = 3;
      secondaryColumns = Math.min(secondaryStats.length, 3);
    } else {
      // 10-12个：适配TOP 10场景，采用5+5或4+4+4布局
      if (totalMetrics === 10) {
        // TOP 10专用：5+5两行布局
        mainStats = allMetrics.slice(0, 10);
        secondaryStats = [];
        mainColumns = 5;
        secondaryColumns = 0;
      } else {
        // 11-12个：4+4+4三行布局
        mainStats = allMetrics.slice(0, 12);
        secondaryStats = [];
        mainColumns = 4;
        secondaryColumns = 0;
      }
    }

    // 是否使用紧凑布局（超过6个指标时）
    const isCompactLayout = totalMetrics > 6;

    return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600;700&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: ${fontFamily};
      ${backgroundStyle}
      color: ${colors.text};
      width: ${width}px;
      height: ${height}px;
      overflow: hidden;
    }
    .container {
      padding: ${padding}px;
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: space-evenly;
    }
    .brand-bar {
      display: flex;
      align-items: center;
      gap: ${Math.round(8 * scale)}px;
    }
    .brand-logo { width: ${Math.round(24 * scale)}px; height: ${Math.round(24 * scale)}px; color: ${colors.primary}; }
    .brand-name { font-size: ${Math.round(12 * scale)}px; font-weight: 600; color: ${colors.primary}; }
    .header {
      text-align: center;
    }
    .main-title {
      font-size: ${Math.round(36 * scale)}px;
      font-weight: 700;
      color: ${colors.primary};
      margin-bottom: ${Math.round(8 * scale)}px;
    }
    .subtitle { font-size: ${Math.round(16 * scale)}px; color: ${colors.text}; opacity: 0.8; }
    .stats-grid {
      display: flex;
      flex-direction: column;
      gap: ${Math.round(isCompactLayout ? 12 : 24) * scale}px;
      flex: 1;
      justify-content: center;
    }
    .main-stats {
      display: grid;
      grid-template-columns: repeat(${mainColumns}, 1fr);
      gap: ${Math.round(isCompactLayout ? 12 : 24) * scale}px;
    }
    .stat-card {
      background: ${isDarkMode ? "#1e293b" : "white"};
      border-radius: ${Math.round(isCompactLayout ? 12 : 16) * scale}px;
      padding: ${Math.round(isCompactLayout ? 16 : 32) * scale}px;
      text-align: center;
      box-shadow: 0 4px 20px ${isDarkMode ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.08)"};
    }
    .stat-value {
      font-size: ${Math.round(isCompactLayout ? 28 : 48) * scale}px;
      font-weight: 700;
      color: ${colors.primary};
      margin-bottom: ${Math.round(isCompactLayout ? 4 : 8) * scale}px;
    }
    .stat-label {
      font-size: ${Math.round(isCompactLayout ? 11 : 14) * scale}px;
      color: ${colors.text};
      opacity: 0.7;
      line-height: 1.3;
    }
    .stat-comparison {
      font-size: ${Math.round(isCompactLayout ? 10 : 12) * scale}px;
      color: ${colors.accent};
      margin-top: ${Math.round(isCompactLayout ? 4 : 8) * scale}px;
    }
    .secondary-stats {
      display: grid;
      grid-template-columns: repeat(${secondaryColumns || 1}, 1fr);
      gap: ${Math.round(isCompactLayout ? 10 : 16) * scale}px;
    }
    .secondary-stat {
      background: ${colors.primary}10;
      border-radius: ${Math.round(isCompactLayout ? 8 : 12) * scale}px;
      padding: ${Math.round(isCompactLayout ? 12 : 20) * scale}px;
      display: flex;
      align-items: center;
      gap: ${Math.round(isCompactLayout ? 10 : 16) * scale}px;
    }
    .secondary-value {
      font-size: ${Math.round(isCompactLayout ? 20 : 28) * scale}px;
      font-weight: 700;
      color: ${colors.primary};
    }
    .secondary-label {
      font-size: ${Math.round(isCompactLayout ? 11 : 13) * scale}px;
      color: ${colors.text};
    }
    .cta {
      background: linear-gradient(135deg, ${colors.accent} 0%, ${this.adjustColor(colors.accent, -15)} 100%);
      color: white;
      text-align: center;
      padding: ${Math.round(16 * scale)}px;
      border-radius: ${Math.round(10 * scale)}px;
      font-size: ${Math.round(14 * scale)}px;
      font-weight: 600;
      margin-top: ${Math.round(20 * scale)}px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="brand-bar">
      <div class="brand-logo">${this.brandLogoService.getLogoSvg()}</div>
      <span class="brand-name">${APP_CONFIG.brand.fullName}</span>
    </div>
    <div class="header">
      <h1 class="main-title">${this.escapeHtml(content.title)}</h1>
      ${content.subtitle ? `<p class="subtitle">${this.escapeHtml(content.subtitle)}</p>` : ""}
    </div>
    <div class="stats-grid">
      <div class="main-stats">
        ${mainStats
          .map(
            (stat) => `
          <div class="stat-card">
            <div class="stat-value">${this.escapeHtml(stat.value)}</div>
            <div class="stat-label">${this.escapeHtml(stat.label)}</div>
            ${stat.comparison ? `<div class="stat-comparison">${this.escapeHtml(stat.comparison)}</div>` : ""}
          </div>
        `,
          )
          .join("")}
      </div>
      ${
        secondaryStats.length > 0
          ? `
        <div class="secondary-stats">
          ${secondaryStats
            .map(
              (stat) => `
            <div class="secondary-stat">
              <div class="secondary-value">${this.escapeHtml(stat.value)}</div>
              <div class="secondary-label">${this.escapeHtml(stat.label)}</div>
            </div>
          `,
            )
            .join("")}
        </div>
      `
          : ""
      }
    </div>
    ${content.callToAction ? `<div class="cta">${this.escapeHtml(content.callToAction)}</div>` : ""}
  </div>
</body>
</html>`;
  }

  /**
   * 清单模板 - 要点列表、技巧、最佳实践
   */
  generateChecklistHTML(
    content: InfographicContent,
    backgroundImageBase64?: string,
    width: number = 1200,
    height: number = 800,
  ): string {
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
    const isDarkMode = styleKey === "dark";
    const scale = width / 1200;
    const padding = Math.round(40 * scale);
    const isVertical = height > width;

    const overlayColor = isDarkMode
      ? "rgba(15, 23, 42, 0.92)"
      : "rgba(247, 249, 252, 0.92)";
    const backgroundStyle = backgroundImageBase64
      ? `background-image: linear-gradient(${overlayColor}, ${overlayColor}), url(${backgroundImageBase64}); background-size: cover; background-position: center;`
      : `background: ${colors.background};`;

    // 收集所有 bullets
    const allItems = content.sections
      .flatMap((s, idx) =>
        s.bullets.map((b) => ({ text: b, section: s.title, index: idx })),
      )
      .slice(0, isVertical ? 8 : 10);

    const numColumns = isVertical ? 1 : 2;
    const itemsPerColumn = Math.ceil(allItems.length / numColumns);

    return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600;700&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: ${fontFamily};
      ${backgroundStyle}
      color: ${colors.text};
      width: ${width}px;
      height: ${height}px;
      overflow: hidden;
    }
    .container {
      padding: ${padding}px;
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: space-evenly;
    }
    .brand-bar {
      display: flex;
      align-items: center;
      gap: ${Math.round(8 * scale)}px;
    }
    .brand-logo { width: ${Math.round(24 * scale)}px; height: ${Math.round(24 * scale)}px; color: ${colors.primary}; }
    .brand-name { font-size: ${Math.round(12 * scale)}px; font-weight: 600; color: ${colors.primary}; }
    .header {
      background: linear-gradient(135deg, ${colors.primary} 0%, ${this.adjustColor(colors.primary, 20)} 100%);
      color: white;
      padding: ${Math.round(24 * scale)}px;
      border-radius: ${Math.round(12 * scale)}px;
      text-align: center;
    }
    .main-title { font-size: ${Math.round(28 * scale)}px; font-weight: 700; margin-bottom: ${Math.round(6 * scale)}px; }
    .subtitle { font-size: ${Math.round(14 * scale)}px; opacity: 0.9; }
    .checklist-container {
      display: grid;
      grid-template-columns: repeat(${numColumns}, 1fr);
      gap: ${Math.round(20 * scale)}px;
    }
    .checklist-column {
      display: flex;
      flex-direction: column;
      gap: ${Math.round(12 * scale)}px;
    }
    .checklist-item {
      background: ${isDarkMode ? "#1e293b" : "white"};
      border-radius: ${Math.round(12 * scale)}px;
      padding: ${Math.round(16 * scale)}px ${Math.round(20 * scale)}px;
      display: flex;
      align-items: center;
      gap: ${Math.round(14 * scale)}px;
      box-shadow: 0 2px 8px ${isDarkMode ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.05)"};
    }
    .check-icon {
      width: ${Math.round(28 * scale)}px;
      height: ${Math.round(28 * scale)}px;
      min-width: ${Math.round(28 * scale)}px;
      background: ${colors.accent};
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
    }
    .check-icon svg { width: ${Math.round(16 * scale)}px; height: ${Math.round(16 * scale)}px; }
    .item-number {
      font-size: ${Math.round(12 * scale)}px;
      font-weight: 700;
    }
    .item-text {
      font-size: ${Math.round(14 * scale)}px;
      color: ${colors.text};
      line-height: 1.4;
    }
    .cta {
      background: linear-gradient(135deg, ${colors.accent} 0%, ${this.adjustColor(colors.accent, -15)} 100%);
      color: white;
      text-align: center;
      padding: ${Math.round(14 * scale)}px;
      border-radius: ${Math.round(10 * scale)}px;
      font-size: ${Math.round(13 * scale)}px;
      font-weight: 600;
      margin-top: ${Math.round(16 * scale)}px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="brand-bar">
      <div class="brand-logo">${this.brandLogoService.getLogoSvg()}</div>
      <span class="brand-name">${APP_CONFIG.brand.fullName}</span>
    </div>
    <div class="header">
      <h1 class="main-title">${this.escapeHtml(content.title)}</h1>
      ${content.subtitle ? `<p class="subtitle">${this.escapeHtml(content.subtitle)}</p>` : ""}
    </div>
    <div class="checklist-container">
      ${Array.from(
        { length: numColumns },
        (_, colIdx) => `
        <div class="checklist-column">
          ${allItems
            .slice(colIdx * itemsPerColumn, (colIdx + 1) * itemsPerColumn)
            .map(
              (item, idx) => `
            <div class="checklist-item">
              <div class="check-icon">
                <span class="item-number">${colIdx * itemsPerColumn + idx + 1}</span>
              </div>
              <span class="item-text">${this.escapeHtml(item.text)}</span>
            </div>
          `,
            )
            .join("")}
        </div>
      `,
      ).join("")}
    </div>
    ${content.callToAction ? `<div class="cta">${this.escapeHtml(content.callToAction)}</div>` : ""}
  </div>
</body>
</html>`;
  }

  /**
   * 漏斗模板 - 转化流程、筛选过程
   */
  generateFunnelHTML(
    content: InfographicContent,
    backgroundImageBase64?: string,
    width: number = 1200,
    height: number = 800,
  ): string {
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
    const isDarkMode = styleKey === "dark";
    const scale = width / 1200;
    const padding = Math.round(40 * scale);

    const overlayColor = isDarkMode
      ? "rgba(15, 23, 42, 0.92)"
      : "rgba(247, 249, 252, 0.92)";
    const backgroundStyle = backgroundImageBase64
      ? `background-image: linear-gradient(${overlayColor}, ${overlayColor}), url(${backgroundImageBase64}); background-size: cover; background-position: center;`
      : `background: ${colors.background};`;

    const stages = content.sections.slice(0, 5);
    const stageColors = [
      colors.primary,
      this.adjustColor(colors.primary, 30),
      colors.accent,
      this.adjustColor(colors.accent, 20),
      this.adjustColor(colors.accent, 40),
    ];

    return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600;700&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: ${fontFamily};
      ${backgroundStyle}
      color: ${colors.text};
      width: ${width}px;
      height: ${height}px;
      overflow: hidden;
    }
    .container {
      padding: ${padding}px;
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: space-evenly;
    }
    .brand-bar {
      display: flex;
      align-items: center;
      gap: ${Math.round(8 * scale)}px;
    }
    .brand-logo { width: ${Math.round(24 * scale)}px; height: ${Math.round(24 * scale)}px; color: ${colors.primary}; }
    .brand-name { font-size: ${Math.round(12 * scale)}px; font-weight: 600; color: ${colors.primary}; }
    .header { text-align: center; }
    .main-title { font-size: ${Math.round(32 * scale)}px; font-weight: 700; color: ${colors.primary}; margin-bottom: ${Math.round(8 * scale)}px; }
    .subtitle { font-size: ${Math.round(14 * scale)}px; color: ${colors.text}; opacity: 0.8; }
    .funnel-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: ${Math.round(4 * scale)}px;
    }
    .funnel-stage {
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: 600;
      position: relative;
      clip-path: polygon(5% 0%, 95% 0%, 100% 100%, 0% 100%);
    }
    .stage-content {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 80%;
      padding: ${Math.round(8 * scale)}px 0;
    }
    .stage-title { font-size: ${Math.round(16 * scale)}px; }
    .stage-value { font-size: ${Math.round(20 * scale)}px; font-weight: 700; }
    .cta {
      background: linear-gradient(135deg, ${colors.accent} 0%, ${this.adjustColor(colors.accent, -15)} 100%);
      color: white;
      text-align: center;
      padding: ${Math.round(14 * scale)}px;
      border-radius: ${Math.round(10 * scale)}px;
      font-size: ${Math.round(13 * scale)}px;
      font-weight: 600;
      margin-top: ${Math.round(16 * scale)}px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="brand-bar">
      <div class="brand-logo">${this.brandLogoService.getLogoSvg()}</div>
      <span class="brand-name">${APP_CONFIG.brand.fullName}</span>
    </div>
    <div class="header">
      <h1 class="main-title">${this.escapeHtml(content.title)}</h1>
      ${content.subtitle ? `<p class="subtitle">${this.escapeHtml(content.subtitle)}</p>` : ""}
    </div>
    <div class="funnel-container">
      ${stages
        .map((stage, idx) => {
          const widthPercent = 100 - idx * 15;
          const stageHeight = Math.round(
            (height - padding * 2 - 150) / stages.length,
          );
          return `
          <div class="funnel-stage" style="width: ${widthPercent}%; height: ${stageHeight}px; background: ${stageColors[idx % stageColors.length]};">
            <div class="stage-content">
              <span class="stage-title">${this.escapeHtml(stage.title)}</span>
              ${stage.metrics?.[0] ? `<span class="stage-value">${this.escapeHtml(stage.metrics[0].value)}</span>` : ""}
            </div>
          </div>
        `;
        })
        .join("")}
    </div>
    ${content.callToAction ? `<div class="cta">${this.escapeHtml(content.callToAction)}</div>` : ""}
  </div>
</body>
</html>`;
  }

  /**
   * 矩阵模板 - 2x2 象限分析
   */
  generateMatrixHTML(
    content: InfographicContent,
    backgroundImageBase64?: string,
    width: number = 1200,
    height: number = 800,
  ): string {
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
    const isDarkMode = styleKey === "dark";
    const scale = width / 1200;
    const padding = Math.round(40 * scale);

    const overlayColor = isDarkMode
      ? "rgba(15, 23, 42, 0.92)"
      : "rgba(247, 249, 252, 0.92)";
    const backgroundStyle = backgroundImageBase64
      ? `background-image: linear-gradient(${overlayColor}, ${overlayColor}), url(${backgroundImageBase64}); background-size: cover; background-position: center;`
      : `background: ${colors.background};`;

    const quadrants = content.sections.slice(0, 4);
    const quadrantColors = [
      { bg: `${colors.primary}15`, border: colors.primary },
      { bg: `${colors.accent}15`, border: colors.accent },
      {
        bg: `${this.adjustColor(colors.primary, 40)}15`,
        border: this.adjustColor(colors.primary, 40),
      },
      {
        bg: `${this.adjustColor(colors.accent, 30)}15`,
        border: this.adjustColor(colors.accent, 30),
      },
    ];

    return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600;700&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: ${fontFamily};
      ${backgroundStyle}
      color: ${colors.text};
      width: ${width}px;
      height: ${height}px;
      overflow: hidden;
    }
    .container {
      padding: ${padding}px;
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: space-evenly;
    }
    .brand-bar {
      display: flex;
      align-items: center;
      gap: ${Math.round(8 * scale)}px;
    }
    .brand-logo { width: ${Math.round(24 * scale)}px; height: ${Math.round(24 * scale)}px; color: ${colors.primary}; }
    .brand-name { font-size: ${Math.round(12 * scale)}px; font-weight: 600; color: ${colors.primary}; }
    .header { text-align: center; }
    .main-title { font-size: ${Math.round(28 * scale)}px; font-weight: 700; color: ${colors.primary}; margin-bottom: ${Math.round(6 * scale)}px; }
    .subtitle { font-size: ${Math.round(14 * scale)}px; color: ${colors.text}; opacity: 0.8; }
    .matrix-container {
      display: grid;
      grid-template-columns: 1fr 1fr;
      grid-template-rows: 1fr 1fr;
      gap: ${Math.round(16 * scale)}px;
      position: relative;
    }
    .quadrant {
      border-radius: ${Math.round(12 * scale)}px;
      padding: ${Math.round(20 * scale)}px;
      display: flex;
      flex-direction: column;
    }
    .quadrant-title {
      font-size: ${Math.round(18 * scale)}px;
      font-weight: 700;
      margin-bottom: ${Math.round(12 * scale)}px;
      display: flex;
      align-items: center;
      gap: ${Math.round(8 * scale)}px;
    }
    .quadrant-icon {
      width: ${Math.round(24 * scale)}px;
      height: ${Math.round(24 * scale)}px;
    }
    .quadrant-bullets {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: ${Math.round(8 * scale)}px;
    }
    .quadrant-bullet {
      font-size: ${Math.round(13 * scale)}px;
      display: flex;
      align-items: flex-start;
      gap: ${Math.round(8 * scale)}px;
    }
    .bullet-dot {
      width: ${Math.round(6 * scale)}px;
      height: ${Math.round(6 * scale)}px;
      border-radius: 50%;
      margin-top: ${Math.round(6 * scale)}px;
      flex-shrink: 0;
    }
    .axis-label {
      position: absolute;
      font-size: ${Math.round(12 * scale)}px;
      font-weight: 600;
      color: ${colors.text};
      opacity: 0.6;
    }
    .axis-x { bottom: -${Math.round(20 * scale)}px; left: 50%; transform: translateX(-50%); }
    .axis-y { left: -${Math.round(30 * scale)}px; top: 50%; transform: rotate(-90deg) translateX(-50%); transform-origin: left center; }
    .cta {
      background: linear-gradient(135deg, ${colors.accent} 0%, ${this.adjustColor(colors.accent, -15)} 100%);
      color: white;
      text-align: center;
      padding: ${Math.round(12 * scale)}px;
      border-radius: ${Math.round(10 * scale)}px;
      font-size: ${Math.round(13 * scale)}px;
      font-weight: 600;
      margin-top: ${Math.round(16 * scale)}px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="brand-bar">
      <div class="brand-logo">${this.brandLogoService.getLogoSvg()}</div>
      <span class="brand-name">${APP_CONFIG.brand.fullName}</span>
    </div>
    <div class="header">
      <h1 class="main-title">${this.escapeHtml(content.title)}</h1>
      ${content.subtitle ? `<p class="subtitle">${this.escapeHtml(content.subtitle)}</p>` : ""}
    </div>
    <div class="matrix-container">
      ${quadrants
        .map(
          (q, idx) => `
        <div class="quadrant" style="background: ${quadrantColors[idx].bg}; border: 2px solid ${quadrantColors[idx].border};">
          <div class="quadrant-title" style="color: ${quadrantColors[idx].border};">
            <span class="quadrant-icon">${this.getIcon(q.iconType)}</span>
            ${this.escapeHtml(q.title)}
          </div>
          <ul class="quadrant-bullets">
            ${(q.bullets || [])
              .slice(0, 3)
              .map(
                (b) => `
              <li class="quadrant-bullet">
                <span class="bullet-dot" style="background: ${quadrantColors[idx].border};"></span>
                <span>${this.escapeHtml(b)}</span>
              </li>
            `,
              )
              .join("")}
          </ul>
        </div>
      `,
        )
        .join("")}
    </div>
    ${content.callToAction ? `<div class="cta">${this.escapeHtml(content.callToAction)}</div>` : ""}
  </div>
</body>
</html>`;
  }

  /**
   * 排行榜/横向比较模板 - 表格式布局，支持多实体多指标的横向对比
   * 适用场景：TOP 10排名、企业对比、产品横评等
   */
  generateRankingHTML(
    content: InfographicContent,
    backgroundImageBase64?: string,
    width: number = 1200,
    height: number = 800,
  ): string {
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
    const isDarkMode =
      styleKey === "dark" ||
      styleKey === "genspark" ||
      styleKey === "tech_gradient";
    const scale = width / 1200;
    const padding = Math.round(32 * scale);

    const overlayColor = isDarkMode
      ? "rgba(15, 23, 42, 0.95)"
      : "rgba(247, 249, 252, 0.95)";
    const backgroundStyle = backgroundImageBase64
      ? `background-image: linear-gradient(${overlayColor}, ${overlayColor}), url(${backgroundImageBase64}); background-size: cover; background-position: center;`
      : `background: ${colors.background};`;

    // 提取所有sections作为排名项（每个section代表一个实体）
    const rankingItems = content.sections.slice(0, 15); // 最多15个
    const itemCount = rankingItems.length;

    // 收集所有唯一的指标标签（用作表头）
    const allMetricLabels = new Set<string>();
    rankingItems.forEach((item) => {
      (item.metrics || []).forEach((m) => allMetricLabels.add(m.label));
    });
    const metricColumns = Array.from(allMetricLabels).slice(0, 5); // 最多5列指标

    // 根据数据量调整样式
    const isCompact = itemCount > 10;
    const rowHeight = isCompact ? 40 : 50;
    const fontSize = isCompact ? 11 : 13;
    const headerFontSize = isCompact ? 10 : 12;

    // 计算表格区域高度
    const headerHeight = 80 * scale; // 标题区域
    const tableHeaderHeight = 36 * scale;
    const availableHeight =
      height - headerHeight - padding * 2 - tableHeaderHeight - 40;
    const actualRowHeight = Math.min(
      rowHeight * scale,
      availableHeight / itemCount,
    );

    return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600;700&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: ${fontFamily};
      ${backgroundStyle}
      color: ${colors.text};
      width: ${width}px;
      height: ${height}px;
      overflow: hidden;
    }
    .container {
      padding: ${padding}px;
      height: 100%;
      display: flex;
      flex-direction: column;
    }
    .brand-bar {
      display: flex;
      align-items: center;
      gap: ${Math.round(8 * scale)}px;
      margin-bottom: ${Math.round(8 * scale)}px;
    }
    .brand-logo { width: ${Math.round(20 * scale)}px; height: ${Math.round(20 * scale)}px; color: ${colors.primary}; }
    .brand-name { font-size: ${Math.round(11 * scale)}px; font-weight: 600; color: ${colors.primary}; }
    .header {
      text-align: center;
      margin-bottom: ${Math.round(16 * scale)}px;
    }
    .main-title {
      font-size: ${Math.round(28 * scale)}px;
      font-weight: 700;
      color: ${colors.primary};
      margin-bottom: ${Math.round(4 * scale)}px;
    }
    .subtitle {
      font-size: ${Math.round(14 * scale)}px;
      color: ${colors.text};
      opacity: 0.7;
    }
    .ranking-table {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: ${isDarkMode ? "rgba(30, 41, 59, 0.8)" : "white"};
      border-radius: ${Math.round(12 * scale)}px;
      overflow: hidden;
      box-shadow: 0 4px 20px ${isDarkMode ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.08)"};
    }
    .table-header {
      display: grid;
      grid-template-columns: ${Math.round(40 * scale)}px 1.5fr ${metricColumns.map(() => "1fr").join(" ")};
      background: ${colors.primary};
      color: white;
      font-weight: 600;
      font-size: ${Math.round(headerFontSize * scale)}px;
      padding: ${Math.round(10 * scale)}px ${Math.round(12 * scale)}px;
      gap: ${Math.round(8 * scale)}px;
    }
    .table-header-cell {
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
    }
    .table-header-cell:nth-child(2) {
      justify-content: flex-start;
    }
    .table-body {
      flex: 1;
      overflow: hidden;
    }
    .table-row {
      display: grid;
      grid-template-columns: ${Math.round(40 * scale)}px 1.5fr ${metricColumns.map(() => "1fr").join(" ")};
      padding: ${Math.round(8 * scale)}px ${Math.round(12 * scale)}px;
      gap: ${Math.round(8 * scale)}px;
      border-bottom: 1px solid ${isDarkMode ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.06)"};
      height: ${actualRowHeight}px;
      align-items: center;
      transition: background 0.2s;
    }
    .table-row:nth-child(odd) {
      background: ${isDarkMode ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.01)"};
    }
    .table-row:hover {
      background: ${isDarkMode ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)"};
    }
    .rank-badge {
      width: ${Math.round(28 * scale)}px;
      height: ${Math.round(28 * scale)}px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: ${Math.round(12 * scale)}px;
    }
    .rank-1 { background: linear-gradient(135deg, #FFD700, #FFA500); color: #000; }
    .rank-2 { background: linear-gradient(135deg, #C0C0C0, #A0A0A0); color: #000; }
    .rank-3 { background: linear-gradient(135deg, #CD7F32, #A0522D); color: #fff; }
    .rank-other { background: ${colors.primary}20; color: ${colors.primary}; }
    .entity-name {
      font-weight: 600;
      font-size: ${Math.round(fontSize * scale)}px;
      color: ${colors.text};
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .metric-cell {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
    }
    .metric-value {
      font-weight: 700;
      font-size: ${Math.round((fontSize + 2) * scale)}px;
      color: ${colors.primary};
    }
    .metric-comparison {
      font-size: ${Math.round(10 * scale)}px;
      color: ${colors.accent};
      margin-top: ${Math.round(2 * scale)}px;
    }
    .positive { color: #10b981; }
    .negative { color: #ef4444; }
    .cta {
      background: linear-gradient(135deg, ${colors.accent} 0%, ${this.adjustColor(colors.accent, -15)} 100%);
      color: white;
      text-align: center;
      padding: ${Math.round(10 * scale)}px;
      border-radius: ${Math.round(8 * scale)}px;
      font-size: ${Math.round(12 * scale)}px;
      font-weight: 600;
      margin-top: ${Math.round(12 * scale)}px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="brand-bar">
      <div class="brand-logo">${this.brandLogoService.getLogoSvg()}</div>
      <span class="brand-name">${APP_CONFIG.brand.fullName}</span>
    </div>
    <div class="header">
      <h1 class="main-title">${this.escapeHtml(content.title)}</h1>
      ${content.subtitle ? `<p class="subtitle">${this.escapeHtml(content.subtitle)}</p>` : ""}
    </div>
    <div class="ranking-table">
      <div class="table-header">
        <div class="table-header-cell">#</div>
        <div class="table-header-cell">名称</div>
        ${metricColumns.map((label) => `<div class="table-header-cell">${this.escapeHtml(label)}</div>`).join("")}
      </div>
      <div class="table-body">
        ${rankingItems
          .map((item, idx) => {
            const rank = idx + 1;
            const rankClass = rank <= 3 ? `rank-${rank}` : "rank-other";

            // 获取该实体的各个指标值
            const metricValues = metricColumns.map((label) => {
              const metric = (item.metrics || []).find(
                (m) => m.label === label,
              );
              return metric || { value: "-", comparison: "" };
            });

            return `
              <div class="table-row">
                <div class="rank-badge ${rankClass}">${rank}</div>
                <div class="entity-name" title="${this.escapeHtml(item.title || "")}">${this.escapeHtml(item.title || `#${rank}`)}</div>
                ${metricValues
                  .map((metric) => {
                    const compClass = metric.comparison?.startsWith("+")
                      ? "positive"
                      : metric.comparison?.startsWith("-")
                        ? "negative"
                        : "";
                    return `
                      <div class="metric-cell">
                        <span class="metric-value">${this.escapeHtml(metric.value)}</span>
                        ${metric.comparison ? `<span class="metric-comparison ${compClass}">${this.escapeHtml(metric.comparison)}</span>` : ""}
                      </div>
                    `;
                  })
                  .join("")}
              </div>
            `;
          })
          .join("")}
      </div>
    </div>
    ${content.callToAction ? `<div class="cta">${this.escapeHtml(content.callToAction)}</div>` : ""}
  </div>
</body>
</html>`;
  }

  async generateInfographic(
    content: InfographicContent,
    options?: {
      width?: number;
      height?: number;
      backgroundImageBase64?: string;
    },
  ): Promise<string> {
    const width = options?.width || 1200;
    const height = options?.height || 800;
    const templateLayout = content.styleOptions?.templateLayout || "cards";

    this.logger.log(
      `[InfographicTemplate] Generating infographic: "${content.title}" with ${content.sections.length} sections, size: ${width}x${height}, template: ${templateLayout}`,
    );

    let html: string;

    // 根据模板类型选择渲染方法
    switch (templateLayout) {
      case "center_visual":
        html = this.generateCenterVisualHTML(
          content,
          options?.backgroundImageBase64,
          width,
          height,
        );
        break;
      case "timeline":
        html = this.generateTimelineHTML(
          content,
          options?.backgroundImageBase64,
          width,
          height,
        );
        break;
      case "comparison":
        html = this.generateComparisonHTML(
          content,
          options?.backgroundImageBase64,
          width,
          height,
        );
        break;
      case "statistics":
        html = this.generateStatisticsHTML(
          content,
          options?.backgroundImageBase64,
          width,
          height,
        );
        break;
      case "checklist":
        html = this.generateChecklistHTML(
          content,
          options?.backgroundImageBase64,
          width,
          height,
        );
        break;
      case "funnel":
        html = this.generateFunnelHTML(
          content,
          options?.backgroundImageBase64,
          width,
          height,
        );
        break;
      case "matrix":
        html = this.generateMatrixHTML(
          content,
          options?.backgroundImageBase64,
          width,
          height,
        );
        break;
      case "ranking":
        html = this.generateRankingHTML(
          content,
          options?.backgroundImageBase64,
          width,
          height,
        );
        break;
      case "cards":
      default:
        html = this.generateConsultingInfographicHTML(
          content,
          options?.backgroundImageBase64,
          width,
          height,
        );
        break;
    }

    const imageBase64 = await this.renderToImage(html, width, height);

    this.logger.log(
      `[InfographicTemplate] Infographic generated successfully with template: ${templateLayout}`,
    );
    return imageBase64;
  }
}

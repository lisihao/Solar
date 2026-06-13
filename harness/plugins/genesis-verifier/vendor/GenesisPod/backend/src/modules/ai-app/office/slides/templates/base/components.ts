/**
 * Slides Engine v3.0 - Component System
 *
 * 高级视觉组件定义
 * 包含洞察框、KPI卡片等专业组件
 */

// ============================================================================
// Insight Box Types (洞察框组件)
// ============================================================================

export type InsightType = "insight" | "warning" | "tip" | "summary";

export interface InsightBoxConfig {
  type: InsightType;
  text: string;
  icon?: string;
  position?: "bottom" | "inline";
}

/**
 * 洞察框颜色配置
 * 背景使用 10% 不透明度，文字使用高对比度颜色
 */
export const INSIGHT_COLORS: Record<
  InsightType,
  { bg: string; bar: string; text: string; bgOpacity: number }
> = {
  insight: { bg: "#10B981", bar: "#10B981", text: "#D1FAE5", bgOpacity: 0.1 },
  warning: { bg: "#F59E0B", bar: "#F59E0B", text: "#FEF3C7", bgOpacity: 0.1 },
  tip: { bg: "#3B82F6", bar: "#3B82F6", text: "#DBEAFE", bgOpacity: 0.1 },
  summary: { bg: "#D4AF37", bar: "#D4AF37", text: "#FEF9C3", bgOpacity: 0.1 },
};

/**
 * 洞察框默认图标
 */
export const INSIGHT_ICONS: Record<InsightType, string> = {
  insight: "💡",
  warning: "⚠️",
  tip: "💭",
  summary: "📌",
};

// ============================================================================
// KPI Card Types (KPI统计卡片)
// ============================================================================

export type KpiTrend = "up" | "down" | "flat";
export type KpiSize = "small" | "medium" | "large";

export interface KpiCardConfig {
  value: string;
  label: string;
  unit?: string;
  trend?: KpiTrend;
  trendValue?: string;
  size?: KpiSize;
  color?: string;
}

/**
 * KPI卡片趋势图标
 */
export const KPI_TREND_ICONS: Record<KpiTrend, string> = {
  up: "↑",
  down: "↓",
  flat: "→",
};

/**
 * KPI卡片趋势颜色
 */
export const KPI_TREND_COLORS: Record<KpiTrend, string> = {
  up: "#36B37E", // 绿色表示增长
  down: "#FF5630", // 红色表示下降
  flat: "#94A3B8", // 灰色表示持平
};

/**
 * KPI卡片尺寸配置
 */
export const KPI_SIZE_CONFIG: Record<
  KpiSize,
  { valueFontSize: number; labelFontSize: number; height: number }
> = {
  small: { valueFontSize: 24, labelFontSize: 10, height: 1.2 },
  medium: { valueFontSize: 32, labelFontSize: 12, height: 1.5 },
  large: { valueFontSize: 42, labelFontSize: 14, height: 2 },
};

// ============================================================================
// Brand Header Types (品牌颜色头部)
// ============================================================================

export interface BrandHeaderConfig {
  color: string;
  title: string;
  subtitle?: string;
  logo?: string; // base64 或 URL
  logoOpacity?: number;
}

/**
 * 预设品牌颜色
 */
export const BRAND_COLORS = {
  // 常见品牌色
  aws: { primary: "#232F3E", accent: "#FF9900" },
  google: { primary: "#4285F4", accent: "#34A853" },
  microsoft: { primary: "#00A4EF", accent: "#7FBA00" },
  anthropic: { primary: "#D4A574", accent: "#1A1A2E" },

  // 状态色
  danger: { primary: "#991B1B", accent: "#FEE2E2" },
  warning: { primary: "#D97706", accent: "#FEF3C7" },
  success: { primary: "#047857", accent: "#D1FAE5" },
  info: { primary: "#1D4ED8", accent: "#DBEAFE" },
} as const;

// ============================================================================
// Footer Types (页脚组件)
// ============================================================================

export interface FooterConfig {
  pageNumber: number;
  brand?: string;
  icon?: string;
  showDivider?: boolean;
}

/**
 * 页脚默认配置
 */
export const FOOTER_DEFAULTS = {
  y: 6.6, // 英寸
  height: 0.25, // 英寸
  fontSize: 10,
  color: "94A3B8",
  icon: "🔷",
} as const;

// ============================================================================
// CSS Generation Functions
// ============================================================================

/**
 * 生成洞察框CSS样式
 */
export function generateInsightBoxCSS(config: InsightBoxConfig): string {
  const colors = INSIGHT_COLORS[config.type];

  return `
    .insight-box-${config.type} {
      position: relative;
      background: ${colors.bg}${Math.round(colors.bgOpacity * 255)
        .toString(16)
        .padStart(2, "0")};
      padding: 12px 16px 12px 20px;
      border-radius: 4px;
      margin-top: 16px;
    }

    .insight-box-${config.type}::before {
      content: '';
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 4px;
      background: ${colors.bar};
      border-radius: 4px 0 0 4px;
    }

    .insight-box-${config.type} .insight-icon {
      margin-right: 8px;
    }

    .insight-box-${config.type} .insight-text {
      color: ${colors.text};
      font-size: 11px;
      line-height: 1.5;
    }
  `;
}

/**
 * 生成KPI卡片CSS样式
 */
export function generateKpiCardCSS(config: KpiCardConfig): string {
  const size = config.size || "medium";
  const sizeConfig = KPI_SIZE_CONFIG[size];
  const trendColor = config.trend ? KPI_TREND_COLORS[config.trend] : undefined;

  return `
    .kpi-card {
      text-align: center;
      padding: 8px;
    }

    .kpi-card .kpi-value {
      font-size: ${sizeConfig.valueFontSize}px;
      font-weight: bold;
      color: ${config.color || "#F8FAFC"};
    }

    .kpi-card .kpi-unit {
      font-size: ${sizeConfig.valueFontSize * 0.5}px;
      color: #94A3B8;
      margin-left: 2px;
    }

    .kpi-card .kpi-label {
      font-size: ${sizeConfig.labelFontSize}px;
      color: #94A3B8;
      margin-top: 4px;
    }

    ${
      trendColor
        ? `
    .kpi-card .kpi-trend {
      font-size: ${sizeConfig.labelFontSize - 1}px;
      color: ${trendColor};
      margin-top: 2px;
    }
    `
        : ""
    }
  `;
}

/**
 * 生成品牌头部CSS样式
 */
export function generateBrandHeaderCSS(config: BrandHeaderConfig): string {
  return `
    .brand-header {
      background: ${config.color};
      padding: 16px;
      position: relative;
      overflow: hidden;
    }

    .brand-header .brand-title {
      font-size: 18px;
      font-weight: bold;
      color: #FFFFFF;
    }

    .brand-header .brand-subtitle {
      font-size: 12px;
      color: rgba(255, 255, 255, 0.8);
      margin-top: 4px;
    }

    ${
      config.logo
        ? `
    .brand-header .brand-logo {
      position: absolute;
      right: 16px;
      top: 50%;
      transform: translateY(-50%);
      opacity: ${config.logoOpacity || 0.3};
      max-height: 40px;
    }
    `
        : ""
    }
  `;
}

// ============================================================================
// HTML Generation Functions
// ============================================================================

/**
 * 生成洞察框HTML
 */
export function generateInsightBoxHTML(config: InsightBoxConfig): string {
  const icon = config.icon || INSIGHT_ICONS[config.type];

  return `
    <div class="insight-box-${config.type}">
      <span class="insight-icon">${icon}</span>
      <span class="insight-text">${config.text}</span>
    </div>
  `;
}

/**
 * 生成KPI卡片HTML
 */
export function generateKpiCardHTML(config: KpiCardConfig): string {
  const trendIcon = config.trend ? KPI_TREND_ICONS[config.trend] : "";
  const trendHtml =
    config.trend && config.trendValue
      ? `<div class="kpi-trend">${trendIcon} ${config.trendValue}</div>`
      : "";

  return `
    <div class="kpi-card">
      <div class="kpi-value">
        ${config.value}${config.unit ? `<span class="kpi-unit">${config.unit}</span>` : ""}
      </div>
      <div class="kpi-label">${config.label}</div>
      ${trendHtml}
    </div>
  `;
}

/**
 * 生成品牌头部HTML
 */
export function generateBrandHeaderHTML(config: BrandHeaderConfig): string {
  const logoHtml = config.logo
    ? `<img class="brand-logo" src="${config.logo}" alt="Logo" />`
    : "";

  const subtitleHtml = config.subtitle
    ? `<div class="brand-subtitle">${config.subtitle}</div>`
    : "";

  return `
    <div class="brand-header">
      <div class="brand-title">${config.title}</div>
      ${subtitleHtml}
      ${logoHtml}
    </div>
  `;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * 获取洞察类型的颜色配置
 */
export function getInsightColors(type: InsightType) {
  return INSIGHT_COLORS[type];
}

/**
 * 获取KPI趋势配置
 */
export function getKpiTrendConfig(trend: KpiTrend) {
  return {
    icon: KPI_TREND_ICONS[trend],
    color: KPI_TREND_COLORS[trend],
  };
}

/**
 * 格式化KPI值（添加千位分隔符等）
 */
export function formatKpiValue(value: number | string): string {
  if (typeof value === "number") {
    return value.toLocaleString("zh-CN");
  }
  return value;
}

/**
 * 从预设获取品牌颜色
 */
export function getBrandColor(
  brandKey: keyof typeof BRAND_COLORS,
): (typeof BRAND_COLORS)[typeof brandKey] {
  return BRAND_COLORS[brandKey];
}

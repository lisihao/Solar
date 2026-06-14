/**
 * 统一导出系统 - 主题配置类型
 */

// ==================== 主题配置 ====================

export interface ThemeConfig {
  // 颜色方案
  colors: ColorPalette;

  // 字体配置
  fonts: FontsConfig;

  // 间距配置
  spacing: SpacingConfig;

  // 装饰元素
  decorations: DecorationsConfig;
}

export interface ColorPalette {
  // 主要颜色
  primary: string;
  secondary: string;
  accent: string;

  // 背景
  background: string;
  backgroundAlt?: string;

  // 文字
  text: string;
  textLight: string;
  textSecondary?: string;
  heading: string;

  // 功能色
  link: string;
  border: string;
  divider?: string;

  // 状态色
  success: string;
  warning: string;
  error: string;
  info?: string;
}

export interface FontsConfig {
  heading: FontConfig;
  body: FontConfig;
  mono: FontConfig;
}

export interface FontConfig {
  family: string;
  size: number;
  weight: number;
  lineHeight: number;
}

export interface SpacingConfig {
  // 页边距
  page: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };

  // 内容间距
  section: number;
  paragraph: number;
  list: number;
  heading: number;
}

export interface DecorationsConfig {
  // 页眉页脚
  showHeaderLine: boolean;
  showFooterLine: boolean;
  showPageNumbers: boolean;
  pageNumberPosition: "bottom-center" | "bottom-right" | "top-right";

  // 标题样式
  headingUnderline: boolean;
  headingBorder: boolean;

  // 其他装饰
  showTableBorders: boolean;
  roundedCorners: boolean;
  shadowEffects: boolean;
}

// ==================== 布局配置 ====================

export interface LayoutConfig {
  // 页面设置
  pageSize: "A4" | "A3" | "Letter" | "Legal";
  orientation: "portrait" | "landscape";

  // 封面
  cover?: CoverLayoutConfig;

  // 页眉页脚
  header?: HeaderFooterConfig;
  footer?: HeaderFooterConfig;

  // 章节布局
  sections?: SectionLayoutConfig;
}

export interface CoverLayoutConfig {
  enabled: boolean;
  style: "minimal" | "standard" | "prominent";
  showLogo: boolean;
  showDate: boolean;
  showAuthor: boolean;
}

export interface HeaderFooterConfig {
  enabled: boolean;
  height: number;
  content?: string;
  showOnFirstPage: boolean;
}

export interface SectionLayoutConfig {
  startOnNewPage: boolean;
  numberHeadings: boolean;
  indentLevel: number;
}

// ==================== 预设主题 ====================

export const DEFAULT_THEME: ThemeConfig = {
  colors: {
    primary: "#6366f1",
    secondary: "#8b5cf6",
    accent: "#ec4899",
    background: "#ffffff",
    backgroundAlt: "#f9fafb",
    text: "#1f2937",
    textLight: "#6b7280",
    textSecondary: "#9ca3af",
    heading: "#111827",
    link: "#6366f1",
    border: "#e5e7eb",
    divider: "#f3f4f6",
    success: "#10b981",
    warning: "#f59e0b",
    error: "#ef4444",
    info: "#3b82f6",
  },
  fonts: {
    heading: {
      family: "Inter, system-ui, sans-serif",
      size: 24,
      weight: 700,
      lineHeight: 1.3,
    },
    body: {
      family: "Inter, system-ui, sans-serif",
      size: 14,
      weight: 400,
      lineHeight: 1.6,
    },
    mono: {
      family: "JetBrains Mono, monospace",
      size: 13,
      weight: 400,
      lineHeight: 1.5,
    },
  },
  spacing: {
    page: { top: 72, right: 72, bottom: 72, left: 72 },
    section: 24,
    paragraph: 12,
    list: 8,
    heading: 16,
  },
  decorations: {
    showHeaderLine: false,
    showFooterLine: false,
    showPageNumbers: true,
    pageNumberPosition: "bottom-center",
    headingUnderline: false,
    headingBorder: false,
    showTableBorders: true,
    roundedCorners: true,
    shadowEffects: false,
  },
};

export const DEFAULT_LAYOUT: LayoutConfig = {
  pageSize: "A4",
  orientation: "portrait",
  cover: {
    enabled: true,
    style: "standard",
    showLogo: false,
    showDate: true,
    showAuthor: true,
  },
  header: {
    enabled: false,
    height: 40,
    showOnFirstPage: false,
  },
  footer: {
    enabled: true,
    height: 40,
    showOnFirstPage: false,
  },
  sections: {
    startOnNewPage: false,
    numberHeadings: true,
    indentLevel: 0,
  },
};

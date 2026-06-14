/**
 * 统一主题系统 - AI Office 共享模块
 * 为 Slides 和 Docs 提供一致的视觉设计语言
 */

// ============================================================================
// 设计令牌 (Design Tokens)
// ============================================================================

/**
 * 颜色系统
 */
export interface ColorPalette {
  // 主色调
  primary: string;
  primaryLight: string;
  primaryDark: string;

  // 辅助色
  secondary: string;
  secondaryLight: string;
  secondaryDark: string;

  // 强调色
  accent: string;
  accentLight: string;
  accentDark: string;

  // 背景色
  background: string;
  surface: string;
  surfaceVariant: string;

  // 文字色
  text: string;
  textSecondary: string;
  textTertiary: string;
  textOnPrimary: string;
  textOnSecondary: string;

  // 边框色
  border: string;
  borderLight: string;
  divider: string;

  // 语义色
  success: string;
  successLight: string;
  warning: string;
  warningLight: string;
  error: string;
  errorLight: string;
  info: string;
  infoLight: string;

  // 图表色板
  chart: string[];
}

/**
 * 字体系统
 */
export interface Typography {
  // 字体家族
  fontFamily: {
    primary: string;
    secondary: string;
    monospace: string;
  };

  // 字号系统
  fontSize: {
    xs: number; // 10
    sm: number; // 12
    base: number; // 14
    md: number; // 16
    lg: number; // 18
    xl: number; // 20
    "2xl": number; // 24
    "3xl": number; // 30
    "4xl": number; // 36
    "5xl": number; // 48
  };

  // 字重
  fontWeight: {
    light: number;
    normal: number;
    medium: number;
    semibold: number;
    bold: number;
  };

  // 行高
  lineHeight: {
    tight: number;
    normal: number;
    relaxed: number;
  };

  // 字间距
  letterSpacing: {
    tight: string;
    normal: string;
    wide: string;
  };
}

/**
 * 间距系统
 */
export interface Spacing {
  // 基础间距单位
  unit: number; // 4px

  // 预设间距
  xs: number; // 4
  sm: number; // 8
  md: number; // 16
  lg: number; // 24
  xl: number; // 32
  "2xl": number; // 48
  "3xl": number; // 64

  // 页面边距
  page: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };

  // 章节间距
  section: number;

  // 段落间距
  paragraph: number;
}

/**
 * 圆角系统
 */
export interface BorderRadius {
  none: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
  full: string;
}

/**
 * 阴影系统
 */
export interface Shadows {
  none: string;
  sm: string;
  md: string;
  lg: string;
  xl: string;
}

// ============================================================================
// 完整主题定义
// ============================================================================

/**
 * 完整主题配置
 */
export interface Theme {
  id: string;
  name: string;
  description?: string;
  category: ThemeCategory;
  colors: ColorPalette;
  typography: Typography;
  spacing: Spacing;
  borderRadius: BorderRadius;
  shadows: Shadows;

  // Slides 专用配置
  slides?: SlideThemeConfig;

  // Docs 专用配置
  docs?: DocsThemeConfig;
}

/**
 * 主题分类
 */
export enum ThemeCategory {
  PROFESSIONAL = "professional", // 商务专业
  MODERN = "modern", // 现代简约
  CREATIVE = "creative", // 创意活泼
  ACADEMIC = "academic", // 学术正式
  MINIMAL = "minimal", // 极简主义
  CORPORATE = "corporate", // 企业风格
}

/**
 * Slides 专用主题配置
 */
export interface SlideThemeConfig {
  // 幻灯片尺寸
  slideSize: {
    width: number;
    height: number;
    aspectRatio: "16:9" | "4:3" | "16:10";
  };

  // 封面样式
  coverStyle: {
    layout: "centered" | "left-aligned" | "split";
    backgroundType: "solid" | "gradient" | "image" | "pattern";
    showLogo: boolean;
    showDate: boolean;
  };

  // 内容页样式
  contentStyle: {
    headerPosition: "top" | "left";
    showPageNumber: boolean;
    showFooter: boolean;
    maxBulletsPerSlide: number;
  };

  // 图表样式
  chartStyle: {
    showGridLines: boolean;
    showLegend: boolean;
    animateCharts: boolean;
  };
}

/**
 * Docs 专用主题配置
 */
export interface DocsThemeConfig {
  // 页面尺寸
  pageSize: "A4" | "Letter" | "Legal";
  orientation: "portrait" | "landscape";

  // 页眉页脚
  header: {
    show: boolean;
    content?: string;
    showLogo: boolean;
    showPageNumber: boolean;
  };
  footer: {
    show: boolean;
    content?: string;
    showDate: boolean;
    showPageNumber: boolean;
  };

  // 目录样式
  tocStyle: {
    showDots: boolean;
    maxDepth: number;
    indentSize: number;
  };

  // 标题样式
  headingStyle: {
    h1: HeadingStyle;
    h2: HeadingStyle;
    h3: HeadingStyle;
    h4: HeadingStyle;
  };
}

export interface HeadingStyle {
  fontSize: number;
  fontWeight: number;
  color: string;
  marginTop: number;
  marginBottom: number;
  borderBottom?: boolean;
  uppercase?: boolean;
}

// ============================================================================
// 预定义主题
// ============================================================================

/**
 * 默认颜色系统
 */
const defaultColors: ColorPalette = {
  primary: "#1e40af",
  primaryLight: "#3b82f6",
  primaryDark: "#1e3a8a",
  secondary: "#64748b",
  secondaryLight: "#94a3b8",
  secondaryDark: "#475569",
  accent: "#f59e0b",
  accentLight: "#fbbf24",
  accentDark: "#d97706",
  background: "#ffffff",
  surface: "#f8fafc",
  surfaceVariant: "#f1f5f9",
  text: "#1e293b",
  textSecondary: "#64748b",
  textTertiary: "#94a3b8",
  textOnPrimary: "#ffffff",
  textOnSecondary: "#ffffff",
  border: "#e2e8f0",
  borderLight: "#f1f5f9",
  divider: "#e2e8f0",
  success: "#22c55e",
  successLight: "#dcfce7",
  warning: "#f59e0b",
  warningLight: "#fef3c7",
  error: "#ef4444",
  errorLight: "#fee2e2",
  info: "#3b82f6",
  infoLight: "#dbeafe",
  chart: [
    "#3b82f6",
    "#22c55e",
    "#f59e0b",
    "#ef4444",
    "#8b5cf6",
    "#06b6d4",
    "#ec4899",
    "#84cc16",
  ],
};

/**
 * 默认字体系统
 */
const defaultTypography: Typography = {
  fontFamily: {
    primary: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
    secondary: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
    monospace: "JetBrains Mono, Consolas, monospace",
  },
  fontSize: {
    xs: 10,
    sm: 12,
    base: 14,
    md: 16,
    lg: 18,
    xl: 20,
    "2xl": 24,
    "3xl": 30,
    "4xl": 36,
    "5xl": 48,
  },
  fontWeight: {
    light: 300,
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  lineHeight: {
    tight: 1.25,
    normal: 1.5,
    relaxed: 1.75,
  },
  letterSpacing: {
    tight: "-0.025em",
    normal: "0",
    wide: "0.025em",
  },
};

/**
 * 默认间距系统
 */
const defaultSpacing: Spacing = {
  unit: 4,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  "2xl": 48,
  "3xl": 64,
  page: { top: 40, right: 40, bottom: 40, left: 40 },
  section: 24,
  paragraph: 12,
};

/**
 * 默认圆角
 */
const defaultBorderRadius: BorderRadius = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: "9999px",
};

/**
 * 默认阴影
 */
const defaultShadows: Shadows = {
  none: "none",
  sm: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
  md: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
  lg: "0 10px 15px -3px rgb(0 0 0 / 0.1)",
  xl: "0 20px 25px -5px rgb(0 0 0 / 0.1)",
};

/**
 * 预定义主题集合
 */
export const THEMES: Record<string, Theme> = {
  professional: {
    id: "professional",
    name: "专业蓝",
    description: "经典商务风格，适合正式报告和提案",
    category: ThemeCategory.PROFESSIONAL,
    colors: defaultColors,
    typography: defaultTypography,
    spacing: defaultSpacing,
    borderRadius: defaultBorderRadius,
    shadows: defaultShadows,
    slides: {
      slideSize: { width: 1920, height: 1080, aspectRatio: "16:9" },
      coverStyle: {
        layout: "centered",
        backgroundType: "gradient",
        showLogo: true,
        showDate: true,
      },
      contentStyle: {
        headerPosition: "top",
        showPageNumber: true,
        showFooter: true,
        maxBulletsPerSlide: 6,
      },
      chartStyle: {
        showGridLines: true,
        showLegend: true,
        animateCharts: true,
      },
    },
    docs: {
      pageSize: "A4",
      orientation: "portrait",
      header: { show: true, showLogo: true, showPageNumber: false },
      footer: { show: true, showDate: true, showPageNumber: true },
      tocStyle: { showDots: true, maxDepth: 3, indentSize: 24 },
      headingStyle: {
        h1: {
          fontSize: 28,
          fontWeight: 700,
          color: "#1e40af",
          marginTop: 32,
          marginBottom: 16,
          borderBottom: true,
        },
        h2: {
          fontSize: 22,
          fontWeight: 600,
          color: "#1e293b",
          marginTop: 24,
          marginBottom: 12,
        },
        h3: {
          fontSize: 18,
          fontWeight: 600,
          color: "#1e293b",
          marginTop: 20,
          marginBottom: 10,
        },
        h4: {
          fontSize: 16,
          fontWeight: 600,
          color: "#475569",
          marginTop: 16,
          marginBottom: 8,
        },
      },
    },
  },

  modern: {
    id: "modern",
    name: "现代简约",
    description: "简洁现代风格，适合科技和创新类内容",
    category: ThemeCategory.MODERN,
    colors: {
      ...defaultColors,
      primary: "#18181b",
      primaryLight: "#3f3f46",
      primaryDark: "#09090b",
      accent: "#8b5cf6",
      accentLight: "#a78bfa",
      accentDark: "#7c3aed",
      chart: [
        "#8b5cf6",
        "#06b6d4",
        "#22c55e",
        "#f59e0b",
        "#ef4444",
        "#ec4899",
        "#3b82f6",
        "#84cc16",
      ],
    },
    typography: {
      ...defaultTypography,
      fontFamily: {
        primary: "SF Pro Display, -apple-system, sans-serif",
        secondary: "SF Pro Text, -apple-system, sans-serif",
        monospace: "SF Mono, Consolas, monospace",
      },
    },
    spacing: {
      ...defaultSpacing,
      page: { top: 48, right: 48, bottom: 48, left: 48 },
      section: 32,
      paragraph: 16,
    },
    borderRadius: {
      ...defaultBorderRadius,
      md: 12,
      lg: 16,
      xl: 24,
    },
    shadows: defaultShadows,
    slides: {
      slideSize: { width: 1920, height: 1080, aspectRatio: "16:9" },
      coverStyle: {
        layout: "left-aligned",
        backgroundType: "solid",
        showLogo: true,
        showDate: false,
      },
      contentStyle: {
        headerPosition: "left",
        showPageNumber: false,
        showFooter: false,
        maxBulletsPerSlide: 5,
      },
      chartStyle: {
        showGridLines: false,
        showLegend: true,
        animateCharts: true,
      },
    },
    docs: {
      pageSize: "A4",
      orientation: "portrait",
      header: { show: false, showLogo: false, showPageNumber: false },
      footer: { show: true, showDate: false, showPageNumber: true },
      tocStyle: { showDots: false, maxDepth: 2, indentSize: 20 },
      headingStyle: {
        h1: {
          fontSize: 32,
          fontWeight: 700,
          color: "#18181b",
          marginTop: 40,
          marginBottom: 20,
          borderBottom: false,
        },
        h2: {
          fontSize: 24,
          fontWeight: 600,
          color: "#18181b",
          marginTop: 32,
          marginBottom: 16,
        },
        h3: {
          fontSize: 20,
          fontWeight: 600,
          color: "#3f3f46",
          marginTop: 24,
          marginBottom: 12,
        },
        h4: {
          fontSize: 16,
          fontWeight: 600,
          color: "#52525b",
          marginTop: 20,
          marginBottom: 10,
        },
      },
    },
  },

  consulting: {
    id: "consulting",
    name: "咨询风格",
    description: "麦肯锡/BCG风格，适合战略咨询报告",
    category: ThemeCategory.CORPORATE,
    colors: {
      ...defaultColors,
      primary: "#0f172a",
      primaryLight: "#1e293b",
      primaryDark: "#020617",
      secondary: "#334155",
      accent: "#0ea5e9",
      accentLight: "#38bdf8",
      accentDark: "#0284c7",
      chart: [
        "#0ea5e9",
        "#22c55e",
        "#f59e0b",
        "#ef4444",
        "#8b5cf6",
        "#0f172a",
        "#64748b",
        "#06b6d4",
      ],
    },
    typography: {
      ...defaultTypography,
      fontFamily: {
        primary: "Georgia, Times New Roman, serif",
        secondary: "Arial, Helvetica, sans-serif",
        monospace: "Consolas, monospace",
      },
      fontSize: {
        ...defaultTypography.fontSize,
        base: 12,
        md: 14,
        lg: 16,
      },
      lineHeight: {
        tight: 1.3,
        normal: 1.6,
        relaxed: 1.8,
      },
    },
    spacing: {
      ...defaultSpacing,
      page: { top: 36, right: 36, bottom: 36, left: 36 },
      section: 20,
      paragraph: 10,
    },
    borderRadius: {
      ...defaultBorderRadius,
      sm: 2,
      md: 4,
      lg: 6,
    },
    shadows: defaultShadows,
    slides: {
      slideSize: { width: 1920, height: 1080, aspectRatio: "16:9" },
      coverStyle: {
        layout: "centered",
        backgroundType: "solid",
        showLogo: true,
        showDate: true,
      },
      contentStyle: {
        headerPosition: "top",
        showPageNumber: true,
        showFooter: true,
        maxBulletsPerSlide: 4,
      },
      chartStyle: {
        showGridLines: true,
        showLegend: true,
        animateCharts: false,
      },
    },
    docs: {
      pageSize: "A4",
      orientation: "portrait",
      header: { show: true, showLogo: true, showPageNumber: true },
      footer: {
        show: true,
        content: "Confidential",
        showDate: true,
        showPageNumber: false,
      },
      tocStyle: { showDots: true, maxDepth: 4, indentSize: 16 },
      headingStyle: {
        h1: {
          fontSize: 24,
          fontWeight: 700,
          color: "#0f172a",
          marginTop: 28,
          marginBottom: 14,
          borderBottom: true,
          uppercase: true,
        },
        h2: {
          fontSize: 18,
          fontWeight: 700,
          color: "#1e293b",
          marginTop: 20,
          marginBottom: 10,
        },
        h3: {
          fontSize: 14,
          fontWeight: 700,
          color: "#334155",
          marginTop: 16,
          marginBottom: 8,
        },
        h4: {
          fontSize: 12,
          fontWeight: 700,
          color: "#475569",
          marginTop: 12,
          marginBottom: 6,
        },
      },
    },
  },

  academic: {
    id: "academic",
    name: "学术论文",
    description: "正式学术风格，适合研究报告和论文",
    category: ThemeCategory.ACADEMIC,
    colors: {
      ...defaultColors,
      primary: "#1e3a5f",
      primaryLight: "#2d5a87",
      primaryDark: "#0f1d2f",
      accent: "#8b0000",
      chart: [
        "#1e3a5f",
        "#8b0000",
        "#006400",
        "#4b0082",
        "#ff8c00",
        "#2f4f4f",
        "#8b4513",
        "#483d8b",
      ],
    },
    typography: {
      ...defaultTypography,
      fontFamily: {
        primary: "Times New Roman, Georgia, serif",
        secondary: "Times New Roman, Georgia, serif",
        monospace: "Courier New, monospace",
      },
      fontSize: {
        ...defaultTypography.fontSize,
        base: 12,
      },
      lineHeight: {
        tight: 1.5,
        normal: 2.0,
        relaxed: 2.5,
      },
    },
    spacing: defaultSpacing,
    borderRadius: {
      none: 0,
      sm: 0,
      md: 0,
      lg: 0,
      xl: 0,
      full: "0",
    },
    shadows: {
      none: "none",
      sm: "none",
      md: "none",
      lg: "none",
      xl: "none",
    },
    docs: {
      pageSize: "A4",
      orientation: "portrait",
      header: { show: true, showLogo: false, showPageNumber: true },
      footer: { show: false, showDate: false, showPageNumber: false },
      tocStyle: { showDots: true, maxDepth: 4, indentSize: 24 },
      headingStyle: {
        h1: {
          fontSize: 16,
          fontWeight: 700,
          color: "#000000",
          marginTop: 24,
          marginBottom: 12,
          borderBottom: false,
          uppercase: true,
        },
        h2: {
          fontSize: 14,
          fontWeight: 700,
          color: "#000000",
          marginTop: 20,
          marginBottom: 10,
        },
        h3: {
          fontSize: 12,
          fontWeight: 700,
          color: "#000000",
          marginTop: 16,
          marginBottom: 8,
        },
        h4: {
          fontSize: 12,
          fontWeight: 400,
          color: "#000000",
          marginTop: 12,
          marginBottom: 6,
        },
      },
    },
  },
};

/**
 * 获取主题
 */
export function getTheme(themeId: string): Theme {
  return THEMES[themeId] || THEMES["professional"];
}

/**
 * 获取所有主题列表
 */
export function getAllThemes(): Theme[] {
  return Object.values(THEMES);
}

/**
 * 按分类获取主题
 */
export function getThemesByCategory(category: ThemeCategory): Theme[] {
  return Object.values(THEMES).filter((theme) => theme.category === category);
}

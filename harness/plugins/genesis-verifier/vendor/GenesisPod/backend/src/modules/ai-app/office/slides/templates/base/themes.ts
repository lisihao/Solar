/**
 * Slides Engine v3.0 - Theme System
 *
 * 5 套专业主题配置
 * 每套主题包含色彩、装饰、排版完整配置
 */

import {
  DecorationConfig,
  DECORATION_PRESETS,
  generateDecorationCSS,
  generateDecorationHtml,
} from "./decorations";

// ============================================================================
// Theme Types
// ============================================================================

export interface ThemeColors {
  // 背景色系
  background: {
    primary: string;
    secondary: string;
    tertiary: string;
    gradient: string;
  };

  // 强调色系
  accent: {
    primary: string;
    secondary: string;
    tertiary?: string;
  };

  // 文字色系
  text: {
    primary: string;
    secondary: string;
    muted: string;
    subtle: string;
  };

  // 卡片色系
  card: {
    background: string;
    backgroundHover: string;
    border: string;
    borderHighlight: string;
  };

  // 功能色
  functional: {
    success: string;
    warning: string;
    error: string;
    info: string;
  };
}

export interface ThemeTypography {
  fontFamily: string;
  fontFamilyHeading?: string;

  heading: {
    h1: {
      size: string;
      weight: number;
      lineHeight: number;
      letterSpacing: string;
    };
    h2: {
      size: string;
      weight: number;
      lineHeight: number;
      letterSpacing: string;
    };
    h3: {
      size: string;
      weight: number;
      lineHeight: number;
      letterSpacing: string;
    };
    h4: {
      size: string;
      weight: number;
      lineHeight: number;
      letterSpacing: string;
    };
  };

  body: {
    large: {
      size: string;
      weight: number;
      lineHeight: number;
      letterSpacing: string;
    };
    normal: {
      size: string;
      weight: number;
      lineHeight: number;
      letterSpacing: string;
    };
    small: {
      size: string;
      weight: number;
      lineHeight: number;
      letterSpacing: string;
    };
  };

  stat: {
    huge: {
      size: string;
      weight: number;
      lineHeight: number;
      letterSpacing: string;
    };
    large: {
      size: string;
      weight: number;
      lineHeight: number;
      letterSpacing: string;
    };
    medium: {
      size: string;
      weight: number;
      lineHeight: number;
      letterSpacing: string;
    };
  };

  label: {
    uppercase: {
      size: string;
      weight: number;
      letterSpacing: string;
      transform: string;
    };
    caption: { size: string; weight: number; letterSpacing: string };
  };
}

export interface ThemeConfig {
  id: string;
  name: string;
  nameZh: string;
  description: string;
  descriptionZh: string;
  preview: string; // Gradient preview for theme selector

  colors: ThemeColors;
  typography: ThemeTypography;
  decorations: DecorationConfig;

  // 特殊效果
  effects: {
    cardShadow: string;
    cardShadowHover: string;
    borderRadius: string;
    accentGlow: boolean;
  };
}

// ============================================================================
// Base Typography (shared across themes)
// ============================================================================

const BASE_TYPOGRAPHY: ThemeTypography = {
  fontFamily: "'Noto Sans SC', 'Inter', sans-serif",

  heading: {
    h1: {
      size: "52px",
      weight: 900,
      lineHeight: 1.1,
      letterSpacing: "-0.02em",
    },
    h2: {
      size: "36px",
      weight: 800,
      lineHeight: 1.2,
      letterSpacing: "-0.01em",
    },
    h3: { size: "24px", weight: 700, lineHeight: 1.3, letterSpacing: "0em" },
    h4: { size: "18px", weight: 600, lineHeight: 1.4, letterSpacing: "0.01em" },
  },

  body: {
    large: {
      size: "18px",
      weight: 400,
      lineHeight: 1.75,
      letterSpacing: "0.01em",
    },
    normal: {
      size: "16px",
      weight: 400,
      lineHeight: 1.7,
      letterSpacing: "0.02em",
    },
    small: {
      size: "14px",
      weight: 400,
      lineHeight: 1.6,
      letterSpacing: "0.02em",
    },
  },

  stat: {
    huge: {
      size: "72px",
      weight: 900,
      lineHeight: 1,
      letterSpacing: "-0.03em",
    },
    large: {
      size: "56px",
      weight: 900,
      lineHeight: 1,
      letterSpacing: "-0.02em",
    },
    medium: {
      size: "32px",
      weight: 800,
      lineHeight: 1.2,
      letterSpacing: "-0.01em",
    },
  },

  label: {
    uppercase: {
      size: "12px",
      weight: 600,
      letterSpacing: "0.1em",
      transform: "uppercase",
    },
    caption: { size: "12px", weight: 400, letterSpacing: "0.02em" },
  },
};

// ============================================================================
// Theme Definitions
// ============================================================================

export const THEMES: Record<string, ThemeConfig> = {
  /**
   * Genspark Dark - 深邃金典
   * 经典深色主题，金色强调，专业商务首选
   */
  "genspark-dark": {
    id: "genspark-dark",
    name: "Genspark Dark",
    nameZh: "深邃金典",
    description:
      "Classic dark theme with gold accents, perfect for business presentations",
    descriptionZh: "深色背景配金色强调，专业商务首选",
    preview: "linear-gradient(135deg, #0F172A 0%, #1E293B 50%, #D4AF37 100%)",

    colors: {
      background: {
        primary: "#0F172A",
        secondary: "#1E293B",
        tertiary: "#334155",
        gradient: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)",
      },
      accent: {
        primary: "#D4AF37",
        secondary: "#3B82F6",
        tertiary: "#10B981",
      },
      text: {
        primary: "#F8FAFC",
        secondary: "#CBD5E1",
        muted: "#94A3B8",
        subtle: "#64748B",
      },
      card: {
        background: "rgba(30, 41, 59, 0.8)",
        backgroundHover: "rgba(30, 41, 59, 0.95)",
        border: "#334155",
        borderHighlight: "#D4AF37",
      },
      functional: {
        success: "#10B981",
        warning: "#F59E0B",
        error: "#EF4444",
        info: "#3B82F6",
      },
    },

    typography: {
      ...BASE_TYPOGRAPHY,
      fontFamily: "'Noto Sans SC', 'Inter', sans-serif",
    },

    decorations: DECORATION_PRESETS["genspark-dark"],

    effects: {
      cardShadow:
        "0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.2)",
      cardShadowHover:
        "0 10px 15px -3px rgba(0, 0, 0, 0.3), 0 4px 6px -2px rgba(0, 0, 0, 0.2)",
      borderRadius: "12px",
      accentGlow: true,
    },
  },

  /**
   * Tech Purple - 科技紫韵
   * 紫色科技感，适合科技、AI、创新主题
   */
  "tech-purple": {
    id: "tech-purple",
    name: "Tech Purple",
    nameZh: "科技紫韵",
    description: "Purple tech aesthetic, perfect for AI and innovation topics",
    descriptionZh: "紫色科技感，适合科技、AI、创新主题",
    preview: "linear-gradient(135deg, #13111C 0%, #1E1B2E 50%, #A855F7 100%)",

    colors: {
      background: {
        primary: "#13111C",
        secondary: "#1E1B2E",
        tertiary: "#2D2A40",
        gradient: "linear-gradient(135deg, #13111C 0%, #1E1B2E 100%)",
      },
      accent: {
        primary: "#A855F7",
        secondary: "#06B6D4",
        tertiary: "#F472B6",
      },
      text: {
        primary: "#F8FAFC",
        secondary: "#C4B5FD",
        muted: "#8B7EC8",
        subtle: "#6B6090",
      },
      card: {
        background: "rgba(30, 27, 46, 0.8)",
        backgroundHover: "rgba(30, 27, 46, 0.95)",
        border: "#3B3566",
        borderHighlight: "#A855F7",
      },
      functional: {
        success: "#22D3EE",
        warning: "#FBBF24",
        error: "#FB7185",
        info: "#A78BFA",
      },
    },

    typography: {
      ...BASE_TYPOGRAPHY,
      fontFamily: "'Inter', 'Noto Sans SC', sans-serif",
      heading: {
        ...BASE_TYPOGRAPHY.heading,
        h1: {
          size: "52px",
          weight: 800,
          lineHeight: 1.1,
          letterSpacing: "-0.01em",
        },
      },
    },

    decorations: DECORATION_PRESETS["tech-purple"],

    effects: {
      cardShadow:
        "0 4px 6px -1px rgba(0, 0, 0, 0.4), 0 2px 4px -1px rgba(168, 85, 247, 0.1)",
      cardShadowHover:
        "0 10px 15px -3px rgba(0, 0, 0, 0.4), 0 4px 6px -2px rgba(168, 85, 247, 0.2)",
      borderRadius: "16px",
      accentGlow: true,
    },
  },

  /**
   * Executive White - 商务精英
   * 白色简约风，适合正式商务、金融、咨询场合
   */
  "executive-white": {
    id: "executive-white",
    name: "Executive White",
    nameZh: "商务精英",
    description:
      "Clean white theme for formal business, finance, and consulting",
    descriptionZh: "白色简约风，适合正式商务、金融、咨询场合",
    preview: "linear-gradient(135deg, #FFFFFF 0%, #F1F5F9 50%, #1E40AF 100%)",

    colors: {
      background: {
        primary: "#FFFFFF",
        secondary: "#F8FAFC",
        tertiary: "#F1F5F9",
        gradient: "linear-gradient(135deg, #FFFFFF 0%, #F8FAFC 100%)",
      },
      accent: {
        primary: "#1E40AF",
        secondary: "#DC2626",
        tertiary: "#059669",
      },
      text: {
        primary: "#1E293B",
        secondary: "#475569",
        muted: "#94A3B8",
        subtle: "#CBD5E1",
      },
      card: {
        background: "#FFFFFF",
        backgroundHover: "#F8FAFC",
        border: "#E2E8F0",
        borderHighlight: "#1E40AF",
      },
      functional: {
        success: "#059669",
        warning: "#D97706",
        error: "#DC2626",
        info: "#2563EB",
      },
    },

    typography: {
      ...BASE_TYPOGRAPHY,
      fontFamily: "'Source Sans Pro', 'Noto Sans SC', sans-serif",
      heading: {
        ...BASE_TYPOGRAPHY.heading,
        h1: {
          size: "48px",
          weight: 700,
          lineHeight: 1.15,
          letterSpacing: "0em",
        },
        h2: {
          size: "32px",
          weight: 700,
          lineHeight: 1.25,
          letterSpacing: "0em",
        },
      },
      body: {
        ...BASE_TYPOGRAPHY.body,
        normal: {
          size: "16px",
          weight: 400,
          lineHeight: 1.75,
          letterSpacing: "0.02em",
        },
      },
    },

    decorations: DECORATION_PRESETS["executive-white"],

    effects: {
      cardShadow: "0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06)",
      cardShadowHover:
        "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
      borderRadius: "8px",
      accentGlow: false,
    },
  },

  /**
   * Nature Green - 自然清新
   * 绿色自然风，适合环保、健康、可持续发展主题
   */
  "nature-green": {
    id: "nature-green",
    name: "Nature Green",
    nameZh: "自然清新",
    description:
      "Natural green theme for eco, health, and sustainability topics",
    descriptionZh: "绿色自然风，适合环保、健康、可持续发展主题",
    preview: "linear-gradient(135deg, #0A1F1C 0%, #132F2A 50%, #10B981 100%)",

    colors: {
      background: {
        primary: "#0A1F1C",
        secondary: "#132F2A",
        tertiary: "#1C3F38",
        gradient: "linear-gradient(135deg, #0A1F1C 0%, #132F2A 100%)",
      },
      accent: {
        primary: "#10B981",
        secondary: "#F59E0B",
        tertiary: "#06B6D4",
      },
      text: {
        primary: "#ECFDF5",
        secondary: "#A7F3D0",
        muted: "#6EE7B7",
        subtle: "#34D399",
      },
      card: {
        background: "rgba(19, 47, 42, 0.8)",
        backgroundHover: "rgba(19, 47, 42, 0.95)",
        border: "#1C3F38",
        borderHighlight: "#10B981",
      },
      functional: {
        success: "#34D399",
        warning: "#FBBF24",
        error: "#F87171",
        info: "#22D3EE",
      },
    },

    typography: {
      ...BASE_TYPOGRAPHY,
      fontFamily: "'Nunito', 'Noto Sans SC', sans-serif",
      heading: {
        ...BASE_TYPOGRAPHY.heading,
        h1: {
          size: "50px",
          weight: 800,
          lineHeight: 1.15,
          letterSpacing: "0em",
        },
      },
    },

    decorations: DECORATION_PRESETS["nature-green"],

    effects: {
      cardShadow:
        "0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(16, 185, 129, 0.1)",
      cardShadowHover:
        "0 10px 15px -3px rgba(0, 0, 0, 0.3), 0 4px 6px -2px rgba(16, 185, 129, 0.15)",
      borderRadius: "12px",
      accentGlow: true,
    },
  },

  /**
   * Warm Sunset - 暖阳晚霞
   * 暖色调渐变，适合创意、文化、艺术、营销主题
   */
  "warm-sunset": {
    id: "warm-sunset",
    name: "Warm Sunset",
    nameZh: "暖阳晚霞",
    description:
      "Warm gradient theme for creative, cultural, and marketing topics",
    descriptionZh: "暖色调渐变，适合创意、文化、艺术、营销主题",
    preview: "linear-gradient(135deg, #1C1414 0%, #2A1F1F 50%, #F97316 100%)",

    colors: {
      background: {
        primary: "#1C1414",
        secondary: "#2A1F1F",
        tertiary: "#3D2C2C",
        gradient: "linear-gradient(135deg, #1C1414 0%, #2A1F1F 100%)",
      },
      accent: {
        primary: "#F97316",
        secondary: "#EC4899",
        tertiary: "#FBBF24",
      },
      text: {
        primary: "#FEF3E2",
        secondary: "#FCD9BD",
        muted: "#FDBA74",
        subtle: "#FB923C",
      },
      card: {
        background: "rgba(42, 31, 31, 0.8)",
        backgroundHover: "rgba(42, 31, 31, 0.95)",
        border: "#5C4444",
        borderHighlight: "#F97316",
      },
      functional: {
        success: "#4ADE80",
        warning: "#FBBF24",
        error: "#F87171",
        info: "#38BDF8",
      },
    },

    typography: {
      ...BASE_TYPOGRAPHY,
      fontFamily: "'Poppins', 'Noto Sans SC', sans-serif",
      heading: {
        ...BASE_TYPOGRAPHY.heading,
        h1: {
          size: "52px",
          weight: 700,
          lineHeight: 1.1,
          letterSpacing: "-0.01em",
        },
      },
    },

    decorations: DECORATION_PRESETS["warm-sunset"],

    effects: {
      cardShadow:
        "0 4px 6px -1px rgba(0, 0, 0, 0.4), 0 2px 4px -1px rgba(249, 115, 22, 0.1)",
      cardShadowHover:
        "0 10px 15px -3px rgba(0, 0, 0, 0.4), 0 4px 6px -2px rgba(249, 115, 22, 0.2)",
      borderRadius: "14px",
      accentGlow: true,
    },
  },
};

// ============================================================================
// Theme Helpers
// ============================================================================

/**
 * Get theme by ID
 */
export function getTheme(themeId: string): ThemeConfig {
  return THEMES[themeId] || THEMES["genspark-dark"];
}

/**
 * Get all available themes
 */
export function getAllThemes(): ThemeConfig[] {
  return Object.values(THEMES);
}

/**
 * Get theme IDs
 */
export function getThemeIds(): string[] {
  return Object.keys(THEMES);
}

// ============================================================================
// CSS Generation
// ============================================================================

/**
 * Generate CSS variables for a theme
 */
export function generateThemeCSSVariables(theme: ThemeConfig): string {
  return `
    :root {
      /* Background Colors */
      --bg-primary: ${theme.colors.background.primary};
      --bg-secondary: ${theme.colors.background.secondary};
      --bg-tertiary: ${theme.colors.background.tertiary};
      --bg-gradient: ${theme.colors.background.gradient};

      /* Accent Colors */
      --accent-primary: ${theme.colors.accent.primary};
      --accent-secondary: ${theme.colors.accent.secondary};
      ${theme.colors.accent.tertiary ? `--accent-tertiary: ${theme.colors.accent.tertiary};` : ""}

      /* Text Colors */
      --text-primary: ${theme.colors.text.primary};
      --text-secondary: ${theme.colors.text.secondary};
      --text-muted: ${theme.colors.text.muted};
      --text-subtle: ${theme.colors.text.subtle};

      /* Card Colors */
      --card-bg: ${theme.colors.card.background};
      --card-bg-hover: ${theme.colors.card.backgroundHover};
      --card-border: ${theme.colors.card.border};
      --card-border-highlight: ${theme.colors.card.borderHighlight};

      /* Functional Colors */
      --color-success: ${theme.colors.functional.success};
      --color-warning: ${theme.colors.functional.warning};
      --color-error: ${theme.colors.functional.error};
      --color-info: ${theme.colors.functional.info};

      /* Typography */
      --font-family: ${theme.typography.fontFamily};
      ${theme.typography.fontFamilyHeading ? `--font-family-heading: ${theme.typography.fontFamilyHeading};` : ""}

      /* Effects */
      --card-shadow: ${theme.effects.cardShadow};
      --card-shadow-hover: ${theme.effects.cardShadowHover};
      --border-radius: ${theme.effects.borderRadius};
    }
  `;
}

/**
 * Generate complete theme CSS (variables + decorations)
 */
export function generateThemeCSS(theme: ThemeConfig): string {
  const variables = generateThemeCSSVariables(theme);
  const decorations = generateDecorationCSS(theme.decorations);

  return `
    ${variables}
    ${decorations}
  `;
}

/**
 * Generate inline container style for a theme
 * 注意：使用 100% 尺寸以适应 iframe 容器，不再使用固定尺寸和 padding
 * 模板内层自己处理边距和布局
 */
export function getThemeContainerStyle(theme: ThemeConfig): string {
  return `
    width: 100%;
    height: 100%;
    background: ${theme.colors.background.gradient};
    font-family: ${theme.typography.fontFamily};
    color: ${theme.colors.text.primary};
    padding: 0;
    box-sizing: border-box;
    position: relative;
    overflow: hidden;
  `;
}

/**
 * Generate inline card style for a theme
 */
export function getThemeCardStyle(
  theme: ThemeConfig,
  highlighted: boolean = false,
): string {
  return `
    background: ${theme.colors.card.background};
    border: 1px solid ${highlighted ? theme.colors.card.borderHighlight : theme.colors.card.border};
    border-radius: ${theme.effects.borderRadius};
    padding: 24px;
    box-shadow: ${theme.effects.cardShadow};
  `;
}

/**
 * Generate decoration HTML for a theme
 */
export function getThemeDecorationHtml(theme: ThemeConfig): string {
  return generateDecorationHtml(theme.decorations);
}

// ============================================================================
// Typography Helpers
// ============================================================================

/**
 * Generate inline style for heading
 */
export function getHeadingStyle(
  theme: ThemeConfig,
  level: "h1" | "h2" | "h3" | "h4",
): string {
  const config = theme.typography.heading[level];
  return `
    font-size: ${config.size};
    font-weight: ${config.weight};
    line-height: ${config.lineHeight};
    letter-spacing: ${config.letterSpacing};
    color: ${theme.colors.text.primary};
    margin: 0;
  `;
}

/**
 * Generate inline style for body text
 */
export function getBodyStyle(
  theme: ThemeConfig,
  size: "large" | "normal" | "small",
): string {
  const config = theme.typography.body[size];
  return `
    font-size: ${config.size};
    font-weight: ${config.weight};
    line-height: ${config.lineHeight};
    letter-spacing: ${config.letterSpacing};
    color: ${theme.colors.text.secondary};
  `;
}

/**
 * Generate inline style for stat numbers
 */
export function getStatStyle(
  theme: ThemeConfig,
  size: "huge" | "large" | "medium",
  glowing: boolean = false,
): string {
  const config = theme.typography.stat[size];
  const glow =
    glowing && theme.effects.accentGlow
      ? `text-shadow: 0 0 20px ${theme.colors.accent.primary}80, 0 0 40px ${theme.colors.accent.primary}40;`
      : "";

  return `
    font-size: ${config.size};
    font-weight: ${config.weight};
    line-height: ${config.lineHeight};
    letter-spacing: ${config.letterSpacing};
    color: ${theme.colors.accent.primary};
    ${glow}
  `;
}

// ============================================================================
// Accent Color Helpers
// ============================================================================

/**
 * Get accent colors array for multi-item layouts
 */
export function getAccentColors(theme: ThemeConfig): string[] {
  const colors = [theme.colors.accent.primary, theme.colors.accent.secondary];
  if (theme.colors.accent.tertiary) {
    colors.push(theme.colors.accent.tertiary);
  }
  // Add functional colors for more variety
  colors.push(theme.colors.functional.success);
  colors.push(theme.colors.functional.warning);
  colors.push(theme.colors.functional.info);
  return colors;
}

/**
 * Get accent color by index (cycles through available colors)
 */
export function getAccentColorByIndex(
  theme: ThemeConfig,
  index: number,
): string {
  const colors = getAccentColors(theme);
  return colors[index % colors.length];
}

/**
 * Slides Engine v3.0 - Decoration System
 *
 * Genspark 风格装饰元素系统
 * 包含角落装饰、光晕效果、渐变条等视觉增强元素
 */

// ============================================================================
// Decoration Types
// ============================================================================

export interface CornerAccentConfig {
  enabled: boolean;
  positions: ("top-left" | "top-right" | "bottom-left" | "bottom-right")[];
  style: "gradient" | "line" | "geometric";
  color: string;
  secondaryColor?: string;
  opacity: number;
  size: number;
}

export interface GlowEffectConfig {
  enabled: boolean;
  target: "card" | "stat" | "title" | "accent";
  color: string;
  intensity: "subtle" | "medium" | "strong";
}

export interface GradientBarConfig {
  enabled: boolean;
  position: "top" | "bottom" | "left" | "right";
  colors: string[];
  height: number;
}

export interface GeometricShapeConfig {
  enabled: boolean;
  shapes: {
    type: "circle" | "diamond" | "square" | "triangle" | "ring";
    x: string; // CSS position (%, px)
    y: string;
    size: number;
    color: string;
    opacity: number;
    blur?: number;
  }[];
}

/**
 * 金色装饰竖条配置
 * 用于标题旁的视觉标记，提升专业感
 */
export interface AccentBarConfig {
  enabled: boolean;
  position: "title-left" | "card-left" | "section-top";
  color: string;
  width: number; // px, 默认 4-5
  height: number | "auto"; // px 或 "auto" 自适应
  borderRadius?: number;
  glow?: boolean; // 是否添加发光效果
}

/**
 * 透明边框装饰框配置
 * 用于章节页角落装饰
 */
export interface TransparentBorderConfig {
  enabled: boolean;
  positions: ("top-left" | "top-right" | "bottom-left" | "bottom-right")[];
  color: string;
  size: number; // 正方形边长
  borderWidth: number;
  opacity: number; // 0-1
}

export interface DecorationConfig {
  cornerAccent: CornerAccentConfig;
  glowEffect: GlowEffectConfig;
  gradientBar: GradientBarConfig;
  geometricShapes: GeometricShapeConfig;
  accentBar?: AccentBarConfig;
  transparentBorder?: TransparentBorderConfig;
}

// ============================================================================
// Glow Intensity Mapping
// ============================================================================

const GLOW_INTENSITY = {
  subtle: {
    blur: "10px",
    spread: "5px",
    textBlur: "8px",
  },
  medium: {
    blur: "20px",
    spread: "10px",
    textBlur: "15px",
  },
  strong: {
    blur: "40px",
    spread: "20px",
    textBlur: "25px",
  },
} as const;

// ============================================================================
// Decoration Presets
// ============================================================================

export const DECORATION_PRESETS: Record<string, DecorationConfig> = {
  "genspark-dark": {
    cornerAccent: {
      enabled: true,
      positions: ["top-left", "bottom-right"],
      style: "gradient",
      color: "#D4AF37",
      secondaryColor: "#3B82F6",
      opacity: 0.3,
      size: 120,
    },
    glowEffect: {
      enabled: true,
      target: "stat",
      color: "#D4AF37",
      intensity: "medium",
    },
    gradientBar: {
      enabled: true,
      position: "bottom",
      colors: ["transparent", "#D4AF37", "#D4AF37", "transparent"],
      height: 4,
    },
    geometricShapes: {
      enabled: true,
      shapes: [
        {
          type: "ring",
          x: "85%",
          y: "15%",
          size: 60,
          color: "#D4AF37",
          opacity: 0.1,
        },
        {
          type: "diamond",
          x: "10%",
          y: "80%",
          size: 30,
          color: "#3B82F6",
          opacity: 0.15,
        },
      ],
    },
    accentBar: {
      enabled: true,
      position: "title-left",
      color: "#D4AF37",
      width: 5,
      height: 35,
      borderRadius: 2,
      glow: true,
    },
    transparentBorder: {
      enabled: true,
      positions: ["top-right", "bottom-left"],
      color: "#D4AF37",
      size: 80,
      borderWidth: 2.5,
      opacity: 0.3,
    },
  },

  "tech-purple": {
    cornerAccent: {
      enabled: true,
      positions: ["top-right", "bottom-left"],
      style: "gradient",
      color: "#A855F7",
      secondaryColor: "#06B6D4",
      opacity: 0.25,
      size: 150,
    },
    glowEffect: {
      enabled: true,
      target: "card",
      color: "#A855F7",
      intensity: "medium",
    },
    gradientBar: {
      enabled: true,
      position: "top",
      colors: ["#A855F7", "#06B6D4"],
      height: 3,
    },
    geometricShapes: {
      enabled: true,
      shapes: [
        {
          type: "circle",
          x: "90%",
          y: "85%",
          size: 80,
          color: "#A855F7",
          opacity: 0.08,
          blur: 20,
        },
        {
          type: "ring",
          x: "5%",
          y: "20%",
          size: 50,
          color: "#06B6D4",
          opacity: 0.12,
        },
      ],
    },
  },

  "executive-white": {
    cornerAccent: {
      enabled: true,
      positions: ["top-left"],
      style: "line",
      color: "#1E40AF",
      opacity: 0.6,
      size: 80,
    },
    glowEffect: {
      enabled: false,
      target: "accent",
      color: "#1E40AF",
      intensity: "subtle",
    },
    gradientBar: {
      enabled: true,
      position: "left",
      colors: ["#1E40AF", "#DC2626"],
      height: 3,
    },
    geometricShapes: {
      enabled: false,
      shapes: [],
    },
  },

  "nature-green": {
    cornerAccent: {
      enabled: true,
      positions: ["bottom-left", "top-right"],
      style: "geometric",
      color: "#10B981",
      secondaryColor: "#F59E0B",
      opacity: 0.2,
      size: 100,
    },
    glowEffect: {
      enabled: true,
      target: "stat",
      color: "#10B981",
      intensity: "subtle",
    },
    gradientBar: {
      enabled: true,
      position: "bottom",
      colors: ["transparent", "#10B981", "#F59E0B", "transparent"],
      height: 4,
    },
    geometricShapes: {
      enabled: true,
      shapes: [
        {
          type: "circle",
          x: "95%",
          y: "5%",
          size: 40,
          color: "#10B981",
          opacity: 0.15,
        },
        {
          type: "diamond",
          x: "5%",
          y: "90%",
          size: 25,
          color: "#F59E0B",
          opacity: 0.2,
        },
      ],
    },
  },

  "warm-sunset": {
    cornerAccent: {
      enabled: true,
      positions: ["top-left", "bottom-right"],
      style: "gradient",
      color: "#F97316",
      secondaryColor: "#EC4899",
      opacity: 0.35,
      size: 140,
    },
    glowEffect: {
      enabled: true,
      target: "title",
      color: "#F97316",
      intensity: "medium",
    },
    gradientBar: {
      enabled: true,
      position: "bottom",
      colors: ["transparent", "#F97316", "#EC4899", "transparent"],
      height: 5,
    },
    geometricShapes: {
      enabled: true,
      shapes: [
        {
          type: "ring",
          x: "90%",
          y: "10%",
          size: 70,
          color: "#F97316",
          opacity: 0.12,
        },
        {
          type: "circle",
          x: "8%",
          y: "85%",
          size: 50,
          color: "#EC4899",
          opacity: 0.1,
          blur: 15,
        },
      ],
    },
  },

  // Minimal preset for clean designs
  minimal: {
    cornerAccent: {
      enabled: false,
      positions: [],
      style: "line",
      color: "#D4AF37",
      opacity: 0,
      size: 0,
    },
    glowEffect: {
      enabled: false,
      target: "accent",
      color: "#D4AF37",
      intensity: "subtle",
    },
    gradientBar: {
      enabled: false,
      position: "bottom",
      colors: [],
      height: 0,
    },
    geometricShapes: {
      enabled: false,
      shapes: [],
    },
  },
};

// ============================================================================
// CSS Generation Functions
// ============================================================================

/**
 * Generate CSS for corner accent decorations
 */
function generateCornerAccentCSS(config: CornerAccentConfig): string {
  if (!config.enabled || config.positions.length === 0) return "";

  const styles: string[] = [];

  config.positions.forEach((pos) => {
    let clipPath: string;
    let gradient: string;
    let position: string;

    switch (pos) {
      case "top-left":
        clipPath = "polygon(0 0, 100% 0, 0 100%)";
        gradient =
          config.style === "gradient"
            ? `linear-gradient(135deg, ${config.color}${Math.round(
                config.opacity * 255,
              )
                .toString(16)
                .padStart(2, "0")} 0%, transparent 60%)`
            : config.color;
        position = "top: 0; left: 0;";
        break;
      case "top-right":
        clipPath = "polygon(0 0, 100% 0, 100% 100%)";
        gradient =
          config.style === "gradient"
            ? `linear-gradient(-135deg, ${config.color}${Math.round(
                config.opacity * 255,
              )
                .toString(16)
                .padStart(2, "0")} 0%, transparent 60%)`
            : config.color;
        position = "top: 0; right: 0;";
        break;
      case "bottom-left":
        clipPath = "polygon(0 0, 100% 100%, 0 100%)";
        gradient =
          config.style === "gradient"
            ? `linear-gradient(45deg, ${config.secondaryColor || config.color}${Math.round(
                config.opacity * 255,
              )
                .toString(16)
                .padStart(2, "0")} 0%, transparent 60%)`
            : config.secondaryColor || config.color;
        position = "bottom: 0; left: 0;";
        break;
      case "bottom-right":
        clipPath = "polygon(100% 0, 100% 100%, 0 100%)";
        gradient =
          config.style === "gradient"
            ? `linear-gradient(-45deg, ${config.secondaryColor || config.color}${Math.round(
                config.opacity * 255,
              )
                .toString(16)
                .padStart(2, "0")} 0%, transparent 60%)`
            : config.secondaryColor || config.color;
        position = "bottom: 0; right: 0;";
        break;
    }

    styles.push(`
      .corner-accent-${pos} {
        position: absolute;
        ${position}
        width: ${config.size}px;
        height: ${config.size}px;
        background: ${gradient};
        clip-path: ${clipPath};
        pointer-events: none;
        z-index: 1;
      }
    `);
  });

  return styles.join("\n");
}

/**
 * Generate CSS for glow effects
 */
function generateGlowEffectCSS(config: GlowEffectConfig): string {
  if (!config.enabled) return "";

  const intensity = GLOW_INTENSITY[config.intensity];
  const colorHex = config.color;

  const styles: string[] = [];

  if (config.target === "card" || config.target === "accent") {
    styles.push(`
      .glow-card {
        box-shadow:
          0 0 ${intensity.blur} ${colorHex}26,
          0 0 ${intensity.spread} ${colorHex}15;
      }
    `);
  }

  if (config.target === "stat" || config.target === "accent") {
    styles.push(`
      .glow-stat {
        text-shadow:
          0 0 ${intensity.textBlur} ${colorHex}80,
          0 0 ${intensity.blur} ${colorHex}40;
      }
    `);
  }

  if (config.target === "title" || config.target === "accent") {
    styles.push(`
      .glow-title {
        text-shadow:
          0 2px 4px rgba(0, 0, 0, 0.3),
          0 0 ${intensity.textBlur} ${colorHex}30;
      }
    `);
  }

  return styles.join("\n");
}

/**
 * Generate CSS for gradient bars
 */
function generateGradientBarCSS(config: GradientBarConfig): string {
  if (!config.enabled) return "";

  const isHorizontal =
    config.position === "top" || config.position === "bottom";
  const gradientDirection = isHorizontal ? "90deg" : "180deg";
  const gradientColors = config.colors.join(", ");

  let position: string;
  let dimensions: string;

  switch (config.position) {
    case "top":
      position = "top: 0; left: 0; right: 0;";
      dimensions = `height: ${config.height}px; width: 100%;`;
      break;
    case "bottom":
      position = "bottom: 0; left: 0; right: 0;";
      dimensions = `height: ${config.height}px; width: 100%;`;
      break;
    case "left":
      position = "top: 0; left: 0; bottom: 0;";
      dimensions = `width: ${config.height}px; height: 100%;`;
      break;
    case "right":
      position = "top: 0; right: 0; bottom: 0;";
      dimensions = `width: ${config.height}px; height: 100%;`;
      break;
  }

  return `
    .gradient-bar-${config.position} {
      position: absolute;
      ${position}
      ${dimensions}
      background: linear-gradient(${gradientDirection}, ${gradientColors});
      pointer-events: none;
      z-index: 2;
    }
  `;
}

/**
 * Generate CSS for geometric shapes
 */
function generateGeometricShapesCSS(config: GeometricShapeConfig): string {
  if (!config.enabled || config.shapes.length === 0) return "";

  const styles: string[] = [];

  config.shapes.forEach((shape, index) => {
    let shapeCSS: string;
    const colorWithOpacity = `${shape.color}${Math.round(shape.opacity * 255)
      .toString(16)
      .padStart(2, "0")}`;
    const blur = shape.blur ? `filter: blur(${shape.blur}px);` : "";

    switch (shape.type) {
      case "circle":
        shapeCSS = `
          width: ${shape.size}px;
          height: ${shape.size}px;
          background: ${colorWithOpacity};
          border-radius: 50%;
        `;
        break;
      case "ring":
        shapeCSS = `
          width: ${shape.size}px;
          height: ${shape.size}px;
          border: 2px solid ${colorWithOpacity};
          border-radius: 50%;
          background: transparent;
        `;
        break;
      case "diamond":
        shapeCSS = `
          width: ${shape.size}px;
          height: ${shape.size}px;
          background: ${colorWithOpacity};
          transform: rotate(45deg);
        `;
        break;
      case "square":
        shapeCSS = `
          width: ${shape.size}px;
          height: ${shape.size}px;
          background: ${colorWithOpacity};
          border-radius: 4px;
        `;
        break;
      case "triangle":
        shapeCSS = `
          width: 0;
          height: 0;
          border-left: ${shape.size / 2}px solid transparent;
          border-right: ${shape.size / 2}px solid transparent;
          border-bottom: ${shape.size}px solid ${colorWithOpacity};
        `;
        break;
    }

    styles.push(`
      .geo-shape-${index} {
        position: absolute;
        left: ${shape.x};
        top: ${shape.y};
        ${shapeCSS}
        ${blur}
        pointer-events: none;
        z-index: 0;
      }
    `);
  });

  return styles.join("\n");
}

// ============================================================================
// HTML Generation Functions
// ============================================================================

/**
 * Generate decoration HTML elements
 */
export function generateDecorationHtml(config: DecorationConfig): string {
  const elements: string[] = [];

  // Corner accents
  if (config.cornerAccent.enabled) {
    config.cornerAccent.positions.forEach((pos) => {
      elements.push(`<div class="corner-accent-${pos}"></div>`);
    });
  }

  // Gradient bar
  if (config.gradientBar.enabled) {
    elements.push(
      `<div class="gradient-bar-${config.gradientBar.position}"></div>`,
    );
  }

  // Geometric shapes
  if (config.geometricShapes.enabled) {
    config.geometricShapes.shapes.forEach((_, index) => {
      elements.push(`<div class="geo-shape-${index}"></div>`);
    });
  }

  // Transparent border decorations (章节页角落装饰框)
  if (config.transparentBorder?.enabled) {
    config.transparentBorder.positions.forEach((pos) => {
      const style = getTransparentBorderInlineStyle(
        pos,
        config.transparentBorder!.color,
        config.transparentBorder!.size,
        config.transparentBorder!.borderWidth,
        config.transparentBorder!.opacity,
      );
      elements.push(`<div style="${style.replace(/\n/g, " ").trim()}"></div>`);
    });
  }

  return elements.join("\n");
}

/**
 * Generate complete decoration CSS for a theme
 */
export function generateDecorationCSS(config: DecorationConfig): string {
  const parts: string[] = [];

  parts.push(generateCornerAccentCSS(config.cornerAccent));
  parts.push(generateGlowEffectCSS(config.glowEffect));
  parts.push(generateGradientBarCSS(config.gradientBar));
  parts.push(generateGeometricShapesCSS(config.geometricShapes));

  return parts.filter(Boolean).join("\n");
}

/**
 * Get decoration preset by name
 */
export function getDecorationPreset(name: string): DecorationConfig {
  return DECORATION_PRESETS[name] || DECORATION_PRESETS["genspark-dark"];
}

// ============================================================================
// Inline Style Helpers (for templates that need inline styles)
// ============================================================================

/**
 * Generate inline style for corner accent
 */
export function getCornerAccentInlineStyle(
  position: "top-left" | "top-right" | "bottom-left" | "bottom-right",
  color: string,
  opacity: number = 0.3,
  size: number = 120,
): string {
  const opacityHex = Math.round(opacity * 255)
    .toString(16)
    .padStart(2, "0");

  const positionMap = {
    "top-left": {
      pos: "top: 0; left: 0;",
      gradient: `linear-gradient(135deg, ${color}${opacityHex} 0%, transparent 60%)`,
      clip: "polygon(0 0, 100% 0, 0 100%)",
    },
    "top-right": {
      pos: "top: 0; right: 0;",
      gradient: `linear-gradient(-135deg, ${color}${opacityHex} 0%, transparent 60%)`,
      clip: "polygon(0 0, 100% 0, 100% 100%)",
    },
    "bottom-left": {
      pos: "bottom: 0; left: 0;",
      gradient: `linear-gradient(45deg, ${color}${opacityHex} 0%, transparent 60%)`,
      clip: "polygon(0 0, 100% 100%, 0 100%)",
    },
    "bottom-right": {
      pos: "bottom: 0; right: 0;",
      gradient: `linear-gradient(-45deg, ${color}${opacityHex} 0%, transparent 60%)`,
      clip: "polygon(100% 0, 100% 100%, 0 100%)",
    },
  };

  const config = positionMap[position];

  return `
    position: absolute;
    ${config.pos}
    width: ${size}px;
    height: ${size}px;
    background: ${config.gradient};
    clip-path: ${config.clip};
    pointer-events: none;
    z-index: 1;
  `;
}

/**
 * Generate inline style for gradient bar
 */
export function getGradientBarInlineStyle(
  position: "top" | "bottom" | "left" | "right",
  colors: string[],
  height: number = 4,
): string {
  const isHorizontal = position === "top" || position === "bottom";
  const gradientDirection = isHorizontal ? "90deg" : "180deg";

  const positionMap = {
    top: "top: 0; left: 0; right: 0;",
    bottom: "bottom: 0; left: 0; right: 0;",
    left: "top: 0; left: 0; bottom: 0;",
    right: "top: 0; right: 0; bottom: 0;",
  };

  const dimensions = isHorizontal
    ? `height: ${height}px; width: 100%;`
    : `width: ${height}px; height: 100%;`;

  return `
    position: absolute;
    ${positionMap[position]}
    ${dimensions}
    background: linear-gradient(${gradientDirection}, ${colors.join(", ")});
    pointer-events: none;
    z-index: 2;
  `;
}

/**
 * Generate inline style for glow effect on stat numbers
 */
export function getStatGlowInlineStyle(
  color: string,
  intensity: "subtle" | "medium" | "strong" = "medium",
): string {
  const config = GLOW_INTENSITY[intensity];

  return `
    text-shadow:
      0 0 ${config.textBlur} ${color}80,
      0 0 ${config.blur} ${color}40;
  `;
}

/**
 * Generate inline style for card glow effect
 */
export function getCardGlowInlineStyle(
  color: string,
  intensity: "subtle" | "medium" | "strong" = "medium",
): string {
  const config = GLOW_INTENSITY[intensity];

  return `
    box-shadow:
      0 4px 6px -1px rgba(0, 0, 0, 0.3),
      0 2px 4px -1px rgba(0, 0, 0, 0.2),
      0 0 ${config.blur} ${color}26,
      0 0 ${config.spread} ${color}15;
  `;
}

// ============================================================================
// Accent Bar Helpers (金色装饰竖条)
// ============================================================================

/**
 * Generate inline style for accent bar
 */
export function getAccentBarInlineStyle(
  color: string = "#D4AF37",
  width: number = 5,
  height: number | "auto" = 35,
  borderRadius: number = 2,
  glow: boolean = false,
): string {
  const baseStyle = `
    width: ${width}px;
    height: ${height === "auto" ? "100%" : `${height}px`};
    background: ${color};
    border-radius: ${borderRadius}px;
  `;

  if (glow) {
    return `${baseStyle}
    box-shadow: 0 0 10px ${color}60, 0 0 20px ${color}30;`;
  }

  return baseStyle;
}

/**
 * Generate CSS for accent bar
 */
export function generateAccentBarCSS(config: AccentBarConfig): string {
  if (!config.enabled) return "";

  const positionClass =
    config.position === "title-left"
      ? "accent-bar-title"
      : config.position === "card-left"
        ? "accent-bar-card"
        : "accent-bar-section";

  const glowStyle = config.glow
    ? `box-shadow: 0 0 10px ${config.color}60, 0 0 20px ${config.color}30;`
    : "";

  return `
    .${positionClass} {
      width: ${config.width}px;
      height: ${config.height === "auto" ? "100%" : `${config.height}px`};
      background: ${config.color};
      border-radius: ${config.borderRadius || 0}px;
      ${glowStyle}
    }
  `;
}

// ============================================================================
// Transparent Border Helpers (透明边框装饰框)
// ============================================================================

/**
 * Generate inline style for transparent border box
 */
export function getTransparentBorderInlineStyle(
  position: "top-left" | "top-right" | "bottom-left" | "bottom-right",
  color: string = "#D4AF37",
  size: number = 80,
  borderWidth: number = 2.5,
  opacity: number = 0.3,
): string {
  const positionMap = {
    "top-left": "top: 0; left: 0;",
    "top-right": "top: 0; right: 0;",
    "bottom-left": "bottom: 0; left: 0;",
    "bottom-right": "bottom: 0; right: 0;",
  };

  const opacityHex = Math.round(opacity * 255)
    .toString(16)
    .padStart(2, "0");

  return `
    position: absolute;
    ${positionMap[position]}
    width: ${size}px;
    height: ${size}px;
    border: ${borderWidth}px solid ${color}${opacityHex};
    background: transparent;
    pointer-events: none;
    z-index: 1;
  `;
}

/**
 * Generate CSS for transparent border decorations
 */
export function generateTransparentBorderCSS(
  config: TransparentBorderConfig,
): string {
  if (!config.enabled || config.positions.length === 0) return "";

  const opacityHex = Math.round(config.opacity * 255)
    .toString(16)
    .padStart(2, "0");

  const styles: string[] = [];

  config.positions.forEach((pos) => {
    const positionMap = {
      "top-left": "top: 0; left: 0;",
      "top-right": "top: 0; right: 0;",
      "bottom-left": "bottom: 0; left: 0;",
      "bottom-right": "bottom: 0; right: 0;",
    };

    styles.push(`
      .transparent-border-${pos} {
        position: absolute;
        ${positionMap[pos]}
        width: ${config.size}px;
        height: ${config.size}px;
        border: ${config.borderWidth}px solid ${config.color}${opacityHex};
        background: transparent;
        pointer-events: none;
        z-index: 1;
      }
    `);
  });

  return styles.join("\n");
}

// ============================================================================
// PPTX-specific Decoration Helpers
// ============================================================================

/**
 * PPTX装饰配置常量
 * 用于PPTX渲染器的装饰元素配置
 */
export const PPTX_DECORATION_CONSTANTS = {
  // 金色装饰竖条 (标题旁)
  accentBar: {
    color: "D4AF37",
    width: 0.05, // 英寸
    height: 0.35, // 英寸
    offsetX: 0.35, // 标题左侧偏移
    offsetY: 0.1, // 标题顶部偏移
  },

  // 章节页金色装饰条 (居中)
  chapterGoldBar: {
    color: "D4AF37",
    width: 1.2, // 英寸
    height: 0.08, // 英寸
  },

  // 透明边框装饰框
  transparentBorder: {
    color: "D4AF37",
    size: 2, // 英寸
    borderWidth: 2.5, // pt
    transparency: 70, // 30% 不透明度
  },

  // 底部洞察框
  insightBox: {
    height: 0.5, // 英寸
    marginX: 0.5, // 左右边距
    marginBottom: 0.5, // 底部边距
    barWidth: 0.04, // 左侧竖条宽度
    colors: {
      insight: { bg: "10B981", bar: "10B981", text: "D1FAE5" },
      warning: { bg: "F59E0B", bar: "F59E0B", text: "FEF3C7" },
      tip: { bg: "3B82F6", bar: "3B82F6", text: "DBEAFE" },
      summary: { bg: "D4AF37", bar: "D4AF37", text: "FEF9C3" },
    },
    icons: {
      insight: "\u{1F4A1}", // 💡
      warning: "\u26A0\uFE0F", // ⚠️
      tip: "\u{1F4AD}", // 💭
      summary: "\u{1F4CC}", // 📌
    },
  },

  // 页脚
  footer: {
    y: 6.6, // 英寸
    height: 0.25, // 英寸
    fontSize: 10,
    color: "94A3B8",
  },
} as const;

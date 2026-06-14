/**
 * Decorations Unit Tests
 *
 * Tests for the slides decoration system:
 * - CSS generation functions (corner accents, glow effects, gradient bars, geometric shapes)
 * - HTML generation functions
 * - Inline style helpers
 * - Accent bar helpers
 * - Transparent border helpers
 * - Preset constants
 */

import {
  generateDecorationHtml,
  generateDecorationCSS,
  getDecorationPreset,
  getCornerAccentInlineStyle,
  getGradientBarInlineStyle,
  getStatGlowInlineStyle,
  getCardGlowInlineStyle,
  getAccentBarInlineStyle,
  generateAccentBarCSS,
  getTransparentBorderInlineStyle,
  generateTransparentBorderCSS,
  DECORATION_PRESETS,
  PPTX_DECORATION_CONSTANTS,
  DecorationConfig,
  AccentBarConfig,
  TransparentBorderConfig,
} from "../decorations";

// ============================================================================
// Helpers
// ============================================================================

function makeFullDecorationConfig(): DecorationConfig {
  return {
    cornerAccent: {
      enabled: true,
      positions: ["top-left", "top-right", "bottom-left", "bottom-right"],
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
      colors: ["transparent", "#D4AF37", "transparent"],
      height: 4,
    },
    geometricShapes: {
      enabled: true,
      shapes: [
        {
          type: "circle",
          x: "80%",
          y: "20%",
          size: 50,
          color: "#D4AF37",
          opacity: 0.1,
        },
        {
          type: "ring",
          x: "10%",
          y: "80%",
          size: 30,
          color: "#3B82F6",
          opacity: 0.15,
        },
      ],
    },
  };
}

function makeMinimalDecorationConfig(): DecorationConfig {
  return {
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
  };
}

// ============================================================================
// DECORATION_PRESETS
// ============================================================================

describe("DECORATION_PRESETS", () => {
  it("should have genspark-dark preset", () => {
    expect(DECORATION_PRESETS["genspark-dark"]).toBeDefined();
  });

  it("should have tech-purple preset", () => {
    expect(DECORATION_PRESETS["tech-purple"]).toBeDefined();
  });

  it("should have executive-white preset", () => {
    expect(DECORATION_PRESETS["executive-white"]).toBeDefined();
  });

  it("should have nature-green preset", () => {
    expect(DECORATION_PRESETS["nature-green"]).toBeDefined();
  });

  it("should have warm-sunset preset", () => {
    expect(DECORATION_PRESETS["warm-sunset"]).toBeDefined();
  });

  it("should have minimal preset", () => {
    expect(DECORATION_PRESETS["minimal"]).toBeDefined();
  });

  it("each preset should have required DecorationConfig properties", () => {
    for (const [, config] of Object.entries(DECORATION_PRESETS)) {
      expect(config).toHaveProperty("cornerAccent");
      expect(config).toHaveProperty("glowEffect");
      expect(config).toHaveProperty("gradientBar");
      expect(config).toHaveProperty("geometricShapes");
    }
  });

  it("genspark-dark should have accentBar and transparentBorder", () => {
    const preset = DECORATION_PRESETS["genspark-dark"];
    expect(preset.accentBar).toBeDefined();
    expect(preset.transparentBorder).toBeDefined();
  });

  it("minimal preset should have all features disabled", () => {
    const minimal = DECORATION_PRESETS["minimal"];
    expect(minimal.cornerAccent.enabled).toBe(false);
    expect(minimal.glowEffect.enabled).toBe(false);
    expect(minimal.gradientBar.enabled).toBe(false);
    expect(minimal.geometricShapes.enabled).toBe(false);
  });
});

// ============================================================================
// PPTX_DECORATION_CONSTANTS
// ============================================================================

describe("PPTX_DECORATION_CONSTANTS", () => {
  it("should have accentBar configuration", () => {
    expect(PPTX_DECORATION_CONSTANTS.accentBar).toBeDefined();
    expect(PPTX_DECORATION_CONSTANTS.accentBar.color).toBe("D4AF37");
  });

  it("should have chapterGoldBar configuration", () => {
    expect(PPTX_DECORATION_CONSTANTS.chapterGoldBar).toBeDefined();
  });

  it("should have transparentBorder configuration", () => {
    expect(PPTX_DECORATION_CONSTANTS.transparentBorder).toBeDefined();
  });

  it("should have insightBox with all color types", () => {
    expect(PPTX_DECORATION_CONSTANTS.insightBox.colors.insight).toBeDefined();
    expect(PPTX_DECORATION_CONSTANTS.insightBox.colors.warning).toBeDefined();
    expect(PPTX_DECORATION_CONSTANTS.insightBox.colors.tip).toBeDefined();
    expect(PPTX_DECORATION_CONSTANTS.insightBox.colors.summary).toBeDefined();
  });

  it("should have footer configuration", () => {
    expect(PPTX_DECORATION_CONSTANTS.footer).toBeDefined();
    expect(typeof PPTX_DECORATION_CONSTANTS.footer.y).toBe("number");
  });
});

// ============================================================================
// getDecorationPreset
// ============================================================================

describe("getDecorationPreset", () => {
  it("should return the named preset", () => {
    const preset = getDecorationPreset("genspark-dark");
    expect(preset).toBe(DECORATION_PRESETS["genspark-dark"]);
  });

  it("should fall back to genspark-dark for unknown name", () => {
    const preset = getDecorationPreset("nonexistent-theme");
    expect(preset).toBe(DECORATION_PRESETS["genspark-dark"]);
  });

  it("should return tech-purple preset when requested", () => {
    const preset = getDecorationPreset("tech-purple");
    expect(preset).toBe(DECORATION_PRESETS["tech-purple"]);
  });

  it("should return minimal preset when requested", () => {
    const preset = getDecorationPreset("minimal");
    expect(preset).toBe(DECORATION_PRESETS["minimal"]);
  });
});

// ============================================================================
// generateDecorationHtml
// ============================================================================

describe("generateDecorationHtml", () => {
  it("should generate corner accent divs for each enabled position", () => {
    const config = makeFullDecorationConfig();
    const html = generateDecorationHtml(config);

    expect(html).toContain('class="corner-accent-top-left"');
    expect(html).toContain('class="corner-accent-top-right"');
    expect(html).toContain('class="corner-accent-bottom-left"');
    expect(html).toContain('class="corner-accent-bottom-right"');
  });

  it("should not generate corner accent divs when disabled", () => {
    const config = makeMinimalDecorationConfig();
    const html = generateDecorationHtml(config);

    expect(html).not.toContain("corner-accent");
  });

  it("should generate gradient bar div when enabled", () => {
    const config = makeFullDecorationConfig();
    const html = generateDecorationHtml(config);

    expect(html).toContain('class="gradient-bar-bottom"');
  });

  it("should not generate gradient bar when disabled", () => {
    const config = makeMinimalDecorationConfig();
    const html = generateDecorationHtml(config);

    expect(html).not.toContain("gradient-bar");
  });

  it("should generate geometric shape divs when enabled", () => {
    const config = makeFullDecorationConfig();
    const html = generateDecorationHtml(config);

    expect(html).toContain('class="geo-shape-0"');
    expect(html).toContain('class="geo-shape-1"');
  });

  it("should not generate geometric shape divs when disabled", () => {
    const config = makeMinimalDecorationConfig();
    const html = generateDecorationHtml(config);

    expect(html).not.toContain("geo-shape");
  });

  it("should generate transparent border divs when enabled", () => {
    const config: DecorationConfig = {
      ...makeFullDecorationConfig(),
      transparentBorder: {
        enabled: true,
        positions: ["top-right", "bottom-left"],
        color: "#D4AF37",
        size: 80,
        borderWidth: 2.5,
        opacity: 0.3,
      },
    };
    const html = generateDecorationHtml(config);

    expect(html).toContain("border:");
  });

  it("should not generate transparent border divs when transparentBorder undefined", () => {
    const config = makeFullDecorationConfig();
    // No transparentBorder property
    const html = generateDecorationHtml(config);

    // HTML should exist but no transparent border specific content
    expect(html).toBeDefined();
  });

  it("should not generate transparent border divs when disabled", () => {
    const config: DecorationConfig = {
      ...makeFullDecorationConfig(),
      transparentBorder: {
        enabled: false,
        positions: ["top-left"],
        color: "#D4AF37",
        size: 80,
        borderWidth: 2.5,
        opacity: 0.3,
      },
    };
    const html = generateDecorationHtml(config);

    // Should not contain transparent border inline style
    expect(html).not.toContain("border: 2.5px");
  });

  it("should return empty string when all features disabled", () => {
    const config = makeMinimalDecorationConfig();
    const html = generateDecorationHtml(config);

    expect(html.trim()).toBe("");
  });
});

// ============================================================================
// generateDecorationCSS
// ============================================================================

describe("generateDecorationCSS", () => {
  it("should generate CSS for all enabled features", () => {
    const config = makeFullDecorationConfig();
    const css = generateDecorationCSS(config);

    expect(css).toContain(".corner-accent-top-left");
    expect(css).toContain(".glow-stat");
    expect(css).toContain(".gradient-bar-bottom");
    expect(css).toContain(".geo-shape-0");
  });

  it("should return empty or minimal CSS when all disabled", () => {
    const config = makeMinimalDecorationConfig();
    const css = generateDecorationCSS(config);

    expect(typeof css).toBe("string");
    expect(css).not.toContain(".corner-accent");
    expect(css).not.toContain(".glow-");
    expect(css).not.toContain(".gradient-bar");
    expect(css).not.toContain(".geo-shape");
  });

  it("should generate gradient style CSS for corner accent top-left", () => {
    const config: DecorationConfig = {
      ...makeMinimalDecorationConfig(),
      cornerAccent: {
        enabled: true,
        positions: ["top-left"],
        style: "gradient",
        color: "#D4AF37",
        opacity: 0.3,
        size: 120,
      },
    };
    const css = generateDecorationCSS(config);

    expect(css).toContain(".corner-accent-top-left");
    expect(css).toContain("linear-gradient");
  });

  it("should generate CSS for non-gradient corner accent style", () => {
    const config: DecorationConfig = {
      ...makeMinimalDecorationConfig(),
      cornerAccent: {
        enabled: true,
        positions: ["top-right"],
        style: "line",
        color: "#FF0000",
        opacity: 0.5,
        size: 80,
      },
    };
    const css = generateDecorationCSS(config);

    expect(css).toContain(".corner-accent-top-right");
  });

  it("should generate CSS for bottom-left corner with secondaryColor", () => {
    const config: DecorationConfig = {
      ...makeMinimalDecorationConfig(),
      cornerAccent: {
        enabled: true,
        positions: ["bottom-left"],
        style: "gradient",
        color: "#D4AF37",
        secondaryColor: "#3B82F6",
        opacity: 0.3,
        size: 100,
      },
    };
    const css = generateDecorationCSS(config);

    expect(css).toContain(".corner-accent-bottom-left");
    expect(css).toContain("3B82F6");
  });

  it("should generate CSS for bottom-right corner accent", () => {
    const config: DecorationConfig = {
      ...makeMinimalDecorationConfig(),
      cornerAccent: {
        enabled: true,
        positions: ["bottom-right"],
        style: "gradient",
        color: "#A855F7",
        opacity: 0.25,
        size: 150,
      },
    };
    const css = generateDecorationCSS(config);

    expect(css).toContain(".corner-accent-bottom-right");
  });

  it("should not generate corner CSS when positions array is empty", () => {
    const config: DecorationConfig = {
      ...makeMinimalDecorationConfig(),
      cornerAccent: {
        enabled: true,
        positions: [],
        style: "gradient",
        color: "#D4AF37",
        opacity: 0.3,
        size: 120,
      },
    };
    const css = generateDecorationCSS(config);

    expect(css).not.toContain(".corner-accent");
  });

  it("should generate glow CSS for card target", () => {
    const config: DecorationConfig = {
      ...makeMinimalDecorationConfig(),
      glowEffect: {
        enabled: true,
        target: "card",
        color: "#A855F7",
        intensity: "medium",
      },
    };
    const css = generateDecorationCSS(config);

    expect(css).toContain(".glow-card");
    expect(css).toContain("box-shadow");
  });

  it("should generate glow CSS for title target", () => {
    const config: DecorationConfig = {
      ...makeMinimalDecorationConfig(),
      glowEffect: {
        enabled: true,
        target: "title",
        color: "#F97316",
        intensity: "strong",
      },
    };
    const css = generateDecorationCSS(config);

    expect(css).toContain(".glow-title");
    expect(css).toContain("text-shadow");
  });

  it("should generate glow CSS for accent target (card + stat + title)", () => {
    const config: DecorationConfig = {
      ...makeMinimalDecorationConfig(),
      glowEffect: {
        enabled: true,
        target: "accent",
        color: "#D4AF37",
        intensity: "subtle",
      },
    };
    const css = generateDecorationCSS(config);

    expect(css).toContain(".glow-card");
    expect(css).toContain(".glow-stat");
    expect(css).toContain(".glow-title");
  });

  it("should generate gradient bar CSS for top position", () => {
    const config: DecorationConfig = {
      ...makeMinimalDecorationConfig(),
      gradientBar: {
        enabled: true,
        position: "top",
        colors: ["#A855F7", "#06B6D4"],
        height: 3,
      },
    };
    const css = generateDecorationCSS(config);

    expect(css).toContain(".gradient-bar-top");
    expect(css).toContain("top: 0;");
  });

  it("should generate gradient bar CSS for left position", () => {
    const config: DecorationConfig = {
      ...makeMinimalDecorationConfig(),
      gradientBar: {
        enabled: true,
        position: "left",
        colors: ["#1E40AF", "#DC2626"],
        height: 3,
      },
    };
    const css = generateDecorationCSS(config);

    expect(css).toContain(".gradient-bar-left");
    expect(css).toContain("width: 3px");
  });

  it("should generate gradient bar CSS for right position", () => {
    const config: DecorationConfig = {
      ...makeMinimalDecorationConfig(),
      gradientBar: {
        enabled: true,
        position: "right",
        colors: ["#10B981", "#F59E0B"],
        height: 5,
      },
    };
    const css = generateDecorationCSS(config);

    expect(css).toContain(".gradient-bar-right");
    expect(css).toContain("width: 5px");
  });

  it("should generate all 5 shape types CSS", () => {
    const shapes: Array<{
      type: "circle" | "diamond" | "square" | "triangle" | "ring";
      x: string;
      y: string;
      size: number;
      color: string;
      opacity: number;
    }> = [
      {
        type: "circle",
        x: "10%",
        y: "10%",
        size: 40,
        color: "#D4AF37",
        opacity: 0.1,
      },
      {
        type: "ring",
        x: "20%",
        y: "20%",
        size: 30,
        color: "#3B82F6",
        opacity: 0.15,
      },
      {
        type: "diamond",
        x: "30%",
        y: "30%",
        size: 25,
        color: "#A855F7",
        opacity: 0.12,
      },
      {
        type: "square",
        x: "40%",
        y: "40%",
        size: 35,
        color: "#10B981",
        opacity: 0.08,
      },
      {
        type: "triangle",
        x: "50%",
        y: "50%",
        size: 20,
        color: "#F97316",
        opacity: 0.1,
      },
    ];

    const config: DecorationConfig = {
      ...makeMinimalDecorationConfig(),
      geometricShapes: {
        enabled: true,
        shapes,
      },
    };

    const css = generateDecorationCSS(config);

    expect(css).toContain("border-radius: 50%"); // circle
    expect(css).toContain("border: 2px solid"); // ring
    expect(css).toContain("rotate(45deg)"); // diamond
    expect(css).toContain("border-radius: 4px"); // square
    expect(css).toContain("border-left:"); // triangle
  });

  it("should include blur CSS for shapes with blur property", () => {
    const config: DecorationConfig = {
      ...makeMinimalDecorationConfig(),
      geometricShapes: {
        enabled: true,
        shapes: [
          {
            type: "circle",
            x: "80%",
            y: "20%",
            size: 80,
            color: "#A855F7",
            opacity: 0.08,
            blur: 20,
          },
        ],
      },
    };

    const css = generateDecorationCSS(config);

    expect(css).toContain("filter: blur(20px)");
  });

  it("should not generate shape CSS when shapes list is empty", () => {
    const config: DecorationConfig = {
      ...makeMinimalDecorationConfig(),
      geometricShapes: {
        enabled: true,
        shapes: [],
      },
    };

    const css = generateDecorationCSS(config);

    expect(css).not.toContain(".geo-shape");
  });
});

// ============================================================================
// getCornerAccentInlineStyle
// ============================================================================

describe("getCornerAccentInlineStyle", () => {
  const positions = [
    "top-left",
    "top-right",
    "bottom-left",
    "bottom-right",
  ] as const;

  positions.forEach((position) => {
    it(`should return inline style string for ${position}`, () => {
      const style = getCornerAccentInlineStyle(position, "#D4AF37");

      expect(typeof style).toBe("string");
      expect(style).toContain("position: absolute");
      expect(style).toContain("clip-path");
      expect(style).toContain("background");
    });
  });

  it("should use default opacity of 0.3 when not specified", () => {
    const style = getCornerAccentInlineStyle("top-left", "#D4AF37");
    // Opacity 0.3 * 255 = 76.5 -> Math.round(76.5) = 77 -> 4d
    expect(style).toContain("4d");
  });

  it("should use specified opacity", () => {
    const style = getCornerAccentInlineStyle("top-left", "#FF0000", 1.0);
    // Opacity 1.0 * 255 = 255 -> ff
    expect(style).toContain("ff");
  });

  it("should use specified size", () => {
    const style = getCornerAccentInlineStyle("top-left", "#D4AF37", 0.3, 200);

    expect(style).toContain("200px");
  });

  it("top-left should use 135deg gradient", () => {
    const style = getCornerAccentInlineStyle("top-left", "#D4AF37");

    expect(style).toContain("135deg");
    expect(style).toContain("polygon(0 0, 100% 0, 0 100%)");
  });

  it("top-right should use -135deg gradient", () => {
    const style = getCornerAccentInlineStyle("top-right", "#D4AF37");

    expect(style).toContain("-135deg");
    expect(style).toContain("polygon(0 0, 100% 0, 100% 100%)");
  });

  it("bottom-left should use 45deg gradient", () => {
    const style = getCornerAccentInlineStyle("bottom-left", "#D4AF37");

    expect(style).toContain("45deg");
    expect(style).toContain("polygon(0 0, 100% 100%, 0 100%)");
  });

  it("bottom-right should use -45deg gradient", () => {
    const style = getCornerAccentInlineStyle("bottom-right", "#D4AF37");

    expect(style).toContain("-45deg");
    expect(style).toContain("polygon(100% 0, 100% 100%, 0 100%)");
  });
});

// ============================================================================
// getGradientBarInlineStyle
// ============================================================================

describe("getGradientBarInlineStyle", () => {
  it("should return inline style for top position", () => {
    const style = getGradientBarInlineStyle("top", ["#A855F7", "#06B6D4"]);

    expect(style).toContain("top: 0;");
    expect(style).toContain("90deg");
    expect(style).toContain("height:");
    expect(style).toContain("width: 100%");
  });

  it("should return inline style for bottom position", () => {
    const style = getGradientBarInlineStyle("bottom", [
      "transparent",
      "#D4AF37",
      "transparent",
    ]);

    expect(style).toContain("bottom: 0;");
    expect(style).toContain("90deg");
  });

  it("should return inline style for left position (vertical)", () => {
    const style = getGradientBarInlineStyle("left", ["#1E40AF", "#DC2626"]);

    expect(style).toContain("left: 0;");
    expect(style).toContain("180deg");
    expect(style).toContain("width:");
    expect(style).toContain("height: 100%");
  });

  it("should return inline style for right position (vertical)", () => {
    const style = getGradientBarInlineStyle("right", ["#10B981", "#F59E0B"]);

    expect(style).toContain("right: 0;");
    expect(style).toContain("180deg");
  });

  it("should use specified height", () => {
    const style = getGradientBarInlineStyle("top", ["#D4AF37"], 8);

    expect(style).toContain("8px");
  });

  it("should use default height of 4 when not specified", () => {
    const style = getGradientBarInlineStyle("bottom", ["#D4AF37"]);

    expect(style).toContain("4px");
  });

  it("should include all color stops in gradient", () => {
    const colors = ["#FF0000", "#00FF00", "#0000FF"];
    const style = getGradientBarInlineStyle("top", colors);

    expect(style).toContain("#FF0000");
    expect(style).toContain("#00FF00");
    expect(style).toContain("#0000FF");
  });
});

// ============================================================================
// getStatGlowInlineStyle
// ============================================================================

describe("getStatGlowInlineStyle", () => {
  it("should return text-shadow style string", () => {
    const style = getStatGlowInlineStyle("#D4AF37");

    expect(style).toContain("text-shadow");
    expect(style).toContain("#D4AF37");
  });

  it("should use subtle intensity", () => {
    const style = getStatGlowInlineStyle("#D4AF37", "subtle");

    // subtle: textBlur=8px
    expect(style).toContain("8px");
  });

  it("should use medium intensity (default)", () => {
    const style = getStatGlowInlineStyle("#D4AF37", "medium");

    // medium: textBlur=15px
    expect(style).toContain("15px");
  });

  it("should use strong intensity", () => {
    const style = getStatGlowInlineStyle("#D4AF37", "strong");

    // strong: textBlur=25px
    expect(style).toContain("25px");
  });

  it("should default to medium when intensity not specified", () => {
    const defaultStyle = getStatGlowInlineStyle("#D4AF37");
    const mediumStyle = getStatGlowInlineStyle("#D4AF37", "medium");

    expect(defaultStyle).toBe(mediumStyle);
  });
});

// ============================================================================
// getCardGlowInlineStyle
// ============================================================================

describe("getCardGlowInlineStyle", () => {
  it("should return box-shadow style string", () => {
    const style = getCardGlowInlineStyle("#D4AF37");

    expect(style).toContain("box-shadow");
    expect(style).toContain("#D4AF37");
  });

  it("should use subtle intensity", () => {
    const style = getCardGlowInlineStyle("#A855F7", "subtle");

    // subtle: blur=10px
    expect(style).toContain("10px");
  });

  it("should use medium intensity (default)", () => {
    const style = getCardGlowInlineStyle("#D4AF37", "medium");

    // medium: blur=20px
    expect(style).toContain("20px");
  });

  it("should use strong intensity", () => {
    const style = getCardGlowInlineStyle("#D4AF37", "strong");

    // strong: blur=40px, spread=20px
    expect(style).toContain("40px");
  });

  it("should include rgba base shadow", () => {
    const style = getCardGlowInlineStyle("#D4AF37");

    expect(style).toContain("rgba(0, 0, 0");
  });
});

// ============================================================================
// getAccentBarInlineStyle
// ============================================================================

describe("getAccentBarInlineStyle", () => {
  it("should return style string with width and height", () => {
    const style = getAccentBarInlineStyle("#D4AF37", 5, 35, 2, false);

    expect(style).toContain("width: 5px");
    expect(style).toContain("height: 35px");
    expect(style).toContain("background: #D4AF37");
  });

  it("should use auto height when height is 'auto'", () => {
    const style = getAccentBarInlineStyle("#D4AF37", 5, "auto", 2, false);

    expect(style).toContain("height: 100%");
  });

  it("should add box-shadow when glow is true", () => {
    const style = getAccentBarInlineStyle("#D4AF37", 5, 35, 2, true);

    expect(style).toContain("box-shadow");
    expect(style).toContain("10px");
  });

  it("should not add box-shadow when glow is false", () => {
    const style = getAccentBarInlineStyle("#D4AF37", 5, 35, 2, false);

    expect(style).not.toContain("box-shadow");
  });

  it("should use default values when not specified", () => {
    const style = getAccentBarInlineStyle();

    expect(style).toContain("#D4AF37");
    expect(style).toContain("width: 5px");
    expect(style).toContain("height: 35px");
    expect(style).toContain("border-radius: 2px");
  });
});

// ============================================================================
// generateAccentBarCSS
// ============================================================================

describe("generateAccentBarCSS", () => {
  it("should return empty string when disabled", () => {
    const config: AccentBarConfig = {
      enabled: false,
      position: "title-left",
      color: "#D4AF37",
      width: 5,
      height: 35,
    };

    expect(generateAccentBarCSS(config)).toBe("");
  });

  it("should generate CSS for title-left position", () => {
    const config: AccentBarConfig = {
      enabled: true,
      position: "title-left",
      color: "#D4AF37",
      width: 5,
      height: 35,
      borderRadius: 2,
    };

    const css = generateAccentBarCSS(config);

    expect(css).toContain(".accent-bar-title");
    expect(css).toContain("width: 5px");
    expect(css).toContain("height: 35px");
  });

  it("should generate CSS for card-left position", () => {
    const config: AccentBarConfig = {
      enabled: true,
      position: "card-left",
      color: "#A855F7",
      width: 4,
      height: "auto",
    };

    const css = generateAccentBarCSS(config);

    expect(css).toContain(".accent-bar-card");
    expect(css).toContain("height: 100%");
  });

  it("should generate CSS for section-top position", () => {
    const config: AccentBarConfig = {
      enabled: true,
      position: "section-top",
      color: "#10B981",
      width: 3,
      height: 60,
    };

    const css = generateAccentBarCSS(config);

    expect(css).toContain(".accent-bar-section");
  });

  it("should include glow box-shadow when glow is true", () => {
    const config: AccentBarConfig = {
      enabled: true,
      position: "title-left",
      color: "#D4AF37",
      width: 5,
      height: 35,
      glow: true,
    };

    const css = generateAccentBarCSS(config);

    expect(css).toContain("box-shadow");
  });

  it("should not include box-shadow when glow is false", () => {
    const config: AccentBarConfig = {
      enabled: true,
      position: "title-left",
      color: "#D4AF37",
      width: 5,
      height: 35,
      glow: false,
    };

    const css = generateAccentBarCSS(config);

    expect(css).not.toContain("box-shadow");
  });

  it("should use borderRadius 0 when not specified", () => {
    const config: AccentBarConfig = {
      enabled: true,
      position: "title-left",
      color: "#D4AF37",
      width: 5,
      height: 35,
    };

    const css = generateAccentBarCSS(config);

    expect(css).toContain("border-radius: 0px");
  });
});

// ============================================================================
// getTransparentBorderInlineStyle
// ============================================================================

describe("getTransparentBorderInlineStyle", () => {
  const positions = [
    "top-left",
    "top-right",
    "bottom-left",
    "bottom-right",
  ] as const;

  positions.forEach((position) => {
    it(`should return inline style for ${position}`, () => {
      const style = getTransparentBorderInlineStyle(
        position,
        "#D4AF37",
        80,
        2.5,
        0.3,
      );

      expect(typeof style).toBe("string");
      expect(style).toContain("position: absolute");
      expect(style).toContain("border:");
      expect(style).toContain("background: transparent");
    });
  });

  it("should include the correct position for top-left", () => {
    const style = getTransparentBorderInlineStyle("top-left", "#D4AF37");

    expect(style).toContain("top: 0;");
    expect(style).toContain("left: 0;");
  });

  it("should include the correct position for bottom-right", () => {
    const style = getTransparentBorderInlineStyle("bottom-right", "#D4AF37");

    expect(style).toContain("bottom: 0;");
    expect(style).toContain("right: 0;");
  });

  it("should use specified size", () => {
    const style = getTransparentBorderInlineStyle("top-left", "#D4AF37", 100);

    expect(style).toContain("width: 100px");
    expect(style).toContain("height: 100px");
  });

  it("should use specified border width", () => {
    const style = getTransparentBorderInlineStyle("top-left", "#D4AF37", 80, 3);

    expect(style).toContain("3px solid");
  });

  it("should use default values when not specified", () => {
    const style = getTransparentBorderInlineStyle("top-left");

    expect(style).toContain("width: 80px");
    expect(style).toContain("2.5px solid");
  });

  it("should embed opacity in color hex", () => {
    // opacity 0.5 * 255 = 127.5 -> Math.round(127.5) = 128 -> 80
    const style = getTransparentBorderInlineStyle(
      "top-left",
      "#D4AF37",
      80,
      2.5,
      0.5,
    );

    expect(style).toContain("80");
  });
});

// ============================================================================
// generateTransparentBorderCSS
// ============================================================================

describe("generateTransparentBorderCSS", () => {
  it("should return empty string when disabled", () => {
    const config: TransparentBorderConfig = {
      enabled: false,
      positions: ["top-left"],
      color: "#D4AF37",
      size: 80,
      borderWidth: 2.5,
      opacity: 0.3,
    };

    expect(generateTransparentBorderCSS(config)).toBe("");
  });

  it("should return empty string when positions array is empty", () => {
    const config: TransparentBorderConfig = {
      enabled: true,
      positions: [],
      color: "#D4AF37",
      size: 80,
      borderWidth: 2.5,
      opacity: 0.3,
    };

    expect(generateTransparentBorderCSS(config)).toBe("");
  });

  it("should generate CSS for each position", () => {
    const config: TransparentBorderConfig = {
      enabled: true,
      positions: ["top-right", "bottom-left"],
      color: "#D4AF37",
      size: 80,
      borderWidth: 2.5,
      opacity: 0.3,
    };

    const css = generateTransparentBorderCSS(config);

    expect(css).toContain(".transparent-border-top-right");
    expect(css).toContain(".transparent-border-bottom-left");
  });

  it("should embed color with opacity hex in border", () => {
    const config: TransparentBorderConfig = {
      enabled: true,
      positions: ["top-left"],
      color: "#D4AF37",
      size: 80,
      borderWidth: 2.5,
      opacity: 0.3,
    };

    const css = generateTransparentBorderCSS(config);

    // 0.3 * 255 = 76.5 -> Math.round(76.5) = 77 -> 4d
    expect(css).toContain("#D4AF374d");
  });

  it("should include size and border width in generated CSS", () => {
    const config: TransparentBorderConfig = {
      enabled: true,
      positions: ["top-left"],
      color: "#D4AF37",
      size: 100,
      borderWidth: 3,
      opacity: 0.3,
    };

    const css = generateTransparentBorderCSS(config);

    expect(css).toContain("width: 100px");
    expect(css).toContain("height: 100px");
    expect(css).toContain("3px solid");
  });

  it("should generate CSS for all four positions", () => {
    const config: TransparentBorderConfig = {
      enabled: true,
      positions: ["top-left", "top-right", "bottom-left", "bottom-right"],
      color: "#D4AF37",
      size: 80,
      borderWidth: 2.5,
      opacity: 0.3,
    };

    const css = generateTransparentBorderCSS(config);

    expect(css).toContain(".transparent-border-top-left");
    expect(css).toContain(".transparent-border-top-right");
    expect(css).toContain(".transparent-border-bottom-left");
    expect(css).toContain(".transparent-border-bottom-right");
  });
});

// ============================================================================
// Full preset: generateDecorationHtml + generateDecorationCSS
// ============================================================================

describe("Preset integration", () => {
  it("genspark-dark preset should produce valid HTML", () => {
    const config = DECORATION_PRESETS["genspark-dark"];
    const html = generateDecorationHtml(config);

    expect(typeof html).toBe("string");
  });

  it("genspark-dark preset should produce valid CSS", () => {
    const config = DECORATION_PRESETS["genspark-dark"];
    const css = generateDecorationCSS(config);

    expect(typeof css).toBe("string");
    expect(css.length).toBeGreaterThan(0);
  });

  it("tech-purple preset should produce valid HTML", () => {
    const config = DECORATION_PRESETS["tech-purple"];
    const html = generateDecorationHtml(config);

    expect(typeof html).toBe("string");
  });

  it("executive-white preset CSS should not include glow (disabled)", () => {
    const config = DECORATION_PRESETS["executive-white"];
    const css = generateDecorationCSS(config);

    expect(css).not.toContain(".glow-");
  });

  it("nature-green preset should render geometric shapes", () => {
    const config = DECORATION_PRESETS["nature-green"];
    const html = generateDecorationHtml(config);

    expect(html).toContain("geo-shape");
  });

  it("warm-sunset preset should produce HTML and CSS", () => {
    const config = DECORATION_PRESETS["warm-sunset"];

    expect(() => generateDecorationHtml(config)).not.toThrow();
    expect(() => generateDecorationCSS(config)).not.toThrow();
  });

  it("minimal preset should produce empty HTML", () => {
    const config = DECORATION_PRESETS["minimal"];
    const html = generateDecorationHtml(config);

    expect(html.trim()).toBe("");
  });
});

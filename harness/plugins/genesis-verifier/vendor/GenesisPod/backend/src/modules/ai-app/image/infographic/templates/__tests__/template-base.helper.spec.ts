import { TemplateBaseHelper } from "../template-base.helper";
import { InfographicContent, InfographicStyle } from "../../types";
import { CARD_GRADIENTS } from "../../infographic.constants";

jest.mock("../../../../../../common/config/app.config", () => ({
  APP_CONFIG: { brand: { name: "TestBrand", fullName: "TestBrand AI" } },
}));

// Concrete subclass to expose protected methods for testing
class TestableTemplateHelper extends TemplateBaseHelper {
  public testGetStyleConfig(content: InfographicContent) {
    return this.getStyleConfig(content);
  }

  public testGetBackgroundStyle(
    styleKey: InfographicStyle,
    colors: Record<string, string | string[]>,
    isDarkMode: boolean,
    backgroundImageBase64?: string,
  ) {
    return this.getBackgroundStyle(
      styleKey,
      colors,
      isDarkMode,
      backgroundImageBase64,
    );
  }

  public testCalculateScale(width: number, height: number) {
    return this.calculateScale(width, height);
  }

  public testGetConstants() {
    return this.getConstants();
  }

  public testGetBrand() {
    return this.getBrand();
  }

  public get testUtils() {
    return this.utils;
  }
}

describe("TemplateBaseHelper", () => {
  let helper: TestableTemplateHelper;

  beforeEach(() => {
    helper = new TestableTemplateHelper();
  });

  describe("getStyleConfig", () => {
    const baseContent: InfographicContent = {
      title: "Test",
      sections: [],
    };

    it("should return consulting style by default when no style options provided", () => {
      const result = helper.testGetStyleConfig(baseContent);
      expect(result.styleKey).toBe("consulting");
    });

    it("should return the specified style key", () => {
      const content = {
        ...baseContent,
        styleOptions: { style: "tech" as const },
      };
      const result = helper.testGetStyleConfig(content);
      expect(result.styleKey).toBe("tech");
    });

    it("should use colorScheme overrides when provided", () => {
      const content: InfographicContent = {
        ...baseContent,
        colorScheme: {
          primary: "#ff0000",
          accent: "#00ff00",
          background: "#0000ff",
          text: "#ffffff",
        },
      };
      const result = helper.testGetStyleConfig(content);
      expect(result.colors.primary).toBe("#ff0000");
      expect(result.colors.accent).toBe("#00ff00");
    });

    it("should fall back to style preset colors when no colorScheme", () => {
      const result = helper.testGetStyleConfig(baseContent);
      expect(result.colors.primary).toBe("#1e3a5f");
    });

    it('should set isDarkMode true for "dark" style', () => {
      const content = {
        ...baseContent,
        styleOptions: { style: "dark" as const },
      };
      const { isDarkMode } = helper.testGetStyleConfig(content);
      expect(isDarkMode).toBe(true);
    });

    it('should set isDarkMode true for "genspark" style', () => {
      const content = {
        ...baseContent,
        styleOptions: { style: "genspark" as const },
      };
      const { isDarkMode } = helper.testGetStyleConfig(content);
      expect(isDarkMode).toBe(true);
    });

    it('should set isDarkMode true for "tech_gradient" style', () => {
      const content = {
        ...baseContent,
        styleOptions: { style: "tech_gradient" as const },
      };
      const { isDarkMode } = helper.testGetStyleConfig(content);
      expect(isDarkMode).toBe(true);
    });

    it("should set isDarkMode false for light styles", () => {
      const content = {
        ...baseContent,
        styleOptions: { style: "consulting" as const },
      };
      const { isDarkMode } = helper.testGetStyleConfig(content);
      expect(isDarkMode).toBe(false);
    });

    it('should set isGlassmorphism true for "genspark"', () => {
      const content = {
        ...baseContent,
        styleOptions: { style: "genspark" as const },
      };
      const { isGlassmorphism } = helper.testGetStyleConfig(content);
      expect(isGlassmorphism).toBe(true);
    });

    it('should set isGlassmorphism true for "tech_gradient"', () => {
      const content = {
        ...baseContent,
        styleOptions: { style: "tech_gradient" as const },
      };
      const { isGlassmorphism } = helper.testGetStyleConfig(content);
      expect(isGlassmorphism).toBe(true);
    });

    it("should set isGlassmorphism false for normal styles", () => {
      const { isGlassmorphism } = helper.testGetStyleConfig(baseContent);
      expect(isGlassmorphism).toBe(false);
    });

    it("should use fontStyle from styleOptions", () => {
      const content = {
        ...baseContent,
        styleOptions: { fontStyle: "serif" as const },
      };
      const { fontFamily } = helper.testGetStyleConfig(content);
      expect(fontFamily).toContain("Noto Serif SC");
    });

    it("should default to sans font when no fontStyle set", () => {
      const { fontFamily } = helper.testGetStyleConfig(baseContent);
      expect(fontFamily).toContain("Noto Sans SC");
    });

    it('should fall back to stylePreset borderRadius for "none" due to falsy 0 in || expression', () => {
      // borderRadiusMap['none'] = 0, then 0 || stylePreset.borderRadius = 12 (consulting)
      const content = {
        ...baseContent,
        styleOptions: { borderRadius: "none" as const },
      };
      const { baseBorderRadius } = helper.testGetStyleConfig(content);
      expect(baseBorderRadius).toBe(12);
    });

    it('should map "small" borderRadius to 4', () => {
      const content = {
        ...baseContent,
        styleOptions: { borderRadius: "small" as const },
      };
      const { baseBorderRadius } = helper.testGetStyleConfig(content);
      expect(baseBorderRadius).toBe(4);
    });

    it('should map "large" borderRadius to 24', () => {
      const content = {
        ...baseContent,
        styleOptions: { borderRadius: "large" as const },
      };
      const { baseBorderRadius } = helper.testGetStyleConfig(content);
      expect(baseBorderRadius).toBe(24);
    });
  });

  describe("getBackgroundStyle", () => {
    const lightColors = { background: "#ffffff" };
    const darkColors = { background: "#0f172a" };

    it("should return background-image CSS when backgroundImageBase64 provided (light)", () => {
      const result = helper.testGetBackgroundStyle(
        "consulting",
        lightColors,
        false,
        "data:image/png;base64,abc",
      );
      expect(result).toContain("background-image");
      expect(result).toContain("url(data:image/png;base64,abc)");
    });

    it("should use dark overlay when isDarkMode and backgroundImageBase64", () => {
      const result = helper.testGetBackgroundStyle(
        "dark",
        darkColors,
        true,
        "data:image/png;base64,abc",
      );
      expect(result).toContain("rgba(15, 23, 42, 0.92)");
    });

    it("should use light overlay when not isDarkMode and backgroundImageBase64", () => {
      const result = helper.testGetBackgroundStyle(
        "consulting",
        lightColors,
        false,
        "data:image/png;base64,abc",
      );
      expect(result).toContain("rgba(247, 249, 252, 0.92)");
    });

    it('should return genspark gradient when styleKey is "genspark" and no image', () => {
      const result = helper.testGetBackgroundStyle(
        "genspark",
        darkColors,
        true,
      );
      expect(result).toContain("linear-gradient(135deg, #0A2B4E");
    });

    it('should return tech_gradient when styleKey is "tech_gradient" and no image', () => {
      const result = helper.testGetBackgroundStyle(
        "tech_gradient",
        darkColors,
        true,
      );
      expect(result).toContain("linear-gradient(135deg, #0F172A");
    });

    it("should return plain background CSS for normal style with no image", () => {
      const result = helper.testGetBackgroundStyle(
        "consulting",
        { background: "#f8fafc" },
        false,
      );
      expect(result).toBe("background: #f8fafc;");
    });
  });

  describe("calculateScale", () => {
    it("should calculate scale as width/1200", () => {
      const { scale } = helper.testCalculateScale(1200, 800);
      expect(scale).toBeCloseTo(1.0);
    });

    it("should calculate half scale for 600px width", () => {
      const { scale } = helper.testCalculateScale(600, 800);
      expect(scale).toBeCloseTo(0.5);
    });

    it("should set isWideScreen true when aspectRatio >= 1.5", () => {
      const { isWideScreen } = helper.testCalculateScale(1200, 800);
      expect(isWideScreen).toBe(true);
    });

    it("should set isWideScreen false when aspectRatio < 1.5", () => {
      const { isWideScreen } = helper.testCalculateScale(1000, 800);
      expect(isWideScreen).toBe(false);
    });

    it("should set isVertical true when height > width", () => {
      const { isVertical } = helper.testCalculateScale(800, 1200);
      expect(isVertical).toBe(true);
    });

    it("should set isVertical false when width >= height", () => {
      const { isVertical } = helper.testCalculateScale(1200, 800);
      expect(isVertical).toBe(false);
    });

    it("should return correct aspectRatio", () => {
      const { aspectRatio } = helper.testCalculateScale(1200, 800);
      expect(aspectRatio).toBeCloseTo(1.5);
    });
  });

  describe("getConstants", () => {
    it("should return CARD_GRADIENTS", () => {
      const { CARD_GRADIENTS: gradients } = helper.testGetConstants();
      expect(gradients).toBe(CARD_GRADIENTS);
    });

    it("should return an array of 6 gradients", () => {
      const { CARD_GRADIENTS: gradients } = helper.testGetConstants();
      expect(gradients).toHaveLength(6);
    });
  });

  describe("getBrand", () => {
    it("should return name from APP_CONFIG", () => {
      const { name } = helper.testGetBrand();
      expect(name).toBe("TestBrand");
    });

    it("should return fullName from APP_CONFIG", () => {
      const { fullName } = helper.testGetBrand();
      expect(fullName).toBe("TestBrand AI");
    });
  });

  describe("utils", () => {
    it("should expose escapeHtml utility", () => {
      expect(typeof helper.testUtils.escapeHtml).toBe("function");
      expect(helper.testUtils.escapeHtml("<b>")).toBe("&lt;b&gt;");
    });

    it("should expose truncateText utility", () => {
      expect(typeof helper.testUtils.truncateText).toBe("function");
      expect(helper.testUtils.truncateText("hello", 3)).toBe("hello");
    });

    it("should expose adjustColor utility", () => {
      expect(typeof helper.testUtils.adjustColor).toBe("function");
      expect(helper.testUtils.adjustColor("#000000", 0)).toBe("#000000");
    });

    it("should expose getIcon utility", () => {
      expect(typeof helper.testUtils.getIcon).toBe("function");
      expect(helper.testUtils.getIcon()).toBeTruthy();
    });
  });
});

import { Test, TestingModule } from "@nestjs/testing";
import { InfographicDataService } from "../infographic-data.service";

jest.mock("../../../../../../common/config/app.config", () => ({
  APP_CONFIG: { brand: { name: "TestBrand", fullName: "TestBrand AI" } },
}));

describe("InfographicDataService", () => {
  let service: InfographicDataService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [InfographicDataService],
    }).compile();

    service = module.get<InfographicDataService>(InfographicDataService);
  });

  describe("getStylePreset", () => {
    it('should return consulting preset for "consulting"', () => {
      const preset = service.getStylePreset("consulting");
      expect(preset.colors.primary).toBe("#1e3a5f");
    });

    it('should return tech preset for "tech"', () => {
      const preset = service.getStylePreset("tech");
      expect(preset.colors.primary).toBe("#6366f1");
    });

    it('should return minimal preset for "minimal"', () => {
      const preset = service.getStylePreset("minimal");
      expect(preset.colors.background).toBe("#ffffff");
    });

    it('should return creative preset for "creative"', () => {
      const preset = service.getStylePreset("creative");
      expect(preset.borderRadius).toBe(24);
    });

    it('should return dark preset for "dark"', () => {
      const preset = service.getStylePreset("dark");
      expect(preset.colors.background).toBe("#0f172a");
    });

    it('should return academic preset for "academic"', () => {
      const preset = service.getStylePreset("academic");
      expect(preset.colors.primary).toBe("#1e40af");
    });

    it('should return business preset for "business"', () => {
      const preset = service.getStylePreset("business");
      expect(preset.colors.primary).toBe("#374151");
    });

    it('should return genspark preset for "genspark"', () => {
      const preset = service.getStylePreset("genspark");
      expect(preset.colors.accent).toBe("#3B82F6");
    });

    it('should return tech_gradient preset for "tech_gradient"', () => {
      const preset = service.getStylePreset("tech_gradient");
      expect(preset.colors.primary).toBe("#6366F1");
    });

    it("should fallback to consulting for unknown style", () => {
      const preset = service.getStylePreset("unknown" as never);
      expect(preset.colors.primary).toBe("#1e3a5f");
    });
  });

  describe("getFontStyle", () => {
    it('should return sans font string for "sans"', () => {
      const result = service.getFontStyle("sans");
      expect(result).toContain("Noto Sans SC");
    });

    it('should return serif font string for "serif"', () => {
      const result = service.getFontStyle("serif");
      expect(result).toContain("Noto Serif SC");
    });

    it('should return mono font string for "mono"', () => {
      const result = service.getFontStyle("mono");
      expect(result).toContain("JetBrains Mono");
    });

    it('should return rounded font string for "rounded"', () => {
      const result = service.getFontStyle("rounded");
      expect(result).toContain("Nunito");
    });

    it("should fallback to sans for unknown fontStyle", () => {
      const result = service.getFontStyle("unknown" as never);
      expect(result).toContain("Noto Sans SC");
    });
  });

  describe("getIcon", () => {
    it("should return DEFAULT_ICON when called with no argument", () => {
      const defaultResult = service.getIcon();
      expect(defaultResult).toBeTruthy();
      expect(typeof defaultResult).toBe("string");
    });

    it("should return DEFAULT_ICON for unknown type", () => {
      const defaultResult = service.getIcon();
      const unknownResult = service.getIcon("unknown_xyz");
      expect(unknownResult).toBe(defaultResult);
    });

    it('should return SVG string for known type "target"', () => {
      const result = service.getIcon("target");
      expect(result).toContain("<svg");
    });

    it('should return SVG string for known type "chart"', () => {
      const result = service.getIcon("chart");
      expect(result).toContain("<svg");
    });

    it("should normalize uppercase input", () => {
      const lower = service.getIcon("target");
      const upper = service.getIcon("TARGET");
      expect(upper).toBe(lower);
    });

    it("should strip non-alpha characters during normalization", () => {
      const normal = service.getIcon("target");
      const withHyphen = service.getIcon("tar-get");
      expect(withHyphen).toBe(normal);
    });

    it("should return DEFAULT_ICON for undefined", () => {
      const defaultResult = service.getIcon();
      expect(service.getIcon(undefined)).toBe(defaultResult);
    });
  });

  describe("getBrandName", () => {
    it("should return brand name from APP_CONFIG", () => {
      expect(service.getBrandName()).toBe("TestBrand");
    });
  });

  describe("getBrandFullName", () => {
    it("should return brand full name from APP_CONFIG", () => {
      expect(service.getBrandFullName()).toBe("TestBrand AI");
    });
  });

  describe("getCardGradients", () => {
    it("should return an array", () => {
      expect(Array.isArray(service.getCardGradients())).toBe(true);
    });

    it("should return exactly 6 gradients", () => {
      expect(service.getCardGradients()).toHaveLength(6);
    });

    it("should contain CSS gradient strings", () => {
      const gradients = service.getCardGradients();
      gradients.forEach((g) => {
        expect(g).toContain("linear-gradient");
      });
    });
  });

  describe("escapeHtml", () => {
    it("should escape ampersand", () => {
      expect(service.escapeHtml("a & b")).toBe("a &amp; b");
    });

    it("should escape less-than sign", () => {
      expect(service.escapeHtml("<tag>")).toBe("&lt;tag&gt;");
    });

    it("should escape double quotes", () => {
      expect(service.escapeHtml('"text"')).toBe("&quot;text&quot;");
    });

    it("should escape single quotes", () => {
      expect(service.escapeHtml("it's")).toBe("it&#039;s");
    });

    it("should return plain text unchanged", () => {
      expect(service.escapeHtml("plain text")).toBe("plain text");
    });

    it("should return empty string for empty input", () => {
      expect(service.escapeHtml("")).toBe("");
    });
  });

  describe("truncateText", () => {
    it("should return original text regardless of maxLength", () => {
      expect(service.truncateText("hello world", 5)).toBe("hello world");
    });

    it("should return empty string unchanged", () => {
      expect(service.truncateText("", 10)).toBe("");
    });
  });

  describe("adjustColor", () => {
    it("should lighten color by positive amount", () => {
      const result = service.adjustColor("#000000", 100);
      expect(result).toBe("#646464");
    });

    it("should darken color by negative amount", () => {
      const result = service.adjustColor("#ffffff", -100);
      expect(result).toBe("#9b9b9b");
    });

    it("should clamp at 255", () => {
      expect(service.adjustColor("#ffffff", 50)).toBe("#ffffff");
    });

    it("should clamp at 0", () => {
      expect(service.adjustColor("#000000", -50)).toBe("#000000");
    });

    it("should return 6-char hex with # prefix", () => {
      expect(service.adjustColor("#808080", 0)).toMatch(/^#[0-9a-f]{6}$/);
    });
  });
});

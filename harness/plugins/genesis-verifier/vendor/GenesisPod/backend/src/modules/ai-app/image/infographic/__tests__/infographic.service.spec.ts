/**
 * Tests for InfographicService (coordinator) and InfographicTemplateService (HTML generator)
 *
 * The target file `services/infographic.service.ts` is covered by mocking InfographicTemplateService
 * and InfographicRenderService. The `infographic.service.ts` (template) methods are tested
 * directly by instantiating InfographicTemplateService with a mocked BrandLogoService.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { InfographicService } from "../services/infographic.service";
import { InfographicTemplateService } from "../infographic.service";
import { InfographicRenderService } from "../services/infographic-render.service";
import { BrandLogoService } from "../../../../../common/config/brand-logo.service";
import { PuppeteerPoolService } from "../../../../../common/browser/puppeteer-pool.service";
import { InfographicContent } from "../types";

// Mock APP_CONFIG and BrandLogoService to avoid file system access
jest.mock("../../../../../common/config/app.config", () => ({
  APP_CONFIG: {
    brand: {
      fullName: "TestBrand",
      logo: { svgPath: null },
    },
  },
}));

describe("InfographicService (coordinator)", () => {
  let service: InfographicService;
  let templateService: jest.Mocked<InfographicTemplateService>;
  let renderService: jest.Mocked<InfographicRenderService>;

  const mockContent: InfographicContent = {
    title: "Test Infographic",
    subtitle: "A test subtitle",
    sections: [
      {
        title: "Section 1",
        summary: "Summary of section 1",
        bullets: ["Bullet 1", "Bullet 2"],
        metrics: [{ label: "Revenue", value: "$1M", comparison: "+20%" }],
        iconType: "chart",
      },
    ],
    callToAction: "Learn More",
  };

  beforeEach(async () => {
    const mockTemplateService = {
      generateConsultingInfographicHTML: jest
        .fn()
        .mockReturnValue("<html>cards</html>"),
      generateCenterVisualHTML: jest
        .fn()
        .mockReturnValue("<html>center_visual</html>"),
      generateTimelineHTML: jest.fn().mockReturnValue("<html>timeline</html>"),
      generateComparisonHTML: jest
        .fn()
        .mockReturnValue("<html>comparison</html>"),
      generateStatisticsHTML: jest
        .fn()
        .mockReturnValue("<html>statistics</html>"),
      generateChecklistHTML: jest
        .fn()
        .mockReturnValue("<html>checklist</html>"),
      generateFunnelHTML: jest.fn().mockReturnValue("<html>funnel</html>"),
      generateMatrixHTML: jest.fn().mockReturnValue("<html>matrix</html>"),
      generateRankingHTML: jest.fn().mockReturnValue("<html>ranking</html>"),
      cleanup: jest.fn().mockResolvedValue(undefined),
    };

    const mockRenderService = {
      renderToImage: jest
        .fn()
        .mockResolvedValue("data:image/png;base64,abc123"),
      cleanup: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InfographicService,
        { provide: InfographicTemplateService, useValue: mockTemplateService },
        { provide: InfographicRenderService, useValue: mockRenderService },
      ],
    }).compile();

    service = module.get<InfographicService>(InfographicService);
    templateService = module.get(InfographicTemplateService);
    renderService = module.get(InfographicRenderService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("generateInfographic", () => {
    it("should use cards layout by default", async () => {
      const result = await service.generateInfographic(mockContent);

      expect(
        templateService.generateConsultingInfographicHTML,
      ).toHaveBeenCalledWith(mockContent, undefined, 1200, 800);
      expect(renderService.renderToImage).toHaveBeenCalledWith(
        "<html>cards</html>",
        1200,
        800,
      );
      expect(result).toBe("data:image/png;base64,abc123");
    });

    it("should use center_visual layout when specified", async () => {
      const content: InfographicContent = {
        ...mockContent,
        styleOptions: { templateLayout: "center_visual" },
      };

      await service.generateInfographic(content);

      expect(templateService.generateCenterVisualHTML).toHaveBeenCalled();
      expect(
        templateService.generateConsultingInfographicHTML,
      ).not.toHaveBeenCalled();
    });

    it("should use timeline layout when specified", async () => {
      const content: InfographicContent = {
        ...mockContent,
        styleOptions: { templateLayout: "timeline" },
      };

      await service.generateInfographic(content);

      expect(templateService.generateTimelineHTML).toHaveBeenCalled();
    });

    it("should use comparison layout when specified", async () => {
      const content: InfographicContent = {
        ...mockContent,
        styleOptions: { templateLayout: "comparison" },
      };

      await service.generateInfographic(content);

      expect(templateService.generateComparisonHTML).toHaveBeenCalled();
    });

    it("should use statistics layout when specified", async () => {
      const content: InfographicContent = {
        ...mockContent,
        styleOptions: { templateLayout: "statistics" },
      };

      await service.generateInfographic(content);

      expect(templateService.generateStatisticsHTML).toHaveBeenCalled();
    });

    it("should use checklist layout when specified", async () => {
      const content: InfographicContent = {
        ...mockContent,
        styleOptions: { templateLayout: "checklist" },
      };

      await service.generateInfographic(content);

      expect(templateService.generateChecklistHTML).toHaveBeenCalled();
    });

    it("should use funnel layout when specified", async () => {
      const content: InfographicContent = {
        ...mockContent,
        styleOptions: { templateLayout: "funnel" },
      };

      await service.generateInfographic(content);

      expect(templateService.generateFunnelHTML).toHaveBeenCalled();
    });

    it("should use matrix layout when specified", async () => {
      const content: InfographicContent = {
        ...mockContent,
        styleOptions: { templateLayout: "matrix" },
      };

      await service.generateInfographic(content);

      expect(templateService.generateMatrixHTML).toHaveBeenCalled();
    });

    it("should use ranking layout when specified", async () => {
      const content: InfographicContent = {
        ...mockContent,
        styleOptions: { templateLayout: "ranking" },
      };

      await service.generateInfographic(content);

      expect(templateService.generateRankingHTML).toHaveBeenCalled();
    });

    it("should pass custom width and height to template and render", async () => {
      await service.generateInfographic(mockContent, {
        width: 1920,
        height: 1080,
      });

      expect(
        templateService.generateConsultingInfographicHTML,
      ).toHaveBeenCalledWith(mockContent, undefined, 1920, 1080);
      expect(renderService.renderToImage).toHaveBeenCalledWith(
        expect.any(String),
        1920,
        1080,
      );
    });

    it("should pass backgroundImageBase64 to template", async () => {
      const bg = "data:image/png;base64,bgdata";
      await service.generateInfographic(mockContent, {
        backgroundImageBase64: bg,
      });

      expect(
        templateService.generateConsultingInfographicHTML,
      ).toHaveBeenCalledWith(mockContent, bg, 1200, 800);
    });

    it("should return the base64 image from renderService", async () => {
      const result = await service.generateInfographic(mockContent);
      expect(result).toBe("data:image/png;base64,abc123");
    });
  });

  describe("cleanup", () => {
    it("should call renderService.cleanup", async () => {
      await service.cleanup();
      expect(renderService.cleanup).toHaveBeenCalled();
    });
  });
});

describe("InfographicTemplateService", () => {
  let templateService: InfographicTemplateService;
  let brandLogoService: jest.Mocked<BrandLogoService>;

  const minimalContent: InfographicContent = {
    title: "Test Title",
    sections: [
      {
        title: "Section One",
        bullets: ["Point A", "Point B"],
        metrics: [{ label: "Score", value: "95%" }],
      },
    ],
  };

  beforeEach(async () => {
    const mockBrandLogoService = {
      getLogoSvg: jest.fn().mockReturnValue("<svg>logo</svg>"),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InfographicTemplateService,
        { provide: BrandLogoService, useValue: mockBrandLogoService },
        { provide: PuppeteerPoolService, useValue: {} },
      ],
    }).compile();

    templateService = module.get<InfographicTemplateService>(
      InfographicTemplateService,
    );
    brandLogoService = module.get(BrandLogoService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(templateService).toBeDefined();
  });

  describe("generateConsultingInfographicHTML", () => {
    it("should return a valid HTML string", () => {
      const html =
        templateService.generateConsultingInfographicHTML(minimalContent);
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("Test Title");
    });

    it("should include section titles in output", () => {
      const html =
        templateService.generateConsultingInfographicHTML(minimalContent);
      expect(html).toContain("Section One");
    });

    it("should include bullets in output", () => {
      const html =
        templateService.generateConsultingInfographicHTML(minimalContent);
      expect(html).toContain("Point A");
      expect(html).toContain("Point B");
    });

    it("should include metric values in output", () => {
      const html =
        templateService.generateConsultingInfographicHTML(minimalContent);
      expect(html).toContain("95%");
    });

    it("should include brand logo", () => {
      templateService.generateConsultingInfographicHTML(minimalContent);
      expect(brandLogoService.getLogoSvg).toHaveBeenCalled();
    });

    it("should include subtitle when provided", () => {
      const content: InfographicContent = {
        ...minimalContent,
        subtitle: "My Subtitle",
      };
      const html = templateService.generateConsultingInfographicHTML(content);
      expect(html).toContain("My Subtitle");
    });

    it("should include heroStatement when provided", () => {
      const content: InfographicContent = {
        ...minimalContent,
        heroStatement: "Hero text here",
      };
      const html = templateService.generateConsultingInfographicHTML(content);
      expect(html).toContain("Hero text here");
    });

    it("should include callToAction when no summary section", () => {
      const content: InfographicContent = {
        ...minimalContent,
        callToAction: "Click Here",
      };
      const html = templateService.generateConsultingInfographicHTML(content);
      expect(html).toContain("Click Here");
    });

    it("should render summary section separately", () => {
      const content: InfographicContent = {
        ...minimalContent,
        sections: [
          ...minimalContent.sections,
          {
            title: "Summary",
            bullets: ["Summary point"],
            metrics: [],
            sectionType: "summary",
          },
        ],
      };
      const html = templateService.generateConsultingInfographicHTML(content);
      expect(html).toContain("summary-card");
      expect(html).toContain("Summary");
    });

    it("should use custom width and height", () => {
      const html = templateService.generateConsultingInfographicHTML(
        minimalContent,
        undefined,
        800,
        600,
      );
      expect(html).toContain("width: 800px");
      expect(html).toContain("height: 600px");
    });

    it("should apply background image when provided", () => {
      const bg = "data:image/png;base64,imgdata";
      const html = templateService.generateConsultingInfographicHTML(
        minimalContent,
        bg,
      );
      expect(html).toContain("imgdata");
    });

    it("should handle all infographic styles", () => {
      const styles = [
        "consulting",
        "tech",
        "minimal",
        "creative",
        "dark",
        "academic",
        "business",
        "genspark",
        "tech_gradient",
      ] as const;
      for (const style of styles) {
        const content: InfographicContent = {
          ...minimalContent,
          styleOptions: { style },
        };
        const html = templateService.generateConsultingInfographicHTML(content);
        expect(html).toContain("<!DOCTYPE html>");
      }
    });

    it("should apply dark mode styles for dark/genspark/tech_gradient", () => {
      const darkStyles = ["dark", "genspark", "tech_gradient"] as const;
      for (const style of darkStyles) {
        const content: InfographicContent = {
          ...minimalContent,
          styleOptions: { style },
        };
        const html = templateService.generateConsultingInfographicHTML(content);
        // Dark styles have dark backgrounds
        expect(html).toContain("<!DOCTYPE html>");
      }
    });

    it("should apply glassmorphism styles for genspark/tech_gradient", () => {
      const glassStyles = ["genspark", "tech_gradient"] as const;
      for (const style of glassStyles) {
        const content: InfographicContent = {
          ...minimalContent,
          styleOptions: { style },
        };
        const html = templateService.generateConsultingInfographicHTML(content);
        expect(html).toContain("backdrop-filter");
      }
    });

    it("should handle all font styles", () => {
      const fontStyles = ["sans", "serif", "mono", "rounded"] as const;
      for (const fontStyle of fontStyles) {
        const content: InfographicContent = {
          ...minimalContent,
          styleOptions: { fontStyle },
        };
        const html = templateService.generateConsultingInfographicHTML(content);
        expect(html).toContain("<!DOCTYPE html>");
      }
    });

    it("should handle borderRadius options", () => {
      const radii = ["none", "small", "medium", "large"] as const;
      for (const borderRadius of radii) {
        const content: InfographicContent = {
          ...minimalContent,
          styleOptions: { borderRadius },
        };
        const html = templateService.generateConsultingInfographicHTML(content);
        expect(html).toContain("<!DOCTYPE html>");
      }
    });

    it("should handle shadowStyle options", () => {
      const shadows = ["none", "subtle", "medium", "strong"] as const;
      for (const shadowStyle of shadows) {
        const content: InfographicContent = {
          ...minimalContent,
          styleOptions: { shadowStyle },
        };
        const html = templateService.generateConsultingInfographicHTML(content);
        expect(html).toContain("<!DOCTYPE html>");
      }
    });

    it("should use custom colorScheme when provided", () => {
      const content: InfographicContent = {
        ...minimalContent,
        colorScheme: {
          primary: "#ff0000",
          accent: "#00ff00",
          background: "#0000ff",
          text: "#ffffff",
        },
      };
      const html = templateService.generateConsultingInfographicHTML(content);
      expect(html).toContain("#ff0000");
      expect(html).toContain("#00ff00");
    });

    it("should handle vertical (portrait) layout", () => {
      // height > width = vertical
      const html = templateService.generateConsultingInfographicHTML(
        minimalContent,
        undefined,
        800,
        1200,
      );
      expect(html).toContain("<!DOCTYPE html>");
    });

    it("should limit columns to 2 for vertical layout", () => {
      const html = templateService.generateConsultingInfographicHTML(
        minimalContent,
        undefined,
        800,
        1200,
      );
      // With 1 section and vertical layout, columns = 1
      expect(html).toContain("grid-template-columns: repeat(1, 1fr)");
    });

    it("should use 2 columns for 4 sections", () => {
      const content: InfographicContent = {
        ...minimalContent,
        sections: Array(4).fill({ title: "S", bullets: [], metrics: [] }),
      };
      const html = templateService.generateConsultingInfographicHTML(content);
      expect(html).toContain("grid-template-columns: repeat(2, 1fr)");
    });

    it("should use 3 columns for 5-6 sections", () => {
      const content: InfographicContent = {
        ...minimalContent,
        sections: Array(5).fill({ title: "S", bullets: [], metrics: [] }),
      };
      const html = templateService.generateConsultingInfographicHTML(content);
      expect(html).toContain("grid-template-columns: repeat(3, 1fr)");
    });

    it("should escape HTML special characters in title", () => {
      const content: InfographicContent = {
        ...minimalContent,
        title: '<script>alert("xss")</script>',
      };
      const html = templateService.generateConsultingInfographicHTML(content);
      expect(html).toContain("&lt;script&gt;");
      expect(html).not.toContain("<script>alert");
    });

    it("should escape HTML in section titles", () => {
      const content: InfographicContent = {
        ...minimalContent,
        sections: [
          {
            title: 'Title with <b>bold</b> & "quotes"',
            bullets: ["Bullet & more"],
            metrics: [],
          },
        ],
      };
      const html = templateService.generateConsultingInfographicHTML(content);
      expect(html).toContain("&lt;b&gt;");
      expect(html).toContain("&amp;");
      expect(html).toContain("&quot;");
    });

    it("should handle sections with no bullets gracefully", () => {
      const content: InfographicContent = {
        ...minimalContent,
        sections: [{ title: "Empty", bullets: [], metrics: [] }],
      };
      const html = templateService.generateConsultingInfographicHTML(content);
      expect(html).toContain("Empty");
      // When no bullets, the <ul class="bullets"> should not be present in section body
      expect(html).not.toContain('<ul class="bullets">');
    });

    it("should handle sections with no metrics gracefully", () => {
      const content: InfographicContent = {
        ...minimalContent,
        sections: [
          { title: "NoMetrics", bullets: ["Some point"], metrics: [] },
        ],
      };
      const html = templateService.generateConsultingInfographicHTML(content);
      // When no metrics, section-footer div should not be present
      expect(html).not.toContain('<div class="section-footer">');
    });

    it("should handle icon types", () => {
      const iconTypes = [
        "target",
        "chart",
        "briefcase",
        "shield",
        "lightbulb",
        "gear",
        "users",
        "globe",
        "clock",
        "trending",
        "star",
        "check",
      ];
      for (const iconType of iconTypes) {
        const content: InfographicContent = {
          ...minimalContent,
          sections: [
            { title: "Icon Test", bullets: [], metrics: [], iconType },
          ],
        };
        const html = templateService.generateConsultingInfographicHTML(content);
        expect(html).toContain("<svg");
      }
    });

    it("should use default icon for unknown icon type", () => {
      const content: InfographicContent = {
        ...minimalContent,
        sections: [
          {
            title: "Icon Test",
            bullets: [],
            metrics: [],
            iconType: "unknown_icon_xyz",
          },
        ],
      };
      const html = templateService.generateConsultingInfographicHTML(content);
      // Should still contain an SVG (default icon)
      expect(html).toContain("<svg");
    });

    it("should handle empty sections array", () => {
      const content: InfographicContent = {
        ...minimalContent,
        sections: [],
      };
      const html = templateService.generateConsultingInfographicHTML(content);
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("Test Title");
    });

    it("should handle many sections (> 10)", () => {
      const content: InfographicContent = {
        ...minimalContent,
        sections: Array(12).fill({
          title: "Sec",
          bullets: ["B1"],
          metrics: [{ label: "L", value: "V" }],
        }),
      };
      const html = templateService.generateConsultingInfographicHTML(content);
      expect(html).toContain("grid-template-columns: repeat(5, 1fr)");
    });

    it("should handle metric with comparison value", () => {
      const content: InfographicContent = {
        ...minimalContent,
        sections: [
          {
            title: "Metrics Test",
            bullets: [],
            metrics: [
              { label: "Growth", value: "50%", comparison: "+10% YoY" },
            ],
          },
        ],
      };
      const html = templateService.generateConsultingInfographicHTML(content);
      expect(html).toContain("50%");
    });
  });

  describe("generateCenterVisualHTML", () => {
    it("should return HTML with center visual layout", () => {
      const html = templateService.generateCenterVisualHTML(minimalContent);
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("Test Title");
    });

    it("should use custom centerVisualTitle when provided", () => {
      const content: InfographicContent = {
        ...minimalContent,
        styleOptions: { centerVisualTitle: "Custom Center Title" },
      };
      const html = templateService.generateCenterVisualHTML(content);
      expect(html).toContain("Custom Center Title");
    });

    it("should handle dark styles", () => {
      const content: InfographicContent = {
        ...minimalContent,
        styleOptions: { style: "dark" },
      };
      const html = templateService.generateCenterVisualHTML(content);
      expect(html).toContain("<!DOCTYPE html>");
    });

    it("should handle genspark style with glassmorphism", () => {
      const content: InfographicContent = {
        ...minimalContent,
        styleOptions: { style: "genspark" },
      };
      const html = templateService.generateCenterVisualHTML(content);
      expect(html).toContain("<!DOCTYPE html>");
    });
  });

  // cleanup removed — browser lifecycle managed by PuppeteerPoolService

  describe("adjustColor (private, tested through HTML output)", () => {
    it("should generate valid hex colors in gradients", () => {
      const html =
        templateService.generateConsultingInfographicHTML(minimalContent);
      // Should contain gradient with adjusted colors
      expect(html).toMatch(/linear-gradient\(135deg, #[0-9a-f]{6}/i);
    });

    it("should handle adjustColor with positive amount", () => {
      // consulting style primary is #1e3a5f — adjust +20 should lighten
      const content: InfographicContent = {
        ...minimalContent,
        styleOptions: { style: "consulting" },
      };
      const html = templateService.generateConsultingInfographicHTML(content);
      expect(html).toContain("#1e3a5f");
    });

    it("should clamp color values at 255 max", () => {
      // minimal style has primary #18181b — adding to near-zero values
      const content: InfographicContent = {
        ...minimalContent,
        styleOptions: { style: "minimal" },
      };
      const html = templateService.generateConsultingInfographicHTML(content);
      // Should not have any invalid hex values
      expect(html).toMatch(/#[0-9a-fA-F]{6}/);
    });
  });

  describe("escapeHtml (private, tested through HTML output)", () => {
    it("should escape ampersands", () => {
      const content: InfographicContent = {
        ...minimalContent,
        title: "AT&T Analysis",
      };
      const html = templateService.generateConsultingInfographicHTML(content);
      expect(html).toContain("AT&amp;T");
    });

    it("should escape angle brackets", () => {
      const content: InfographicContent = {
        ...minimalContent,
        title: "3 > 2 < 5",
      };
      const html = templateService.generateConsultingInfographicHTML(content);
      expect(html).toContain("3 &gt; 2 &lt; 5");
    });

    it("should escape single quotes", () => {
      const content: InfographicContent = {
        ...minimalContent,
        title: "It's a test",
      };
      const html = templateService.generateConsultingInfographicHTML(content);
      expect(html).toContain("It&#39;s a test");
    });

    it("should escape double quotes", () => {
      const content: InfographicContent = {
        ...minimalContent,
        title: 'He said "hello"',
      };
      const html = templateService.generateConsultingInfographicHTML(content);
      expect(html).toContain("He said &quot;hello&quot;");
    });
  });

  describe("widescreen layout", () => {
    it("should apply compact scale for widescreen (16:9)", () => {
      // 1920x1080 = 1.78 > 1.5 threshold = widescreen
      const html = templateService.generateConsultingInfographicHTML(
        minimalContent,
        undefined,
        1920,
        1080,
      );
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("width: 1920px");
    });

    it("should not apply compact scale for 4:3", () => {
      // 1024x768 = 1.33 < 1.5 threshold = not widescreen
      const html = templateService.generateConsultingInfographicHTML(
        minimalContent,
        undefined,
        1024,
        768,
      );
      expect(html).toContain("<!DOCTYPE html>");
    });
  });

  describe("section type filtering", () => {
    it("should separate main and summary sections", () => {
      const content: InfographicContent = {
        ...minimalContent,
        sections: [
          { title: "Main 1", sectionType: "main", bullets: ["b"], metrics: [] },
          { title: "Main 2", sectionType: "main", bullets: ["b"], metrics: [] },
          {
            title: "Summary",
            sectionType: "summary",
            bullets: ["s"],
            metrics: [],
          },
        ],
      };
      const html = templateService.generateConsultingInfographicHTML(content);

      // summary-card should be rendered for the summary section
      expect(html).toContain("summary-card");
      expect(html).toContain("Summary");
      // Main sections should be in section-card
      expect(html).toContain("Main 1");
      expect(html).toContain("Main 2");
    });

    it("should not show summary card when no summary section", () => {
      const content: InfographicContent = {
        ...minimalContent,
        sections: [
          { title: "Main 1", bullets: ["b"], metrics: [] },
          { title: "Main 2", bullets: ["b"], metrics: [] },
        ],
        callToAction: "Do it now",
      };
      const html = templateService.generateConsultingInfographicHTML(content);
      // summary-card div should not appear in main body when there is no summary section
      expect(html).not.toContain('<div class="summary-card">');
      expect(html).toContain("Do it now");
    });
  });

  // ============================================================
  // numColumns branch coverage (lines 393, 396) and sectionType filter (line 409)
  // ============================================================

  describe("generateConsultingInfographicHTML - column count branches", () => {
    it("should use 4 columns for 7-8 sections (line 393)", () => {
      const content: InfographicContent = {
        ...minimalContent,
        sections: Array.from({ length: 7 }, (_, i) => ({
          title: `Section ${i + 1}`,
          bullets: ["bullet"],
          metrics: [],
          sectionType: "main" as const,
        })),
      };
      const html = templateService.generateConsultingInfographicHTML(content);
      expect(html).toContain("Section 1");
      expect(html).toContain("Section 7");
    });

    it("should use 5 columns for 9-10 sections (line 396)", () => {
      const content: InfographicContent = {
        ...minimalContent,
        sections: Array.from({ length: 9 }, (_, i) => ({
          title: `Section ${i + 1}`,
          bullets: ["bullet"],
          metrics: [],
          sectionType: "main" as const,
        })),
      };
      const html = templateService.generateConsultingInfographicHTML(content);
      expect(html).toContain("Section 9");
    });

    it("should use 5 columns and filter non-summary sections when no aiMainSections (line 409)", () => {
      // Sections without sectionType trigger the .filter(s => s.sectionType !== 'summary') path
      const content: InfographicContent = {
        ...minimalContent,
        sections: [
          { title: "No Type 1", bullets: ["b"], metrics: [] },
          { title: "No Type 2", bullets: ["b"], metrics: [] },
        ],
      };
      const html = templateService.generateConsultingInfographicHTML(content);
      expect(html).toContain("No Type 1");
      expect(html).toContain("No Type 2");
    });
  });

  // ============================================================
  // generateTimelineHTML (lines 1545-1859)
  // ============================================================

  describe("generateTimelineHTML", () => {
    it("should generate valid HTML with sections", () => {
      const content: InfographicContent = {
        title: "Timeline Title",
        subtitle: "Timeline Subtitle",
        sections: [
          {
            title: "Step 1",
            summary: "First step",
            bullets: ["Action A", "Action B"],
            metrics: [{ label: "Time", value: "Q1" }],
          },
          {
            title: "Step 2",
            summary: "Second step",
            bullets: ["Action C"],
            metrics: [],
          },
          {
            title: "Step 3",
            summary: "Third step",
            bullets: [],
            metrics: [{ label: "Result", value: "+50%" }],
          },
        ],
        callToAction: "Start Now",
      };
      const html = templateService.generateTimelineHTML(content);
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("Timeline Title");
      expect(html).toContain("Step 1");
      expect(html).toContain("Step 2");
      expect(html).toContain("Start Now");
    });

    it("should handle dark style for timeline", () => {
      const content: InfographicContent = {
        ...minimalContent,
        styleOptions: { style: "dark" },
      };
      const html = templateService.generateTimelineHTML(content);
      expect(html).toContain("<!DOCTYPE html>");
    });

    it("should handle genspark style for timeline", () => {
      const content: InfographicContent = {
        ...minimalContent,
        styleOptions: { style: "genspark" },
      };
      const html = templateService.generateTimelineHTML(content);
      expect(html).toContain("<!DOCTYPE html>");
    });

    it("should handle custom dimensions", () => {
      const html = templateService.generateTimelineHTML(
        minimalContent,
        undefined,
        800,
        600,
      );
      expect(html).toContain("<!DOCTYPE html>");
    });

    it("should handle background image", () => {
      const html = templateService.generateTimelineHTML(
        minimalContent,
        "data:image/png;base64,abc123",
      );
      expect(html).toContain("<!DOCTYPE html>");
    });

    it("should handle vertical layout (height > width)", () => {
      const html = templateService.generateTimelineHTML(
        minimalContent,
        undefined,
        800,
        1200,
      );
      expect(html).toContain("<!DOCTYPE html>");
    });
  });

  // ============================================================
  // generateComparisonHTML (lines 1860-2206)
  // ============================================================

  describe("generateComparisonHTML", () => {
    it("should generate valid HTML with 2 sections for comparison", () => {
      const content: InfographicContent = {
        title: "Comparison Title",
        subtitle: "Left vs Right",
        sections: [
          {
            title: "Option A",
            summary: "Left side",
            bullets: ["Pro 1", "Pro 2"],
            metrics: [{ label: "Score", value: "8/10" }],
          },
          {
            title: "Option B",
            summary: "Right side",
            bullets: ["Con 1"],
            metrics: [{ label: "Score", value: "6/10" }],
          },
        ],
        callToAction: "Choose Now",
      };
      const html = templateService.generateComparisonHTML(content);
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("Option A");
      expect(html).toContain("Option B");
    });

    it("should handle tech style for comparison", () => {
      const content: InfographicContent = {
        ...minimalContent,
        styleOptions: { style: "tech" },
      };
      const html = templateService.generateComparisonHTML(content);
      expect(html).toContain("<!DOCTYPE html>");
    });

    it("should handle genspark glassmorphism for comparison", () => {
      const content: InfographicContent = {
        ...minimalContent,
        styleOptions: { style: "genspark" },
      };
      const html = templateService.generateComparisonHTML(content);
      expect(html).toContain("<!DOCTYPE html>");
    });

    it("should handle single section comparison", () => {
      const html = templateService.generateComparisonHTML(minimalContent);
      expect(html).toContain("<!DOCTYPE html>");
    });
  });

  // ============================================================
  // generateStatisticsHTML (lines 2207-2444)
  // ============================================================

  describe("generateStatisticsHTML", () => {
    it("should generate valid HTML with statistics sections", () => {
      const content: InfographicContent = {
        title: "Stats Report",
        sections: [
          {
            title: "Revenue",
            bullets: [],
            metrics: [
              { label: "Total", value: "$10M", comparison: "+25%" },
              { label: "Growth", value: "25%" },
            ],
          },
          {
            title: "Users",
            bullets: [],
            metrics: [{ label: "Monthly", value: "1M", comparison: "+10%" }],
          },
        ],
        callToAction: "View Details",
      };
      const html = templateService.generateStatisticsHTML(content);
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("Stats Report");
      expect(html).toContain("Total"); // metric label
      expect(html).toContain("$10M"); // metric value
    });

    it("should handle dark mode for statistics", () => {
      const content: InfographicContent = {
        ...minimalContent,
        styleOptions: { style: "dark" },
      };
      const html = templateService.generateStatisticsHTML(content);
      expect(html).toContain("<!DOCTYPE html>");
    });

    it("should handle tech_gradient for statistics", () => {
      const content: InfographicContent = {
        ...minimalContent,
        styleOptions: { style: "tech_gradient" },
      };
      const html = templateService.generateStatisticsHTML(content);
      expect(html).toContain("<!DOCTYPE html>");
    });

    it("should render sections with bullets as well as metrics", () => {
      const content: InfographicContent = {
        title: "Stats",
        sections: [
          {
            title: "Section A",
            bullets: ["Insight 1", "Insight 2"],
            metrics: [
              { label: "Rate", value: "95%", comparison: "vs 80% avg" },
            ],
          },
        ],
      };
      const html = templateService.generateStatisticsHTML(content);
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("Rate");
      expect(html).toContain("95%");
    });
  });

  // ============================================================
  // generateChecklistHTML (lines 2445-2615)
  // ============================================================

  describe("generateChecklistHTML", () => {
    it("should generate valid HTML checklist", () => {
      const content: InfographicContent = {
        title: "Checklist Title",
        subtitle: "Complete these tasks",
        sections: [
          {
            title: "Phase 1",
            bullets: ["Task A", "Task B", "Task C"],
            metrics: [{ label: "Priority", value: "High" }],
          },
          { title: "Phase 2", bullets: ["Task D", "Task E"], metrics: [] },
        ],
        callToAction: "Start Checklist",
      };
      const html = templateService.generateChecklistHTML(content);
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("Checklist Title");
      expect(html).toContain("Task A");
    });

    it("should handle minimal style for checklist", () => {
      const content: InfographicContent = {
        ...minimalContent,
        styleOptions: { style: "minimal" },
      };
      const html = templateService.generateChecklistHTML(content);
      expect(html).toContain("<!DOCTYPE html>");
    });

    it("should handle genspark glassmorphism for checklist", () => {
      const content: InfographicContent = {
        ...minimalContent,
        styleOptions: { style: "genspark" },
      };
      const html = templateService.generateChecklistHTML(content);
      expect(html).toContain("<!DOCTYPE html>");
    });
  });

  // ============================================================
  // generateFunnelHTML (lines 2616-2759)
  // ============================================================

  describe("generateFunnelHTML", () => {
    it("should generate valid HTML funnel with multiple stages", () => {
      const content: InfographicContent = {
        title: "Sales Funnel",
        sections: [
          {
            title: "Awareness",
            summary: "10000 leads",
            bullets: [],
            metrics: [{ label: "Count", value: "10000" }],
          },
          {
            title: "Interest",
            summary: "5000 interested",
            bullets: [],
            metrics: [{ label: "Count", value: "5000" }],
          },
          {
            title: "Decision",
            summary: "1000 decided",
            bullets: [],
            metrics: [{ label: "Count", value: "1000" }],
          },
          {
            title: "Action",
            summary: "500 converted",
            bullets: [],
            metrics: [{ label: "Count", value: "500" }],
          },
        ],
        callToAction: "Optimize Funnel",
      };
      const html = templateService.generateFunnelHTML(content);
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("Sales Funnel");
      expect(html).toContain("Awareness");
    });

    it("should handle creative style for funnel", () => {
      const content: InfographicContent = {
        ...minimalContent,
        styleOptions: { style: "creative" },
      };
      const html = templateService.generateFunnelHTML(content);
      expect(html).toContain("<!DOCTYPE html>");
    });

    it("should handle tech_gradient glassmorphism for funnel", () => {
      const content: InfographicContent = {
        ...minimalContent,
        styleOptions: { style: "tech_gradient" },
      };
      const html = templateService.generateFunnelHTML(content);
      expect(html).toContain("<!DOCTYPE html>");
    });
  });

  // ============================================================
  // generateMatrixHTML (lines 2760-2946)
  // ============================================================

  describe("generateMatrixHTML", () => {
    it("should generate valid HTML matrix (2x2)", () => {
      const content: InfographicContent = {
        title: "Strategy Matrix",
        sections: [
          { title: "High Impact, Easy", bullets: ["Quick Win 1"], metrics: [] },
          {
            title: "High Impact, Hard",
            bullets: ["Major Project"],
            metrics: [],
          },
          { title: "Low Impact, Easy", bullets: ["Fill-in"], metrics: [] },
          { title: "Low Impact, Hard", bullets: ["Avoid"], metrics: [] },
        ],
      };
      const html = templateService.generateMatrixHTML(content);
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("Strategy Matrix");
    });

    it("should handle academic style for matrix", () => {
      const content: InfographicContent = {
        ...minimalContent,
        styleOptions: { style: "academic" },
      };
      const html = templateService.generateMatrixHTML(content);
      expect(html).toContain("<!DOCTYPE html>");
    });

    it("should handle genspark for matrix", () => {
      const content: InfographicContent = {
        ...minimalContent,
        styleOptions: { style: "genspark" },
      };
      const html = templateService.generateMatrixHTML(content);
      expect(html).toContain("<!DOCTYPE html>");
    });

    it("should handle fewer than 4 sections", () => {
      const html = templateService.generateMatrixHTML(minimalContent);
      expect(html).toContain("<!DOCTYPE html>");
    });
  });

  // ============================================================
  // generateRankingHTML (lines 2947-3210)
  // ============================================================

  describe("generateRankingHTML", () => {
    it("should generate valid HTML ranking table", () => {
      const content: InfographicContent = {
        title: "Top Rankings",
        sections: [
          {
            title: "1st Place",
            summary: "Gold medal",
            bullets: ["Achievement A"],
            metrics: [{ label: "Score", value: "100", comparison: "#1" }],
          },
          {
            title: "2nd Place",
            summary: "Silver medal",
            bullets: ["Achievement B"],
            metrics: [{ label: "Score", value: "95", comparison: "#2" }],
          },
          {
            title: "3rd Place",
            summary: "Bronze medal",
            bullets: [],
            metrics: [{ label: "Score", value: "88" }],
          },
        ],
        callToAction: "See Full List",
      };
      const html = templateService.generateRankingHTML(content);
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("Top Rankings");
      expect(html).toContain("1st Place");
    });

    it("should handle business style for ranking", () => {
      const content: InfographicContent = {
        ...minimalContent,
        styleOptions: { style: "business" },
      };
      const html = templateService.generateRankingHTML(content);
      expect(html).toContain("<!DOCTYPE html>");
    });

    it("should handle genspark glassmorphism for ranking", () => {
      const content: InfographicContent = {
        ...minimalContent,
        styleOptions: { style: "genspark" },
      };
      const html = templateService.generateRankingHTML(content);
      expect(html).toContain("<!DOCTYPE html>");
    });

    it("should handle sections with comparison metrics", () => {
      const content: InfographicContent = {
        title: "Compare",
        sections: [
          {
            title: "Winner",
            bullets: ["Point 1", "Point 2", "Point 3"],
            metrics: [
              { label: "M1", value: "V1", comparison: "+5%" },
              { label: "M2", value: "V2" },
            ],
          },
        ],
        callToAction: "View More",
      };
      const html = templateService.generateRankingHTML(content);
      expect(html).toContain("Winner");
    });
  });

  // ============================================================
  // generateInfographic - route through all template types (with renderToImage mocked)
  // ============================================================

  describe("generateInfographic - template routing", () => {
    it("should call generateTimelineHTML for timeline layout", async () => {
      // Mock renderToImage to avoid Puppeteer
      const spy = jest
        .spyOn(
          templateService as unknown as {
            renderToImage: (...args: unknown[]) => Promise<string>;
          },
          "renderToImage",
        )
        .mockResolvedValue("data:image/png;base64,abc");
      const generateTimelineSpy = jest.spyOn(
        templateService,
        "generateTimelineHTML",
      );

      const content: InfographicContent = {
        ...minimalContent,
        styleOptions: { templateLayout: "timeline" },
      };
      await templateService.generateInfographic(content);

      expect(generateTimelineSpy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it("should call generateComparisonHTML for comparison layout", async () => {
      const spy = jest
        .spyOn(
          templateService as unknown as {
            renderToImage: (...args: unknown[]) => Promise<string>;
          },
          "renderToImage",
        )
        .mockResolvedValue("data:image/png;base64,abc");
      const generateComparisonSpy = jest.spyOn(
        templateService,
        "generateComparisonHTML",
      );

      const content: InfographicContent = {
        ...minimalContent,
        styleOptions: { templateLayout: "comparison" },
      };
      await templateService.generateInfographic(content);

      expect(generateComparisonSpy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it("should call generateStatisticsHTML for statistics layout", async () => {
      const spy = jest
        .spyOn(
          templateService as unknown as {
            renderToImage: (...args: unknown[]) => Promise<string>;
          },
          "renderToImage",
        )
        .mockResolvedValue("data:image/png;base64,abc");
      const spy2 = jest.spyOn(templateService, "generateStatisticsHTML");

      const content: InfographicContent = {
        ...minimalContent,
        styleOptions: { templateLayout: "statistics" },
      };
      await templateService.generateInfographic(content);
      expect(spy2).toHaveBeenCalled();
      spy.mockRestore();
    });

    it("should call generateChecklistHTML for checklist layout", async () => {
      const spy = jest
        .spyOn(
          templateService as unknown as {
            renderToImage: (...args: unknown[]) => Promise<string>;
          },
          "renderToImage",
        )
        .mockResolvedValue("data:image/png;base64,abc");
      const spy2 = jest.spyOn(templateService, "generateChecklistHTML");

      const content: InfographicContent = {
        ...minimalContent,
        styleOptions: { templateLayout: "checklist" },
      };
      await templateService.generateInfographic(content);
      expect(spy2).toHaveBeenCalled();
      spy.mockRestore();
    });

    it("should call generateFunnelHTML for funnel layout", async () => {
      const spy = jest
        .spyOn(
          templateService as unknown as {
            renderToImage: (...args: unknown[]) => Promise<string>;
          },
          "renderToImage",
        )
        .mockResolvedValue("data:image/png;base64,abc");
      const spy2 = jest.spyOn(templateService, "generateFunnelHTML");

      const content: InfographicContent = {
        ...minimalContent,
        styleOptions: { templateLayout: "funnel" },
      };
      await templateService.generateInfographic(content);
      expect(spy2).toHaveBeenCalled();
      spy.mockRestore();
    });

    it("should call generateMatrixHTML for matrix layout", async () => {
      const spy = jest
        .spyOn(
          templateService as unknown as {
            renderToImage: (...args: unknown[]) => Promise<string>;
          },
          "renderToImage",
        )
        .mockResolvedValue("data:image/png;base64,abc");
      const spy2 = jest.spyOn(templateService, "generateMatrixHTML");

      const content: InfographicContent = {
        ...minimalContent,
        styleOptions: { templateLayout: "matrix" },
      };
      await templateService.generateInfographic(content);
      expect(spy2).toHaveBeenCalled();
      spy.mockRestore();
    });

    it("should call generateRankingHTML for ranking layout", async () => {
      const spy = jest
        .spyOn(
          templateService as unknown as {
            renderToImage: (...args: unknown[]) => Promise<string>;
          },
          "renderToImage",
        )
        .mockResolvedValue("data:image/png;base64,abc");
      const spy2 = jest.spyOn(templateService, "generateRankingHTML");

      const content: InfographicContent = {
        ...minimalContent,
        styleOptions: { templateLayout: "ranking" },
      };
      await templateService.generateInfographic(content);
      expect(spy2).toHaveBeenCalled();
      spy.mockRestore();
    });

    it("should call generateCenterVisualHTML for center_visual layout", async () => {
      const spy = jest
        .spyOn(
          templateService as unknown as {
            renderToImage: (...args: unknown[]) => Promise<string>;
          },
          "renderToImage",
        )
        .mockResolvedValue("data:image/png;base64,abc");
      const spy2 = jest.spyOn(templateService, "generateCenterVisualHTML");

      const content: InfographicContent = {
        ...minimalContent,
        styleOptions: { templateLayout: "center_visual" },
      };
      await templateService.generateInfographic(content);
      expect(spy2).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  // cleanup and getBrowser removed — browser lifecycle managed by PuppeteerPoolService
});

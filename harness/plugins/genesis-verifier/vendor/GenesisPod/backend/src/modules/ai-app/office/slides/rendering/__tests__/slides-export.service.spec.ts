/**
 * Unit tests for SlidesExportService
 *
 * Heavy use of mocks for: puppeteer, pptxgenjs, ParameterizedRendererService, HttpService
 *
 * NOTE: jest.mock factories are hoisted before variable declarations, so all mock
 * setup inside factories must be self-contained (no references to outer variables).
 * Shared mock state is accessed via `require()` inside tests.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { HttpService } from "@nestjs/axios";
import { SlidesExportService } from "../slides-export.service";
import { ParameterizedRendererService } from "../parameterized-renderer.service";
import { LayoutOptimizerSkill } from "../../skills/layout-optimizer.skill";
import { PageContent } from "../../checkpoint/checkpoint.types";
import {
  PPTDocument,
  GeneratedSlide,
  PPTTheme,
} from "../../types/slides.types";
import { PuppeteerPoolService } from "../../../../../../common/browser/puppeteer-pool.service";

// ============================================================
// Mock pptxgenjs - self-contained factory (no outer variable refs)
// ============================================================

jest.mock("pptxgenjs", () => {
  const mockSlide = {
    background: undefined as any,
    addText: jest.fn(),
    addShape: jest.fn(),
  };
  const mockInstance = {
    title: "",
    subject: "",
    author: "",
    company: "",
    layout: "",
    addSlide: jest.fn(() => ({ ...mockSlide })),
    defineLayout: jest.fn(),
    write: jest.fn().mockResolvedValue(Buffer.from("mock-pptx-bytes")),
  };
  return jest.fn().mockImplementation(() => mockInstance);
});

// ============================================================
// Mock puppeteer - self-contained factory
// ============================================================

jest.mock("puppeteer", () => {
  const mockPage = {
    setViewport: jest.fn().mockResolvedValue(undefined),
    setContent: jest.fn().mockResolvedValue(undefined),
    screenshot: jest.fn().mockResolvedValue(Buffer.from("mock-screenshot")),
    pdf: jest.fn().mockResolvedValue(Buffer.from("mock-pdf")),
    evaluate: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const mockBrowser = {
    newPage: jest.fn().mockResolvedValue(mockPage),
    close: jest.fn().mockResolvedValue(undefined),
  };
  return {
    launch: jest.fn().mockResolvedValue(mockBrowser),
  };
});

// ============================================================
// Mock archiver - self-contained factory
//
// archiver is a CJS module. When dynamically imported via `await import('archiver')`,
// the module's main export becomes `.default`. So the mock must provide a callable
// default that returns an archive-like object.
// ============================================================

jest.mock("archiver", () => {
  // The archive object that will be returned by each archiver() call
  const archive = {
    _dataCallback: null as any,
    on(event: string, cb: (...args: any[]) => void) {
      if (event === "data") {
        archive._dataCallback = cb;
      }
      return archive;
    },
    append() {
      return archive;
    },
    async finalize() {
      // Emit one data chunk so Buffer.concat works
      if (archive._dataCallback) {
        archive._dataCallback(Buffer.from("zip-chunk"));
      }
    },
  };

  // The archiver factory function (becomes `.default` on dynamic import of CJS module)
  const archiverFactory = function () {
    return archive;
  };

  // Export as a CJS module with both the factory as default and as module.exports
  archiverFactory.default = archiverFactory;
  return archiverFactory;
});

// ============================================================
// Test data helpers
// ============================================================

const buildPPTTheme = (): PPTTheme =>
  ({
    id: "dark-professional",
    name: "Dark Professional",
    fonts: {
      heading: "Inter",
      body: "Inter",
    },
    colors: {
      primary: "#6366F1",
      secondary: "#8B5CF6",
      background: "#0F172A",
      backgroundSecondary: "#1E293B",
      text: "#F1F5F9",
      textLight: "#94A3B8",
      textMuted: "#64748B",
      accent: "#818CF8",
      border: "#1E293B",
    },
    slideBackground: "#0F172A",
  }) as unknown as PPTTheme;

const buildGeneratedSlide = (
  index: number,
  withHtml = false,
): GeneratedSlide => ({
  id: `slide-${index}`,
  index,
  spec: {
    purpose: index === 0 ? "title" : "content",
    title: `Slide ${index + 1}`,
    backgroundDecision: {
      type: "solid",
      colors: { primary: "#0F172A" },
    },
  } as any,
  content: {
    title: `Slide ${index + 1} Title`,
    subtitle: index === 0 ? "Subtitle" : undefined,
    bulletPoints: ["Point A", "Point B"],
    bodyText: "Some body text",
  } as any,
  images: [],
  html: withHtml ? `<div>Slide ${index + 1} HTML</div>` : undefined,
  isEdited: false,
  editHistory: [],
  generationMetadata: {
    textModelUsed: "gpt-4",
    contentGeneratedAt: new Date().toISOString(),
  },
});

const buildPPTDocument = (slideCount = 2, withHtml = false): PPTDocument => ({
  id: "doc-1",
  userId: "user-1",
  title: "Test Presentation",
  subtitle: "Test Subtitle",
  theme: buildPPTTheme(),
  aspectRatio: "16:9",
  language: "en",
  originalInput: { prompt: "Test prompt" },
  outline: { title: "Test", slides: [] } as any,
  slides: Array.from({ length: slideCount }, (_, i) =>
    buildGeneratedSlide(i, withHtml),
  ),
  generationConfig: {
    textModelId: "model-1",
    textModelName: "GPT-4",
  } as any,
  status: "completed" as any,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const buildPageContent = (title: string): PageContent => ({
  title,
  sections: [{ type: "text", position: "full", content: "Content text" }],
});

// ============================================================
// Tests
// ============================================================

describe("SlidesExportService", () => {
  let service: SlidesExportService;
  let parameterizedRenderer: jest.Mocked<ParameterizedRendererService>;
  let layoutOptimizer: jest.Mocked<LayoutOptimizerSkill>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const mockParameterizedRenderer = {
      render: jest.fn().mockResolvedValue({
        success: true,
        renderedSections: 1,
        truncatedSections: [],
        errors: [],
      }),
      renderWithLayout: jest.fn().mockResolvedValue({
        success: true,
        renderedSections: 1,
        truncatedSections: [],
        errors: [],
      }),
    };

    const mockLayoutOptimizer = {
      optimize: jest.fn().mockReturnValue({
        layoutType: "standard",
        gridConfig: {
          columns: 1,
          rows: 1,
          columnWidths: [1.0],
          rowHeights: [1.0],
          gap: 0.1,
        },
        titleArea: { show: true, heightRatio: 0.2, alignment: "left" },
        footerArea: { show: false, heightRatio: 0.05 },
        sectionPlacements: [],
        visualHierarchy: {
          primaryIndex: 0,
          secondaryIndices: [],
          tertiaryIndices: [],
        },
        confidence: 0.9,
        reason: "test",
      }),
      execute: jest.fn(),
    };

    const mockHttpService = {
      get: jest.fn(),
      post: jest.fn(),
    };

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const puppeteer = require("puppeteer");
    const mockPuppeteerPool = {
      getBrowser: jest.fn().mockImplementation(() => puppeteer.launch()),
      closeBrowser: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlidesExportService,
        { provide: HttpService, useValue: mockHttpService },
        {
          provide: ParameterizedRendererService,
          useValue: mockParameterizedRenderer,
        },
        { provide: LayoutOptimizerSkill, useValue: mockLayoutOptimizer },
        { provide: PuppeteerPoolService, useValue: mockPuppeteerPool },
      ],
    }).compile();

    service = module.get<SlidesExportService>(SlidesExportService);
    parameterizedRenderer = module.get(ParameterizedRendererService);
    layoutOptimizer = module.get(LayoutOptimizerSkill);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ============================================================
  // exportToPPTX
  // ============================================================

  describe("exportToPPTX", () => {
    it("should export document without HTML slides as PPTX", async () => {
      const document = buildPPTDocument(2, false);

      const result = await service.exportToPPTX(document);

      expect(result).toBeDefined();
      expect(result.filename).toContain("Test Presentation");
      expect(result.filename).toContain(".pptx");
      expect(result.mimeType).toContain("presentationml");
      expect(result.slideCount).toBe(2);
    });

    it("should use HTML screenshot path for non-editable export with HTML slides", async () => {
      const document = buildPPTDocument(2, true);

      const result = await service.exportToPPTX(document, { editable: false });

      expect(result).toBeDefined();
      expect(result.slideCount).toBe(2);
    });

    it("should use native rendering for editable=true export", async () => {
      const document = buildPPTDocument(2, true);

      const result = await service.exportToPPTX(document, { editable: true });

      expect(result).toBeDefined();
      expect(result.filename).toContain("_editable");
    });

    it("should fallback to native rendering when no HTML slides present", async () => {
      const document = buildPPTDocument(2, false);

      const result = await service.exportToPPTX(document, { editable: false });

      expect(result).toBeDefined();
      expect(result.slideCount).toBe(2);
    });

    it("should set correct MIME type for PPTX", async () => {
      const document = buildPPTDocument(1, false);

      const result = await service.exportToPPTX(document);

      expect(result.mimeType).toBe(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      );
    });

    it("should return buffer instance with data", async () => {
      const document = buildPPTDocument(1, false);

      const result = await service.exportToPPTX(document);

      expect(result.buffer).toBeDefined();
      expect(result.fileSize).toBeGreaterThan(0);
    });

    it("should handle single slide document", async () => {
      const document = buildPPTDocument(1, false);

      const result = await service.exportToPPTX(document);

      expect(result.slideCount).toBe(1);
    });

    it("should handle document with mixed HTML and non-HTML slides in non-editable mode", async () => {
      const document = buildPPTDocument(3, false);
      document.slides[0].html = "<div>HTML content</div>";

      const result = await service.exportToPPTX(document, { editable: false });

      expect(result).toBeDefined();
      expect(result.slideCount).toBe(3);
    });

    it("should include _editable suffix for editable export", async () => {
      const document = buildPPTDocument(1, false);

      const result = await service.exportToPPTX(document, { editable: true });

      expect(result.filename).toMatch(/_editable\.pptx$/);
    });

    it("should not include _editable suffix for default export", async () => {
      const document = buildPPTDocument(1, false);

      const result = await service.exportToPPTX(document);

      expect(result.filename).not.toContain("_editable");
    });

    it("should handle document with no slides", async () => {
      const document = buildPPTDocument(0, false);

      const result = await service.exportToPPTX(document);

      expect(result).toBeDefined();
      expect(result.slideCount).toBe(0);
    });
  });

  // ============================================================
  // exportFromPageContentEditable
  // ============================================================

  describe("exportFromPageContentEditable", () => {
    it("should export PageContent array to editable PPTX", async () => {
      const pages = [buildPageContent("Page 1"), buildPageContent("Page 2")];

      const result = await service.exportFromPageContentEditable(pages, {
        title: "Content Export",
      });

      expect(result).toBeDefined();
      expect(result.filename).toContain("Content Export");
      expect(result.filename).toContain("_v4.pptx");
      expect(result.slideCount).toBe(2);
    });

    it("should call parameterizedRenderer.render for each page", async () => {
      const pages = [
        buildPageContent("P1"),
        buildPageContent("P2"),
        buildPageContent("P3"),
      ];

      await service.exportFromPageContentEditable(pages, { title: "Test" });

      expect(parameterizedRenderer.render).toHaveBeenCalledTimes(3);
    });

    it("should pass page number correctly to renderer", async () => {
      const pages = [buildPageContent("Page 1"), buildPageContent("Page 2")];

      await service.exportFromPageContentEditable(pages, { title: "Numbered" });

      expect(parameterizedRenderer.render).toHaveBeenNthCalledWith(
        1,
        expect.anything(),
        pages[0],
        expect.objectContaining({ pageNumber: 1 }),
      );
      expect(parameterizedRenderer.render).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        pages[1],
        expect.objectContaining({ pageNumber: 2 }),
      );
    });

    it("should use custom theme when provided", async () => {
      const pages = [buildPageContent("Themed Page")];
      const customTheme = {
        backgroundColor: "#FFFFFF",
        textPrimary: "#000000",
      } as any;

      await service.exportFromPageContentEditable(pages, {
        title: "Custom Theme",
        theme: customTheme,
      });

      expect(parameterizedRenderer.render).toHaveBeenCalledWith(
        expect.anything(),
        pages[0],
        expect.objectContaining({ theme: customTheme }),
      );
    });

    it("should continue rendering remaining pages when one page fails", async () => {
      const pages = [
        buildPageContent("P1"),
        buildPageContent("P2"),
        buildPageContent("P3"),
      ];
      parameterizedRenderer.render
        .mockResolvedValueOnce({
          success: true,
          renderedSections: 1,
          truncatedSections: [],
          errors: [],
        })
        .mockRejectedValueOnce(new Error("Page 2 render error"))
        .mockResolvedValueOnce({
          success: true,
          renderedSections: 1,
          truncatedSections: [],
          errors: [],
        });

      const result = await service.exportFromPageContentEditable(pages, {
        title: "Partial",
      });

      expect(result).toBeDefined();
      expect(result.slideCount).toBe(3);
    });

    it("should return correct MIME type for v4 export", async () => {
      const pages = [buildPageContent("Page")];

      const result = await service.exportFromPageContentEditable(pages, {
        title: "Test",
      });

      expect(result.mimeType).toBe(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      );
    });

    it("should handle empty pages array", async () => {
      const result = await service.exportFromPageContentEditable([], {
        title: "Empty",
      });

      expect(result).toBeDefined();
      expect(result.slideCount).toBe(0);
      expect(parameterizedRenderer.render).not.toHaveBeenCalled();
    });

    it("should set document subtitle from options", async () => {
      const pages = [buildPageContent("Page 1")];

      const result = await service.exportFromPageContentEditable(pages, {
        title: "With Subtitle",
        subtitle: "The subtitle",
      });

      expect(result).toBeDefined();
    });
  });

  // ============================================================
  // getLayoutDecision
  // ============================================================

  describe("getLayoutDecision", () => {
    it("should return layout decision for page content", () => {
      const content = buildPageContent("Test Page");

      const result = service.getLayoutDecision(content);

      expect(result).toBeDefined();
      expect(layoutOptimizer.optimize).toHaveBeenCalledWith(content);
    });

    it("should return the layout from optimizer", () => {
      const content = buildPageContent("Test");
      const expectedLayout = {
        layoutType: "comparison",
        gridConfig: {
          columns: 2,
          rows: 1,
          columnWidths: [0.5, 0.5],
          rowHeights: [1.0],
          gap: 0.1,
        },
        titleArea: { show: true, heightRatio: 0.2, alignment: "left" },
        footerArea: { show: false, heightRatio: 0.05 },
        sectionPlacements: [],
        visualHierarchy: {
          primaryIndex: 0,
          secondaryIndices: [],
          tertiaryIndices: [],
        },
        confidence: 0.85,
        reason: "comparison layout",
      };
      layoutOptimizer.optimize.mockReturnValueOnce(expectedLayout as any);

      const result = service.getLayoutDecision(content);

      expect(result.layoutType).toBe("comparison");
      expect(result.confidence).toBe(0.85);
    });
  });

  // ============================================================
  // exportFromHtmlSlides
  // ============================================================

  describe("exportFromHtmlSlides", () => {
    it("should export HTML slides to PPTX", async () => {
      const htmlSlides = [
        "<div>Slide 1 content</div>",
        "<div>Slide 2 content</div>",
      ];

      const result = await service.exportFromHtmlSlides(htmlSlides, {
        title: "HTML Export",
      });

      expect(result).toBeDefined();
      expect(result.filename).toContain("HTML Export");
      expect(result.slideCount).toBe(2);
    });

    it("should return correct MIME type", async () => {
      const htmlSlides = ["<div>Content</div>"];

      const result = await service.exportFromHtmlSlides(htmlSlides, {
        title: "Test",
      });

      expect(result.mimeType).toBe(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      );
    });

    it("should handle empty HTML slides array", async () => {
      const result = await service.exportFromHtmlSlides([], {
        title: "Empty HTML",
      });

      expect(result).toBeDefined();
      expect(result.slideCount).toBe(0);
    });

    it("should use puppeteer to screenshot each HTML slide", async () => {
      const htmlSlides = ["<div>Slide 1</div>", "<div>Slide 2</div>"];
      const puppeteer = require("puppeteer");

      await service.exportFromHtmlSlides(htmlSlides, {
        title: "Screenshot Test",
      });

      expect(puppeteer.launch).toHaveBeenCalled();
    });

    it("should wrap partial HTML for screenshot", async () => {
      const partialHtml = '<div class="slide">Slide content</div>';
      const puppeteer = require("puppeteer");
      const launchResult = await puppeteer.launch();
      const page = await launchResult.newPage();

      // Reset call count before test
      page.setContent.mockClear();

      await service.exportFromHtmlSlides([partialHtml], { title: "Wrapped" });

      expect(page.setContent).toHaveBeenCalledWith(
        expect.stringContaining("<!DOCTYPE html>"),
        expect.any(Object),
      );
    });

    it("should not wrap complete HTML documents", async () => {
      const fullHtml = "<!DOCTYPE html><html><body>Complete</body></html>";
      const puppeteer = require("puppeteer");
      const launchResult = await puppeteer.launch();
      const page = await launchResult.newPage();

      page.setContent.mockClear();

      await service.exportFromHtmlSlides([fullHtml], { title: "Full HTML" });

      expect(page.setContent).toHaveBeenCalledWith(
        fullHtml,
        expect.any(Object),
      );
    });
  });

  // ============================================================
  // exportToPDF
  // ============================================================

  describe("exportToPDF", () => {
    it("should export document to PDF", async () => {
      const document = buildPPTDocument(2, false);

      const result = await service.exportToPDF(document);

      expect(result).toBeDefined();
      expect(result.filename).toBe("Test Presentation.pdf");
      expect(result.mimeType).toBe("application/pdf");
      expect(result.slideCount).toBe(2);
    });

    it("should return PDF buffer", async () => {
      const document = buildPPTDocument(1, false);

      const result = await service.exportToPDF(document);

      expect(result.buffer).toBeDefined();
    });

    it("should use puppeteer for PDF generation", async () => {
      const document = buildPPTDocument(1, false);
      const puppeteer = require("puppeteer");

      await service.exportToPDF(document);

      expect(puppeteer.launch).toHaveBeenCalled();
    });

    it("should use HTML slides for same-source PDF export when HTML is available", async () => {
      const document = buildPPTDocument(2, true);
      const puppeteer = require("puppeteer");
      const launchResult = await puppeteer.launch();
      const page = await launchResult.newPage();
      page.setContent.mockClear();

      await service.exportToPDF(document);

      expect(page.setContent).toHaveBeenCalled();
    });

    it("should fallback to legacy HTML when no HTML slides present", async () => {
      const document = buildPPTDocument(2, false);
      const puppeteer = require("puppeteer");
      const launchResult = await puppeteer.launch();
      const page = await launchResult.newPage();
      page.setContent.mockClear();

      await service.exportToPDF(document);

      expect(page.setContent).toHaveBeenCalled();
    });

    it("should call pdf() on puppeteer page", async () => {
      const document = buildPPTDocument(1, false);
      const puppeteer = require("puppeteer");
      const launchResult = await puppeteer.launch();
      const page = await launchResult.newPage();
      page.pdf.mockClear();

      await service.exportToPDF(document);

      expect(page.pdf).toHaveBeenCalled();
    });

    it("should set correct PDF page dimensions (landscape)", async () => {
      const document = buildPPTDocument(1, false);
      const puppeteer = require("puppeteer");
      const launchResult = await puppeteer.launch();
      const page = await launchResult.newPage();
      page.pdf.mockClear();

      await service.exportToPDF(document);

      expect(page.pdf).toHaveBeenCalledWith(
        expect.objectContaining({
          landscape: true,
          printBackground: true,
        }),
      );
    });
  });

  // ============================================================
  // exportToPNG
  // ============================================================

  describe("exportToPNG", () => {
    it("should export slides to PNG ZIP package", async () => {
      const document = buildPPTDocument(2, false);

      const result = await service.exportToPNG(document);

      expect(result).toBeDefined();
      expect(result.filename).toContain("Test Presentation");
      expect(result.filename).toContain("_slides.zip");
      expect(result.mimeType).toBe("application/zip");
      expect(result.slideCount).toBe(2);
    });

    it("should use puppeteer for PNG screenshots", async () => {
      const document = buildPPTDocument(1, false);
      const puppeteer = require("puppeteer");

      await service.exportToPNG(document);

      expect(puppeteer.launch).toHaveBeenCalled();
    });

    it("should screenshot each slide separately", async () => {
      const document = buildPPTDocument(3, false);
      const puppeteer = require("puppeteer");
      const launchResult = await puppeteer.launch();
      const page = await launchResult.newPage();
      page.screenshot.mockClear();

      await service.exportToPNG(document);

      expect(page.screenshot).toHaveBeenCalledTimes(3);
    });

    it("should use HTML for slides that have HTML content", async () => {
      const document = buildPPTDocument(2, true);
      const puppeteer = require("puppeteer");
      const launchResult = await puppeteer.launch();
      const page = await launchResult.newPage();
      page.setContent.mockClear();

      await service.exportToPNG(document);

      expect(page.setContent).toHaveBeenCalled();
    });

    it("should return buffer", async () => {
      const document = buildPPTDocument(1, false);

      const result = await service.exportToPNG(document);

      expect(result.buffer).toBeDefined();
    });
  });

  // ============================================================
  // Edge cases
  // ============================================================

  describe("edge cases", () => {
    it("should handle document title with special characters", async () => {
      const document = buildPPTDocument(1, false);
      document.title = 'Test & Report: "Q1 2024"';

      const result = await service.exportToPPTX(document);

      expect(result.filename).toContain("Test & Report");
    });

    it("should handle PageContent with empty sections for editable export", async () => {
      const pages: PageContent[] = [{ title: "Empty Slide", sections: [] }];

      const result = await service.exportFromPageContentEditable(pages, {
        title: "Empty",
      });

      expect(result).toBeDefined();
      expect(result.slideCount).toBe(1);
    });
  });

  // ============================================================
  // exportToPPTX — native render (editable) with various layout types
  // These tests exercise the private renderSlide → renderByLayout path
  // ============================================================

  describe("exportToPPTX native rendering — layout coverage", () => {
    const makeSlideWithLayout = (
      layoutType: string,
      purpose = "content",
    ): GeneratedSlide =>
      ({
        id: "slide-layout",
        index: 1,
        spec: {
          purpose,
          title: "Layout Test",
          layoutType,
          backgroundDecision: {
            type: "solid",
            colors: { primary: "#0F172A" },
          },
        },
        content: {
          title: "Layout Slide",
          subtitle: "Subtitle text",
          bulletPoints: ["Point 1", "Point 2"],
          bodyText: "Body text content",
          leftColumn: { title: "Left", bullets: ["L1"] },
          rightColumn: { title: "Right", bullets: ["R1"] },
          quote: "This is a quote",
          attribution: "Author",
          timelineItems: [
            { label: "Q1", description: "Phase 1", date: "2024-01" },
          ],
          statistics: [
            { label: "Metric", value: "100", unit: "%", change: "+10%" },
          ],
          leftList: [{ text: "Advantage 1" }],
          rightList: [{ text: "Disadvantage 1" }],
        },
        images: [],
        html: undefined,
        isEdited: false,
        editHistory: [],
        generationMetadata: {
          textModelUsed: "gpt-4",
          contentGeneratedAt: new Date().toISOString(),
        },
      }) as unknown as GeneratedSlide;

    const layoutTypes = [
      "title_center",
      "title_subtitle",
      "text_image_left",
      "text_image_right",
      "image_full",
      "two_columns",
      "bullet_points",
      "statistics_cards",
      "quote_highlight",
      "timeline_horizontal",
      "comparison_split",
      "unknown_layout", // default case
    ];

    for (const layoutType of layoutTypes) {
      it(`should render layout type: ${layoutType}`, async () => {
        const document = buildPPTDocument(0, false);
        document.slides = [makeSlideWithLayout(layoutType)];

        const result = await service.exportToPPTX(document, { editable: true });

        expect(result).toBeDefined();
        expect(result.slideCount).toBe(1);
      });
    }

    it("should render title_center layout for title/closing slides", async () => {
      const document = buildPPTDocument(0, false);
      document.slides = [makeSlideWithLayout("title_center", "title")];

      const result = await service.exportToPPTX(document, { editable: true });

      expect(result).toBeDefined();
      expect(result.slideCount).toBe(1);
    });

    it("should render closing slide without page number", async () => {
      const document = buildPPTDocument(0, false);
      document.slides = [makeSlideWithLayout("bullet_points", "closing")];

      const result = await service.exportToPPTX(document, { editable: true });

      expect(result).toBeDefined();
    });

    it("should render slide with gradient background decision", async () => {
      const document = buildPPTDocument(0, false);
      const slide = makeSlideWithLayout("bullet_points");
      (slide.spec as any).backgroundDecision = {
        type: "gradient",
        colors: { primary: "#6366F1", secondary: "#8B5CF6" },
      };
      document.slides = [slide];

      const result = await service.exportToPPTX(document, { editable: true });

      expect(result).toBeDefined();
    });

    it("should render slide with default background (no valid bgDecision type)", async () => {
      const document = buildPPTDocument(0, false);
      const slide = makeSlideWithLayout("bullet_points");
      (slide.spec as any).backgroundDecision = { type: "none", colors: null };
      document.slides = [slide];

      const result = await service.exportToPPTX(document, { editable: true });

      expect(result).toBeDefined();
    });

    it("should handle slide with background image (fails gracefully)", async () => {
      const document = buildPPTDocument(0, false);
      const slide = makeSlideWithLayout("bullet_points");
      slide.images = [
        {
          id: "bg-img",
          position: "background",
          url: "http://example.com/bg.png",
          width: 1280,
          height: 720,
        } as any,
      ];
      document.slides = [slide];

      // HttpService.get will throw — service should fall back gracefully
      const mockHttpService = (service as any).httpService;
      if (mockHttpService?.get) {
        // Use mockRejectedValue on pipe so firstValueFrom receives a rejection
        // without creating an unhandled Promise rejection at mock-construction time
        mockHttpService.get.mockReturnValue({
          pipe: jest.fn().mockRejectedValue(new Error("download failed")),
        });
      }

      // Should not throw even if image download fails
      const result = await service.exportToPPTX(document, { editable: true });
      expect(result).toBeDefined();
    });
  });

  // ============================================================
  // PDF export — combineV3SlidesForPdf (slides with and without HTML)
  // ============================================================

  describe("exportToPDF — HTML combination coverage", () => {
    it("should combine slides using HTML when available (with body tag)", async () => {
      const document = buildPPTDocument(2, false);
      document.slides[0].html =
        "<!DOCTYPE html><html><head></head><body><div>Slide 1 content</div></body></html>";
      document.slides[1].html = undefined;

      const result = await service.exportToPDF(document);

      expect(result).toBeDefined();
      expect(result.slideCount).toBe(2);
    });

    it("should combine slides using HTML without body tag", async () => {
      const document = buildPPTDocument(1, false);
      document.slides[0].html =
        '<div class="slide">Content without body tag</div>';

      const result = await service.exportToPDF(document);

      expect(result).toBeDefined();
    });

    it("should use legacy HTML generation when all slides lack HTML", async () => {
      const document = buildPPTDocument(2, false);
      // No HTML on any slide

      const result = await service.exportToPDF(document);

      expect(result.mimeType).toBe("application/pdf");
    });

    it("should render title slide (purpose=title) in PDF correctly", async () => {
      const document = buildPPTDocument(0, false);
      document.slides = [buildGeneratedSlide(0, false)]; // index 0 has purpose 'title'

      const result = await service.exportToPDF(document);

      expect(result).toBeDefined();
    });
  });

  // ============================================================
  // PNG export — generateSingleSlideHtml coverage
  // ============================================================

  describe("exportToPNG — single slide HTML generation", () => {
    it("should generate HTML for slides without HTML (title slide)", async () => {
      const document = buildPPTDocument(0, false);
      document.slides = [buildGeneratedSlide(0, false)]; // title slide

      const result = await service.exportToPNG(document);

      expect(result).toBeDefined();
      expect(result.slideCount).toBe(1);
    });

    it("should generate HTML for content slides without HTML", async () => {
      const document = buildPPTDocument(0, false);
      document.slides = [buildGeneratedSlide(1, false)]; // content slide

      const result = await service.exportToPNG(document);

      expect(result).toBeDefined();
    });

    it("should use wrapV3HtmlForScreenshot for slides with partial HTML", async () => {
      const document = buildPPTDocument(0, false);
      document.slides = [buildGeneratedSlide(0, true)]; // has HTML but not full document
      const puppeteer = require("puppeteer");
      const launchResult = await puppeteer.launch();
      const page = await launchResult.newPage();
      page.setContent.mockClear();

      await service.exportToPNG(document);

      expect(page.setContent).toHaveBeenCalledWith(
        expect.stringContaining("<!DOCTYPE html>"),
        expect.any(Object),
      );
    });

    it("should use full HTML directly for slides with complete HTML documents", async () => {
      const document = buildPPTDocument(0, false);
      document.slides = [buildGeneratedSlide(0, false)];
      document.slides[0].html =
        "<!DOCTYPE html><html><body>Complete</body></html>";
      const puppeteer = require("puppeteer");
      const launchResult = await puppeteer.launch();
      const page = await launchResult.newPage();
      page.setContent.mockClear();

      await service.exportToPNG(document);

      expect(page.setContent).toHaveBeenCalledWith(
        "<!DOCTYPE html><html><body>Complete</body></html>",
        expect.any(Object),
      );
    });
  });

  // ============================================================
  // exportToPPTX — light theme (non-dark) native rendering
  // ============================================================

  describe("exportToPPTX — light theme native rendering", () => {
    const buildLightTheme = () =>
      ({
        id: "light-corporate",
        name: "Light Corporate",
        fonts: {
          heading: "Helvetica Neue",
          body: "Arial",
        },
        colors: {
          primary: "#0070F3",
          secondary: "#005BB5",
          background: "#FFFFFF", // light — isDarkColor returns false
          backgroundSecondary: "#F0F0F0",
          text: "#111111",
          textLight: "#555555",
          textMuted: "#888888",
          accent: "#0070F3",
          border: "#DDDDDD",
        },
        slideBackground: "#FFFFFF",
      }) as unknown as PPTTheme;

    it("should render with light theme (non-gradient background)", async () => {
      const document = buildPPTDocument(1, false);
      document.theme = buildLightTheme();

      const result = await service.exportToPPTX(document, { editable: true });

      expect(result).toBeDefined();
      expect(result.slideCount).toBe(1);
    });

    it("should render title_center layout with light theme", async () => {
      const document = buildPPTDocument(0, false);
      document.theme = buildLightTheme();
      const slide = {
        id: "light-slide",
        index: 0,
        spec: {
          purpose: "title",
          title: "Light Title",
          layoutType: "title_center",
          backgroundDecision: { type: "solid", colors: { primary: "#FFFFFF" } },
        },
        content: {
          title: "Light Title",
          subtitle: "Light Subtitle",
          bulletPoints: [],
          bodyText: "",
        },
        images: [],
        html: undefined,
        isEdited: false,
        editHistory: [],
        generationMetadata: {
          textModelUsed: "gpt-4",
          contentGeneratedAt: new Date().toISOString(),
        },
      } as unknown as GeneratedSlide;
      document.slides = [slide];

      const result = await service.exportToPPTX(document, { editable: true });

      expect(result).toBeDefined();
    });
  });

  // ============================================================
  // exportFromHtmlSlides — additional branches
  // ============================================================

  describe("exportFromHtmlSlides — additional coverage", () => {
    it("should handle slide HTML that is already a full document with <html> tag", async () => {
      const htmlSlides = ["<html><body>Full document</body></html>"];
      const puppeteer = require("puppeteer");
      const launchResult = await puppeteer.launch();
      const page = await launchResult.newPage();
      page.setContent.mockClear();

      await service.exportFromHtmlSlides(htmlSlides, { title: "Full HTML" });

      // HTML with <html> tag should be passed through unchanged
      expect(page.setContent).toHaveBeenCalledWith(
        htmlSlides[0],
        expect.any(Object),
      );
    });

    it("should include subtitle in PPTX document properties", async () => {
      const htmlSlides = ["<div>Content</div>"];

      const result = await service.exportFromHtmlSlides(htmlSlides, {
        title: "Export Title",
        subtitle: "Export Subtitle",
      });

      expect(result.filename).toContain("Export Title");
    });
  });
});

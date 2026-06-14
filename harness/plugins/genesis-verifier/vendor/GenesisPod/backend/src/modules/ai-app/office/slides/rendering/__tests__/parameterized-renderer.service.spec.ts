/**
 * Unit tests for ParameterizedRendererService
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ParameterizedRendererService } from "../parameterized-renderer.service";
import {
  LayoutOptimizerSkill,
  LayoutDecision,
  GridConfig,
  SectionPlacement,
} from "../../skills/layout-optimizer.skill";
import {
  PageContent,
  ContentSection,
  StatContent,
  ChartContent,
  GENSPARK_DESIGN_SYSTEM,
} from "../../checkpoint/checkpoint.types";

// ============================================================
// Mock PptxGenJS instance
// ============================================================

const createMockSlide = () => ({
  background: undefined as any,
  addText: jest.fn(),
  addShape: jest.fn(),
  addChart: jest.fn(),
});

const createMockPptx = () => ({
  addSlide: jest.fn(() => createMockSlide()),
  write: jest.fn().mockResolvedValue(Buffer.from("mock-pptx-data")),
  title: "",
  subject: "",
  author: "",
  company: "",
  defineLayout: jest.fn(),
  layout: "",
});

// ============================================================
// Layout decision builder
// ============================================================

const buildLayoutDecision = (
  overrides: Partial<LayoutDecision> = {},
): LayoutDecision => ({
  layoutType: "standard",
  gridConfig: {
    columns: 1,
    rows: 1,
    columnWidths: [1.0],
    rowHeights: [1.0],
    gap: 0.1,
  } as GridConfig,
  titleArea: {
    show: true,
    heightRatio: 0.2,
    alignment: "left",
  },
  footerArea: {
    show: false,
    heightRatio: 0.05,
  },
  sectionPlacements: [],
  visualHierarchy: {
    primaryIndex: 0,
    secondaryIndices: [],
    tertiaryIndices: [],
  },
  confidence: 0.9,
  reason: "test layout",
  ...overrides,
});

const buildSectionPlacement = (
  sectionIndex: number,
  renderStyle: SectionPlacement["renderStyle"] = "default",
): SectionPlacement => ({
  sectionIndex,
  gridArea: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
  renderStyle,
  priority: 1,
});

// ============================================================
// Content builders
// ============================================================

const buildPageContent = (
  title: string,
  sections: ContentSection[] = [],
  subtitle?: string,
): PageContent => ({
  title,
  subtitle,
  sections,
  footer: undefined,
});

const makeTextSection = (content: string): ContentSection => ({
  type: "text",
  position: "full",
  content,
});

const makeListSection = (items: string[]): ContentSection => ({
  type: "list",
  position: "full",
  content: items,
});

const makeStatSection = (value: string, label: string): ContentSection => ({
  type: "stat",
  position: "left",
  content: { value, label } as StatContent,
});

const makeChartSection = (
  chartType: "bar" | "line" | "pie" = "bar",
): ContentSection => ({
  type: "chart",
  position: "full",
  content: {
    type: chartType,
    data: [
      { name: "A", value: 10 },
      { name: "B", value: 20 },
    ],
    title: "Test Chart",
  } as ChartContent,
});

const makeQuoteSection = (text: string): ContentSection => ({
  type: "quote",
  position: "full",
  content: text,
});

const makeImageSection = (): ContentSection => ({
  type: "image",
  position: "full",
  content: "https://example.com/image.jpg",
});

// ============================================================
// Tests
// ============================================================

describe("ParameterizedRendererService", () => {
  let service: ParameterizedRendererService;
  let layoutOptimizer: jest.Mocked<LayoutOptimizerSkill>;

  beforeEach(async () => {
    const mockLayoutOptimizer = {
      optimize: jest.fn(),
      optimizeFromFeatures: jest.fn(),
      execute: jest.fn(),
      id: "slides-layout-optimizer",
      domain: "slides",
      version: "4.0.0",
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ParameterizedRendererService,
        { provide: LayoutOptimizerSkill, useValue: mockLayoutOptimizer },
      ],
    }).compile();

    service = module.get<ParameterizedRendererService>(
      ParameterizedRendererService,
    );
    layoutOptimizer = module.get(LayoutOptimizerSkill);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ============================================================
  // render()
  // ============================================================

  describe("render", () => {
    it("should return a successful render result for a simple page", async () => {
      const content = buildPageContent("Test Slide", []);
      const layout = buildLayoutDecision();
      layoutOptimizer.optimize.mockReturnValue(layout);

      const pptx = createMockPptx();
      const result = await service.render(pptx as any, content);

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(pptx.addSlide).toHaveBeenCalled();
    });

    it("should call layoutOptimizer.optimize with page content", async () => {
      const content = buildPageContent("My Slide");
      layoutOptimizer.optimize.mockReturnValue(buildLayoutDecision());

      const pptx = createMockPptx();
      await service.render(pptx as any, content);

      expect(layoutOptimizer.optimize).toHaveBeenCalledWith(content);
    });

    it("should use default theme when no theme provided", async () => {
      const content = buildPageContent("Slide");
      layoutOptimizer.optimize.mockReturnValue(buildLayoutDecision());

      const pptx = createMockPptx();
      const result = await service.render(pptx as any, content);

      // Should succeed with default theme
      expect(result.success).toBe(true);
    });

    it("should use custom theme when provided", async () => {
      const content = buildPageContent("Slide");
      layoutOptimizer.optimize.mockReturnValue(buildLayoutDecision());

      const customTheme = {
        ...GENSPARK_DESIGN_SYSTEM,
        backgroundColor: "#FF0000",
      };

      const pptx = createMockPptx();
      const result = await service.render(pptx as any, content, {
        theme: customTheme,
      });

      expect(result.success).toBe(true);
    });

    it("should use default page number 1 when not provided", async () => {
      const content = buildPageContent("Slide");
      layoutOptimizer.optimize.mockReturnValue(buildLayoutDecision());

      const pptx = createMockPptx();
      const result = await service.render(pptx as any, content);

      expect(result.success).toBe(true);
    });

    it("should use custom page number when provided", async () => {
      const content = buildPageContent("Slide");
      layoutOptimizer.optimize.mockReturnValue(buildLayoutDecision());

      const pptx = createMockPptx();
      const result = await service.render(pptx as any, content, {
        pageNumber: 5,
      });

      expect(result.success).toBe(true);
    });

    it("should render title area when show=true", async () => {
      const content = buildPageContent("Visible Title", [], "Subtitle here");
      const layout = buildLayoutDecision({
        titleArea: { show: true, heightRatio: 0.25, alignment: "center" },
      });
      layoutOptimizer.optimize.mockReturnValue(layout);

      const pptx = createMockPptx();
      const mockSlide = createMockSlide();
      pptx.addSlide.mockReturnValue(mockSlide);

      await service.render(pptx as any, content);

      // Title should have been added
      expect(mockSlide.addText).toHaveBeenCalledWith(
        "Visible Title",
        expect.objectContaining({ bold: true }),
      );
    });

    it("should render subtitle when content has subtitle", async () => {
      const content = buildPageContent("Title", [], "The Subtitle");
      const layout = buildLayoutDecision({
        titleArea: { show: true, heightRatio: 0.25, alignment: "left" },
      });
      layoutOptimizer.optimize.mockReturnValue(layout);

      const pptx = createMockPptx();
      const mockSlide = createMockSlide();
      pptx.addSlide.mockReturnValue(mockSlide);

      await service.render(pptx as any, content);

      const calls = mockSlide.addText.mock.calls;
      const subtitleCall = calls.find((c: any[]) => c[0] === "The Subtitle");
      expect(subtitleCall).toBeDefined();
    });

    it("should not render title when show=false", async () => {
      const content = buildPageContent("Hidden Title");
      const layout = buildLayoutDecision({
        titleArea: { show: false, heightRatio: 0.2, alignment: "left" },
      });
      layoutOptimizer.optimize.mockReturnValue(layout);

      const pptx = createMockPptx();
      const mockSlide = createMockSlide();
      pptx.addSlide.mockReturnValue(mockSlide);

      await service.render(pptx as any, content);

      // Title should not be rendered
      const calls = mockSlide.addText.mock.calls;
      const titleCall = calls.find((c: any[]) => c[0] === "Hidden Title");
      expect(titleCall).toBeUndefined();
    });

    it("should render footer when show=true", async () => {
      const content: PageContent = {
        ...buildPageContent("Footer Slide"),
        footer: "Footer Text",
      };
      const layout = buildLayoutDecision({
        titleArea: { show: false, heightRatio: 0.2, alignment: "left" },
        footerArea: { show: true, heightRatio: 0.08 },
      });
      layoutOptimizer.optimize.mockReturnValue(layout);

      const pptx = createMockPptx();
      const mockSlide = createMockSlide();
      pptx.addSlide.mockReturnValue(mockSlide);

      await service.render(pptx as any, content, { pageNumber: 3 });

      const calls = mockSlide.addText.mock.calls;
      // Page number should be rendered
      const pageNumCall = calls.find((c: any[]) => c[0] === "3");
      expect(pageNumCall).toBeDefined();
    });

    it("should not render footer when show=false", async () => {
      const content: PageContent = {
        ...buildPageContent("No Footer"),
        footer: "Should Not Appear",
      };
      const layout = buildLayoutDecision({
        footerArea: { show: false, heightRatio: 0.05 },
      });
      layoutOptimizer.optimize.mockReturnValue(layout);

      const pptx = createMockPptx();
      const mockSlide = createMockSlide();
      pptx.addSlide.mockReturnValue(mockSlide);

      await service.render(pptx as any, content);

      const calls = mockSlide.addText.mock.calls;
      const footerCall = calls.find((c: any[]) => c[0] === "Should Not Appear");
      expect(footerCall).toBeUndefined();
    });

    it("should render text sections successfully", async () => {
      const content = buildPageContent("Text Slide", [
        makeTextSection("Hello World"),
      ]);
      const layout = buildLayoutDecision({
        sectionPlacements: [buildSectionPlacement(0)],
      });
      layoutOptimizer.optimize.mockReturnValue(layout);

      const pptx = createMockPptx();
      const mockSlide = createMockSlide();
      pptx.addSlide.mockReturnValue(mockSlide);

      const result = await service.render(pptx as any, content);

      expect(result.renderedSections).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it("should render list sections successfully", async () => {
      const content = buildPageContent("List Slide", [
        makeListSection(["Item 1", "Item 2", "Item 3"]),
      ]);
      const layout = buildLayoutDecision({
        sectionPlacements: [buildSectionPlacement(0)],
      });
      layoutOptimizer.optimize.mockReturnValue(layout);

      const pptx = createMockPptx();
      const mockSlide = createMockSlide();
      pptx.addSlide.mockReturnValue(mockSlide);

      const result = await service.render(pptx as any, content);

      expect(result.renderedSections).toBe(1);
    });

    it("should render stat sections successfully", async () => {
      const content = buildPageContent("Stat Slide", [
        makeStatSection("95%", "Satisfaction"),
      ]);
      const layout = buildLayoutDecision({
        sectionPlacements: [buildSectionPlacement(0, "card")],
      });
      layoutOptimizer.optimize.mockReturnValue(layout);

      const pptx = createMockPptx();
      const mockSlide = createMockSlide();
      pptx.addSlide.mockReturnValue(mockSlide);

      const result = await service.render(pptx as any, content);

      expect(result.renderedSections).toBe(1);
      const calls = mockSlide.addText.mock.calls;
      const valueCall = calls.find((c: any[]) => c[0] === "95%");
      expect(valueCall).toBeDefined();
    });

    it("should render stat section with trend/change", async () => {
      const content = buildPageContent("Stat Trend", [
        {
          type: "stat",
          position: "left",
          content: {
            value: "85%",
            label: "Growth",
            change: "+5%",
            trend: "up",
          } as StatContent,
        },
      ]);
      const layout = buildLayoutDecision({
        sectionPlacements: [buildSectionPlacement(0)],
      });
      layoutOptimizer.optimize.mockReturnValue(layout);

      const pptx = createMockPptx();
      const mockSlide = createMockSlide();
      pptx.addSlide.mockReturnValue(mockSlide);

      const result = await service.render(pptx as any, content);

      expect(result.renderedSections).toBe(1);
      const calls = mockSlide.addText.mock.calls;
      const changeCall = calls.find((c: any[]) => c[0] === "+5%");
      expect(changeCall).toBeDefined();
    });

    it("should render chart sections (bar chart)", async () => {
      const content = buildPageContent("Chart Slide", [
        makeChartSection("bar"),
      ]);
      const layout = buildLayoutDecision({
        sectionPlacements: [buildSectionPlacement(0)],
      });
      layoutOptimizer.optimize.mockReturnValue(layout);

      const pptx = createMockPptx();
      const mockSlide = createMockSlide();
      pptx.addSlide.mockReturnValue(mockSlide);

      const result = await service.render(pptx as any, content);

      expect(result.renderedSections).toBe(1);
      expect(mockSlide.addChart).toHaveBeenCalledWith(
        "bar",
        expect.any(Array),
        expect.any(Object),
      );
    });

    it("should render chart sections (line chart)", async () => {
      const content = buildPageContent("Line Chart", [
        makeChartSection("line"),
      ]);
      const layout = buildLayoutDecision({
        sectionPlacements: [buildSectionPlacement(0)],
      });
      layoutOptimizer.optimize.mockReturnValue(layout);

      const pptx = createMockPptx();
      const mockSlide = createMockSlide();
      pptx.addSlide.mockReturnValue(mockSlide);

      await service.render(pptx as any, content);

      expect(mockSlide.addChart).toHaveBeenCalledWith(
        "line",
        expect.any(Array),
        expect.any(Object),
      );
    });

    it("should render chart sections (pie chart)", async () => {
      const content = buildPageContent("Pie Chart", [makeChartSection("pie")]);
      const layout = buildLayoutDecision({
        sectionPlacements: [buildSectionPlacement(0)],
      });
      layoutOptimizer.optimize.mockReturnValue(layout);

      const pptx = createMockPptx();
      const mockSlide = createMockSlide();
      pptx.addSlide.mockReturnValue(mockSlide);

      await service.render(pptx as any, content);

      expect(mockSlide.addChart).toHaveBeenCalledWith(
        "pie",
        expect.any(Array),
        expect.any(Object),
      );
    });

    it("should fallback to bar chart for unknown chart type", async () => {
      const content = buildPageContent("Unknown Chart", [
        {
          type: "chart",
          position: "full",
          content: {
            type: "unknown" as any,
            data: [{ name: "X", value: 1 }],
            title: "Unknown",
          } as ChartContent,
        },
      ]);
      const layout = buildLayoutDecision({
        sectionPlacements: [buildSectionPlacement(0)],
      });
      layoutOptimizer.optimize.mockReturnValue(layout);

      const pptx = createMockPptx();
      const mockSlide = createMockSlide();
      pptx.addSlide.mockReturnValue(mockSlide);

      await service.render(pptx as any, content);

      expect(mockSlide.addChart).toHaveBeenCalledWith(
        "bar",
        expect.any(Array),
        expect.any(Object),
      );
    });

    it("should render chart with fallback text when addChart throws", async () => {
      const content = buildPageContent("Broken Chart", [
        makeChartSection("bar"),
      ]);
      const layout = buildLayoutDecision({
        sectionPlacements: [buildSectionPlacement(0)],
      });
      layoutOptimizer.optimize.mockReturnValue(layout);

      const pptx = createMockPptx();
      const mockSlide = createMockSlide();
      mockSlide.addChart.mockImplementation(() => {
        throw new Error("Chart render error");
      });
      pptx.addSlide.mockReturnValue(mockSlide);

      const result = await service.render(pptx as any, content);

      // Should not fail the whole render
      expect(result.renderedSections).toBe(1);
      // Fallback text should be rendered
      expect(mockSlide.addText).toHaveBeenCalledWith(
        expect.stringContaining("[图表"),
        expect.any(Object),
      );
    });

    it("should render quote sections", async () => {
      const content = buildPageContent("Quote Slide", [
        makeQuoteSection("Be the change."),
      ]);
      const layout = buildLayoutDecision({
        sectionPlacements: [buildSectionPlacement(0)],
      });
      layoutOptimizer.optimize.mockReturnValue(layout);

      const pptx = createMockPptx();
      const mockSlide = createMockSlide();
      pptx.addSlide.mockReturnValue(mockSlide);

      const result = await service.render(pptx as any, content);

      expect(result.renderedSections).toBe(1);
      const calls = mockSlide.addText.mock.calls;
      const quoteCall = calls.find((c: any[]) => c[0] === "Be the change.");
      expect(quoteCall).toBeDefined();
    });

    it("should render image sections as placeholder", async () => {
      const content = buildPageContent("Image Slide", [makeImageSection()]);
      const layout = buildLayoutDecision({
        sectionPlacements: [buildSectionPlacement(0)],
      });
      layoutOptimizer.optimize.mockReturnValue(layout);

      const pptx = createMockPptx();
      const mockSlide = createMockSlide();
      pptx.addSlide.mockReturnValue(mockSlide);

      const result = await service.render(pptx as any, content);

      expect(result.renderedSections).toBe(1);
      // Image section uses addShape for placeholder
      expect(mockSlide.addShape).toHaveBeenCalled();
    });

    it("should render card style sections with addShape", async () => {
      const content = buildPageContent("Card Slide", [
        makeTextSection("Card content"),
      ]);
      const layout = buildLayoutDecision({
        sectionPlacements: [buildSectionPlacement(0, "card")],
      });
      layoutOptimizer.optimize.mockReturnValue(layout);

      const pptx = createMockPptx();
      const mockSlide = createMockSlide();
      pptx.addSlide.mockReturnValue(mockSlide);

      await service.render(pptx as any, content);

      expect(mockSlide.addShape).toHaveBeenCalledWith(
        "roundRect",
        expect.any(Object),
      );
    });

    it("should render highlight style sections with addShape", async () => {
      const content = buildPageContent("Highlight Slide", [
        makeTextSection("Highlighted"),
      ]);
      const layout = buildLayoutDecision({
        sectionPlacements: [buildSectionPlacement(0, "highlight")],
      });
      layoutOptimizer.optimize.mockReturnValue(layout);

      const pptx = createMockPptx();
      const mockSlide = createMockSlide();
      pptx.addSlide.mockReturnValue(mockSlide);

      await service.render(pptx as any, content);

      expect(mockSlide.addShape).toHaveBeenCalledWith(
        "rect",
        expect.any(Object),
      );
    });

    it("should track truncated sections", async () => {
      // List with more than 6 items triggers truncation
      const items = Array.from({ length: 10 }, (_, i) => `Item ${i + 1}`);
      const content = buildPageContent("Truncated List", [
        makeListSection(items),
      ]);
      const layout = buildLayoutDecision({
        sectionPlacements: [buildSectionPlacement(0)],
      });
      layoutOptimizer.optimize.mockReturnValue(layout);

      const pptx = createMockPptx();
      const mockSlide = createMockSlide();
      pptx.addSlide.mockReturnValue(mockSlide);

      const result = await service.render(pptx as any, content);

      expect(result.truncatedSections).toContain(0);
    });

    it("should track errors when section has no position", async () => {
      const content = buildPageContent("Bad Section", [
        makeTextSection("text"),
      ]);
      // sectionPlacements references index 5, but content only has index 0
      const layout = buildLayoutDecision({
        sectionPlacements: [{ ...buildSectionPlacement(5), sectionIndex: 5 }],
      });
      layoutOptimizer.optimize.mockReturnValue(layout);

      const pptx = createMockPptx();
      pptx.addSlide.mockReturnValue(createMockSlide());

      const result = await service.render(pptx as any, content);

      // Section at index 5 doesn't exist in content, so it should be skipped
      expect(result.renderedSections).toBe(0);
    });

    it("should handle render errors gracefully and report them", async () => {
      const content = buildPageContent("Error Slide", [
        makeTextSection("text"),
      ]);
      const layout = buildLayoutDecision({
        sectionPlacements: [buildSectionPlacement(0)],
      });
      layoutOptimizer.optimize.mockReturnValue(layout);

      const pptx = createMockPptx();
      const mockSlide = createMockSlide();
      // Make addText throw for section rendering
      let callCount = 0;
      mockSlide.addText.mockImplementation(() => {
        callCount++;
        // Title rendering: calls 1, section rendering: call 2+ should throw
        if (callCount >= 2) {
          throw new Error("Render section failed");
        }
      });
      pptx.addSlide.mockReturnValue(mockSlide);

      const result = await service.render(pptx as any, content);

      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should render multiple sections and count them", async () => {
      const content = buildPageContent("Multi Section", [
        makeTextSection("Section 1"),
        makeListSection(["A", "B"]),
        makeQuoteSection("A great quote"),
      ]);
      const layout = buildLayoutDecision({
        gridConfig: {
          columns: 2,
          rows: 2,
          columnWidths: [0.5, 0.5],
          rowHeights: [0.5, 0.5],
          gap: 0.1,
        },
        sectionPlacements: [
          {
            sectionIndex: 0,
            gridArea: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
            renderStyle: "default",
            priority: 1,
          },
          {
            sectionIndex: 1,
            gridArea: { row: 0, col: 1, rowSpan: 1, colSpan: 1 },
            renderStyle: "default",
            priority: 2,
          },
          {
            sectionIndex: 2,
            gridArea: { row: 1, col: 0, rowSpan: 1, colSpan: 2 },
            renderStyle: "default",
            priority: 3,
          },
        ],
      });
      layoutOptimizer.optimize.mockReturnValue(layout);

      const pptx = createMockPptx();
      pptx.addSlide.mockReturnValue(createMockSlide());

      const result = await service.render(pptx as any, content);

      expect(result.renderedSections).toBe(3);
    });
  });

  // ============================================================
  // renderWithLayout()
  // ============================================================

  describe("renderWithLayout", () => {
    it("should render using pre-computed layout without calling layoutOptimizer", async () => {
      const content = buildPageContent("Pre-layout Slide", [
        makeTextSection("Content"),
      ]);
      const layout = buildLayoutDecision({
        sectionPlacements: [buildSectionPlacement(0)],
      });

      const pptx = createMockPptx();
      pptx.addSlide.mockReturnValue(createMockSlide());

      const result = await service.renderWithLayout(
        pptx as any,
        content,
        layout,
      );

      expect(result.success).toBe(true);
      expect(layoutOptimizer.optimize).not.toHaveBeenCalled();
    });

    it("should return a successful render result", async () => {
      const content = buildPageContent("Layout Slide", []);
      const layout = buildLayoutDecision();

      const pptx = createMockPptx();
      pptx.addSlide.mockReturnValue(createMockSlide());

      const result = await service.renderWithLayout(
        pptx as any,
        content,
        layout,
      );

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should use custom theme in renderWithLayout", async () => {
      const content = buildPageContent("Themed");
      const layout = buildLayoutDecision();
      const customTheme = {
        ...GENSPARK_DESIGN_SYSTEM,
        backgroundColor: "#123456",
      };

      const pptx = createMockPptx();
      const mockSlide = createMockSlide();
      pptx.addSlide.mockReturnValue(mockSlide);

      await service.renderWithLayout(pptx as any, content, layout, {
        theme: customTheme,
      });

      expect(mockSlide.background).toBeDefined();
    });

    it("should create a slide and add it to pptx", async () => {
      const content = buildPageContent("Slide");
      const layout = buildLayoutDecision();

      const pptx = createMockPptx();
      pptx.addSlide.mockReturnValue(createMockSlide());

      await service.renderWithLayout(pptx as any, content, layout);

      expect(pptx.addSlide).toHaveBeenCalledTimes(1);
    });

    it("should render sections with provided layout placements", async () => {
      const content = buildPageContent("Placed Slide", [
        makeStatSection("100", "Count"),
      ]);
      const layout = buildLayoutDecision({
        sectionPlacements: [buildSectionPlacement(0, "card")],
      });

      const pptx = createMockPptx();
      const mockSlide = createMockSlide();
      pptx.addSlide.mockReturnValue(mockSlide);

      const result = await service.renderWithLayout(
        pptx as any,
        content,
        layout,
      );

      expect(result.renderedSections).toBe(1);
    });
  });

  // ============================================================
  // Background rendering
  // ============================================================

  describe("background rendering", () => {
    it("should set slide background color from theme", async () => {
      const content = buildPageContent("BG Test");
      layoutOptimizer.optimize.mockReturnValue(buildLayoutDecision());

      const pptx = createMockPptx();
      const mockSlide = createMockSlide();
      pptx.addSlide.mockReturnValue(mockSlide);

      await service.render(pptx as any, content);

      expect(mockSlide.background).toBeDefined();
      expect(mockSlide.background.color).toBeTruthy();
    });

    it("should strip # from hex color for pptx compatibility", async () => {
      const content = buildPageContent("Color Test");
      const theme = { ...GENSPARK_DESIGN_SYSTEM, backgroundColor: "#0F172A" };
      layoutOptimizer.optimize.mockReturnValue(buildLayoutDecision());

      const pptx = createMockPptx();
      const mockSlide = createMockSlide();
      pptx.addSlide.mockReturnValue(mockSlide);

      await service.render(pptx as any, content, { theme });

      expect(mockSlide.background.color).toBe("0F172A");
    });
  });

  // ============================================================
  // Chart with no title
  // ============================================================

  describe("chart without title", () => {
    it("should render chart without title text", async () => {
      const content = buildPageContent("Chart No Title", [
        {
          type: "chart",
          position: "full",
          content: {
            type: "bar",
            data: [{ name: "A", value: 5 }],
            title: undefined,
          } as any,
        },
      ]);
      const layout = buildLayoutDecision({
        sectionPlacements: [buildSectionPlacement(0)],
      });
      layoutOptimizer.optimize.mockReturnValue(layout);

      const pptx = createMockPptx();
      const mockSlide = createMockSlide();
      pptx.addSlide.mockReturnValue(mockSlide);

      const result = await service.render(pptx as any, content);

      expect(result.renderedSections).toBe(1);
      // addChart still called but no title text added before it
      expect(mockSlide.addChart).toHaveBeenCalled();
    });
  });
});

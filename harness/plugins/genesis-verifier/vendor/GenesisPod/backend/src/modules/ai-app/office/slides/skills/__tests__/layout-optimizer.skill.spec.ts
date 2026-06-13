/**
 * LayoutOptimizerSkill Unit Tests
 *
 * Tests for layout optimization skill - converts PageContent into
 * LayoutDecision objects describing grid configuration and section placements.
 */

import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { LayoutOptimizerSkill } from "../layout-optimizer.skill";
import {
  ContentAnalyzerSkill,
  ContentAnalysisResult,
  RecommendedLayout,
} from "../content-analyzer.skill";
import { PageContent, ContentSection } from "../../checkpoint/checkpoint.types";
import type { SkillContext } from "@/modules/ai-harness/facade";

// ============================================================================
// Helpers
// ============================================================================

function makeContext(id = "exec-layout-001"): SkillContext {
  return {
    executionId: id,
    skillId: "slides-layout-optimizer",
    createdAt: new Date(),
  };
}

function makeContent(sections?: ContentSection[]): PageContent {
  return {
    title: "Test Page",
    subtitle: "Test subtitle",
    sections: sections ?? [
      { type: "text", position: "left", content: "Main content" },
    ],
  };
}

function makeAnalysisResult(
  overrides?: Partial<ContentAnalysisResult>,
): ContentAnalysisResult {
  return {
    // Content type distribution
    sectionTypes: { stat: 0, list: 1, text: 2, chart: 0, image: 0, quote: 0 },
    // Content quantity
    totalSections: 3,
    totalCharacters: 500,
    averageSectionLength: 167,
    maxSectionLength: 300,
    minSectionLength: 50,
    // Logical structure
    comparison: {
      detected: false,
      count: 0,
      type: "none",
      dimensions: [],
    },
    pillars: {
      detected: false,
      count: 3,
      titles: [],
      hasHierarchy: false,
    },
    timeline: {
      detected: false,
      nodeCount: 0,
      hasSequence: false,
    },
    // Data density
    dataDensity: {
      dataPointCount: 0,
      numericDensity: 0,
      percentageCount: 0,
      currencyCount: 0,
      hasKeyInsight: false,
      keyInsights: [],
    },
    // Visual suggestions
    visualComplexity: "moderate",
    recommendedLayout: "content-flow" as RecommendedLayout,
    // Grid suggestion
    suggestedGrid: { columns: 2, rows: 2, reason: "Default grid" },
    // Capacity estimation
    estimatedCapacity: {
      fitsOnOnePage: true,
      suggestedPageCount: 1,
      overflowSections: 0,
    },
    // Metadata
    analyzedAt: new Date(),
    analysisVersion: "4.0.0",
    ...overrides,
  };
}

// ============================================================================
// Mock ContentAnalyzer
// ============================================================================

function makeMockContentAnalyzer(): jest.Mocked<ContentAnalyzerSkill> {
  return {
    analyze: jest.fn().mockReturnValue(makeAnalysisResult()),
    execute: jest.fn(),
    id: "slides-content-analyzer",
    name: "内容分析",
    description: "分析内容特征",
    layer: "analysis",
    domain: "slides",
    tags: [],
    version: "1.0.0",
  } as unknown as jest.Mocked<ContentAnalyzerSkill>;
}

// ============================================================================
// Tests
// ============================================================================

describe("LayoutOptimizerSkill", () => {
  let skill: LayoutOptimizerSkill;
  let mockContentAnalyzer: jest.Mocked<ContentAnalyzerSkill>;

  beforeEach(() => {
    mockContentAnalyzer = makeMockContentAnalyzer();
    skill = new LayoutOptimizerSkill(mockContentAnalyzer);
  });

  // --------------------------------------------------------------------------
  // ISkill interface properties
  // --------------------------------------------------------------------------

  describe("ISkill interface properties", () => {
    it("should have correct id", () => {
      expect(skill.id).toBe("slides-layout-optimizer");
    });

    it("should have correct name", () => {
      expect(skill.name).toBe("布局优化");
    });

    it("should have correct domain", () => {
      expect(skill.domain).toBe("slides");
    });

    it("should have version", () => {
      expect(skill.version).toBe("4.0.0");
    });

    it("should have correct tags", () => {
      expect(skill.tags).toContain("slides");
      expect(skill.tags).toContain("layout");
    });
  });

  // --------------------------------------------------------------------------
  // execute() - input validation
  // --------------------------------------------------------------------------

  describe("execute() - input validation", () => {
    it("should return failure when content title is missing", async () => {
      const input = { sections: [] } as unknown as PageContent;

      const result = await skill.execute(input, makeContext());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("INVALID_INPUT");
      expect(result.error?.retryable).toBe(false);
    });

    it("should return failure for empty orchestrator input", async () => {
      const orchestratorInput = {
        task: "optimize",
        context: {},
      };

      const result = await skill.execute(
        orchestratorInput as unknown as PageContent,
        makeContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("INVALID_INPUT");
    });

    it("should include executionId in metadata on failure", async () => {
      const input = {} as PageContent;
      const ctx = makeContext("exec-fail-test");

      const result = await skill.execute(input, ctx);

      expect(result.metadata?.executionId).toBe("exec-fail-test");
    });
  });

  // --------------------------------------------------------------------------
  // execute() - success paths
  // --------------------------------------------------------------------------

  describe("execute() - success paths", () => {
    it("should return success with LayoutDecision data", async () => {
      const result = await skill.execute(makeContent(), makeContext());

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.layoutType).toBeTruthy();
      expect(result.data?.gridConfig).toBeDefined();
      expect(result.data?.sectionPlacements).toBeInstanceOf(Array);
      expect(result.data?.hierarchy).toBeDefined();
      expect(result.data?.titleArea).toBeDefined();
      expect(result.data?.footerArea).toBeDefined();
      expect(typeof result.data?.needsSplit).toBe("boolean");
    });

    it("should include execution timing metadata", async () => {
      const result = await skill.execute(makeContent(), makeContext());

      expect(result.metadata?.startTime).toBeInstanceOf(Date);
      expect(result.metadata?.endTime).toBeInstanceOf(Date);
      expect(typeof result.metadata?.duration).toBe("number");
      expect(result.metadata.duration).toBeGreaterThanOrEqual(0);
    });

    it("should call contentAnalyzer.analyze with content", async () => {
      const content = makeContent();

      await skill.execute(content, makeContext());

      expect(mockContentAnalyzer.analyze).toHaveBeenCalledWith(content);
    });

    it("should extract PageContent from orchestrator context.input", async () => {
      const content = makeContent();
      const orchestratorInput = {
        task: "optimize",
        context: {
          input: content,
        },
        previousOutputs: {},
      };

      const result = await skill.execute(
        orchestratorInput as unknown as PageContent,
        makeContext(),
      );

      expect(result.success).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // optimize() - layout type dispatch
  // --------------------------------------------------------------------------

  describe("optimize() - layout type dispatch", () => {
    const layoutTestCases: Array<{
      layout: RecommendedLayout;
      analysisOverrides: Partial<ContentAnalysisResult>;
    }> = [
      {
        layout: "comparison-grid",
        analysisOverrides: {
          recommendedLayout: "comparison-grid",
          comparison: {
            detected: true,
            count: 3,
            type: "multi",
            dimensions: [],
          },
        },
      },
      {
        layout: "pillar-showcase",
        analysisOverrides: {
          recommendedLayout: "pillar-showcase",
          pillars: {
            detected: true,
            count: 3,
            titles: [],
            hasHierarchy: false,
          },
        },
      },
      {
        layout: "data-dashboard",
        analysisOverrides: {
          recommendedLayout: "data-dashboard",
          totalSections: 4,
        },
      },
      {
        layout: "timeline-progress",
        analysisOverrides: {
          recommendedLayout: "timeline-progress",
          timeline: { detected: true, nodeCount: 4, hasSequence: true },
        },
      },
      {
        layout: "content-flow",
        analysisOverrides: { recommendedLayout: "content-flow" },
      },
      {
        layout: "visual-story",
        analysisOverrides: { recommendedLayout: "visual-story" },
      },
      {
        layout: "insight-highlight",
        analysisOverrides: { recommendedLayout: "insight-highlight" },
      },
      {
        layout: "single-focus",
        analysisOverrides: { recommendedLayout: "single-focus" },
      },
    ];

    layoutTestCases.forEach(({ layout, analysisOverrides }) => {
      it(`should produce valid LayoutDecision for layout: ${layout}`, () => {
        mockContentAnalyzer.analyze.mockReturnValue(
          makeAnalysisResult(analysisOverrides),
        );

        const result = skill.optimize(makeContent());

        expect(result.layoutType).toBe(layout);
        expect(result.gridConfig.columns).toBeGreaterThanOrEqual(1);
        expect(result.gridConfig.rows).toBeGreaterThanOrEqual(1);
        expect(result.decidedAt).toBeInstanceOf(Date);
        expect(typeof result.reasoning).toBe("string");
      });
    });

    it("should use suggestedGrid as fallback for unknown layout type", () => {
      mockContentAnalyzer.analyze.mockReturnValue(
        makeAnalysisResult({
          recommendedLayout: "unknown-layout" as RecommendedLayout,
          suggestedGrid: { columns: 3, rows: 2 },
        }),
      );

      const result = skill.optimize(makeContent());

      expect(result.gridConfig.columns).toBe(3);
      expect(result.gridConfig.rows).toBe(2);
    });
  });

  // --------------------------------------------------------------------------
  // optimizeFromFeatures() - grid configuration details
  // --------------------------------------------------------------------------

  describe("optimizeFromFeatures() - grid configurations", () => {
    it("should set needsSplit=true when content does not fit on one page", () => {
      mockContentAnalyzer.analyze.mockReturnValue(
        makeAnalysisResult({
          estimatedCapacity: {
            fitsOnOnePage: false,
            suggestedPageCount: 2,
            overflowSections: 2,
          },
        }),
      );

      const result = skill.optimize(makeContent());

      expect(result.needsSplit).toBe(true);
      expect(result.splitSuggestion).toBeDefined();
    });

    it("should set needsSplit=false when content fits on one page", () => {
      mockContentAnalyzer.analyze.mockReturnValue(
        makeAnalysisResult({
          estimatedCapacity: {
            fitsOnOnePage: true,
            suggestedPageCount: 1,
            overflowSections: 0,
          },
        }),
      );

      const result = skill.optimize(makeContent());

      expect(result.needsSplit).toBe(false);
      expect(result.splitSuggestion).toBeUndefined();
    });

    it("should create comparison grid for 2 items", () => {
      mockContentAnalyzer.analyze.mockReturnValue(
        makeAnalysisResult({
          recommendedLayout: "comparison-grid",
          comparison: {
            detected: true,
            count: 2,
            type: "binary",
            dimensions: [],
          },
        }),
      );

      const result = skill.optimize(makeContent());

      expect(result.layoutType).toBe("comparison-grid");
      expect(result.gridConfig.columns).toBe(2);
    });

    it("should create comparison grid for 4 items (capped at 4)", () => {
      mockContentAnalyzer.analyze.mockReturnValue(
        makeAnalysisResult({
          recommendedLayout: "comparison-grid",
          comparison: {
            detected: true,
            count: 6,
            type: "multi",
            dimensions: [],
          },
        }),
      );

      const result = skill.optimize(makeContent());

      expect(result.gridConfig.columns).toBeLessThanOrEqual(4);
    });

    it("should create pillar grid for 3 pillars (single row)", () => {
      mockContentAnalyzer.analyze.mockReturnValue(
        makeAnalysisResult({
          recommendedLayout: "pillar-showcase",
          pillars: {
            detected: true,
            count: 3,
            titles: [],
            hasHierarchy: false,
          },
        }),
      );

      const result = skill.optimize(makeContent());

      expect(result.gridConfig.columns).toBe(3);
      expect(result.gridConfig.rows).toBe(1);
    });

    it("should create pillar grid for 6 pillars (two rows)", () => {
      mockContentAnalyzer.analyze.mockReturnValue(
        makeAnalysisResult({
          recommendedLayout: "pillar-showcase",
          pillars: {
            detected: true,
            count: 6,
            titles: [],
            hasHierarchy: false,
          },
        }),
      );

      const result = skill.optimize(makeContent());

      expect(result.gridConfig.rows).toBe(2);
    });

    it("should create pillar grid for 9 pillars (3 cols, multi rows)", () => {
      mockContentAnalyzer.analyze.mockReturnValue(
        makeAnalysisResult({
          recommendedLayout: "pillar-showcase",
          pillars: {
            detected: true,
            count: 9,
            titles: [],
            hasHierarchy: false,
          },
        }),
      );

      const result = skill.optimize(makeContent());

      expect(result.gridConfig.columns).toBe(3);
      expect(result.gridConfig.rows).toBeGreaterThan(2);
    });

    it("should create dashboard grid for 2 sections (2x1)", () => {
      mockContentAnalyzer.analyze.mockReturnValue(
        makeAnalysisResult({
          recommendedLayout: "data-dashboard",
          totalSections: 2,
        }),
      );

      const result = skill.optimize(makeContent());

      expect(result.gridConfig.columns).toBe(2);
      expect(result.gridConfig.rows).toBe(1);
    });

    it("should create dashboard grid for 4 sections (2x2)", () => {
      mockContentAnalyzer.analyze.mockReturnValue(
        makeAnalysisResult({
          recommendedLayout: "data-dashboard",
          totalSections: 4,
        }),
      );

      const result = skill.optimize(makeContent());

      expect(result.gridConfig.columns).toBe(2);
      expect(result.gridConfig.rows).toBe(2);
    });

    it("should create dashboard grid for 5+ sections (3x2)", () => {
      mockContentAnalyzer.analyze.mockReturnValue(
        makeAnalysisResult({
          recommendedLayout: "data-dashboard",
          totalSections: 6,
        }),
      );

      const result = skill.optimize(makeContent());

      expect(result.gridConfig.columns).toBe(3);
      expect(result.gridConfig.rows).toBe(2);
    });

    it("should create timeline grid for 5 nodes (single row)", () => {
      mockContentAnalyzer.analyze.mockReturnValue(
        makeAnalysisResult({
          recommendedLayout: "timeline-progress",
          timeline: { detected: true, nodeCount: 5, hasSequence: true },
        }),
      );

      const result = skill.optimize(makeContent());

      expect(result.gridConfig.columns).toBe(5);
      expect(result.gridConfig.rows).toBe(1);
    });

    it("should create timeline grid for 6+ nodes (double row)", () => {
      mockContentAnalyzer.analyze.mockReturnValue(
        makeAnalysisResult({
          recommendedLayout: "timeline-progress",
          timeline: { detected: true, nodeCount: 8, hasSequence: true },
        }),
      );

      const result = skill.optimize(makeContent());

      expect(result.gridConfig.rows).toBe(2);
    });
  });

  // --------------------------------------------------------------------------
  // Section placements
  // --------------------------------------------------------------------------

  describe("section placements", () => {
    it("should create section placements for each section", () => {
      const sections: ContentSection[] = [
        { type: "text", position: "left", content: "A" },
        { type: "text", position: "center", content: "B" },
        { type: "text", position: "right", content: "C" },
      ];

      mockContentAnalyzer.analyze.mockReturnValue(
        makeAnalysisResult({
          totalSections: 3,
          pillars: {
            detected: true,
            count: 3,
            titles: [],
            hasHierarchy: false,
          },
          recommendedLayout: "pillar-showcase",
        }),
      );

      const result = skill.optimize(makeContent(sections));

      expect(result.sectionPlacements).toBeInstanceOf(Array);
      result.sectionPlacements.forEach((placement) => {
        expect(placement.gridArea).toBeDefined();
        expect(typeof placement.sectionIndex).toBe("number");
        expect(placement.priority).toBeGreaterThanOrEqual(0);
      });
    });

    it("should handle empty sections array", () => {
      mockContentAnalyzer.analyze.mockReturnValue(
        makeAnalysisResult({ totalSections: 0 }),
      );

      const result = skill.optimize(makeContent([]));

      expect(result.sectionPlacements).toBeInstanceOf(Array);
    });
  });

  // --------------------------------------------------------------------------
  // Visual hierarchy
  // --------------------------------------------------------------------------

  describe("visual hierarchy", () => {
    it("should return hierarchy with primaryFocus property", () => {
      const result = skill.optimize(makeContent());

      expect(result.hierarchy).toBeDefined();
      expect(result.hierarchy.secondaryItems).toBeInstanceOf(Array);
      expect(result.hierarchy.supportingItems).toBeInstanceOf(Array);
    });
  });

  // --------------------------------------------------------------------------
  // Title and footer areas
  // --------------------------------------------------------------------------

  describe("title and footer areas", () => {
    it("should configure title area with heightRatio", () => {
      const result = skill.optimize(makeContent());

      expect(result.titleArea.show).toBe(true);
      expect(result.titleArea.heightRatio).toBeGreaterThan(0);
      expect(["left", "center", "right"]).toContain(result.titleArea.alignment);
    });

    it("should configure footer area", () => {
      const result = skill.optimize(makeContent());

      expect(typeof result.footerArea.show).toBe("boolean");
      expect(result.footerArea.heightRatio).toBeGreaterThanOrEqual(0);
    });
  });

  // --------------------------------------------------------------------------
  // Error handling
  // --------------------------------------------------------------------------

  describe("execute() - error handling", () => {
    it("should return LAYOUT_OPTIMIZATION_FAILED when optimize throws", async () => {
      mockContentAnalyzer.analyze.mockImplementation(() => {
        throw new Error("Analysis failed");
      });

      const result = await skill.execute(makeContent(), makeContext());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("LAYOUT_OPTIMIZATION_FAILED");
      expect(result.error?.retryable).toBe(true);
    });

    it("should include stack in error details when Error thrown", async () => {
      const err = new Error("Stack error");
      err.stack = "Error: Stack error\n  at test:1:1";
      mockContentAnalyzer.analyze.mockImplementation(() => {
        throw err;
      });

      const result = await skill.execute(makeContent(), makeContext());

      expect(result.success).toBe(false);
      expect(result.error?.details).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // Grid column widths always sum to ~1
  // --------------------------------------------------------------------------

  describe("grid config column widths", () => {
    const layoutTypes: Array<{
      layout: RecommendedLayout;
      overrides: Partial<ContentAnalysisResult>;
    }> = [
      {
        layout: "comparison-grid",
        overrides: {
          comparison: {
            detected: true,
            count: 3,
            type: "multi",
            dimensions: [],
          },
        },
      },
      {
        layout: "pillar-showcase",
        overrides: {
          pillars: {
            detected: true,
            count: 4,
            titles: [],
            hasHierarchy: false,
          },
        },
      },
      { layout: "data-dashboard", overrides: { totalSections: 3 } },
    ];

    layoutTypes.forEach(({ layout, overrides }) => {
      it(`should have column widths that sum to ~1 for ${layout}`, () => {
        mockContentAnalyzer.analyze.mockReturnValue(
          makeAnalysisResult({ recommendedLayout: layout, ...overrides }),
        );

        const result = skill.optimize(makeContent());
        const sum = result.gridConfig.columnWidths.reduce((a, b) => a + b, 0);

        expect(sum).toBeCloseTo(1, 1);
      });
    });
  });
});

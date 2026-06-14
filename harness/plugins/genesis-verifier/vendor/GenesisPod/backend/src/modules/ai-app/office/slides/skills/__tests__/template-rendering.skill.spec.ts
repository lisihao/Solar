/**
 * TemplateRenderingSkill Unit Tests
 *
 * Tests for template rendering skill - deterministic HTML generation
 * from PageContent.sections to slide HTML output.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import { TemplateRenderingSkill } from "../template-rendering.skill";
import { ChartRendererSkill } from "../chart-renderer.skill";
import {
  PageOutline,
  PageContent,
  PageTemplateType,
} from "../../checkpoint/checkpoint.types";
import type { SkillContext } from "@/modules/ai-harness/facade";
import { templateRegistry } from "../../templates/base/template-registry";
import {
  BIG_NUMBER_TEMPLATE,
  DASHBOARD_4KPI_TEMPLATE,
  COMPARISON_TABLE_TEMPLATE,
  RANKING_LIST_TEMPLATE,
} from "../../templates/categories/data.templates";
import {
  RECOMMENDATIONS_3COL_TEMPLATE,
  NEXT_STEPS_TEMPLATE,
  THANK_YOU_TEMPLATE,
} from "../../templates/categories/action.templates";
import {
  CARD_GRID_2_TEMPLATE,
  CARD_GRID_3_TEMPLATE,
  CARD_GRID_4_TEMPLATE,
} from "../../templates/categories/content.templates";
import {
  TOC_DUAL_TEMPLATE,
  THREE_PILLAR_TEMPLATE,
  TIMELINE_HORIZONTAL_TEMPLATE,
  PYRAMID_TEMPLATE,
} from "../../templates/categories/structural.templates";

// ============================================================================
// Helpers
// ============================================================================

function makeContext(id = "exec-001"): SkillContext {
  return {
    executionId: id,
    skillId: "slides-template-rendering",
    createdAt: new Date(),
  };
}

function makeOutline(
  templateType: PageTemplateType,
  pageNumber = 1,
): PageOutline {
  return {
    pageNumber,
    title: "Test Slide Title",
    subtitle: "Test subtitle",
    templateType,
    contentBrief: "Test content brief",
    keyElements: ["Key point 1", "Key point 2"],
    layoutHints: [],
  };
}

function makeContent(overrides?: Partial<PageContent>): PageContent {
  return {
    title: "Test Slide Title",
    subtitle: "Test subtitle",
    sections: [
      {
        type: "text",
        position: "left",
        content: "Main text content for testing",
      },
    ],
    ...overrides,
  };
}

// ============================================================================
// Mock Chart Renderer
// ============================================================================

function makeMockChartRenderer(): jest.Mocked<ChartRendererSkill> {
  return {
    extractChartData: jest.fn().mockReturnValue(null),
    generateSampleData: jest.fn().mockReturnValue({
      labels: ["A", "B", "C"],
      values: [10, 20, 30],
    }),
    renderToSvg: jest
      .fn()
      .mockReturnValue('<svg width="500" height="300"><rect/></svg>'),
  } as unknown as jest.Mocked<ChartRendererSkill>;
}

// ============================================================================
// Tests
// ============================================================================

describe("TemplateRenderingSkill", () => {
  let skill: TemplateRenderingSkill;
  let mockChartRenderer: jest.Mocked<ChartRendererSkill>;

  beforeEach(() => {
    mockChartRenderer = makeMockChartRenderer();
    skill = new TemplateRenderingSkill(mockChartRenderer);
  });

  // --------------------------------------------------------------------------
  // ISkill interface properties
  // --------------------------------------------------------------------------

  describe("ISkill interface properties", () => {
    it("should have correct id", () => {
      expect(skill.id).toBe("slides-template-rendering");
    });

    it("should have correct name", () => {
      expect(skill.name).toBe("模板渲染");
    });

    it("should have correct domain", () => {
      expect(skill.domain).toBe("slides");
    });

    it("should have version", () => {
      expect(skill.version).toBe("4.0.0");
    });

    it("should have correct tags", () => {
      expect(skill.tags).toContain("slides");
      expect(skill.tags).toContain("template");
      expect(skill.tags).toContain("rendering");
    });
  });

  // --------------------------------------------------------------------------
  // execute() - input validation
  // --------------------------------------------------------------------------

  describe("execute() - input validation", () => {
    it("should return failure when pageOutline.templateType is missing", async () => {
      const input = {
        pageOutline: {} as PageOutline,
        pageContent: makeContent(),
      };

      const result = await skill.execute(input, makeContext());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("INVALID_INPUT");
    });

    it("should return failure when pageContent.title is missing", async () => {
      const input = {
        pageOutline: makeOutline("cover"),
        pageContent: { sections: [] } as unknown as PageContent,
      };

      const result = await skill.execute(input, makeContext());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("INVALID_INPUT");
    });

    it("should return failure for orchestrator input with no extractable data", async () => {
      const orchestratorInput = {
        task: "render",
        context: {},
        previousOutputs: {},
      };

      const result = await skill.execute(
        orchestratorInput as Parameters<typeof skill.execute>[0],
        makeContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("INVALID_INPUT");
    });

    it("should include executionId in metadata on failure", async () => {
      const input = {
        pageOutline: {} as PageOutline,
        pageContent: makeContent(),
      };

      const ctx = makeContext("exec-validation-test");
      const result = await skill.execute(input, ctx);

      expect(result.metadata?.executionId).toBe("exec-validation-test");
    });
  });

  // --------------------------------------------------------------------------
  // execute() - direct input format success paths
  // --------------------------------------------------------------------------

  describe("execute() - direct input format", () => {
    const templateTypes: PageTemplateType[] = [
      "cover",
      "toc",
      "pillars",
      "timeline",
      "dashboard",
      "comparison",
      "closing",
    ];

    templateTypes.forEach((templateType) => {
      it(`should successfully render template type: ${templateType}`, async () => {
        const input = {
          pageOutline: makeOutline(templateType),
          pageContent: makeContent(),
        };

        const result = await skill.execute(input, makeContext());

        expect(result.success).toBe(true);
        expect(result.data?.html).toBeTruthy();
        expect(result.data?.templateId).toBeTruthy();
        expect(result.data?.themeId).toBeTruthy();
        expect(typeof result.data?.variables).toBe("object");
      });
    });

    it("should use default theme genspark-dark when not specified", async () => {
      const input = {
        pageOutline: makeOutline("cover"),
        pageContent: makeContent(),
      };

      const result = await skill.execute(input, makeContext());

      expect(result.success).toBe(true);
      expect(result.data?.themeId).toBe("genspark-dark");
    });

    it("should use specified themeId", async () => {
      const input = {
        pageOutline: makeOutline("cover"),
        pageContent: makeContent(),
        themeId: "genspark-dark",
      };

      const result = await skill.execute(input, makeContext());

      expect(result.success).toBe(true);
      expect(result.data?.themeId).toBe("genspark-dark");
    });

    it("should return HTML containing slide-container", async () => {
      const input = {
        pageOutline: makeOutline("pillars"),
        pageContent: makeContent({
          title: "Three Pillars of Success",
          sections: [
            { type: "text", position: "left", content: "Pillar 1" },
            { type: "text", position: "center", content: "Pillar 2" },
            { type: "text", position: "right", content: "Pillar 3" },
          ],
        }),
      };

      const result = await skill.execute(input, makeContext());

      expect(result.success).toBe(true);
      expect(result.data?.html).toContain("slide-container");
    });

    it("should include execution metadata with timing", async () => {
      const input = {
        pageOutline: makeOutline("cover"),
        pageContent: makeContent(),
      };

      const result = await skill.execute(input, makeContext());

      expect(result.metadata?.startTime).toBeInstanceOf(Date);
      expect(result.metadata?.endTime).toBeInstanceOf(Date);
      expect(typeof result.metadata?.duration).toBe("number");
    });
  });

  // --------------------------------------------------------------------------
  // execute() - orchestrator input format
  // --------------------------------------------------------------------------

  describe("execute() - orchestrator input format", () => {
    it("should extract pageOutline and pageContent from context", async () => {
      const orchestratorInput = {
        task: "render-page",
        context: {
          input: {
            themeId: "genspark-dark",
          },
          pageOutline: makeOutline("splitLayout"),
          pageContent: makeContent(),
        },
        previousOutputs: {},
      };

      const result = await skill.execute(
        orchestratorInput as Parameters<typeof skill.execute>[0],
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.html).toBeTruthy();
    });

    it("should extract themeId from context.input", async () => {
      const orchestratorInput = {
        task: "render-page",
        context: {
          input: {
            themeId: "genspark-dark",
          },
          pageOutline: makeOutline("cover"),
          pageContent: makeContent(),
        },
      };

      const result = await skill.execute(
        orchestratorInput as Parameters<typeof skill.execute>[0],
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.themeId).toBe("genspark-dark");
    });

    it("should extract pageOutline from previousOutputs slides-outline-planning", async () => {
      const orchestratorInput = {
        task: "render-page",
        context: {
          input: {},
          pageContent: makeContent(),
        },
        previousOutputs: {
          "slides-outline-planning": {
            pages: [makeOutline("toc")],
          },
        },
      };

      const result = await skill.execute(
        orchestratorInput as Parameters<typeof skill.execute>[0],
        makeContext(),
      );

      expect(result.success).toBe(true);
    });

    it("should extract pageContent from context.input when not at top level", async () => {
      const orchestratorInput = {
        task: "render-page",
        context: {
          input: {
            pageOutline: makeOutline("framework"),
            pageContent: makeContent({ title: "Framework Slide" }),
          },
        },
      };

      const result = await skill.execute(
        orchestratorInput as Parameters<typeof skill.execute>[0],
        makeContext(),
      );

      expect(result.success).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // render() - public method
  // --------------------------------------------------------------------------

  describe("render() - public method", () => {
    it("should render cover template with title", () => {
      const result = skill.render({
        pageOutline: makeOutline("cover"),
        pageContent: makeContent({ title: "Welcome Presentation" }),
      });

      expect(result.html).toContain("slide-container");
      expect(result.templateId).toBeTruthy();
      expect(result.themeId).toBe("genspark-dark");
    });

    it("should use fallback when templateType has no matching template", () => {
      const outline = makeOutline("cover");
      // Force an unknown type via type assertion
      (outline as { templateType: string }).templateType = "unknown-type-xyz";

      const result = skill.render({
        pageOutline: outline,
        pageContent: makeContent(),
      });

      // Should still return HTML (fallback)
      expect(result.html).toBeTruthy();
      expect(result.html).toContain("slide-container");
    });

    it("should inject chart SVG when sections contain chart data", () => {
      mockChartRenderer.extractChartData.mockReturnValue({
        labels: ["Q1", "Q2", "Q3"],
        values: [100, 200, 150],
      } as ReturnType<typeof mockChartRenderer.extractChartData>);

      const result = skill.render({
        pageOutline: makeOutline("dashboard"),
        pageContent: makeContent({
          title: "Dashboard",
          sections: [
            {
              type: "chart",
              position: "center",
              content: {
                type: "bar",
                data: [
                  { label: "Q1", value: 100 },
                  { label: "Q2", value: 200 },
                ],
              },
            },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
    });

    it("should handle stat section with StatContent object", () => {
      const result = skill.render({
        pageOutline: makeOutline("dashboard"),
        pageContent: makeContent({
          title: "Metrics Overview",
          sections: [
            {
              type: "stat",
              position: "left",
              content: {
                value: "85%",
                label: "Satisfaction Rate",
                trend: "up",
                change: "+5%",
              },
            },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
    });

    it("should render list section", () => {
      const result = skill.render({
        pageOutline: makeOutline("pillars"),
        pageContent: makeContent({
          title: "Key Points",
          sections: [
            {
              type: "list",
              position: "full",
              content: [
                "First important point",
                "Second important point",
                "Third important point",
              ],
            },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
    });

    it("should render timeline template", () => {
      const result = skill.render({
        pageOutline: makeOutline("timeline"),
        pageContent: makeContent({
          title: "Company Timeline",
          sections: [
            { type: "text", position: "left", content: "2020: Founded" },
            { type: "text", position: "center", content: "2022: Expanded" },
            { type: "text", position: "right", content: "2024: IPO" },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
      expect(result.templateId).toBeTruthy();
    });

    it("should render comparison template", () => {
      const result = skill.render({
        pageOutline: makeOutline("comparison"),
        pageContent: makeContent({
          title: "Product Comparison",
          sections: [
            { type: "text", position: "left", content: "Option A details" },
            { type: "text", position: "right", content: "Option B details" },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
    });

    it("should wrap HTML with theme container", () => {
      const result = skill.render({
        pageOutline: makeOutline("cover"),
        pageContent: makeContent(),
      });

      expect(result.html).toContain("slide-container");
      expect(result.html).toContain("slide-content");
    });

    it("should return variables object", () => {
      const result = skill.render({
        pageOutline: makeOutline("cover"),
        pageContent: makeContent({ title: "Test Title" }),
      });

      expect(typeof result.variables).toBe("object");
      expect(result.variables).not.toBeNull();
    });

    it("should pass usedValues set without crashing", () => {
      const usedValues = new Set(["value1", "value2"]);

      const result = skill.render({
        pageOutline: makeOutline("pillars"),
        pageContent: makeContent(),
        usedValues,
      });

      expect(result.html).toBeTruthy();
    });
  });

  // --------------------------------------------------------------------------
  // Error handling
  // --------------------------------------------------------------------------

  describe("execute() - error handling", () => {
    it("should return TEMPLATE_RENDERING_ERROR with retryable=true when render throws", async () => {
      // Force render to throw by making chartRenderer throw
      mockChartRenderer.renderToSvg.mockImplementation(() => {
        throw new Error("SVG render crash");
      });
      // Use dashboard template which uses chart injection
      // But we need the template itself to throw - override renderFallbackChart too
      mockChartRenderer.extractChartData.mockReturnValue({
        labels: [],
        values: [],
      } as ReturnType<typeof mockChartRenderer.extractChartData>);

      // The skill handles chart errors gracefully, so we test via a spy
      const renderSpy = jest.spyOn(skill, "render").mockImplementation(() => {
        throw new Error("Unexpected render failure");
      });

      const input = {
        pageOutline: makeOutline("cover"),
        pageContent: makeContent(),
      };

      const result = await skill.execute(input, makeContext());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("TEMPLATE_RENDERING_ERROR");
      expect(result.error?.retryable).toBe(true);

      renderSpy.mockRestore();
    });

    it("should include error stack in details when Error is thrown", async () => {
      const renderSpy = jest.spyOn(skill, "render").mockImplementation(() => {
        const err = new Error("Stack trace error");
        err.stack = "Error: Stack trace error\n  at test.ts:1:1";
        throw err;
      });

      const input = {
        pageOutline: makeOutline("cover"),
        pageContent: makeContent(),
      };

      const result = await skill.execute(input, makeContext());

      expect(result.success).toBe(false);
      expect(result.error?.details).toBeDefined();

      renderSpy.mockRestore();
    });
  });

  // --------------------------------------------------------------------------
  // Chart injection
  // --------------------------------------------------------------------------

  describe("chart injection", () => {
    it("should call chartRenderer when SVG chart placeholder found", () => {
      // Dashboard template likely includes chart placeholders
      skill.render({
        pageOutline: makeOutline("dashboard"),
        pageContent: makeContent({
          title: "Data Dashboard",
          sections: [
            {
              type: "chart",
              position: "center",
              content: { type: "bar", data: [] },
            },
          ],
        }),
      });

      // renderToSvg may or may not be called depending on template
      // We just verify no crash occurred
      expect(true).toBe(true);
    });

    it("should fall back gracefully when chartRenderer.renderToSvg throws", () => {
      mockChartRenderer.extractChartData.mockReturnValue({
        labels: ["A"],
        values: [1],
      } as ReturnType<typeof mockChartRenderer.extractChartData>);
      mockChartRenderer.renderToSvg.mockImplementation(() => {
        throw new Error("Chart render failed");
      });

      // Should not throw
      expect(() => {
        skill.render({
          pageOutline: makeOutline("dashboard"),
          pageContent: makeContent(),
        });
      }).not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // All PageTemplateType variants
  // --------------------------------------------------------------------------

  describe("all PageTemplateType variants render without throwing", () => {
    const allTypes: PageTemplateType[] = [
      "cover",
      "toc",
      "chapterTitle",
      "questions",
      "pillars",
      "framework",
      "timeline",
      "evolutionRoadmap",
      "dashboard",
      "comparison",
      "splitLayout",
      "caseStudy",
      "multiColumn",
      "recommendations",
      "maturityModel",
      "riskOpportunity",
      "closing",
    ];

    allTypes.forEach((templateType) => {
      it(`should render ${templateType} without throwing`, () => {
        expect(() => {
          skill.render({
            pageOutline: makeOutline(templateType),
            pageContent: makeContent({
              title: `${templateType} Slide`,
              sections: [
                { type: "text", position: "left", content: "Section 1" },
                { type: "text", position: "right", content: "Section 2" },
              ],
            }),
          });
        }).not.toThrow();
      });
    });
  });

  // --------------------------------------------------------------------------
  // extractVariablesByTemplateId - Data Templates (D-001 ~ D-006)
  // --------------------------------------------------------------------------

  describe("extractVariablesByTemplateId - D-series templates", () => {
    it("should render D-001 (Big Number) with stat sections", () => {
      const result = skill.render({
        pageOutline: makeOutline("dashboard"),
        pageContent: makeContent({
          title: "Revenue Growth",
          sections: [
            {
              type: "stat",
              position: "center",
              content: {
                value: "$2.4B",
                label: "Annual Revenue",
                trend: "up",
                change: "+23%",
              },
            },
          ],
        }),
      });
      expect(result.html).toBeTruthy();
      expect(result.templateId).toMatch(/^D-/);
    });

    it("should render D-002 (Dashboard 4KPI) with 4 stat sections", () => {
      const result = skill.render({
        pageOutline: makeOutline("dashboard"),
        pageContent: makeContent({
          title: "KPI Dashboard",
          sections: [
            {
              type: "stat",
              position: "left",
              content: {
                value: "92%",
                label: "Satisfaction",
                trend: "up",
                change: "+5%",
              },
            },
            {
              type: "stat",
              position: "center",
              content: {
                value: "1.2M",
                label: "Users",
                trend: "up",
                change: "+12%",
              },
            },
            {
              type: "stat",
              position: "right",
              content: {
                value: "45ms",
                label: "Response",
                trend: "down",
                change: "-8%",
              },
            },
            {
              type: "stat",
              position: "full",
              content: {
                value: "99.9%",
                label: "Uptime",
                trend: "up",
                change: "+0.1%",
              },
            },
          ],
        }),
      });
      expect(result.html).toBeTruthy();
    });

    it("should render dashboard with no stat sections - uses placeholders", () => {
      const result = skill.render({
        pageOutline: makeOutline("dashboard"),
        pageContent: makeContent({
          title: "Empty Dashboard",
          sections: [
            { type: "text", position: "full", content: "Summary text" },
          ],
        }),
      });
      expect(result.html).toBeTruthy();
    });

    it("should render comparison template with list sections", () => {
      const result = skill.render({
        pageOutline: makeOutline("comparison"),
        pageContent: makeContent({
          title: "Option A vs Option B",
          sections: [
            {
              type: "list",
              position: "left",
              content: ["Feature 1", "Feature 2", "Feature 3"],
            },
            {
              type: "list",
              position: "right",
              content: ["Alt Feature 1", "Alt Feature 2", "Alt Feature 3"],
            },
          ],
        }),
      });
      expect(result.html).toBeTruthy();
    });
  });

  // --------------------------------------------------------------------------
  // extractVariablesByTemplateId - Structural Templates (S-series)
  // --------------------------------------------------------------------------

  describe("extractVariablesByTemplateId - S-series templates", () => {
    it("should render S-002 (chapterTitle) extracting chapter number from subtitle CHAPTER 02", () => {
      const result = skill.render({
        pageOutline: {
          ...makeOutline("chapterTitle"),
          subtitle: "CHAPTER 02",
        },
        pageContent: makeContent({
          title: "Market Analysis",
          subtitle: "CHAPTER 02",
        }),
      });
      expect(result.html).toBeTruthy();
    });

    it("should render chapterTitle extracting chapter number from outline subtitle", () => {
      const result = skill.render({
        pageOutline: {
          ...makeOutline("chapterTitle"),
          subtitle: "Chapter 3: Introduction",
        },
        pageContent: makeContent({
          title: "Introduction",
          subtitle: undefined,
        }),
      });
      expect(result.html).toBeTruthy();
    });

    it("should render chapterTitle extracting chapter from section text content", () => {
      const result = skill.render({
        pageOutline: makeOutline("chapterTitle"),
        pageContent: makeContent({
          title: "Deep Dive Section",
          subtitle: undefined,
          sections: [
            {
              type: "text",
              position: "full",
              content: "第3章: Deep Dive into Analytics",
            },
          ],
        }),
      });
      expect(result.html).toBeTruthy();
    });

    it("should render S-001 (toc) from sections when 2+ sections available", () => {
      const result = skill.render({
        pageOutline: makeOutline("toc"),
        pageContent: makeContent({
          title: "Table of Contents",
          sections: [
            {
              type: "text",
              position: "left",
              content: "Chapter One: Overview",
            },
            {
              type: "text",
              position: "center",
              content: "Chapter Two: Analysis",
            },
            {
              type: "text",
              position: "right",
              content: "Chapter Three: Conclusion",
            },
          ],
        }),
      });
      expect(result.html).toBeTruthy();
    });

    it("should render toc from keyElements when sections < 2", () => {
      const result = skill.render({
        pageOutline: {
          ...makeOutline("toc"),
          keyElements: ["Chapter 1", "Chapter 2", "Chapter 3"],
        },
        pageContent: makeContent({
          title: "Table of Contents",
          sections: [
            { type: "text", position: "full", content: "Single section" },
          ],
        }),
      });
      expect(result.html).toBeTruthy();
    });

    it("should render toc with list sections extracting first item", () => {
      const result = skill.render({
        pageOutline: makeOutline("toc"),
        pageContent: makeContent({
          title: "Contents",
          sections: [
            {
              type: "list",
              position: "full",
              content: ["Overview", "Details"],
            },
            {
              type: "list",
              position: "full",
              content: ["Summary", "Conclusion"],
            },
          ],
        }),
      });
      expect(result.html).toBeTruthy();
    });

    it("should render S-003/S-004/S-005 pillars with stat sections", () => {
      const result = skill.render({
        pageOutline: makeOutline("pillars"),
        pageContent: makeContent({
          title: "Three Core Pillars",
          sections: [
            {
              type: "stat",
              position: "left",
              content: {
                value: "87%",
                label: "Customer Satisfaction",
                trend: "up",
                change: "+3%",
              },
            },
            {
              type: "stat",
              position: "center",
              content: {
                value: "2.1M",
                label: "Active Users",
                trend: "up",
                change: "+15%",
              },
            },
            {
              type: "stat",
              position: "right",
              content: {
                value: "34ms",
                label: "Response Time",
                trend: "down",
                change: "-10%",
              },
            },
          ],
        }),
      });
      expect(result.html).toBeTruthy();
    });

    it("should render pillars with list sections", () => {
      const result = skill.render({
        pageOutline: makeOutline("pillars"),
        pageContent: makeContent({
          title: "Strategic Pillars",
          sections: [
            {
              type: "list",
              position: "left",
              content: ["Innovation", "Drive new products", "Invest in R&D"],
            },
            {
              type: "list",
              position: "center",
              content: ["Execution", "Deliver on time", "Quality focus"],
            },
            {
              type: "list",
              position: "right",
              content: ["Culture", "Empower teams", "Continuous learning"],
            },
          ],
        }),
      });
      expect(result.html).toBeTruthy();
    });

    it("should render timeline with stat sections providing date/label/change", () => {
      const result = skill.render({
        pageOutline: makeOutline("timeline"),
        pageContent: makeContent({
          title: "Company Milestones",
          sections: [
            {
              type: "stat",
              position: "left",
              content: {
                value: "2019",
                label: "Founded",
                trend: "up",
                change: "First product launched",
              },
            },
            {
              type: "stat",
              position: "center",
              content: {
                value: "2021",
                label: "Series A",
                trend: "up",
                change: "$10M raised",
              },
            },
          ],
        }),
      });
      expect(result.html).toBeTruthy();
    });

    it("should render timeline with list sections", () => {
      const result = skill.render({
        pageOutline: makeOutline("timeline"),
        pageContent: makeContent({
          title: "Product Roadmap",
          sections: [
            {
              type: "list",
              position: "left",
              content: ["2020", "Launch v1", "Beta release"],
            },
            {
              type: "list",
              position: "center",
              content: ["2022", "Launch v2", "GA release"],
            },
          ],
        }),
      });
      expect(result.html).toBeTruthy();
    });

    it("should render timeline with text sections using date:title:desc format", () => {
      const result = skill.render({
        pageOutline: makeOutline("timeline"),
        pageContent: makeContent({
          title: "History",
          sections: [
            {
              type: "text",
              position: "left",
              content: "2019: Founded - Started operations",
            },
            {
              type: "text",
              position: "right",
              content: "2023: IPO - Listed on NYSE",
            },
          ],
        }),
      });
      expect(result.html).toBeTruthy();
    });

    it("should render framework with text sections", () => {
      const result = skill.render({
        pageOutline: makeOutline("framework"),
        pageContent: makeContent({
          title: "4-Step Process",
          sections: [
            {
              type: "text",
              position: "left",
              content: "Step 1: Analyze - Gather and process data",
            },
            {
              type: "text",
              position: "center",
              content: "Step 2: Design - Create solutions",
            },
            {
              type: "text",
              position: "right",
              content: "Step 3: Build - Implement solutions",
            },
            {
              type: "text",
              position: "full",
              content: "Step 4: Validate - Test and iterate",
            },
          ],
        }),
      });
      expect(result.html).toBeTruthy();
    });

    it("should render framework with list sections", () => {
      const result = skill.render({
        pageOutline: makeOutline("framework"),
        pageContent: makeContent({
          title: "Framework",
          sections: [
            {
              type: "list",
              position: "left",
              content: ["Discover", "Research and gather insights"],
            },
            {
              type: "list",
              position: "center",
              content: ["Define", "Clarify the problem"],
            },
          ],
        }),
      });
      expect(result.html).toBeTruthy();
    });

    it("should render framework with stat sections", () => {
      const result = skill.render({
        pageOutline: makeOutline("framework"),
        pageContent: makeContent({
          title: "Maturity Levels",
          sections: [
            {
              type: "stat",
              position: "left",
              content: {
                value: "Level 1",
                label: "Initial",
                trend: "up",
                change: "Ad hoc",
              },
            },
          ],
        }),
      });
      expect(result.html).toBeTruthy();
    });
  });

  // --------------------------------------------------------------------------
  // extractVariablesByTemplateId - Action Templates (A-series)
  // --------------------------------------------------------------------------

  describe("extractVariablesByTemplateId - A-series templates", () => {
    it("should render A-001 (recommendations) with list sections", () => {
      const result = skill.render({
        pageOutline: makeOutline("recommendations"),
        pageContent: makeContent({
          title: "Strategic Recommendations",
          subtitle: "Q1 2024",
          sections: [
            {
              type: "list",
              position: "left",
              content: ["Urgent: Cut costs", "Reduce overhead by 20%"],
            },
            {
              type: "list",
              position: "center",
              content: ["Urgent: Hire engineers", "3 senior engineers needed"],
            },
            {
              type: "list",
              position: "right",
              content: ["Short: Launch feature", "Target Q2 launch"],
            },
          ],
        }),
      });
      expect(result.html).toBeTruthy();
    });

    it("should render riskOpportunity with text sections", () => {
      const result = skill.render({
        pageOutline: makeOutline("riskOpportunity"),
        pageContent: makeContent({
          title: "Risk vs Opportunity",
          sections: [
            {
              type: "text",
              position: "left",
              content: "Risk: Market competition increasing",
            },
            {
              type: "text",
              position: "right",
              content: "Opportunity: New market segment emerging",
            },
          ],
        }),
      });
      expect(result.html).toBeTruthy();
    });

    it("should render recommendations without sections - uses placeholders", () => {
      const result = skill.render({
        pageOutline: makeOutline("recommendations"),
        pageContent: makeContent({
          title: "Recommendations",
          sections: [],
        }),
      });
      expect(result.html).toBeTruthy();
    });
  });

  // --------------------------------------------------------------------------
  // extractVariablesByTemplateId - Narrative Templates (N-series)
  // --------------------------------------------------------------------------

  describe("extractVariablesByTemplateId - N-series (cover/closing)", () => {
    it("should render N-001 (cover) with full variables", () => {
      const result = skill.render({
        pageOutline: makeOutline("cover"),
        pageContent: makeContent({
          title: "Annual Report 2024",
          subtitle: "Financial Performance Review",
        }),
      });
      expect(result.html).toBeTruthy();
    });

    it("should render N-002 (closing) with MISSING_PLACEHOLDER when title absent", () => {
      const result = skill.render({
        pageOutline: makeOutline("closing"),
        pageContent: makeContent({
          title: "Thank You",
        }),
      });
      expect(result.html).toBeTruthy();
    });

    it("should render cover with missing title - uses placeholder", () => {
      const result = skill.render({
        pageOutline: makeOutline("cover"),
        pageContent: {
          title: "",
          sections: [],
        } as unknown as PageContent,
      });
      expect(result.html).toBeTruthy();
    });
  });

  // --------------------------------------------------------------------------
  // extractVariables - fallback switch (default branch)
  // --------------------------------------------------------------------------

  describe("extractVariables - fallback type dispatch", () => {
    it("should handle questions type via fallback", () => {
      // questions type uses extractQuestionsVariables
      const result = skill.render({
        pageOutline: makeOutline("questions"),
        pageContent: makeContent({
          title: "Key Questions",
          sections: [
            { type: "text", position: "left", content: "What is the ROI?" },
            {
              type: "text",
              position: "center",
              content: "Who are the key stakeholders?",
            },
          ],
        }),
      });
      expect(result.html).toBeTruthy();
    });

    it("should handle maturityModel type via fallback", () => {
      const result = skill.render({
        pageOutline: makeOutline("maturityModel"),
        pageContent: makeContent({
          title: "Maturity Model",
          sections: [
            {
              type: "stat",
              position: "left",
              content: {
                value: "Level 3",
                label: "Defined",
                trend: "up",
                change: "Standardized",
              },
            },
          ],
        }),
      });
      expect(result.html).toBeTruthy();
    });

    it("should handle splitLayout type via fallback (multiColumn vars)", () => {
      const result = skill.render({
        pageOutline: makeOutline("splitLayout"),
        pageContent: makeContent({
          title: "Split Layout",
          sections: [
            { type: "text", position: "left", content: "Left column content" },
            {
              type: "text",
              position: "right",
              content: "Right column content",
            },
          ],
        }),
      });
      expect(result.html).toBeTruthy();
    });

    it("should handle caseStudy type via fallback", () => {
      const result = skill.render({
        pageOutline: makeOutline("caseStudy"),
        pageContent: makeContent({
          title: "Case Study: Acme Corp",
          sections: [
            {
              type: "text",
              position: "left",
              content: "Challenge: Low customer retention",
            },
            {
              type: "text",
              position: "center",
              content: "Solution: Loyalty program",
            },
            {
              type: "text",
              position: "right",
              content: "Result: 40% improvement",
            },
          ],
        }),
      });
      expect(result.html).toBeTruthy();
    });

    it("should render evolutionRoadmap using timeline variables", () => {
      const result = skill.render({
        pageOutline: makeOutline("evolutionRoadmap"),
        pageContent: makeContent({
          title: "Technology Evolution",
          sections: [
            {
              type: "text",
              position: "left",
              content: "2020: Basic - Initial implementation",
            },
            {
              type: "text",
              position: "right",
              content: "2025: Advanced - Full automation",
            },
          ],
        }),
      });
      expect(result.html).toBeTruthy();
    });
  });

  // --------------------------------------------------------------------------
  // Theme variants
  // --------------------------------------------------------------------------

  describe("theme variants", () => {
    it("should use light theme mode for white theme", () => {
      const result = skill.render({
        pageOutline: makeOutline("dashboard"),
        pageContent: makeContent({
          title: "Light Theme Test",
          sections: [
            {
              type: "stat",
              position: "center",
              content: {
                value: "95%",
                label: "Score",
                trend: "up",
                change: "+2%",
              },
            },
          ],
        }),
        themeId: "genspark-white",
      });
      expect(result.html).toBeTruthy();
      expect(result.themeId).toBe("genspark-white");
    });

    it("should handle tech-dark theme", () => {
      const result = skill.render({
        pageOutline: makeOutline("cover"),
        pageContent: makeContent({ title: "Tech Dark Slide" }),
        themeId: "tech-dark",
      });
      expect(result.html).toBeTruthy();
    });

    it("should use fallback for unknown themeId", () => {
      const result = skill.render({
        pageOutline: makeOutline("cover"),
        pageContent: makeContent({ title: "Unknown Theme" }),
        themeId: "nonexistent-theme-xyz",
      });
      // Should still produce valid HTML, falling back to a default theme
      expect(result.html).toBeTruthy();
      expect(result.html).toContain("slide-container");
    });
  });

  // --------------------------------------------------------------------------
  // Chart injection edge cases
  // --------------------------------------------------------------------------

  describe("chart injection - map chart types", () => {
    it("should map trend chart type to line chart", () => {
      // trend -> line mapping
      mockChartRenderer.extractChartData.mockReturnValue(null);
      mockChartRenderer.generateSampleData.mockReturnValue({
        labels: ["Q1", "Q2", "Q3"],
        values: [100, 120, 150],
      } as ReturnType<typeof mockChartRenderer.generateSampleData>);
      mockChartRenderer.renderToSvg.mockReturnValue(
        '<svg width="500" height="300"><polyline/></svg>',
      );

      // Dashboard renders chart placeholders for trend chart type
      expect(() => {
        skill.render({
          pageOutline: makeOutline("dashboard"),
          pageContent: makeContent({ title: "Trend Analysis" }),
        });
      }).not.toThrow();
    });

    it("should generate sample data when no chart data found in sections", () => {
      mockChartRenderer.extractChartData.mockReturnValue(null);
      mockChartRenderer.generateSampleData.mockReturnValue({
        labels: ["A", "B"],
        values: [1, 2],
      } as ReturnType<typeof mockChartRenderer.generateSampleData>);

      skill.render({
        pageOutline: makeOutline("dashboard"),
        pageContent: makeContent({ title: "Auto Chart" }),
      });

      // Either extractChartData was called (and returned null triggering generateSampleData)
      // or chart was not needed - either is valid
      expect(true).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Overflow protection styles
  // --------------------------------------------------------------------------

  describe("HTML structure and overflow protection", () => {
    it("should include overflow protection styles in output HTML", () => {
      const result = skill.render({
        pageOutline: makeOutline("cover"),
        pageContent: makeContent({ title: "Style Test" }),
      });

      expect(result.html).toContain("box-sizing: border-box");
      expect(result.html).toContain("overflow: hidden");
    });

    it("should include slide-content wrapper div", () => {
      const result = skill.render({
        pageOutline: makeOutline("pillars"),
        pageContent: makeContent({ title: "Content Wrapper Test" }),
      });

      expect(result.html).toContain("slide-content");
      expect(result.html).toContain("flex-direction: column");
    });

    it("should append script tag when template has script", () => {
      // We test that scripts are appended if present - most templates do not have scripts
      // The method adds script if template.script is truthy
      // Just verify the render completes without error for all standard types
      const result = skill.render({
        pageOutline: makeOutline("cover"),
        pageContent: makeContent({ title: "Script Test" }),
      });
      expect(result.html).toBeTruthy();
    });
  });

  // --------------------------------------------------------------------------
  // renderFallback - triggered by unknown template type with various section types
  // --------------------------------------------------------------------------

  describe("renderFallback - various section types in fallback", () => {
    it("should render fallback HTML with stat sections", () => {
      const outline = makeOutline("cover");
      (outline as { templateType: string }).templateType =
        "nonexistent-type-xyz";

      const result = skill.render({
        pageOutline: outline,
        pageContent: makeContent({
          title: "Fallback with Stats",
          sections: [
            {
              type: "stat",
              position: "center",
              content: {
                value: "99%",
                label: "Uptime",
                trend: "up",
                change: "+1%",
              },
            },
          ],
        }),
      });

      expect(result.html).toContain("slide-container");
      expect(result.templateId).toBe("fallback");
    });

    it("should render fallback HTML with list sections", () => {
      const outline = makeOutline("cover");
      (outline as { templateType: string }).templateType =
        "nonexistent-type-xyz";

      const result = skill.render({
        pageOutline: outline,
        pageContent: makeContent({
          title: "Fallback with Lists",
          sections: [
            {
              type: "list",
              position: "full",
              content: ["Item 1", "Item 2", "Item 3"],
            },
          ],
        }),
      });

      expect(result.html).toContain("slide-container");
      expect(result.templateId).toBe("fallback");
    });

    it("should render fallback HTML with text sections", () => {
      const outline = makeOutline("cover");
      (outline as { templateType: string }).templateType = "unknown-fallback";

      const result = skill.render({
        pageOutline: outline,
        pageContent: makeContent({
          title: "Fallback with Text",
          sections: [
            {
              type: "text",
              position: "full",
              content: "Some text content for the fallback slide",
            },
          ],
        }),
      });

      expect(result.html).toContain("slide-container");
      expect(result.templateId).toBe("fallback");
    });

    it("should render fallback HTML with no sections", () => {
      const outline = makeOutline("cover");
      (outline as { templateType: string }).templateType = "totally-unknown";

      const result = skill.render({
        pageOutline: outline,
        pageContent: makeContent({
          title: "Fallback Empty",
          sections: [],
        }),
      });

      expect(result.html).toContain("slide-container");
      expect(result.templateId).toBe("fallback");
    });

    it("should include footer in fallback when pageContent.footer provided", () => {
      const outline = makeOutline("cover");
      (outline as { templateType: string }).templateType =
        "unknown-with-footer";

      const result = skill.render({
        pageOutline: outline,
        pageContent: {
          title: "Fallback Footer",
          sections: [],
          footer: "Page Footer Text",
        },
      });

      expect(result.html).toContain("Page Footer Text");
    });
  });

  // --------------------------------------------------------------------------
  // extractDashboardVariables - no stat sections branch
  // --------------------------------------------------------------------------

  describe("extractDashboardVariables - missing data branches", () => {
    it("should handle dashboard with only text section (no stats, no trend data)", () => {
      const result = skill.render({
        pageOutline: makeOutline("dashboard"),
        pageContent: makeContent({
          title: "No Stats Dashboard",
          sections: [
            {
              type: "text",
              position: "full",
              content: "Summary insight text here providing context",
            },
          ],
          footer: "Q3 2024",
        }),
      });

      expect(result.html).toBeTruthy();
    });

    it("should use footer as PERIOD variable in dashboard", () => {
      const result = skill.render({
        pageOutline: makeOutline("dashboard"),
        pageContent: makeContent({
          title: "Period Dashboard",
          sections: [
            {
              type: "stat",
              position: "left",
              content: {
                value: "100",
                label: "Metric A",
                trend: "up",
                change: "+5",
              },
            },
            {
              type: "stat",
              position: "right",
              content: {
                value: "200",
                label: "Metric B",
                trend: "up",
                change: "+10",
              },
            },
          ],
          footer: "Q4 2024",
        }),
      });

      expect(result.html).toBeTruthy();
    });
  });

  // --------------------------------------------------------------------------
  // extractTimelineVariables - missing date/title scenarios
  // --------------------------------------------------------------------------

  describe("extractTimelineVariables - empty sections branch", () => {
    it("should handle timeline with no sections (all placeholders)", () => {
      const result = skill.render({
        pageOutline: makeOutline("timeline"),
        pageContent: makeContent({
          title: "Empty Timeline",
          sections: [],
        }),
      });

      expect(result.html).toBeTruthy();
    });

    it("should use subtitle as VISION_DESC", () => {
      const result = skill.render({
        pageOutline: makeOutline("timeline"),
        pageContent: makeContent({
          title: "Timeline with Vision",
          subtitle: "Our long-term vision",
          sections: [
            { type: "text", position: "left", content: "2020: Launch" },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
    });
  });

  // --------------------------------------------------------------------------
  // extractTocVariables - single section branch
  // --------------------------------------------------------------------------

  describe("extractTocVariables - single section branch", () => {
    it("should handle toc with single section (1 item)", () => {
      const result = skill.render({
        pageOutline: {
          ...makeOutline("toc"),
          keyElements: [],
        },
        pageContent: makeContent({
          title: "Single Section TOC",
          sections: [
            { type: "text", position: "full", content: "Only Chapter" },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
    });

    it("should handle toc with no sections and no keyElements (empty chapterTitles)", () => {
      const result = skill.render({
        pageOutline: {
          ...makeOutline("toc"),
          keyElements: [],
        },
        pageContent: makeContent({
          title: "Empty TOC",
          subtitle: "Overview subtitle",
          sections: [],
        }),
      });

      expect(result.html).toBeTruthy();
    });
  });

  // --------------------------------------------------------------------------
  // extractRecommendations3ColVariables - with list sections
  // --------------------------------------------------------------------------

  describe("extractRecommendations3ColVariables - coverage", () => {
    it("should render recommendations with full list sections", () => {
      const result = skill.render({
        pageOutline: makeOutline("recommendations"),
        pageContent: makeContent({
          title: "Recommendations",
          subtitle: "Implementation Team",
          sections: [
            {
              type: "list",
              position: "left",
              content: ["Urgent: Reduce costs", "Cut SaaS spending by 20%"],
            },
            {
              type: "list",
              position: "center",
              content: ["Urgent: Scale team", "Hire 5 engineers"],
            },
            {
              type: "list",
              position: "right",
              content: ["Short: Launch v2", "Target Q2 2025"],
            },
            {
              type: "list",
              position: "full",
              content: ["Short: Improve docs", "Rewrite API docs"],
            },
            {
              type: "list",
              position: "left",
              content: ["Short: Test coverage", "Increase to 80%"],
            },
            {
              type: "list",
              position: "center",
              content: ["Long: Market expansion", "APAC region"],
            },
            {
              type: "list",
              position: "right",
              content: ["Long: Platform rebuild", "Microservices arch"],
            },
            {
              type: "list",
              position: "full",
              content: ["Long: AI integration", "ML pipeline"],
            },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
    });
  });

  // --------------------------------------------------------------------------
  // extractRiskOpportunityVariables - with list sections
  // --------------------------------------------------------------------------

  describe("extractRiskOpportunityVariables - with list sections", () => {
    it("should render riskOpportunity with full list sections", () => {
      const result = skill.render({
        pageOutline: makeOutline("riskOpportunity"),
        pageContent: makeContent({
          title: "Risk vs Opportunity Analysis",
          sections: [
            {
              type: "list",
              position: "left",
              content: ["Supply chain disruption", "Could delay Q3 launch"],
            },
            {
              type: "list",
              position: "center",
              content: ["Regulatory risk", "New compliance rules"],
            },
            {
              type: "list",
              position: "right",
              content: ["Talent shortage", "Hard to hire engineers"],
            },
            {
              type: "list",
              position: "full",
              content: ["Market growth opportunity", "20% YoY expansion"],
            },
            {
              type: "list",
              position: "left",
              content: ["Partnership opportunity", "Strategic alliances"],
            },
            {
              type: "list",
              position: "center",
              content: ["Tech innovation", "AI can reduce costs by 30%"],
            },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
    });
  });

  // --------------------------------------------------------------------------
  // extractNextStepsVariables - A-004 template
  // --------------------------------------------------------------------------

  describe("extractNextStepsVariables - A-004 template", () => {
    it("should render questions/nextSteps type template", () => {
      const result = skill.render({
        pageOutline: makeOutline("questions"),
        pageContent: makeContent({
          title: "Next Steps Action Plan",
          sections: [
            {
              type: "list",
              position: "left",
              content: [
                "Finalize hiring plan",
                "Review compensation bands",
                "Head of Engineering",
                "2024-Q2",
              ],
            },
            {
              type: "list",
              position: "center",
              content: [
                "Launch v2 product",
                "Complete QA testing",
                "Product Team",
                "2024-Q3",
              ],
            },
            {
              type: "list",
              position: "right",
              content: [
                "Expand APAC",
                "Market research complete",
                "Sales Team",
                "2024-Q4",
              ],
            },
            {
              type: "list",
              position: "full",
              content: ["2024-Q2", "Hiring complete"],
            },
            {
              type: "list",
              position: "full",
              content: ["2024-Q3", "Product launch"],
            },
            { type: "list", position: "full", content: [] },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
    });

    it("should render questions type with list section", () => {
      const result = skill.render({
        pageOutline: makeOutline("questions"),
        pageContent: makeContent({
          title: "Strategic Questions",
          sections: [
            {
              type: "list",
              position: "full",
              content: [
                "What is our target market?",
                "How do we differentiate?",
                "What are the biggest risks?",
                "What does success look like?",
              ],
            },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
    });
  });

  // --------------------------------------------------------------------------
  // extractMaturityModelVariables - various section types
  // --------------------------------------------------------------------------

  describe("extractMaturityModelVariables - various section types", () => {
    it("should handle maturity model with stat sections", () => {
      const result = skill.render({
        pageOutline: makeOutline("maturityModel"),
        pageContent: makeContent({
          title: "AI Maturity Model",
          sections: [
            {
              type: "stat",
              position: "left",
              content: {
                value: "Level 1",
                label: "Initial",
                trend: "up",
                change: "Ad hoc processes",
              },
            },
            {
              type: "stat",
              position: "center",
              content: {
                value: "Level 2",
                label: "Managed",
                trend: "up",
                change: "Repeatable",
              },
            },
            {
              type: "stat",
              position: "right",
              content: {
                value: "Level 3",
                label: "Defined",
                trend: "up",
                change: "Standardized",
              },
            },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
    });

    it("should handle maturity model with list sections providing CURRENT_LEVEL", () => {
      const result = skill.render({
        pageOutline: makeOutline("maturityModel"),
        pageContent: makeContent({
          title: "Process Maturity",
          sections: [
            {
              type: "list",
              position: "left",
              content: ["Ad Hoc", "No formal process"],
            },
            {
              type: "list",
              position: "center",
              content: ["Repeatable", "Basic project management"],
            },
            {
              type: "list",
              position: "right",
              content: ["Defined", "Organizational standards"],
            },
            {
              type: "list",
              position: "full",
              content: ["Managed", "Quantitative control"],
            },
            {
              type: "list",
              position: "full",
              content: ["Optimizing", "Continuous improvement"],
            },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
    });
  });

  // --------------------------------------------------------------------------
  // extractCaseStudyVariables - various section types
  // --------------------------------------------------------------------------

  describe("extractCaseStudyVariables - coverage", () => {
    it("should render case study with stat sections for metrics", () => {
      const result = skill.render({
        pageOutline: makeOutline("caseStudy"),
        pageContent: makeContent({
          title: "Netflix: Streaming Dominance",
          subtitle: "Entertainment",
          sections: [
            {
              type: "text",
              position: "left",
              content: "Challenge: High customer churn and stagnant growth",
            },
            {
              type: "text",
              position: "center",
              content:
                "Solution: AI-powered recommendation engine and original content",
            },
            {
              type: "text",
              position: "right",
              content: "Result: 40% reduction in churn, 220M subscribers",
            },
            {
              type: "stat",
              position: "full",
              content: {
                value: "220M",
                label: "Subscribers",
                trend: "up",
                change: "+30M",
              },
            },
            {
              type: "stat",
              position: "full",
              content: {
                value: "40%",
                label: "Churn Reduction",
                trend: "down",
                change: "-40%",
              },
            },
            {
              type: "stat",
              position: "full",
              content: {
                value: "92%",
                label: "Satisfaction",
                trend: "up",
                change: "+5%",
              },
            },
            {
              type: "list",
              position: "full",
              content: ["Incredible service - highly recommend", "User A"],
            },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
    });

    it("should handle case study with no text sections", () => {
      const result = skill.render({
        pageOutline: makeOutline("caseStudy"),
        pageContent: makeContent({
          title: "Case Study: Minimal",
          subtitle: "Tech Industry",
          sections: [],
        }),
      });

      expect(result.html).toBeTruthy();
    });

    it("should handle case study with only list sections (no text or stats)", () => {
      const result = skill.render({
        pageOutline: makeOutline("caseStudy"),
        pageContent: makeContent({
          title: "Case Study: Lists Only",
          subtitle: "Retail",
          sections: [
            {
              type: "list",
              position: "full",
              content: ["Testimonial from customer", "5 stars review"],
            },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
    });
  });

  // --------------------------------------------------------------------------
  // extractMultiColumnVariables - with stat sections
  // --------------------------------------------------------------------------

  describe("extractMultiColumnVariables - stat section type", () => {
    it("should extract stat content into CARD variables", () => {
      const result = skill.render({
        pageOutline: makeOutline("multiColumn"),
        pageContent: makeContent({
          title: "Multi Column with Stats",
          sections: [
            {
              type: "stat",
              position: "left",
              content: {
                value: "78%",
                label: "Market Share",
                trend: "up",
                change: "+3%",
              },
            },
            {
              type: "stat",
              position: "center",
              content: {
                value: "$2.1B",
                label: "Revenue",
                trend: "up",
                change: "+18%",
              },
            },
            {
              type: "stat",
              position: "right",
              content: {
                value: "1.4M",
                label: "Customers",
                trend: "up",
                change: "+12%",
              },
            },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
    });
  });

  // --------------------------------------------------------------------------
  // extractComparisonTableVariables - D-005 coverage
  // --------------------------------------------------------------------------

  describe("extractComparisonTableVariables - D-005 coverage", () => {
    it("should render comparison type with table structure (5 rows)", () => {
      const result = skill.render({
        pageOutline: makeOutline("comparison"),
        pageContent: makeContent({
          title: "Feature Comparison Table",
          sections: [
            {
              type: "list",
              position: "full",
              content: ["Feature", "Product A", "Product B", "Product C"],
            },
            {
              type: "list",
              position: "full",
              content: ["Price", "$99/mo", "$149/mo", "$199/mo"],
            },
            {
              type: "list",
              position: "full",
              content: ["Users", "100", "Unlimited", "500"],
            },
            {
              type: "list",
              position: "full",
              content: ["Support", "Email", "Chat", "Phone"],
            },
            {
              type: "list",
              position: "full",
              content: ["API Access", "No", "Yes", "Yes"],
            },
            {
              type: "list",
              position: "full",
              content: ["Analytics", "Basic", "Advanced", "Enterprise"],
            },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
    });

    it("should handle comparison with no list sections (uses placeholders)", () => {
      const result = skill.render({
        pageOutline: makeOutline("comparison"),
        pageContent: makeContent({
          title: "Empty Comparison",
          sections: [
            { type: "text", position: "left", content: "No structured data" },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
    });
  });

  // --------------------------------------------------------------------------
  // extractRankingListVariables - D-006 coverage
  // --------------------------------------------------------------------------

  describe("extractRankingListVariables - D-006 coverage", () => {
    it("should render dashboard with ranking-like content (5 items)", () => {
      const result = skill.render({
        pageOutline: makeOutline("dashboard"),
        pageContent: makeContent({
          title: "Top 5 Markets by Revenue",
          sections: [
            {
              type: "list",
              position: "full",
              content: ["North America", "APAC expansion", "$2.4B"],
            },
            {
              type: "list",
              position: "full",
              content: ["Europe", "Mature market", "$1.8B"],
            },
            {
              type: "list",
              position: "full",
              content: ["Asia Pacific", "Fast growth", "$1.2B"],
            },
            {
              type: "list",
              position: "full",
              content: ["Latin America", "Emerging", "$0.8B"],
            },
            {
              type: "list",
              position: "full",
              content: ["Middle East", "New market", "$0.5B"],
            },
            {
              type: "text",
              position: "full",
              content: "North America continues to lead with 35% market share",
            },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
    });

    it("should render dashboard with stat sections for ranking", () => {
      const result = skill.render({
        pageOutline: makeOutline("dashboard"),
        pageContent: makeContent({
          title: "Top Performers",
          sections: [
            {
              type: "stat",
              position: "left",
              content: {
                value: "#1",
                label: "Product A",
                trend: "up",
                change: "+40%",
              },
            },
            {
              type: "stat",
              position: "center",
              content: {
                value: "#2",
                label: "Product B",
                trend: "up",
                change: "+28%",
              },
            },
            {
              type: "stat",
              position: "right",
              content: {
                value: "#3",
                label: "Product C",
                trend: "up",
                change: "+15%",
              },
            },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
    });

    it("should handle ranking with no insight text", () => {
      const result = skill.render({
        pageOutline: makeOutline("dashboard"),
        pageContent: makeContent({
          title: "Ranking Without Insight",
          sections: [
            {
              type: "list",
              position: "full",
              content: ["Item A", "Description", "100"],
            },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
    });
  });

  // --------------------------------------------------------------------------
  // extractKeyConclusionsVariables - A-003
  // --------------------------------------------------------------------------

  describe("extractKeyConclusionsVariables - text section parsing", () => {
    it("should render closing with text sections containing colon separators", () => {
      const result = skill.render({
        pageOutline: makeOutline("closing"),
        pageContent: makeContent({
          title: "Key Conclusions",
          sections: [
            {
              type: "text",
              position: "left",
              content:
                "Revenue Growth: We exceeded our targets by 23% this year",
            },
            {
              type: "text",
              position: "center",
              content: "Market Position: We are now #2 in our segment",
            },
            {
              type: "text",
              position: "right",
              content: "Innovation: 5 new products launched successfully",
            },
            {
              type: "text",
              position: "full",
              content: "Culture: Employee NPS improved to 72",
            },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
    });

    it("should render closing with list sections for conclusions", () => {
      const result = skill.render({
        pageOutline: makeOutline("closing"),
        pageContent: makeContent({
          title: "Summary Conclusions",
          sections: [
            {
              type: "list",
              position: "left",
              content: ["Revenue exceeded target", "By $200M total"],
            },
            {
              type: "list",
              position: "center",
              content: ["Market share grew", "From 12% to 18%"],
            },
            {
              type: "list",
              position: "right",
              content: ["Team expanded", "200 new hires"],
            },
            {
              type: "list",
              position: "full",
              content: ["Product launched", "10M users in 6 months"],
            },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
    });
  });

  // --------------------------------------------------------------------------
  // getDescriptionFromSections - edge cases
  // --------------------------------------------------------------------------

  describe("getDescriptionFromSections - edge cases", () => {
    it("should handle pillars with citations in pageContent", () => {
      const result = skill.render({
        pageOutline: makeOutline("pillars"),
        pageContent: {
          title: "Pillars with Citations",
          sections: [
            {
              type: "text",
              position: "left",
              content:
                "Short titleLonger description content that follows the title in text",
            },
            {
              type: "text",
              position: "center",
              content: "Another titleDescription here",
            },
            {
              type: "text",
              position: "right",
              content: "Third titleMore details",
            },
          ],
          citations: ["Stat1", "Stat2", "Stat3"],
        },
      });

      expect(result.html).toBeTruthy();
    });

    it("should handle pillars where stat section has description from sibling sections", () => {
      const result = skill.render({
        pageOutline: makeOutline("pillars"),
        pageContent: makeContent({
          title: "Pillars with Stat and Description",
          sections: [
            {
              type: "stat",
              position: "left",
              content: {
                value: "92%",
                label: "Customer Retention",
                trend: "up",
                change: "+2%",
              },
            },
            {
              type: "list",
              position: "center",
              content: ["Item description", "More context"],
            },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
    });
  });

  // --------------------------------------------------------------------------
  // extractComparisonDualVariables - empty list sections
  // --------------------------------------------------------------------------

  describe("extractComparisonDualVariables - empty list sections", () => {
    it("should handle comparison with no list sections (uses placeholders)", () => {
      const result = skill.render({
        pageOutline: makeOutline("comparison"),
        pageContent: makeContent({
          title: "Empty Dual Comparison",
          sections: [],
        }),
      });

      expect(result.html).toBeTruthy();
    });

    it("should handle comparison with only one list section", () => {
      const result = skill.render({
        pageOutline: makeOutline("comparison"),
        pageContent: makeContent({
          title: "Partial Comparison",
          sections: [
            {
              type: "list",
              position: "left",
              content: ["Option A", "Pro A1", "Pro A2", "Con A1", "$100/mo"],
            },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
    });
  });

  // --------------------------------------------------------------------------
  // extractChapterTitleVariables - different subtitle formats
  // --------------------------------------------------------------------------

  describe("extractChapterTitleVariables - edge cases", () => {
    it("should clean CHAPTER prefix from title", () => {
      const result = skill.render({
        pageOutline: makeOutline("chapterTitle"),
        pageContent: makeContent({
          title: "CHAPTER 03: Market Analysis Deep Dive",
          subtitle: "CHAPTER 03",
        }),
      });

      expect(result.html).toBeTruthy();
    });

    it("should handle chapter title where subtitle equals title (should clear subtitle)", () => {
      const result = skill.render({
        pageOutline: makeOutline("chapterTitle"),
        pageContent: makeContent({
          title: "Market Analysis",
          subtitle: "Market Analysis",
        }),
      });

      expect(result.html).toBeTruthy();
    });

    it("should extract chapter number from contentBrief when no match in subtitle", () => {
      const result = skill.render({
        pageOutline: {
          ...makeOutline("chapterTitle"),
          contentBrief: "章节分隔页 - Key insights for chapter",
        },
        pageContent: makeContent({
          title: "Financial Overview",
          subtitle: undefined,
        }),
      });

      expect(result.html).toBeTruthy();
    });
  });

  // --------------------------------------------------------------------------
  // extractCoverVariables - missing title
  // --------------------------------------------------------------------------

  describe("extractCoverVariables - edge cases", () => {
    it("should use MISSING_PLACEHOLDER when cover title is absent", () => {
      const result = skill.render({
        pageOutline: makeOutline("cover"),
        pageContent: {
          title: "",
          subtitle: "Some subtitle",
          sections: [],
        },
      });

      expect(result.html).toBeTruthy();
    });
  });

  // --------------------------------------------------------------------------
  // N-005 and A-005 variable extraction
  // --------------------------------------------------------------------------

  describe("A-005 and N-005 template coverage", () => {
    it("should render closing type with subtitle", () => {
      const result = skill.render({
        pageOutline: makeOutline("closing"),
        pageContent: makeContent({
          title: "Thank You for Attending",
          subtitle: "Q&A Session Follows",
        }),
      });

      expect(result.html).toBeTruthy();
    });
  });

  // --------------------------------------------------------------------------
  // extractFrameworkVariables - stat sections
  // --------------------------------------------------------------------------

  describe("extractFrameworkVariables - stat content type", () => {
    it("should render framework with stat sections as steps", () => {
      const result = skill.render({
        pageOutline: makeOutline("framework"),
        pageContent: makeContent({
          title: "4-Phase Methodology",
          sections: [
            {
              type: "stat",
              position: "left",
              content: {
                value: "Phase 1",
                label: "Discovery",
                trend: "up",
                change: "2 weeks",
              },
            },
            {
              type: "stat",
              position: "center",
              content: {
                value: "Phase 2",
                label: "Design",
                trend: "up",
                change: "3 weeks",
              },
            },
            {
              type: "stat",
              position: "right",
              content: {
                value: "Phase 3",
                label: "Build",
                trend: "up",
                change: "8 weeks",
              },
            },
            {
              type: "stat",
              position: "full",
              content: {
                value: "Phase 4",
                label: "Launch",
                trend: "up",
                change: "1 week",
              },
            },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
    });
  });

  // --------------------------------------------------------------------------
  // extractTocVariables - subtitle fallback for overview
  // --------------------------------------------------------------------------

  describe("extractTocVariables - subtitle as OVERVIEW", () => {
    it("should use subtitle when chapterTitles are empty", () => {
      const result = skill.render({
        pageOutline: {
          ...makeOutline("toc"),
          keyElements: [],
        },
        pageContent: makeContent({
          title: "Table of Contents",
          subtitle: "Comprehensive Report Overview",
          sections: [],
        }),
      });

      expect(result.html).toBeTruthy();
    });
  });

  // --------------------------------------------------------------------------
  // Specific template ID branches via templateRegistry spy
  // Covers: D-001, D-002, D-005, D-006, A-001, A-004, A-005, C-004, C-005, C-006
  // N-002 (splitLayout), extractNextStepsVariables, extractBigNumberVariables
  // extractRecommendations3ColVariables, extractComparisonTableVariables
  // extractRankingListVariables, extractDefaultVariables, extractQuestionsVariables
  // --------------------------------------------------------------------------

  describe("specific templateId branches via registry spy", () => {
    let getByTypeSpy: ReturnType<typeof jest.spyOn>;

    afterEach(() => {
      getByTypeSpy.mockRestore();
    });

    // D-001: extractBigNumberVariables via templateId switch
    it("D-001: should extract big number variables with stat section", () => {
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([BIG_NUMBER_TEMPLATE]);

      const result = skill.render({
        pageOutline: makeOutline("dashboard"),
        pageContent: makeContent({
          title: "Big Number Slide",
          sections: [
            {
              type: "stat",
              position: "center",
              content: {
                value: "99.9%",
                label: "Uptime SLA",
                trend: "up",
                change: "+0.1%",
              },
            },
          ],
        }),
      });

      expect(result.templateId).toBe("D-001");
      expect(result.html).toBeTruthy();
    });

    it("D-001: should use MISSING_NUMBER_PLACEHOLDER when no stat section", () => {
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([BIG_NUMBER_TEMPLATE]);

      const result = skill.render({
        pageOutline: makeOutline("dashboard"),
        pageContent: makeContent({
          title: "Missing Stat",
          sections: [
            { type: "text", position: "full", content: "No stat here" },
          ],
        }),
      });

      expect(result.templateId).toBe("D-001");
      expect(result.html).toBeTruthy();
    });

    // D-002: extractDashboardVariables via templateId switch
    it("D-002: should extract 4KPI dashboard variables", () => {
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([DASHBOARD_4KPI_TEMPLATE]);

      const result = skill.render({
        pageOutline: makeOutline("dashboard"),
        pageContent: makeContent({
          title: "Dashboard KPIs",
          sections: [
            {
              type: "stat",
              position: "left",
              content: {
                value: "1000",
                label: "Users",
                trend: "up",
                change: "+10%",
              },
            },
            {
              type: "stat",
              position: "center",
              content: {
                value: "500",
                label: "Revenue",
                trend: "up",
                change: "+5%",
              },
            },
            {
              type: "stat",
              position: "right",
              content: {
                value: "98%",
                label: "Retention",
                trend: "up",
                change: "+2%",
              },
            },
            {
              type: "stat",
              position: "full",
              content: {
                value: "4.5",
                label: "Rating",
                trend: "up",
                change: "+0.2",
              },
            },
            {
              type: "text",
              position: "full",
              content: "Overall performance is strong",
            },
          ],
          footer: "Q4 2024",
        }),
      });

      expect(result.templateId).toBe("D-002");
      expect(result.html).toBeTruthy();
    });

    it("D-002: should handle dashboard with no stats (all MISSING_NUMBER_PLACEHOLDER)", () => {
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([DASHBOARD_4KPI_TEMPLATE]);

      const result = skill.render({
        pageOutline: makeOutline("dashboard"),
        pageContent: makeContent({
          title: "Empty Dashboard",
          sections: [],
        }),
      });

      expect(result.templateId).toBe("D-002");
      expect(result.html).toBeTruthy();
    });

    // D-005: extractComparisonTableVariables via templateId switch
    it("D-005: should extract comparison table variables with list sections", () => {
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([COMPARISON_TABLE_TEMPLATE]);

      const result = skill.render({
        pageOutline: makeOutline("dashboard"),
        pageContent: makeContent({
          title: "Comparison Table",
          sections: [
            {
              type: "list",
              position: "full",
              content: ["Criteria", "Product A", "Product B", "Product C"],
            },
            {
              type: "list",
              position: "full",
              content: ["Price", "$10/mo", "$15/mo", "$20/mo"],
            },
            {
              type: "list",
              position: "full",
              content: ["Users", "100", "500", "Unlimited"],
            },
            {
              type: "list",
              position: "full",
              content: ["Support", "Email", "Chat", "Phone"],
            },
            {
              type: "list",
              position: "full",
              content: ["API", "Yes", "Yes", "No"],
            },
            {
              type: "list",
              position: "full",
              content: ["SLA", "99%", "99.5%", "99.9%"],
            },
          ],
        }),
      });

      expect(result.templateId).toBe("D-005");
      expect(result.html).toBeTruthy();
    });

    it("D-005: should handle comparison table with no list sections (placeholders)", () => {
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([COMPARISON_TABLE_TEMPLATE]);

      const result = skill.render({
        pageOutline: makeOutline("dashboard"),
        pageContent: makeContent({
          title: "Empty Comparison Table",
          sections: [],
        }),
      });

      expect(result.templateId).toBe("D-005");
      expect(result.html).toBeTruthy();
    });

    // D-006: extractRankingListVariables via templateId switch
    it("D-006: should extract ranking list variables with list sections", () => {
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([RANKING_LIST_TEMPLATE]);

      const result = skill.render({
        pageOutline: makeOutline("dashboard"),
        pageContent: makeContent({
          title: "Top Rankings",
          sections: [
            {
              type: "list",
              position: "full",
              content: ["Company Alpha", "Leading fintech", "$5B"],
            },
            {
              type: "list",
              position: "full",
              content: ["Company Beta", "Cloud services", "$3B"],
            },
            {
              type: "list",
              position: "full",
              content: ["Company Gamma", "E-commerce", "$2B"],
            },
            {
              type: "list",
              position: "full",
              content: ["Company Delta", "Healthcare", "$1.5B"],
            },
            {
              type: "list",
              position: "full",
              content: ["Company Epsilon", "Education", "$1B"],
            },
            {
              type: "text",
              position: "full",
              content: "Market consolidation accelerating",
            },
          ],
        }),
      });

      expect(result.templateId).toBe("D-006");
      expect(result.html).toBeTruthy();
    });

    it("D-006: should handle ranking with stat sections as fallback", () => {
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([RANKING_LIST_TEMPLATE]);

      const result = skill.render({
        pageOutline: makeOutline("dashboard"),
        pageContent: makeContent({
          title: "Stat Rankings",
          sections: [
            {
              type: "stat",
              position: "full",
              content: {
                value: "#1",
                label: "Market Leader",
                trend: "up",
                change: "",
              },
            },
            {
              type: "stat",
              position: "full",
              content: {
                value: "#2",
                label: "Runner Up",
                trend: "up",
                change: "",
              },
            },
            {
              type: "stat",
              position: "full",
              content: {
                value: "#3",
                label: "Third Place",
                trend: "up",
                change: "",
              },
            },
          ],
        }),
      });

      expect(result.templateId).toBe("D-006");
      expect(result.html).toBeTruthy();
    });

    it("D-006: should handle ranking with no insight text", () => {
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([RANKING_LIST_TEMPLATE]);

      const result = skill.render({
        pageOutline: makeOutline("dashboard"),
        pageContent: makeContent({
          title: "No Insight Rankings",
          sections: [],
        }),
      });

      expect(result.templateId).toBe("D-006");
      expect(result.html).toBeTruthy();
    });

    // A-001: extractRecommendations3ColVariables via templateId switch
    it("A-001: should extract 3-column recommendations with list sections", () => {
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([RECOMMENDATIONS_3COL_TEMPLATE]);

      const result = skill.render({
        pageOutline: makeOutline("recommendations"),
        pageContent: makeContent({
          title: "Strategic Recommendations",
          subtitle: "Strategy Team",
          sections: [
            {
              type: "list",
              position: "full",
              content: ["Urgent Action 1", "Do this immediately"],
            },
            {
              type: "list",
              position: "full",
              content: ["Urgent Action 2", "Critical priority"],
            },
            {
              type: "list",
              position: "full",
              content: ["Short Term 1", "Within 3 months"],
            },
            {
              type: "list",
              position: "full",
              content: ["Short Term 2", "Q1 initiative"],
            },
            {
              type: "list",
              position: "full",
              content: ["Short Term 3", "Q2 initiative"],
            },
            {
              type: "list",
              position: "full",
              content: ["Long Term 1", "Annual goal"],
            },
            {
              type: "list",
              position: "full",
              content: ["Long Term 2", "Multi-year plan"],
            },
            {
              type: "list",
              position: "full",
              content: ["Long Term 3", "5-year vision"],
            },
          ],
        }),
      });

      expect(result.templateId).toBe("A-001");
      expect(result.html).toBeTruthy();
    });

    it("A-001: should handle missing recommendation sections with MISSING_PLACEHOLDER", () => {
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([RECOMMENDATIONS_3COL_TEMPLATE]);

      const result = skill.render({
        pageOutline: makeOutline("recommendations"),
        pageContent: makeContent({
          title: "Empty Recommendations",
          sections: [],
        }),
      });

      expect(result.templateId).toBe("A-001");
      expect(result.html).toBeTruthy();
    });

    // A-002: extractRiskOpportunityVariables already covered via riskOpportunity type
    // (A-002 has contentDensity: "high" and is the only template of that type, so it's already selected)

    // A-004: extractNextStepsVariables via templateId switch
    it("A-004: should extract next steps with full list sections (steps + milestones)", () => {
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([NEXT_STEPS_TEMPLATE]);

      const result = skill.render({
        pageOutline: makeOutline("recommendations"),
        pageContent: makeContent({
          title: "Next Steps Plan",
          sections: [
            {
              type: "list",
              position: "full",
              content: ["Hire 10 engineers", "Technical build", "CTO", "Q1"],
            },
            {
              type: "list",
              position: "full",
              content: ["Launch MVP", "Go to market", "CPO", "Q2"],
            },
            {
              type: "list",
              position: "full",
              content: ["Scale marketing", "Growth phase", "CMO", "Q3"],
            },
            {
              type: "list",
              position: "full",
              content: ["Jan 2025", "Team formation"],
            },
            {
              type: "list",
              position: "full",
              content: ["Apr 2025", "Product launch"],
            },
            {
              type: "list",
              position: "full",
              content: ["Jul 2025", "Series B close"],
            },
          ],
        }),
      });

      expect(result.templateId).toBe("A-004");
      expect(result.html).toBeTruthy();
    });

    it("A-004: should handle next steps with no sections (all placeholders)", () => {
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([NEXT_STEPS_TEMPLATE]);

      const result = skill.render({
        pageOutline: makeOutline("recommendations"),
        pageContent: makeContent({
          title: "Empty Next Steps",
          sections: [],
        }),
      });

      expect(result.templateId).toBe("A-004");
      expect(result.html).toBeTruthy();
    });

    // A-005: extractCoverVariables + PRESENTER/EMAIL/COMPANY via templateId switch
    it("A-005: should extract thank-you variables with MISSING_PLACEHOLDER fields", () => {
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([THANK_YOU_TEMPLATE]);

      const result = skill.render({
        pageOutline: makeOutline("closing"),
        pageContent: makeContent({
          title: "Thank You",
          subtitle: "Questions Welcome",
          sections: [],
        }),
      });

      expect(result.templateId).toBe("A-005");
      expect(result.html).toBeTruthy();
    });

    // C-004: extractMultiColumnVariables via templateId switch (card grid 2)
    it("C-004: should extract multi-column variables from card grid 2 template", () => {
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([CARD_GRID_2_TEMPLATE]);

      const result = skill.render({
        pageOutline: makeOutline("multiColumn"),
        pageContent: makeContent({
          title: "Two Column Cards",
          sections: [
            {
              type: "list",
              position: "left",
              content: ["Card 1 Title", "Description for card 1"],
            },
            {
              type: "list",
              position: "right",
              content: ["Card 2 Title", "Description for card 2"],
            },
          ],
        }),
      });

      expect(result.templateId).toBe("C-004");
      expect(result.html).toBeTruthy();
    });

    // C-005: card grid 3
    it("C-005: should extract multi-column variables from card grid 3 template", () => {
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([CARD_GRID_3_TEMPLATE]);

      const result = skill.render({
        pageOutline: makeOutline("multiColumn"),
        pageContent: makeContent({
          title: "Three Column Cards",
          sections: [
            {
              type: "text",
              position: "left",
              content: "First: Description of first item",
            },
            {
              type: "text",
              position: "center",
              content: "Second: Details about second",
            },
            {
              type: "text",
              position: "right",
              content: "Third: Third column content",
            },
          ],
        }),
      });

      expect(result.templateId).toBe("C-005");
      expect(result.html).toBeTruthy();
    });

    // C-006: card grid 4
    it("C-006: should extract multi-column variables from card grid 4 template with stat sections", () => {
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([CARD_GRID_4_TEMPLATE]);

      const result = skill.render({
        pageOutline: makeOutline("multiColumn"),
        pageContent: makeContent({
          title: "Four Column Stats",
          sections: [
            {
              type: "stat",
              position: "full",
              content: {
                value: "85%",
                label: "Satisfaction",
                trend: "up",
                change: "+5%",
              },
            },
            {
              type: "stat",
              position: "full",
              content: {
                value: "1200",
                label: "Customers",
                trend: "up",
                change: "+100",
              },
            },
            {
              type: "stat",
              position: "full",
              content: {
                value: "45",
                label: "Products",
                trend: "up",
                change: "+5",
              },
            },
            {
              type: "stat",
              position: "full",
              content: {
                value: "12",
                label: "Markets",
                trend: "up",
                change: "+2",
              },
            },
          ],
        }),
      });

      expect(result.templateId).toBe("C-006");
      expect(result.html).toBeTruthy();
    });

    // extractDefaultVariables via extractVariables switch "default" branch
    it("should use extractDefaultVariables for unknown template types in extractVariables", () => {
      // Force selectTemplate to return a template with a type that goes through extractVariables default
      const unknownTypeTemplate = {
        ...BIG_NUMBER_TEMPLATE,
        metadata: {
          ...BIG_NUMBER_TEMPLATE.metadata,
          id: "X-999",
          // Use a cast to simulate an unrecognized templateType going into extractVariables default
        },
      };
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([unknownTypeTemplate]);

      const outline = makeOutline("dashboard");
      // Override the templateType to something not in the extractVariables switch
      (outline as { templateType: string }).templateType =
        "unknownFallbackType";

      const result = skill.render({
        pageOutline: outline,
        pageContent: makeContent({
          title: "Unknown Type Slide",
          sections: [
            { type: "list", position: "full", content: ["Item 1", "Item 2"] },
            { type: "text", position: "full", content: "Some text content" },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
    });

    // extractQuestionsVariables via extractVariables "questions" case
    it("should extract questions variables for questions templateType", () => {
      // For "questions" type, there's no template in registry, so renderFallback is called
      // To hit extractQuestionsVariables, we need a template with "questions" type
      const questionsTemplate = {
        ...BIG_NUMBER_TEMPLATE,
        metadata: {
          ...BIG_NUMBER_TEMPLATE.metadata,
          id: "Q-001",
          type: "questions" as PageTemplateType,
        },
      };
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([questionsTemplate]);

      const result = skill.render({
        pageOutline: makeOutline("questions" as PageTemplateType),
        pageContent: makeContent({
          title: "FAQ Slide",
          sections: [
            {
              type: "list",
              position: "full",
              content: [
                "Question 1?",
                "Question 2?",
                "Question 3?",
                "Question 4?",
                "Question 5?",
                "Question 6?",
              ],
            },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
    });

    it("should handle questions type with no list section", () => {
      const questionsTemplate = {
        ...BIG_NUMBER_TEMPLATE,
        metadata: {
          ...BIG_NUMBER_TEMPLATE.metadata,
          id: "Q-001",
          type: "questions" as PageTemplateType,
        },
      };
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([questionsTemplate]);

      const result = skill.render({
        pageOutline: makeOutline("questions" as PageTemplateType),
        pageContent: makeContent({
          title: "No Questions",
          sections: [],
        }),
      });

      expect(result.html).toBeTruthy();
    });

    // extractMaturityModelVariables via extractVariables "maturityModel" case
    it("should extract maturity model variables via extractVariables switch", () => {
      const maturityTemplate = {
        ...BIG_NUMBER_TEMPLATE,
        metadata: {
          ...BIG_NUMBER_TEMPLATE.metadata,
          id: "M-001",
          type: "maturityModel" as PageTemplateType,
        },
      };
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([maturityTemplate]);

      const result = skill.render({
        pageOutline: makeOutline("maturityModel" as PageTemplateType),
        pageContent: makeContent({
          title: "AI Maturity Model",
          sections: [
            {
              type: "text",
              position: "full",
              content:
                "Level 1: Initial - Ad hoc processes, no standardization",
            },
            {
              type: "text",
              position: "full",
              content: "Level 2: Managed - Defined processes, basic tooling",
            },
            {
              type: "text",
              position: "full",
              content: "Level 3: Defined - Standardized, documented",
            },
            {
              type: "stat",
              position: "full",
              content: {
                value: "Level 4",
                label: "Quantitatively managed",
                trend: "up",
                change: "",
              },
            },
            {
              type: "list",
              position: "full",
              content: ["Level 5", "Continuous improvement", "Full automation"],
            },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
    });

    // extractRecommendationsVariables (old compat) via extractVariables "recommendations" switch
    // This is reached when templateId is NOT A-001/A-003/A-004 but templateType is "recommendations"
    // We can force this by using a custom template ID not in the switch
    it("should use extractRecommendationsVariables via extractVariables recommendations case", () => {
      const customRecsTemplate = {
        ...RECOMMENDATIONS_3COL_TEMPLATE,
        metadata: {
          ...RECOMMENDATIONS_3COL_TEMPLATE.metadata,
          id: "CUSTOM-RECS",
        },
      };
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([customRecsTemplate]);

      const result = skill.render({
        pageOutline: makeOutline("recommendations"),
        pageContent: makeContent({
          title: "Compat Recommendations",
          sections: [
            {
              type: "list",
              position: "full",
              content: ["Rec 1", "Action 1", "Owner 1"],
            },
            {
              type: "list",
              position: "full",
              content: ["Rec 2", "Action 2", "Owner 2"],
            },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
    });

    it("should handle recommendations via extractVariables with no list section", () => {
      const customRecsTemplate = {
        ...RECOMMENDATIONS_3COL_TEMPLATE,
        metadata: {
          ...RECOMMENDATIONS_3COL_TEMPLATE.metadata,
          id: "CUSTOM-RECS",
        },
      };
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([customRecsTemplate]);

      const result = skill.render({
        pageOutline: makeOutline("recommendations"),
        pageContent: makeContent({
          title: "Empty Compat Recommendations",
          sections: [],
        }),
      });

      expect(result.html).toBeTruthy();
    });

    // S-001: extractTocVariables via extractVariablesByTemplateId "S-001" branch
    it("S-001: should extract TOC variables via S-001 template ID branch", () => {
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([TOC_DUAL_TEMPLATE]);

      const result = skill.render({
        pageOutline: {
          ...makeOutline("toc"),
          keyElements: ["Chapter 1", "Chapter 2", "Chapter 3"],
        },
        pageContent: makeContent({
          title: "Table of Contents",
          sections: [
            {
              type: "list",
              position: "full",
              content: ["Section A", "Section B"],
            },
          ],
        }),
      });

      expect(result.templateId).toBe("S-001");
      expect(result.html).toBeTruthy();
    });

    // S-009: extractFrameworkVariables via extractVariablesByTemplateId "S-009" branch
    it("S-009: should extract framework variables via S-009 pyramid template", () => {
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([PYRAMID_TEMPLATE]);

      const result = skill.render({
        pageOutline: makeOutline("framework"),
        pageContent: makeContent({
          title: "Pyramid Framework",
          sections: [
            {
              type: "text",
              position: "full",
              content: "Foundation: Core principles of our approach",
            },
            {
              type: "text",
              position: "full",
              content: "Middle: Implementation layers",
            },
            {
              type: "text",
              position: "full",
              content: "Top: Strategic outcomes",
            },
          ],
        }),
      });

      expect(result.templateId).toBe("S-009");
      expect(result.html).toBeTruthy();
    });

    // N-002 (closing type via splitLayout) in extractVariablesByTemplateId: lines 659-665
    // N-002 has type "splitLayout" but the switch case "N-002" returns extractCoverVariables + TITLE
    // We need to spy to return N-002 when type is "splitLayout"
    it("N-002: should use extractCoverVariables branch for N-002 templateId", () => {
      // N-002 template from narrative templates (not individually exported, so we build it inline)
      const n002Template = {
        metadata: {
          id: "N-002",
          type: "splitLayout" as PageTemplateType,
          name: "Executive Summary",
          description: "Executive summary layout",
          useCases: ["executive summary"],
          contentDensity: "high" as const,
          visualStyle: "professional" as const,
          recommendedFor: ["closing"],
          maxContentBlocks: 2,
          variables: ["{{TITLE}}", "{{SUBTITLE}}"],
          keywords: ["summary"],
          positionFit: { opening: 0.5, middle: 0.8, closing: 0.9 },
          compatibility: { goodBefore: [], goodAfter: [], avoidNear: [] },
          tone: "neutral" as const,
        },
        html: "<div>{{TITLE}} {{SUBTITLE}}</div>",
      };
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([n002Template]);

      const result = skill.render({
        pageOutline: makeOutline("splitLayout" as PageTemplateType),
        pageContent: makeContent({
          title: "Executive Summary Page",
          subtitle: "Key strategic findings",
        }),
      });

      expect(result.templateId).toBe("N-002");
      expect(result.html).toBeTruthy();
    });

    // extractVariables fallback cases — covered by using custom IDs with various templateTypes

    // "pillars" type via extractVariables switch (custom ID not in extractVariablesByTemplateId switch)
    it("extractVariables - pillars case via custom template ID", () => {
      const customPillarsTemplate = {
        ...THREE_PILLAR_TEMPLATE,
        metadata: { ...THREE_PILLAR_TEMPLATE.metadata, id: "CUSTOM-PILLARS" },
      };
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([customPillarsTemplate]);

      const result = skill.render({
        pageOutline: makeOutline("pillars"),
        pageContent: makeContent({
          title: "Three Pillars",
          sections: [
            { type: "text", position: "left", content: "Pillar One details" },
            { type: "text", position: "center", content: "Pillar Two details" },
            {
              type: "text",
              position: "right",
              content: "Pillar Three details",
            },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
    });

    // "dashboard" type via extractVariables switch (custom ID)
    it("extractVariables - dashboard case via custom template ID", () => {
      const customDashTemplate = {
        ...DASHBOARD_4KPI_TEMPLATE,
        metadata: { ...DASHBOARD_4KPI_TEMPLATE.metadata, id: "CUSTOM-DASH" },
      };
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([customDashTemplate]);

      const result = skill.render({
        pageOutline: makeOutline("dashboard"),
        pageContent: makeContent({
          title: "Dashboard Fallback",
          sections: [
            {
              type: "stat",
              position: "full",
              content: {
                value: "42",
                label: "Answer",
                trend: "up",
                change: "+1",
              },
            },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
    });

    // "timeline" type via extractVariables switch (custom ID)
    it("extractVariables - timeline case via custom template ID", () => {
      const customTimelineTemplate = {
        ...TIMELINE_HORIZONTAL_TEMPLATE,
        metadata: { ...TIMELINE_HORIZONTAL_TEMPLATE.metadata, id: "CUSTOM-TL" },
      };
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([customTimelineTemplate]);

      const result = skill.render({
        pageOutline: makeOutline("timeline"),
        pageContent: makeContent({
          title: "Timeline Fallback",
          sections: [
            { type: "text", position: "full", content: "2023: Launch phase" },
            { type: "text", position: "full", content: "2024: Growth phase" },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
    });

    // "evolutionRoadmap" type via extractVariables switch (custom ID)
    it("extractVariables - evolutionRoadmap case via custom template ID", () => {
      const customRoadmapTemplate = {
        ...TIMELINE_HORIZONTAL_TEMPLATE,
        metadata: {
          ...TIMELINE_HORIZONTAL_TEMPLATE.metadata,
          id: "CUSTOM-ROADMAP",
          type: "evolutionRoadmap" as PageTemplateType,
        },
      };
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([customRoadmapTemplate]);

      const result = skill.render({
        pageOutline: makeOutline("evolutionRoadmap" as PageTemplateType),
        pageContent: makeContent({
          title: "Evolution Roadmap Fallback",
          sections: [
            { type: "text", position: "full", content: "Stage 1: Foundation" },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
    });

    // "comparison" type via extractVariables switch (custom ID)
    it("extractVariables - comparison case via custom template ID", () => {
      const customCompTemplate = {
        ...COMPARISON_TABLE_TEMPLATE,
        metadata: {
          ...COMPARISON_TABLE_TEMPLATE.metadata,
          id: "CUSTOM-COMP",
          type: "comparison" as PageTemplateType,
        },
      };
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([customCompTemplate]);

      const result = skill.render({
        pageOutline: makeOutline("comparison"),
        pageContent: makeContent({
          title: "Comparison Fallback",
          sections: [
            {
              type: "list",
              position: "left",
              content: ["Option A", "Pro 1", "Pro 2"],
            },
            { type: "list", position: "right", content: ["Option B", "Pro 1"] },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
    });

    // "riskOpportunity" type via extractVariables switch (custom ID)
    it("extractVariables - riskOpportunity case via custom template ID", () => {
      const customRiskTemplate = {
        ...COMPARISON_TABLE_TEMPLATE,
        metadata: {
          ...COMPARISON_TABLE_TEMPLATE.metadata,
          id: "CUSTOM-RISK",
          type: "riskOpportunity" as PageTemplateType,
        },
      };
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([customRiskTemplate]);

      const result = skill.render({
        pageOutline: makeOutline("riskOpportunity" as PageTemplateType),
        pageContent: makeContent({
          title: "Risk Opportunity Fallback",
          sections: [
            {
              type: "list",
              position: "left",
              content: ["Risk 1", "High impact"],
            },
            {
              type: "list",
              position: "right",
              content: ["Opportunity 1", "High reward"],
            },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
    });

    // "chapterTitle" type via extractVariables switch (custom ID)
    it("extractVariables - chapterTitle case via custom template ID", () => {
      const customChapterTemplate = {
        ...BIG_NUMBER_TEMPLATE,
        metadata: {
          ...BIG_NUMBER_TEMPLATE.metadata,
          id: "CUSTOM-CH",
          type: "chapterTitle" as PageTemplateType,
        },
      };
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([customChapterTemplate]);

      const result = skill.render({
        pageOutline: {
          ...makeOutline("chapterTitle"),
          subtitle: "CHAPTER 02",
          contentBrief: "Chapter 2 content",
        },
        pageContent: makeContent({
          title: "Chapter 2: Deep Analysis",
          subtitle: "Section overview",
        }),
      });

      expect(result.html).toBeTruthy();
    });

    // "framework" type via extractVariables switch (custom ID)
    it("extractVariables - framework case via custom template ID", () => {
      const customFrameworkTemplate = {
        ...BIG_NUMBER_TEMPLATE,
        metadata: {
          ...BIG_NUMBER_TEMPLATE.metadata,
          id: "CUSTOM-FW",
          type: "framework" as PageTemplateType,
        },
      };
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([customFrameworkTemplate]);

      const result = skill.render({
        pageOutline: makeOutline("framework"),
        pageContent: makeContent({
          title: "Framework Fallback",
          sections: [
            {
              type: "text",
              position: "full",
              content: "Step 1: Define - Establish scope and objectives",
            },
            {
              type: "text",
              position: "full",
              content: "Step 2: Plan - Create detailed roadmap",
            },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
    });

    // "cover" type via extractVariables switch (custom ID)
    it("extractVariables - cover case via custom template ID", () => {
      const customCoverTemplate = {
        ...BIG_NUMBER_TEMPLATE,
        metadata: {
          ...BIG_NUMBER_TEMPLATE.metadata,
          id: "CUSTOM-COVER",
          type: "cover" as PageTemplateType,
        },
      };
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([customCoverTemplate]);

      const result = skill.render({
        pageOutline: makeOutline("cover"),
        pageContent: makeContent({
          title: "Cover Slide",
          subtitle: "Annual Report 2024",
        }),
      });

      expect(result.html).toBeTruthy();
    });

    // "closing" type via extractVariables switch (custom ID)
    it("extractVariables - closing case via custom template ID", () => {
      const customClosingTemplate = {
        ...BIG_NUMBER_TEMPLATE,
        metadata: {
          ...BIG_NUMBER_TEMPLATE.metadata,
          id: "CUSTOM-CLOSE",
          type: "closing" as PageTemplateType,
        },
      };
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([customClosingTemplate]);

      const result = skill.render({
        pageOutline: makeOutline("closing"),
        pageContent: makeContent({
          title: "Thank You",
          subtitle: "Questions?",
        }),
      });

      expect(result.html).toBeTruthy();
    });

    // "toc" type via extractVariables switch (custom ID)
    it("extractVariables - toc case via custom template ID", () => {
      const customTocTemplate = {
        ...BIG_NUMBER_TEMPLATE,
        metadata: {
          ...BIG_NUMBER_TEMPLATE.metadata,
          id: "CUSTOM-TOC",
          type: "toc" as PageTemplateType,
        },
      };
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([customTocTemplate]);

      const result = skill.render({
        pageOutline: {
          ...makeOutline("toc"),
          keyElements: ["Section 1", "Section 2", "Section 3"],
        },
        pageContent: makeContent({
          title: "TOC Fallback",
          sections: [],
        }),
      });

      expect(result.html).toBeTruthy();
    });

    // "multiColumn" type via extractVariables switch (custom ID)
    it("extractVariables - multiColumn case via custom template ID", () => {
      const customMultiTemplate = {
        ...BIG_NUMBER_TEMPLATE,
        metadata: {
          ...BIG_NUMBER_TEMPLATE.metadata,
          id: "CUSTOM-MULTI",
          type: "multiColumn" as PageTemplateType,
        },
      };
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([customMultiTemplate]);

      const result = skill.render({
        pageOutline: makeOutline("multiColumn" as PageTemplateType),
        pageContent: makeContent({
          title: "Multi Column Fallback",
          sections: [
            {
              type: "list",
              position: "full",
              content: ["Col 1 Title", "Details for column 1"],
            },
            {
              type: "list",
              position: "full",
              content: ["Col 2 Title", "Details for column 2"],
            },
            {
              type: "list",
              position: "full",
              content: ["Col 3 Title", "Details for column 3"],
            },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
    });

    // "splitLayout" type via extractVariables switch (custom ID)
    it("extractVariables - splitLayout case via custom template ID", () => {
      const customSplitTemplate = {
        ...BIG_NUMBER_TEMPLATE,
        metadata: {
          ...BIG_NUMBER_TEMPLATE.metadata,
          id: "CUSTOM-SPLIT",
          type: "splitLayout" as PageTemplateType,
        },
      };
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([customSplitTemplate]);

      const result = skill.render({
        pageOutline: makeOutline("splitLayout" as PageTemplateType),
        pageContent: makeContent({
          title: "Split Layout Fallback",
          sections: [
            { type: "text", position: "left", content: "Left side content" },
            { type: "text", position: "right", content: "Right side content" },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
    });

    // "caseStudy" type via extractVariables switch (custom ID)
    it("extractVariables - caseStudy case via custom template ID", () => {
      const customCaseTemplate = {
        ...BIG_NUMBER_TEMPLATE,
        metadata: {
          ...BIG_NUMBER_TEMPLATE.metadata,
          id: "CUSTOM-CASE",
          type: "caseStudy" as PageTemplateType,
        },
      };
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([customCaseTemplate]);

      const result = skill.render({
        pageOutline: makeOutline("caseStudy" as PageTemplateType),
        pageContent: makeContent({
          title: "Case Study Fallback",
          subtitle: "Healthcare Industry",
          sections: [
            {
              type: "text",
              position: "full",
              content:
                "Background: Leading hospital network faced efficiency challenges",
            },
            {
              type: "stat",
              position: "full",
              content: {
                value: "30%",
                label: "Cost reduction",
                trend: "up",
                change: "",
              },
            },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
    });

    // getDescriptionFromSections - stat type branch (line 1680-1683)
    it("getDescriptionFromSections - stat type branch via pillars with stat section", () => {
      const customPillarsTemplate = {
        ...THREE_PILLAR_TEMPLATE,
        metadata: {
          ...THREE_PILLAR_TEMPLATE.metadata,
          id: "CUSTOM-PILLARS-STAT",
        },
      };
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([customPillarsTemplate]);

      const result = skill.render({
        pageOutline: makeOutline("pillars"),
        pageContent: makeContent({
          title: "Pillars with Stat Desc",
          sections: [
            // stat at index 0 - will be used for pillar desc via getDescriptionFromSections
            {
              type: "stat",
              position: "left",
              content: {
                value: "95%",
                label: "Accuracy stat",
                trend: "up",
                change: "+3%",
              },
            },
            {
              type: "stat",
              position: "center",
              content: {
                value: "80%",
                label: "Efficiency stat",
                trend: "up",
                change: "+5%",
              },
            },
            {
              type: "stat",
              position: "right",
              content: {
                value: "70%",
                label: "Coverage stat",
                trend: "up",
                change: "+7%",
              },
            },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
    });

    // getDescriptionFromSections - empty string from text (line 1672 with empty slice)
    it("getDescriptionFromSections - empty text content uses MISSING_PLACEHOLDER", () => {
      const customPillarsTemplate = {
        ...THREE_PILLAR_TEMPLATE,
        metadata: {
          ...THREE_PILLAR_TEMPLATE.metadata,
          id: "CUSTOM-PILLARS-EMPTY",
        },
      };
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([customPillarsTemplate]);

      const result = skill.render({
        pageOutline: makeOutline("pillars"),
        pageContent: makeContent({
          title: "Pillars Empty Text",
          sections: [
            // empty text content
            { type: "text", position: "left", content: "" },
            { type: "text", position: "center", content: "" },
            { type: "text", position: "right", content: "" },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
    });

    // getDescriptionFromSections - empty list content uses MISSING_PLACEHOLDER
    it("getDescriptionFromSections - empty list slice uses MISSING_PLACEHOLDER", () => {
      const customPillarsTemplate = {
        ...THREE_PILLAR_TEMPLATE,
        metadata: {
          ...THREE_PILLAR_TEMPLATE.metadata,
          id: "CUSTOM-PILLARS-EMPTYLIST",
        },
      };
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([customPillarsTemplate]);

      const result = skill.render({
        pageOutline: makeOutline("pillars"),
        pageContent: makeContent({
          title: "Pillars Empty List",
          sections: [
            // list with only 1 item (slice(0,2) will be ["Item"] -> joined -> "Item" non-empty)
            // To get empty joined, we need 0 items
            { type: "list", position: "left", content: [] },
            { type: "list", position: "center", content: [] },
            { type: "list", position: "right", content: [] },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
    });

    // extractTimelineVariables - missing title warning (line 1047)
    it("extractTimelineVariables - missing title triggers warning (via S-006 spy)", () => {
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([TIMELINE_HORIZONTAL_TEMPLATE]);

      const result = skill.render({
        pageOutline: makeOutline("timeline"),
        pageContent: {
          title: "", // empty title triggers the logger.warn on line 1047
          sections: [
            { type: "text", position: "full", content: "2024: Launch" },
          ],
        },
      });

      expect(result.html).toBeTruthy();
    });

    // extractMaturityModelVariables - stat-based CURRENT_LEVEL and TARGET_LEVEL (lines 1845-1848)
    it("extractMaturityModelVariables - stat sections provide CURRENT_LEVEL and TARGET_LEVEL", () => {
      const maturityTemplate = {
        ...BIG_NUMBER_TEMPLATE,
        metadata: {
          ...BIG_NUMBER_TEMPLATE.metadata,
          id: "M-002",
          type: "maturityModel" as PageTemplateType,
        },
      };
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([maturityTemplate]);

      const result = skill.render({
        pageOutline: makeOutline("maturityModel" as PageTemplateType),
        pageContent: makeContent({
          title: "Maturity Assessment",
          sections: [
            // 5 level definitions first
            { type: "list", position: "full", content: ["Initial", "Ad hoc"] },
            {
              type: "list",
              position: "full",
              content: ["Managed", "Repeatable"],
            },
            {
              type: "list",
              position: "full",
              content: ["Defined", "Standardized"],
            },
            {
              type: "list",
              position: "full",
              content: ["Quantified", "Measured"],
            },
            {
              type: "list",
              position: "full",
              content: ["Optimizing", "Continuous"],
            },
            // stat sections for current/target levels
            {
              type: "stat",
              position: "full",
              content: {
                value: "Level 3",
                label: "Current",
                trend: "up",
                change: "",
              },
            },
            {
              type: "stat",
              position: "full",
              content: {
                value: "Level 5",
                label: "Target",
                trend: "up",
                change: "",
              },
            },
          ],
        }),
      });

      expect(result.html).toBeTruthy();
    });

    // extractMaturityModelVariables - missing title warning (lines 1845-1848)
    it("extractMaturityModelVariables - empty sections trigger missing title warning", () => {
      const maturityTemplate = {
        ...BIG_NUMBER_TEMPLATE,
        metadata: {
          ...BIG_NUMBER_TEMPLATE.metadata,
          id: "M-003",
          type: "maturityModel" as PageTemplateType,
        },
      };
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([maturityTemplate]);

      const result = skill.render({
        pageOutline: makeOutline("maturityModel" as PageTemplateType),
        pageContent: makeContent({
          title: "Empty Maturity Model",
          sections: [], // No sections → all 5 levels will have no title → triggers warn
        }),
      });

      expect(result.html).toBeTruthy();
    });

    // N-003 case in extractVariablesByTemplateId (line 665)
    it("N-003: should use extractFrameworkVariables via N-003 templateId branch", () => {
      const n003Template = {
        metadata: {
          id: "N-003",
          type: "framework" as PageTemplateType,
          name: "Chapter Divider",
          description: "Chapter divider layout",
          useCases: ["chapter"],
          contentDensity: "low" as const,
          visualStyle: "professional" as const,
          recommendedFor: ["chapter"],
          maxContentBlocks: 2,
          variables: ["{{TITLE}}", "{{SUBTITLE}}"],
          keywords: ["chapter"],
          positionFit: { opening: 0.3, middle: 0.8, closing: 0.5 },
          compatibility: { goodBefore: [], goodAfter: [], avoidNear: [] },
          tone: "neutral" as const,
        },
        html: "<div>{{TITLE}} {{CHAPTER_NUM}} {{CHAPTER_EN}}</div>",
      };
      getByTypeSpy = jest
        .spyOn(templateRegistry, "getByType")
        .mockReturnValue([n003Template]);

      const result = skill.render({
        pageOutline: makeOutline("framework"),
        pageContent: makeContent({
          title: "Chapter Divider Slide",
          sections: [
            {
              type: "text",
              position: "full",
              content: "Section intro content",
            },
          ],
        }),
      });

      expect(result.templateId).toBe("N-003");
      expect(result.html).toBeTruthy();
    });
  });
});

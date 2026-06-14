/**
 * AgentExecutorService Unit Tests
 *
 * Tests the 4-Agent orchestration: Content, Layout, Visual, Style agents
 */

import { Test, TestingModule } from "@nestjs/testing";
import { AgentExecutorService } from "../analytics/agent-executor.service";
import { ChatFacade } from "@/modules/ai-harness/facade";

describe("AgentExecutorService", () => {
  let service: AgentExecutorService;

  const mockFacade = {
    chat: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentExecutorService,
        { provide: ChatFacade, useValue: mockFacade },
      ],
    }).compile();

    service = module.get<AgentExecutorService>(AgentExecutorService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ============ executeContentAgent ============

  describe("executeContentAgent", () => {
    it("should execute content agent and return parsed output", async () => {
      const contentAgentOutput = {
        informationArchitecture: {
          title: "Technology Trends",
          subtitle: "2026 Overview",
          heroStatement: "The future is now",
          sections: [
            {
              title: "AI",
              summary: "AI is transforming industries",
              bullets: ["Automation", "NLP"],
              metrics: [{ label: "Growth", value: "150%" }],
              sectionType: "main",
            },
          ],
          callToAction: "Learn more",
        },
        contentAnalysis: {
          type: "balanced",
          structureType: "parallel_stories",
          language: "en",
          complexity: "medium",
          wordCount: 200,
          hasData: true,
          hasTimeline: false,
          mainPointsCount: 3,
          hasSummaryConclusion: true,
        },
      };

      mockFacade.chat.mockResolvedValue({
        content: JSON.stringify(contentAgentOutput),
        tokensUsed: 200,
      });

      const result = await service.executeContentAgent(
        "Technology trends content",
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.informationArchitecture.title).toBe(
        "Technology Trends",
      );
      expect(result.executionTime).toBeGreaterThanOrEqual(0);
    });

    it("should handle JSON wrapped in markdown code fences", async () => {
      const output = {
        informationArchitecture: { title: "Test", sections: [] },
        contentAnalysis: {
          type: "balanced",
          structureType: "parallel_stories",
          language: "en",
          complexity: "low",
          wordCount: 50,
          hasData: false,
          hasTimeline: false,
          mainPointsCount: 1,
          hasSummaryConclusion: false,
        },
      };
      mockFacade.chat.mockResolvedValue({
        content: `\`\`\`json\n${JSON.stringify(output)}\n\`\`\``,
        tokensUsed: 100,
      });

      const result = await service.executeContentAgent("test content");

      expect(result.success).toBe(true);
    });

    it("should return success false when AI returns invalid JSON", async () => {
      mockFacade.chat.mockResolvedValue({
        content: "This is not JSON",
        tokensUsed: 20,
      });

      const result = await service.executeContentAgent("test content");

      expect(result.success).toBe(false);
      expect(result.data).toBeUndefined();
    });

    it("should return success false and error message when AI fails", async () => {
      mockFacade.chat.mockRejectedValue(new Error("LLM error"));

      const result = await service.executeContentAgent("test content");

      expect(result.success).toBe(false);
      expect(result.error).toBe("LLM error");
    });
  });

  // ============ executeLayoutAgent ============

  describe("executeLayoutAgent", () => {
    const contentAnalysis = {
      type: "balanced" as const,
      language: "en" as const,
      complexity: "medium" as const,
      reasoning: "Content type: balanced",
      structureType: "parallel_stories" as const,
      wordCount: 200,
      hasData: true,
      hasTimeline: false,
      mainPointsCount: 3,
      hasSummaryConclusion: false,
    };

    const informationArchitecture = {
      title: "Report",
      sections: [
        { title: "S1", summary: "", bullets: [], metrics: [] },
        { title: "S2", summary: "", bullets: [], metrics: [] },
        { title: "S3", summary: "", bullets: [], metrics: [] },
      ],
    };

    it("should execute layout agent and return parsed output", async () => {
      const layoutOutput = {
        templateLayout: "cards",
        layoutPlan: ["Use 3-column grid", "Align titles"],
        reasoning: "3 parallel sections require cards layout",
      };

      mockFacade.chat.mockResolvedValue({
        content: JSON.stringify(layoutOutput),
        tokensUsed: 100,
      });

      const result = await service.executeLayoutAgent(
        contentAnalysis,
        informationArchitecture as Parameters<
          typeof service.executeLayoutAgent
        >[1],
      );

      expect(result.success).toBe(true);
      expect(result.data!.templateLayout).toBe("cards");
    });

    it("should correct comparison template when sections > 2", async () => {
      const layoutOutput = {
        templateLayout: "comparison",
        layoutPlan: [],
        reasoning: "Comparing topics",
      };

      mockFacade.chat.mockResolvedValue({
        content: JSON.stringify(layoutOutput),
        tokensUsed: 80,
      });

      const result = await service.executeLayoutAgent(
        contentAnalysis,
        informationArchitecture as Parameters<
          typeof service.executeLayoutAgent
        >[1],
      );

      // Should be corrected from "comparison" to "cards" because sections > 2
      expect(result.success).toBe(true);
      expect(result.data!.templateLayout).toBe("cards");
    });

    it("should allow comparison template with exactly 2 sections", async () => {
      const twoSectionArch = {
        title: "Comparison",
        sections: [
          { title: "Option A", summary: "", bullets: [], metrics: [] },
          { title: "Option B", summary: "", bullets: [], metrics: [] },
        ],
      };

      const layoutOutput = {
        templateLayout: "comparison",
        layoutPlan: [],
        reasoning: "2 options to compare",
      };

      mockFacade.chat.mockResolvedValue({
        content: JSON.stringify(layoutOutput),
        tokensUsed: 80,
      });

      const result = await service.executeLayoutAgent(
        contentAnalysis,
        twoSectionArch as Parameters<typeof service.executeLayoutAgent>[1],
      );

      expect(result.data!.templateLayout).toBe("comparison");
    });

    it("should correct matrix template when sections != 4", async () => {
      const layoutOutput = {
        templateLayout: "matrix",
        layoutPlan: [],
        reasoning: "Matrix analysis",
      };

      mockFacade.chat.mockResolvedValue({
        content: JSON.stringify(layoutOutput),
        tokensUsed: 80,
      });

      const result = await service.executeLayoutAgent(
        contentAnalysis,
        informationArchitecture as Parameters<
          typeof service.executeLayoutAgent
        >[1],
      );

      // 3 sections, matrix requires 4 - should be corrected to cards
      expect(result.data!.templateLayout).toBe("cards");
    });

    it("should allow matrix template with exactly 4 sections", async () => {
      const fourSectionArch = {
        title: "Quadrant",
        sections: [
          { title: "Q1", summary: "", bullets: [], metrics: [] },
          { title: "Q2", summary: "", bullets: [], metrics: [] },
          { title: "Q3", summary: "", bullets: [], metrics: [] },
          { title: "Q4", summary: "", bullets: [], metrics: [] },
        ],
      };

      const layoutOutput = {
        templateLayout: "matrix",
        layoutPlan: [],
        reasoning: "4 quadrants matrix",
      };

      mockFacade.chat.mockResolvedValue({
        content: JSON.stringify(layoutOutput),
        tokensUsed: 80,
      });

      const result = await service.executeLayoutAgent(
        contentAnalysis,
        fourSectionArch as Parameters<typeof service.executeLayoutAgent>[1],
      );

      expect(result.data!.templateLayout).toBe("matrix");
    });

    it("should return success false on AI error", async () => {
      mockFacade.chat.mockRejectedValue(new Error("AI failed"));

      const result = await service.executeLayoutAgent(
        contentAnalysis,
        informationArchitecture as Parameters<
          typeof service.executeLayoutAgent
        >[1],
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("AI failed");
    });
  });

  // ============ executeVisualAgent ============

  describe("executeVisualAgent", () => {
    const contentAnalysis = {
      type: "data_heavy" as const,
      language: "zh" as const,
      complexity: "high" as const,
      reasoning: "Data heavy content",
    };

    it("should execute visual agent and return parsed output", async () => {
      const visualOutput = {
        backgroundDecision: {
          type: "gradient",
          reasoning: "Gradient for data content",
          colors: {
            primary: "#1e3a5f",
            secondary: "#0891b2",
            direction: "diagonal",
          },
        },
        iconMapping: { section_1: "chart" },
        chartRecommendations: [],
      };

      mockFacade.chat.mockResolvedValue({
        content: JSON.stringify(visualOutput),
        tokensUsed: 120,
      });

      const result = await service.executeVisualAgent(
        contentAnalysis,
        "cards",
        "test content preview",
      );

      expect(result.success).toBe(true);
      expect(result.data!.backgroundDecision.type).toBe("gradient");
    });

    it("should return success false on invalid JSON", async () => {
      mockFacade.chat.mockResolvedValue({
        content: "invalid json",
        tokensUsed: 10,
      });

      const result = await service.executeVisualAgent(
        contentAnalysis,
        "cards",
        "content",
      );

      expect(result.success).toBe(false);
    });
  });

  // ============ executeStyleAgent ============

  describe("executeStyleAgent", () => {
    const contentAnalysis = {
      type: "balanced" as const,
      language: "en" as const,
      complexity: "medium" as const,
      reasoning: "Balanced content",
    };

    it("should execute style agent and return parsed output", async () => {
      const styleOutput = {
        visualLanguage: {
          colorPalette: ["#1e3a5f", "#0891b2"],
          primaryColor: "#1e3a5f",
          accentColor: "#0891b2",
          backgroundColor: "#f7f9fc",
          textColor: "#1a202c",
          designStyle: "consulting",
          fontStyle: "sans",
          borderRadius: "medium",
          shadowStyle: "subtle",
        },
        designJournal: [
          { title: "Color choice", narrative: "Professional blue chosen" },
        ],
        qualityChecks: ["Colors contrast well", "Font is readable"],
      };

      mockFacade.chat.mockResolvedValue({
        content: JSON.stringify(styleOutput),
        tokensUsed: 150,
      });

      const result = await service.executeStyleAgent(
        contentAnalysis,
        "cards",
        "gradient",
        "content preview",
      );

      expect(result.success).toBe(true);
      expect(result.data!.visualLanguage.designStyle).toBe("consulting");
      expect(result.data!.qualityChecks).toHaveLength(2);
    });

    it("should return success false on AI error", async () => {
      mockFacade.chat.mockRejectedValue(new Error("Style agent failed"));

      const result = await service.executeStyleAgent(
        contentAnalysis,
        "cards",
        "gradient",
        "content",
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Style agent failed");
    });
  });

  // ============ orchestrate ============

  describe("orchestrate", () => {
    it("should orchestrate all 4 agents and return VisualSpecification", async () => {
      const contentOutput = {
        informationArchitecture: {
          title: "Tech Report",
          sections: [
            {
              title: "S1",
              summary: "Summary 1",
              bullets: [],
              metrics: [],
              sectionType: "main",
            },
            {
              title: "S2",
              summary: "Summary 2",
              bullets: [],
              metrics: [],
              sectionType: "main",
            },
          ],
        },
        contentAnalysis: {
          type: "balanced",
          structureType: "parallel_stories",
          language: "en",
          complexity: "medium",
          wordCount: 300,
          hasData: false,
          hasTimeline: false,
          mainPointsCount: 2,
          hasSummaryConclusion: false,
        },
      };

      const layoutOutput = {
        templateLayout: "cards",
        layoutPlan: ["Two columns"],
        reasoning: "2 topics need cards",
      };

      const visualOutput = {
        backgroundDecision: {
          type: "gradient",
          reasoning: "Gradient for visual appeal",
          colors: {
            primary: "#1e3a5f",
            secondary: "#0891b2",
            direction: "diagonal",
          },
        },
        iconMapping: {},
        chartRecommendations: [],
      };

      const styleOutput = {
        visualLanguage: {
          colorPalette: ["#1e3a5f"],
          primaryColor: "#1e3a5f",
          accentColor: "#0891b2",
          backgroundColor: "#f7f9fc",
          textColor: "#1a202c",
          designStyle: "consulting",
          fontStyle: "sans",
          borderRadius: "medium",
          shadowStyle: "subtle",
        },
        designJournal: [{ title: "Style", narrative: "Professional chosen" }],
        qualityChecks: ["Good contrast"],
      };

      mockFacade.chat
        .mockResolvedValueOnce({
          content: JSON.stringify(contentOutput),
          tokensUsed: 200,
        })
        .mockResolvedValueOnce({
          content: JSON.stringify(layoutOutput),
          tokensUsed: 100,
        })
        .mockResolvedValueOnce({
          content: JSON.stringify(visualOutput),
          tokensUsed: 120,
        })
        .mockResolvedValueOnce({
          content: JSON.stringify(styleOutput),
          tokensUsed: 150,
        });

      const spec = await service.orchestrate(
        "Technology trends 2026 content report",
      );

      expect(spec).toBeDefined();
      expect(spec.templateLayout).toBe("cards");
      expect(spec.backgroundDecision.type).toBe("gradient");
      expect(spec.contentAnalysis).toBeDefined();
      expect(spec.informationArchitecture.title).toBe("Tech Report");
      expect(spec.negativeKeywords).toContain("text");
    });

    it("should throw when Content Agent fails", async () => {
      mockFacade.chat.mockRejectedValue(new Error("Content agent error"));

      await expect(service.orchestrate("content")).rejects.toThrow();
    });

    it("should use default values when Layout and Style agents fail", async () => {
      const contentOutput = {
        informationArchitecture: {
          title: "Report",
          sections: [
            {
              title: "S1",
              summary: "",
              bullets: [],
              metrics: [],
              sectionType: "main",
            },
          ],
        },
        contentAnalysis: {
          type: "balanced",
          structureType: "parallel_stories",
          language: "en",
          complexity: "low",
          wordCount: 100,
          hasData: false,
          hasTimeline: false,
          mainPointsCount: 1,
          hasSummaryConclusion: false,
        },
      };

      // Content agent succeeds, others return invalid JSON
      mockFacade.chat
        .mockResolvedValueOnce({
          content: JSON.stringify(contentOutput),
          tokensUsed: 200,
        })
        .mockResolvedValueOnce({ content: "invalid", tokensUsed: 10 })
        .mockResolvedValueOnce({ content: "invalid", tokensUsed: 10 })
        .mockResolvedValueOnce({ content: "invalid", tokensUsed: 10 });

      const spec = await service.orchestrate("content");

      // Should use defaults when agents return invalid JSON
      expect(spec.templateLayout).toBe("cards"); // default
      expect(spec.backgroundDecision).toBeDefined(); // default background
    });

    it("should add imagePrompt when background type is ai_generated", async () => {
      const contentOutput = {
        informationArchitecture: { title: "Report", sections: [] },
        contentAnalysis: {
          type: "balanced",
          structureType: "parallel_stories",
          language: "en",
          complexity: "low",
          wordCount: 50,
          hasData: false,
          hasTimeline: false,
          mainPointsCount: 0,
          hasSummaryConclusion: false,
        },
      };

      const layoutOutput = {
        templateLayout: "cards",
        layoutPlan: [],
        reasoning: "default",
      };

      const visualOutput = {
        backgroundDecision: {
          type: "ai_generated",
          reasoning: "Marketing content",
          colors: {
            primary: "#ff0000",
            secondary: "#0000ff",
            direction: "radial",
          },
          aiConfig: {
            prompt: "Abstract tech background",
            style: "abstract",
            colorTone: "cool",
            complexity: "moderate",
          },
        },
        iconMapping: {},
        chartRecommendations: [],
      };

      const styleOutput = {
        visualLanguage: {
          colorPalette: [],
          primaryColor: "#1e3a5f",
          accentColor: "#0891b2",
          backgroundColor: "#fff",
          textColor: "#000",
          designStyle: "tech",
          fontStyle: "sans",
          borderRadius: "medium",
          shadowStyle: "subtle",
        },
        designJournal: [],
        qualityChecks: [],
      };

      mockFacade.chat
        .mockResolvedValueOnce({
          content: JSON.stringify(contentOutput),
          tokensUsed: 100,
        })
        .mockResolvedValueOnce({
          content: JSON.stringify(layoutOutput),
          tokensUsed: 80,
        })
        .mockResolvedValueOnce({
          content: JSON.stringify(visualOutput),
          tokensUsed: 100,
        })
        .mockResolvedValueOnce({
          content: JSON.stringify(styleOutput),
          tokensUsed: 100,
        });

      const spec = await service.orchestrate("marketing content");

      expect(spec.imagePrompt).toBe("Abstract tech background");
    });
  });
});

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { AgentExecutorService } from "../agent-executor.service";
import { ChatFacade } from "@/modules/ai-harness/facade";

describe("AgentExecutorService", () => {
  let service: AgentExecutorService;
  let mockFacade: jest.Mocked<Partial<ChatFacade>>;

  const mockContentAgentResponse = {
    informationArchitecture: {
      title: "Test Title",
      subtitle: "Test Subtitle",
      heroStatement: "Hero statement",
      sections: [
        {
          title: "Section 1",
          summary: "Summary 1",
          bullets: ["Point 1", "Point 2"],
          metrics: [],
          sectionType: "main" as const,
        },
        {
          title: "Section 2",
          summary: "Summary 2",
          bullets: ["Point A"],
          metrics: [],
          sectionType: "summary" as const,
        },
      ],
      callToAction: "Take action now",
    },
    contentAnalysis: {
      type: "balanced" as const,
      structureType: "parallel_stories" as const,
      language: "zh" as const,
      complexity: "medium" as const,
      wordCount: 200,
      hasData: false,
      hasTimeline: false,
      mainPointsCount: 2,
      hasSummaryConclusion: true,
    },
  };

  const mockLayoutAgentResponse = {
    templateLayout: "cards" as const,
    layoutPlan: ["Use card layout", "3 columns"],
    reasoning: "Parallel stories work well with cards",
  };

  const mockVisualAgentResponse = {
    backgroundDecision: {
      type: "gradient" as const,
      reasoning: "Gradient adds depth",
      colors: {
        primary: "#1e3a5f",
        secondary: "#0891b2",
        direction: "diagonal" as const,
      },
    },
    iconMapping: {},
    chartRecommendations: [],
  };

  const mockStyleAgentResponse = {
    visualLanguage: {
      colorPalette: ["#1e3a5f", "#0891b2"],
      primaryColor: "#1e3a5f",
      accentColor: "#0891b2",
      backgroundColor: "#f7f9fc",
      textColor: "#1a202c",
      designStyle: "consulting" as const,
      fontStyle: "sans" as const,
      borderRadius: "medium" as const,
      shadowStyle: "subtle" as const,
    },
    designJournal: [
      {
        title: "Design Choice",
        narrative: "Consulting style chosen for professionalism",
      },
    ],
    qualityChecks: ["Color contrast verified"],
  };

  beforeEach(async () => {
    mockFacade = {
      chat: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentExecutorService,
        { provide: ChatFacade, useValue: mockFacade },
      ],
    }).compile();

    service = module.get<AgentExecutorService>(AgentExecutorService);

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  // ==================== executeContentAgent ====================

  describe("executeContentAgent", () => {
    it("should return successful result when LLM returns valid JSON", async () => {
      (mockFacade.chat as jest.Mock).mockResolvedValue({
        content: JSON.stringify(mockContentAgentResponse),
      });

      const result = await service.executeContentAgent(
        "Test content about multiple topics",
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.informationArchitecture.title).toBe("Test Title");
      expect(result.executionTime).toBeGreaterThanOrEqual(0);
    });

    it("should return success=false when LLM returns invalid JSON", async () => {
      (mockFacade.chat as jest.Mock).mockResolvedValue({
        content: "invalid json response",
      });

      const result = await service.executeContentAgent("Test content");

      expect(result.success).toBe(false);
      expect(result.data).toBeUndefined();
    });

    it("should parse markdown-wrapped JSON response", async () => {
      (mockFacade.chat as jest.Mock).mockResolvedValue({
        content:
          "```json\n" + JSON.stringify(mockContentAgentResponse) + "\n```",
      });

      const result = await service.executeContentAgent("Test content");

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it("should return error when LLM throws exception", async () => {
      (mockFacade.chat as jest.Mock).mockRejectedValue(
        new Error("LLM API error"),
      );

      const result = await service.executeContentAgent("Test content");

      expect(result.success).toBe(false);
      expect(result.error).toBe("LLM API error");
    });

    it("should include executionTime in result", async () => {
      (mockFacade.chat as jest.Mock).mockResolvedValue({
        content: JSON.stringify(mockContentAgentResponse),
      });

      const result = await service.executeContentAgent("Test content");

      expect(typeof result.executionTime).toBe("number");
      expect(result.executionTime).toBeGreaterThanOrEqual(0);
    });

    it("should handle empty LLM response content", async () => {
      (mockFacade.chat as jest.Mock).mockResolvedValue({
        content: "",
      });

      const result = await service.executeContentAgent("Test content");

      expect(result.success).toBe(false);
    });
  });

  // ==================== executeLayoutAgent ====================

  describe("executeLayoutAgent", () => {
    const contentAnalysis = mockContentAgentResponse.contentAnalysis;
    const infoArch = mockContentAgentResponse.informationArchitecture;

    it("should return successful layout result", async () => {
      (mockFacade.chat as jest.Mock).mockResolvedValue({
        content: JSON.stringify(mockLayoutAgentResponse),
      });

      const fullAnalysis = { ...contentAnalysis, reasoning: "test" };
      const result = await service.executeLayoutAgent(
        fullAnalysis as any,
        infoArch as any,
      );

      expect(result.success).toBe(true);
      expect(result.data?.templateLayout).toBe("cards");
    });

    it("should auto-correct comparison to cards when more than 2 sections", async () => {
      const comparisonResponse = {
        ...mockLayoutAgentResponse,
        templateLayout: "comparison",
        reasoning: "Comparison layout",
      };
      (mockFacade.chat as jest.Mock).mockResolvedValue({
        content: JSON.stringify(comparisonResponse),
      });

      const archWith3Sections = {
        ...infoArch,
        sections: [
          { title: "S1", bullets: [] },
          { title: "S2", bullets: [] },
          { title: "S3", bullets: [] },
        ],
      };
      const fullAnalysis = { ...contentAnalysis, reasoning: "test" };
      const result = await service.executeLayoutAgent(
        fullAnalysis as any,
        archWith3Sections as any,
      );

      expect(result.data?.templateLayout).toBe("cards");
      expect(result.data?.reasoning).toContain("Auto-corrected");
    });

    it("should allow comparison layout for exactly 2 sections", async () => {
      const comparisonResponse = {
        ...mockLayoutAgentResponse,
        templateLayout: "comparison",
        reasoning: "Comparing two items",
      };
      (mockFacade.chat as jest.Mock).mockResolvedValue({
        content: JSON.stringify(comparisonResponse),
      });

      const archWith2Sections = {
        ...infoArch,
        sections: [
          { title: "S1", bullets: [] },
          { title: "S2", bullets: [] },
        ],
      };
      const fullAnalysis = { ...contentAnalysis, reasoning: "test" };
      const result = await service.executeLayoutAgent(
        fullAnalysis as any,
        archWith2Sections as any,
      );

      expect(result.data?.templateLayout).toBe("comparison");
    });

    it("should auto-correct matrix to cards when sections count is not 4", async () => {
      const matrixResponse = {
        ...mockLayoutAgentResponse,
        templateLayout: "matrix",
        reasoning: "Matrix layout",
      };
      (mockFacade.chat as jest.Mock).mockResolvedValue({
        content: JSON.stringify(matrixResponse),
      });

      const fullAnalysis = { ...contentAnalysis, reasoning: "test" };
      const result = await service.executeLayoutAgent(
        fullAnalysis as any,
        infoArch as any,
      );

      expect(result.data?.templateLayout).toBe("cards");
      expect(result.data?.reasoning).toContain("Auto-corrected");
    });

    it("should return error result when LLM throws", async () => {
      (mockFacade.chat as jest.Mock).mockRejectedValue(
        new Error("Network error"),
      );

      const fullAnalysis = { ...contentAnalysis, reasoning: "test" };
      const result = await service.executeLayoutAgent(
        fullAnalysis as any,
        infoArch as any,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Network error");
    });
  });

  // ==================== executeVisualAgent ====================

  describe("executeVisualAgent", () => {
    const contentAnalysis = {
      ...mockContentAgentResponse.contentAnalysis,
      reasoning: "test",
    };

    it("should return successful visual result", async () => {
      (mockFacade.chat as jest.Mock).mockResolvedValue({
        content: JSON.stringify(mockVisualAgentResponse),
      });

      const result = await service.executeVisualAgent(
        contentAnalysis as any,
        "cards",
        "Test content for visual",
      );

      expect(result.success).toBe(true);
      expect(result.data?.backgroundDecision.type).toBe("gradient");
    });

    it("should truncate long content to 500 chars for context", async () => {
      const capturedCalls: string[] = [];
      (mockFacade.chat as jest.Mock).mockImplementation(({ messages }) => {
        capturedCalls.push(messages[0].content);
        return Promise.resolve({
          content: JSON.stringify(mockVisualAgentResponse),
        });
      });

      const longContent = "A".repeat(1000);
      await service.executeVisualAgent(
        contentAnalysis as any,
        "cards",
        longContent,
      );

      const context = JSON.parse(capturedCalls[0]);
      expect(context.contentPreview.length).toBeLessThanOrEqual(500);
    });

    it("should return error on LLM failure", async () => {
      (mockFacade.chat as jest.Mock).mockRejectedValue(
        new Error("Visual agent error"),
      );

      const result = await service.executeVisualAgent(
        contentAnalysis as any,
        "cards",
        "content",
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Visual agent error");
    });
  });

  // ==================== executeStyleAgent ====================

  describe("executeStyleAgent", () => {
    const contentAnalysis = {
      ...mockContentAgentResponse.contentAnalysis,
      reasoning: "test",
    };

    it("should return successful style result", async () => {
      (mockFacade.chat as jest.Mock).mockResolvedValue({
        content: JSON.stringify(mockStyleAgentResponse),
      });

      const result = await service.executeStyleAgent(
        contentAnalysis as any,
        "cards",
        "gradient",
        "Style agent content",
      );

      expect(result.success).toBe(true);
      expect(result.data?.visualLanguage.designStyle).toBe("consulting");
    });

    it("should truncate content to 300 chars for context", async () => {
      const capturedCalls: string[] = [];
      (mockFacade.chat as jest.Mock).mockImplementation(({ messages }) => {
        capturedCalls.push(messages[0].content);
        return Promise.resolve({
          content: JSON.stringify(mockStyleAgentResponse),
        });
      });

      const longContent = "B".repeat(600);
      await service.executeStyleAgent(
        contentAnalysis as any,
        "cards",
        "solid",
        longContent,
      );

      const context = JSON.parse(capturedCalls[0]);
      expect(context.contentPreview.length).toBeLessThanOrEqual(300);
    });

    it("should return error on LLM failure", async () => {
      (mockFacade.chat as jest.Mock).mockRejectedValue(
        new Error("Style error"),
      );

      const result = await service.executeStyleAgent(
        contentAnalysis as any,
        "cards",
        "gradient",
        "content",
      );

      expect(result.success).toBe(false);
    });
  });

  // ==================== orchestrate ====================

  describe("orchestrate", () => {
    it("should complete full orchestration and return VisualSpecification", async () => {
      (mockFacade.chat as jest.Mock)
        .mockResolvedValueOnce({
          content: JSON.stringify(mockContentAgentResponse),
        })
        .mockResolvedValueOnce({
          content: JSON.stringify(mockLayoutAgentResponse),
        })
        .mockResolvedValueOnce({
          content: JSON.stringify(mockVisualAgentResponse),
        })
        .mockResolvedValueOnce({
          content: JSON.stringify(mockStyleAgentResponse),
        });

      const result = await service.orchestrate(
        "Test content for orchestration",
      );

      expect(result).toBeDefined();
      expect(result.templateLayout).toBe("cards");
      expect(result.backgroundDecision.type).toBe("gradient");
      expect(result.informationArchitecture.title).toBe("Test Title");
      expect(result.negativeKeywords).toContain("text");
    });

    it("should throw when content agent fails", async () => {
      (mockFacade.chat as jest.Mock).mockRejectedValue(
        new Error("Content agent failed"),
      );

      await expect(service.orchestrate("Test content")).rejects.toThrow(
        "Content Agent failed",
      );
    });

    it("should use default layout when layout agent returns no data", async () => {
      (mockFacade.chat as jest.Mock)
        .mockResolvedValueOnce({
          content: JSON.stringify(mockContentAgentResponse),
        })
        .mockResolvedValueOnce({ content: "invalid json" })
        .mockResolvedValueOnce({
          content: JSON.stringify(mockVisualAgentResponse),
        })
        .mockResolvedValueOnce({
          content: JSON.stringify(mockStyleAgentResponse),
        });

      const result = await service.orchestrate("Test content");

      expect(result.templateLayout).toBe("cards");
    });

    it("should use default background when visual agent returns no data", async () => {
      (mockFacade.chat as jest.Mock)
        .mockResolvedValueOnce({
          content: JSON.stringify(mockContentAgentResponse),
        })
        .mockResolvedValueOnce({
          content: JSON.stringify(mockLayoutAgentResponse),
        })
        .mockResolvedValueOnce({ content: "bad json" })
        .mockResolvedValueOnce({
          content: JSON.stringify(mockStyleAgentResponse),
        });

      const result = await service.orchestrate("Test content");

      expect(result.backgroundDecision.type).toBe("gradient");
      expect(result.backgroundDecision.colors?.primary).toBe("#1e3a5f");
    });

    it("should set imagePrompt when backgroundDecision is ai_generated with aiConfig", async () => {
      const aiGeneratedVisual = {
        backgroundDecision: {
          type: "ai_generated",
          reasoning: "Marketing content needs visual impact",
          aiConfig: {
            prompt: "abstract futuristic background",
            style: "abstract",
            colorTone: "cool",
            complexity: "moderate",
          },
        },
        iconMapping: {},
        chartRecommendations: [],
      };

      (mockFacade.chat as jest.Mock)
        .mockResolvedValueOnce({
          content: JSON.stringify(mockContentAgentResponse),
        })
        .mockResolvedValueOnce({
          content: JSON.stringify(mockLayoutAgentResponse),
        })
        .mockResolvedValueOnce({ content: JSON.stringify(aiGeneratedVisual) })
        .mockResolvedValueOnce({
          content: JSON.stringify(mockStyleAgentResponse),
        });

      const result = await service.orchestrate("Marketing content");

      expect(result.imagePrompt).toBe("abstract futuristic background");
    });

    it("should use default visual language when style agent returns no data", async () => {
      (mockFacade.chat as jest.Mock)
        .mockResolvedValueOnce({
          content: JSON.stringify(mockContentAgentResponse),
        })
        .mockResolvedValueOnce({
          content: JSON.stringify(mockLayoutAgentResponse),
        })
        .mockResolvedValueOnce({
          content: JSON.stringify(mockVisualAgentResponse),
        })
        .mockResolvedValueOnce({ content: "bad json" });

      const result = await service.orchestrate("Test content");

      expect(result.visualLanguage.designStyle).toBe("consulting");
      expect(result.visualLanguage.primaryColor).toBe("#1e3a5f");
    });

    it("should include contentAnalysis with reasoning in result", async () => {
      (mockFacade.chat as jest.Mock)
        .mockResolvedValueOnce({
          content: JSON.stringify(mockContentAgentResponse),
        })
        .mockResolvedValueOnce({
          content: JSON.stringify(mockLayoutAgentResponse),
        })
        .mockResolvedValueOnce({
          content: JSON.stringify(mockVisualAgentResponse),
        })
        .mockResolvedValueOnce({
          content: JSON.stringify(mockStyleAgentResponse),
        });

      const result = await service.orchestrate("Test content");

      expect(result.contentAnalysis.reasoning).toContain("balanced");
      expect(result.contentAnalysis.reasoning).toContain("parallel_stories");
    });
  });
});

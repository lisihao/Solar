import { Test, TestingModule } from "@nestjs/testing";
import { DataSourcePlannerService } from "../data-source-planner.service";
import { ChatFacade, ToolFacade } from "@/modules/ai-harness/facade";
import { DataSourceType } from "../../../types/data-source.types";

const mockAiFacade = {
  chatStructured: jest.fn(),
  capabilityResolveTools: jest.fn(),
};

describe("DataSourcePlannerService", () => {
  let service: DataSourcePlannerService;

  beforeEach(async () => {
    jest.clearAllMocks();

    // By default, no tools are enabled (returns empty array)
    mockAiFacade.capabilityResolveTools.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataSourcePlannerService,
        { provide: ChatFacade, useValue: mockAiFacade },
        { provide: ToolFacade, useValue: mockAiFacade },
      ],
    }).compile();

    service = module.get<DataSourcePlannerService>(DataSourcePlannerService);
  });

  describe("getDataSourceCapabilities", () => {
    it("should return all data source capabilities", () => {
      const capabilities = service.getDataSourceCapabilities();

      expect(capabilities.length).toBeGreaterThan(0);

      const types = capabilities.map((c) => c.type);
      expect(types).toContain(DataSourceType.WEB);
      expect(types).toContain(DataSourceType.ACADEMIC);
      expect(types).toContain(DataSourceType.SEMANTIC_SCHOLAR);
      expect(types).toContain(DataSourceType.PUBMED);
      expect(types).toContain(DataSourceType.FINANCE_API);
      expect(types).toContain(DataSourceType.WEATHER_API);
    });

    it("should have displayName and description for all capabilities", () => {
      const capabilities = service.getDataSourceCapabilities();

      for (const cap of capabilities) {
        expect(cap.displayName).toBeTruthy();
        expect(cap.description).toBeTruthy();
        expect(cap.useCases.length).toBeGreaterThan(0);
        expect(cap.characteristics.length).toBeGreaterThan(0);
      }
    });
  });

  describe("planDataSources", () => {
    const baseInput = {
      topicName: "AI in Healthcare",
      topicType: "TECHNOLOGY_INSIGHT",
      dimensionName: "技术突破",
      dimensionDescription: "AI诊断技术的最新进展",
      availableDataSources: [DataSourceType.WEB, DataSourceType.ACADEMIC],
    };

    it("should return AI-recommended plan when AI responds with valid JSON", async () => {
      mockAiFacade.capabilityResolveTools.mockResolvedValue([
        "web-search",
        "arxiv-search",
      ]);
      mockAiFacade.chatStructured.mockResolvedValue({
        data: {
          recommendedSources: ["web", "academic"],
          sourceRationales: {
            web: "Web search for latest news",
            academic: "Academic papers for technical depth",
          },
          overallRationale: "Both web and academic sources needed",
          fallbackSources: ["hackernews"],
          searchStrategy: {
            suggestedMaxResults: 20,
            needsTimeFilter: true,
            suggestedTimeRangeDays: 90,
            needsEnrichment: true,
          },
          confidence: 88,
        },
        rawContent: "",
        model: "",
      });

      const plan = await service.planDataSources(baseInput);

      expect(plan.recommendedSources).toContain(DataSourceType.WEB);
      expect(plan.recommendedSources).toContain(DataSourceType.ACADEMIC);
      expect(plan.overallRationale).toBe(
        "Both web and academic sources needed",
      );
      expect(plan.confidence).toBe(88);
      expect(plan.searchStrategy.suggestedMaxResults).toBe(20);
      expect(plan.searchStrategy.needsTimeFilter).toBe(true);
      expect(plan.searchStrategy.suggestedTimeRangeDays).toBe(90);
      expect(plan.searchStrategy.needsEnrichment).toBe(true);
    });

    it("should filter out invalid source types from AI response", async () => {
      mockAiFacade.capabilityResolveTools.mockResolvedValue(["web-search"]);
      mockAiFacade.chatStructured.mockResolvedValue({
        data: {
          recommendedSources: ["web", "invalid-source-xyz", "fake-source"],
          sourceRationales: {},
          overallRationale: "Using web",
          fallbackSources: [],
          searchStrategy: {
            suggestedMaxResults: 25,
            needsTimeFilter: true,
            needsEnrichment: true,
          },
          confidence: 75,
        },
        rawContent: "",
        model: "",
      });

      const plan = await service.planDataSources(baseInput);

      // Only valid sources should remain
      expect(plan.recommendedSources).toContain(DataSourceType.WEB);
      expect(plan.recommendedSources).not.toContain("invalid-source-xyz");
      expect(plan.recommendedSources).not.toContain("fake-source");
    });

    it("should fall back to WEB when no valid sources in AI response", async () => {
      mockAiFacade.capabilityResolveTools.mockResolvedValue(["web-search"]);
      mockAiFacade.chatStructured.mockResolvedValue({
        data: {
          recommendedSources: ["invalid1", "invalid2"],
          sourceRationales: {},
          overallRationale: "Invalid plan",
          fallbackSources: [],
          searchStrategy: {
            suggestedMaxResults: 25,
            needsTimeFilter: true,
            needsEnrichment: true,
          },
          confidence: 50,
        },
        rawContent: "",
        model: "",
      });

      const plan = await service.planDataSources(baseInput);

      expect(plan.recommendedSources).toContain(DataSourceType.WEB);
    });

    it("should use fallback plan when chatStructured returns null data", async () => {
      mockAiFacade.capabilityResolveTools.mockResolvedValue(["web-search"]);
      mockAiFacade.chatStructured.mockResolvedValue({
        data: null,
        rawContent: "This is not valid JSON response",
        model: "",
      });

      const plan = await service.planDataSources(baseInput);

      // Fallback defaults to WEB
      expect(plan.recommendedSources).toContain(DataSourceType.WEB);
      expect(plan.confidence).toBe(50);
    });

    it("should use default plan when AI chat throws error", async () => {
      mockAiFacade.capabilityResolveTools.mockResolvedValue(["web-search"]);
      mockAiFacade.chatStructured.mockRejectedValue(new Error("LLM API error"));

      const plan = await service.planDataSources(baseInput);

      // Should fall back to default plan
      expect(plan.recommendedSources).toBeDefined();
      expect(plan.recommendedSources.length).toBeGreaterThan(0);
      expect(plan.searchStrategy).toBeDefined();
    });

    describe("getDefaultPlan - keyword-based dimension routing", () => {
      beforeEach(() => {
        // Make AI fail so we get the default plan
        mockAiFacade.chatStructured.mockRejectedValue(
          new Error("AI unavailable"),
        );
        mockAiFacade.capabilityResolveTools.mockResolvedValue([]);
      });

      it("should recommend policy sources for policy-related dimensions", async () => {
        const policyInput = {
          ...baseInput,
          dimensionName: "政策法规分析",
          dimensionDescription: "相关法规和政策变化",
        };

        const plan = await service.planDataSources(policyInput);

        expect(plan.recommendedSources).toContain(DataSourceType.WEB);
        expect(plan.recommendedSources).toContain(
          DataSourceType.FEDERAL_REGISTER,
        );
        expect(plan.recommendedSources).toContain(DataSourceType.CONGRESS);
        expect(plan.recommendedSources).toContain(DataSourceType.WHITEHOUSE);
      });

      it("should recommend policy sources for English 'regulation' dimension", async () => {
        const regInput = {
          ...baseInput,
          dimensionName: "AI Regulation Overview",
          dimensionDescription: "Regulatory landscape analysis",
        };

        const plan = await service.planDataSources(regInput);

        expect(plan.recommendedSources).toContain(
          DataSourceType.FEDERAL_REGISTER,
        );
      });

      it("should recommend policy sources for English 'policy' dimension", async () => {
        const policyEnInput = {
          ...baseInput,
          dimensionName: "Government Policy Analysis",
          dimensionDescription: "Policy trends",
        };

        const plan = await service.planDataSources(policyEnInput);

        expect(plan.recommendedSources).toContain(
          DataSourceType.FEDERAL_REGISTER,
        );
      });

      it("should recommend technical sources for technology dimensions", async () => {
        const techInput = {
          ...baseInput,
          dimensionName: "核心技术架构",
          dimensionDescription: "底层技术实现细节",
        };

        const plan = await service.planDataSources(techInput);

        expect(plan.recommendedSources).toContain(DataSourceType.ACADEMIC);
        expect(plan.recommendedSources).toContain(DataSourceType.GITHUB);
        expect(plan.recommendedSources).toContain(DataSourceType.HACKERNEWS);
      });

      it("should recommend tech sources for TECHNOLOGY_INSIGHT topic type", async () => {
        const techTopicInput = {
          ...baseInput,
          topicType: "TECHNOLOGY_INSIGHT",
          dimensionName: "Overview",
          dimensionDescription: "General overview",
        };

        const plan = await service.planDataSources(techTopicInput);

        expect(plan.recommendedSources).toContain(DataSourceType.ACADEMIC);
        expect(plan.recommendedSources).toContain(DataSourceType.GITHUB);
      });

      it("should recommend market sources for market-related dimensions", async () => {
        const marketInput = {
          ...baseInput,
          topicType: "COMPANY_INSIGHT",
          dimensionName: "市场竞争格局",
          dimensionDescription: "行业市场竞争分析",
        };

        const plan = await service.planDataSources(marketInput);

        expect(plan.recommendedSources).toContain(DataSourceType.WEB);
        expect(plan.recommendedSources).toContain(DataSourceType.HACKERNEWS);
      });

      it("should recommend market sources for investment-related dimensions", async () => {
        const investInput = {
          ...baseInput,
          topicType: "MACRO_INSIGHT",
          dimensionName: "投资风险评估",
          dimensionDescription: "Investment risk analysis",
        };

        const plan = await service.planDataSources(investInput);

        expect(plan.recommendedSources).toContain(DataSourceType.WEB);
        expect(plan.recommendedSources).toContain(DataSourceType.HACKERNEWS);
      });

      it("should default to WEB for unrecognized dimensions", async () => {
        const generalInput = {
          ...baseInput,
          topicType: "MACRO_INSIGHT",
          dimensionName: "概述",
          dimensionDescription: "General overview",
        };

        const plan = await service.planDataSources(generalInput);

        expect(plan.recommendedSources).toContain(DataSourceType.WEB);
      });

      it("should always include fallback sources", async () => {
        const plan = await service.planDataSources(baseInput);

        expect(plan.fallbackSources).toBeDefined();
        expect(plan.searchStrategy.suggestedMaxResults).toBe(25);
        expect(plan.searchStrategy.needsTimeFilter).toBe(true);
        expect(plan.searchStrategy.suggestedTimeRangeDays).toBe(180);
        expect(plan.searchStrategy.needsEnrichment).toBe(true);
        expect(plan.confidence).toBe(60);
      });

      it("should include dimensionName in overallRationale", async () => {
        const plan = await service.planDataSources({
          ...baseInput,
          dimensionName: "技术分析",
        });

        expect(plan.overallRationale).toContain("技术分析");
      });
    });

    it("should call AI facade with correct modelType and taskProfile", async () => {
      mockAiFacade.capabilityResolveTools.mockResolvedValue(["web-search"]);
      mockAiFacade.chatStructured.mockResolvedValue({
        data: {
          recommendedSources: ["web"],
          sourceRationales: {},
          overallRationale: "test",
          confidence: 70,
        },
        rawContent: "",
        model: "",
      });

      await service.planDataSources(baseInput);

      expect(mockAiFacade.chatStructured).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "user" }),
          ]),
          taskProfile: expect.objectContaining({
            creativity: "low",
            outputLength: "medium",
          }),
        }),
      );
    });

    it("should handle parsed data correctly", async () => {
      mockAiFacade.capabilityResolveTools.mockResolvedValue(["web-search"]);
      mockAiFacade.chatStructured.mockResolvedValue({
        data: {
          recommendedSources: ["web"],
          sourceRationales: { web: "Good for general search" },
          overallRationale: "Web is best",
          fallbackSources: [],
          searchStrategy: {
            suggestedMaxResults: 25,
            needsTimeFilter: true,
            needsEnrichment: true,
          },
          confidence: 70,
        },
        rawContent: "",
        model: "",
      });

      const plan = await service.planDataSources(baseInput);

      expect(plan.recommendedSources).toContain(DataSourceType.WEB);
      expect(plan.overallRationale).toBe("Web is best");
    });

    it("should apply defaults when searchStrategy fields are missing", async () => {
      mockAiFacade.capabilityResolveTools.mockResolvedValue(["web-search"]);
      mockAiFacade.chatStructured.mockResolvedValue({
        data: {
          recommendedSources: ["web"],
          sourceRationales: {},
          overallRationale: "Web only",
          fallbackSources: [],
          searchStrategy: {},
        },
        rawContent: "",
        model: "",
      });

      const plan = await service.planDataSources(baseInput);

      expect(plan.searchStrategy.suggestedMaxResults).toBe(25);
      expect(plan.searchStrategy.needsTimeFilter).toBe(true);
      expect(plan.searchStrategy.suggestedTimeRangeDays).toBe(180);
      expect(plan.searchStrategy.needsEnrichment).toBe(true);
      expect(plan.confidence).toBe(70);
    });
  });
});

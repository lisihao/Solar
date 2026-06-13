import { Test, TestingModule } from "@nestjs/testing";
import { AIAssistService } from "../ai-assist.service";
import { ExternalDataService } from "../external-data.service";
import { ChatFacade } from "@/modules/ai-harness/facade/domain/chat.facade";

describe("AIAssistService", () => {
  let service: AIAssistService;
  let externalData: jest.Mocked<ExternalDataService>;
  let chatFacade: jest.Mocked<ChatFacade>;

  const mockAvailableModels = [
    { id: "model-1", name: "Test Model", provider: "openai", modelId: "gpt-4" },
  ];

  beforeEach(async () => {
    const mockExternalData = {
      fetchFromProvider: jest.fn(),
      getSnapshot: jest.fn(),
    };

    const mockChatFacade = {
      chat: jest.fn(),
      getAvailableModels: jest.fn().mockResolvedValue(mockAvailableModels),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AIAssistService,
        { provide: ExternalDataService, useValue: mockExternalData },
        { provide: ChatFacade, useValue: mockChatFacade },
      ],
    }).compile();

    service = module.get<AIAssistService>(AIAssistService);
    externalData = module.get(ExternalDataService);
    chatFacade = module.get(ChatFacade);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("analyzeIndustry", () => {
    it("should return LLM analysis when successful", async () => {
      const mockAnalysis = {
        companies: [
          {
            name: "Company A",
            type: "competitor",
            market: "Global",
            reason: "Leader",
          },
        ],
        agents: [{ role: "Regulator", team: "WHITE", reason: "Compliance" }],
        goals: { targetShare: "25%", risk: "medium", growth: "aggressive" },
        insights: ["Market is growing"],
      };

      (chatFacade.chat as jest.Mock).mockResolvedValue({
        content: JSON.stringify(mockAnalysis),
      });

      const result = await service.analyzeIndustry({ industry: "SaaS" });

      expect(result).toHaveProperty("companies");
      expect(result).toHaveProperty("agents");
      expect(result).toHaveProperty("goals");
      expect(result).toHaveProperty("insights");
    });

    it("should fall back to default when no models available", async () => {
      (chatFacade.getAvailableModels as jest.Mock).mockResolvedValue([]);

      const result = await service.analyzeIndustry({ industry: "SaaS" });

      expect(result).toHaveProperty("companies");
      expect(result.companies.length).toBeGreaterThan(0);
    });

    it("should fall back to default when LLM fails", async () => {
      (chatFacade.chat as jest.Mock).mockRejectedValue(new Error("LLM failed"));

      const result = await service.analyzeIndustry({ industry: "SaaS" });

      expect(result).toHaveProperty("companies");
      expect(result.insights).toEqual(
        expect.arrayContaining([expect.stringContaining("AI分析暂时不可用")]),
      );
    });

    it("should fall back when LLM returns invalid JSON", async () => {
      (chatFacade.chat as jest.Mock).mockResolvedValue({
        content: "Not valid JSON",
      });

      const result = await service.analyzeIndustry({ industry: "SaaS" });

      expect(result).toHaveProperty("companies");
    });

    it("should fall back when LLM returns error message", async () => {
      (chatFacade.chat as jest.Mock).mockResolvedValue({
        content: "**API Key 未配置** - 请配置API密钥",
      });

      const result = await service.analyzeIndustry({ industry: "SaaS" });

      // Should get default template response
      expect(result).toHaveProperty("companies");
      expect(result.companies.length).toBeGreaterThan(0);
    });

    it("should use region in analysis", async () => {
      (chatFacade.chat as jest.Mock).mockResolvedValue({
        content: JSON.stringify({
          companies: [],
          agents: [],
          goals: { targetShare: "10%", risk: "low", growth: "steady" },
          insights: ["Regional market"],
        }),
      });

      await service.analyzeIndustry({ industry: "SaaS", region: "China" });

      expect(chatFacade.chat).toHaveBeenCalled();
    });
  });

  describe("suggestAgents", () => {
    it("should suggest agents for different company types", async () => {
      (chatFacade.chat as jest.Mock).mockResolvedValue({
        content: JSON.stringify({
          companies: [],
          agents: [
            { role: "监管官员", team: "WHITE", reason: "Compliance" },
            { role: "行业分析师", team: "WHITE", reason: "Market analysis" },
          ],
          goals: { targetShare: "20%", risk: "medium", growth: "moderate" },
          insights: ["Industry growing"],
        }),
      });

      const companies = [
        { name: "CompetitorA", type: "competitor" },
        { name: "CustomerB", type: "customer" },
        { name: "SupplierC", type: "supplier" },
      ];

      const result = await service.suggestAgents({
        industry: "SaaS",
        companies,
      });

      expect(Array.isArray(result)).toBe(true);
      // RED team agents for competitors
      const redAgents = result.filter((a) => a.team === "RED");
      expect(redAgents.length).toBeGreaterThan(0);
    });

    it("should exclude blue army companies from suggestions", async () => {
      (chatFacade.chat as jest.Mock).mockResolvedValue({
        content: JSON.stringify({
          companies: [],
          agents: [],
          goals: { targetShare: "20%", risk: "medium", growth: "moderate" },
          insights: [],
        }),
      });

      const companies = [
        { name: "MyCompany", type: "benchmark" },
        { name: "Competitor", type: "competitor" },
      ];

      const existingAgents = [
        { role: "CEO", team: "BLUE", companyName: "MyCompany" },
      ];

      const result = await service.suggestAgents({
        industry: "SaaS",
        companies,
        existingAgents,
      });

      // Suggestions for BLUE company should not appear
      const blueMyCompanyAgents = result.filter(
        (a) => a.companyName?.toLowerCase() === "mycompany",
      );
      expect(blueMyCompanyAgents.length).toBe(0);
    });

    it("should not duplicate existing agents", async () => {
      (chatFacade.chat as jest.Mock).mockResolvedValue({
        content: JSON.stringify({
          companies: [],
          agents: [{ role: "CEO", team: "RED", reason: "Leader" }],
          goals: { targetShare: "20%", risk: "medium", growth: "moderate" },
          insights: [],
        }),
      });

      const companies = [{ name: "Competitor", type: "competitor" }];
      const existingAgents = [
        { role: "CEO", team: "RED", companyName: "Competitor" },
      ];

      const result = await service.suggestAgents({
        industry: "SaaS",
        companies,
        existingAgents,
      });

      // CEO for Competitor already exists, should not be suggested again
      const duplicateCEO = result.filter(
        (a) => a.role === "CEO" && a.companyName === "Competitor",
      );
      expect(duplicateCEO.length).toBe(0);
    });
  });

  describe("generateScenarioSuggestions", () => {
    it("should return scenario suggestions for industry", async () => {
      (chatFacade.chat as jest.Mock).mockResolvedValue({
        content: JSON.stringify({
          companies: [
            {
              name: "Company A",
              type: "competitor",
              market: "Global",
              reason: "Big player",
            },
          ],
          agents: [],
          goals: { targetShare: "20%", risk: "medium", growth: "moderate" },
          insights: ["Key risk 1", "Key risk 2", "Key risk 3"],
        }),
      });

      const result = await service.generateScenarioSuggestions({
        industry: "SaaS",
      });

      expect(result).toHaveProperty("name");
      expect(result).toHaveProperty("description");
      expect(result).toHaveProperty("recommendedRounds");
      expect(result).toHaveProperty("chaosProb");
      expect(result).toHaveProperty("humanBreakEvery");
      expect(result).toHaveProperty("keyRisks");
    });

    it("should recommend more rounds for high-risk industries", async () => {
      (chatFacade.chat as jest.Mock).mockResolvedValue({
        content: JSON.stringify({
          companies: [],
          agents: [],
          goals: { targetShare: "20%", risk: "high", growth: "aggressive" },
          insights: [],
        }),
      });

      const semiResult = await service.generateScenarioSuggestions({
        industry: "Semiconductor",
      });
      const saasResult = await service.generateScenarioSuggestions({
        industry: "SaaS",
      });

      expect(semiResult.recommendedRounds).toBeGreaterThan(
        saasResult.recommendedRounds,
      );
    });
  });

  describe("generateCompanyMetrics", () => {
    it("should return metrics for a company", async () => {
      (externalData.fetchFromProvider as jest.Mock).mockResolvedValue({
        ok: false,
        data: null,
        providerId: null,
      });
      (chatFacade.getAvailableModels as jest.Mock).mockResolvedValue(
        mockAvailableModels,
      );
      (chatFacade.chat as jest.Mock).mockResolvedValue({
        content: JSON.stringify({
          metrics: {
            cash: 50000,
            share: 25,
            margin: 40,
            debt: 10000,
            capacity: 5000,
            inventory: 500,
            priceBand: "高端",
            delivery: "2-4周",
            patents: 500,
            channels: "直销+代理",
            brand: "global_leader",
          },
          reasoning: "Based on industry benchmarks",
        }),
      });

      const result = await service.generateCompanyMetrics({
        companyName: "Apple",
        companyType: "benchmark",
        industry: "Technology",
      });

      expect(result).toHaveProperty("metrics");
      expect(result).toHaveProperty("reasoning");
      expect(result.metrics.cash).toBeGreaterThan(0);
    });

    it("should fall back to template when LLM fails", async () => {
      (externalData.fetchFromProvider as jest.Mock).mockResolvedValue({
        ok: false,
        data: null,
        providerId: null,
      });
      (chatFacade.getAvailableModels as jest.Mock).mockResolvedValue(
        mockAvailableModels,
      );
      (chatFacade.chat as jest.Mock).mockResolvedValue({
        content: "**API Error** - not valid",
      });

      const result = await service.generateCompanyMetrics({
        companyName: "StartupX",
        companyType: "startup",
        industry: "SaaS",
      });

      expect(result).toHaveProperty("metrics");
      expect(result).toHaveProperty("dataSource", "Local Template (Fallback)");
    });

    it("should apply industry modifiers for semiconductor companies", async () => {
      (externalData.fetchFromProvider as jest.Mock).mockResolvedValue({
        ok: false,
        data: null,
      });
      (chatFacade.getAvailableModels as jest.Mock).mockResolvedValue([]);

      const result = await service.generateCompanyMetrics({
        companyName: "TestCo",
        companyType: "benchmark",
        industry: "Semiconductor",
      });

      // Semiconductor has cashMultiplier: 3, so cash should be higher than base template
      expect(result.metrics.cash).toBeGreaterThan(0);
      expect(result).toHaveProperty("dataSource", "Local Template (Fallback)");
    });

    it("should apply China regional adjustment", async () => {
      (externalData.fetchFromProvider as jest.Mock).mockResolvedValue({
        ok: false,
        data: null,
      });
      (chatFacade.getAvailableModels as jest.Mock).mockResolvedValue([]);

      const result = await service.generateCompanyMetrics({
        companyName: "ChinaCo",
        companyType: "regional",
        industry: "E-commerce",
        market: "China",
      });

      // China market should result in higher share (up to 80%)
      expect(result.metrics.share).toBeGreaterThan(0);
    });

    it("should use external data source when available", async () => {
      (externalData.fetchFromProvider as jest.Mock).mockResolvedValue({
        ok: true,
        data: { revenue: 100000, marketShare: 30 },
        providerId: "finance-api",
      });
      (chatFacade.getAvailableModels as jest.Mock).mockResolvedValue(
        mockAvailableModels,
      );
      (chatFacade.chat as jest.Mock).mockResolvedValue({
        content: JSON.stringify({
          metrics: {
            cash: 75000,
            share: 30,
            margin: 45,
            debt: 15000,
            capacity: 8000,
            inventory: 800,
            priceBand: "高端",
            delivery: "2-4周",
            patents: 1000,
            channels: "直销",
            brand: "global_leader",
          },
          reasoning: "Based on external data from finance API",
        }),
      });

      const result = await service.generateCompanyMetrics({
        companyName: "Microsoft",
        companyType: "benchmark",
        industry: "Cloud Services",
      });

      expect(result).toHaveProperty("dataSource", "LLM + External API");
    });
  });

  describe("suggestParams", () => {
    it("should return default params for standard industry", async () => {
      const result = await service.suggestParams({ industry: "Retail" });

      expect(result).toHaveProperty("blindMove");
      expect(result).toHaveProperty("cot");
      expect(result).toHaveProperty("chaosProb");
      expect(result).toHaveProperty("irrationalProb");
      expect(result).toHaveProperty("humanBreakEvery");
      expect(result).toHaveProperty("rounds");
      expect(result).toHaveProperty("enabledEvents");
      expect(result).toHaveProperty("reasoning");
    });

    it("should increase chaos probability for semiconductor industry", async () => {
      const semiResult = await service.suggestParams({
        industry: "Semiconductor",
      });
      const retailResult = await service.suggestParams({ industry: "Retail" });

      expect(semiResult.chaosProb).toBeGreaterThan(retailResult.chaosProb);
    });

    it("should recommend more rounds for high-volatility industries", async () => {
      const highVolResult = await service.suggestParams({
        industry: "AI Compute Infrastructure",
      });
      const lowVolResult = await service.suggestParams({ industry: "Gaming" });

      expect(highVolResult.rounds).toBeGreaterThan(lowVolResult.rounds);
    });

    it("should require more frequent human review for high-regulation industries", async () => {
      const regulatedResult = await service.suggestParams({
        industry: "Fintech",
      });
      const standardResult = await service.suggestParams({ industry: "SaaS" });

      expect(regulatedResult.humanBreakEvery).toBeLessThanOrEqual(
        standardResult.humanBreakEvery,
      );
    });

    it("should increase rounds for many companies", async () => {
      const manyCompanyResult = await service.suggestParams({
        industry: "Retail",
        companyCount: 5,
      });
      const fewCompanyResult = await service.suggestParams({
        industry: "Retail",
        companyCount: 2,
      });

      expect(manyCompanyResult.rounds).toBeGreaterThan(fewCompanyResult.rounds);
    });

    it("should add extra chaos for China region", async () => {
      const chinaResult = await service.suggestParams({
        industry: "SaaS",
        region: "China",
      });
      const globalResult = await service.suggestParams({
        industry: "SaaS",
        region: "Global",
      });

      expect(chinaResult.chaosProb).toBeGreaterThan(globalResult.chaosProb);
    });

    it("should include enabled events for volatile industries", async () => {
      const result = await service.suggestParams({ industry: "Semiconductor" });

      expect(result.enabledEvents).toContain("supply_chain");
    });

    it("should enable tech and finance events for high volatility", async () => {
      const result = await service.suggestParams({
        industry: "AI Compute Infrastructure",
      });

      expect(result.enabledEvents).toContain("tech");
      expect(result.enabledEvents).toContain("finance");
    });

    it("should add disaster and talent events for geopolitical industries", async () => {
      const result = await service.suggestParams({ industry: "Semiconductor" });

      expect(result.enabledEvents).toContain("disaster");
      expect(result.enabledEvents).toContain("talent");
    });
  });
});

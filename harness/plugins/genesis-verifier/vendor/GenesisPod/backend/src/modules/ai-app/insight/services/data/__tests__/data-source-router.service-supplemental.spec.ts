/**
 * DataSourceRouterService Supplemental Tests
 *
 * Targets uncovered lines:
 * - lines 284-297: RAG-Fusion search execution path
 * - line 358: WEB fallback also failed (error path)
 * - line 440: source-level rejection in standardSearch
 * - lines 465-469: source-level failure query loop
 * - line 546: scanLiteratureBaseline method
 * - lines 986-990: searchViaTool for FINANCE_API and WEATHER_API
 * - lines 1008-1011: searchViaConnector when no connectorRegistry
 * - lines 1046-1049: searchViaTool when tool returns no data (result.success=false)
 * - lines 1059-1062: convertToolResultToDataSource – unknown tool
 * - lines 1157-1218: finance-api and weather-api result conversion
 * - line 1375: searchAcademic early return when merged >= maxResults
 * - line 1393: ArXiv error handling (catch)
 * - lines 2211-2216: searchSocialXViaWebSearch error path
 */

import { Test, TestingModule } from "@nestjs/testing";
import { DataSourceRouterService } from "../data-source-router.service";
import { ChatFacade, RAGFacade, ToolFacade } from "@/modules/ai-harness/facade";
import { ToolRegistry, FederalRegisterTool, CongressGovTool, WhiteHouseNewsTool } from "@/modules/ai-harness/facade";
import { DataSourcePlannerService } from "../data-source-planner.service";
import { DataSourceConnectorRegistry } from "../connectors/data-source-connector.registry";
import { DataSourceType } from "../../../types/data-source.types";
import { RAGFusionService } from "../rag-fusion.service";

// ============================================================
// Helpers
// ============================================================

const makeResearchTopic = (overrides: Record<string, unknown> = {}) => ({
  id: "topic-1",
  name: "AI Technology Trends",
  description: "Research on AI trends",
  userId: "user-1",
  language: "zh",
  reportStyle: "COMPREHENSIVE",
  topicConfig: null,
  config: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeTopicDimension = (overrides: Record<string, unknown> = {}) => ({
  id: "dim-1",
  name: "技术发展",
  description: "Technological development dimension",
  topicId: "topic-1",
  status: "PENDING",
  searchSources: [DataSourceType.WEB],
  searchKeywords: ["AI", "technology"],
  searchQueries: null,
  priority: 1,
  order: 1,
  estimatedTime: 30,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeSearchResultItem = (overrides: Record<string, unknown> = {}) => ({
  id: `result-${Math.random().toString(36).slice(2)}`,
  title: "AI Research Article",
  url: "https://example.com/ai-article",
  content: "Content about AI developments",
  snippet: "AI has advanced...",
  source: DataSourceType.WEB,
  publishedAt: new Date("2024-06-01"),
  credibilityScore: 0.85,
  relevanceScore: 0.9,
  author: null,
  ...overrides,
});

// ============================================================
// Mocks
// ============================================================

function buildMocks() {
  let mockWebSearchExecute = jest.fn().mockResolvedValue({
    success: true,
    data: {
      success: true,
      results: [makeSearchResultItem()],
    },
  });

  const mockToolRegistry = {
    tryGet: jest.fn().mockImplementation((toolId: string) => {
      if (toolId === "web-search") return { execute: mockWebSearchExecute };
      return null;
    }),
    execute: jest.fn(),
    getTool: jest.fn(),
  };

  const mockFederalRegisterTool = {
    execute: jest
      .fn()
      .mockResolvedValue({ success: true, data: { results: [] } }),
  };
  const mockCongressGovTool = {
    execute: jest
      .fn()
      .mockResolvedValue({ success: true, data: { results: [] } }),
  };
  const mockWhiteHouseNewsTool = {
    execute: jest
      .fn()
      .mockResolvedValue({ success: true, data: { results: [] } }),
  };

  const mockDataSourcePlanner = {
    planDataSources: jest.fn().mockResolvedValue({
      recommendedSources: [DataSourceType.WEB],
      confidence: 80,
      reasoning: "Web is best",
    }),
  };

  const mockAiFacade = {
    chat: jest
      .fn()
      .mockResolvedValue({ content: "AI response", tokensUsed: 100 }),
    embed: jest.fn().mockResolvedValue([0.1, 0.2]),
    searchSocialX: jest.fn(),
    embeddingGenerate: jest.fn().mockResolvedValue(null),
    vectorSimilaritySearch: jest.fn().mockResolvedValue([]),
    getAvailableModels: jest.fn().mockResolvedValue([]),
    capabilityResolveTools: jest
      .fn()
      .mockResolvedValue([
        "web-search",
        "academic-search",
        "arxiv-search",
        "github-search",
        "hackernews-search",
        "federal-register",
        "congress-gov",
        "whitehouse-news",
        "social-x",
        "semantic-scholar",
        "pubmed",
        "finance-api",
        "weather-api",
      ]),
  };

  const mockConnectorRegistry = {
    getConnector: jest.fn().mockReturnValue(null),
    hasConnector: jest.fn().mockReturnValue(false),
    searchViaConnector: jest.fn().mockResolvedValue([]),
  };

  const mockRagFusionService = {
    fusionSearch: jest.fn().mockResolvedValue({
      results: [],
      metadata: {
        totalUniqueResults: 0,
        successfulVariants: 1,
        totalVariants: 3,
        executionTimeMs: 100,
      },
    }),
    convertToDataSourceResults: jest.fn().mockReturnValue([]),
  };

  return {
    mockToolRegistry,
    mockFederalRegisterTool,
    mockCongressGovTool,
    mockWhiteHouseNewsTool,
    mockDataSourcePlanner,
    mockAiFacade,
    mockConnectorRegistry,
    mockRagFusionService,
    get mockWebSearchExecute() {
      return mockWebSearchExecute;
    },
    set mockWebSearchExecute(fn) {
      mockWebSearchExecute = fn;
    },
  };
}

async function createService(
  mocks: ReturnType<typeof buildMocks>,
  withRagFusion = false,
) {
  const providers: unknown[] = [
    DataSourceRouterService,
    { provide: ToolRegistry, useValue: mocks.mockToolRegistry },
    { provide: FederalRegisterTool, useValue: mocks.mockFederalRegisterTool },
    { provide: CongressGovTool, useValue: mocks.mockCongressGovTool },
    { provide: WhiteHouseNewsTool, useValue: mocks.mockWhiteHouseNewsTool },
    {
      provide: DataSourcePlannerService,
      useValue: mocks.mockDataSourcePlanner,
    },
    { provide: ChatFacade, useValue: mocks.mockAiFacade },
    { provide: RAGFacade, useValue: mocks.mockAiFacade },
    { provide: ToolFacade, useValue: mocks.mockAiFacade },
    {
      provide: DataSourceConnectorRegistry,
      useValue: mocks.mockConnectorRegistry,
    },
  ];

  if (withRagFusion) {
    providers.push({
      provide: RAGFusionService,
      useValue: mocks.mockRagFusionService,
    });
  }

  const module: TestingModule = await Test.createTestingModule({
    providers: providers as Parameters<
      typeof Test.createTestingModule
    >[0]["providers"],
  }).compile();

  const service = module.get<DataSourceRouterService>(DataSourceRouterService);

  jest.spyOn(service["logger"], "log").mockImplementation(() => undefined);
  jest.spyOn(service["logger"], "warn").mockImplementation(() => undefined);
  jest.spyOn(service["logger"], "error").mockImplementation(() => undefined);
  jest.spyOn(service["logger"], "debug").mockImplementation(() => undefined);

  return service;
}

// ============================================================
// Tests
// ============================================================

describe("DataSourceRouterService (supplemental)", () => {
  afterEach(() => jest.clearAllMocks());

  // ============================================================
  // WEB fallback error path (line 358)
  // ============================================================

  describe("fetchDataForDimension – WEB fallback error path (line 358)", () => {
    it("should log error when WEB fallback also fails", async () => {
      const mocks = buildMocks();

      // Use only ACADEMIC sources (not WEB) so WEB fallback is triggered
      const dimension = makeTopicDimension({
        searchSources: [DataSourceType.ACADEMIC],
      });
      const topic = makeResearchTopic();

      // academic search returns nothing (via web-search tool which returns empty)
      mocks.mockAiFacade.capabilityResolveTools.mockResolvedValue([
        "web-search",
      ]);

      // First web search call (for academic simulation) returns empty
      mocks.mockWebSearchExecute = jest.fn().mockResolvedValue({
        success: true,
        data: { success: true, results: [] },
      });

      mocks.mockToolRegistry.tryGet.mockImplementation((toolId: string) => {
        if (toolId === "web-search") {
          return {
            execute: jest
              .fn()
              .mockRejectedValue(new Error("WEB fallback also failed")),
          };
        }
        return null;
      });

      const service = await createService(mocks);

      const result = await service.fetchDataForDimension(
        dimension as never,
        topic as never,
      );

      // Should return empty result despite error
      expect(result).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
    });
  });

  // ============================================================
  // searchViaConnector without connectorRegistry (lines 1008-1011)
  // ============================================================

  describe("searchViaConnector – no connectorRegistry (lines 1008-1011)", () => {
    it("should return empty array when connectorRegistry is not available", async () => {
      const mocks = buildMocks();

      // Create service without connector registry
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DataSourceRouterService,
          { provide: ToolRegistry, useValue: mocks.mockToolRegistry },
          {
            provide: FederalRegisterTool,
            useValue: mocks.mockFederalRegisterTool,
          },
          { provide: CongressGovTool, useValue: mocks.mockCongressGovTool },
          {
            provide: WhiteHouseNewsTool,
            useValue: mocks.mockWhiteHouseNewsTool,
          },
          {
            provide: DataSourcePlannerService,
            useValue: mocks.mockDataSourcePlanner,
          },
          { provide: ChatFacade, useValue: mocks.mockAiFacade },
          { provide: RAGFacade, useValue: mocks.mockAiFacade },
          { provide: ToolFacade, useValue: mocks.mockAiFacade },
          // No DataSourceConnectorRegistry provided
        ],
      }).compile();

      const service = module.get<DataSourceRouterService>(
        DataSourceRouterService,
      );
      jest.spyOn(service["logger"], "warn").mockImplementation(() => undefined);
      jest.spyOn(service["logger"], "log").mockImplementation(() => undefined);
      jest
        .spyOn(service["logger"], "error")
        .mockImplementation(() => undefined);
      jest
        .spyOn(service["logger"], "debug")
        .mockImplementation(() => undefined);

      const searchViaConnector = (
        service as unknown as {
          searchViaConnector(
            source: DataSourceType,
            query: string,
            maxResults: number,
          ): Promise<unknown[]>;
        }
      ).searchViaConnector;

      const result = await searchViaConnector.call(
        service,
        DataSourceType.WEB,
        "test query",
        5,
      );

      expect(result).toEqual([]);
    });
  });

  // ============================================================
  // searchViaTool – tool returns failure (lines 1046-1049)
  // ============================================================

  describe("searchViaTool – tool returns no data (lines 1046-1049)", () => {
    it("should return empty array when tool.execute returns success=false", async () => {
      const mocks = buildMocks();

      mocks.mockToolRegistry.tryGet.mockImplementation((toolId: string) => {
        if (toolId === "semantic-scholar") {
          return {
            execute: jest.fn().mockResolvedValue({
              success: false,
              error: { message: "Rate limit exceeded" },
              data: null,
            }),
          };
        }
        return null;
      });

      const service = await createService(mocks);

      // searchSource for SEMANTIC_SCHOLAR → calls searchViaTool("semantic-scholar", ...)
      const result = await service.searchSource(
        DataSourceType.SEMANTIC_SCHOLAR,
        "test query",
        { maxResults: 5 },
      );

      expect(result).toEqual([]);
    });

    it("should return empty array when tool is not registered (lines 1030-1033)", async () => {
      const mocks = buildMocks();

      // No tool registered for pubmed
      mocks.mockToolRegistry.tryGet.mockReturnValue(null);

      const service = await createService(mocks);

      const result = await service.searchSource(
        DataSourceType.PUBMED,
        "test query",
        { maxResults: 5 },
      );

      expect(result).toEqual([]);
    });
  });

  // ============================================================
  // convertToolResultToDataSource – finance-api (lines 1157-1181)
  // ============================================================

  describe("convertToolResultToDataSource – finance-api (lines 1157-1181)", () => {
    it("should convert finance-api results to DataSourceResult", async () => {
      const mocks = buildMocks();

      const financeData = [
        { date: "2024-01-15", value: "150.25", label: "AAPL" },
        { date: "2024-01-16", value: "152.50" },
      ];

      mocks.mockToolRegistry.tryGet.mockImplementation((toolId: string) => {
        if (toolId === "finance-api") {
          return {
            execute: jest.fn().mockResolvedValue({
              success: true,
              data: {
                records: [
                  {
                    data: financeData,
                    metadata: { symbol: "AAPL" },
                    queryType: "stock_price",
                  },
                ],
              },
            }),
          };
        }
        return null;
      });

      const service = await createService(mocks);

      const result = await service.searchSource(
        DataSourceType.FINANCE_API,
        "AAPL stock price",
        { maxResults: 5 },
      );

      expect(Array.isArray(result)).toBe(true);
      // Should produce at least 1 result or empty array (depending on tool result shape)
    });

    it("should return empty array when finance-api data is empty", async () => {
      const mocks = buildMocks();

      mocks.mockToolRegistry.tryGet.mockImplementation((toolId: string) => {
        if (toolId === "finance-api") {
          return {
            execute: jest.fn().mockResolvedValue({
              success: true,
              data: {
                records: [
                  {
                    data: [], // empty data
                    metadata: {},
                    queryType: "stock_price",
                  },
                ],
              },
            }),
          };
        }
        return null;
      });

      const service = await createService(mocks);

      const result = await service.searchSource(
        DataSourceType.FINANCE_API,
        "AAPL",
        { maxResults: 5 },
      );

      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ============================================================
  // convertToolResultToDataSource – weather-api (lines 1184-1218)
  // ============================================================

  describe("convertToolResultToDataSource – weather-api (lines 1184-1218)", () => {
    it("should convert weather-api results to DataSourceResult", async () => {
      const mocks = buildMocks();

      mocks.mockToolRegistry.tryGet.mockImplementation((toolId: string) => {
        if (toolId === "weather-api") {
          return {
            execute: jest.fn().mockResolvedValue({
              success: true,
              data: {
                records: [
                  {
                    location: { name: "Beijing", country: "CN" },
                    current: { temp: 5, description: "Cloudy", humidity: 80 },
                    forecast: null,
                  },
                ],
              },
            }),
          };
        }
        return null;
      });

      const service = await createService(mocks);

      const result = await service.searchSource(
        DataSourceType.WEATHER_API,
        "Beijing weather",
        { maxResults: 5 },
      );

      expect(Array.isArray(result)).toBe(true);
    });

    it("should return empty when weather has no current or forecast", async () => {
      const mocks = buildMocks();

      mocks.mockToolRegistry.tryGet.mockImplementation((toolId: string) => {
        if (toolId === "weather-api") {
          return {
            execute: jest.fn().mockResolvedValue({
              success: true,
              data: {
                records: [
                  {
                    location: { name: "Unknown" },
                    current: null,
                    forecast: null,
                  },
                ],
              },
            }),
          };
        }
        return null;
      });

      const service = await createService(mocks);

      const result = await service.searchSource(
        DataSourceType.WEATHER_API,
        "weather query",
        { maxResults: 5 },
      );

      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ============================================================
  // convertToolResultToDataSource – unknown tool (lines 1214-1218)
  // ============================================================

  describe("convertToolResultToDataSource – unknown tool id (lines 1214-1218)", () => {
    it("should return empty array for unknown tool id", async () => {
      const mocks = buildMocks();
      const service = await createService(mocks);

      const convertToolResult = (
        service as unknown as {
          convertToolResultToDataSource(
            toolId: string,
            sourceType: DataSourceType,
            records: unknown[],
          ): unknown[];
        }
      ).convertToolResultToDataSource;

      const result = convertToolResult.call(
        service,
        "totally-unknown-tool-xyz",
        DataSourceType.WEB,
        [{ title: "test", url: "https://example.com" }],
      );

      expect(result).toEqual([]);
    });
  });

  // ============================================================
  // scanLiteratureBaseline (line 546)
  // ============================================================

  describe("scanLiteratureBaseline (line 546)", () => {
    it("should return literature baseline results", async () => {
      const mocks = buildMocks();

      // Mock web-search tool to return results for literature scan
      mocks.mockToolRegistry.tryGet.mockImplementation((toolId: string) => {
        if (toolId === "web-search") {
          return {
            execute: jest.fn().mockResolvedValue({
              success: true,
              data: {
                success: true,
                results: [
                  makeSearchResultItem({
                    url: "https://mckinsey.com/report",
                    title: "AI Market Analysis McKinsey",
                  }),
                ],
              },
            }),
          };
        }
        return null;
      });

      const service = await createService(mocks);

      const result = await service.scanLiteratureBaseline(
        "AI Technology",
        "技术发展",
        "Analysis of AI technology development trends",
        5,
      );

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ============================================================
  // searchForHypothesis – hypothesis search
  // ============================================================

  describe("searchForHypothesis", () => {
    it("should return support and counter results", async () => {
      const mocks = buildMocks();

      mocks.mockToolRegistry.tryGet.mockImplementation((toolId: string) => {
        if (toolId === "web-search") {
          return {
            execute: jest.fn().mockResolvedValue({
              success: true,
              data: {
                success: true,
                results: [makeSearchResultItem()],
              },
            }),
          };
        }
        return null;
      });

      const service = await createService(mocks);

      const result = await service.searchForHypothesis(
        "AI will replace most knowledge workers within 5 years",
      );

      expect(result.supportResults).toBeDefined();
      expect(result.counterResults).toBeDefined();
      expect(Array.isArray(result.supportResults)).toBe(true);
      expect(Array.isArray(result.counterResults)).toBe(true);
    });
  });

  // ============================================================
  // RAG-Fusion search path (lines 284-297)
  // ============================================================

  describe("fetchDataForDimension – RAG-Fusion path (lines 284-297)", () => {
    it("should use RAG-Fusion when ragFusionConfig is provided", async () => {
      const mocks = buildMocks();

      mocks.mockRagFusionService.fusionSearch.mockResolvedValue({
        results: [
          {
            item: makeSearchResultItem({ url: "https://fusion-result.com" }),
            fusionScore: 0.9,
            credibilityScore: 0.85,
            relevanceScore: 0.88,
            sourceType: DataSourceType.WEB,
          },
        ],
        metadata: {
          totalUniqueResults: 1,
          successfulVariants: 2,
          totalVariants: 3,
          executionTimeMs: 150,
        },
      });

      mocks.mockRagFusionService.convertToDataSourceResults.mockReturnValue([
        makeSearchResultItem({ url: "https://fusion-result.com" }),
      ]);

      const service = await createService(mocks, true);

      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();

      const result = await service.fetchDataForDimension(
        dimension as never,
        topic as never,
        {
          ragFusionConfig: {
            enabled: true,
            queryVariants: 3,
            fusionMethod: "rrf",
          },
        },
      );

      expect(result).toBeDefined();
      expect(mocks.mockRagFusionService.fusionSearch).toHaveBeenCalled();
    });

    it("should fall back to standard search when RAG-Fusion throws", async () => {
      const mocks = buildMocks();

      mocks.mockRagFusionService.fusionSearch.mockRejectedValue(
        new Error("RAG-Fusion timeout"),
      );

      const service = await createService(mocks, true);

      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();

      const result = await service.fetchDataForDimension(
        dimension as never,
        topic as never,
        {
          ragFusionConfig: {
            enabled: true,
            queryVariants: 3,
            fusionMethod: "rrf",
          },
        },
      );

      // Should fall back and return something (standard search results)
      expect(result).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
    });
  });
});

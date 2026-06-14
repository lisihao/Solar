/**
 * SearchOrchestratorService Unit Tests
 *
 * Covers:
 * - search(): full pipeline with all steps
 * - Step 1: source resolution from assignedTools vs dimension config
 * - Step 2: capability guard filtering (optional, non-blocking)
 * - Step 3: tool availability filtering via ToolFacade (optional)
 * - Safety net: fallback to WEB when all sources filtered
 * - Step 8: WEB fallback retry when quality gate fails
 * - getSearchTimeRange(): topic config parsing
 * - getDataSourcesForDimension(): dimension searchSources parsing
 * - hasAnySubToolEnabled(): ACADEMIC sub-tool check
 */

import { Test, TestingModule } from "@nestjs/testing";
import { SearchOrchestratorService } from "../search-orchestrator.service";
import { QueryStrategyService } from "../query/query-strategy.service";
import { SearchExecutorService } from "../search-executor.service";
import { ResultFusionService } from "../fusion/result-fusion.service";
import { SearchFusionQualityGateService } from "../fusion/quality-gate.service";
import { LlmRerankerAdapter } from "@/modules/ai-engine/facade";
import { ToolFacade } from "@/modules/ai-harness/facade";
import { CapabilityGuardService } from "@/modules/ai-harness/facade";
import { DataSourceType } from "../../../types/data-source.types";
import type {
  AggregatedSearchResult,
  DataSourceResult,
} from "../../../types/data-source.types";
import type {
  SourceAwareQueries,
  QualityVerdict,
  AdapterSearchResult,
} from "../search.types";

// ============================================================
// Helpers
// ============================================================

function makeResearchTopic(overrides: Record<string, unknown> = {}) {
  return {
    id: "topic-1",
    name: "AI Technology Trends",
    description: "Research on AI trends",
    userId: "user-1",
    language: "en",
    reportStyle: "COMPREHENSIVE",
    topicConfig: null,
    config: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeTopicDimension(overrides: Record<string, unknown> = {}) {
  return {
    id: "dim-1",
    name: "Technical Development",
    description: "Technological development dimension",
    topicId: "topic-1",
    status: "PENDING",
    searchSources: null,
    searchKeywords: [],
    searchQueries: null,
    priority: 1,
    order: 1,
    estimatedTime: 30,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeDataSourceResult(
  overrides: Partial<DataSourceResult> = {},
): DataSourceResult {
  return {
    sourceType: DataSourceType.WEB,
    title: "Test Result",
    url: "https://example.com/result",
    snippet: "This is a test result snippet with sufficient content here.",
    publishedAt: new Date(),
    domain: "example.com",
    ...overrides,
  };
}

function makeAggregatedResult(
  overrides: Partial<AggregatedSearchResult> = {},
): AggregatedSearchResult {
  return {
    items: [makeDataSourceResult()],
    totalCount: 1,
    sources: [DataSourceType.WEB],
    metadata: {
      searchQuery: "test",
      executionTimeMs: 100,
      sourceResults: { [DataSourceType.WEB]: 1 } as Record<
        DataSourceType,
        number
      >,
    },
    scoredItems: [],
    ...overrides,
  };
}

function makeSourceAwareQueries(
  overrides: Partial<SourceAwareQueries> = {},
): SourceAwareQueries {
  return {
    baseQueries: ["AI technology trends"],
    sourceSpecific: new Map([
      [DataSourceType.WEB, ["AI technology trends 2024"]],
      [DataSourceType.ACADEMIC, ["AI technology trends"]],
    ]),
    language: "en",
    ...overrides,
  };
}

function makeQualityVerdict(
  overrides: Partial<QualityVerdict> = {},
): QualityVerdict {
  return {
    sufficient: true,
    gaps: [],
    suggestedActions: [],
    ...overrides,
  };
}

function makeAdapterResult(
  items: DataSourceResult[] = [],
): AdapterSearchResult {
  return {
    items,
    sourceMetrics: {
      sourceId: "web",
      durationMs: 100,
      queryUsed: "test",
    },
  };
}

// ============================================================
// Mocks
// ============================================================

const mockQueryStrategy = {
  generateQueries: jest.fn(),
};

const mockExecutor = {
  searchAllSources: jest.fn(),
};

const mockFusion = {
  fuse: jest.fn(),
};

const mockQualityGate = {
  evaluate: jest.fn(),
};

const mockToolFacade = {
  capabilityResolveTools: jest.fn(),
};

const mockCapabilityGuard = {
  checkDataAccess: jest.fn(),
};

const mockReranker = {
  id: "llm",
  rerank: jest.fn(),
};

// ============================================================
// Tests
// ============================================================

describe("SearchOrchestratorService", () => {
  let service: SearchOrchestratorService;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Default happy-path responses
    mockQueryStrategy.generateQueries.mockResolvedValue(
      makeSourceAwareQueries(),
    );
    mockExecutor.searchAllSources.mockResolvedValue(
      new Map([
        [DataSourceType.WEB, makeAdapterResult([makeDataSourceResult()])],
      ]),
    );
    mockFusion.fuse.mockReturnValue(makeAggregatedResult());
    mockQualityGate.evaluate.mockReturnValue(makeQualityVerdict());
    // Default: all tools enabled (ToolFacade does not filter anything)
    mockToolFacade.capabilityResolveTools.mockResolvedValue([
      "web-search",
      "arxiv-search",
      "github-search",
      "hackernews-search",
      "semantic-scholar",
      "pubmed",
      "openalex-search",
      "social-x",
    ]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchOrchestratorService,
        { provide: QueryStrategyService, useValue: mockQueryStrategy },
        { provide: SearchExecutorService, useValue: mockExecutor },
        { provide: ResultFusionService, useValue: mockFusion },
        { provide: SearchFusionQualityGateService, useValue: mockQualityGate },
        {
          provide: LlmRerankerAdapter,
          useValue: mockReranker,
        },
        { provide: ToolFacade, useValue: mockToolFacade },
        { provide: CapabilityGuardService, useValue: mockCapabilityGuard },
      ],
    }).compile();

    service = module.get<SearchOrchestratorService>(SearchOrchestratorService);
  });

  // ===========================================================
  // search() — Step 1: source resolution
  // ===========================================================

  describe("search() — Step 1: source resolution", () => {
    it("should use convertToolsToDataSources when assignedTools are provided", async () => {
      const dimension = makeTopicDimension();
      const topic = makeResearchTopic();

      await service.search(dimension as any, topic as any, {
        assignedTools: ["web-search", "arxiv-search"],
      });

      // Executor should be called with the converted sources
      expect(mockExecutor.searchAllSources).toHaveBeenCalledWith(
        expect.arrayContaining([DataSourceType.WEB, DataSourceType.ACADEMIC]),
        expect.any(Object),
        expect.any(Object),
      );
    });

    it("should parse dimension.searchSources when no assignedTools", async () => {
      const dimension = makeTopicDimension({
        searchSources: JSON.stringify([DataSourceType.ACADEMIC]),
      });
      const topic = makeResearchTopic();

      await service.search(dimension as any, topic as any);

      expect(mockExecutor.searchAllSources).toHaveBeenCalledWith(
        [DataSourceType.ACADEMIC],
        expect.any(Object),
        expect.any(Object),
      );
    });

    it("should use DEFAULT_SOURCES when dimension.searchSources is null", async () => {
      const dimension = makeTopicDimension({ searchSources: null });
      const topic = makeResearchTopic();

      await service.search(dimension as any, topic as any);

      expect(mockExecutor.searchAllSources).toHaveBeenCalledWith(
        expect.arrayContaining([DataSourceType.WEB, DataSourceType.ACADEMIC]),
        expect.any(Object),
        expect.any(Object),
      );
    });

    it("should fall back to DEFAULT_SOURCES for invalid JSON in searchSources", async () => {
      const dimension = makeTopicDimension({
        searchSources: "not-valid-json{{{",
      });
      const topic = makeResearchTopic();

      await service.search(dimension as any, topic as any);

      expect(mockExecutor.searchAllSources).toHaveBeenCalledWith(
        expect.arrayContaining([DataSourceType.WEB]),
        expect.any(Object),
        expect.any(Object),
      );
    });

    it("should fall back to DEFAULT_SOURCES when searchSources is not an array", async () => {
      const dimension = makeTopicDimension({
        searchSources: JSON.stringify({ type: "web" }),
      });
      const topic = makeResearchTopic();

      await service.search(dimension as any, topic as any);

      expect(mockExecutor.searchAllSources).toHaveBeenCalledWith(
        expect.arrayContaining([DataSourceType.WEB]),
        expect.any(Object),
        expect.any(Object),
      );
    });

    it("should fall back to DEFAULT_SOURCES when searchSources has no valid DataSourceType values", async () => {
      const dimension = makeTopicDimension({
        searchSources: JSON.stringify(["invalid-source", 123, null]),
      });
      const topic = makeResearchTopic();

      await service.search(dimension as any, topic as any);

      expect(mockExecutor.searchAllSources).toHaveBeenCalledWith(
        expect.arrayContaining([DataSourceType.WEB]),
        expect.any(Object),
        expect.any(Object),
      );
    });

    it("should pass searchSources as object array directly (non-string raw)", async () => {
      // ToolFacade must enable github-search for GITHUB to pass through the filter
      mockToolFacade.capabilityResolveTools.mockResolvedValue([
        "github-search",
      ]);

      const dimension = makeTopicDimension({
        searchSources: [DataSourceType.GITHUB],
      });
      const topic = makeResearchTopic();

      await service.search(dimension as any, topic as any);

      expect(mockExecutor.searchAllSources).toHaveBeenCalledWith(
        [DataSourceType.GITHUB],
        expect.any(Object),
        expect.any(Object),
      );
    });
  });

  // ===========================================================
  // search() — Step 2: capability guard filtering
  // ===========================================================

  describe("search() — Step 2: capability guard filtering", () => {
    it("should filter sources denied by capability guard", async () => {
      mockCapabilityGuard.checkDataAccess
        .mockResolvedValueOnce({ allowed: true })
        .mockResolvedValueOnce({ allowed: false, reason: "not authorized" });

      const dimension = makeTopicDimension({
        searchSources: JSON.stringify([
          DataSourceType.WEB,
          DataSourceType.ACADEMIC,
        ]),
      });
      const topic = makeResearchTopic();

      await service.search(dimension as any, topic as any, {
        processId: "proc-123",
      });

      // Only WEB should pass through
      expect(mockExecutor.searchAllSources).toHaveBeenCalledWith(
        [DataSourceType.WEB],
        expect.any(Object),
        expect.any(Object),
      );
    });

    it("should keep source when capability guard throws (non-blocking)", async () => {
      mockCapabilityGuard.checkDataAccess.mockRejectedValue(
        new Error("Guard service down"),
      );

      const dimension = makeTopicDimension({
        searchSources: JSON.stringify([DataSourceType.WEB]),
      });
      const topic = makeResearchTopic();

      await service.search(dimension as any, topic as any, {
        processId: "proc-123",
      });

      // Source should still be included despite guard error
      expect(mockExecutor.searchAllSources).toHaveBeenCalledWith(
        [DataSourceType.WEB],
        expect.any(Object),
        expect.any(Object),
      );
    });

    it("should skip capability guard when no processId provided", async () => {
      const dimension = makeTopicDimension();
      const topic = makeResearchTopic();

      await service.search(dimension as any, topic as any);

      expect(mockCapabilityGuard.checkDataAccess).not.toHaveBeenCalled();
    });
  });

  // ===========================================================
  // search() — Step 3: tool availability filtering
  // ===========================================================

  describe("search() — Step 3: tool availability filtering", () => {
    it("should filter sources without enabled tools", async () => {
      mockToolFacade.capabilityResolveTools.mockResolvedValue(["web-search"]);

      const dimension = makeTopicDimension({
        searchSources: JSON.stringify([
          DataSourceType.WEB,
          DataSourceType.GITHUB,
        ]),
      });
      const topic = makeResearchTopic();

      await service.search(dimension as any, topic as any);

      expect(mockExecutor.searchAllSources).toHaveBeenCalledWith(
        [DataSourceType.WEB],
        expect.any(Object),
        expect.any(Object),
      );
    });

    it("should keep source with no tool mapping (e.g. LOCAL) always", async () => {
      mockToolFacade.capabilityResolveTools.mockResolvedValue(["web-search"]);

      const dimension = makeTopicDimension({
        searchSources: JSON.stringify([
          DataSourceType.WEB,
          DataSourceType.LOCAL,
        ]),
      });
      const topic = makeResearchTopic();

      await service.search(dimension as any, topic as any);

      expect(mockExecutor.searchAllSources).toHaveBeenCalledWith(
        expect.arrayContaining([DataSourceType.LOCAL]),
        expect.any(Object),
        expect.any(Object),
      );
    });

    it("should keep ACADEMIC if any sub-tool is enabled (e.g. openalex-search)", async () => {
      mockToolFacade.capabilityResolveTools.mockResolvedValue([
        "openalex-search",
      ]);

      const dimension = makeTopicDimension({
        searchSources: JSON.stringify([DataSourceType.ACADEMIC]),
      });
      const topic = makeResearchTopic();

      await service.search(dimension as any, topic as any);

      expect(mockExecutor.searchAllSources).toHaveBeenCalledWith(
        [DataSourceType.ACADEMIC],
        expect.any(Object),
        expect.any(Object),
      );
    });

    it("should keep ACADEMIC if pubmed sub-tool is enabled", async () => {
      mockToolFacade.capabilityResolveTools.mockResolvedValue(["pubmed"]);

      const dimension = makeTopicDimension({
        searchSources: JSON.stringify([DataSourceType.ACADEMIC]),
      });
      const topic = makeResearchTopic();

      await service.search(dimension as any, topic as any);

      expect(mockExecutor.searchAllSources).toHaveBeenCalledWith(
        [DataSourceType.ACADEMIC],
        expect.any(Object),
        expect.any(Object),
      );
    });

    it("should keep ACADEMIC if semantic-scholar sub-tool is enabled", async () => {
      mockToolFacade.capabilityResolveTools.mockResolvedValue([
        "semantic-scholar",
      ]);

      const dimension = makeTopicDimension({
        searchSources: JSON.stringify([DataSourceType.ACADEMIC]),
      });
      const topic = makeResearchTopic();

      await service.search(dimension as any, topic as any);

      expect(mockExecutor.searchAllSources).toHaveBeenCalledWith(
        [DataSourceType.ACADEMIC],
        expect.any(Object),
        expect.any(Object),
      );
    });

    it("should proceed with all sources when ToolFacade throws (non-blocking)", async () => {
      mockToolFacade.capabilityResolveTools.mockRejectedValue(
        new Error("ToolFacade unavailable"),
      );

      const dimension = makeTopicDimension({
        searchSources: JSON.stringify([
          DataSourceType.WEB,
          DataSourceType.ACADEMIC,
        ]),
      });
      const topic = makeResearchTopic();

      await service.search(dimension as any, topic as any);

      expect(mockExecutor.searchAllSources).toHaveBeenCalledWith(
        expect.arrayContaining([DataSourceType.WEB, DataSourceType.ACADEMIC]),
        expect.any(Object),
        expect.any(Object),
      );
    });
  });

  // ===========================================================
  // search() — Safety net: fallback to WEB
  // ===========================================================

  describe("search() — safety net fallback", () => {
    it("should fallback to [WEB] when all sources are filtered out", async () => {
      // Guard denies all sources
      mockCapabilityGuard.checkDataAccess.mockResolvedValue({
        allowed: false,
        reason: "denied",
      });
      // ToolFacade enables nothing
      mockToolFacade.capabilityResolveTools.mockResolvedValue([]);

      const dimension = makeTopicDimension({
        searchSources: JSON.stringify([DataSourceType.ACADEMIC]),
      });
      const topic = makeResearchTopic();

      await service.search(dimension as any, topic as any, {
        processId: "proc-123",
      });

      expect(mockExecutor.searchAllSources).toHaveBeenCalledWith(
        [DataSourceType.WEB],
        expect.any(Object),
        expect.any(Object),
      );
    });
  });

  // ===========================================================
  // search() — Step 8: WEB fallback retry
  // ===========================================================

  describe("search() — Step 8: WEB fallback retry", () => {
    it("should retry with WEB fallback when quality gate fails with add_web_fallback action and WEB not in sources", async () => {
      mockToolFacade.capabilityResolveTools.mockResolvedValue(["arxiv-search"]);

      const dimension = makeTopicDimension({
        searchSources: JSON.stringify([DataSourceType.ACADEMIC]),
      });
      const topic = makeResearchTopic();

      // First call: quality gate fails
      mockQualityGate.evaluate
        .mockReturnValueOnce(
          makeQualityVerdict({
            sufficient: false,
            gaps: ["Insufficient results: 1 found, 5 required"],
            suggestedActions: ["add_web_fallback"],
          }),
        )
        .mockReturnValueOnce(makeQualityVerdict({ sufficient: true }));

      const fallbackItems = [
        makeDataSourceResult({ sourceType: DataSourceType.WEB }),
      ];
      mockExecutor.searchAllSources
        .mockResolvedValueOnce(
          new Map([[DataSourceType.ACADEMIC, makeAdapterResult([])]]),
        )
        .mockResolvedValueOnce(
          new Map([[DataSourceType.WEB, makeAdapterResult(fallbackItems)]]),
        );

      mockFusion.fuse
        .mockReturnValueOnce(makeAggregatedResult({ totalCount: 1 }))
        .mockReturnValueOnce(makeAggregatedResult({ totalCount: 6 }));

      await service.search(dimension as any, topic as any);

      expect(mockExecutor.searchAllSources).toHaveBeenCalledTimes(2);
      // Second call should be for WEB fallback
      expect(mockExecutor.searchAllSources).toHaveBeenNthCalledWith(
        2,
        [DataSourceType.WEB],
        expect.any(Object),
        expect.any(Object),
      );
    });

    it("should not retry when quality gate passes", async () => {
      const dimension = makeTopicDimension();
      const topic = makeResearchTopic();

      await service.search(dimension as any, topic as any);

      expect(mockExecutor.searchAllSources).toHaveBeenCalledTimes(1);
    });

    it("should not retry when WEB is already in sources", async () => {
      // Ensure both WEB and ACADEMIC pass ToolFacade filter
      mockToolFacade.capabilityResolveTools.mockResolvedValue([
        "web-search",
        "arxiv-search",
      ]);

      const dimension = makeTopicDimension({
        searchSources: JSON.stringify([
          DataSourceType.WEB,
          DataSourceType.ACADEMIC,
        ]),
      });
      const topic = makeResearchTopic();

      mockQualityGate.evaluate.mockReturnValue(
        makeQualityVerdict({
          sufficient: false,
          gaps: ["Low results"],
          suggestedActions: ["add_web_fallback"],
        }),
      );

      await service.search(dimension as any, topic as any);

      // Should NOT retry since WEB already in sources
      expect(mockExecutor.searchAllSources).toHaveBeenCalledTimes(1);
    });

    it("should not retry when suggestedActions does not include add_web_fallback", async () => {
      const dimension = makeTopicDimension({
        searchSources: JSON.stringify([DataSourceType.ACADEMIC]),
      });
      const topic = makeResearchTopic();

      mockQualityGate.evaluate.mockReturnValue(
        makeQualityVerdict({
          sufficient: false,
          gaps: ["Low freshness"],
          suggestedActions: ["extend_time_range"],
        }),
      );

      await service.search(dimension as any, topic as any);

      expect(mockExecutor.searchAllSources).toHaveBeenCalledTimes(1);
    });

    it("should handle WEB fallback retry failure gracefully (non-blocking)", async () => {
      const dimension = makeTopicDimension({
        searchSources: JSON.stringify([DataSourceType.ACADEMIC]),
      });
      const topic = makeResearchTopic();

      mockQualityGate.evaluate.mockReturnValue(
        makeQualityVerdict({
          sufficient: false,
          gaps: ["Insufficient results"],
          suggestedActions: ["add_web_fallback"],
        }),
      );

      mockExecutor.searchAllSources
        .mockResolvedValueOnce(
          new Map([[DataSourceType.ACADEMIC, makeAdapterResult([])]]),
        )
        .mockRejectedValueOnce(new Error("WEB fallback search failed"));

      // Should not throw
      const result = await service.search(dimension as any, topic as any);
      expect(result).toBeDefined();
    });
  });

  // ===========================================================
  // search() — searchTimeRange parsing
  // ===========================================================

  describe("search() — searchTimeRange from topicConfig", () => {
    it("should use since date from topicConfig.searchTimeRange.since (string JSON)", async () => {
      const sinceDate = "2024-01-01";
      const topic = makeResearchTopic({
        topicConfig: JSON.stringify({
          searchTimeRange: { since: sinceDate },
        }),
      });
      const dimension = makeTopicDimension();

      await service.search(dimension as any, topic as any);

      expect(mockExecutor.searchAllSources).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(Object),
        expect.objectContaining({
          since: expect.any(Date),
        }),
      );
    });

    it("should use since date from topicConfig.searchTimeRange.since (object JSON)", async () => {
      const topic = makeResearchTopic({
        topicConfig: { searchTimeRange: { since: "2023-06-01" } },
      });
      const dimension = makeTopicDimension();

      await service.search(dimension as any, topic as any);

      const callArgs = mockExecutor.searchAllSources.mock.calls[0][2];
      expect(callArgs.since).toBeInstanceOf(Date);
    });

    it("should use options.since when provided (overrides topicConfig)", async () => {
      const optionsSince = new Date("2024-06-01");
      const topic = makeResearchTopic({
        topicConfig: JSON.stringify({
          searchTimeRange: { since: "2020-01-01" },
        }),
      });
      const dimension = makeTopicDimension();

      await service.search(dimension as any, topic as any, {
        since: optionsSince,
      });

      const callArgs = mockExecutor.searchAllSources.mock.calls[0][2];
      expect(callArgs.since).toBe(optionsSince);
    });

    it("should use default since (6 months ago) when topicConfig is null", async () => {
      const topic = makeResearchTopic({ topicConfig: null });
      const dimension = makeTopicDimension();

      await service.search(dimension as any, topic as any);

      const callArgs = mockExecutor.searchAllSources.mock.calls[0][2];
      const sixMonthsAgo = new Date(Date.now() - 6 * 30 * 24 * 60 * 60 * 1000);
      // Should be approximately 6 months ago
      expect(callArgs.since.getTime()).toBeLessThanOrEqual(
        sixMonthsAgo.getTime() + 5000,
      );
    });

    it("should return null for topicConfig without searchTimeRange", async () => {
      const topic = makeResearchTopic({
        topicConfig: JSON.stringify({ otherKey: "value" }),
      });
      const dimension = makeTopicDimension();

      await service.search(dimension as any, topic as any);

      // Should still call executor (uses default since)
      expect(mockExecutor.searchAllSources).toHaveBeenCalled();
    });

    it("should return null for topicConfig.searchTimeRange that is not an object", async () => {
      const topic = makeResearchTopic({
        topicConfig: JSON.stringify({ searchTimeRange: "invalid" }),
      });
      const dimension = makeTopicDimension();

      await service.search(dimension as any, topic as any);

      expect(mockExecutor.searchAllSources).toHaveBeenCalled();
    });

    it("should return null for empty since string in topicConfig", async () => {
      const topic = makeResearchTopic({
        topicConfig: JSON.stringify({ searchTimeRange: { since: "" } }),
      });
      const dimension = makeTopicDimension();

      await service.search(dimension as any, topic as any);

      expect(mockExecutor.searchAllSources).toHaveBeenCalled();
    });

    it("should return null for invalid date string in topicConfig", async () => {
      const topic = makeResearchTopic({
        topicConfig: JSON.stringify({
          searchTimeRange: { since: "not-a-date" },
        }),
      });
      const dimension = makeTopicDimension();

      await service.search(dimension as any, topic as any);

      expect(mockExecutor.searchAllSources).toHaveBeenCalled();
    });

    it("should return null when topicConfig JSON parse fails", async () => {
      const topic = makeResearchTopic({
        topicConfig: "invalid-json{{{",
      });
      const dimension = makeTopicDimension();

      await service.search(dimension as any, topic as any);

      expect(mockExecutor.searchAllSources).toHaveBeenCalled();
    });

    it("should return null when searchTimeRange.since is non-string", async () => {
      const topic = makeResearchTopic({
        topicConfig: JSON.stringify({ searchTimeRange: { since: 12345 } }),
      });
      const dimension = makeTopicDimension();

      await service.search(dimension as any, topic as any);

      expect(mockExecutor.searchAllSources).toHaveBeenCalled();
    });
  });

  // ===========================================================
  // search() — maxResults and signal options
  // ===========================================================

  describe("search() — options passthrough", () => {
    it("should pass maxResults option to executor", async () => {
      const dimension = makeTopicDimension();
      const topic = makeResearchTopic();

      await service.search(dimension as any, topic as any, { maxResults: 50 });

      expect(mockExecutor.searchAllSources).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(Object),
        expect.objectContaining({ maxResults: 50 }),
      );
    });

    it("should use default maxResults of 25 when not provided", async () => {
      const dimension = makeTopicDimension();
      const topic = makeResearchTopic();

      await service.search(dimension as any, topic as any);

      expect(mockExecutor.searchAllSources).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(Object),
        expect.objectContaining({ maxResults: 25 }),
      );
    });

    it("should pass signal option to executor", async () => {
      const controller = new AbortController();
      const dimension = makeTopicDimension();
      const topic = makeResearchTopic();

      await service.search(dimension as any, topic as any, {
        signal: controller.signal,
      });

      expect(mockExecutor.searchAllSources).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(Object),
        expect.objectContaining({ signal: controller.signal }),
      );
    });

    it("should use first baseQuery as primaryQuery for fusion", async () => {
      mockQueryStrategy.generateQueries.mockResolvedValue({
        baseQueries: ["primary query", "secondary query"],
        sourceSpecific: new Map(),
        language: "en",
      });

      const dimension = makeTopicDimension();
      const topic = makeResearchTopic();

      await service.search(dimension as any, topic as any);

      expect(mockFusion.fuse).toHaveBeenCalledWith(
        expect.any(Map),
        "primary query",
      );
    });

    it("should fall back to topic.name as primaryQuery when baseQueries is empty", async () => {
      mockQueryStrategy.generateQueries.mockResolvedValue({
        baseQueries: [],
        sourceSpecific: new Map(),
        language: "en",
      });

      const dimension = makeTopicDimension();
      const topic = makeResearchTopic({ name: "My Topic Name" });

      await service.search(dimension as any, topic as any);

      expect(mockFusion.fuse).toHaveBeenCalledWith(
        expect.any(Map),
        "My Topic Name",
      );
    });
  });

  // ===========================================================
  // search() — rerank stage (batch 5 addition)
  // ===========================================================

  describe("search() — rerank stage", () => {
    it("should NOT call reranker when rerankConfig.enabled is missing / false", async () => {
      const dimension = makeTopicDimension();
      const topic = makeResearchTopic();

      // default (no rerankConfig)
      await service.search(dimension as any, topic as any);
      expect(mockReranker.rerank).not.toHaveBeenCalled();

      // explicit false
      await service.search(dimension as any, topic as any, {
        rerankConfig: { enabled: false },
      });
      expect(mockReranker.rerank).not.toHaveBeenCalled();
    });

    it("should NOT call reranker when scoredItems is empty (nothing to rerank)", async () => {
      mockFusion.fuse.mockReturnValue(
        makeAggregatedResult({ scoredItems: [] }),
      );

      const dimension = makeTopicDimension();
      const topic = makeResearchTopic();
      await service.search(dimension as any, topic as any, {
        rerankConfig: { enabled: true },
      });

      expect(mockReranker.rerank).not.toHaveBeenCalled();
    });

    it("should NOT call reranker when candidate pool <= topK", async () => {
      // 5 scoredItems, topK=20 → pool=min(60, 5)=5, 5 <= 20 → skip
      const scoredItems = Array.from({ length: 5 }, (_, i) => ({
        item: makeDataSourceResult({ url: `https://a.com/${i}` }),
        score: 1 - i * 0.1,
        relevanceScore: 0.9,
        credibilityScore: 0.8,
      }));
      mockFusion.fuse.mockReturnValue(
        makeAggregatedResult({ scoredItems, totalCount: 5 }),
      );

      const dimension = makeTopicDimension();
      const topic = makeResearchTopic();
      await service.search(dimension as any, topic as any, {
        rerankConfig: { enabled: true },
      });

      expect(mockReranker.rerank).not.toHaveBeenCalled();
    });

    it("should call reranker and replace items when rerankResult.reranked=true", async () => {
      // 10 scoredItems, topK=3, multiplier=2 → pool=min(6, 10)=6, 6 > 3 → call
      const scoredItems = Array.from({ length: 10 }, (_, i) => ({
        item: makeDataSourceResult({ url: `https://a.com/${i}` }),
        score: 1 - i * 0.05,
        relevanceScore: 0.9,
        credibilityScore: 0.8,
      }));
      mockFusion.fuse.mockReturnValue(
        makeAggregatedResult({ scoredItems, totalCount: 10 }),
      );

      mockReranker.rerank.mockResolvedValue({
        reranked: true,
        items: [
          { item: scoredItems[5].item, originalIndex: 5, rerankScore: 0.95 },
          { item: scoredItems[2].item, originalIndex: 2, rerankScore: 0.85 },
          { item: scoredItems[4].item, originalIndex: 4, rerankScore: 0.7 },
        ],
      });

      const dimension = makeTopicDimension();
      const topic = makeResearchTopic();
      const result = await service.search(dimension as any, topic as any, {
        rerankConfig: { enabled: true, topK: 3, candidateMultiplier: 2 },
      });

      expect(mockReranker.rerank).toHaveBeenCalledTimes(1);
      const rerankArg = mockReranker.rerank.mock.calls[0][0];
      expect(rerankArg.topK).toBe(3);
      expect(rerankArg.candidates).toHaveLength(6); // pool = 3 * 2
      expect(result.items).toHaveLength(3);
      expect(result.items[0].url).toBe("https://a.com/5");
      expect(result.totalCount).toBe(3);
      expect(result.scoredItems?.[0].relevanceScore).toBeCloseTo(0.95, 2);
    });

    it("should keep fusion aggregated when rerankResult.reranked=false (fail-open)", async () => {
      // 10 scoredItems → pool > topK → calls rerank, but reranker returns failed
      const scoredItems = Array.from({ length: 10 }, (_, i) => ({
        item: makeDataSourceResult({ url: `https://a.com/${i}` }),
        score: 1 - i * 0.05,
        relevanceScore: 0.9, // fusion's careful multi-factor score
        credibilityScore: 0.8,
      }));
      const originalAggregated = makeAggregatedResult({
        scoredItems,
        items: scoredItems.map((s) => s.item),
        totalCount: 10,
      });
      mockFusion.fuse.mockReturnValue(originalAggregated);

      mockReranker.rerank.mockResolvedValue({
        reranked: false,
        skipReason: "llm_no_response",
        items: scoredItems.slice(0, 3).map((s, i) => ({
          item: s.item,
          originalIndex: i,
          rerankScore: 1 - i / 3,
        })),
      });

      const dimension = makeTopicDimension();
      const topic = makeResearchTopic();
      const result = await service.search(dimension as any, topic as any, {
        rerankConfig: { enabled: true, topK: 3, candidateMultiplier: 2 },
      });

      expect(mockReranker.rerank).toHaveBeenCalledTimes(1);
      // Fusion aggregated preserved — fusion's relevanceScore NOT overwritten
      expect(result.items).toHaveLength(10);
      expect(result.totalCount).toBe(10);
      expect(result.scoredItems?.[0].relevanceScore).toBe(0.9);
    });
  });

  // ===========================================================
  // Edge cases for full branch coverage
  // ===========================================================

  describe("edge-case branches (coverage gap closure)", () => {
    it("should apply rerank when aggregated.scoredItems is undefined (nullish path)", async () => {
      // Simulate non-standard aggregated result with scoredItems missing (undefined)
      const aggregatedNoScored = makeAggregatedResult({
        scoredItems: undefined,
      });
      mockFusion.fuse.mockReturnValue(aggregatedNoScored);

      const dimension = makeTopicDimension();
      const topic = makeResearchTopic();
      await service.search(dimension as any, topic as any, {
        rerankConfig: { enabled: true },
      });

      // nullish coalesce yields [] → length 0 → rerank skipped
      expect(mockReranker.rerank).not.toHaveBeenCalled();
    });

    it("should log unknown reason when capability guard denies without reason", async () => {
      // Deny without providing a reason string — exercises the `?? 'no reason'` branch
      mockCapabilityGuard.checkDataAccess.mockResolvedValue({
        allowed: false,
        // reason: undefined
      });

      const dimension = makeTopicDimension({
        searchSources: JSON.stringify([DataSourceType.WEB]),
      });
      const topic = makeResearchTopic();
      await service.search(dimension as any, topic as any, {
        processId: "proc-1",
      });

      // WEB denied → falls back via safety net
      expect(mockExecutor.searchAllSources).toHaveBeenCalledWith(
        expect.arrayContaining([DataSourceType.WEB]),
        expect.any(Object),
        expect.any(Object),
      );
    });

    it("should log 'unknown' when rerankResult.reranked=false without skipReason", async () => {
      const scoredItems = Array.from({ length: 10 }, (_, i) => ({
        item: makeDataSourceResult({ url: `https://a.com/${i}` }),
        score: 1 - i * 0.05,
        relevanceScore: 0.9,
        credibilityScore: 0.8,
      }));
      mockFusion.fuse.mockReturnValue(
        makeAggregatedResult({
          scoredItems,
          items: scoredItems.map((s) => s.item),
          totalCount: 10,
        }),
      );

      // Rerank returns reranked=false without skipReason (hits `?? 'unknown'` branch)
      mockReranker.rerank.mockResolvedValue({
        reranked: false,
        items: [],
      });

      const dimension = makeTopicDimension();
      const topic = makeResearchTopic();
      const result = await service.search(dimension as any, topic as any, {
        rerankConfig: { enabled: true, topK: 3, candidateMultiplier: 2 },
      });

      // fusion aggregated preserved
      expect(result.items).toHaveLength(10);
    });

    it("should fall back credibilityScore to 0 when original scoredItem is missing", async () => {
      // Reranker returns originalIndex outside scoredItems — exercises `original?.credibilityScore ?? 0`
      const scoredItems = Array.from({ length: 10 }, (_, i) => ({
        item: makeDataSourceResult({ url: `https://a.com/${i}` }),
        score: 1 - i * 0.05,
        relevanceScore: 0.9,
        credibilityScore: 0.8,
      }));
      mockFusion.fuse.mockReturnValue(
        makeAggregatedResult({ scoredItems, totalCount: 10 }),
      );

      // Rerank returns an item with bogus originalIndex = 999 (out of range)
      mockReranker.rerank.mockResolvedValue({
        reranked: true,
        items: [
          {
            item: scoredItems[0].item,
            originalIndex: 999, // scoredItems[999] === undefined
            rerankScore: 0.5,
          },
        ],
      });

      const dimension = makeTopicDimension();
      const topic = makeResearchTopic();
      const result = await service.search(dimension as any, topic as any, {
        rerankConfig: { enabled: true, topK: 1, candidateMultiplier: 3 },
      });

      // Should not crash; credibilityScore falls back to 0
      expect(result.scoredItems?.[0].credibilityScore).toBe(0);
    });
  });

  // ===========================================================
  // search() — without optional dependencies
  // ===========================================================

  describe("search() — without optional dependencies", () => {
    let serviceWithoutOptionals: SearchOrchestratorService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SearchOrchestratorService,
          { provide: QueryStrategyService, useValue: mockQueryStrategy },
          { provide: SearchExecutorService, useValue: mockExecutor },
          { provide: ResultFusionService, useValue: mockFusion },
          {
            provide: SearchFusionQualityGateService,
            useValue: mockQualityGate,
          },
          {
            provide: LlmRerankerAdapter,
            useValue: {
              id: "llm",
              rerank: jest.fn().mockResolvedValue([]),
            },
          },
          // No ToolFacade, no CapabilityGuardService
        ],
      }).compile();

      serviceWithoutOptionals = module.get<SearchOrchestratorService>(
        SearchOrchestratorService,
      );
    });

    it("should work without ToolFacade and CapabilityGuard", async () => {
      const dimension = makeTopicDimension();
      const topic = makeResearchTopic();

      const result = await serviceWithoutOptionals.search(
        dimension as any,
        topic as any,
      );

      expect(result).toBeDefined();
      expect(mockExecutor.searchAllSources).toHaveBeenCalled();
    });
  });

  // ===========================================================
  // search() — quality gate logging
  // ===========================================================

  describe("search() — quality logging", () => {
    it("should return aggregated result even when quality gate fails (no retry triggered)", async () => {
      const dimension = makeTopicDimension({
        searchSources: JSON.stringify([DataSourceType.WEB]),
      });
      const topic = makeResearchTopic();

      mockQualityGate.evaluate.mockReturnValue(
        makeQualityVerdict({
          sufficient: false,
          gaps: ["Low source diversity: only 1 source type(s) represented"],
          suggestedActions: ["broaden_query"],
        }),
      );

      const result = await service.search(dimension as any, topic as any);

      expect(result).toBeDefined();
    });
  });
});

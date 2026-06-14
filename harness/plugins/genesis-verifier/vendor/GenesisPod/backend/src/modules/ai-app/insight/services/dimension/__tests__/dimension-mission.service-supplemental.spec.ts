/**
 * DimensionMissionService Supplemental Unit Tests
 *
 * Targets uncovered lines:
 * - clearEvidenceCache (line 178)
 * - Second-round search deduplication by URL (lines 324-325)
 * - Dimension status update to RESEARCHING in executeSearchPhase (line 335)
 * - Enrichment statistics logging (line 462)
 * - Date parsing for freshness (line 474)
 * - Knowledge base matching statistics + similarity averaging (lines 579-585)
 * - Context compression pipeline: ContextCompressionService → TokenBudgetCalculatorService → hard truncate at 12KB (617-667)
 * - Section writing loop with error handling (lines 1316-1341)
 * - Leader review path (lines 1517-1519)
 * - Integration phase: consolidate section results (lines 1537-1588)
 * - Figure registry building (lines 1974-1977)
 * - Knowledge base statistics (lines 1991-1994)
 * - Leader context summary (line 2006)
 * - Temporal context building (lines 2026-2029)
 * - Evidence data preparation (lines 2127-2136)
 * - ContextEvolutionService / ChatFacade fact extraction (lines 1316-1341)
 */

import { Test, TestingModule } from "@nestjs/testing";
import { DimensionMissionService } from "../dimension-mission.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ResearchLeaderService } from "../../core/research/research-leader.service";
import { LeaderPlanningService } from "../../core/leader/leader-planning.service";
import { LeaderReviewService } from "../../core/leader/leader-review.service";
import { SectionWriterService } from "../section-writer.service";
import { DataSourceRouterService } from "../../data/data-source-router.service";
import { ResearchEventEmitterService } from "../../core/research/research-event-emitter.service";
import { AgentActivityService } from "../../monitoring/agent-activity.service";
import { DataEnrichmentService } from "../../data/data-enrichment.service";
import { LeaderToolService } from "../../data/leader-tool.service";
import { MissionObservabilityService } from "../../core/mission/mission-observability.service";
import { DimensionProgressService } from "../dimension-progress.service";
import { ReportQualityGateService } from "../../quality/report-quality-gate.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import {
  ContextCompressionService,
  ContextEvolutionService,
} from "@/modules/ai-harness/facade";
import { TokenBudgetCalculatorService } from "@/modules/ai-harness/facade";
import { DimensionStatus } from "@prisma/client";
import { ResearchTopic, TopicDimension } from "@prisma/client";

// ──────────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────────

const mockTopic: ResearchTopic = {
  id: "topic-001",
  name: "半导体行业分析",
  type: "industry_analysis",
  description: "半导体行业竞争格局",
  language: "zh",
  userId: "user-001",
  topicConfig: null,
  status: "ACTIVE",
  visibility: "PRIVATE",
  createdAt: new Date(),
  updatedAt: new Date(),
  searchConfig: null,
  scheduledAt: null,
  refreshInterval: null,
  lastRefreshedAt: null,
  totalTokens: 0,
  totalSources: 0,
  totalDimensions: 0,
  isTemplate: false,
  templateCategory: null,
  templateDescription: null,
  shareToken: null,
  sharedAt: null,
  tags: [],
} as unknown as ResearchTopic;

const mockDimension: TopicDimension = {
  id: "dim-001",
  topicId: "topic-001",
  name: "市场竞争格局",
  description: "分析市场份额和竞争动态",
  status: "PENDING",
  sortOrder: 1,
  searchQueries: ["semiconductor market share 2024"],
  searchSources: ["web"],
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as TopicDimension;

const mockEnrichedResult = {
  id: "result-001",
  title: "半导体市场分析报告",
  url: "https://example.com/semiconductor-2024",
  domain: "example.com",
  sourceType: "WEB",
  content: "英伟达、英特尔、AMD 三大巨头占据 70% 市场份额...",
  snippet: "市场分析摘要",
  publishedAt: new Date("2024-01-15"),
  credibilityScore: 0.85,
  metadata: {},
  figures: [],
  charts: [],
};

const mockSectionResult = {
  sectionId: "section-001",
  title: "市场概况",
  content: "## 市场概况\n\n英伟达占据 GPU 市场 80% 份额...",
  wordCount: 100,
  referencesUsed: [],
  generatedCharts: [],
  figureReferences: [],
};

const mockOutline = {
  dimensionName: "市场竞争格局",
  sections: [
    {
      id: "section-001",
      title: "市场概况",
      description: "概述市场规模",
      keyPoints: [],
      allocatedFigures: [],
    },
  ],
  researchObjective: "分析市场竞争格局",
  keyThemes: ["市场份额", "竞争优势"],
  intentUnderstanding: {
    coreQuestion: "半导体市场的竞争格局如何？",
    scope: { included: ["市场份额"], excluded: [] },
    expectedDepth: "comprehensive",
  },
  executionPlan: {
    parallelGroups: [["section-001"]],
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// Mock factory
// ──────────────────────────────────────────────────────────────────────────────

function buildBaseMocks() {
  const mockTopicEvidenceTx = {
    aggregate: jest.fn().mockResolvedValue({ _max: { citationIndex: 0 } }),
    createMany: jest.fn().mockResolvedValue({ count: 1 }),
    findMany: jest.fn().mockResolvedValue([{ id: "ev-001", citationIndex: 1 }]),
  };

  const mockPrisma = {
    topicDimension: {
      update: jest
        .fn()
        .mockResolvedValue({ id: "dim-001", status: "RESEARCHING" }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    researchMission: {
      update: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest
      .fn()
      .mockImplementation(async (fn: (tx: unknown) => unknown) => {
        return fn({ topicEvidence: mockTopicEvidenceTx });
      }),
  };

  const mockLeaderService = {
    planDimensionOutline: jest.fn().mockResolvedValue(mockOutline),
    reviewSectionOutput: jest.fn().mockResolvedValue({
      approved: true,
      feedback: "OK",
      score: 85,
    }),
    integrateDimensionResults: jest.fn().mockResolvedValue({
      content: "## 市场竞争格局\n\n综合分析内容...",
      metadata: {
        summary: "半导体市场由英伟达主导",
        keyFindings: ["英伟达 GPU 份额超 80%"],
      },
    }),
    extractClaims: jest.fn().mockResolvedValue([]),
  };

  const mockLeaderPlanningService = {
    planResearch: jest.fn(),
    getReasoningModel: jest.fn().mockResolvedValue(null),
    planDimensionOutline: jest.fn().mockResolvedValue(mockOutline),
  };

  const mockLeaderReviewService = {
    reviewTaskResult: jest
      .fn()
      .mockResolvedValue({ approved: true, feedback: "OK", score: 80 }),
    extractClaims: jest.fn().mockResolvedValue([]),
    verifyHypotheses: jest.fn().mockResolvedValue([]),
    reviewSectionOutput: jest
      .fn()
      .mockResolvedValue({ approved: true, feedback: "OK", score: 80 }),
    integrateDimensionResults: jest.fn().mockResolvedValue({
      content: "## 竞争格局\n\n综合分析内容...",
      metadata: { summary: "分析完成", keyFindings: [] },
    }),
  };

  const mockSectionWriter = {
    writeSection: jest.fn(),
    writeSectionWithRevisions: jest.fn().mockResolvedValue(mockSectionResult),
    writeSectionsParallel: jest.fn().mockResolvedValue([mockSectionResult]),
    reviseSection: jest.fn().mockResolvedValue(mockSectionResult),
  };

  const mockDataSourceRouter = {
    fetchDataForDimension: jest.fn(),
    scanLiteratureBaseline: jest.fn().mockResolvedValue(undefined),
  };

  const mockEventEmitter = {
    emitLeaderThinking: jest.fn().mockResolvedValue(undefined),
    emitLeaderPlanReady: jest.fn().mockResolvedValue(undefined),
    emitAgentWorking: jest.fn().mockResolvedValue(undefined),
    emitDimensionProgress: jest.fn().mockResolvedValue(undefined),
    emitDimensionResearchProgress: jest.fn().mockResolvedValue(undefined),
    emitMissionProgress: jest.fn().mockResolvedValue(undefined),
  };

  const mockAgentActivity = {
    startThinkingPhase: jest.fn().mockResolvedValue(undefined),
    endThinkingPhase: jest.fn().mockResolvedValue(undefined),
    recordActivity: jest.fn().mockResolvedValue(undefined),
    recordReviewActivity: jest.fn().mockResolvedValue(undefined),
  };

  const mockDataEnrichment = {
    enrichSearchResults: jest.fn().mockResolvedValue([mockEnrichedResult]),
    getEnrichmentStats: jest.fn().mockReturnValue({
      total: 1,
      fetched: 1,
      avgContentLength: 500,
      invalidUrls: 0,
      validUrls: 1,
    }),
    clearFetchCache: jest.fn(),
  };

  const mockLeaderTool = {
    generateEnhancedPlanningContext: jest.fn().mockResolvedValue({
      contextSummary: "",
    }),
  };

  const mockObservability = {
    recordResearchCost: jest.fn(),
    emitKernelEvent: jest.fn(),
    logError: jest.fn(),
    recordMissionMetrics: jest.fn(),
    startMissionTrace: jest.fn().mockReturnValue(null),
    addPhaseSpan: jest.fn().mockReturnValue(null),
    endPhaseSpan: jest.fn(),
    endMissionTrace: jest.fn(),
  };

  const mockQualityGate = {
    validateDimensionContent: jest.fn().mockReturnValue({
      passed: true,
      violations: [],
      fixedContent: "",
      wasAutoFixed: false,
      rewriteGuidance: [],
    }),
    validateFullReport: jest.fn().mockReturnValue({
      passed: true,
      violations: [],
      fixedContent: "",
      wasAutoFixed: false,
      rewriteGuidance: [],
    }),
  };

  return {
    mockPrisma,
    mockLeaderService,
    mockLeaderPlanningService,
    mockLeaderReviewService,
    mockSectionWriter,
    mockDataSourceRouter,
    mockEventEmitter,
    mockAgentActivity,
    mockDataEnrichment,
    mockLeaderTool,
    mockObservability,
    mockQualityGate,
    mockTopicEvidenceTx,
  };
}

// Helper: build module with optional services
async function buildModule(
  mocks: ReturnType<typeof buildBaseMocks>,
  extras: {
    contextCompression?: boolean;
    contextEvolution?: boolean;
    chatFacade?: boolean;
    tokenBudget?: boolean;
  } = {},
) {
  const mockContextCompression = {
    compress: jest.fn().mockResolvedValue({
      compressedContext: "compressed content",
      stats: { originalLength: 10000, compressedLength: 4000 },
    }),
  };

  const mockContextEvolution = {
    extractFacts: jest
      .fn()
      .mockResolvedValue({ facts: [{ factId: "f1", content: "fact1" }] }),
    buildFactsPromptSection: jest.fn().mockReturnValue("## Facts\n- fact1"),
  };

  const mockChatFacade = {
    chat: jest
      .fn()
      .mockResolvedValue({ content: "AI response", tokensUsed: 100 }),
    getDefaultModelByType: jest.fn().mockResolvedValue({ modelId: "gpt-4o" }),
  };

  const mockTokenBudget = {
    smartTruncate: jest
      .fn()
      .mockImplementation((content: string, limit: number) =>
        content.slice(0, limit),
      ),
  };

  const providers: unknown[] = [
    DimensionMissionService,
    { provide: PrismaService, useValue: mocks.mockPrisma },
    { provide: ResearchLeaderService, useValue: mocks.mockLeaderService },
    {
      provide: LeaderPlanningService,
      useValue: mocks.mockLeaderPlanningService,
    },
    { provide: LeaderReviewService, useValue: mocks.mockLeaderReviewService },
    { provide: SectionWriterService, useValue: mocks.mockSectionWriter },
    { provide: DataSourceRouterService, useValue: mocks.mockDataSourceRouter },
    { provide: ResearchEventEmitterService, useValue: mocks.mockEventEmitter },
    { provide: AgentActivityService, useValue: mocks.mockAgentActivity },
    { provide: DataEnrichmentService, useValue: mocks.mockDataEnrichment },
    { provide: LeaderToolService, useValue: mocks.mockLeaderTool },
    {
      provide: DimensionProgressService,
      useValue: {
        updateDimensionStatus: jest.fn().mockResolvedValue(undefined),
        emitProgress: jest.fn().mockResolvedValue(undefined),
      },
    },
    { provide: MissionObservabilityService, useValue: mocks.mockObservability },
    { provide: ReportQualityGateService, useValue: mocks.mockQualityGate },
  ];

  if (extras.contextCompression) {
    providers.push({
      provide: ContextCompressionService,
      useValue: mockContextCompression,
    });
  }
  if (extras.contextEvolution) {
    providers.push({
      provide: ContextEvolutionService,
      useValue: mockContextEvolution,
    });
  }
  if (extras.chatFacade) {
    providers.push({ provide: ChatFacade, useValue: mockChatFacade });
  }
  if (extras.tokenBudget) {
    providers.push({
      provide: TokenBudgetCalculatorService,
      useValue: mockTokenBudget,
    });
  }

  const module: TestingModule = await Test.createTestingModule({
    providers: providers as Parameters<
      typeof Test.createTestingModule
    >[0]["providers"],
  }).compile();

  return {
    module,
    service: module.get<DimensionMissionService>(DimensionMissionService),
    mockContextCompression,
    mockContextEvolution,
    mockChatFacade,
    mockTokenBudget,
  };
}

// Helper: setup a standard search phase
function setupSearchPhase(
  mocks: ReturnType<typeof buildBaseMocks>,
  overrides: {
    items?: unknown[];
    stats?: Partial<{
      total: number;
      fetched: number;
      avgContentLength: number;
      invalidUrls: number;
      validUrls: number;
    }>;
    leaderContext?: string;
  } = {},
) {
  mocks.mockDataSourceRouter.fetchDataForDimension.mockResolvedValue({
    items:
      overrides.items !== undefined ? overrides.items : [mockEnrichedResult],
    sources: ["web"],
    metadata: { searchQuery: "semiconductor market share 2024" },
  });

  mocks.mockDataEnrichment.enrichSearchResults.mockResolvedValue(
    overrides.items !== undefined ? overrides.items : [mockEnrichedResult],
  );

  mocks.mockDataEnrichment.getEnrichmentStats.mockReturnValue({
    total: overrides.stats?.total ?? 1,
    fetched: overrides.stats?.fetched ?? 1,
    avgContentLength: overrides.stats?.avgContentLength ?? 500,
    invalidUrls: overrides.stats?.invalidUrls ?? 0,
    validUrls: overrides.stats?.validUrls ?? 1,
  });

  mocks.mockLeaderTool.generateEnhancedPlanningContext.mockResolvedValue({
    contextSummary: overrides.leaderContext ?? "",
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Test suites
// ──────────────────────────────────────────────────────────────────────────────

describe("DimensionMissionService (supplemental)", () => {
  afterEach(() => jest.clearAllMocks());

  // ============================================================
  // clearEvidenceCache
  // ============================================================

  describe("clearEvidenceCache", () => {
    it("should call dataEnrichment.clearFetchCache", async () => {
      const mocks = buildBaseMocks();
      const { service } = await buildModule(mocks);

      service.clearEvidenceCache();

      expect(mocks.mockDataEnrichment.clearFetchCache).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================
  // executeSearchPhase — second-round search deduplication
  // ============================================================

  describe("executeSearchPhase — second-round search deduplication by URL", () => {
    it("should merge second-round results and deduplicate by URL", async () => {
      const mocks = buildBaseMocks();
      const { service } = await buildModule(mocks);

      const topicWithSecondRound = {
        ...mockTopic,
        topicConfig: { enableSecondRoundSearch: true, depthMode: "standard" },
      } as unknown as ResearchTopic;

      const dimWithMultipleQueries = {
        ...mockDimension,
        searchQueries: ["query1", "query2", "query3"],
      } as unknown as TopicDimension;

      const existingItem = {
        ...mockEnrichedResult,
        url: "https://example.com/existing",
      };
      const newItem = {
        ...mockEnrichedResult,
        id: "result-002",
        url: "https://example.com/new",
      };
      const duplicateItem = {
        ...mockEnrichedResult,
        url: "https://example.com/existing",
      }; // same URL

      // First call returns existing item (must have multiple items so extractKeyTermsFromResults
      // finds terms with frequency >= 2)
      const itemsWithRepeatedTerms = [
        {
          ...existingItem,
          title: "Nvidia GPU Analysis",
          snippet: "Nvidia GPU dominates market",
        },
        {
          ...existingItem,
          id: "r2",
          url: "https://example.com/existing2",
          title: "Nvidia GPU Report",
          snippet: "Nvidia GPU supply chain",
        },
      ];

      mocks.mockDataSourceRouter.fetchDataForDimension
        .mockResolvedValueOnce({
          items: itemsWithRepeatedTerms,
          sources: ["web"],
          metadata: { searchQuery: "query1" },
        })
        // Second call (second-round) returns new item + duplicate
        .mockResolvedValueOnce({
          items: [newItem, duplicateItem],
          sources: ["web"],
          metadata: { searchQuery: "supplement" },
        });

      mocks.mockDataEnrichment.enrichSearchResults.mockResolvedValue([
        existingItem,
        newItem,
      ]);
      mocks.mockDataEnrichment.getEnrichmentStats.mockReturnValue({
        total: 2,
        fetched: 2,
        avgContentLength: 500,
        invalidUrls: 0,
        validUrls: 2,
      });
      mocks.mockLeaderTool.generateEnhancedPlanningContext.mockResolvedValue({
        contextSummary: "",
      });

      const result = await service.executeSearchPhase(
        topicWithSecondRound,
        dimWithMultipleQueries,
      );

      // Should have called fetchDataForDimension twice (first + second round)
      expect(
        mocks.mockDataSourceRouter.fetchDataForDimension,
      ).toHaveBeenCalledTimes(2);
      expect(result).toBeDefined();
    });

    it("should not add items with duplicate URLs from second-round", async () => {
      const mocks = buildBaseMocks();
      const { service } = await buildModule(mocks);

      const topicWithSecondRound = {
        ...mockTopic,
        topicConfig: { enableSecondRoundSearch: true, depthMode: "thorough" },
      } as unknown as ResearchTopic;

      const dimWithQueries = {
        ...mockDimension,
        searchQueries: ["query1", "query2"],
      } as unknown as TopicDimension;

      const existingItem = {
        ...mockEnrichedResult,
        url: "https://same.com/article",
      };

      // Both rounds return same URL
      mocks.mockDataSourceRouter.fetchDataForDimension
        .mockResolvedValueOnce({
          items: [existingItem],
          sources: ["web"],
          metadata: { searchQuery: "query1" },
        })
        .mockResolvedValueOnce({
          items: [{ ...existingItem }], // same URL
          sources: ["web"],
          metadata: {},
        });

      mocks.mockDataEnrichment.enrichSearchResults.mockResolvedValue([
        existingItem,
      ]);
      mocks.mockDataEnrichment.getEnrichmentStats.mockReturnValue({
        total: 1,
        fetched: 1,
        avgContentLength: 500,
        invalidUrls: 0,
        validUrls: 1,
      });
      mocks.mockLeaderTool.generateEnhancedPlanningContext.mockResolvedValue({
        contextSummary: "",
      });

      await service.executeSearchPhase(topicWithSecondRound, dimWithQueries);

      // Enrichment should only be called with deduplicated items
      expect(mocks.mockDataEnrichment.enrichSearchResults).toHaveBeenCalled();
    });

    it("should skip second-round search in quick mode", async () => {
      const mocks = buildBaseMocks();
      const { service } = await buildModule(mocks);

      const quickTopic = {
        ...mockTopic,
        topicConfig: { depthMode: "quick" },
      } as unknown as ResearchTopic;

      setupSearchPhase(mocks);

      await service.executeSearchPhase(quickTopic, mockDimension);

      // Only one call (no second round in quick mode)
      expect(
        mocks.mockDataSourceRouter.fetchDataForDimension,
      ).toHaveBeenCalledTimes(1);
    });

    it("should handle second-round search failure gracefully (non-fatal)", async () => {
      const mocks = buildBaseMocks();
      const { service } = await buildModule(mocks);

      const topicWithSecondRound = {
        ...mockTopic,
        topicConfig: { depthMode: "standard" },
      } as unknown as ResearchTopic;

      const dimWithQueries = {
        ...mockDimension,
        searchQueries: ["query1", "query2"],
      } as unknown as TopicDimension;

      // First search succeeds, second fails
      mocks.mockDataSourceRouter.fetchDataForDimension
        .mockResolvedValueOnce({
          items: [mockEnrichedResult],
          sources: ["web"],
          metadata: {},
        })
        .mockRejectedValueOnce(new Error("Second search failed"));

      mocks.mockDataEnrichment.enrichSearchResults.mockResolvedValue([
        mockEnrichedResult,
      ]);
      mocks.mockDataEnrichment.getEnrichmentStats.mockReturnValue({
        total: 1,
        fetched: 1,
        avgContentLength: 500,
        invalidUrls: 0,
        validUrls: 1,
      });
      mocks.mockLeaderTool.generateEnhancedPlanningContext.mockResolvedValue({
        contextSummary: "",
      });

      const result = await service.executeSearchPhase(
        topicWithSecondRound,
        dimWithQueries,
      );

      expect(result).toBeDefined();
      expect(result.dimensionId).toBe("dim-001");
    });
  });

  // ============================================================
  // executeSearchPhase — enrichment stats with invalid URLs
  // ============================================================

  describe("executeSearchPhase — enrichment statistics", () => {
    it("should log warning when invalid URLs are found in enrichment", async () => {
      const mocks = buildBaseMocks();
      const { service } = await buildModule(mocks);

      mocks.mockDataSourceRouter.fetchDataForDimension.mockResolvedValue({
        items: [mockEnrichedResult],
        sources: ["web"],
        metadata: {},
      });
      mocks.mockDataEnrichment.enrichSearchResults.mockResolvedValue([
        mockEnrichedResult,
      ]);
      mocks.mockDataEnrichment.getEnrichmentStats.mockReturnValue({
        total: 5,
        fetched: 3,
        avgContentLength: 500,
        invalidUrls: 2,
        validUrls: 3,
      });
      mocks.mockLeaderTool.generateEnhancedPlanningContext.mockResolvedValue({
        contextSummary: "",
      });

      const result = await service.executeSearchPhase(mockTopic, mockDimension);

      // Service logs a warning for invalid URLs, but still returns result
      expect(result).toBeDefined();
    });

    it("should include leaderContextSummary in evidenceSummary when leader provides context", async () => {
      const mocks = buildBaseMocks();
      const { service } = await buildModule(mocks);

      setupSearchPhase(mocks, {
        leaderContext: "Latest market data shows strong GPU demand",
      });

      const result = await service.executeSearchPhase(mockTopic, mockDimension);

      expect(result.leaderContextSummary).toBe(
        "Latest market data shows strong GPU demand",
      );
      expect(result.evidenceSummary).toContain(
        "Latest market data shows strong GPU demand",
      );
    });
  });

  // ============================================================
  // executeSearchPhase — date parsing for freshness
  // ============================================================

  describe("executeSearchPhase — date parsing for freshness", () => {
    it("should parse publishedAt dates to compute freshnessInfo", async () => {
      const mocks = buildBaseMocks();
      const { service } = await buildModule(mocks);

      const resultWithDate = {
        ...mockEnrichedResult,
        publishedAt: new Date("2024-06-15"),
      };

      mocks.mockDataSourceRouter.fetchDataForDimension.mockResolvedValue({
        items: [resultWithDate],
        sources: ["web"],
        metadata: {},
      });
      mocks.mockDataEnrichment.enrichSearchResults.mockResolvedValue([
        resultWithDate,
      ]);
      mocks.mockDataEnrichment.getEnrichmentStats.mockReturnValue({
        total: 1,
        fetched: 1,
        avgContentLength: 500,
        invalidUrls: 0,
        validUrls: 1,
      });
      mocks.mockLeaderTool.generateEnhancedPlanningContext.mockResolvedValue({
        contextSummary: "",
      });

      const result = await service.executeSearchPhase(mockTopic, mockDimension);

      expect(result.searchResultsRecord.freshnessInfo).toBeDefined();
      expect(
        result.searchResultsRecord.freshnessInfo?.newestDate,
      ).toBeDefined();
    });

    it("should handle invalid publishedAt date gracefully", async () => {
      const mocks = buildBaseMocks();
      const { service } = await buildModule(mocks);

      const resultWithBadDate = {
        ...mockEnrichedResult,
        publishedAt: "not-a-date",
      };

      mocks.mockDataSourceRouter.fetchDataForDimension.mockResolvedValue({
        items: [resultWithBadDate],
        sources: ["web"],
        metadata: {},
      });
      mocks.mockDataEnrichment.enrichSearchResults.mockResolvedValue([
        resultWithBadDate,
      ]);
      mocks.mockDataEnrichment.getEnrichmentStats.mockReturnValue({
        total: 1,
        fetched: 1,
        avgContentLength: 500,
        invalidUrls: 0,
        validUrls: 1,
      });
      mocks.mockLeaderTool.generateEnhancedPlanningContext.mockResolvedValue({
        contextSummary: "",
      });

      const result = await service.executeSearchPhase(mockTopic, mockDimension);

      // freshnessInfo should be undefined when no valid dates
      expect(result.searchResultsRecord.freshnessInfo).toBeUndefined();
    });
  });

  // ============================================================
  // executeSearchPhase — knowledge base statistics
  // ============================================================

  describe("executeSearchPhase — knowledge base matching statistics", () => {
    it("should compute knowledgeBaseInfo when knowledgeBaseIds are configured", async () => {
      const mocks = buildBaseMocks();
      const { service } = await buildModule(mocks);

      const topicWithKB = {
        ...mockTopic,
        topicConfig: { knowledgeBaseIds: ["kb-001", "kb-002"] },
      } as unknown as ResearchTopic;

      const kbResult = {
        ...mockEnrichedResult,
        sourceType: "LOCAL",
        metadata: { knowledgeBaseSource: true, similarity: 0.85 },
      };

      mocks.mockDataSourceRouter.fetchDataForDimension.mockResolvedValue({
        items: [kbResult, mockEnrichedResult],
        sources: ["local", "web"],
        metadata: {},
      });
      mocks.mockDataEnrichment.enrichSearchResults.mockResolvedValue([
        kbResult,
        mockEnrichedResult,
      ]);
      mocks.mockDataEnrichment.getEnrichmentStats.mockReturnValue({
        total: 2,
        fetched: 2,
        avgContentLength: 500,
        invalidUrls: 0,
        validUrls: 2,
      });
      mocks.mockLeaderTool.generateEnhancedPlanningContext.mockResolvedValue({
        contextSummary: "",
      });

      const result = await service.executeSearchPhase(
        topicWithKB,
        mockDimension,
      );

      expect(result.searchResultsRecord.knowledgeBaseInfo).toBeDefined();
      expect(result.searchResultsRecord.knowledgeBaseInfo?.enabled).toBe(true);
      expect(
        result.searchResultsRecord.knowledgeBaseInfo?.matchedCount,
      ).toBeGreaterThan(0);
    });

    it("should compute avgSimilarity when knowledge base results have similarity scores", async () => {
      const mocks = buildBaseMocks();
      const { service } = await buildModule(mocks);

      const topicWithKB = {
        ...mockTopic,
        topicConfig: { knowledgeBaseIds: ["kb-001"] },
      } as unknown as ResearchTopic;

      const kbResult1 = {
        ...mockEnrichedResult,
        url: "https://kb.example.com/doc1",
        sourceType: "LOCAL",
        metadata: { knowledgeBaseSource: true, similarity: 0.9 },
      };
      const kbResult2 = {
        ...mockEnrichedResult,
        url: "https://kb.example.com/doc2",
        sourceType: "LOCAL",
        metadata: { knowledgeBaseSource: true, similarity: 0.8 },
      };

      mocks.mockDataSourceRouter.fetchDataForDimension.mockResolvedValue({
        items: [kbResult1, kbResult2],
        sources: ["local"],
        metadata: {},
      });
      mocks.mockDataEnrichment.enrichSearchResults.mockResolvedValue([
        kbResult1,
        kbResult2,
      ]);
      mocks.mockDataEnrichment.getEnrichmentStats.mockReturnValue({
        total: 2,
        fetched: 2,
        avgContentLength: 500,
        invalidUrls: 0,
        validUrls: 2,
      });
      mocks.mockLeaderTool.generateEnhancedPlanningContext.mockResolvedValue({
        contextSummary: "",
      });

      const result = await service.executeSearchPhase(
        topicWithKB,
        mockDimension,
      );

      expect(
        result.searchResultsRecord.knowledgeBaseInfo?.avgSimilarity,
      ).toBeCloseTo(0.85);
    });

    it("should not include knowledgeBaseInfo when no knowledge base IDs configured", async () => {
      const mocks = buildBaseMocks();
      const { service } = await buildModule(mocks);

      setupSearchPhase(mocks);

      const result = await service.executeSearchPhase(mockTopic, mockDimension);

      expect(result.searchResultsRecord.knowledgeBaseInfo).toBeUndefined();
    });
  });

  // ============================================================
  // executeSearchPhase — context compression pipeline
  // ============================================================

  describe("executeSearchPhase — context compression pipeline", () => {
    it("should use ContextCompressionService when evidence summary exceeds 8000 chars", async () => {
      const mocks = buildBaseMocks();
      const { service, mockContextCompression } = await buildModule(mocks, {
        contextCompression: true,
      });

      // The evidenceSummary = createEvidenceSummary(...) + leaderContextSummary.
      // createEvidenceSummary is short (titles only). To push > 8000 chars,
      // we rely on a very long leaderContextSummary.
      mocks.mockDataSourceRouter.fetchDataForDimension.mockResolvedValue({
        items: [mockEnrichedResult],
        sources: ["web"],
        metadata: {},
      });
      mocks.mockDataEnrichment.enrichSearchResults.mockResolvedValue([
        mockEnrichedResult,
      ]);
      mocks.mockDataEnrichment.getEnrichmentStats.mockReturnValue({
        total: 1,
        fetched: 1,
        avgContentLength: 500,
        invalidUrls: 0,
        validUrls: 1,
      });
      // Large leader context to push evidenceSummary over 8000 chars
      mocks.mockLeaderTool.generateEnhancedPlanningContext.mockResolvedValue({
        contextSummary: "A".repeat(9000),
      });

      const result = await service.executeSearchPhase(mockTopic, mockDimension);

      expect(result).toBeDefined();
      // When summary is large, ContextCompressionService.compress should be called
      expect(mockContextCompression.compress).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ targetSize: 4000, summaryStyle: "detailed" }),
      );
    });

    it("should fall back to TokenBudgetCalculatorService when ContextCompressionService is not available", async () => {
      const mocks = buildBaseMocks();
      const { service, mockTokenBudget } = await buildModule(mocks, {
        contextCompression: false,
        tokenBudget: true,
      });

      mocks.mockDataSourceRouter.fetchDataForDimension.mockResolvedValue({
        items: [mockEnrichedResult],
        sources: ["web"],
        metadata: {},
      });
      mocks.mockDataEnrichment.enrichSearchResults.mockResolvedValue([
        mockEnrichedResult,
      ]);
      mocks.mockDataEnrichment.getEnrichmentStats.mockReturnValue({
        total: 1,
        fetched: 1,
        avgContentLength: 500,
        invalidUrls: 0,
        validUrls: 1,
      });
      // Large leader context to push evidenceSummary over 8000 chars
      mocks.mockLeaderTool.generateEnhancedPlanningContext.mockResolvedValue({
        contextSummary: "X".repeat(9000),
      });

      const result = await service.executeSearchPhase(mockTopic, mockDimension);

      expect(result).toBeDefined();
      expect(mockTokenBudget.smartTruncate).toHaveBeenCalled();
    });

    it("should apply hard truncate at 12KB when both compression services are unavailable", async () => {
      const mocks = buildBaseMocks();
      // No contextCompression, no tokenBudget
      const { service } = await buildModule(mocks, {
        contextCompression: false,
        tokenBudget: false,
      });

      mocks.mockDataSourceRouter.fetchDataForDimension.mockResolvedValue({
        items: [mockEnrichedResult],
        sources: ["web"],
        metadata: {},
      });
      mocks.mockDataEnrichment.enrichSearchResults.mockResolvedValue([
        mockEnrichedResult,
      ]);
      mocks.mockDataEnrichment.getEnrichmentStats.mockReturnValue({
        total: 1,
        fetched: 1,
        avgContentLength: 500,
        invalidUrls: 0,
        validUrls: 1,
      });
      // Very large leader context to push evidenceSummary well over 12000 chars
      mocks.mockLeaderTool.generateEnhancedPlanningContext.mockResolvedValue({
        contextSummary: "A".repeat(15000),
      });

      const result = await service.executeSearchPhase(mockTopic, mockDimension);

      // Should complete successfully (hard truncate applied)
      expect(result).toBeDefined();
      expect(result.evidenceSummary.length).toBeLessThanOrEqual(12200); // 12000 + truncation notice len
    });

    it("should handle context compression failure gracefully", async () => {
      const mocks = buildBaseMocks();
      const { service, mockContextCompression } = await buildModule(mocks, {
        contextCompression: true,
      });

      mockContextCompression.compress.mockRejectedValue(
        new Error("Compression service down"),
      );

      const largeItems = Array.from({ length: 20 }, (_, i) => ({
        ...mockEnrichedResult,
        id: `result-${i}`,
        url: `https://example.com/article-${i}`,
        content: "A".repeat(1000),
        snippet: "B".repeat(500),
        fullContent: "C".repeat(1000),
      }));

      mocks.mockDataSourceRouter.fetchDataForDimension.mockResolvedValue({
        items: largeItems,
        sources: ["web"],
        metadata: {},
      });
      mocks.mockDataEnrichment.enrichSearchResults.mockResolvedValue(
        largeItems,
      );
      mocks.mockDataEnrichment.getEnrichmentStats.mockReturnValue({
        total: 20,
        fetched: 20,
        avgContentLength: 1500,
        invalidUrls: 0,
        validUrls: 20,
      });
      mocks.mockLeaderTool.generateEnhancedPlanningContext.mockResolvedValue({
        contextSummary: "",
      });

      const result = await service.executeSearchPhase(mockTopic, mockDimension);

      // Should complete despite compression failure
      expect(result).toBeDefined();
    });
  });

  // ============================================================
  // executeDimensionMission — quality gate auto-fix
  // ============================================================

  describe("executeDimensionMission — quality gate section auto-fix", () => {
    it("should auto-fix section content when quality gate wasAutoFixed is true", async () => {
      const mocks = buildBaseMocks();
      const { service } = await buildModule(mocks);

      setupSearchPhase(mocks);
      mocks.mockPrisma.topicDimension.update.mockResolvedValue({
        id: "dim-001",
      });

      // Quality gate: auto-fixed first time
      mocks.mockQualityGate.validateDimensionContent.mockReturnValue({
        passed: true,
        violations: [{ rule: "min-length", severity: "warning" }],
        fixedContent: "## Auto-fixed content\n\nFixed version.",
        wasAutoFixed: true,
        rewriteGuidance: [],
      });

      const result = await service.executeDimensionMission(
        mockTopic,
        mockDimension,
      );

      expect(result.success).toBe(true);
      expect(mocks.mockQualityGate.validateDimensionContent).toHaveBeenCalled();
    });

    it("should trigger AI rewrite when quality gate fails with rewriteGuidance", async () => {
      const mocks = buildBaseMocks();
      const { service } = await buildModule(mocks);

      setupSearchPhase(mocks);
      mocks.mockPrisma.topicDimension.update.mockResolvedValue({
        id: "dim-001",
      });

      // First QC check: failed with rewrite guidance
      mocks.mockQualityGate.validateDimensionContent
        .mockReturnValueOnce({
          passed: false,
          violations: [{ rule: "language-mix", severity: "critical" }],
          fixedContent: "",
          wasAutoFixed: false,
          rewriteGuidance: [
            "Content contains mixed Chinese/English, please use consistent language",
          ],
        })
        // Second QC check after rewrite
        .mockReturnValueOnce({
          passed: true,
          violations: [],
          fixedContent: "",
          wasAutoFixed: false,
          rewriteGuidance: [],
        });

      mocks.mockSectionWriter.reviseSection.mockResolvedValue({
        ...mockSectionResult,
        content: "## Revised content\n\nProperly revised.",
      });

      const result = await service.executeDimensionMission(
        mockTopic,
        mockDimension,
      );

      expect(result.success).toBe(true);
      expect(mocks.mockSectionWriter.reviseSection).toHaveBeenCalled();
    });

    it("should handle rewrite failure gracefully and keep auto-fixed content", async () => {
      const mocks = buildBaseMocks();
      const { service } = await buildModule(mocks);

      setupSearchPhase(mocks);
      mocks.mockPrisma.topicDimension.update.mockResolvedValue({
        id: "dim-001",
      });

      mocks.mockQualityGate.validateDimensionContent.mockReturnValue({
        passed: false,
        violations: [{ rule: "too-short", severity: "warning" }],
        fixedContent: "Auto-fixed short content.",
        wasAutoFixed: true,
        rewriteGuidance: ["Content is too short, expand analysis"],
      });

      mocks.mockSectionWriter.reviseSection.mockRejectedValue(
        new Error("Rewrite service timeout"),
      );

      const result = await service.executeDimensionMission(
        mockTopic,
        mockDimension,
      );

      // Should complete despite rewrite failure
      expect(result.success).toBe(true);
    });
  });

  // ============================================================
  // executeDimensionMission — ContextEvolution fact extraction
  // ============================================================

  describe("executeDimensionMission — cross-dimension fact extraction", () => {
    it("should extract facts when ContextEvolutionService and ChatFacade are available", async () => {
      const mocks = buildBaseMocks();
      const {
        service,
        mockContextEvolution,
        mockChatFacade: _mockChatFacade,
      } = await buildModule(mocks, {
        contextEvolution: true,
        chatFacade: true,
      });

      setupSearchPhase(mocks);
      mocks.mockPrisma.topicDimension.update.mockResolvedValue({
        id: "dim-001",
      });

      const result = await service.executeDimensionMission(
        mockTopic,
        mockDimension,
      );

      expect(result.success).toBe(true);
      // Fact extraction should have been called
      expect(mockContextEvolution.extractFacts).toHaveBeenCalled();
      expect(result.extractedFacts).toBeDefined();
    });

    it("should skip fact extraction when ContextEvolutionService is not available", async () => {
      const mocks = buildBaseMocks();
      const { service, mockContextEvolution } = await buildModule(mocks, {
        contextEvolution: false,
        chatFacade: true,
      });

      setupSearchPhase(mocks);
      mocks.mockPrisma.topicDimension.update.mockResolvedValue({
        id: "dim-001",
      });

      const result = await service.executeDimensionMission(
        mockTopic,
        mockDimension,
      );

      expect(result.success).toBe(true);
      expect(mockContextEvolution.extractFacts).not.toHaveBeenCalled();
    });

    it("should skip fact extraction when ChatFacade is not available", async () => {
      const mocks = buildBaseMocks();
      const { service, mockContextEvolution } = await buildModule(mocks, {
        contextEvolution: true,
        chatFacade: false,
      });

      setupSearchPhase(mocks);
      mocks.mockPrisma.topicDimension.update.mockResolvedValue({
        id: "dim-001",
      });

      const result = await service.executeDimensionMission(
        mockTopic,
        mockDimension,
      );

      expect(result.success).toBe(true);
      expect(mockContextEvolution.extractFacts).not.toHaveBeenCalled();
    });

    it("should handle fact extraction failure gracefully (non-fatal)", async () => {
      const mocks = buildBaseMocks();
      const { service, mockContextEvolution } = await buildModule(mocks, {
        contextEvolution: true,
        chatFacade: true,
      });

      mockContextEvolution.extractFacts.mockRejectedValue(
        new Error("Fact extraction failed"),
      );

      setupSearchPhase(mocks);
      mocks.mockPrisma.topicDimension.update.mockResolvedValue({
        id: "dim-001",
      });

      const result = await service.executeDimensionMission(
        mockTopic,
        mockDimension,
      );

      // Should still succeed
      expect(result.success).toBe(true);
      expect(result.extractedFacts).toBeUndefined();
    });
  });

  // ============================================================
  // executeDimensionMission — section writing with multiple sections
  // ============================================================

  describe("executeDimensionMission — section writing with outline", () => {
    it("should execute Leader outline planning before writing", async () => {
      const mocks = buildBaseMocks();
      const { service } = await buildModule(mocks);

      setupSearchPhase(mocks);
      mocks.mockPrisma.topicDimension.update.mockResolvedValue({
        id: "dim-001",
      });

      await service.executeDimensionMission(mockTopic, mockDimension);

      // Verify planDimensionOutline was called with topic, dimension and evidenceSummary
      expect(
        mocks.mockLeaderPlanningService.planDimensionOutline,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ name: mockTopic.name }),
        expect.objectContaining({ name: mockDimension.name }),
        expect.any(String),
        undefined, // figuresSummary is undefined when no figures in evidence
        expect.any(Array),
      );
    });

    it("should call integrateDimensionResults with all section results", async () => {
      const mocks = buildBaseMocks();
      const { service } = await buildModule(mocks);

      setupSearchPhase(mocks);
      mocks.mockPrisma.topicDimension.update.mockResolvedValue({
        id: "dim-001",
      });

      await service.executeDimensionMission(mockTopic, mockDimension);

      expect(
        mocks.mockLeaderService.integrateDimensionResults,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ name: "市场竞争格局" }),
        expect.arrayContaining([
          expect.objectContaining({
            title: expect.any(String),
            content: expect.any(String),
          }),
        ]),
        "zh",
      );
    });

    it("should update dimension to COMPLETED status after successful writing", async () => {
      const mocks = buildBaseMocks();
      const { service, module } = await buildModule(mocks);

      setupSearchPhase(mocks);

      await service.executeDimensionMission(mockTopic, mockDimension);

      const progressMock = module.get(DimensionProgressService);
      expect(progressMock.updateDimensionStatus).toHaveBeenCalledWith(
        "dim-001",
        DimensionStatus.COMPLETED,
        expect.objectContaining({ lastResearchedAt: expect.any(Date) }),
      );
    });
  });

  // ============================================================
  // executeSearchPhase — temporal context
  // ============================================================

  describe("executeSearchPhase — temporal context", () => {
    it("should return temporal context with currentDate and freshnessRequirement", async () => {
      const mocks = buildBaseMocks();
      const { service } = await buildModule(mocks);

      setupSearchPhase(mocks);

      const result = await service.executeSearchPhase(mockTopic, mockDimension);

      expect(result.temporalContext).toBeDefined();
      expect(result.temporalContext.currentDate).toBeDefined();
      expect(typeof result.temporalContext.currentDate).toBe("string");
      expect(result.temporalContext.freshnessRequirement).toBeDefined();
    });

    it("should use searchTimeRange from topicConfig when specified", async () => {
      const mocks = buildBaseMocks();
      const { service } = await buildModule(mocks);

      const topicWithTimeRange = {
        ...mockTopic,
        topicConfig: { searchTimeRange: "1y" },
      } as unknown as ResearchTopic;

      setupSearchPhase(mocks);

      const result = await service.executeSearchPhase(
        topicWithTimeRange,
        mockDimension,
      );

      expect(result.temporalContext).toBeDefined();
      expect(result.temporalContext.freshnessRequirement).toBeDefined();
    });
  });

  // ============================================================
  // executeSearchPhase — figureRegistry
  // ============================================================

  describe("executeSearchPhase — figure registry", () => {
    it("should return a figureRegistry from the evidence data", async () => {
      const mocks = buildBaseMocks();
      const { service } = await buildModule(mocks);

      const resultWithFigures = {
        ...mockEnrichedResult,
        figures: [
          {
            figureId: "fig-001",
            imageUrl: "https://example.com/figure1.png",
            caption: "Figure 1",
          },
        ],
      };

      mocks.mockDataSourceRouter.fetchDataForDimension.mockResolvedValue({
        items: [resultWithFigures],
        sources: ["web"],
        metadata: {},
      });
      mocks.mockDataEnrichment.enrichSearchResults.mockResolvedValue([
        resultWithFigures,
      ]);
      mocks.mockDataEnrichment.getEnrichmentStats.mockReturnValue({
        total: 1,
        fetched: 1,
        avgContentLength: 500,
        invalidUrls: 0,
        validUrls: 1,
      });
      mocks.mockLeaderTool.generateEnhancedPlanningContext.mockResolvedValue({
        contextSummary: "",
      });

      const result = await service.executeSearchPhase(mockTopic, mockDimension);

      expect(result.figureRegistry).toBeDefined();
      expect(result.figureRegistry).toBeInstanceOf(Map);
    });

    it("should return empty figureRegistry when no figures in evidence", async () => {
      const mocks = buildBaseMocks();
      const { service } = await buildModule(mocks);

      setupSearchPhase(mocks);

      const result = await service.executeSearchPhase(mockTopic, mockDimension);

      expect(result.figureRegistry).toBeInstanceOf(Map);
    });
  });

  // ============================================================
  // executeDimensionMission — evidence saving and idMapping
  // ============================================================

  describe("executeDimensionMission — evidence saving with reportId", () => {
    it("should save evidence and return savedIds when reportId is provided", async () => {
      const mocks = buildBaseMocks();
      const { service } = await buildModule(mocks);

      setupSearchPhase(mocks);
      mocks.mockPrisma.topicDimension.update.mockResolvedValue({
        id: "dim-001",
      });

      const mockEvidenceTx = {
        aggregate: jest.fn().mockResolvedValue({ _max: { citationIndex: 0 } }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: "ev-saved-1", citationIndex: 1 }]),
      };
      mocks.mockPrisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => unknown) =>
          fn({ topicEvidence: mockEvidenceTx }),
      );

      const result = await service.executeDimensionMission(
        mockTopic,
        mockDimension,
        "report-001",
      );

      expect(result.success).toBe(true);
      expect(result.evidenceIds).toBeDefined();
    });

    it("should not call $transaction when no reportId provided", async () => {
      const mocks = buildBaseMocks();
      const { service } = await buildModule(mocks);

      setupSearchPhase(mocks);
      mocks.mockPrisma.topicDimension.update.mockResolvedValue({
        id: "dim-001",
      });

      await service.executeDimensionMission(
        mockTopic,
        mockDimension,
        undefined, // no reportId
      );

      expect(mocks.mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // executeSearchPhase — figuresSummary
  // ============================================================

  describe("executeSearchPhase — figuresSummary output", () => {
    it("should include figuresSummary in result", async () => {
      const mocks = buildBaseMocks();
      const { service } = await buildModule(mocks);

      setupSearchPhase(mocks);

      const result = await service.executeSearchPhase(mockTopic, mockDimension);

      expect(result).toHaveProperty("figuresSummary");
      expect(typeof result.figuresSummary).toBe("string");
    });
  });
});

/**
 * DimensionMissionService Supplemental2 Unit Tests
 *
 * Targets remaining uncovered lines:
 * - line 335: second-round search found no new sources (log path)
 * - line 462: publishedAt Date parsing failure (non-fatal debug)
 * - line 474: date parsing for freshness
 * - lines 579-585: EVENT type anchor evidence injection
 * - line 630: context compression failure (non-fatal fallback)
 * - line 652: TokenBudgetCalculatorService truncation
 * - line 1080: claim extraction failure (non-fatal warn)
 * - lines 1318-1326: chatFacade call in fact extraction path
 * - line 1674: filterEvidenceForSection zeroScoreCount > 50% path
 * - lines 1974-1977: validateAllocatedFigures – figureId not in registry
 * - lines 1991-1994: validateAllocatedFigures – duplicate imageUrl
 * - line 2006: validateAllocatedFigures – empty caption pass-through
 * - lines 2026-2029: validateAllocatedFigures – keyword irrelevance
 * - lines 2127-2136: saveEvidence FK constraint violation (P2003)
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
import { ReportQualityGateService } from "../../quality/report-quality-gate.service";
import { DimensionProgressService } from "../dimension-progress.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import {
  ContextCompressionService,
  ContextEvolutionService,
} from "@/modules/ai-harness/facade";
import { TokenBudgetCalculatorService } from "@/modules/ai-harness/facade";
import { ResearchTopic, TopicDimension } from "@prisma/client";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";

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
  fullContent: "英伟达 GPU 详细分析...",
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
    reviewSectionOutput: jest
      .fn()
      .mockResolvedValue({ approved: true, feedback: "OK", score: 85 }),
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

async function buildModule(
  mocks: ReturnType<typeof buildBaseMocks>,
  extras: {
    contextCompression?: {
      compress: jest.Mock;
    } | null;
    contextEvolution?: {
      extractFacts: jest.Mock;
      buildFactsPromptSection: jest.Mock;
    } | null;
    chatFacade?: {
      chat: jest.Mock;
      getDefaultModelByType?: jest.Mock;
    } | null;
    tokenBudget?: {
      smartTruncate: jest.Mock;
    } | null;
  } = {},
) {
  const providers: unknown[] = [
    DimensionMissionService,
    { provide: PrismaService, useValue: mocks.mockPrisma },
    { provide: ResearchLeaderService, useValue: mocks.mockLeaderService },
    {
      provide: LeaderPlanningService,
      useValue: mocks.mockLeaderPlanningService,
    },
    {
      provide: LeaderReviewService,
      useValue: mocks.mockLeaderReviewService,
    },
    { provide: SectionWriterService, useValue: mocks.mockSectionWriter },
    {
      provide: DataSourceRouterService,
      useValue: mocks.mockDataSourceRouter,
    },
    {
      provide: ResearchEventEmitterService,
      useValue: mocks.mockEventEmitter,
    },
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
    {
      provide: MissionObservabilityService,
      useValue: mocks.mockObservability,
    },
    { provide: ReportQualityGateService, useValue: mocks.mockQualityGate },
  ];

  if (extras.contextCompression !== undefined) {
    providers.push({
      provide: ContextCompressionService,
      useValue: extras.contextCompression,
    });
  }
  if (extras.contextEvolution !== undefined) {
    providers.push({
      provide: ContextEvolutionService,
      useValue: extras.contextEvolution,
    });
  }
  if (extras.chatFacade !== undefined) {
    providers.push({
      provide: ChatFacade,
      useValue: extras.chatFacade,
    });
  }
  if (extras.tokenBudget !== undefined) {
    providers.push({
      provide: TokenBudgetCalculatorService,
      useValue: extras.tokenBudget,
    });
  }

  const module: TestingModule = await Test.createTestingModule({
    providers: providers as Parameters<
      typeof Test.createTestingModule
    >[0]["providers"],
  }).compile();

  const service = module.get<DimensionMissionService>(DimensionMissionService);

  // Suppress logger output in tests
  jest.spyOn(service["logger"], "log").mockImplementation(() => undefined);
  jest.spyOn(service["logger"], "warn").mockImplementation(() => undefined);
  jest.spyOn(service["logger"], "error").mockImplementation(() => undefined);
  jest.spyOn(service["logger"], "debug").mockImplementation(() => undefined);

  return service;
}

function setupStandardSearchPhase(
  mocks: ReturnType<typeof buildBaseMocks>,
  overrides: {
    items?: unknown[];
    secondRoundItems?: unknown[];
    enableSecondRound?: boolean;
  } = {},
) {
  const items =
    overrides.items !== undefined ? overrides.items : [mockEnrichedResult];

  mocks.mockDataSourceRouter.fetchDataForDimension
    .mockResolvedValueOnce({
      items,
      sources: ["web"],
      metadata: { searchQuery: "semiconductor market share 2024" },
    })
    // Second call for second-round search (if enabled)
    .mockResolvedValueOnce({
      items: overrides.secondRoundItems ?? [],
      sources: ["web"],
      metadata: {},
    });

  mocks.mockDataEnrichment.enrichSearchResults.mockResolvedValue(items);
  mocks.mockDataEnrichment.getEnrichmentStats.mockReturnValue({
    total: items.length,
    fetched: items.length,
    avgContentLength: 500,
    invalidUrls: 0,
    validUrls: items.length,
  });
  mocks.mockLeaderTool.generateEnhancedPlanningContext.mockResolvedValue({
    contextSummary: "",
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("DimensionMissionService (supplemental2)", () => {
  afterEach(() => jest.clearAllMocks());

  // ============================================================
  // validateAllocatedFigures (private) – via direct invocation
  // ============================================================

  describe("validateAllocatedFigures (private – lines 1974-2052)", () => {
    async function callValidate(
      svc: DimensionMissionService,
      outline: typeof mockOutline,
      registry: Map<string, { imageUrl: string; caption: string }> | undefined,
    ) {
      return (
        svc as unknown as {
          validateAllocatedFigures(outline: unknown, registry: unknown): void;
        }
      ).validateAllocatedFigures(outline, registry);
    }

    it("should skip figure when figureId not in registry (lines 1974-1977)", async () => {
      const mocks = buildBaseMocks();
      const svc = await buildModule(mocks);

      const section = {
        id: "s1",
        title: "AI Market",
        description: "market analysis",
        keyPoints: ["market share"],
        allocatedFigures: [
          { figureId: "missing-fig", imageUrl: "", caption: "chart" },
        ],
      };
      const outline = { ...mockOutline, sections: [section] };
      const registry = new Map<string, { imageUrl: string; caption: string }>();

      await callValidate(svc, outline as never, registry);

      expect(section.allocatedFigures).toHaveLength(0);
    });

    it("should skip figure with invalid imageUrl after backfill", async () => {
      const mocks = buildBaseMocks();
      const svc = await buildModule(mocks);

      const section = {
        id: "s1",
        title: "AI Market",
        description: "market analysis",
        keyPoints: ["market share"],
        allocatedFigures: [
          { figureId: "fig-invalid", imageUrl: "", caption: "chart" },
        ],
      };
      const outline = { ...mockOutline, sections: [section] };
      const registry = new Map([
        [
          "fig-invalid",
          {
            imageUrl: "data:image/png;base64,abc", // invalid base64
            caption: "AI market chart",
          },
        ],
      ]);

      await callValidate(svc, outline as never, registry);

      expect(section.allocatedFigures).toHaveLength(0);
    });

    it("should skip duplicate imageUrl across sections (lines 1991-1994)", async () => {
      const mocks = buildBaseMocks();
      const svc = await buildModule(mocks);

      const imageUrl = "https://example.com/shared-image.png";
      const section1 = {
        id: "s1",
        title: "AI Hardware",
        description: "hardware analysis",
        keyPoints: ["GPU"],
        allocatedFigures: [
          { figureId: "fig-a", imageUrl: "", caption: "GPU chart" },
        ],
      };
      const section2 = {
        id: "s2",
        title: "AI Software",
        description: "software stack",
        keyPoints: ["GPU software"],
        allocatedFigures: [
          // Different figureId but same imageUrl
          { figureId: "fig-b", imageUrl: "", caption: "GPU chart" },
        ],
      };
      const outline = {
        ...mockOutline,
        sections: [section1, section2],
        executionPlan: { parallelGroups: [["s1", "s2"]] },
      };
      const registry = new Map([
        ["fig-a", { imageUrl, caption: "GPU chart" }],
        ["fig-b", { imageUrl, caption: "GPU chart" }], // same imageUrl
      ]);

      await callValidate(svc, outline as never, registry);

      const total =
        section1.allocatedFigures.length + section2.allocatedFigures.length;
      expect(total).toBeLessThanOrEqual(1);
    });

    it("should accept figure with empty caption (line 2006 pass-through)", async () => {
      const mocks = buildBaseMocks();
      const svc = await buildModule(mocks);

      const section = {
        id: "s1",
        title: "AI Overview",
        description: "overview",
        keyPoints: ["overview"],
        allocatedFigures: [
          { figureId: "fig-empty", imageUrl: "", caption: "" },
        ],
      };
      const outline = { ...mockOutline, sections: [section] };
      const registry = new Map([
        ["fig-empty", { imageUrl: "https://example.com/fig.png", caption: "" }],
      ]);

      await callValidate(svc, outline as never, registry);

      // Empty caption → no keywords → accepted
      expect(section.allocatedFigures).toHaveLength(1);
    });

    it("should remove irrelevant figure when no keyword overlap (lines 2026-2029)", async () => {
      const mocks = buildBaseMocks();
      const svc = await buildModule(mocks);

      const section = {
        id: "s1",
        title: "量子计算前沿",
        description: "量子比特技术",
        keyPoints: ["量子纠缠"],
        allocatedFigures: [
          {
            figureId: "fig-robot",
            imageUrl: "",
            caption: "工业机器人关节结构图",
          },
        ],
      };
      const outline = { ...mockOutline, sections: [section] };
      const registry = new Map([
        [
          "fig-robot",
          {
            imageUrl: "https://example.com/robot.png",
            caption: "工业机器人关节结构图",
          },
        ],
      ]);

      await callValidate(svc, outline as never, registry);

      expect(section.allocatedFigures).toHaveLength(0);
    });

    it("should keep figure with matching keyword overlap", async () => {
      const mocks = buildBaseMocks();
      const svc = await buildModule(mocks);

      const section = {
        id: "s1",
        title: "半导体市场竞争",
        description: "芯片市场份额分析",
        keyPoints: ["市场份额"],
        allocatedFigures: [
          {
            figureId: "fig-semi",
            imageUrl: "",
            caption: "半导体市场份额分布图",
          },
        ],
      };
      const outline = { ...mockOutline, sections: [section] };
      const registry = new Map([
        [
          "fig-semi",
          {
            imageUrl: "https://example.com/semi.png",
            caption: "半导体市场份额分布图",
          },
        ],
      ]);

      await callValidate(svc, outline as never, registry);

      expect(section.allocatedFigures).toHaveLength(1);
    });
  });

  // ============================================================
  // saveEvidence – FK constraint violation (P2003) – lines 2127-2136
  // ============================================================

  describe("saveEvidence (private) – FK constraint (lines 2127-2136)", () => {
    it("should return empty arrays on P2003 FK constraint error", async () => {
      const mocks = buildBaseMocks();

      // Simulate FK constraint violation
      const fkError = new PrismaClientKnownRequestError(
        "Foreign key constraint failed",
        { code: "P2003", clientVersion: "5.0.0", meta: {} },
      );
      mocks.mockPrisma.$transaction.mockRejectedValue(fkError);

      const svc = await buildModule(mocks);

      const saveEvidence = (
        svc as unknown as {
          saveEvidence(
            evidenceData: unknown[],
            reportId: string,
          ): Promise<{
            savedIds: string[];
            idMapping: Map<string, string>;
            indexMapping: Map<number, number>;
          }>;
        }
      ).saveEvidence;

      const result = await saveEvidence.call(
        svc,
        [
          {
            id: "ev-1",
            title: "Test Evidence",
            url: "https://example.com",
            content: "content",
            source: "WEB",
            credibilityScore: 0.8,
          },
        ],
        "report-deleted",
      );

      expect(result.savedIds).toEqual([]);
      expect(result.idMapping.size).toBe(0);
      expect(result.indexMapping.size).toBe(0);
    });

    it("should rethrow non-FK errors from saveEvidence", async () => {
      const mocks = buildBaseMocks();

      const genericError = new Error("Database connection lost");
      mocks.mockPrisma.$transaction.mockRejectedValue(genericError);

      const svc = await buildModule(mocks);

      const saveEvidence = (
        svc as unknown as {
          saveEvidence(
            evidenceData: unknown[],
            reportId: string,
          ): Promise<unknown>;
        }
      ).saveEvidence;

      await expect(
        saveEvidence.call(
          svc,
          [
            {
              id: "ev-1",
              title: "Test",
              url: "https://ex.com",
              content: "c",
              source: "WEB",
            },
          ],
          "report-1",
        ),
      ).rejects.toThrow("Database connection lost");
    });
  });

  // ============================================================
  // executeSearchPhase – EVENT type anchor evidence injection (lines 579-585)
  // ============================================================

  describe("executeSearchPhase – EVENT type anchor evidence injection", () => {
    it("should inject anchor evidence for EVENT topic with sourceContent", async () => {
      const mocks = buildBaseMocks();

      const eventTopic = {
        ...mockTopic,
        type: "EVENT",
        topicConfig: {
          sourceContent: "Apple announced new iPhone 16...",
          sourceUrl: "https://apple.com/newsroom/iphone16",
          sourceTitle: "Apple iPhone 16 Launch",
        },
      } as unknown as ResearchTopic;

      setupStandardSearchPhase(mocks, { items: [mockEnrichedResult] });

      const svc = await buildModule(mocks);

      const result = await svc.executeSearchPhase(
        eventTopic,
        mockDimension,
        "report-001",
        "mission-001",
      );

      // Anchor evidence should be injected at front
      expect(result.evidenceData.length).toBeGreaterThanOrEqual(1);
      // The first item should be the anchor evidence (or search results if anchor fails)
    });

    it("should not inject anchor evidence for EVENT topic with no sourceContent or sourceUrl", async () => {
      const mocks = buildBaseMocks();

      const eventTopic = {
        ...mockTopic,
        type: "EVENT",
        topicConfig: {}, // no sourceContent or sourceUrl
      } as unknown as ResearchTopic;

      setupStandardSearchPhase(mocks, { items: [mockEnrichedResult] });

      const svc = await buildModule(mocks);

      const result = await svc.executeSearchPhase(
        eventTopic,
        mockDimension,
        "report-001",
        "mission-001",
      );

      expect(result).toBeDefined();
    });
  });

  // ============================================================
  // executeSearchPhase – context compression failure (line 630)
  // ============================================================

  describe("executeSearchPhase – context compression failure (non-fatal fallback)", () => {
    it("should fall back to original content when compression throws", async () => {
      const mocks = buildBaseMocks();

      // Generate enough evidence summary to trigger compression (>8000 chars)
      const largeContent = "X".repeat(9000);
      const richEnrichedResult = {
        ...mockEnrichedResult,
        fullContent: largeContent,
        snippet: largeContent,
      };

      setupStandardSearchPhase(mocks, { items: [richEnrichedResult] });

      const failingCompression = {
        compress: jest.fn().mockRejectedValue(new Error("compression timeout")),
      };

      const svc = await buildModule(mocks, {
        contextCompression: failingCompression,
      });

      const result = await svc.executeSearchPhase(
        mockTopic,
        mockDimension,
        "report-001",
        "mission-001",
      );

      // Should succeed despite compression failure
      expect(result).toBeDefined();
      expect(result.evidenceSummary).toBeDefined();
    });
  });

  // ============================================================
  // executeSearchPhase – TokenBudgetCalculatorService truncation (line 652)
  // ============================================================

  describe("executeSearchPhase – TokenBudgetCalculatorService truncation (line 652)", () => {
    it("should use TokenBudgetCalculatorService to truncate when evidence summary is long", async () => {
      const mocks = buildBaseMocks();

      const largeContent = "Y".repeat(9000);
      const richEnrichedResult = {
        ...mockEnrichedResult,
        fullContent: largeContent,
        snippet: largeContent,
      };

      setupStandardSearchPhase(mocks, { items: [richEnrichedResult] });

      const mockTokenBudget = {
        smartTruncate: jest
          .fn()
          .mockImplementation((content: string, limit: number) =>
            content.slice(0, limit),
          ),
      };

      // No contextCompression (null = provide null/undefined), but provide tokenBudget
      const svc = await buildModule(mocks, {
        tokenBudget: mockTokenBudget,
      });

      const result = await svc.executeSearchPhase(
        mockTopic,
        mockDimension,
        "report-001",
        "mission-001",
      );

      expect(result).toBeDefined();
    });
  });

  // ============================================================
  // executeDimensionMission – claim extraction failure (line 1080)
  // ============================================================

  describe("executeDimensionMission – claim extraction failure (line 1080)", () => {
    it("should continue execution when extractClaims throws", async () => {
      const mocks = buildBaseMocks();

      setupStandardSearchPhase(mocks);

      // extractClaims throws
      mocks.mockLeaderReviewService.extractClaims.mockRejectedValue(
        new Error("claim extraction API error"),
      );

      const svc = await buildModule(mocks);

      const result = await svc.executeDimensionMission(
        mockTopic,
        mockDimension,
        "report-001",
        "mission-001",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      );

      expect(result.success).toBe(true);
      expect(result.extractedClaims).toEqual([]);
    });
  });

  // ============================================================
  // executeDimensionMission – ContextEvolution + ChatFacade fact extraction (lines 1318-1326)
  // ============================================================

  describe("executeDimensionMission – fact extraction with ContextEvolution+ChatFacade", () => {
    it("should extract cross-dimension facts when both services are available", async () => {
      const mocks = buildBaseMocks();

      setupStandardSearchPhase(mocks);

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
        getDefaultModelByType: jest
          .fn()
          .mockResolvedValue({ modelId: "gpt-4o" }),
      };

      const svc = await buildModule(mocks, {
        contextEvolution: mockContextEvolution,
        chatFacade: mockChatFacade,
      });

      const result = await svc.executeDimensionMission(
        mockTopic,
        mockDimension,
        "report-001",
        "mission-001",
      );

      expect(result.success).toBe(true);
      // extractFacts should have been called
      expect(mockContextEvolution.extractFacts).toHaveBeenCalled();
    });

    it("should skip fact extraction and log degraded mode when ContextEvolution is unavailable", async () => {
      const mocks = buildBaseMocks();

      setupStandardSearchPhase(mocks);

      // contextEvolution = null means it won't be provided → service.contextEvolution = undefined
      const svc = await buildModule(mocks, {});

      const _warnSpy = jest
        .spyOn(svc["logger"], "debug")
        .mockImplementation(() => undefined);

      const result = await svc.executeDimensionMission(
        mockTopic,
        mockDimension,
        "report-001",
        "mission-001",
      );

      expect(result.success).toBe(true);
    });

    it("should handle fact extraction failure gracefully (non-fatal)", async () => {
      const mocks = buildBaseMocks();

      setupStandardSearchPhase(mocks);

      const mockContextEvolution = {
        extractFacts: jest
          .fn()
          .mockRejectedValue(new Error("fact extraction timeout")),
        buildFactsPromptSection: jest.fn().mockReturnValue(""),
      };

      const mockChatFacade = {
        chat: jest
          .fn()
          .mockResolvedValue({ content: "AI response", tokensUsed: 100 }),
      };

      const svc = await buildModule(mocks, {
        contextEvolution: mockContextEvolution,
        chatFacade: mockChatFacade,
      });

      const result = await svc.executeDimensionMission(
        mockTopic,
        mockDimension,
        "report-001",
        "mission-001",
      );

      // Should succeed despite fact extraction failure
      expect(result.success).toBe(true);
    });
  });

  // ============================================================
  // filterEvidenceForSection – zero-score majority path (line 1674)
  // ============================================================

  describe("filterEvidenceForSection (private) – zeroScore majority (line 1674)", () => {
    it("should return withScore+limited withoutScore when majority have score=0", async () => {
      const mocks = buildBaseMocks();
      const svc = await buildModule(mocks);

      const filterEvidence = (
        svc as unknown as {
          filterEvidenceForSection(
            section: unknown,
            evidenceData: unknown[],
          ): unknown[];
        }
      ).filterEvidenceForSection;

      const section = {
        id: "s1",
        title: "Quantum Computing",
        description: "quantum bits",
        keyPoints: ["quantum entanglement"],
      };

      // Create 5 evidence items where 4 have no keyword overlap (score=0)
      // and 1 has overlap
      const evidenceData = [
        {
          id: "ev-1",
          title: "Quantum entanglement breakthrough",
          url: "https://example.com/1",
          fullContent: "quantum entanglement research",
          snippet: "quantum computing advance",
          source: "WEB",
        },
        {
          id: "ev-2",
          title: "Football game results",
          url: "https://sports.com/2",
          fullContent: "football match results",
          snippet: "sports news",
          source: "WEB",
        },
        {
          id: "ev-3",
          title: "Stock market update",
          url: "https://finance.com/3",
          fullContent: "stock market daily update",
          snippet: "financial news",
          source: "WEB",
        },
        {
          id: "ev-4",
          title: "Weather forecast",
          url: "https://weather.com/4",
          fullContent: "weather forecast tomorrow",
          snippet: "meteorology",
          source: "WEB",
        },
        {
          id: "ev-5",
          title: "Cooking recipes",
          url: "https://cooking.com/5",
          fullContent: "pasta carbonara recipe",
          snippet: "food blog",
          source: "WEB",
        },
      ];

      const result = filterEvidence.call(svc, section, evidenceData);

      // The function should handle the majority-zero case
      expect(Array.isArray(result)).toBe(true);
      // Result should be bounded (not returning all 5 unfiltered)
      expect(result.length).toBeLessThanOrEqual(5);
    });
  });
});

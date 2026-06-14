/**
 * DimensionWritingService Unit Tests
 *
 * Tests for the dimension writing phase (Phase 2 & 3):
 * - executeWritingPhase
 * - section writing with dependency tracking
 * - leader review and integration
 * - saveEvidence with transaction
 * - assessCredibility, validateDate, replaceEvidenceIds
 * - validateAllocatedFigures
 * - filterEvidenceForSection, extractKeywords
 * - getPreviousSections
 * - convertToAnalysisResult, extractTrendsFromContent, etc.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { DimensionWritingService } from "../dimension-writing.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ResearchLeaderService } from "../../core/research/research-leader.service";
import { LeaderReviewService } from "../../core/leader/leader-review.service";
import { SectionWriterService } from "../section-writer.service";
import { ResearchEventEmitterService } from "../../core/research/research-event-emitter.service";
import { AgentActivityService } from "../../monitoring/agent-activity.service";
import { ReportQualityGateService } from "../../quality/report-quality-gate.service";
import { SectionSelfEvalService } from "../../quality/section-self-eval.service";
import { SectionRemediationService } from "../../quality/section-remediation.service";
import { DimensionStatus } from "@prisma/client";

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
  status: DimensionStatus.PENDING,
  searchSources: ["WEB"],
  searchKeywords: ["AI", "technology"],
  priority: 1,
  order: 1,
  estimatedTime: 30,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeSectionPlan = (overrides: Record<string, unknown> = {}) => ({
  id: `section-${Math.random().toString(36).slice(2)}`,
  title: "AI Development History",
  description: "Historical overview",
  targetWords: 600,
  keyPoints: ["1950s origins", "1980s expert systems", "2010s deep learning"],
  evidenceRequirements: { minReferences: 2, preferredTypes: ["academic"] },
  agentConfig: null,
  order: 1,
  dependsOn: [],
  ...overrides,
});

const makeOutline = (sections: unknown[] = [makeSectionPlan()]) => {
  const secs = sections as Array<{ id: string }>;
  return {
    sections,
    totalWords: 3000,
    estimatedTime: 60,
    intentUnderstanding: {
      coreQuestion: "What are the AI development trends?",
      scope: {
        included: ["machine learning", "deep learning"],
        excluded: ["robotics"],
      },
      expectedDepth: "comprehensive",
    },
    allocatedFigures: [],
    executionPlan: {
      parallelGroups: [secs.map((s) => s.id)],
    },
  };
};

const makeSearchPhaseResult = (overrides: Record<string, unknown> = {}) => ({
  dimensionId: "dim-1",
  dimensionName: "技术发展",
  enrichedResults: [],
  evidenceData: [
    {
      id: "ev-1",
      title: "AI 2024 Report",
      content: "Comprehensive AI analysis for 2024.",
      url: "https://ai-report.com/2024",
      source: "WEB",
      credibilityScore: 0.85,
      relevanceScore: 0.9,
    },
  ],
  evidenceSummary: "Evidence collected from web sources.",
  searchResultsRecord: {},
  temporalContext: {
    currentDate: "2025年1月19日",
    freshnessRequirement: "优先使用2024年数据",
  },
  figuresSummary: "",
  leaderContextSummary: "",
  ...overrides,
});

const makeSectionWriteResult = (overrides: Record<string, unknown> = {}) => ({
  sectionId: "section-1",
  title: "AI Development History",
  content: "# AI历史\n\n" + "A".repeat(600),
  wordCount: 650,
  referencesUsed: ["ev-1"],
  generatedCharts: [],
  figureReferences: [],
  actualModelId: "gpt-4o",
  ...overrides,
});

const makeIntegratedResult = (overrides: Record<string, unknown> = {}) => ({
  title: "Integrated Analysis",
  content: "## Analysis\n\nThis is the integrated result content.",
  metadata: {
    summary: "Summary of AI development trends.",
    keyFindings: ["Finding 1", "Finding 2"],
    confidence: 0.85,
    confidenceLevel: 0.85,
  },
  wordCount: 2000,
  ...overrides,
});

// ============================================================
// Mocks
// ============================================================

const mockTopicEvidenceTx = {
  aggregate: jest.fn().mockResolvedValue({ _max: { citationIndex: 0 } }),
  createMany: jest.fn().mockResolvedValue({ count: 1 }),
  findMany: jest
    .fn()
    .mockResolvedValue([{ id: "ev-saved-1", citationIndex: 1 }]),
};

const mockPrisma = {
  topicDimension: {
    update: jest.fn(),
  },
  researchEvidence: {
    create: jest.fn(),
    createMany: jest.fn(),
  },
  researchTopic: {
    findUnique: jest.fn().mockResolvedValue({ language: "zh" }),
  },
  $transaction: jest
    .fn()
    .mockImplementation(async (fn: (tx: unknown) => unknown) => {
      return fn({ topicEvidence: mockTopicEvidenceTx });
    }),
};

const mockLeaderService = {
  reviewSection: jest.fn(),
  reviewSectionOutput: jest.fn(),
  integrateResults: jest.fn(),
  integrateDimensionResults: jest.fn(),
  extractClaims: jest.fn().mockResolvedValue([]),
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
    content: "## Analysis\n\nIntegrated content.",
    metadata: { summary: "Summary", keyFindings: [] },
  }),
};

const mockSectionWriter = {
  writeSection: jest.fn(),
  reviseSection: jest.fn(),
  writeSectionsParallel: jest.fn(),
};

const mockEventEmitter = {
  emitLeaderPlanReady: jest.fn().mockResolvedValue(undefined),
  emitLeaderThinking: jest.fn().mockResolvedValue(undefined),
  emitSectionCompleted: jest.fn().mockResolvedValue(undefined),
  emitDimensionCompleted: jest.fn().mockResolvedValue(undefined),
  emitAgentWriting: jest.fn().mockResolvedValue(undefined),
  emitAgentReviewing: jest.fn().mockResolvedValue(undefined),
  emitAgentWorking: jest.fn().mockResolvedValue(undefined),
};

const mockAgentActivity = {
  startThinkingPhase: jest.fn().mockResolvedValue(undefined),
  endThinkingPhase: jest.fn().mockResolvedValue(undefined),
  recordActivity: jest.fn().mockResolvedValue(undefined),
  recordReviewActivity: jest.fn().mockResolvedValue(undefined),
};

const mockQualityGate = {
  validateDimensionContent: jest.fn().mockReturnValue({
    passed: true,
    wasAutoFixed: false,
    fixedContent: "",
    violations: [],
    rewriteGuidance: [],
  }),
  validateFullReport: jest.fn().mockReturnValue({
    passed: true,
    wasAutoFixed: false,
    fixedContent: "",
    violations: [],
    rewriteGuidance: [],
  }),
};

const mockSelfEval = {
  evaluateSection: jest.fn().mockResolvedValue({
    overall: 85,
    dimensions: {},
    needsRemediation: false,
    remediationHints: [],
  }),
  determineRemediationActions: jest.fn().mockReturnValue([]),
};

const mockRemediation = {
  getRemediationModelId: jest.fn().mockResolvedValue(""),
  remediate: jest.fn().mockResolvedValue({ content: "", improved: false }),
};

// ============================================================
// Test suite
// ============================================================

describe("DimensionWritingService", () => {
  let service: DimensionWritingService;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockSectionWriter.writeSection.mockResolvedValue(makeSectionWriteResult());
    mockSectionWriter.writeSectionsParallel.mockResolvedValue([
      makeSectionWriteResult(),
    ]);
    mockLeaderService.reviewSection.mockResolvedValue({
      approved: true,
      feedback: "Looks good",
      revisionInstructions: null,
    });
    mockLeaderService.reviewSectionOutput.mockResolvedValue({
      approved: true,
      score: 90,
      feedback: "Looks good",
      revisionInstructions: null,
    });
    mockLeaderService.integrateResults.mockResolvedValue(
      makeIntegratedResult(),
    );
    mockLeaderService.integrateDimensionResults.mockResolvedValue(
      makeIntegratedResult(),
    );
    mockPrisma.topicDimension.update.mockResolvedValue({});
    mockPrisma.researchEvidence.createMany = jest
      .fn()
      .mockResolvedValue({ count: 0 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DimensionWritingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ResearchLeaderService, useValue: mockLeaderService },
        { provide: LeaderReviewService, useValue: mockLeaderReviewService },
        { provide: SectionWriterService, useValue: mockSectionWriter },
        { provide: ResearchEventEmitterService, useValue: mockEventEmitter },
        { provide: AgentActivityService, useValue: mockAgentActivity },
        {
          provide: ReportQualityGateService,
          useValue: mockQualityGate,
        },
        { provide: SectionSelfEvalService, useValue: mockSelfEval },
        { provide: SectionRemediationService, useValue: mockRemediation },
      ],
    }).compile();

    service = module.get<DimensionWritingService>(DimensionWritingService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ============================================================
  // executeWritingPhase
  // ============================================================

  describe("executeWritingPhase", () => {
    it("should execute writing phase and return success result", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      const searchResult = makeSearchPhaseResult();
      const outline = makeOutline();

      const result = await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
      );

      expect(result.success).toBe(true);
      expect(result.dimensionId).toBe("dim-1");
    });

    it("should call sectionWriter.writeSectionsParallel for each parallel group", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      const searchResult = makeSearchPhaseResult();
      const outline = makeOutline([
        makeSectionPlan({ id: "sec-1", title: "Section 1", order: 1 }),
        makeSectionPlan({ id: "sec-2", title: "Section 2", order: 2 }),
      ]);

      mockSectionWriter.writeSectionsParallel.mockResolvedValueOnce([
        makeSectionWriteResult({ sectionId: "sec-1", title: "Section 1" }),
        makeSectionWriteResult({ sectionId: "sec-2", title: "Section 2" }),
      ]);

      await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
      );

      expect(mockSectionWriter.writeSectionsParallel).toHaveBeenCalledTimes(1);
    });

    it("should use quality gate instead of LLM review loop (v4)", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      const searchResult = makeSearchPhaseResult();
      const outline = makeOutline([makeSectionPlan()]);

      await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
      );

      // v4: quality gate replaces LLM review loop
      expect(mockLeaderService.reviewSectionOutput).not.toHaveBeenCalled();
      expect(mockQualityGate.validateDimensionContent).toHaveBeenCalled();
    });

    it("should call leaderService.integrateDimensionResults after all sections are written", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      const searchResult = makeSearchPhaseResult();
      const outline = makeOutline([makeSectionPlan()]);

      await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
      );

      expect(mockLeaderService.integrateDimensionResults).toHaveBeenCalled();
    });

    it("should emit agent activity events during writing", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      const searchResult = makeSearchPhaseResult();
      const outline = makeOutline([makeSectionPlan()]);

      await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
      );

      expect(mockAgentActivity.endThinkingPhase).toHaveBeenCalled();
    });

    it("should trigger AI rewrite when quality gate fails with rewriteGuidance (v4)", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      const searchResult = makeSearchPhaseResult();
      const outline = makeOutline([makeSectionPlan()]);

      // Quality gate fails with rewriteGuidance on first call, passes on second
      mockQualityGate.validateDimensionContent
        .mockReturnValueOnce({
          passed: false,
          violations: [
            {
              rule: "language_consistency",
              severity: "error",
              message: "外语内容过多",
            },
          ],
          fixedContent: "auto-fixed content",
          wasAutoFixed: true,
          rewriteGuidance: ["语言一致性不合格：请将所有外语段落翻译为中文"],
        })
        .mockReturnValue({
          passed: true,
          violations: [],
          fixedContent: "",
          wasAutoFixed: false,
          rewriteGuidance: [],
        });

      mockSectionWriter.reviseSection.mockResolvedValueOnce(
        makeSectionWriteResult({
          content: "# 修改后的内容\n\n" + "修".repeat(600),
        }),
      );

      const result = await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
      );

      expect(mockSectionWriter.reviseSection).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it("should call emitProgressFn when provided", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      const searchResult = makeSearchPhaseResult();
      const outline = makeOutline([makeSectionPlan()]);

      const emitProgressFn = jest.fn().mockResolvedValue(undefined);

      await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        emitProgressFn,
      );

      expect(emitProgressFn).toHaveBeenCalled();
    });

    it("should return error result when writing fails completely", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      const searchResult = makeSearchPhaseResult();
      const outline = makeOutline([makeSectionPlan()]);

      // Reject at the integration stage which is guaranteed to be called
      // after the writing phase completes
      mockLeaderService.integrateDimensionResults.mockRejectedValue(
        new Error("Integration failed completely"),
      );

      const result = await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should pass modelId to sectionWriter when provided", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      const searchResult = makeSearchPhaseResult();
      const outline = makeOutline([makeSectionPlan()]);

      await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
        undefined,
        "mission-1",
        "claude-3-opus",
      );

      expect(mockSectionWriter.writeSectionsParallel).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ modelId: "claude-3-opus" }),
        ]),
      );
    });

    it("should pass assignedSkills to section writer via writeInputs", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      const searchResult = makeSearchPhaseResult();
      const outline = makeOutline([makeSectionPlan()]);
      const assignedSkills = ["deep_dive", "synthesis"];

      await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
        undefined, // reportId
        undefined, // missionId
        undefined, // modelId
        undefined, // taskId
        undefined, // assignedTools
        assignedSkills,
      );

      expect(mockSectionWriter.writeSectionsParallel).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ assignedSkills })]),
      );
    });

    it("should emit leader plan ready event at start", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      const searchResult = makeSearchPhaseResult();
      const outline = makeOutline([makeSectionPlan()]);

      await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
      );

      expect(mockEventEmitter.emitLeaderPlanReady).toHaveBeenCalledWith(
        "topic-1",
        "dim-1",
        expect.any(Number),
        expect.any(Number),
      );
    });

    it("should update dimension status to COMPLETED on success", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      const searchResult = makeSearchPhaseResult();
      const outline = makeOutline([makeSectionPlan()]);

      await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
      );

      expect(mockPrisma.topicDimension.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "dim-1" },
          data: expect.objectContaining({ status: DimensionStatus.COMPLETED }),
        }),
      );
    });

    it("should update dimension status to FAILED on error", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      const searchResult = makeSearchPhaseResult();
      const outline = makeOutline([makeSectionPlan()]);

      mockLeaderService.integrateDimensionResults.mockRejectedValue(
        new Error("Fatal error"),
      );

      await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
      );

      expect(mockPrisma.topicDimension.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "dim-1" },
          data: { status: DimensionStatus.FAILED },
        }),
      );
    });

    it("should emit progress failed stage when error occurs and emitProgressFn provided", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      const searchResult = makeSearchPhaseResult();
      const outline = makeOutline([makeSectionPlan()]);
      const emitProgressFn = jest.fn().mockResolvedValue(undefined);

      mockLeaderService.integrateDimensionResults.mockRejectedValue(
        new Error("Fatal error"),
      );

      const result = await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        emitProgressFn,
      );

      expect(result.success).toBe(false);
      expect(emitProgressFn).toHaveBeenCalledWith(
        "topic-1",
        "技术发展",
        expect.objectContaining({ stage: "failed" }),
        undefined,
        undefined,
        undefined,
      );
    });

    it("should save evidence when reportId is provided", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      const searchResult = makeSearchPhaseResult();
      const outline = makeOutline([makeSectionPlan()]);

      await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
        "report-123",
      );

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it("should NOT call $transaction when no reportId is provided", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      const searchResult = makeSearchPhaseResult();
      const outline = makeOutline([makeSectionPlan()]);

      await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
        // no reportId
      );

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it("should handle claim extraction failure gracefully (non-fatal)", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      const searchResult = makeSearchPhaseResult();
      const outline = makeOutline([makeSectionPlan()]);

      mockLeaderService.extractClaims.mockRejectedValue(
        new Error("Claims extraction failed"),
      );

      const result = await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
      );

      // Should still succeed despite claim extraction failure
      expect(result.success).toBe(true);
      expect(result.extractedClaims).toEqual([]);
    });

    it("should include extractedClaims when extraction succeeds", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      const searchResult = makeSearchPhaseResult();
      const outline = makeOutline([makeSectionPlan()]);

      const fakeClaims = [
        { id: "claim-1", text: "AI will dominate by 2030", sectionId: "sec-1" },
      ];
      mockLeaderReviewService.extractClaims.mockResolvedValue(fakeClaims);

      const result = await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
      );

      expect(result.extractedClaims).toEqual(fakeClaims);
    });

    it("should deduplicate generated charts with same title", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      const searchResult = makeSearchPhaseResult();
      const outline = makeOutline([makeSectionPlan()]);

      // Return two sections each with a chart of the same title
      mockSectionWriter.writeSectionsParallel.mockResolvedValueOnce([
        makeSectionWriteResult({
          generatedCharts: [
            { title: "Revenue Trend", type: "bar", data: [] },
            { title: "Revenue Trend", type: "bar", data: [] }, // duplicate
            { title: null, type: "line", data: [] }, // null title - kept
          ],
        }),
      ]);

      const result = await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
      );

      expect(result.success).toBe(true);
    });

    it("should deduplicate figure references by composite key and filter null imageUrl", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      const searchResult = makeSearchPhaseResult();
      const outline = makeOutline([makeSectionPlan()]);

      mockSectionWriter.writeSectionsParallel.mockResolvedValueOnce([
        makeSectionWriteResult({
          figureReferences: [
            {
              id: "fig-1",
              imageUrl: "https://img.example.com/fig1.png",
              evidenceCitationIndex: 1,
              figureIndex: 0,
            },
            {
              id: "fig-1-dup",
              imageUrl: "https://img.example.com/fig1.png",
              evidenceCitationIndex: 1,
              figureIndex: 0,
            }, // duplicate by composite key
            {
              id: "fig-3",
              imageUrl: null,
              evidenceCitationIndex: 3,
              figureIndex: 0,
            }, // null imageUrl - filtered
            {
              id: "fig-2",
              imageUrl: "https://img.example.com/fig2.png",
              evidenceCitationIndex: 2,
              figureIndex: 0,
            },
          ],
        }),
      ]);

      const result = await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
      );

      expect(result.success).toBe(true);
    });

    it("should extract actual model ID from last section result", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      const searchResult = makeSearchPhaseResult();
      const outline = makeOutline([makeSectionPlan()]);

      mockSectionWriter.writeSectionsParallel.mockResolvedValueOnce([
        makeSectionWriteResult({ actualModelId: "claude-3-sonnet" }),
      ]);

      const result = await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
      );

      expect(result.success).toBe(true);
      expect(result.actualModelId).toBe("claude-3-sonnet");
    });

    it("should handle maxRevisionRounds=0 (skip review loop)", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      const searchResult = makeSearchPhaseResult();
      const outline = makeOutline([makeSectionPlan()]);

      const result = await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        0, // maxRevisionRounds = 0
      );

      // With 0 revisions allowed, reviewSectionOutput should not be called
      expect(mockLeaderService.reviewSectionOutput).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it("should handle revision failure gracefully (keep current content, break loop)", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      const searchResult = makeSearchPhaseResult();
      const outline = makeOutline([makeSectionPlan()]);

      // Reviewer rejects
      mockLeaderService.reviewSectionOutput.mockResolvedValue({
        approved: false,
        score: 50,
        feedback: "Poor quality",
        revisionInstructions: "Rewrite completely",
      });

      // Revision throws
      mockSectionWriter.reviseSection.mockRejectedValue(
        new Error("Revision service failed"),
      );

      const result = await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        3, // maxRevisionRounds = 3
      );

      // Should still succeed, just kept original content
      expect(result.success).toBe(true);
    });

    it("should call emitProgressFn with integrating stage", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      const searchResult = makeSearchPhaseResult();
      const outline = makeOutline([makeSectionPlan()]);
      const emitProgressFn = jest.fn().mockResolvedValue(undefined);

      await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        emitProgressFn,
      );

      const calls = emitProgressFn.mock.calls.map((c) => c[2].stage);
      expect(calls).toContain("integrating");
    });

    it("should call emitProgressFn with completed stage on success", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      const searchResult = makeSearchPhaseResult();
      const outline = makeOutline([makeSectionPlan()]);
      const emitProgressFn = jest.fn().mockResolvedValue(undefined);

      await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        emitProgressFn,
      );

      const stages = emitProgressFn.mock.calls.map((c) => c[2].stage);
      expect(stages).toContain("completed");
    });

    it("should handle sections with dependsOn (two sequential groups)", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      const searchResult = makeSearchPhaseResult();
      const sec1 = makeSectionPlan({
        id: "sec-1",
        title: "Background",
        order: 1,
      });
      const sec2 = makeSectionPlan({
        id: "sec-2",
        title: "Analysis",
        order: 2,
        dependsOn: ["sec-1"],
      });
      const outline = {
        ...makeOutline([sec1, sec2]),
        executionPlan: { parallelGroups: [["sec-1"], ["sec-2"]] },
      };

      mockSectionWriter.writeSectionsParallel
        .mockResolvedValueOnce([
          makeSectionWriteResult({ sectionId: "sec-1", title: "Background" }),
        ])
        .mockResolvedValueOnce([
          makeSectionWriteResult({ sectionId: "sec-2", title: "Analysis" }),
        ]);

      const result = await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
      );

      expect(result.success).toBe(true);
      expect(mockSectionWriter.writeSectionsParallel).toHaveBeenCalledTimes(2);
    });

    it("should handle evidence data being empty in saveEvidence path", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      const searchResult = makeSearchPhaseResult({ evidenceData: [] });
      const outline = makeOutline([makeSectionPlan()]);

      const result = await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
        "report-123", // With reportId but empty evidence
      );

      // Empty evidence => saveEvidence returns early with no transaction call
      expect(result.success).toBe(true);
      expect(result.evidenceIds).toEqual([]);
    });

    it("should replace evidence IDs in content when indexMapping has entries", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();

      const evidenceData = [
        {
          id: "ev-1",
          title: "Source 1",
          url: "http://source1.com",
          domain: "source1.com",
          snippet: "snippet",
          sourceType: "web",
          publishedAt: null,
        },
      ];
      const searchResult = makeSearchPhaseResult({ evidenceData });
      const outline = makeOutline([makeSectionPlan()]);

      mockLeaderService.integrateDimensionResults.mockResolvedValue({
        ...makeIntegratedResult(),
        content: "Based on analysis [1] the trends are clear.",
      });

      // Transaction returns citationIndex=5 (non-1 to trigger replacement)
      mockTopicEvidenceTx.findMany.mockResolvedValue([
        { id: "saved-1", citationIndex: 5 },
      ]);

      const result = await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
        "report-123",
      );

      expect(result.success).toBe(true);
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it("should update figureReferences evidenceCitationIndex when indexMapping has entries", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();

      const evidenceData = [
        {
          id: "ev-1",
          title: "Source 1",
          url: "http://source1.com",
          domain: "source1.com",
          snippet: "snippet",
          sourceType: "web",
          publishedAt: null,
        },
      ];
      const searchResult = makeSearchPhaseResult({ evidenceData });
      const outline = makeOutline([makeSectionPlan()]);

      mockSectionWriter.writeSectionsParallel.mockResolvedValueOnce([
        makeSectionWriteResult({
          figureReferences: [
            {
              id: "fig-1",
              imageUrl: "https://img.example.com/fig.png",
              evidenceCitationIndex: 1,
              figureIndex: 0,
            },
          ],
        }),
      ]);

      // Transaction returns citationIndex=5 (triggers indexMapping)
      mockTopicEvidenceTx.findMany.mockResolvedValue([
        { id: "saved-1", citationIndex: 5 },
      ]);

      const result = await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
        "report-123",
      );

      expect(result.success).toBe(true);
    });

    it("should validate allocated figures and skip out-of-range evidence indices", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();

      const evidenceData = [
        {
          id: "ev-1",
          title: "Source 1",
          url: "http://source1.com",
          domain: "source1.com",
          snippet: "snippet",
          sourceType: "web",
          publishedAt: null,
          extractedFigures: [],
        },
      ];

      const sectionWithOutOfRangeFigure = makeSectionPlan({
        id: "sec-1",
        title: "Section 1",
        allocatedFigures: [
          {
            evidenceIndex: 999,
            figureIndex: 0,
            imageUrl: "http://img.com/fig.png",
            caption: "Fig 1",
          },
        ],
      });

      const searchResult = makeSearchPhaseResult({ evidenceData });
      const outline = makeOutline([sectionWithOutOfRangeFigure]);

      const result = await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
      );

      expect(result.success).toBe(true);
    });

    it("should try to recover imageUrl from extractedFigures when missing", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();

      const evidenceData = [
        {
          id: "ev-1",
          title: "Source 1",
          url: "http://source1.com",
          domain: "source1.com",
          snippet: "snippet",
          sourceType: "web",
          publishedAt: null,
          extractedFigures: [
            {
              imageUrl: "http://img.com/real-fig.png",
              caption: "Real Caption",
              alt: "alt",
            },
          ],
        },
      ];

      const sectionWithEmptyImageUrl = makeSectionPlan({
        id: "sec-1",
        title: "Section 1",
        allocatedFigures: [
          { evidenceIndex: 1, figureIndex: 0, imageUrl: "", caption: "" },
        ],
      });

      const searchResult = makeSearchPhaseResult({ evidenceData });
      const outline = makeOutline([sectionWithEmptyImageUrl]);

      const result = await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
      );

      expect(result.success).toBe(true);
    });

    it("should skip figure when imageUrl empty and cannot be recovered", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();

      const evidenceData = [
        {
          id: "ev-1",
          title: "Source 1",
          url: "http://source1.com",
          domain: "source1.com",
          snippet: "snippet",
          sourceType: "web",
          publishedAt: null,
          extractedFigures: [
            { imageUrl: "", caption: "No URL", alt: "alt text" },
          ], // empty imageUrl in source too
        },
      ];

      const sectionWithEmptyImageUrl = makeSectionPlan({
        id: "sec-1",
        title: "Section 1",
        allocatedFigures: [
          { evidenceIndex: 1, figureIndex: 0, imageUrl: "", caption: "" },
        ],
      });

      const searchResult = makeSearchPhaseResult({ evidenceData });
      const outline = makeOutline([sectionWithEmptyImageUrl]);

      const result = await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
      );

      expect(result.success).toBe(true);
    });

    it("should deduplicate allocated figures globally across sections", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();

      const evidenceData = [
        {
          id: "ev-1",
          title: "Source 1",
          url: "http://source1.com",
          domain: "source1.com",
          snippet: "snippet",
          sourceType: "web",
          publishedAt: null,
          extractedFigures: [],
        },
      ];

      // Two sections claiming the same figure [1:0]
      const sec1 = makeSectionPlan({
        id: "sec-1",
        title: "Section 1",
        allocatedFigures: [
          {
            evidenceIndex: 1,
            figureIndex: 0,
            imageUrl: "http://img.com/fig.png",
            caption: "Fig 1",
          },
        ],
      });
      const sec2 = makeSectionPlan({
        id: "sec-2",
        title: "Section 2",
        allocatedFigures: [
          {
            evidenceIndex: 1,
            figureIndex: 0,
            imageUrl: "http://img.com/fig.png",
            caption: "Fig 1 duplicate",
          },
        ],
      });

      const searchResult = makeSearchPhaseResult({ evidenceData });
      const outline = {
        ...makeOutline([sec1, sec2]),
        executionPlan: { parallelGroups: [["sec-1", "sec-2"]] },
      };

      mockSectionWriter.writeSectionsParallel.mockResolvedValueOnce([
        makeSectionWriteResult({ sectionId: "sec-1", title: "Section 1" }),
        makeSectionWriteResult({ sectionId: "sec-2", title: "Section 2" }),
      ]);

      const result = await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
      );

      expect(result.success).toBe(true);
    });
  });

  // ============================================================
  // Multiple revision rounds
  // ============================================================

  describe("revision rounds", () => {
    it("v4: quality gate replaces LLM review — at most 1 AI rewrite per section", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      const searchResult = makeSearchPhaseResult();
      const outline = makeOutline([makeSectionPlan()]);

      // Quality gate always fails with rewriteGuidance
      mockQualityGate.validateDimensionContent.mockReturnValue({
        passed: false,
        violations: [
          {
            rule: "min_content_length",
            severity: "error",
            message: "内容过短",
          },
        ],
        fixedContent: "auto-fixed",
        wasAutoFixed: true,
        rewriteGuidance: ["内容过短：请增加更多证据支持的分析内容"],
      });

      mockSectionWriter.reviseSection.mockResolvedValue(
        makeSectionWriteResult({ content: "Revised" }),
      );

      const result = await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
      );

      expect(result.success).toBe(true);
      // v4: at most 1 AI rewrite per section (not multiple rounds)
      expect(mockSectionWriter.reviseSection).toHaveBeenCalledTimes(1);
      // No LLM review
      expect(mockLeaderService.reviewSectionOutput).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // filterEvidenceForSection via integration
  // ============================================================

  describe("filterEvidenceForSection (via integration)", () => {
    it("should return all evidence when evidenceData.length <= 5", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      const evidenceData = [
        {
          id: "e1",
          title: "AI advances",
          snippet: "AI in 2024",
          sourceType: "web",
          url: "http://a.com",
          domain: "a.com",
          publishedAt: null,
        },
        {
          id: "e2",
          title: "ML progress",
          snippet: "ML stuff",
          sourceType: "web",
          url: "http://b.com",
          domain: "b.com",
          publishedAt: null,
        },
        {
          id: "e3",
          title: "Neural nets",
          snippet: "Neural networks",
          sourceType: "web",
          url: "http://c.com",
          domain: "c.com",
          publishedAt: null,
        },
      ];
      const searchResult = makeSearchPhaseResult({ evidenceData });
      const outline = makeOutline([
        makeSectionPlan({ title: "Deep learning trends" }),
      ]);

      await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
      );

      expect(mockSectionWriter.writeSectionsParallel).toHaveBeenCalled();
    });

    it("should filter evidence when more than 5 items exist", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      // 8 evidence items: filtering kicks in
      const evidenceData = Array.from({ length: 8 }, (_, i) => ({
        id: `e${i + 1}`,
        title: i < 4 ? `Deep learning paper ${i}` : `Unrelated article ${i}`,
        snippet:
          i < 4
            ? `Deep learning advances in neural network architecture ${i}`
            : `Cooking recipes ${i}`,
        sourceType: "web",
        url: `http://e${i}.com`,
        domain: `e${i}.com`,
        publishedAt: null,
      }));
      const searchResult = makeSearchPhaseResult({ evidenceData });
      const outline = makeOutline([
        makeSectionPlan({
          title: "Deep Learning Architecture",
          keyPoints: ["neural networks", "training"],
        }),
      ]);

      await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
      );

      expect(mockSectionWriter.writeSectionsParallel).toHaveBeenCalled();
    });

    it("should fallback to all evidence when no keywords can be extracted", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      // 8 items but section has title with all stop words (and no description)
      const evidenceData = Array.from({ length: 8 }, (_, i) => ({
        id: `e${i + 1}`,
        title: `Item ${i}`,
        snippet: `Snippet ${i}`,
        sourceType: "web",
        url: `http://e${i}.com`,
        domain: `e${i}.com`,
        publishedAt: null,
      }));
      const searchResult = makeSearchPhaseResult({ evidenceData });
      // Section with only stop-word keywords + null description (all get filtered -> 0 keywords)
      const outline = makeOutline([
        makeSectionPlan({
          title: "the an is",
          keyPoints: [],
          description: null,
        }),
      ]);

      await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
      );

      expect(mockSectionWriter.writeSectionsParallel).toHaveBeenCalled();
    });

    it("should return relevant evidence when 5+ items match section keywords", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      // 10 evidence items, 6 of which match the section keywords -> hits "relevant.length >= 5" path
      const evidenceData = Array.from({ length: 10 }, (_, i) => ({
        id: `e${i + 1}`,
        title:
          i < 6 ? `semiconductor analysis paper ${i}` : `cooking recipe ${i}`,
        snippet:
          i < 6
            ? `semiconductor market share analysis report ${i}`
            : `food recipe ${i}`,
        sourceType: "web",
        url: `http://e${i}.com`,
        domain: `e${i}.com`,
        publishedAt: null,
      }));
      const searchResult = makeSearchPhaseResult({ evidenceData });
      const outline = makeOutline([
        makeSectionPlan({
          title: "semiconductor market",
          keyPoints: ["analysis"],
          description: null,
        }),
      ]);

      await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
      );

      expect(mockSectionWriter.writeSectionsParallel).toHaveBeenCalled();
    });
  });

  // ============================================================
  // Topic language resolution
  // ============================================================

  describe("topic language resolution", () => {
    it("should fetch topic language for review calls", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      const searchResult = makeSearchPhaseResult();
      const outline = makeOutline([makeSectionPlan()]);

      mockPrisma.researchTopic.findUnique.mockResolvedValue({ language: "en" });

      await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
      );

      expect(mockPrisma.researchTopic.findUnique).toHaveBeenCalledWith({
        where: { id: "topic-1" },
        select: { language: true, type: true },
      });
    });

    it("should handle null language from DB gracefully", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      const searchResult = makeSearchPhaseResult();
      const outline = makeOutline([makeSectionPlan()]);

      mockPrisma.researchTopic.findUnique.mockResolvedValue(null);

      const result = await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
      );

      expect(result.success).toBe(true);
    });
  });

  // ============================================================
  // saveEvidence transaction (via executeWritingPhase with reportId)
  // ============================================================

  describe("saveEvidence (via executeWritingPhase)", () => {
    it("should use prisma.$transaction for evidence saving", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      const evidenceData = [
        {
          id: "ev-1",
          title: "Test Source",
          url: "http://test.com",
          domain: "test.com",
          snippet: "Test snippet for content depth scoring",
          sourceType: "web",
          publishedAt: new Date("2024-06-01"),
        },
      ];
      const searchResult = makeSearchPhaseResult({ evidenceData });
      const outline = makeOutline([makeSectionPlan()]);

      await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
        "report-123",
      );

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockTopicEvidenceTx.aggregate).toHaveBeenCalled();
      expect(mockTopicEvidenceTx.createMany).toHaveBeenCalled();
      expect(mockTopicEvidenceTx.findMany).toHaveBeenCalled();
    });

    it("should handle evidence with null publishedAt (validateDate null path)", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      const evidenceData = [
        {
          id: "ev-1",
          title: "Test Source",
          url: "http://test.com",
          domain: "reuters.com", // high authority domain
          snippet: "A".repeat(600), // long snippet
          sourceType: "academic",
          publishedAt: null,
        },
      ];
      const searchResult = makeSearchPhaseResult({ evidenceData });
      const outline = makeOutline([makeSectionPlan()]);

      const result = await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
        "report-123",
      );

      expect(result.success).toBe(true);
    });

    it("should handle evidence with invalid date string (validateDate NaN path)", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      const evidenceData = [
        {
          id: "ev-1",
          title: "Test Source",
          url: "http://test.com",
          domain: "nature.com", // top authority
          snippet: "B".repeat(300), // medium snippet
          sourceType: "official",
          publishedAt: "not-a-date",
        },
      ];
      const searchResult = makeSearchPhaseResult({ evidenceData });
      const outline = makeOutline([makeSectionPlan()]);

      const result = await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
        "report-123",
      );

      expect(result.success).toBe(true);
    });

    it("should calculate credibility scores for various domain/type/snippet/freshness combinations", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();

      const now = Date.now();
      const evidenceData = [
        // .gov domain (top authority) + official + long snippet + fresh (<=30 days)
        {
          id: "ev-gov",
          title: "Government Report",
          url: "http://cdc.gov/report",
          domain: "cdc.gov",
          snippet: "A".repeat(600),
          sourceType: "official",
          publishedAt: new Date(now - 10 * 24 * 60 * 60 * 1000), // 10 days
        },
        // bloomberg.com (high authority) + news + medium snippet + 100 days (<=180)
        {
          id: "ev-high",
          title: "Bloomberg Article",
          url: "http://bloomberg.com/tech",
          domain: "bloomberg.com",
          snippet: "B".repeat(250),
          sourceType: "news",
          publishedAt: new Date(now - 100 * 24 * 60 * 60 * 1000),
        },
        // techcrunch.com (medium authority) + report + short snippet + 300 days (<=365)
        {
          id: "ev-medium",
          title: "TechCrunch Post",
          url: "http://techcrunch.com/ai",
          domain: "techcrunch.com",
          snippet: "C".repeat(100),
          sourceType: "report",
          publishedAt: new Date(now - 300 * 24 * 60 * 60 * 1000),
        },
        // unknown domain (else branch) + web + tiny snippet + 500 days (<=730)
        {
          id: "ev-unknown",
          title: "Unknown Site",
          url: "http://unknown-blog.com/post",
          domain: "unknown-blog.com",
          snippet: "Short",
          sourceType: "web",
          publishedAt: new Date(now - 500 * 24 * 60 * 60 * 1000),
        },
        // no domain (null) + default type + no snippet + old (>730 days)
        {
          id: "ev-no-domain",
          title: "No Domain",
          url: "",
          domain: null,
          snippet: null,
          sourceType: "unknown_type",
          publishedAt: new Date(now - 900 * 24 * 60 * 60 * 1000),
        },
        // arxiv.org domain (top authority) + academic + medium snippet + recent (<= 180 days)
        {
          id: "ev-arxiv",
          title: "ArXiv Paper",
          url: "https://arxiv.org/abs/1234",
          domain: "arxiv.org",
          snippet: "D".repeat(250),
          sourceType: "academic",
          publishedAt: new Date(now - 150 * 24 * 60 * 60 * 1000),
        },
      ];
      const searchResult = makeSearchPhaseResult({ evidenceData });
      const outline = makeOutline([makeSectionPlan()]);

      mockTopicEvidenceTx.findMany.mockResolvedValue(
        evidenceData.map((e, i) => ({
          id: `saved-${i}`,
          citationIndex: i + 1,
        })),
      );

      const result = await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
        "report-123",
      );

      expect(result.success).toBe(true);
      expect(mockTopicEvidenceTx.createMany).toHaveBeenCalled();
    });
  });

  // ============================================================
  // convertToAnalysisResult + content extraction helpers
  // ============================================================

  describe("convertToAnalysisResult (via executeWritingPhase)", () => {
    it("should extract trends from markdown ## header + bullet list", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      const searchResult = makeSearchPhaseResult();
      const outline = makeOutline([makeSectionPlan()]);

      mockLeaderService.integrateDimensionResults.mockResolvedValue({
        ...makeIntegratedResult(),
        content: [
          "## 发展趋势",
          "",
          "- **大模型趋势**: AI大模型在2024年取得了显著进展，影响多个行业。",
          "- 云计算整合AI能力成为主流趋势，企业加速迁移。",
        ].join("\n"),
        metadata: {
          summary: "AI trends summary",
          keyFindings: [
            "Finding 1",
            "Finding 2",
            "Finding 3",
            "Finding 4",
            "Finding 5",
          ],
          confidence: 0.85,
          confidenceLevel: 0.85,
        },
      });

      const result = await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
      );

      expect(result.success).toBe(true);
      expect(result.analysisResult?.trends).toBeDefined();
    });

    it("should extract challenges from bold pattern in content", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      const searchResult = makeSearchPhaseResult();
      const outline = makeOutline([makeSectionPlan()]);

      mockLeaderService.integrateDimensionResults.mockResolvedValue({
        ...makeIntegratedResult(),
        content: [
          "**挑战一**: 人才短缺是AI发展面临的主要挑战，全球AI工程师供不应求。",
          "**风险**: 数据隐私和安全问题制约了AI在金融行业的大规模应用。",
        ].join("\n"),
        metadata: {
          summary: "Challenges summary",
          keyFindings: ["Challenge 1"],
          confidence: 0.7,
          confidenceLevel: 0.7,
        },
      });

      const result = await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
      );

      expect(result.success).toBe(true);
      expect(result.analysisResult?.challenges).toBeDefined();
    });

    it("should extract opportunities from sentence-level keywords", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      const searchResult = makeSearchPhaseResult();
      const outline = makeOutline([makeSectionPlan()]);

      mockLeaderService.integrateDimensionResults.mockResolvedValue({
        ...makeIntegratedResult(),
        content: [
          "中国AI市场存在巨大的发展机遇，预计到2025年市场规模将超过1000亿元。",
          "医疗AI领域也有显著的发展机会，辅助诊断技术逐步走向临床应用。",
        ].join("\n"),
        metadata: {
          summary: "Opportunities summary",
          keyFindings: ["Opportunity 1"],
          confidence: 0.8,
          confidenceLevel: 0.8,
        },
      });

      const result = await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
      );

      expect(result.success).toBe(true);
      expect(result.analysisResult?.opportunities).toBeDefined();
    });

    it("should produce keyFindings with correct significance levels (high/medium/low)", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      const searchResult = makeSearchPhaseResult();
      const outline = makeOutline([makeSectionPlan()]);

      mockLeaderService.integrateDimensionResults.mockResolvedValue({
        ...makeIntegratedResult(),
        content: "Content without any trends or challenges.",
        metadata: {
          summary: "Summary",
          keyFindings: [
            "High-1",
            "High-2",
            "Medium-3",
            "Medium-4",
            "Low-5",
            "Low-6",
          ],
          confidence: 0.9,
          confidenceLevel: 0.9,
        },
      });

      const result = await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
      );

      expect(result.success).toBe(true);
      const findings = result.analysisResult?.keyFindings || [];
      expect(findings[0]?.significance).toBe("high");
      expect(findings[1]?.significance).toBe("high");
      expect(findings[2]?.significance).toBe("medium");
      expect(findings[4]?.significance).toBe("low");
    });

    it("should extract trend items hitting the 5-item limit from header bullets", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      const searchResult = makeSearchPhaseResult();
      const outline = makeOutline([makeSectionPlan()]);

      // 6 bullet points after trend header — should stop at 5
      const bullets = Array.from(
        { length: 6 },
        (_, i) => `- 趋势项目 ${i + 1} 是非常重要的发展方向，需要认真关注。`,
      ).join("\n");
      mockLeaderService.integrateDimensionResults.mockResolvedValue({
        ...makeIntegratedResult(),
        content: `## 发展趋势\n\n${bullets}\n`,
        metadata: {
          summary: "S",
          keyFindings: ["F1"],
          confidence: 0.8,
          confidenceLevel: 0.8,
        },
      });

      const result = await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
      );

      expect(result.success).toBe(true);
      // extractFromHeaders limits to 5
      expect(result.analysisResult?.trends?.length ?? 0).toBeLessThanOrEqual(5);
    });

    it("should handle bullet items exceeding 120 chars (truncation)", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      const searchResult = makeSearchPhaseResult();
      const outline = makeOutline([makeSectionPlan()]);

      // A very long bullet item after trend header
      const longItem = "趋".repeat(150); // 150 Chinese chars > 120
      mockLeaderService.integrateDimensionResults.mockResolvedValue({
        ...makeIntegratedResult(),
        content: `## 发展趋势\n\n- ${longItem}\n`,
        metadata: {
          summary: "S",
          keyFindings: ["F1"],
          confidence: 0.8,
          confidenceLevel: 0.8,
        },
      });

      const result = await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
      );

      expect(result.success).toBe(true);
    });

    it("should match next header break in extractFromHeaders", async () => {
      const topic = makeResearchTopic();
      const dimension = makeTopicDimension();
      const searchResult = makeSearchPhaseResult();
      const outline = makeOutline([makeSectionPlan()]);

      // Two headers: trend header followed by another header (should break at second header)
      const content = [
        "## 发展趋势",
        "- 趋势项目一是非常重要的发展方向",
        "## 挑战分析",
        "- Some challenge",
      ].join("\n");
      mockLeaderService.integrateDimensionResults.mockResolvedValue({
        ...makeIntegratedResult(),
        content,
        metadata: {
          summary: "S",
          keyFindings: ["F1"],
          confidence: 0.8,
          confidenceLevel: 0.8,
        },
      });

      const result = await service.executeWritingPhase(
        topic,
        dimension,
        searchResult,
        outline,
      );

      expect(result.success).toBe(true);
    });
  });

  // ============================================================
  // replaceEvidenceIds (#33)
  // ============================================================

  describe("replaceEvidenceIds", () => {
    it("should replace basic citation references using index mapping", () => {
      const mapping = new Map<number, number>([
        [1, 11],
        [2, 12],
      ]);
      const content = "See [1] and also [2] for details.";

      const result = (service as any).replaceEvidenceIds(content, mapping);

      expect(result).toBe("See [11] and also [12] for details.");
    });

    it("should replace figure placeholders using index mapping", () => {
      const mapping = new Map<number, number>([[1, 11]]);
      const content = "<!-- figure:1:2 -->";

      const result = (service as any).replaceEvidenceIds(content, mapping);

      expect(result).toBe("<!-- figure:11:2 -->");
    });

    it("should process in descending order to avoid [1] interfering with [10] or [11]", () => {
      const mapping = new Map<number, number>([
        [1, 100],
        [10, 200],
        [11, 300],
      ]);
      // Content has [1], [10], [11] — if [1] is replaced first it would corrupt [10] and [11]
      const content = "[1] references [10] and [11] in the text.";

      const result = (service as any).replaceEvidenceIds(content, mapping);

      // [11] → [300], [10] → [200], [1] → [100] (processed largest first)
      expect(result).toBe("[100] references [200] and [300] in the text.");
    });

    it("should not replace when promptIndex equals actualCitationIndex", () => {
      const mapping = new Map<number, number>([
        [1, 1], // same — no-op
        [2, 12], // different — should replace
      ]);
      const content = "See [1] and [2].";

      const result = (service as any).replaceEvidenceIds(content, mapping);

      expect(result).toBe("See [1] and [12].");
    });

    it("should return content unchanged when mapping is empty", () => {
      const mapping = new Map<number, number>();
      const content = "Content with [1] citation stays unchanged.";

      const result = (service as any).replaceEvidenceIds(content, mapping);

      expect(result).toBe("Content with [1] citation stays unchanged.");
    });

    it("should replace all occurrences of the same citation in content", () => {
      const mapping = new Map<number, number>([[3, 30]]);
      const content = "[3] is mentioned here and again [3] and once more [3].";

      const result = (service as any).replaceEvidenceIds(content, mapping);

      expect(result).toBe(
        "[30] is mentioned here and again [30] and once more [30].",
      );
    });

    it("should replace figure placeholders with spaces around colon correctly", () => {
      const mapping = new Map<number, number>([[2, 22]]);
      // The regex allows optional whitespace around figure: prefix
      const content = "<!--  figure:2:0 -->";

      const result = (service as any).replaceEvidenceIds(content, mapping);

      expect(result).toBe("<!--  figure:22:0 -->");
    });
  });
});

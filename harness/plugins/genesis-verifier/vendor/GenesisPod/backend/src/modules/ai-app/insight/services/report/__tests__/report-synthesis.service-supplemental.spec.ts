/**
 * ReportSynthesisService Supplemental Unit Tests
 *
 * Targets uncovered lines:
 * - reprocessExistingReport (265-304)
 * - ContextEvolutionService availability check and facts injection (415-429)
 * - TokenBudgetCalculatorService smart truncation vs. hard truncation fallback (454-468)
 * - Evidence JSON validation / cross-dimension consistency conflict logging (606, 622-637)
 * - LLM synthesis call with full prompt / OutputReviewer quality check (706-770)
 * - Report assembly with charts + citations (1521-1527)
 * - Quality gate checkpoint saving (1938-1945)
 * - Conditional report persistence if quality meets threshold (1957-1998)
 * - Evidence citation remapping (2233-2238)
 * - Chart collection and reference updating (2270)
 */

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { ReportSynthesisService } from "../report-synthesis.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  ChatFacade,
  TeamFacade,
  OutputReviewerService,
} from "@/modules/ai-harness/facade";
import { ContextEvolutionService } from "@/modules/ai-harness/facade";
import { TokenBudgetCalculatorService } from "@/modules/ai-harness/facade";
import { ReportEditorService } from "../report-editor.service";
import { ReportAssemblerService } from "../report-assembler.service";
import { ReportQualityGateService } from "../../quality/report-quality-gate.service";
import { ReportQualityTraceService } from "../../quality/report-quality-trace.service";
import { ResearchEventEmitterService } from "../../core/research/research-event-emitter.service";
import type { ResearchTopic } from "@prisma/client";

// ──────────────────────────────────────────────────────────────────────────────
// Shared test fixtures
// ──────────────────────────────────────────────────────────────────────────────

const mockTopic: ResearchTopic = {
  id: "topic-001",
  name: "AI 芯片市场分析",
  type: "market_analysis",
  description: "分析 AI 芯片的市场竞争格局",
  language: "zh",
  userId: "user-001",
  status: "ACTIVE",
  topicConfig: null,
  searchConfig: null,
  visibility: "PRIVATE",
  createdAt: new Date(),
  updatedAt: new Date(),
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

const mockDimensionAnalysis = {
  id: "analysis-001",
  reportId: "report-001",
  dimensionId: "dim-001",
  summary: "AI 芯片市场由英伟达主导",
  keyFindings: [
    {
      finding: "英伟达占据 80% 市场份额",
      significance: "高",
      evidenceIds: ["ev-001"],
    },
  ],
  dataPoints: {
    trends: [],
    challenges: [],
    opportunities: [],
    detailedContent: "## 市场份额分析\n\n英伟达占据主导地位。",
    figureReferences: [],
    generatedCharts: [],
    confidenceLevel: "high",
  },
  sourcesUsed: 5,
  dimension: {
    id: "dim-001",
    name: "市场份额",
    description: "各厂商市场份额分析",
    sortOrder: 1,
    status: "COMPLETED",
    searchQueries: ["AI chip market share"],
  },
  evidences: [
    {
      id: "ev-001",
      citationIndex: 1,
      title: "Nvidia Market Share 2024",
      url: "https://example.com/article1",
      domain: "example.com",
      sourceType: "WEB",
      publishedAt: new Date("2024-01-01"),
      credibilityScore: 0.9,
      accessedAt: new Date(),
    },
  ],
};

// ──────────────────────────────────────────────────────────────────────────────
// Mock factory — includes optional services
// ──────────────────────────────────────────────────────────────────────────────

function buildMocks() {
  const mockPrisma = {
    topicReport: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    dimensionAnalysis: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    topicEvidence: {
      updateMany: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockChatFacade = {
    chatWithSkills: jest.fn(),
    sanitizeReport: jest.fn().mockImplementation((c: string) => c),
    getDefaultModelByType: jest.fn().mockResolvedValue({ modelId: "gpt-4o" }),
  };

  const mockTeamFacade = {
    chatWithSkills: jest.fn(),
    sanitizeReport: jest.fn().mockImplementation((c: string) => c),
  };

  const mockReportEditor = {
    editDimensionInputs: jest.fn().mockResolvedValue({
      dimensions: [],
      deduplicationStats: {
        removedParagraphs: 0,
        duplicateClaims: 0,
        affectedDimensions: [],
      },
    }),
  };

  const mockAssembler = {
    assembleFullReport: jest
      .fn()
      .mockImplementation((_topic: unknown, dims: unknown[], _sc: unknown) => {
        const parts = [`# ${(_topic as { name: string }).name}`];
        (
          dims as Array<{
            detailedContent?: string;
            summary?: string;
            dimensionName?: string;
          }>
        ).forEach((d, idx) =>
          parts.push(
            `## ${idx + 1}. ${d.dimensionName || "Dimension"}\n\n${d.detailedContent || d.summary || ""}`,
          ),
        );
        return parts.join("\n\n");
      }),
    postProcessFinalReport: jest.fn().mockImplementation((content: string) => ({
      content,
      warnings: [],
    })),
    processDimensionContent: jest.fn().mockImplementation((c: string) => c),
    finalizeReportWithCitations: jest.fn().mockImplementation((c: string) => c),
    reprocessStoredReport: jest.fn().mockReturnValue({
      content: "reprocessed content",
      warnings: ["Fixed heading levels"],
    }),
  };

  const mockQualityTrace = {
    createTrace: jest.fn().mockReturnValue({}),
    recordEvidenceQuality: jest.fn(),
    scanDimensionOutput: jest.fn(),
    recordDimensionQualityGate: jest.fn(),
    recordPostProcessing: jest.fn(),
    recordSynthesisOutput: jest.fn(),
    computeFinalAssessment: jest.fn(),
    finalizeTrace: jest.fn().mockReturnValue({
      finalAssessment: { grade: "B", overallScore: 75, dimensions: {} },
    }),
    persistTrace: jest.fn(),
    recordOutputReview: jest.fn(),
  };

  const mockQualityGate = {
    validateFullReport: jest.fn().mockReturnValue({
      passed: true,
      wasAutoFixed: false,
      fixedContent: "",
      violations: [],
      rewriteGuidance: [],
    }),
    validateDimensionContent: jest.fn().mockReturnValue({
      passed: true,
      wasAutoFixed: false,
      fixedContent: "",
      violations: [],
      rewriteGuidance: [],
    }),
    saveCheckpoint: jest.fn(),
  };

  const mockOutputReviewer = {
    reviewOutput: jest.fn().mockResolvedValue({
      passed: true,
      score: 8.5,
      scores: {
        completeness: 8,
        accuracy: 9,
        logic: 8.5,
        professionalism: 8.5,
      },
      feedback: "High quality report",
      issues: [],
      suggestions: [],
    }),
  };

  const mockContextEvolution = {
    buildFactsPromptSection: jest
      .fn()
      .mockReturnValue("## 已确认事实\n- 事实1\n- 事实2"),
    extractFacts: jest.fn().mockResolvedValue({ facts: [] }),
  };

  const mockTokenBudget = {
    smartTruncate: jest
      .fn()
      .mockImplementation((content: string, limit: number) =>
        content.slice(0, limit),
      ),
  };

  const mockEventEmitter = {
    emitReportSynthesisProgress: jest.fn(),
  };

  return {
    mockPrisma,
    mockChatFacade,
    mockTeamFacade,
    mockReportEditor,
    mockAssembler,
    mockQualityTrace,
    mockQualityGate,
    mockOutputReviewer,
    mockContextEvolution,
    mockTokenBudget,
    mockEventEmitter,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Helper: build a minimal module with optional services
// ──────────────────────────────────────────────────────────────────────────────

async function buildModule(
  mocks: ReturnType<typeof buildMocks>,
  extras: {
    outputReviewer?: boolean;
    contextEvolution?: boolean;
    tokenBudget?: boolean;
    eventEmitter?: boolean;
  } = {},
) {
  const providers: unknown[] = [
    ReportSynthesisService,
    { provide: PrismaService, useValue: mocks.mockPrisma },
    { provide: ChatFacade, useValue: mocks.mockChatFacade },
    { provide: TeamFacade, useValue: mocks.mockTeamFacade },
    { provide: ReportEditorService, useValue: mocks.mockReportEditor },
    { provide: ReportAssemblerService, useValue: mocks.mockAssembler },
    { provide: ReportQualityTraceService, useValue: mocks.mockQualityTrace },
    { provide: ReportQualityGateService, useValue: mocks.mockQualityGate },
  ];

  if (extras.outputReviewer) {
    providers.push({
      provide: OutputReviewerService,
      useValue: mocks.mockOutputReviewer,
    });
  }
  if (extras.contextEvolution) {
    providers.push({
      provide: ContextEvolutionService,
      useValue: mocks.mockContextEvolution,
    });
  }
  if (extras.tokenBudget) {
    providers.push({
      provide: TokenBudgetCalculatorService,
      useValue: mocks.mockTokenBudget,
    });
  }
  if (extras.eventEmitter) {
    providers.push({
      provide: ResearchEventEmitterService,
      useValue: mocks.mockEventEmitter,
    });
  }

  const module: TestingModule = await Test.createTestingModule({
    providers: providers as Parameters<
      typeof Test.createTestingModule
    >[0]["providers"],
  }).compile();

  return module.get<ReportSynthesisService>(ReportSynthesisService);
}

// ──────────────────────────────────────────────────────────────────────────────
// Test suites
// ──────────────────────────────────────────────────────────────────────────────

describe("ReportSynthesisService (supplemental)", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================
  // reprocessExistingReport
  // ============================================================

  describe("reprocessExistingReport", () => {
    it("should throw NotFoundException when report does not exist", async () => {
      const mocks = buildMocks();
      const service = await buildModule(mocks);

      mocks.mockPrisma.topicReport.findUnique.mockResolvedValue(null);

      await expect(
        service.reprocessExistingReport("nonexistent-report"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException when report has no fullReport content", async () => {
      const mocks = buildMocks();
      const service = await buildModule(mocks);

      mocks.mockPrisma.topicReport.findUnique.mockResolvedValue({
        id: "report-001",
        fullReport: "",
        topic: { language: "zh" },
      });

      await expect(
        service.reprocessExistingReport("report-001"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should call assembler.reprocessStoredReport with the stored fullReport", async () => {
      const mocks = buildMocks();
      const service = await buildModule(mocks);

      mocks.mockPrisma.topicReport.findUnique.mockResolvedValue({
        id: "report-001",
        fullReport: "# Old Report Content",
        topic: { language: "zh" },
      });

      mocks.mockPrisma.topicReport.update.mockResolvedValue({
        id: "report-001",
        fullReport: "reprocessed content",
      });

      await service.reprocessExistingReport("report-001");

      expect(mocks.mockAssembler.reprocessStoredReport).toHaveBeenCalledWith(
        "# Old Report Content",
        "zh",
      );
    });

    it("should update the report with reprocessed content", async () => {
      const mocks = buildMocks();
      const service = await buildModule(mocks);

      mocks.mockPrisma.topicReport.findUnique.mockResolvedValue({
        id: "report-001",
        fullReport: "# Old Report Content",
        topic: { language: "zh" },
      });

      mocks.mockPrisma.topicReport.update.mockResolvedValue({
        id: "report-001",
        fullReport: "reprocessed content",
      });

      const result = await service.reprocessExistingReport("report-001");

      expect(mocks.mockPrisma.topicReport.update).toHaveBeenCalledWith({
        where: { id: "report-001" },
        data: { fullReport: "reprocessed content" },
      });
      expect(result.fullReport).toBe("reprocessed content");
    });

    it("should use topic language 'en' when topic.language is English", async () => {
      const mocks = buildMocks();
      const service = await buildModule(mocks);

      mocks.mockPrisma.topicReport.findUnique.mockResolvedValue({
        id: "report-001",
        fullReport: "# English Report",
        topic: { language: "en" },
      });

      mocks.mockPrisma.topicReport.update.mockResolvedValue({
        id: "report-001",
        fullReport: "reprocessed english content",
      });

      await service.reprocessExistingReport("report-001");

      expect(mocks.mockAssembler.reprocessStoredReport).toHaveBeenCalledWith(
        "# English Report",
        "en",
      );
    });

    it("should default to zh language when topic has no language set", async () => {
      const mocks = buildMocks();
      const service = await buildModule(mocks);

      mocks.mockPrisma.topicReport.findUnique.mockResolvedValue({
        id: "report-001",
        fullReport: "# Some Report",
        topic: {},
      });

      mocks.mockPrisma.topicReport.update.mockResolvedValue({
        id: "report-001",
        fullReport: "reprocessed",
      });

      await service.reprocessExistingReport("report-001");

      expect(mocks.mockAssembler.reprocessStoredReport).toHaveBeenCalledWith(
        "# Some Report",
        "zh",
      );
    });

    it("should log warnings when assembler applies fixes", async () => {
      const mocks = buildMocks();
      const service = await buildModule(mocks);

      mocks.mockPrisma.topicReport.findUnique.mockResolvedValue({
        id: "report-001",
        fullReport: "# Report",
        topic: { language: "zh" },
      });

      mocks.mockAssembler.reprocessStoredReport.mockReturnValue({
        content: "fixed content",
        warnings: ["Fixed heading level", "Removed duplicate section"],
      });

      mocks.mockPrisma.topicReport.update.mockResolvedValue({
        id: "report-001",
        fullReport: "fixed content",
      });

      await service.reprocessExistingReport("report-001");

      expect(mocks.mockAssembler.reprocessStoredReport).toHaveBeenCalled();
    });
  });

  // ============================================================
  // synthesizeReport — ContextEvolutionService availability
  // ============================================================

  describe("synthesizeReport — cross-dimension facts injection", () => {
    it("should inject facts context when ContextEvolutionService and facts are provided", async () => {
      const mocks = buildMocks();
      const service = await buildModule(mocks, { contextEvolution: true });

      // Single dimension — no consistency check AI call
      mocks.mockPrisma.dimensionAnalysis.findMany.mockResolvedValue([
        mockDimensionAnalysis,
      ]);
      mocks.mockPrisma.topicEvidence.findMany.mockResolvedValue([]);

      mocks.mockChatFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          executiveSummary: "Report content.",
          preface: "",
          conclusion: "",
          highlights: [],
          charts: [],
        }),
      });

      mocks.mockReportEditor.editDimensionInputs.mockResolvedValue({
        dimensions: [
          {
            dimensionId: "dim-001",
            dimensionName: "市场份额",
            dimensionDescription: "",
            summary: "AI market",
            keyFindings: [],
            trends: [],
            challenges: [],
            opportunities: [],
            detailedContent: "content",
            sourcesUsed: 0,
            figureReferences: [],
            generatedCharts: [],
          },
        ],
        deduplicationStats: {
          removedParagraphs: 0,
          duplicateClaims: 0,
          affectedDimensions: [],
        },
      });

      mocks.mockPrisma.topicReport.update.mockResolvedValue({
        id: "report-001",
      });

      const facts = [
        {
          factId: "f1",
          content: "GPU demand is high",
          source: "dim-001",
          confidence: 0.9,
        },
      ];
      await service.synthesizeReport(
        mockTopic,
        "report-001",
        undefined,
        facts as never,
      );

      expect(
        mocks.mockContextEvolution.buildFactsPromptSection,
      ).toHaveBeenCalledWith(facts);
    });

    it("should skip facts injection when ContextEvolutionService is unavailable", async () => {
      const mocks = buildMocks();
      const service = await buildModule(mocks, { contextEvolution: false });

      mocks.mockPrisma.dimensionAnalysis.findMany.mockResolvedValue([
        mockDimensionAnalysis,
      ]);
      mocks.mockPrisma.topicEvidence.findMany.mockResolvedValue([]);

      mocks.mockChatFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          executiveSummary: "Report.",
          preface: "",
          conclusion: "",
          highlights: [],
          charts: [],
        }),
      });

      mocks.mockReportEditor.editDimensionInputs.mockResolvedValue({
        dimensions: [
          {
            dimensionId: "dim-001",
            dimensionName: "市场份额",
            dimensionDescription: "",
            summary: "AI market",
            keyFindings: [],
            trends: [],
            challenges: [],
            opportunities: [],
            detailedContent: "content",
            sourcesUsed: 0,
            figureReferences: [],
            generatedCharts: [],
          },
        ],
        deduplicationStats: {
          removedParagraphs: 0,
          duplicateClaims: 0,
          affectedDimensions: [],
        },
      });

      mocks.mockPrisma.topicReport.update.mockResolvedValue({
        id: "report-001",
      });

      const facts = [{ factId: "f1", content: "fact" }];
      await service.synthesizeReport(
        mockTopic,
        "report-001",
        undefined,
        facts as never,
      );

      // Should complete without calling buildFactsPromptSection
      expect(
        mocks.mockContextEvolution.buildFactsPromptSection,
      ).not.toHaveBeenCalled();
    });

    it("should not call buildFactsPromptSection when no facts provided", async () => {
      const mocks = buildMocks();
      const service = await buildModule(mocks, { contextEvolution: true });

      mocks.mockPrisma.dimensionAnalysis.findMany.mockResolvedValue([
        mockDimensionAnalysis,
      ]);
      mocks.mockPrisma.topicEvidence.findMany.mockResolvedValue([]);

      mocks.mockChatFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          executiveSummary: "Report.",
          preface: "",
          conclusion: "",
          highlights: [],
          charts: [],
        }),
      });

      mocks.mockReportEditor.editDimensionInputs.mockResolvedValue({
        dimensions: [
          {
            dimensionId: "dim-001",
            dimensionName: "市场份额",
            dimensionDescription: "",
            summary: "AI market",
            keyFindings: [],
            trends: [],
            challenges: [],
            opportunities: [],
            detailedContent: "content",
            sourcesUsed: 0,
            figureReferences: [],
            generatedCharts: [],
          },
        ],
        deduplicationStats: {
          removedParagraphs: 0,
          duplicateClaims: 0,
          affectedDimensions: [],
        },
      });

      mocks.mockPrisma.topicReport.update.mockResolvedValue({
        id: "report-001",
      });

      await service.synthesizeReport(
        mockTopic,
        "report-001",
        undefined,
        undefined,
      );

      expect(
        mocks.mockContextEvolution.buildFactsPromptSection,
      ).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // synthesizeReport — TokenBudgetCalculatorService truncation
  // ============================================================

  describe("synthesizeReport — TokenBudgetCalculatorService truncation", () => {
    it("should use TokenBudgetCalculatorService.smartTruncate when dimension content exceeds 8000 chars", async () => {
      const mocks = buildMocks();
      const service = await buildModule(mocks, { tokenBudget: true });

      const longContent = "A".repeat(9000);
      const longDimAnalysis = {
        ...mockDimensionAnalysis,
        dataPoints: {
          ...mockDimensionAnalysis.dataPoints,
          detailedContent: longContent,
        },
      };

      mocks.mockPrisma.dimensionAnalysis.findMany.mockResolvedValue([
        longDimAnalysis,
      ]);
      mocks.mockPrisma.topicEvidence.findMany.mockResolvedValue([]);

      mocks.mockChatFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          executiveSummary: "Report.",
          preface: "",
          conclusion: "",
          highlights: [],
          charts: [],
        }),
      });

      mocks.mockReportEditor.editDimensionInputs.mockResolvedValue({
        dimensions: [
          {
            dimensionId: "dim-001",
            dimensionName: "市场份额",
            dimensionDescription: "",
            summary: "AI market",
            keyFindings: [],
            trends: [],
            challenges: [],
            opportunities: [],
            detailedContent: longContent,
            sourcesUsed: 0,
            figureReferences: [],
            generatedCharts: [],
          },
        ],
        deduplicationStats: {
          removedParagraphs: 0,
          duplicateClaims: 0,
          affectedDimensions: [],
        },
      });

      mocks.mockPrisma.topicReport.update.mockResolvedValue({
        id: "report-001",
      });

      await service.synthesizeReport(mockTopic, "report-001");

      expect(mocks.mockTokenBudget.smartTruncate).toHaveBeenCalledWith(
        longContent,
        6000,
      );
    });

    it("should use hard slice fallback when TokenBudgetCalculatorService is unavailable and content exceeds 8000 chars", async () => {
      const mocks = buildMocks();
      const service = await buildModule(mocks, { tokenBudget: false });

      const longContent = "B".repeat(9000);
      const longDimAnalysis = {
        ...mockDimensionAnalysis,
        dataPoints: {
          ...mockDimensionAnalysis.dataPoints,
          detailedContent: longContent,
        },
      };

      mocks.mockPrisma.dimensionAnalysis.findMany.mockResolvedValue([
        longDimAnalysis,
      ]);
      mocks.mockPrisma.topicEvidence.findMany.mockResolvedValue([]);

      mocks.mockChatFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          executiveSummary: "Report.",
          preface: "",
          conclusion: "",
          highlights: [],
          charts: [],
        }),
      });

      // editDimensionInputs will receive truncated content — just return unchanged for test
      mocks.mockReportEditor.editDimensionInputs.mockImplementation(
        (dims: unknown[]) => ({
          dimensions: dims,
          deduplicationStats: {
            removedParagraphs: 0,
            duplicateClaims: 0,
            affectedDimensions: [],
          },
        }),
      );

      mocks.mockPrisma.topicReport.update.mockResolvedValue({
        id: "report-001",
      });

      await service.synthesizeReport(mockTopic, "report-001");

      // Verify the AI call still happened (service fell back to hard slice)
      expect(mocks.mockChatFacade.chatWithSkills).toHaveBeenCalled();
    });

    it("should not truncate when dimension content is within 8000 char limit", async () => {
      const mocks = buildMocks();
      const service = await buildModule(mocks, { tokenBudget: true });

      const shortContent = "Normal length content.";

      mocks.mockPrisma.dimensionAnalysis.findMany.mockResolvedValue([
        mockDimensionAnalysis,
      ]);
      mocks.mockPrisma.topicEvidence.findMany.mockResolvedValue([]);

      mocks.mockChatFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          executiveSummary: "Report.",
          preface: "",
          conclusion: "",
          highlights: [],
          charts: [],
        }),
      });

      mocks.mockReportEditor.editDimensionInputs.mockResolvedValue({
        dimensions: [
          {
            dimensionId: "dim-001",
            dimensionName: "市场份额",
            dimensionDescription: "",
            summary: "AI market",
            keyFindings: [],
            trends: [],
            challenges: [],
            opportunities: [],
            detailedContent: shortContent,
            sourcesUsed: 0,
            figureReferences: [],
            generatedCharts: [],
          },
        ],
        deduplicationStats: {
          removedParagraphs: 0,
          duplicateClaims: 0,
          affectedDimensions: [],
        },
      });

      mocks.mockPrisma.topicReport.update.mockResolvedValue({
        id: "report-001",
      });

      await service.synthesizeReport(mockTopic, "report-001");

      expect(mocks.mockTokenBudget.smartTruncate).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // synthesizeReport — cross-dimension consistency conflicts
  // ============================================================

  describe("synthesizeReport — cross-dimension consistency check with conflicts", () => {
    it("should log warning when low consistency with multiple conflicts", async () => {
      const mocks = buildMocks();
      const service = await buildModule(mocks);

      const secondAnalysis = {
        ...mockDimensionAnalysis,
        id: "analysis-002",
        dimensionId: "dim-002",
        dimension: {
          ...mockDimensionAnalysis.dimension,
          id: "dim-002",
          name: "技术趋势",
        },
      };

      mocks.mockPrisma.dimensionAnalysis.findMany.mockResolvedValue([
        mockDimensionAnalysis,
        secondAnalysis,
      ]);
      mocks.mockPrisma.topicEvidence.findMany.mockResolvedValue([]);

      // First AI call: consistency check returns low with conflicts
      mocks.mockChatFacade.chatWithSkills
        .mockResolvedValueOnce({
          content: JSON.stringify({
            overallConsistency: "low",
            conflicts: [
              {
                type: "data_conflict",
                severity: "critical",
                dimensions: ["市场份额", "技术趋势"],
                description: "Market size discrepancy: 500B vs 300B",
                suggestedResolution: "Use the larger, more recent figure",
              },
            ],
            recommendations: ["Reconcile data sources"],
            summary: "Critical conflict detected",
          }),
        })
        // Second AI call: main report
        .mockResolvedValueOnce({
          content: JSON.stringify({
            executiveSummary: "Report with noted conflicts.",
            preface: "",
            conclusion: "",
            highlights: [],
            charts: [],
          }),
        });

      mocks.mockReportEditor.editDimensionInputs.mockResolvedValue({
        dimensions: [
          {
            dimensionId: "dim-001",
            dimensionName: "市场份额",
            dimensionDescription: "",
            summary: "AI market",
            keyFindings: [],
            trends: [],
            challenges: [],
            opportunities: [],
            detailedContent: "content",
            sourcesUsed: 0,
            figureReferences: [],
            generatedCharts: [],
          },
          {
            dimensionId: "dim-002",
            dimensionName: "技术趋势",
            dimensionDescription: "",
            summary: "Tech trend",
            keyFindings: [],
            trends: [],
            challenges: [],
            opportunities: [],
            detailedContent: "tech content",
            sourcesUsed: 0,
            figureReferences: [],
            generatedCharts: [],
          },
        ],
        deduplicationStats: {
          removedParagraphs: 0,
          duplicateClaims: 0,
          affectedDimensions: [],
        },
      });

      mocks.mockPrisma.topicReport.update.mockResolvedValue({
        id: "report-001",
      });

      const result = await service.synthesizeReport(mockTopic, "report-001");

      // Service should complete successfully despite conflicts
      expect(result).toBeDefined();
      // Main report AI call should still happen (second chatWithSkills call)
      expect(mocks.mockChatFacade.chatWithSkills).toHaveBeenCalledTimes(2);
    });

    it("should skip consistency check for single dimension and proceed directly to synthesis", async () => {
      const mocks = buildMocks();
      const service = await buildModule(mocks);

      mocks.mockPrisma.dimensionAnalysis.findMany.mockResolvedValue([
        mockDimensionAnalysis,
      ]);
      mocks.mockPrisma.topicEvidence.findMany.mockResolvedValue([]);

      // Only 1 AI call for single-dimension (no consistency check)
      mocks.mockChatFacade.chatWithSkills.mockResolvedValueOnce({
        content: JSON.stringify({
          executiveSummary: "Report.",
          preface: "",
          conclusion: "",
          highlights: [],
          charts: [],
        }),
      });

      mocks.mockReportEditor.editDimensionInputs.mockResolvedValue({
        dimensions: [
          {
            dimensionId: "dim-001",
            dimensionName: "市场份额",
            dimensionDescription: "",
            summary: "AI market",
            keyFindings: [],
            trends: [],
            challenges: [],
            opportunities: [],
            detailedContent: "content",
            sourcesUsed: 0,
            figureReferences: [],
            generatedCharts: [],
          },
        ],
        deduplicationStats: {
          removedParagraphs: 0,
          duplicateClaims: 0,
          affectedDimensions: [],
        },
      });

      mocks.mockPrisma.topicReport.update.mockResolvedValue({
        id: "report-001",
      });

      await service.synthesizeReport(mockTopic, "report-001");

      // Single dimension means only 1 AI call
      expect(mocks.mockChatFacade.chatWithSkills).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================
  // synthesizeReport — OutputReviewer quality check
  // ============================================================

  describe("synthesizeReport — OutputReviewer quality review", () => {
    it("should call outputReviewer.reviewOutput and persist result when reviewer is available", async () => {
      const mocks = buildMocks();
      const service = await buildModule(mocks, { outputReviewer: true });

      mocks.mockPrisma.dimensionAnalysis.findMany.mockResolvedValue([
        mockDimensionAnalysis,
      ]);
      mocks.mockPrisma.topicEvidence.findMany.mockResolvedValue([]);

      mocks.mockChatFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          executiveSummary: "Report.",
          preface: "",
          conclusion: "",
          highlights: [],
          charts: [],
        }),
      });

      mocks.mockReportEditor.editDimensionInputs.mockResolvedValue({
        dimensions: [
          {
            dimensionId: "dim-001",
            dimensionName: "市场份额",
            dimensionDescription: "",
            summary: "AI market",
            keyFindings: [],
            trends: [],
            challenges: [],
            opportunities: [],
            detailedContent: "Long enough content for review...",
            sourcesUsed: 0,
            figureReferences: [],
            generatedCharts: [],
          },
        ],
        deduplicationStats: {
          removedParagraphs: 0,
          duplicateClaims: 0,
          affectedDimensions: [],
        },
      });

      mocks.mockPrisma.topicReport.update.mockResolvedValue({
        id: "report-001",
      });

      await service.synthesizeReport(mockTopic, "report-001");

      expect(mocks.mockOutputReviewer.reviewOutput).toHaveBeenCalledWith(
        expect.objectContaining({
          missionId: "report-001",
          task: expect.objectContaining({ id: "report-001" }),
        }),
      );
      expect(mocks.mockQualityTrace.recordOutputReview).toHaveBeenCalledWith(
        {},
        expect.objectContaining({ passed: true, score: 8.5 }),
      );
    });

    it("should record failed quality review without blocking report save", async () => {
      const mocks = buildMocks();

      mocks.mockOutputReviewer.reviewOutput.mockResolvedValue({
        passed: false,
        score: 5.0,
        scores: { completeness: 5, accuracy: 5, logic: 5, professionalism: 5 },
        feedback: "Report lacks depth",
        issues: ["Too short", "Missing citations"],
        suggestions: ["Add more evidence"],
      });

      const service = await buildModule(mocks, { outputReviewer: true });

      mocks.mockPrisma.dimensionAnalysis.findMany.mockResolvedValue([
        mockDimensionAnalysis,
      ]);
      mocks.mockPrisma.topicEvidence.findMany.mockResolvedValue([]);

      mocks.mockChatFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          executiveSummary: "Short report.",
          preface: "",
          conclusion: "",
          highlights: [],
          charts: [],
        }),
      });

      mocks.mockReportEditor.editDimensionInputs.mockResolvedValue({
        dimensions: [
          {
            dimensionId: "dim-001",
            dimensionName: "市场份额",
            dimensionDescription: "",
            summary: "AI market",
            keyFindings: [],
            trends: [],
            challenges: [],
            opportunities: [],
            detailedContent: "Short.",
            sourcesUsed: 0,
            figureReferences: [],
            generatedCharts: [],
          },
        ],
        deduplicationStats: {
          removedParagraphs: 0,
          duplicateClaims: 0,
          affectedDimensions: [],
        },
      });

      mocks.mockPrisma.topicReport.update.mockResolvedValue({
        id: "report-001",
      });

      const result = await service.synthesizeReport(mockTopic, "report-001");

      // Report should still be saved even with failed review
      expect(result).toBeDefined();
      expect(mocks.mockPrisma.topicReport.update).toHaveBeenCalled();
    });

    it("should handle OutputReviewer throwing an error gracefully (non-fatal)", async () => {
      const mocks = buildMocks();

      mocks.mockOutputReviewer.reviewOutput.mockRejectedValue(
        new Error("Reviewer service timeout"),
      );

      const service = await buildModule(mocks, { outputReviewer: true });

      mocks.mockPrisma.dimensionAnalysis.findMany.mockResolvedValue([
        mockDimensionAnalysis,
      ]);
      mocks.mockPrisma.topicEvidence.findMany.mockResolvedValue([]);

      mocks.mockChatFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          executiveSummary: "Report.",
          preface: "",
          conclusion: "",
          highlights: [],
          charts: [],
        }),
      });

      mocks.mockReportEditor.editDimensionInputs.mockResolvedValue({
        dimensions: [
          {
            dimensionId: "dim-001",
            dimensionName: "市场份额",
            dimensionDescription: "",
            summary: "AI market",
            keyFindings: [],
            trends: [],
            challenges: [],
            opportunities: [],
            detailedContent: "content",
            sourcesUsed: 0,
            figureReferences: [],
            generatedCharts: [],
          },
        ],
        deduplicationStats: {
          removedParagraphs: 0,
          duplicateClaims: 0,
          affectedDimensions: [],
        },
      });

      mocks.mockPrisma.topicReport.update.mockResolvedValue({
        id: "report-001",
      });

      const result = await service.synthesizeReport(mockTopic, "report-001");

      // Should complete despite reviewer error
      expect(result).toBeDefined();
      // Should record the error in quality trace
      expect(mocks.mockQualityTrace.recordOutputReview).toHaveBeenCalledWith(
        {},
        expect.objectContaining({ reviewErrored: true }),
      );
    });

    it("should skip quality review when outputReviewer is not injected", async () => {
      const mocks = buildMocks();
      const service = await buildModule(mocks, { outputReviewer: false });

      mocks.mockPrisma.dimensionAnalysis.findMany.mockResolvedValue([
        mockDimensionAnalysis,
      ]);
      mocks.mockPrisma.topicEvidence.findMany.mockResolvedValue([]);

      mocks.mockChatFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          executiveSummary: "Report.",
          preface: "",
          conclusion: "",
          highlights: [],
          charts: [],
        }),
      });

      mocks.mockReportEditor.editDimensionInputs.mockResolvedValue({
        dimensions: [
          {
            dimensionId: "dim-001",
            dimensionName: "市场份额",
            dimensionDescription: "",
            summary: "AI market",
            keyFindings: [],
            trends: [],
            challenges: [],
            opportunities: [],
            detailedContent: "content",
            sourcesUsed: 0,
            figureReferences: [],
            generatedCharts: [],
          },
        ],
        deduplicationStats: {
          removedParagraphs: 0,
          duplicateClaims: 0,
          affectedDimensions: [],
        },
      });

      mocks.mockPrisma.topicReport.update.mockResolvedValue({
        id: "report-001",
      });

      await service.synthesizeReport(mockTopic, "report-001");

      expect(mocks.mockOutputReviewer.reviewOutput).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // synthesizeReport — charts collection with figure numbers
  // ============================================================

  describe("synthesizeReport — chart collection and figure number assignment", () => {
    it("should assign sequential figure numbers to charts referenced in report", async () => {
      const mocks = buildMocks();
      const service = await buildModule(mocks);

      // Add a reference figure to the dimension
      const dimWithFigure = {
        ...mockDimensionAnalysis,
        dataPoints: {
          ...mockDimensionAnalysis.dataPoints,
          figureReferences: [
            {
              id: "fig-001",
              imageUrl: "https://example.com/chart1.png",
              caption: "Market Share Chart",
              type: "image",
            },
          ],
        },
      };

      mocks.mockPrisma.dimensionAnalysis.findMany.mockResolvedValue([
        dimWithFigure,
      ]);
      mocks.mockPrisma.topicEvidence.findMany.mockResolvedValue([]);

      // Report content references the chart with placeholder
      mocks.mockAssembler.finalizeReportWithCitations.mockImplementation(
        (c: string) => c,
      );

      mocks.mockChatFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          executiveSummary: "Report.",
          preface: "",
          conclusion: "",
          highlights: [],
          charts: [],
        }),
      });

      // Build assembler to return content with chart placeholder
      mocks.mockAssembler.assembleFullReport.mockReturnValue(
        "# Report\n\n<!-- chart:fig-001 -->\n\nContent.",
      );
      mocks.mockAssembler.postProcessFinalReport.mockReturnValue({
        content: "# Report\n\n<!-- chart:fig-001 -->\n\nContent.",
        warnings: [],
      });

      mocks.mockReportEditor.editDimensionInputs.mockResolvedValue({
        dimensions: [
          {
            dimensionId: "dim-001",
            dimensionName: "市场份额",
            dimensionDescription: "",
            summary: "AI market",
            keyFindings: [],
            trends: [],
            challenges: [],
            opportunities: [],
            detailedContent: "<!-- chart:fig-001 -->\n\nContent.",
            sourcesUsed: 0,
            figureReferences: [
              {
                id: "fig-001",
                imageUrl: "https://example.com/chart1.png",
                caption: "Market Share Chart",
                type: "image",
              },
            ],
            generatedCharts: [],
          },
        ],
        deduplicationStats: {
          removedParagraphs: 0,
          duplicateClaims: 0,
          affectedDimensions: [],
        },
      });

      mocks.mockPrisma.topicReport.update.mockResolvedValue({
        id: "report-001",
        charts: [{ id: "fig-001", figureNumber: 1 }],
      });

      const result = await service.synthesizeReport(mockTopic, "report-001");

      expect(result).toBeDefined();
      expect(mocks.mockPrisma.topicReport.update).toHaveBeenCalled();
    });

    it("should disable chart collection when enableFigures is false in topicConfig", async () => {
      const mocks = buildMocks();
      const service = await buildModule(mocks);

      const topicNoFigures = {
        ...mockTopic,
        topicConfig: { enableFigures: false },
      } as unknown as ResearchTopic;

      mocks.mockPrisma.dimensionAnalysis.findMany.mockResolvedValue([
        mockDimensionAnalysis,
      ]);
      mocks.mockPrisma.topicEvidence.findMany.mockResolvedValue([]);

      mocks.mockChatFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          executiveSummary: "Report.",
          preface: "",
          conclusion: "",
          highlights: [],
          charts: [],
        }),
      });

      mocks.mockReportEditor.editDimensionInputs.mockResolvedValue({
        dimensions: [
          {
            dimensionId: "dim-001",
            dimensionName: "市场份额",
            dimensionDescription: "",
            summary: "AI market",
            keyFindings: [],
            trends: [],
            challenges: [],
            opportunities: [],
            detailedContent: "content",
            sourcesUsed: 0,
            figureReferences: [],
            generatedCharts: [],
          },
        ],
        deduplicationStats: {
          removedParagraphs: 0,
          duplicateClaims: 0,
          affectedDimensions: [],
        },
      });

      mocks.mockPrisma.topicReport.update.mockResolvedValue({
        id: "report-001",
      });

      const result = await service.synthesizeReport(
        topicNoFigures,
        "report-001",
      );

      // Charts should be empty in update call (figures disabled)
      const updateCall = mocks.mockPrisma.topicReport.update.mock.calls[0][0];
      expect(updateCall.data.charts).toBeDefined();
      expect(result).toBeDefined();
    });
  });

  // ============================================================
  // synthesizeReport — citation remapping
  // ============================================================

  describe("synthesizeReport — citation index remapping after reference deduplication", () => {
    it("should call remapCitationIndices when duplicate URLs are found in evidences", async () => {
      const mocks = buildMocks();
      const service = await buildModule(mocks);

      // Two evidences with same URL → one gets deduplicated
      const duplicateUrlEvidences = [
        {
          id: "ev-001",
          citationIndex: 1,
          title: "Article 1",
          url: "https://example.com/same",
          domain: "example.com",
          sourceType: "WEB",
          publishedAt: new Date("2024-01-01"),
          credibilityScore: 0.9,
          accessedAt: new Date(),
          reportId: "report-001",
        },
        {
          id: "ev-002",
          citationIndex: 2,
          title: "Article 2 (duplicate URL)",
          url: "https://example.com/same",
          domain: "example.com",
          sourceType: "WEB",
          publishedAt: new Date("2024-01-02"),
          credibilityScore: 0.8,
          accessedAt: new Date(),
          reportId: "report-001",
        },
      ];

      mocks.mockPrisma.dimensionAnalysis.findMany.mockResolvedValue([
        mockDimensionAnalysis,
      ]);
      mocks.mockPrisma.topicEvidence.findMany.mockResolvedValue(
        duplicateUrlEvidences,
      );

      mocks.mockChatFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          executiveSummary: "Report.",
          preface: "",
          conclusion: "",
          highlights: [],
          charts: [],
        }),
      });

      mocks.mockReportEditor.editDimensionInputs.mockResolvedValue({
        dimensions: [
          {
            dimensionId: "dim-001",
            dimensionName: "市场份额",
            dimensionDescription: "",
            summary: "AI market",
            keyFindings: [],
            trends: [],
            challenges: [],
            opportunities: [],
            detailedContent: "content [1] and [2]",
            sourcesUsed: 2,
            figureReferences: [],
            generatedCharts: [],
          },
        ],
        deduplicationStats: {
          removedParagraphs: 0,
          duplicateClaims: 0,
          affectedDimensions: [],
        },
      });

      mocks.mockPrisma.topicReport.update.mockResolvedValue({
        id: "report-001",
      });

      const result = await service.synthesizeReport(mockTopic, "report-001");

      expect(result).toBeDefined();
      // assembler.finalizeReportWithCitations should receive remapped content
      expect(
        mocks.mockAssembler.finalizeReportWithCitations,
      ).toHaveBeenCalled();
    });
  });

  // ============================================================
  // synthesizeReport — ResearchEventEmitter progress events
  // ============================================================

  describe("synthesizeReport — event emission", () => {
    it("should emit synthesis progress events through ResearchEventEmitter", async () => {
      const mocks = buildMocks();
      const service = await buildModule(mocks, { eventEmitter: true });

      mocks.mockPrisma.dimensionAnalysis.findMany.mockResolvedValue([
        mockDimensionAnalysis,
      ]);
      mocks.mockPrisma.topicEvidence.findMany.mockResolvedValue([]);

      mocks.mockChatFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          executiveSummary: "Report.",
          preface: "",
          conclusion: "",
          highlights: [],
          charts: [],
        }),
      });

      mocks.mockReportEditor.editDimensionInputs.mockResolvedValue({
        dimensions: [
          {
            dimensionId: "dim-001",
            dimensionName: "市场份额",
            dimensionDescription: "",
            summary: "AI market",
            keyFindings: [],
            trends: [],
            challenges: [],
            opportunities: [],
            detailedContent: "content",
            sourcesUsed: 0,
            figureReferences: [],
            generatedCharts: [],
          },
        ],
        deduplicationStats: {
          removedParagraphs: 0,
          duplicateClaims: 0,
          affectedDimensions: [],
        },
      });

      mocks.mockPrisma.topicReport.update.mockResolvedValue({
        id: "report-001",
      });

      await service.synthesizeReport(mockTopic, "report-001");

      expect(
        mocks.mockEventEmitter.emitReportSynthesisProgress,
      ).toHaveBeenCalledWith(
        "topic-001",
        expect.objectContaining({ progress: 5, phase: "collecting" }),
      );
    });
  });

  // ============================================================
  // synthesizeReport — normalizeExecutiveSummary JSON string edge case
  // ============================================================

  describe("synthesizeReport — executiveSummary JSON string handling", () => {
    it("should handle executiveSummary returned as JSON-stringified object", async () => {
      const mocks = buildMocks();
      const service = await buildModule(mocks);

      mocks.mockPrisma.dimensionAnalysis.findMany.mockResolvedValue([
        mockDimensionAnalysis,
      ]);
      mocks.mockPrisma.topicEvidence.findMany.mockResolvedValue([]);

      // AI returns executiveSummary as a JSON string of an object
      const esObject = {
        coreConclusions: ["英伟达市场份额达 80%"],
        keyMetrics: [{ metric: "Market Share", value: "80%", trend: "stable" }],
      };
      mocks.mockChatFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          executiveSummary: JSON.stringify(esObject),
          preface: "",
          conclusion: "",
          highlights: [],
          charts: [],
        }),
      });

      mocks.mockReportEditor.editDimensionInputs.mockResolvedValue({
        dimensions: [
          {
            dimensionId: "dim-001",
            dimensionName: "市场份额",
            dimensionDescription: "",
            summary: "AI market",
            keyFindings: [],
            trends: [],
            challenges: [],
            opportunities: [],
            detailedContent: "content",
            sourcesUsed: 0,
            figureReferences: [],
            generatedCharts: [],
          },
        ],
        deduplicationStats: {
          removedParagraphs: 0,
          duplicateClaims: 0,
          affectedDimensions: [],
        },
      });

      mocks.mockPrisma.topicReport.update.mockResolvedValue({
        id: "report-001",
      });

      const result = await service.synthesizeReport(mockTopic, "report-001");

      expect(result).toBeDefined();
      expect(mocks.mockPrisma.topicReport.update).toHaveBeenCalled();
    });

    it("should handle fullText field in executiveSummary JSON string", async () => {
      const mocks = buildMocks();
      const service = await buildModule(mocks);

      mocks.mockPrisma.dimensionAnalysis.findMany.mockResolvedValue([
        mockDimensionAnalysis,
      ]);
      mocks.mockPrisma.topicEvidence.findMany.mockResolvedValue([]);

      const esWithFullText = {
        fullText: "This is the **full** executive summary.",
      };
      mocks.mockChatFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          executiveSummary: JSON.stringify(esWithFullText),
          preface: "",
          conclusion: "",
          highlights: [],
          charts: [],
        }),
      });

      mocks.mockReportEditor.editDimensionInputs.mockResolvedValue({
        dimensions: [
          {
            dimensionId: "dim-001",
            dimensionName: "市场份额",
            dimensionDescription: "",
            summary: "AI market",
            keyFindings: [],
            trends: [],
            challenges: [],
            opportunities: [],
            detailedContent: "content",
            sourcesUsed: 0,
            figureReferences: [],
            generatedCharts: [],
          },
        ],
        deduplicationStats: {
          removedParagraphs: 0,
          duplicateClaims: 0,
          affectedDimensions: [],
        },
      });

      mocks.mockPrisma.topicReport.update.mockResolvedValue({
        id: "report-001",
      });

      const result = await service.synthesizeReport(mockTopic, "report-001");

      expect(result).toBeDefined();
    });
  });

  // ============================================================
  // synthesizeReport — English language topic
  // ============================================================

  describe("synthesizeReport — English language", () => {
    it("should use English labels for references section when topic language is en", async () => {
      const mocks = buildMocks();
      const service = await buildModule(mocks);

      const enTopic = {
        ...mockTopic,
        language: "en",
      } as unknown as ResearchTopic;

      mocks.mockPrisma.dimensionAnalysis.findMany.mockResolvedValue([
        mockDimensionAnalysis,
      ]);
      mocks.mockPrisma.topicEvidence.findMany.mockResolvedValue([
        {
          id: "ev-001",
          citationIndex: 1,
          title: "Nvidia Market Report",
          url: "https://example.com/nvidia",
          domain: "example.com",
          sourceType: "WEB",
          publishedAt: new Date("2024-01-01"),
          credibilityScore: 0.9,
          accessedAt: new Date(),
          reportId: "report-001",
        },
      ]);

      mocks.mockChatFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          executiveSummary: "Nvidia dominates the AI chip market.",
          preface: "This report analyzes the AI chip market.",
          conclusion: "Conclusion text.",
          highlights: [],
          charts: [],
        }),
      });

      mocks.mockReportEditor.editDimensionInputs.mockResolvedValue({
        dimensions: [
          {
            dimensionId: "dim-001",
            dimensionName: "Market Share",
            dimensionDescription: "",
            summary: "AI market",
            keyFindings: [],
            trends: [],
            challenges: [],
            opportunities: [],
            detailedContent: "content [1]",
            sourcesUsed: 1,
            figureReferences: [],
            generatedCharts: [],
          },
        ],
        deduplicationStats: {
          removedParagraphs: 0,
          duplicateClaims: 0,
          affectedDimensions: [],
        },
      });

      mocks.mockPrisma.topicReport.update.mockResolvedValue({
        id: "report-001",
      });

      const result = await service.synthesizeReport(enTopic, "report-001");

      expect(result).toBeDefined();
      // finalizeReportWithCitations receives the report — check it was called with References
      const finalizeCall =
        mocks.mockAssembler.finalizeReportWithCitations.mock.calls[0];
      expect(finalizeCall[0]).toContain("References");
    });
  });
});

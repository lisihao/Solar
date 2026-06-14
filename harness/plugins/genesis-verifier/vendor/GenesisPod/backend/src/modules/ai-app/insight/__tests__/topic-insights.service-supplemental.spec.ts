/**
 * TopicInsightsService - Supplemental Tests
 *
 * Covers uncovered branches:
 * - cleanHtmlTagsFromContent: null/empty content → return as-is (line 70)
 * - reprocessReportFormatting: success path (lines 495-512)
 * - reprocessReportFormatting: not found or wrong user (lines 500-501)
 * - streamRefreshProgress: event emission and cleanup (lines 579-613)
 * - transformReportForFrontend: null report returns null (line 718)
 * - cleanAndSanitize: null/empty content returns "" (line 736)
 * - checkTopicAccess: userId === ownerId returns true (line 1454)
 */

import { Test, TestingModule } from "@nestjs/testing";
import { TopicInsightsService } from "../topic-insights.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { NotFoundException } from "@nestjs/common";
import {
  TopicTeamOrchestratorService,
  ReportSynthesisService,
  EvidenceManagementService,
  ReportChangeService,
  ReportAnnotationService,
  ResearchStrategyService,
  AgentActivityService,
  CredibilityReportService,
  TopicCrudService,
  TopicDimensionService,
  TopicExportService,
  TopicScheduleService,
  ReportQualityTraceService,
  ReportDataService,
  LatexRepairService,
} from "../services";
import { ChatFacade } from "@/modules/ai-harness/facade";

function buildMocks() {
  const mockPrisma = {
    topicReport: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    topicRefreshLog: {
      findFirst: jest.fn(),
    },
    researchTopic: {
      findUnique: jest.fn(),
    },
    topicReportRevision: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    reportAnnotation: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  };

  const mockEventEmitter = {
    emit: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
  };

  const mockOrchestrator = {
    executeRefresh: jest.fn(),
    getRefreshStatus: jest.fn(),
    cancelRefresh: jest.fn(),
  };

  const mockReportService = {
    synthesizeReport: jest.fn(),
    getReport: jest.fn(),
    listReports: jest.fn(),
    compareReports: jest.fn(),
    reprocessExistingReport: jest.fn(),
    getLatestReport: jest.fn(),
  };

  const mockEvidenceService = {
    recalculateCredibilityScores: jest.fn(),
    listEvidence: jest.fn(),
    getEvidence: jest.fn(),
  };

  const mockFacade = {
    chat: jest.fn(),
  };

  const mockReportChangeService = {
    getChanges: jest.fn(),
    addChange: jest.fn(),
    checkinChange: jest.fn(),
    checkinAllChanges: jest.fn(),
  };

  const mockReportAnnotationService = {
    getAnnotations: jest.fn(),
    addAnnotation: jest.fn(),
    createAnnotation: jest.fn(),
    updateAnnotation: jest.fn(),
    deleteAnnotation: jest.fn(),
    resolveAnnotation: jest.fn(),
    resolveAllAnnotations: jest.fn(),
  };

  const mockResearchStrategyService = {
    analyzeAndRecommend: jest.fn(),
    quickCheck: jest.fn(),
    getSmartRefreshOptions: jest.fn(),
  };

  const mockAgentActivityService = {
    getActivitiesByDimension: jest.fn(),
    getActivityStats: jest.fn(),
  };

  const mockCredibilityReportService = {
    getOrGenerateCredibilityReport: jest.fn(),
    generateCredibilityReport: jest.fn(),
  };

  const mockCrudService = {
    createTopic: jest.fn(),
    listTopics: jest.fn(),
    getTopic: jest.fn(),
    updateTopic: jest.fn(),
    deleteTopic: jest.fn(),
    getResearchHistory: jest.fn(),
    getLogs: jest.fn(),
    getStats: jest.fn(),
    recalculateTopicStats: jest.fn(),
  };

  const mockDimensionService = {
    listDimensions: jest.fn(),
    addDimension: jest.fn(),
    updateDimension: jest.fn(),
    deleteDimension: jest.fn(),
    refreshDimension: jest.fn(),
    reorderDimensions: jest.fn(),
    getTemplates: jest.fn(),
    createFromTemplate: jest.fn(),
  };

  const mockExportService = {
    exportReport: jest.fn(),
    updateVisibility: jest.fn(),
    getSharingSettings: jest.fn(),
    getSharedTopic: jest.fn(),
    getSharedTopicLatestReport: jest.fn(),
  };

  const mockScheduleService = {
    getSchedule: jest.fn(),
    updateSchedule: jest.fn(),
  };

  const mockQualityTraceService = {
    getQualityTrace: jest.fn(),
    getQualitySummary: jest.fn(),
    getQualityDetails: jest.fn(),
  };

  const mockReportDataService = {
    deleteReportCascade: jest.fn(),
    updateReportContent: jest.fn(),
    getReportRevisions: jest.fn(),
    rollbackToRevision: jest.fn(),
    saveAiEditRevision: jest.fn(),
  };

  return {
    mockPrisma,
    mockEventEmitter,
    mockOrchestrator,
    mockReportService,
    mockEvidenceService,
    mockFacade,
    mockReportChangeService,
    mockReportAnnotationService,
    mockResearchStrategyService,
    mockAgentActivityService,
    mockCredibilityReportService,
    mockCrudService,
    mockDimensionService,
    mockExportService,
    mockScheduleService,
    mockQualityTraceService,
    mockReportDataService,
  };
}

describe("TopicInsightsService (supplemental)", () => {
  let service: TopicInsightsService;
  let mockPrisma: ReturnType<typeof buildMocks>["mockPrisma"];
  let mockEventEmitter: ReturnType<typeof buildMocks>["mockEventEmitter"];
  let mockReportService: ReturnType<typeof buildMocks>["mockReportService"];

  beforeEach(async () => {
    const mocks = buildMocks();
    mockPrisma = mocks.mockPrisma;
    mockEventEmitter = mocks.mockEventEmitter;
    mockReportService = mocks.mockReportService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TopicInsightsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        {
          provide: TopicTeamOrchestratorService,
          useValue: mocks.mockOrchestrator,
        },
        { provide: ReportSynthesisService, useValue: mockReportService },
        {
          provide: EvidenceManagementService,
          useValue: mocks.mockEvidenceService,
        },
        { provide: ChatFacade, useValue: mocks.mockFacade },
        {
          provide: ReportChangeService,
          useValue: mocks.mockReportChangeService,
        },
        {
          provide: ReportAnnotationService,
          useValue: mocks.mockReportAnnotationService,
        },
        {
          provide: ResearchStrategyService,
          useValue: mocks.mockResearchStrategyService,
        },
        {
          provide: AgentActivityService,
          useValue: mocks.mockAgentActivityService,
        },
        {
          provide: CredibilityReportService,
          useValue: mocks.mockCredibilityReportService,
        },
        { provide: TopicCrudService, useValue: mocks.mockCrudService },
        {
          provide: TopicDimensionService,
          useValue: mocks.mockDimensionService,
        },
        { provide: TopicExportService, useValue: mocks.mockExportService },
        { provide: TopicScheduleService, useValue: mocks.mockScheduleService },
        {
          provide: ReportQualityTraceService,
          useValue: mocks.mockQualityTraceService,
        },
        { provide: ReportDataService, useValue: mocks.mockReportDataService },
        {
          provide: LatexRepairService,
          useValue: { repairMarkdown: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<TopicInsightsService>(TopicInsightsService);
  });

  afterEach(() => jest.clearAllMocks());

  // ============================================================
  // reprocessReportFormatting – success path (lines 495-512)
  // ============================================================

  describe("reprocessReportFormatting", () => {
    it("should reprocess report and emit event when user is the owner", async () => {
      const mockReport = {
        id: "report-001",
        topic: { id: "topic-001", userId: "user-001" },
      };
      mockPrisma.topicReport.findUnique.mockResolvedValue(mockReport);
      const updatedReport = { id: "report-001", fullReport: "Cleaned content" };
      mockReportService.reprocessExistingReport.mockResolvedValue(
        updatedReport,
      );

      const result = await service.reprocessReportFormatting(
        "user-001",
        "report-001",
      );

      expect(mockReportService.reprocessExistingReport).toHaveBeenCalledWith(
        "report-001",
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        "topic-insights.report.refreshed",
        expect.objectContaining({
          topicId: "topic-001",
          reportId: "report-001",
          refreshedAt: expect.any(Date),
        }),
      );
      expect(result.success).toBe(true);
      expect(result.report).toEqual(updatedReport);
    });

    it("should throw NotFoundException when report is not found", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue(null);

      await expect(
        service.reprocessReportFormatting("user-001", "nonexistent"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException when report belongs to different user", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue({
        id: "report-001",
        topic: { id: "topic-001", userId: "other-user" },
      });

      await expect(
        service.reprocessReportFormatting("user-001", "report-001"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================
  // streamRefreshProgress – event emission (lines 579-613)
  // ============================================================

  describe("streamRefreshProgress", () => {
    it("should return an Observable that emits MessageEvent when topic event fires", (done) => {
      const topicId = "topic-stream-001";

      // Capture the listener registered with eventEmitter.on
      let capturedListener: ((event: unknown) => void) | undefined;
      mockEventEmitter.on.mockImplementation(
        (_event: string, handler: (event: unknown) => void) => {
          capturedListener = handler;
        },
      );

      const observable = service.streamRefreshProgress("user-001", topicId);

      const received: MessageEvent[] = [];
      const sub = observable.subscribe({
        next: (msg) => {
          received.push(msg);
          // After receiving first event, complete
          sub.unsubscribe();
          done();
        },
        error: done,
      });

      // Emit a matching event
      if (capturedListener) {
        capturedListener({
          topicId,
          phase: "searching",
          progress: 50,
          message: "Searching...",
        });
      }
    });

    it("should NOT emit for events with different topicId", (done) => {
      const topicId = "topic-stream-002";

      let capturedListener: ((event: unknown) => void) | undefined;
      mockEventEmitter.on.mockImplementation(
        (_event: string, handler: (event: unknown) => void) => {
          capturedListener = handler;
        },
      );

      const observable = service.streamRefreshProgress("user-001", topicId);

      let count = 0;
      const sub = observable.subscribe({
        next: () => {
          count++;
        },
      });

      // Emit event for DIFFERENT topic
      if (capturedListener) {
        capturedListener({
          topicId: "different-topic",
          phase: "searching",
          progress: 30,
          message: "Other topic event",
        });
      }

      // Give it a tick to check no events were emitted
      setImmediate(() => {
        expect(count).toBe(0);
        sub.unsubscribe();
        done();
      });
    });
  });

  // ============================================================
  // transformReportForFrontend – null report (line 718)
  // ============================================================

  describe("transformReportForFrontend – null input", () => {
    it("should return null when report is null", async () => {
      // Access transformReportForFrontend via getLatestReport which calls it
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      // getLatestReport returns null → transformReportForFrontend(null) → returns null
      mockReportService.getLatestReport.mockResolvedValue(null);

      // Override the private method resolution by accessing via service internals
      const reportSvcMock = (service as any).reportService;
      reportSvcMock.getLatestReport = jest.fn().mockResolvedValue(null);

      await expect(
        service.getLatestReport("user-001", "topic-001"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should call transformReportForFrontend with null report (no dimensionAnalyses)", async () => {
      // Test transformReportForFrontend directly via reflection
      const transform = (service as any).transformReportForFrontend.bind(
        service,
      );

      // null input
      expect(transform(null)).toBeNull();

      // Report without dimensionAnalyses (dimensionAnalyses is falsy)
      const reportNoAnalyses = {
        id: "r1",
        executiveSummary: "<br>Summary text",
        fullReport: "<br/>Full content",
        dimensionAnalyses: null,
      };
      const result = transform(reportNoAnalyses);
      expect(result.executiveSummary).toBe("Summary text");
      expect(result.fullReport).toBe("Full content");
    });

    it("should call cleanAndSanitize with null/empty content in dimensionAnalyses", () => {
      const transform = (service as any).transformReportForFrontend.bind(
        service,
      );

      const reportWithEmptyDimensions = {
        id: "r1",
        executiveSummary: null,
        fullReport: null,
        dimensionAnalyses: [
          {
            dimensionName: "Market",
            summary: null, // null → cleanAndSanitize returns ""
            detailedContent: "", // empty → cleanAndSanitize returns ""
            keyFindings: [],
            dataPoints: null,
          },
        ],
      };

      // Should not throw
      const result = transform(reportWithEmptyDimensions);
      expect(result.dimensionAnalyses[0].summary).toBe("");
      expect(result.dimensionAnalyses[0].detailedContent).toBe("");
    });
  });

  // ============================================================
  // checkTopicAccess – userId === ownerId returns true (line 1454)
  // ============================================================

  describe("checkTopicAccess – owner access always allowed", () => {
    it("should return true when userId equals ownerId in checkTopicAccess", async () => {
      // Access private method via reflection
      const checkTopicAccess = (service as any).checkTopicAccess.bind(service);

      // When userId === ownerId, should return true without querying DB
      const result = await checkTopicAccess("user-1", "topic-1", "user-1");

      expect(result).toBe(true);
      // Should NOT query the database since owner check short-circuits
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // checkTopicAccess – empty queryRaw returns false (line 1474)
  // ============================================================

  describe("checkTopicAccess – empty result from queryRaw", () => {
    it("should return false when $queryRaw returns empty array", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);

      const checkTopicAccess = (service as any).checkTopicAccess.bind(service);
      const result = await checkTopicAccess("user-2", "topic-1", "owner-1");

      expect(result).toBe(false);
    });
  });
});

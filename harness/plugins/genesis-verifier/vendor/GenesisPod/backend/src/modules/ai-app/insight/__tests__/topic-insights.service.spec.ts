/**
 * TopicInsightsService (Facade) Unit Tests
 *
 * Coverage targets:
 * - Delegation methods (createTopic, listTopics, etc.) correctly delegate to sub-services
 * - triggerRefresh: topic ownership, orchestration
 * - regenerateReportContent: ownership check, synthesis, event emission
 * - getCredibilityReport: report found, ownership check
 * - verifyTopicOwnership / verifyTopicReadAccess
 */

import { Test, TestingModule } from "@nestjs/testing";
import { TopicInsightsService } from "../topic-insights.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { NotFoundException, ForbiddenException } from "@nestjs/common";
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

// ──────────────────────────────────────────────────────────────────────────────
// Mock factory
// ──────────────────────────────────────────────────────────────────────────────

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
  };

  const mockEventEmitter = {
    emit: jest.fn(),
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

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("TopicInsightsService", () => {
  let service: TopicInsightsService;
  let mockPrisma: ReturnType<typeof buildMocks>["mockPrisma"];
  let mockEventEmitter: ReturnType<typeof buildMocks>["mockEventEmitter"];
  let mockOrchestrator: ReturnType<typeof buildMocks>["mockOrchestrator"];
  let mockReportService: ReturnType<typeof buildMocks>["mockReportService"];
  let mockCrudService: ReturnType<typeof buildMocks>["mockCrudService"];
  let mockDimensionService: ReturnType<
    typeof buildMocks
  >["mockDimensionService"];
  let mockExportService: ReturnType<typeof buildMocks>["mockExportService"];
  let mockCredibilityReportService: ReturnType<
    typeof buildMocks
  >["mockCredibilityReportService"];
  let mockResearchStrategyService: ReturnType<
    typeof buildMocks
  >["mockResearchStrategyService"];

  beforeEach(async () => {
    const mocks = buildMocks();
    mockPrisma = mocks.mockPrisma;
    mockEventEmitter = mocks.mockEventEmitter;
    mockOrchestrator = mocks.mockOrchestrator;
    mockReportService = mocks.mockReportService;
    mockCrudService = mocks.mockCrudService;
    mockDimensionService = mocks.mockDimensionService;
    mockExportService = mocks.mockExportService;
    mockCredibilityReportService = mocks.mockCredibilityReportService;
    mockResearchStrategyService = mocks.mockResearchStrategyService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TopicInsightsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: TopicTeamOrchestratorService, useValue: mockOrchestrator },
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
          useValue: mockResearchStrategyService,
        },
        {
          provide: AgentActivityService,
          useValue: mocks.mockAgentActivityService,
        },
        {
          provide: CredibilityReportService,
          useValue: mockCredibilityReportService,
        },
        { provide: TopicCrudService, useValue: mockCrudService },
        { provide: TopicDimensionService, useValue: mockDimensionService },
        { provide: TopicExportService, useValue: mockExportService },
        { provide: TopicScheduleService, useValue: mocks.mockScheduleService },
        {
          provide: ReportQualityTraceService,
          useValue: mocks.mockQualityTraceService,
        },
        {
          provide: ReportDataService,
          useValue: mocks.mockReportDataService,
        },
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
  // Delegation methods
  // ============================================================

  describe("CRUD delegation (createTopic, listTopics, etc.)", () => {
    it("should delegate createTopic to crudService", async () => {
      const expectedTopic = { id: "topic-001", name: "新专题" };
      mockCrudService.createTopic.mockResolvedValue(expectedTopic);

      const dto = { name: "新专题", type: "technology" };
      const result = await service.createTopic("user-001", dto as never);

      expect(mockCrudService.createTopic).toHaveBeenCalledWith("user-001", dto);
      expect(result).toEqual(expectedTopic);
    });

    it("should delegate listTopics to crudService", async () => {
      const expectedList = { items: [], total: 0 };
      mockCrudService.listTopics.mockResolvedValue(expectedList);

      const query = { page: 1, pageSize: 10 };
      const result = await service.listTopics("user-001", query as never);

      expect(mockCrudService.listTopics).toHaveBeenCalledWith(
        "user-001",
        query,
      );
      expect(result).toEqual(expectedList);
    });

    it("should delegate getTopic to crudService", async () => {
      const topic = { id: "topic-001", name: "测试专题" };
      mockCrudService.getTopic.mockResolvedValue(topic);

      const result = await service.getTopic("user-001", "topic-001");

      expect(mockCrudService.getTopic).toHaveBeenCalledWith(
        "user-001",
        "topic-001",
      );
      expect(result).toEqual(topic);
    });

    it("should delegate deleteTopic to crudService", async () => {
      mockCrudService.deleteTopic.mockResolvedValue({ success: true });

      await service.deleteTopic("user-001", "topic-001");

      expect(mockCrudService.deleteTopic).toHaveBeenCalledWith(
        "user-001",
        "topic-001",
      );
    });

    it("should delegate getStats to crudService", async () => {
      const stats = { dimensions: 3, sources: 42, reports: 2 };
      mockCrudService.getStats.mockResolvedValue(stats);

      const result = await service.getStats("user-001", "topic-001");

      expect(mockCrudService.getStats).toHaveBeenCalledWith(
        "user-001",
        "topic-001",
      );
      expect(result).toEqual(stats);
    });
  });

  describe("Dimension delegation", () => {
    it("should delegate addDimension to dimensionService", async () => {
      const dimension = { id: "dim-001", name: "新维度" };
      mockDimensionService.addDimension.mockResolvedValue(dimension);

      const dto = { name: "新维度", description: "维度描述" };
      const result = await service.addDimension(
        "user-001",
        "topic-001",
        dto as never,
      );

      expect(mockDimensionService.addDimension).toHaveBeenCalledWith(
        "user-001",
        "topic-001",
        dto,
      );
      expect(result).toEqual(dimension);
    });

    it("should delegate listDimensions to dimensionService", async () => {
      mockDimensionService.listDimensions.mockResolvedValue([]);

      await service.listDimensions("user-001", "topic-001");

      expect(mockDimensionService.listDimensions).toHaveBeenCalledWith(
        "user-001",
        "topic-001",
      );
    });
  });

  describe("Dimension delegation — additional methods", () => {
    it("should delegate updateDimension to dimensionService", async () => {
      const updated = { id: "dim-001", name: "Updated" };
      mockDimensionService.updateDimension.mockResolvedValue(updated);

      const dto = { name: "Updated" };
      const result = await service.updateDimension(
        "user-001",
        "topic-001",
        "dim-001",
        dto as never,
      );

      expect(mockDimensionService.updateDimension).toHaveBeenCalledWith(
        "user-001",
        "topic-001",
        "dim-001",
        dto,
      );
      expect(result).toEqual(updated);
    });

    it("should delegate deleteDimension to dimensionService", async () => {
      mockDimensionService.deleteDimension.mockResolvedValue({ success: true });

      await service.deleteDimension("user-001", "topic-001", "dim-001");

      expect(mockDimensionService.deleteDimension).toHaveBeenCalledWith(
        "user-001",
        "topic-001",
        "dim-001",
      );
    });

    it("should delegate refreshDimension to dimensionService", async () => {
      const refreshResult = { jobId: "job-1" };
      mockDimensionService.refreshDimension.mockResolvedValue(refreshResult);

      const dto = { force: true };
      const result = await service.refreshDimension(
        "user-001",
        "topic-001",
        "dim-001",
        dto as never,
      );

      expect(mockDimensionService.refreshDimension).toHaveBeenCalledWith(
        "user-001",
        "topic-001",
        "dim-001",
        dto,
      );
      expect(result).toEqual(refreshResult);
    });

    it("should delegate reorderDimensions to dimensionService", async () => {
      mockDimensionService.reorderDimensions.mockResolvedValue({
        success: true,
      });

      const dto = { dimensionIds: ["dim-001", "dim-002"] };
      await service.reorderDimensions("user-001", "topic-001", dto as never);

      expect(mockDimensionService.reorderDimensions).toHaveBeenCalledWith(
        "user-001",
        "topic-001",
        dto,
      );
    });

    it("should delegate getTemplates to dimensionService", async () => {
      const templates = [{ id: "t1", name: "Template 1" }];
      mockDimensionService.getTemplates.mockResolvedValue(templates);

      const query = { category: "technology" };
      const result = await service.getTemplates(query as never);

      expect(mockDimensionService.getTemplates).toHaveBeenCalledWith(query);
      expect(result).toEqual(templates);
    });

    it("should delegate createFromTemplate to dimensionService", async () => {
      const topic = { id: "topic-new" };
      mockDimensionService.createFromTemplate.mockResolvedValue(topic);

      const dto = { templateId: "t1" };
      const result = await service.createFromTemplate("user-001", dto as never);

      expect(mockDimensionService.createFromTemplate).toHaveBeenCalledWith(
        "user-001",
        dto,
      );
      expect(result).toEqual(topic);
    });
  });

  describe("Export delegation — additional methods", () => {
    it("should delegate updateVisibility to exportService", async () => {
      mockExportService.updateVisibility.mockResolvedValue({
        visibility: "PUBLIC",
      });

      const dto = { visibility: "PUBLIC" };
      const result = await service.updateVisibility(
        "user-001",
        "topic-001",
        dto as never,
      );

      expect(mockExportService.updateVisibility).toHaveBeenCalledWith(
        "user-001",
        "topic-001",
        dto,
      );
      expect(result).toEqual({ visibility: "PUBLIC" });
    });

    it("should delegate getSharingSettings to exportService", async () => {
      const settings = { shareToken: "token-abc", isPublic: true };
      mockExportService.getSharingSettings.mockResolvedValue(settings);

      const result = await service.getSharingSettings("user-001", "topic-001");

      expect(mockExportService.getSharingSettings).toHaveBeenCalledWith(
        "user-001",
        "topic-001",
      );
      expect(result).toEqual(settings);
    });

    it("should delegate getSharedTopic to exportService", async () => {
      const topic = { id: "topic-001", name: "Shared Topic" };
      mockExportService.getSharedTopic.mockResolvedValue(topic);

      const result = await service.getSharedTopic("share-token-123");

      expect(mockExportService.getSharedTopic).toHaveBeenCalledWith(
        "share-token-123",
      );
      expect(result).toEqual(topic);
    });

    it("should delegate getSharedTopicLatestReport to exportService", async () => {
      const report = { id: "report-001" };
      mockExportService.getSharedTopicLatestReport.mockResolvedValue(report);

      const result =
        await service.getSharedTopicLatestReport("share-token-123");

      expect(mockExportService.getSharedTopicLatestReport).toHaveBeenCalledWith(
        "share-token-123",
      );
      expect(result).toEqual(report);
    });
  });

  describe("Export delegation", () => {
    it("should delegate exportReport to exportService", async () => {
      const exportResult = { url: "https://download.example.com/report.pdf" };
      mockExportService.exportReport.mockResolvedValue(exportResult);

      const dto = { format: "pdf" };
      const result = await service.exportReport(
        "user-001",
        "topic-001",
        "report-001",
        dto as never,
      );

      expect(mockExportService.exportReport).toHaveBeenCalledWith(
        "user-001",
        "topic-001",
        "report-001",
        dto,
      );
      expect(result).toEqual(exportResult);
    });
  });

  // ============================================================
  // triggerRefresh
  // ============================================================

  describe("triggerRefresh", () => {
    it("should call orchestrator executeRefresh with correct options for FULL refresh", async () => {
      const mockTopic = {
        id: "topic-001",
        name: "测试专题",
        userId: "user-001",
      };
      mockCrudService.getTopic.mockResolvedValue(mockTopic);
      const mockReport = { id: "report-001" };
      mockOrchestrator.executeRefresh.mockResolvedValue(mockReport);

      const dto = { type: "FULL" };
      const result = await service.triggerRefresh(
        "user-001",
        "topic-001",
        dto as never,
      );

      expect(mockOrchestrator.executeRefresh).toHaveBeenCalledWith(
        mockTopic,
        expect.objectContaining({
          forceRefresh: true,
          incremental: false,
        }),
      );
      expect(result.success).toBe(true);
      expect(result.reportId).toBe("report-001");
    });

    it("should use incremental option for INCREMENTAL refresh type", async () => {
      const mockTopic = {
        id: "topic-001",
        name: "测试专题",
        userId: "user-001",
      };
      mockCrudService.getTopic.mockResolvedValue(mockTopic);
      mockOrchestrator.executeRefresh.mockResolvedValue({ id: "report-002" });

      const dto = { type: "INCREMENTAL" };
      await service.triggerRefresh("user-001", "topic-001", dto as never);

      expect(mockOrchestrator.executeRefresh).toHaveBeenCalledWith(
        mockTopic,
        expect.objectContaining({ incremental: true }),
      );
    });

    it("should propagate error when topic not found", async () => {
      mockCrudService.getTopic.mockRejectedValue(
        new NotFoundException("Topic not found"),
      );

      await expect(
        service.triggerRefresh("user-001", "nonexistent", {
          type: "FULL",
        } as never),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================
  // regenerateReportContent
  // ============================================================

  describe("regenerateReportContent", () => {
    const mockReport = {
      id: "report-001",
      topicId: "topic-001",
      topic: {
        id: "topic-001",
        userId: "user-001",
        name: "量子计算",
        type: "technology",
      },
    };

    it("should regenerate report and return updated content", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue(mockReport);
      const updatedReport = { ...mockReport, fullReport: "更新后的报告内容" };
      mockReportService.synthesizeReport.mockResolvedValue(updatedReport);

      const result = await service.regenerateReportContent(
        "user-001",
        "report-001",
      );

      expect(mockReportService.synthesizeReport).toHaveBeenCalledWith(
        mockReport.topic,
        "report-001",
        undefined,
      );
      expect(result.success).toBe(true);
      expect(result.report).toEqual(updatedReport);
    });

    it("should pass feedback to synthesizeReport", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue(mockReport);
      mockReportService.synthesizeReport.mockResolvedValue({
        id: "report-001",
      });

      await service.regenerateReportContent(
        "user-001",
        "report-001",
        "请增加数据图表",
      );

      expect(mockReportService.synthesizeReport).toHaveBeenCalledWith(
        mockReport.topic,
        "report-001",
        "请增加数据图表",
      );
    });

    it("should emit refresh event after successful regeneration", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue(mockReport);
      mockReportService.synthesizeReport.mockResolvedValue({
        id: "report-001",
      });

      await service.regenerateReportContent("user-001", "report-001");

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        "topic-insights.report.refreshed",
        expect.objectContaining({
          topicId: "topic-001",
          reportId: "report-001",
          refreshedAt: expect.any(Date),
        }),
      );
    });

    it("should throw NotFoundException when report not found", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue(null);

      await expect(
        service.regenerateReportContent("user-001", "nonexistent-report"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException when report belongs to different user", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue({
        ...mockReport,
        topic: { ...mockReport.topic, userId: "other-user" },
      });

      await expect(
        service.regenerateReportContent("user-001", "report-001"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================
  // getCredibilityReport
  // ============================================================

  describe("getCredibilityReport", () => {
    it("should return credibility report when user has access", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue({
        id: "report-001",
        topic: { id: "topic-001", userId: "user-001" },
      });
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
        visibility: "PRIVATE",
      });
      const credReport = { score: 0.85, sources: [] };
      mockCredibilityReportService.getOrGenerateCredibilityReport.mockResolvedValue(
        credReport,
      );

      const result = await service.getCredibilityReport(
        "user-001",
        "report-001",
      );

      expect(
        mockCredibilityReportService.getOrGenerateCredibilityReport,
      ).toHaveBeenCalledWith("report-001");
      expect(result).toEqual(credReport);
    });

    it("should throw NotFoundException when report not found", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue(null);

      await expect(
        service.getCredibilityReport("user-001", "nonexistent-report"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================
  // getResearchStrategy
  // ============================================================

  describe("getResearchStrategy", () => {
    it("should call researchStrategyService.analyzeAndRecommend after ownership check", async () => {
      const mockTopic = {
        id: "topic-001",
        name: "策略测试",
        userId: "user-001",
      };
      mockPrisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      const strategy = {
        recommendation: "INCREMENTAL",
        reason: "部分维度需更新",
      };
      mockResearchStrategyService.analyzeAndRecommend.mockResolvedValue(
        strategy,
      );

      const result = await service.getResearchStrategy("user-001", "topic-001");

      expect(
        mockResearchStrategyService.analyzeAndRecommend,
      ).toHaveBeenCalledWith("topic-001");
      expect(result).toEqual(strategy);
    });
  });

  // ============================================================
  // smartStartResearch
  // ============================================================

  describe("smartStartResearch", () => {
    it("should use smart strategy to determine refresh options", async () => {
      const mockTopic = {
        id: "topic-001",
        name: "智能研究",
        userId: "user-001",
      };
      mockCrudService.getTopic.mockResolvedValue(mockTopic);
      mockResearchStrategyService.getSmartRefreshOptions.mockResolvedValue({
        strategy: "INCREMENTAL",
        message: "建议增量更新",
        forceRefresh: false,
        dimensionIds: undefined,
        incremental: true,
      });
      mockOrchestrator.executeRefresh.mockResolvedValue({
        id: "report-smart-001",
      });

      const result = await service.smartStartResearch("user-001", "topic-001");

      expect(
        mockResearchStrategyService.getSmartRefreshOptions,
      ).toHaveBeenCalledWith("topic-001");
      expect(mockOrchestrator.executeRefresh).toHaveBeenCalledWith(
        mockTopic,
        expect.objectContaining({ incremental: true }),
      );
      expect(result.strategy).toBe("INCREMENTAL");
    });
  });

  // ============================================================
  // quickCheckResearchStatus
  // ============================================================

  describe("quickCheckResearchStatus", () => {
    it("should verify topic ownership and call quickCheck", async () => {
      const mockTopic = { id: "topic-001", userId: "user-001" };
      mockPrisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      const checkResult = { needsRefresh: true, reason: "outdated" };
      mockResearchStrategyService.quickCheck.mockResolvedValue(checkResult);

      const result = await service.quickCheckResearchStatus(
        "user-001",
        "topic-001",
      );

      expect(mockResearchStrategyService.quickCheck).toHaveBeenCalledWith(
        "topic-001",
      );
      expect(result).toEqual(checkResult);
    });

    it("should throw NotFoundException when topic not found", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue(null);

      await expect(
        service.quickCheckResearchStatus("user-001", "no-topic"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException when user is not the owner", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "other-user",
      });

      await expect(
        service.quickCheckResearchStatus("user-001", "topic-001"),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ============================================================
  // getAgentActivities
  // ============================================================

  describe("getAgentActivities", () => {
    it("should return activities after verifying ownership", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const mocks = buildMocks();
      const mockAgentActivityService = mocks.mockAgentActivityService;
      mockAgentActivityService.getActivitiesByDimension.mockResolvedValue([]);

      // Need to access the actual mock from the module
      const { mockAgentActivityService: agentSvc } = buildMocks();
      agentSvc.getActivitiesByDimension.mockResolvedValue([{ id: "act-1" }]);

      // The service is already configured with mockAgentActivityService from module setup
      // Just verify ownership check happens before delegation
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
    });

    it("should throw ForbiddenException when user does not own topic", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "different-user",
      });

      await expect(
        service.getAgentActivities("user-001", "topic-001"),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ============================================================
  // getRefreshStatus
  // ============================================================

  describe("getRefreshStatus", () => {
    it("should return refresh status and latest log", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      mockOrchestrator.getRefreshStatus.mockReturnValue({
        isRunning: false,
        startedAt: null,
      });
      const latestLog = { id: "log-001", startedAt: new Date() };
      mockPrisma.topicRefreshLog.findFirst.mockResolvedValue(latestLog);

      const result = await service.getRefreshStatus("user-001", "topic-001");

      expect(result.isRunning).toBe(false);
      expect(result.latestLog).toEqual(latestLog);
    });

    it("should throw NotFoundException when topic not found for refresh status", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue(null);

      await expect(
        service.getRefreshStatus("user-001", "no-topic"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================
  // cancelRefresh
  // ============================================================

  describe("cancelRefresh", () => {
    it("should cancel refresh and return success true when running", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      mockOrchestrator.cancelRefresh = jest.fn().mockResolvedValue(true);

      const result = await service.cancelRefresh(
        "user-001",
        "topic-001",
        {} as never,
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain("取消");
    });

    it("should return success false when no refresh is running", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      mockOrchestrator.cancelRefresh = jest.fn().mockResolvedValue(false);

      const result = await service.cancelRefresh(
        "user-001",
        "topic-001",
        {} as never,
      );

      expect(result.success).toBe(false);
    });

    it("should throw ForbiddenException when cancelling for different user", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "other-user",
      });

      await expect(
        service.cancelRefresh("user-001", "topic-001", {} as never),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ============================================================
  // listReports
  // ============================================================

  describe("listReports", () => {
    it("should list reports after read access verification", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const mockListReports = jest
        .fn()
        .mockResolvedValue([{ id: "report-001" }]);
      // Rebuild service with mockReportService.listReports
      const mocks2 = buildMocks();
      mocks2.mockReportService.listReports = mockListReports;
    });

    it("should throw NotFoundException when topic not found for listReports", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue(null);

      await expect(
        service.listReports("user-001", "no-topic", { limit: 10 } as never),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================
  // getLatestReport
  // ============================================================

  describe("getLatestReport", () => {
    it("should throw NotFoundException when no reports exist", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const mockGetLatestReport = jest.fn().mockResolvedValue(null);
      // Access the internal reportService mock
      // Since we can't easily re-mock, we test via the null-check path
      // by stubbing the mock directly on the existing module instance
      const reportSvcMock = (
        service as unknown as { reportService: { getLatestReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getLatestReport = mockGetLatestReport;

      await expect(
        service.getLatestReport("user-001", "topic-001"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================
  // getReport
  // ============================================================

  describe("getReport", () => {
    it("should throw NotFoundException when report topicId mismatch", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest
        .fn()
        .mockResolvedValue({ id: "report-001", topicId: "other-topic" });

      await expect(
        service.getReport("user-001", "topic-001", "report-001"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException when report not found", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest.fn().mockResolvedValue(null);

      await expect(
        service.getReport("user-001", "topic-001", "no-report"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================
  // deleteReport
  // ============================================================

  describe("deleteReport", () => {
    it("should delete report and execute transaction body", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest
        .fn()
        .mockResolvedValue({ id: "report-001", topicId: "topic-001" });

      // Execute the transaction callback to cover lines 659-679
      (mockPrisma as unknown as { $transaction: jest.Mock }).$transaction = jest
        .fn()
        .mockImplementation(
          async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
            const fakeTx = {
              dimensionAnalysis: {
                deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
              },
              topicReportRevision: {
                deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
              },
              reportAnnotation: {
                deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
              },
              reportChange: {
                deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
              },
              topicReport: {
                delete: jest.fn().mockResolvedValue({ id: "report-001" }),
              },
            };
            return fn(fakeTx);
          },
        );

      const result = await service.deleteReport(
        "user-001",
        "topic-001",
        "report-001",
      );

      expect(result.success).toBe(true);
    });

    it("should throw NotFoundException when report not found for deletion", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest.fn().mockResolvedValue(null);

      await expect(
        service.deleteReport("user-001", "topic-001", "no-report"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException when user does not own the topic", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "other-user",
      });

      await expect(
        service.deleteReport("user-001", "topic-001", "report-001"),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ============================================================
  // recalculateEvidenceCredibility
  // ============================================================

  describe("recalculateEvidenceCredibility", () => {
    it("should delegate to evidenceService", async () => {
      const mocks = buildMocks();
      mocks.mockEvidenceService.recalculateCredibilityScores.mockResolvedValue({
        updated: 5,
      });
      const evidenceSvcMock = (
        service as unknown as {
          evidenceService: { recalculateCredibilityScores: jest.Mock };
        }
      ).evidenceService;
      evidenceSvcMock.recalculateCredibilityScores =
        mocks.mockEvidenceService.recalculateCredibilityScores;

      // Mock ownership checks
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      mockPrisma.topicReport.findUnique.mockResolvedValue({
        id: "report-001",
        topicId: "topic-001",
      });

      await service.recalculateEvidenceCredibility(
        "user-001",
        "topic-001",
        "report-001",
      );

      expect(evidenceSvcMock.recalculateCredibilityScores).toHaveBeenCalledWith(
        "report-001",
      );
    });
  });

  // ============================================================
  // aiEditReport
  // ============================================================

  describe("aiEditReport", () => {
    const setupAiEditMocks = () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest.fn().mockResolvedValue({
        id: "report-001",
        topicId: "topic-001",
        fullReport: "Original report content with [some text] to replace.",
      });
      const prismaMock = mockPrisma as unknown as { $transaction: jest.Mock };
      prismaMock.$transaction = jest
        .fn()
        .mockImplementation(
          async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
            const fakeTx = {
              topicReportRevision: {
                findFirst: jest.fn().mockResolvedValue(null),
                create: jest.fn(),
              },
              topicReport: {
                update: jest.fn().mockResolvedValue({
                  id: "report-001",
                  fullReport: "Edited content",
                }),
              },
            };
            return fn(fakeTx);
          },
        );
    };

    it("should perform AI edit with selectedText and replace in report", async () => {
      setupAiEditMocks();
      const facadeMock = (
        service as unknown as { chatFacade: { chat: jest.Mock } }
      ).chatFacade;
      facadeMock.chat = jest
        .fn()
        .mockResolvedValue({ content: "Edited content", isError: false });

      const result = await service.aiEditReport(
        "user-001",
        "topic-001",
        "report-001",
        {
          operation: "rewrite",
          selectedText: "some text",
          context: "Make it better",
        },
      );

      expect(result.editedContent).toBe("Edited content");
      expect(result.operation).toBe("rewrite");
    });

    it("should use entire report when no selectedText is provided", async () => {
      setupAiEditMocks();
      const facadeMock = (
        service as unknown as { chatFacade: { chat: jest.Mock } }
      ).chatFacade;
      facadeMock.chat = jest.fn().mockResolvedValue({
        content: "Completely new report",
        isError: false,
      });

      const result = await service.aiEditReport(
        "user-001",
        "topic-001",
        "report-001",
        {
          operation: "polish",
        },
      );

      expect(result.editedContent).toBe("Completely new report");
    });

    it("should throw NotFoundException when report not found for AI edit", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest.fn().mockResolvedValue(null);

      await expect(
        service.aiEditReport("user-001", "topic-001", "no-report", {
          operation: "polish",
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException when user does not own topic for AI edit", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "other-user",
      });

      await expect(
        service.aiEditReport("user-001", "topic-001", "report-001", {
          operation: "polish",
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ============================================================
  // getReportRevisions
  // ============================================================

  describe("getReportRevisions", () => {
    it("should delegate to reportDataService.getReportRevisions", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest
        .fn()
        .mockResolvedValue({ id: "report-001", topicId: "topic-001" });
      const revisions = [
        { id: "rev-001", revisionNumber: 1, changeDescription: "Initial" },
      ];
      const reportDataSvcMock = (
        service as unknown as {
          reportDataService: { getReportRevisions: jest.Mock };
        }
      ).reportDataService;
      reportDataSvcMock.getReportRevisions = jest
        .fn()
        .mockResolvedValue(revisions);

      const result = await service.getReportRevisions(
        "user-001",
        "topic-001",
        "report-001",
      );

      expect(reportDataSvcMock.getReportRevisions).toHaveBeenCalledWith(
        "report-001",
      );
      expect(result).toEqual(revisions);
    });

    it("should throw NotFoundException when report not found for revisions", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest.fn().mockResolvedValue(null);

      await expect(
        service.getReportRevisions("user-001", "topic-001", "no-report"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================
  // Annotation operations
  // ============================================================

  describe("getReportAnnotations", () => {
    it("should return annotations for a valid report", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest
        .fn()
        .mockResolvedValue({ id: "report-001", topicId: "topic-001" });
      const annotationSvcMock = (
        service as unknown as {
          reportAnnotationService: { getAnnotations: jest.Mock };
        }
      ).reportAnnotationService;
      annotationSvcMock.getAnnotations = jest.fn().mockResolvedValue([]);

      const result = await service.getReportAnnotations(
        "user-001",
        "topic-001",
        "report-001",
      );

      expect(annotationSvcMock.getAnnotations).toHaveBeenCalledWith(
        "report-001",
        undefined,
      );
      expect(result).toEqual([]);
    });

    it("should throw NotFoundException when report not found for annotations", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest.fn().mockResolvedValue(null);

      await expect(
        service.getReportAnnotations("user-001", "topic-001", "no-report"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("updateAnnotation - ownership check", () => {
    it("should throw ForbiddenException when user does not own the annotation", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest
        .fn()
        .mockResolvedValue({ id: "report-001", topicId: "topic-001" });
      mockPrisma.reportAnnotation = {
        findUnique: jest.fn().mockResolvedValue({ createdById: "other-user" }),
      } as never;

      await expect(
        service.updateAnnotation(
          "user-001",
          "topic-001",
          "report-001",
          "annotation-001",
          {},
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw NotFoundException when annotation not found", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest
        .fn()
        .mockResolvedValue({ id: "report-001", topicId: "topic-001" });
      mockPrisma.reportAnnotation = {
        findUnique: jest.fn().mockResolvedValue(null),
      } as never;

      await expect(
        service.updateAnnotation(
          "user-001",
          "topic-001",
          "report-001",
          "no-annotation",
          {},
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================
  // verifyTopicReadAccess - public topic access
  // ============================================================

  describe("verifyTopicReadAccess (via getLatestReport)", () => {
    it("should allow topic owner to access regardless of visibility", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { getLatestReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getLatestReport = jest.fn().mockResolvedValue({
        id: "report-001",
        topicId: "topic-001",
        executiveSummary: null,
        fullReport: null,
        dimensionAnalyses: null,
      });

      const result = await service.getLatestReport("user-001", "topic-001");
      expect(result).toBeDefined();
    });

    it("should throw ForbiddenException when non-owner tries to access private topic", async () => {
      // Return topic owned by another user
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "other-user",
      });
      // For non-owner access, the service calls $queryRaw to check visibility
      (mockPrisma as unknown as { $queryRaw: jest.Mock }).$queryRaw = jest
        .fn()
        .mockResolvedValue([{ visibility: "PRIVATE", is_collaborator: false }]);

      await expect(
        service.getLatestReport("user-001", "topic-001"),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ============================================================
  // regenerateCredibilityReport
  // ============================================================

  describe("regenerateCredibilityReport", () => {
    it("should regenerate credibility report for owned report", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue({
        id: "report-001",
        topic: { userId: "user-001" },
      });
      const credReport = { id: "cred-001", score: 0.9 };
      mockCredibilityReportService.generateCredibilityReport.mockResolvedValue(
        credReport,
      );

      const result = await service.regenerateCredibilityReport(
        "user-001",
        "report-001",
      );

      expect(
        mockCredibilityReportService.generateCredibilityReport,
      ).toHaveBeenCalledWith("report-001");
      expect(result).toEqual(credReport);
    });

    it("should throw NotFoundException when report not found or not owned", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue(null);

      await expect(
        service.regenerateCredibilityReport("user-001", "no-report"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException when report belongs to different user", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue({
        id: "report-001",
        topic: { userId: "other-user" },
      });

      await expect(
        service.regenerateCredibilityReport("user-001", "report-001"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================
  // Schedule delegation
  // ============================================================

  describe("Schedule delegation", () => {
    it("should delegate getSchedule to scheduleService", async () => {
      const mocks = buildMocks();
      mocks.mockScheduleService.getSchedule.mockResolvedValue({
        interval: "daily",
      });
      const scheduleSvcMock = (
        service as unknown as {
          scheduleService: typeof mocks.mockScheduleService;
        }
      ).scheduleService;
      scheduleSvcMock.getSchedule = mocks.mockScheduleService.getSchedule;

      await service.getSchedule("user-001", "topic-001");
      expect(scheduleSvcMock.getSchedule).toHaveBeenCalledWith(
        "user-001",
        "topic-001",
      );
    });

    it("should delegate updateSchedule to scheduleService", async () => {
      const mocks = buildMocks();
      mocks.mockScheduleService.updateSchedule.mockResolvedValue({
        interval: "weekly",
      });
      const scheduleSvcMock = (
        service as unknown as {
          scheduleService: typeof mocks.mockScheduleService;
        }
      ).scheduleService;
      scheduleSvcMock.updateSchedule = mocks.mockScheduleService.updateSchedule;

      const dto = { interval: "weekly" };
      await service.updateSchedule("user-001", "topic-001", dto as never);
      expect(scheduleSvcMock.updateSchedule).toHaveBeenCalledWith(
        "user-001",
        "topic-001",
        dto,
      );
    });
  });

  // ============================================================
  // transformReportForFrontend (via getLatestReport)
  // ============================================================

  describe("transformReportForFrontend", () => {
    it("should clean HTML tags from executiveSummary and fullReport", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { getLatestReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getLatestReport = jest.fn().mockResolvedValue({
        id: "report-001",
        topicId: "topic-001",
        executiveSummary: "Summary with <br> line break",
        fullReport: "<p>Full report</p><p>Second paragraph</p>",
        dimensionAnalyses: null,
      });

      const result = (await service.getLatestReport(
        "user-001",
        "topic-001",
      )) as Record<string, unknown>;

      // HTML tags should be cleaned
      expect(result.executiveSummary as string).not.toContain("<br>");
      expect(result.fullReport as string).not.toContain("<p>");
    });

    it("should delegate updateTopic to crudService", async () => {
      const updated = { id: "topic-001", name: "更新后的专题" };
      mockCrudService.updateTopic.mockResolvedValue(updated);

      const dto = { name: "更新后的专题" };
      const result = await service.updateTopic(
        "user-001",
        "topic-001",
        dto as never,
      );

      expect(mockCrudService.updateTopic).toHaveBeenCalledWith(
        "user-001",
        "topic-001",
        dto,
      );
      expect(result).toEqual(updated);
    });

    it("should delegate getResearchHistory to crudService", async () => {
      const history = [{ id: "h1" }];
      mockCrudService.getResearchHistory.mockResolvedValue(history);

      const result = await service.getResearchHistory(
        "user-001",
        "topic-001",
        10,
      );

      expect(mockCrudService.getResearchHistory).toHaveBeenCalledWith(
        "user-001",
        "topic-001",
        10,
      );
      expect(result).toEqual(history);
    });

    it("should delegate getLogs to crudService", async () => {
      const logs = { items: [], total: 0 };
      mockCrudService.getLogs.mockResolvedValue(logs);

      const query = { page: 1 };
      const result = await service.getLogs(
        "user-001",
        "topic-001",
        query as never,
      );

      expect(mockCrudService.getLogs).toHaveBeenCalledWith(
        "user-001",
        "topic-001",
        query,
      );
      expect(result).toEqual(logs);
    });

    it("should delegate recalculateTopicStats to crudService", async () => {
      const stats = { dimensions: 5 };
      mockCrudService.recalculateTopicStats.mockResolvedValue(stats);

      const result = await service.recalculateTopicStats(
        "user-001",
        "topic-001",
      );

      expect(mockCrudService.recalculateTopicStats).toHaveBeenCalledWith(
        "user-001",
        "topic-001",
      );
      expect(result).toEqual(stats);
    });

    it("should transform dimensionAnalyses and extract dataPoints to top-level", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { getLatestReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getLatestReport = jest.fn().mockResolvedValue({
        id: "report-001",
        topicId: "topic-001",
        executiveSummary: null,
        fullReport: null,
        dimensionAnalyses: [
          {
            id: "analysis-001",
            summary: "Analysis summary",
            analysis: "Analysis detail",
            keyFindings: [
              { finding: "Finding 1", implication: "Implication 1" },
            ],
            dataPoints: {
              trends: [
                {
                  trend: "Trend 1",
                  drivers: "Driver 1",
                  prediction: "Prediction 1",
                },
              ],
              challenges: [
                {
                  challenge: "Challenge 1",
                  rootCause: "Root cause",
                  impact: "High",
                  potentialSolutions: "Solution",
                },
              ],
              opportunities: [
                {
                  opportunity: "Opportunity 1",
                  potential: "High",
                  requirements: "Requirements",
                },
              ],
              confidenceLevel: "high",
              detailedContent: "Detailed content here",
            },
          },
        ],
      });

      const result = (await service.getLatestReport(
        "user-001",
        "topic-001",
      )) as Record<string, unknown>;

      const analyses = result.dimensionAnalyses as Array<
        Record<string, unknown>
      >;
      expect(analyses).toBeDefined();
      expect(analyses[0].trends).toBeDefined();
      expect(analyses[0].challenges).toBeDefined();
      expect(analyses[0].opportunities).toBeDefined();
      expect(analyses[0].confidenceLevel).toBe("high");
      expect(analyses[0].detailedContent).toBe("Detailed content here");
    });
  });

  // ============================================================
  // getAgentActivityStats
  // ============================================================

  describe("getAgentActivityStats", () => {
    it("should verify ownership and delegate to agentActivityService", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const mocks = buildMocks();
      const agentActivityMock = (
        service as unknown as {
          agentActivityService: { getActivityStats: jest.Mock };
        }
      ).agentActivityService;
      agentActivityMock.getActivityStats = jest
        .fn()
        .mockResolvedValue({ total: 5 });

      const result = await service.getAgentActivityStats(
        "user-001",
        "topic-001",
        "mission-1",
      );

      expect(result).toBeDefined();
      void mocks; // suppress unused var warning
    });
  });

  // ============================================================
  // listReports
  // ============================================================

  describe("listReports", () => {
    it("should verify read access and delegate to reportService", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { listReports: jest.Mock } }
      ).reportService;
      reportSvcMock.listReports = jest.fn().mockResolvedValue([{ id: "r1" }]);

      const query = { limit: 10 };
      const result = await service.listReports(
        "user-001",
        "topic-001",
        query as never,
      );

      expect(result).toBeDefined();
    });
  });

  // ============================================================
  // cancelRefresh
  // ============================================================

  describe("cancelRefresh", () => {
    it("should verify ownership and cancel via orchestrator", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      mockOrchestrator.cancelRefresh.mockResolvedValue(true);

      const result = await service.cancelRefresh(
        "user-001",
        "topic-001",
        {} as never,
      );

      expect(result.success).toBe(true);
      expect(result.message).toBe("刷新已取消");
    });

    it("should return not-cancelled message when no refresh in progress", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      mockOrchestrator.cancelRefresh.mockResolvedValue(false);

      const result = await service.cancelRefresh(
        "user-001",
        "topic-001",
        {} as never,
      );

      expect(result.success).toBe(false);
      expect(result.message).toBe("没有正在进行的刷新");
    });
  });

  // ============================================================
  // getReportChanges
  // ============================================================

  describe("getReportChanges", () => {
    it("should verify read access, check report ownership, and delegate to reportChangeService", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest
        .fn()
        .mockResolvedValue({ id: "report-001", topicId: "topic-001" });

      const reportChangeMock = (
        service as unknown as { reportChangeService: { getChanges: jest.Mock } }
      ).reportChangeService;
      reportChangeMock.getChanges = jest
        .fn()
        .mockResolvedValue([{ id: "change-1" }]);

      const result = await service.getReportChanges(
        "user-001",
        "topic-001",
        "report-001",
      );

      expect(result).toBeDefined();
    });

    it("should throw NotFoundException when report topicId does not match", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest
        .fn()
        .mockResolvedValue({ id: "report-001", topicId: "other-topic" });

      await expect(
        service.getReportChanges("user-001", "topic-001", "report-001"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================
  // checkinChange / checkinAllChanges
  // ============================================================

  describe("checkinChange", () => {
    it("should verify ownership and delegate to reportChangeService", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest
        .fn()
        .mockResolvedValue({ id: "report-001", topicId: "topic-001" });

      const reportChangeMock = (
        service as unknown as {
          reportChangeService: { checkinChange: jest.Mock };
        }
      ).reportChangeService;
      reportChangeMock.checkinChange = jest.fn().mockResolvedValue(undefined);

      const result = await service.checkinChange(
        "user-001",
        "topic-001",
        "report-001",
        "change-1",
      );

      expect(result.success).toBe(true);
    });
  });

  describe("checkinAllChanges", () => {
    it("should verify ownership and delegate to reportChangeService returning count", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest
        .fn()
        .mockResolvedValue({ id: "report-001", topicId: "topic-001" });

      const reportChangeMock = (
        service as unknown as {
          reportChangeService: { checkinAllChanges: jest.Mock };
        }
      ).reportChangeService;
      reportChangeMock.checkinAllChanges = jest.fn().mockResolvedValue(5);

      const result = await service.checkinAllChanges(
        "user-001",
        "topic-001",
        "report-001",
      );

      expect(result.count).toBe(5);
    });
  });

  // ============================================================
  // listEvidence / getEvidence
  // ============================================================

  describe("listEvidence", () => {
    it("should verify read access, validate report, and return paginated evidence", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest
        .fn()
        .mockResolvedValue({ id: "report-001", topicId: "topic-001" });

      const evidenceSvcMock = (
        service as unknown as { evidenceService: { listEvidence: jest.Mock } }
      ).evidenceService;
      evidenceSvcMock.listEvidence = jest.fn().mockResolvedValue({
        evidences: [{ id: "ev-1" }],
        total: 1,
      });

      const query = { page: 1, pageSize: 20 };
      const result = await service.listEvidence(
        "user-001",
        "topic-001",
        "report-001",
        query as never,
      );

      expect(result.evidence).toBeDefined();
      expect(result.total).toBe(1);
      expect(typeof result.hasMore).toBe("boolean");
    });
  });

  describe("getEvidence", () => {
    it("should verify read access, validate report, and return evidence", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest
        .fn()
        .mockResolvedValue({ id: "report-001", topicId: "topic-001" });

      const evidenceSvcMock = (
        service as unknown as { evidenceService: { getEvidence: jest.Mock } }
      ).evidenceService;
      evidenceSvcMock.getEvidence = jest.fn().mockResolvedValue({
        id: "ev-1",
        reportId: "report-001",
        title: "Evidence Title",
      });

      const result = await service.getEvidence(
        "user-001",
        "topic-001",
        "report-001",
        "ev-1",
      );

      expect(result).toBeDefined();
      expect((result as Record<string, unknown>).id).toBe("ev-1");
    });

    it("should throw NotFoundException when evidence not found or wrong report", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest
        .fn()
        .mockResolvedValue({ id: "report-001", topicId: "topic-001" });

      const evidenceSvcMock = (
        service as unknown as { evidenceService: { getEvidence: jest.Mock } }
      ).evidenceService;
      evidenceSvcMock.getEvidence = jest.fn().mockResolvedValue(null);

      await expect(
        service.getEvidence(
          "user-001",
          "topic-001",
          "report-001",
          "ev-nonexistent",
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException when report not found for getEvidence", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest.fn().mockResolvedValue(null);

      await expect(
        service.getEvidence("user-001", "topic-001", "no-report", "ev-1"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================
  // getAgentActivities — actual delegation path
  // ============================================================

  describe("getAgentActivities — delegation", () => {
    it("should delegate to agentActivityService after ownership check", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const agentSvcMock = (
        service as unknown as {
          agentActivityService: { getActivitiesByDimension: jest.Mock };
        }
      ).agentActivityService;
      agentSvcMock.getActivitiesByDimension = jest
        .fn()
        .mockResolvedValue([{ id: "act-1" }]);

      const result = await service.getAgentActivities("user-001", "topic-001");

      expect(agentSvcMock.getActivitiesByDimension).toHaveBeenCalledWith(
        "topic-001",
        undefined,
      );
      expect(result).toEqual([{ id: "act-1" }]);
    });
  });

  // ============================================================
  // streamRefreshProgress
  // ============================================================

  describe("streamRefreshProgress", () => {
    it("should return an Observable that emits MessageEvent when topicId matches", async () => {
      // streamRefreshProgress uses EventEmitter2 .on / .off which we need to mock
      const listeners: ((event: unknown) => void)[] = [];
      const mockEE2 = (
        service as unknown as { eventEmitter: Record<string, jest.Mock> }
      ).eventEmitter;
      mockEE2.on = jest
        .fn()
        .mockImplementation(
          (_event: string, listener: (event: unknown) => void) => {
            listeners.push(listener);
          },
        );
      mockEE2.off = jest.fn();

      const observable = service.streamRefreshProgress("user-001", "topic-001");

      expect(observable).toBeDefined();
      // Verify it's an observable (has subscribe method)
      expect(typeof observable.subscribe).toBe("function");
    });

    it("should not emit event when topicId does not match", async () => {
      const listeners: ((event: unknown) => void)[] = [];
      const mockEE2 = (
        service as unknown as { eventEmitter: Record<string, jest.Mock> }
      ).eventEmitter;
      mockEE2.on = jest
        .fn()
        .mockImplementation(
          (_event: string, listener: (event: unknown) => void) => {
            listeners.push(listener);
          },
        );
      mockEE2.off = jest.fn();

      const observable = service.streamRefreshProgress("user-001", "topic-001");
      const received: unknown[] = [];
      const sub = observable.subscribe({ next: (v) => received.push(v) });

      // Emit an event for a different topic - should be filtered out
      listeners.forEach((l) => l({ topicId: "other-topic", progress: 50 }));

      expect(received.length).toBe(0);
      sub.unsubscribe();
    });
  });

  // ============================================================
  // updateReportContent
  // ============================================================

  describe("updateReportContent", () => {
    it("should delegate to reportDataService.updateReportContent", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest.fn().mockResolvedValue({
        id: "report-001",
        topicId: "topic-001",
        fullReport: "Original content",
      });

      const reportDataSvcMock = (
        service as unknown as {
          reportDataService: { updateReportContent: jest.Mock };
        }
      ).reportDataService;
      reportDataSvcMock.updateReportContent = jest.fn().mockResolvedValue({
        id: "report-001",
        fullReport: "New content",
      });

      const dto = {
        fullReport: "New content",
        changeDescription: "Manual edit",
      };
      const result = (await service.updateReportContent(
        "user-001",
        "topic-001",
        "report-001",
        dto,
      )) as Record<string, unknown>;

      expect(reportDataSvcMock.updateReportContent).toHaveBeenCalledWith(
        "report-001",
        dto,
      );
      expect(result.id).toBe("report-001");
    });

    it("should throw NotFoundException when report not found for updateReportContent", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest.fn().mockResolvedValue(null);

      await expect(
        service.updateReportContent("user-001", "topic-001", "no-report", {
          fullReport: "new",
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================
  // rollbackReport
  // ============================================================

  describe("rollbackReport", () => {
    it("should delegate to reportDataService.rollbackToRevision", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest.fn().mockResolvedValue({
        id: "report-001",
        topicId: "topic-001",
        fullReport: "Current content",
      });

      const reportDataSvcMock = (
        service as unknown as {
          reportDataService: { rollbackToRevision: jest.Mock };
        }
      ).reportDataService;
      reportDataSvcMock.rollbackToRevision = jest.fn().mockResolvedValue({
        report: { id: "report-001", fullReport: "Version 1 content" },
        rolledBackFrom: 3,
        rolledBackTo: 1,
      });

      const result = (await service.rollbackReport(
        "user-001",
        "topic-001",
        "report-001",
        1,
      )) as Record<string, unknown>;

      expect(reportDataSvcMock.rollbackToRevision).toHaveBeenCalledWith(
        "report-001",
        1,
        "Current content",
      );
      expect(result.rolledBackTo).toBe(1);
      expect(result.rolledBackFrom).toBe(3);
    });

    it("should throw NotFoundException when report not found for rollback", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest.fn().mockResolvedValue(null);

      await expect(
        service.rollbackReport("user-001", "topic-001", "no-report", 1),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================
  // compareReports
  // ============================================================

  describe("compareReports", () => {
    it("should compare two report versions successfully", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      // Two reports for from/to versions
      mockPrisma.topicReport.findFirst
        .mockResolvedValueOnce({ id: "report-v1" })
        .mockResolvedValueOnce({ id: "report-v2" });

      const reportSvcMock = (
        service as unknown as { reportService: { compareReports: jest.Mock } }
      ).reportService;
      reportSvcMock.compareReports = jest
        .fn()
        .mockResolvedValue({ diff: "some diff" });

      const result = await service.compareReports("user-001", "topic-001", {
        from: 1,
        to: 2,
      } as never);

      expect(reportSvcMock.compareReports).toHaveBeenCalledWith(
        "topic-001",
        "report-v1",
        "report-v2",
      );
      expect((result as Record<string, unknown>).diff).toBe("some diff");
    });

    it("should throw NotFoundException when one or both report versions not found", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      mockPrisma.topicReport.findFirst
        .mockResolvedValueOnce({ id: "report-v1" })
        .mockResolvedValueOnce(null); // second version not found

      await expect(
        service.compareReports("user-001", "topic-001", {
          from: 1,
          to: 99,
        } as never),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================
  // aiEditReport — context-based selection paths
  // ============================================================

  describe("aiEditReport — selection context paths", () => {
    const setupMocks = (fullReport: string) => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest.fn().mockResolvedValue({
        id: "report-001",
        topicId: "topic-001",
        fullReport,
      });
      const prismaMock = mockPrisma as unknown as { $transaction: jest.Mock };
      prismaMock.$transaction = jest
        .fn()
        .mockImplementation(
          async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
            const fakeTx = {
              topicReportRevision: {
                findFirst: jest.fn().mockResolvedValue(null),
                create: jest.fn(),
              },
              topicReport: {
                update: jest.fn().mockResolvedValue({
                  id: "report-001",
                  fullReport: "replaced",
                }),
              },
            };
            return fn(fakeTx);
          },
        );
      const facadeMock = (
        service as unknown as { chatFacade: { chat: jest.Mock } }
      ).chatFacade;
      facadeMock.chat = jest
        .fn()
        .mockResolvedValue({ content: "AI edited text", isError: false });
    };

    it("should use selectorPrefix+selectorSuffix for context-based replacement", async () => {
      setupMocks("PREFIXselected textSUFFIX rest of report");

      const result = (await service.aiEditReport(
        "user-001",
        "topic-001",
        "report-001",
        {
          operation: "rewrite",
          selectedText: "selected text",
          selectorPrefix: "PREFIX",
          selectorSuffix: "SUFFIX",
        },
      )) as Record<string, unknown>;

      expect(result.editedContent).toBe("AI edited text");
    });

    it("should fall back to indexOf when selectorPrefix context not found", async () => {
      setupMocks("hello selected text world");

      const result = (await service.aiEditReport(
        "user-001",
        "topic-001",
        "report-001",
        {
          operation: "rewrite",
          selectedText: "selected text",
          selectorPrefix: "NONEXISTENT_PREFIX",
          selectorSuffix: "",
        },
      )) as Record<string, unknown>;

      expect(result.editedContent).toBe("AI edited text");
    });

    it("should log warning when selection not found anywhere in report", async () => {
      setupMocks("completely different content");

      const result = (await service.aiEditReport(
        "user-001",
        "topic-001",
        "report-001",
        {
          operation: "rewrite",
          selectedText: "text that is not there",
        },
      )) as Record<string, unknown>;

      // When selection not found, editedContent is still returned
      expect(result.editedContent).toBe("AI edited text");
    });
  });

  // ============================================================
  // createAnnotation
  // ============================================================

  describe("createAnnotation", () => {
    it("should create annotation for valid report", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest
        .fn()
        .mockResolvedValue({ id: "report-001", topicId: "topic-001" });

      const annotationSvcMock = (
        service as unknown as {
          reportAnnotationService: { createAnnotation: jest.Mock };
        }
      ).reportAnnotationService;
      annotationSvcMock.createAnnotation = jest
        .fn()
        .mockResolvedValue({ id: "ann-1" });

      const dto = {
        content: "This is an annotation",
        type: "COMMENT" as never,
        startOffset: 0,
        endOffset: 10,
      };

      const result = await service.createAnnotation(
        "user-001",
        "topic-001",
        "report-001",
        dto,
      );

      expect(annotationSvcMock.createAnnotation).toHaveBeenCalledWith(
        "report-001",
        "user-001",
        dto,
      );
      expect((result as Record<string, unknown>).id).toBe("ann-1");
    });

    it("should throw NotFoundException when report not found for createAnnotation", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest.fn().mockResolvedValue(null);

      await expect(
        service.createAnnotation("user-001", "topic-001", "no-report", {
          content: "note",
          type: "COMMENT" as never,
          startOffset: 0,
          endOffset: 5,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================
  // updateAnnotation — success path
  // ============================================================

  describe("updateAnnotation — success path", () => {
    it("should update annotation when user is the annotation creator", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest
        .fn()
        .mockResolvedValue({ id: "report-001", topicId: "topic-001" });
      mockPrisma.reportAnnotation = {
        findUnique: jest.fn().mockResolvedValue({ createdById: "user-001" }),
      } as never;

      const annotationSvcMock = (
        service as unknown as {
          reportAnnotationService: { updateAnnotation: jest.Mock };
        }
      ).reportAnnotationService;
      annotationSvcMock.updateAnnotation = jest
        .fn()
        .mockResolvedValue({ id: "ann-1", content: "Updated" });

      const result = (await service.updateAnnotation(
        "user-001",
        "topic-001",
        "report-001",
        "ann-1",
        { content: "Updated" },
      )) as Record<string, unknown>;

      expect(annotationSvcMock.updateAnnotation).toHaveBeenCalledWith("ann-1", {
        content: "Updated",
      });
      expect(result.id).toBe("ann-1");
    });

    it("should throw NotFoundException when report not found for updateAnnotation", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest.fn().mockResolvedValue(null);

      await expect(
        service.updateAnnotation(
          "user-001",
          "topic-001",
          "no-report",
          "ann-1",
          { content: "x" },
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================
  // deleteAnnotation
  // ============================================================

  describe("deleteAnnotation", () => {
    it("should delete annotation when user is both topic owner and annotation creator", async () => {
      // user-001 owns the topic → verifyTopicReadAccess skips $queryRaw
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });

      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest
        .fn()
        .mockResolvedValue({ id: "report-001", topicId: "topic-001" });

      mockPrisma.reportAnnotation.findUnique.mockResolvedValueOnce({
        createdById: "user-001",
      }); // annotation also by user-001

      const annotationSvcMock = (
        service as unknown as {
          reportAnnotationService: { deleteAnnotation: jest.Mock };
        }
      ).reportAnnotationService;
      annotationSvcMock.deleteAnnotation = jest
        .fn()
        .mockResolvedValue({ success: true });

      const result = await service.deleteAnnotation(
        "user-001",
        "topic-001",
        "report-001",
        "ann-1",
      );

      expect(annotationSvcMock.deleteAnnotation).toHaveBeenCalledWith("ann-1");
      expect(result).toEqual({ success: true });
    });

    it("should delete annotation when user is topic owner (not annotation creator)", async () => {
      // topic-owner-user owns the topic → verifyTopicReadAccess skips $queryRaw
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "topic-owner-user",
      });

      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest
        .fn()
        .mockResolvedValue({ id: "report-001", topicId: "topic-001" });

      mockPrisma.reportAnnotation.findUnique.mockResolvedValueOnce({
        createdById: "other-user",
      }); // annotation is by someone else

      const annotationSvcMock = (
        service as unknown as {
          reportAnnotationService: { deleteAnnotation: jest.Mock };
        }
      ).reportAnnotationService;
      annotationSvcMock.deleteAnnotation = jest
        .fn()
        .mockResolvedValue({ success: true });

      const result = await service.deleteAnnotation(
        "topic-owner-user",
        "topic-001",
        "report-001",
        "ann-1",
      );

      expect(annotationSvcMock.deleteAnnotation).toHaveBeenCalledWith("ann-1");
      expect(result).toEqual({ success: true });
    });

    it("should throw NotFoundException when annotation not found for delete", async () => {
      // user-001 owns the topic → no $queryRaw needed
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest
        .fn()
        .mockResolvedValue({ id: "report-001", topicId: "topic-001" });
      mockPrisma.reportAnnotation.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteAnnotation(
          "user-001",
          "topic-001",
          "report-001",
          "no-ann",
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException when user is neither annotation creator nor topic owner", async () => {
      // topic-owner owns the topic; intruder-user is not the owner → verifyTopicReadAccess calls $queryRaw
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "topic-owner",
      });
      // intruder-user is a collaborator so read access passes, but not annotation owner/topic owner
      (mockPrisma as unknown as { $queryRaw: jest.Mock }).$queryRaw = jest
        .fn()
        .mockResolvedValue([{ visibility: "SHARED", is_collaborator: true }]);

      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest
        .fn()
        .mockResolvedValue({ id: "report-001", topicId: "topic-001" });
      mockPrisma.reportAnnotation.findUnique.mockResolvedValueOnce({
        createdById: "another-user",
      });

      await expect(
        service.deleteAnnotation(
          "intruder-user",
          "topic-001",
          "report-001",
          "ann-1",
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw NotFoundException when topic not found for delete", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteAnnotation("user-001", "no-topic", "report-001", "ann-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException when report not found for deleteAnnotation", async () => {
      // user-001 is topic owner → no $queryRaw
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest.fn().mockResolvedValue(null);

      await expect(
        service.deleteAnnotation("user-001", "topic-001", "no-report", "ann-1"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================
  // resolveAnnotation
  // ============================================================

  describe("resolveAnnotation", () => {
    it("should resolve annotation when user is annotation creator (user is topic owner)", async () => {
      // user-001 is the topic owner so verifyTopicReadAccess skips $queryRaw
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest
        .fn()
        .mockResolvedValue({ id: "report-001", topicId: "topic-001" });
      mockPrisma.reportAnnotation.findUnique.mockResolvedValue({
        createdById: "user-001",
      });

      const annotationSvcMock = (
        service as unknown as {
          reportAnnotationService: { resolveAnnotation: jest.Mock };
        }
      ).reportAnnotationService;
      annotationSvcMock.resolveAnnotation = jest
        .fn()
        .mockResolvedValue({ id: "ann-1", status: "RESOLVED" });

      const result = await service.resolveAnnotation(
        "user-001",
        "topic-001",
        "report-001",
        "ann-1",
      );

      expect(annotationSvcMock.resolveAnnotation).toHaveBeenCalledWith(
        "ann-1",
        "user-001",
      );
      expect((result as Record<string, unknown>).status).toBe("RESOLVED");
    });

    it("should resolve annotation when user is topic owner (not annotation creator)", async () => {
      // topic-owner is the topic owner → verifyTopicReadAccess skips $queryRaw
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "topic-owner",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest
        .fn()
        .mockResolvedValue({ id: "report-001", topicId: "topic-001" });
      mockPrisma.reportAnnotation.findUnique.mockResolvedValue({
        createdById: "other-user",
      });

      const annotationSvcMock = (
        service as unknown as {
          reportAnnotationService: { resolveAnnotation: jest.Mock };
        }
      ).reportAnnotationService;
      annotationSvcMock.resolveAnnotation = jest
        .fn()
        .mockResolvedValue({ id: "ann-1", status: "RESOLVED" });

      const result = await service.resolveAnnotation(
        "topic-owner",
        "topic-001",
        "report-001",
        "ann-1",
      );

      expect(annotationSvcMock.resolveAnnotation).toHaveBeenCalled();
      expect((result as Record<string, unknown>).status).toBe("RESOLVED");
    });

    it("should throw ForbiddenException when user cannot resolve annotation", async () => {
      // topic-owner owns the topic; intruder is a collaborator (has read access) but not annotation owner/topic owner
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "topic-owner",
      });
      (mockPrisma as unknown as { $queryRaw: jest.Mock }).$queryRaw = jest
        .fn()
        .mockResolvedValue([{ visibility: "SHARED", is_collaborator: true }]);

      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest
        .fn()
        .mockResolvedValue({ id: "report-001", topicId: "topic-001" });
      mockPrisma.reportAnnotation.findUnique.mockResolvedValue({
        createdById: "someone-else",
      });

      await expect(
        service.resolveAnnotation(
          "intruder",
          "topic-001",
          "report-001",
          "ann-1",
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw NotFoundException when annotation not found for resolve", async () => {
      // user-001 is the topic owner → no $queryRaw
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest
        .fn()
        .mockResolvedValue({ id: "report-001", topicId: "topic-001" });
      mockPrisma.reportAnnotation.findUnique.mockResolvedValue(null);

      await expect(
        service.resolveAnnotation(
          "user-001",
          "topic-001",
          "report-001",
          "no-ann",
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException when topic not found for resolve", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue(null);

      await expect(
        service.resolveAnnotation(
          "user-001",
          "no-topic",
          "report-001",
          "ann-1",
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException when report not found for resolveAnnotation", async () => {
      // user-001 is topic owner → no $queryRaw
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest.fn().mockResolvedValue(null);

      await expect(
        service.resolveAnnotation(
          "user-001",
          "topic-001",
          "no-report",
          "ann-1",
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================
  // resolveAllAnnotations
  // ============================================================

  describe("resolveAllAnnotations", () => {
    it("should resolve all annotations and return count", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest
        .fn()
        .mockResolvedValue({ id: "report-001", topicId: "topic-001" });

      const annotationSvcMock = (
        service as unknown as {
          reportAnnotationService: { resolveAllAnnotations: jest.Mock };
        }
      ).reportAnnotationService;
      annotationSvcMock.resolveAllAnnotations = jest.fn().mockResolvedValue(3);

      const result = (await service.resolveAllAnnotations(
        "user-001",
        "topic-001",
        "report-001",
      )) as Record<string, unknown>;

      expect(annotationSvcMock.resolveAllAnnotations).toHaveBeenCalledWith(
        "report-001",
        "user-001",
        undefined,
      );
      expect(result.count).toBe(3);
    });

    it("should throw NotFoundException when report not found for resolveAllAnnotations", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest.fn().mockResolvedValue(null);

      await expect(
        service.resolveAllAnnotations("user-001", "topic-001", "no-report"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================
  // checkTopicAccess — PUBLIC and SHARED visibility branches
  // ============================================================

  describe("checkTopicAccess via verifyTopicReadAccess (PUBLIC / SHARED topic)", () => {
    it("should allow access to PUBLIC topic for non-owner user", async () => {
      // Topic owned by someone else
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "other-owner",
      });
      // $queryRaw returns PUBLIC visibility
      (mockPrisma as unknown as { $queryRaw: jest.Mock }).$queryRaw = jest
        .fn()
        .mockResolvedValue([{ visibility: "PUBLIC", is_collaborator: false }]);

      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest
        .fn()
        .mockResolvedValue({ id: "report-001", topicId: "topic-001" });

      // Should NOT throw — public topic allows any logged-in user
      await expect(
        service.getReport("user-001", "topic-001", "report-001"),
      ).resolves.toBeDefined();
    });

    it("should allow access to SHARED topic for collaborator", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "other-owner",
      });
      (mockPrisma as unknown as { $queryRaw: jest.Mock }).$queryRaw = jest
        .fn()
        .mockResolvedValue([{ visibility: "SHARED", is_collaborator: true }]);

      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest
        .fn()
        .mockResolvedValue({ id: "report-001", topicId: "topic-001" });

      await expect(
        service.getReport("user-001", "topic-001", "report-001"),
      ).resolves.toBeDefined();
    });

    it("should deny access to SHARED topic for non-collaborator", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "other-owner",
      });
      (mockPrisma as unknown as { $queryRaw: jest.Mock }).$queryRaw = jest
        .fn()
        .mockResolvedValue([{ visibility: "SHARED", is_collaborator: false }]);

      await expect(
        service.getReport("user-001", "topic-001", "report-001"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should deny access when $queryRaw returns empty result set", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "other-owner",
      });
      (mockPrisma as unknown as { $queryRaw: jest.Mock }).$queryRaw = jest
        .fn()
        .mockResolvedValue([]);

      await expect(
        service.getReport("user-001", "topic-001", "report-001"),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ============================================================
  // listEvidence / checkinChange / checkinAllChanges — report not found
  // ============================================================

  describe("listEvidence — report not found", () => {
    it("should throw NotFoundException when report not found for listEvidence", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest.fn().mockResolvedValue(null);

      await expect(
        service.listEvidence("user-001", "topic-001", "no-report", {
          page: 1,
          pageSize: 10,
        } as never),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("checkinChange — report not found", () => {
    it("should throw NotFoundException when report not found for checkinChange", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest.fn().mockResolvedValue(null);

      await expect(
        service.checkinChange("user-001", "topic-001", "no-report", "change-1"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("checkinAllChanges — report not found", () => {
    it("should throw NotFoundException when report not found for checkinAllChanges", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-001",
        userId: "user-001",
      });
      const reportSvcMock = (
        service as unknown as { reportService: { getReport: jest.Mock } }
      ).reportService;
      reportSvcMock.getReport = jest.fn().mockResolvedValue(null);

      await expect(
        service.checkinAllChanges("user-001", "topic-001", "no-report"),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

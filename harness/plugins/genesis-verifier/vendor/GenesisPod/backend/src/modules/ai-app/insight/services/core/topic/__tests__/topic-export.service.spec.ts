import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException, ForbiddenException } from "@nestjs/common";
import { TopicExportService } from "../topic-export.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ExportOrchestratorService } from "@/common/export/services/export-orchestrator.service";
import { ReportSynthesisService } from "../../../report/report-synthesis.service";
import { ExportFormat } from "@prisma/client";
import { ExportReportDto } from "../../../dto";

const mockPrisma = {
  researchTopic: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    $queryRaw: jest.fn(),
  },
  topicCollaborator: {
    count: jest.fn(),
  },
  topicReport: {
    findFirst: jest.fn(),
    count: jest.fn(),
  },
  $queryRaw: jest.fn(),
};

const mockExportOrchestrator = {
  createExportJob: jest.fn(),
};

const mockReportService = {
  getReport: jest.fn(),
};

const baseTopic = {
  id: "topic-1",
  userId: "user-1",
  name: "Test Topic",
  visibility: "PRIVATE",
  dimensions: [],
  lastRefreshAt: null,
  totalSources: 0,
};

const baseReport = {
  id: "report-1",
  topicId: "topic-1",
  version: 1,
  dimensionAnalyses: [
    {
      analysis: "Some analysis",
      summary: "Summary",
      dataPoints: null,
      keyFindings: [],
    },
  ],
  executiveSummary: "Executive summary",
  fullReport: "Full report content",
};

describe("TopicExportService", () => {
  let service: TopicExportService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TopicExportService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: ExportOrchestratorService,
          useValue: mockExportOrchestrator,
        },
        { provide: ReportSynthesisService, useValue: mockReportService },
      ],
    }).compile();

    service = module.get<TopicExportService>(TopicExportService);
    jest.clearAllMocks();
  });

  describe("exportReport", () => {
    it("should create a PDF export job for authorized user", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        userId: "user-1",
      });
      mockReportService.getReport.mockResolvedValue(baseReport);
      mockExportOrchestrator.createExportJob.mockResolvedValue({
        jobId: "job-1",
        status: "PENDING",
        downloadUrl: null,
      });

      const dto: ExportReportDto = { format: "pdf" };
      const result = await service.exportReport(
        "user-1",
        "topic-1",
        "report-1",
        dto,
      );

      expect(result).toHaveProperty("jobId", "job-1");
      expect(mockExportOrchestrator.createExportJob).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({
          format: ExportFormat.PDF,
          source: expect.objectContaining({ reportId: "report-1" }),
        }),
      );
    });

    it("should create a DOCX export job", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        userId: "user-1",
      });
      mockReportService.getReport.mockResolvedValue(baseReport);
      mockExportOrchestrator.createExportJob.mockResolvedValue({
        jobId: "job-2",
        status: "PENDING",
        downloadUrl: null,
      });

      const dto: ExportReportDto = { format: "docx" };
      await service.exportReport("user-1", "topic-1", "report-1", dto);

      expect(mockExportOrchestrator.createExportJob).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({ format: ExportFormat.DOCX }),
      );
    });

    it("should return downloadUrl directly when job is already completed", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        userId: "user-1",
      });
      mockReportService.getReport.mockResolvedValue(baseReport);
      mockExportOrchestrator.createExportJob.mockResolvedValue({
        jobId: "job-1",
        status: "COMPLETED",
        downloadUrl: "https://example.com/report.pdf",
        fileName: "report.pdf",
        fileSize: 12345,
      });

      const dto: ExportReportDto = { format: "pdf" };
      const result = await service.exportReport(
        "user-1",
        "topic-1",
        "report-1",
        dto,
      );

      expect(result).toHaveProperty(
        "downloadUrl",
        "https://example.com/report.pdf",
      );
      expect(result).not.toHaveProperty("jobId");
    });

    it("should throw NotFoundException when topic not found", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue(null);

      const dto: ExportReportDto = { format: "pdf" };
      await expect(
        service.exportReport("user-1", "bad-topic", "report-1", dto),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException when user is not the owner", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        userId: "other-user",
      });

      const dto: ExportReportDto = { format: "pdf" };
      await expect(
        service.exportReport("user-1", "topic-1", "report-1", dto),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw NotFoundException when report not found", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        userId: "user-1",
      });
      mockReportService.getReport.mockResolvedValue(null);

      const dto: ExportReportDto = { format: "pdf" };
      await expect(
        service.exportReport("user-1", "topic-1", "report-1", dto),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException when report belongs to different topic", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        userId: "user-1",
      });
      mockReportService.getReport.mockResolvedValue({
        ...baseReport,
        topicId: "other-topic",
      });

      const dto: ExportReportDto = { format: "pdf" };
      await expect(
        service.exportReport("user-1", "topic-1", "report-1", dto),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("updateVisibility", () => {
    it("should update topic visibility to PUBLIC", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue(baseTopic);
      mockPrisma.researchTopic.update.mockResolvedValue({
        id: "topic-1",
        name: "Test Topic",
        visibility: "PUBLIC",
      });

      const result = await service.updateVisibility(
        "user-1",
        "topic-1",
        "PUBLIC",
      );

      expect(result.success).toBe(true);
      expect(result.visibility).toBe("PUBLIC");
      expect(mockPrisma.researchTopic.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { visibility: "PUBLIC" },
        }),
      );
    });

    it("should throw NotFoundException when topic not found or user lacks access", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue(null);

      await expect(
        service.updateVisibility("user-x", "topic-1", "PUBLIC"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("getSharingSettings", () => {
    it("should return sharing settings including collaborator count", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue(baseTopic);
      mockPrisma.topicCollaborator.count.mockResolvedValue(3);
      mockPrisma.$queryRaw.mockResolvedValue([{ visibility: "SHARED" }]);

      const result = await service.getSharingSettings("user-1", "topic-1");

      expect(result.topicId).toBe("topic-1");
      expect(result.collaboratorCount).toBe(3);
      expect(result.visibility).toBe("SHARED");
    });

    it("should include publicLink when visibility is PUBLIC", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue({
        ...baseTopic,
        visibility: "PUBLIC",
      });
      mockPrisma.topicCollaborator.count.mockResolvedValue(0);
      mockPrisma.$queryRaw.mockResolvedValue([{ visibility: "PUBLIC" }]);

      const result = await service.getSharingSettings("user-1", "topic-1");

      expect(result.publicLink).toBe(`/shared/topics/topic-1`);
    });

    it("should throw NotFoundException when topic not accessible", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue(null);

      await expect(
        service.getSharingSettings("user-x", "topic-1"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("getSharedTopic", () => {
    it("should return public topic with report count", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        ...baseTopic,
        visibility: "PUBLIC",
      });
      mockPrisma.topicReport.count.mockResolvedValue(2);
      mockPrisma.topicReport.findFirst.mockResolvedValue({
        id: "report-1",
        version: 1,
        totalSources: 15,
        generatedAt: new Date(),
      });

      const result = await service.getSharedTopic("topic-1");

      expect(result.id).toBe("topic-1");
      expect(result.totalReports).toBe(2);
      expect(result.totalSources).toBe(15);
    });

    it("should throw NotFoundException when topic not found", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue(null);

      await expect(service.getSharedTopic("bad-topic")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw NotFoundException when topic is not PUBLIC", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        ...baseTopic,
        visibility: "PRIVATE",
      });

      await expect(service.getSharedTopic("topic-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("getSharedTopicLatestReport", () => {
    it("should return latest completed report for public topic", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-1",
        name: "Test Topic",
        visibility: "PUBLIC",
      });
      mockPrisma.topicReport.findFirst.mockResolvedValue({
        ...baseReport,
        topic: {
          id: "topic-1",
          name: "Test Topic",
          type: "TECHNOLOGY",
          description: "",
        },
        dimensionAnalyses: [],
      });

      const result = await service.getSharedTopicLatestReport("topic-1");

      expect(result).toBeDefined();
      expect(mockPrisma.topicReport.findFirst).toHaveBeenCalledTimes(1);
    });

    it("should throw NotFoundException when no completed reports exist", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-1",
        name: "Test Topic",
        visibility: "PUBLIC",
      });
      mockPrisma.topicReport.findFirst.mockResolvedValue(null);

      await expect(
        service.getSharedTopicLatestReport("topic-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException when topic is not PUBLIC", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-1",
        name: "Private Topic",
        visibility: "PRIVATE",
      });

      await expect(
        service.getSharedTopicLatestReport("topic-1"),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

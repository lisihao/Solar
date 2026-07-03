import { Test, TestingModule } from "@nestjs/testing";
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { ReportsService } from "../reports.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { ExportOrchestratorService } from "../../../../../common/export";
import { ExportFormat } from "@prisma/client";

// Mock axios module
jest.mock("axios");
import axios from "axios";
const mockAxios = axios as jest.Mocked<typeof axios>;

const mockPrismaService = {
  reportTemplate: {
    findUnique: jest.fn(),
  },
  report: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
  },
  resource: {
    findMany: jest.fn(),
  },
  workspaceTask: {
    findUnique: jest.fn(),
  },
};

const mockExportOrchestrator = {
  createExportJob: jest.fn(),
  getJobStatus: jest.fn(),
  getExportFile: jest.fn(),
};

describe("ReportsService", () => {
  let service: ReportsService;

  const mockTemplate = {
    id: "tmpl-1",
    name: "Comparison Report",
    category: "comparison",
    promptConfig: {},
    version: 1,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService, useValue: mockPrismaService },
        {
          provide: ExportOrchestratorService,
          useValue: mockExportOrchestrator,
        },
      ],
    }).compile();

    service = module.get<ReportsService>(ReportsService);
  });

  // ─── generateReport – validation ─────────────────────────────────

  describe("generateReport – validation", () => {
    it("throws BadRequestException when templateId is missing", async () => {
      await expect(
        service.generateReport({ userId: "u1" } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when templateId is invalid", async () => {
      mockPrismaService.reportTemplate.findUnique.mockResolvedValue(null);

      await expect(
        service.generateReport({ templateId: "bad-id", userId: "u1" } as any),
      ).rejects.toThrow(new BadRequestException("Invalid templateId"));
    });

    it("throws BadRequestException when fewer than 2 resources provided", async () => {
      mockPrismaService.reportTemplate.findUnique.mockResolvedValue(
        mockTemplate,
      );

      await expect(
        service.generateReport({
          templateId: "tmpl-1",
          userId: "u1",
          resourceIds: ["only-one"],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when more than 10 resources provided", async () => {
      mockPrismaService.reportTemplate.findUnique.mockResolvedValue(
        mockTemplate,
      );
      const resourceIds = Array.from({ length: 11 }, (_, i) => `res-${i}`);

      await expect(
        service.generateReport({
          templateId: "tmpl-1",
          userId: "u1",
          resourceIds,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── generateReport – from resources ─────────────────────────────

  describe("generateReport – from resources", () => {
    it("generates report successfully from resources via AI service", async () => {
      mockPrismaService.reportTemplate.findUnique.mockResolvedValue(
        mockTemplate,
      );
      mockPrismaService.resource.findMany.mockResolvedValue([
        {
          id: "r1",
          type: "PAPER",
          title: "Paper 1",
          abstract: null,
          authors: [],
          publishedAt: null,
          tags: [],
          pdfUrl: null,
          sourceUrl: "https://x.com",
        },
        {
          id: "r2",
          type: "PAPER",
          title: "Paper 2",
          abstract: null,
          authors: [],
          publishedAt: null,
          tags: [],
          pdfUrl: null,
          sourceUrl: "https://y.com",
        },
      ]);

      const aiReport = {
        title: "AI Report Title",
        summary: "Summary text",
        sections: [{ title: "Intro", content: "Content" }],
        metadata: { extra: "data" },
      };

      mockAxios.post = jest.fn().mockResolvedValue({ data: aiReport });
      mockPrismaService.report.create.mockResolvedValue({
        id: "report-1",
        title: aiReport.title,
      });

      const result = await service.generateReport({
        templateId: "tmpl-1",
        userId: "u1",
        resourceIds: ["r1", "r2"],
      });

      expect(result).toEqual({ id: "report-1", title: aiReport.title });
      expect(mockPrismaService.report.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "u1",
            title: aiReport.title,
            summary: aiReport.summary,
          }),
        }),
      );
    });

    it("throws BadRequestException when AI service fails", async () => {
      mockPrismaService.reportTemplate.findUnique.mockResolvedValue(
        mockTemplate,
      );
      mockPrismaService.resource.findMany.mockResolvedValue([
        { id: "r1" },
        { id: "r2" },
      ] as any);

      mockAxios.post = jest
        .fn()
        .mockRejectedValue(new Error("AI service down"));

      await expect(
        service.generateReport({
          templateId: "tmpl-1",
          userId: "u1",
          resourceIds: ["r1", "r2"],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when some resources not found", async () => {
      mockPrismaService.reportTemplate.findUnique.mockResolvedValue(
        mockTemplate,
      );
      // Only one resource returned when two were requested
      mockPrismaService.resource.findMany.mockResolvedValue([
        { id: "r1" },
      ] as any);

      await expect(
        service.generateReport({
          templateId: "tmpl-1",
          userId: "u1",
          resourceIds: ["r1", "r2"],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("uses template.id as fallback for templateId via dto.template field", async () => {
      mockPrismaService.reportTemplate.findUnique.mockResolvedValue(
        mockTemplate,
      );
      mockPrismaService.resource.findMany.mockResolvedValue([
        {
          id: "r1",
          type: "PAPER",
          title: "P1",
          abstract: null,
          authors: [],
          publishedAt: null,
          tags: [],
          pdfUrl: null,
          sourceUrl: "",
        },
        {
          id: "r2",
          type: "PAPER",
          title: "P2",
          abstract: null,
          authors: [],
          publishedAt: null,
          tags: [],
          pdfUrl: null,
          sourceUrl: "",
        },
      ]);
      const aiReport = { title: "T", summary: "S", sections: [] };
      mockAxios.post = jest.fn().mockResolvedValue({ data: aiReport });
      mockPrismaService.report.create.mockResolvedValue({ id: "r" });

      // Use dto.template instead of dto.templateId
      await service.generateReport({
        template: "tmpl-1",
        userId: "u1",
        resourceIds: ["r1", "r2"],
      } as any);

      expect(mockPrismaService.reportTemplate.findUnique).toHaveBeenCalledWith({
        where: { id: "tmpl-1" },
      });
    });
  });

  // ─── generateReport – from workspace task ────────────────────────

  describe("generateReport – from workspace task", () => {
    it("generates report from workspace task successfully", async () => {
      mockPrismaService.reportTemplate.findUnique.mockResolvedValue(
        mockTemplate,
      );
      mockPrismaService.workspaceTask.findUnique.mockResolvedValue({
        id: "task-1",
        model: "gpt-4",
        result: {
          summary: "Task summary",
          sections: [{ title: "S1", content: "C1" }],
        },
        workspaceId: "ws-1",
        workspace: {
          userId: "u1",
          resources: [{ resourceId: "r1" }, { resourceId: "r2" }],
        },
      });
      mockPrismaService.report.create.mockResolvedValue({
        id: "rep-from-task",
      });

      const result = await service.generateReport({
        templateId: "tmpl-1",
        userId: "u1",
        taskId: "task-1",
      });

      expect(result).toEqual({ id: "rep-from-task" });
    });

    it("throws NotFoundException when task not found", async () => {
      mockPrismaService.reportTemplate.findUnique.mockResolvedValue(
        mockTemplate,
      );
      mockPrismaService.workspaceTask.findUnique.mockResolvedValue(null);

      await expect(
        service.generateReport({
          templateId: "tmpl-1",
          userId: "u1",
          taskId: "bad-task",
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws ForbiddenException when task belongs to another user", async () => {
      mockPrismaService.reportTemplate.findUnique.mockResolvedValue(
        mockTemplate,
      );
      mockPrismaService.workspaceTask.findUnique.mockResolvedValue({
        workspace: { userId: "other-user", resources: [] },
        result: {},
      });

      await expect(
        service.generateReport({
          templateId: "tmpl-1",
          userId: "u1",
          taskId: "task-1",
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("throws BadRequestException when task has no result", async () => {
      mockPrismaService.reportTemplate.findUnique.mockResolvedValue(
        mockTemplate,
      );
      mockPrismaService.workspaceTask.findUnique.mockResolvedValue({
        workspace: { userId: "u1", resources: [] },
        result: null,
      });

      await expect(
        service.generateReport({
          templateId: "tmpl-1",
          userId: "u1",
          taskId: "task-1",
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── findOne ─────────────────────────────────────────────────────

  describe("findOne", () => {
    it("returns report with resources", async () => {
      mockPrismaService.report.findUnique.mockResolvedValue({
        id: "rep-1",
        userId: "u1",
        resourceIds: ["r1"],
        user: { id: "u1", username: "test", fullName: null, avatarUrl: null },
      });
      mockPrismaService.resource.findMany.mockResolvedValue([
        { id: "r1", title: "Resource 1" },
      ]);

      const result = await service.findOne("rep-1");
      expect(result.id).toBe("rep-1");
      expect(result.resources).toHaveLength(1);
    });

    it("returns report with empty resources when resourceIds is empty", async () => {
      mockPrismaService.report.findUnique.mockResolvedValue({
        id: "rep-1",
        userId: "u1",
        resourceIds: [],
        user: {},
      });

      const result = await service.findOne("rep-1");
      expect(result.resources).toHaveLength(0);
      expect(mockPrismaService.resource.findMany).not.toHaveBeenCalled();
    });

    it("throws NotFoundException when report does not exist", async () => {
      mockPrismaService.report.findUnique.mockResolvedValue(null);

      await expect(service.findOne("missing")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws NotFoundException when userId does not match", async () => {
      mockPrismaService.report.findUnique.mockResolvedValue({
        id: "rep-1",
        userId: "other-user",
        resourceIds: [],
        user: {},
      });

      await expect(service.findOne("rep-1", "u1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── findByUser ───────────────────────────────────────────────────

  describe("findByUser", () => {
    it("returns paginated reports for user", async () => {
      mockPrismaService.report.findMany.mockResolvedValue([
        { id: "r1", title: "Report 1" },
      ]);
      mockPrismaService.report.count.mockResolvedValue(1);

      const result = await service.findByUser("u1", 1, 20);

      expect(result.reports).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
      expect(result.pagination.totalPages).toBe(1);
    });

    it("calculates correct pagination skip value", async () => {
      mockPrismaService.report.findMany.mockResolvedValue([]);
      mockPrismaService.report.count.mockResolvedValue(50);

      await service.findByUser("u1", 3, 10);

      expect(mockPrismaService.report.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });

    it("calculates correct totalPages for fractional division", async () => {
      mockPrismaService.report.findMany.mockResolvedValue([]);
      mockPrismaService.report.count.mockResolvedValue(25);

      const result = await service.findByUser("u1", 1, 10);

      expect(result.pagination.totalPages).toBe(3);
    });
  });

  // ─── delete ───────────────────────────────────────────────────────

  describe("delete", () => {
    it("deletes report when user owns it", async () => {
      mockPrismaService.report.findUnique.mockResolvedValue({ userId: "u1" });
      mockPrismaService.report.delete.mockResolvedValue({});

      const result = await service.delete("rep-1", "u1");

      expect(result.message).toBe("Report deleted successfully");
      expect(mockPrismaService.report.delete).toHaveBeenCalledWith({
        where: { id: "rep-1" },
      });
    });

    it("throws NotFoundException when report not found", async () => {
      mockPrismaService.report.findUnique.mockResolvedValue(null);

      await expect(service.delete("missing", "u1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws BadRequestException when user does not own report", async () => {
      mockPrismaService.report.findUnique.mockResolvedValue({
        userId: "other-user",
      });

      await expect(service.delete("rep-1", "u1")).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ─── exportDocument ───────────────────────────────────────────────

  describe("exportDocument", () => {
    const buildMockRes = () => ({
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn(),
      setHeader: jest.fn(),
    });

    it("returns 400 when required fields are missing", async () => {
      const res = buildMockRes() as any;
      await service.exportDocument(
        { format: "", content: "", title: "" },
        res,
        "u1",
      );
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("returns 400 for unsupported format", async () => {
      const res = buildMockRes() as any;
      await service.exportDocument(
        { format: "excel", content: "content", title: "Title" },
        res,
        "u1",
      );
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("exports document successfully when job completes", async () => {
      const res = buildMockRes() as any;

      mockExportOrchestrator.createExportJob.mockResolvedValue({
        jobId: "job-1",
        status: "PENDING",
      });
      mockExportOrchestrator.getJobStatus.mockResolvedValue({
        jobId: "job-1",
        status: "COMPLETED",
      });
      mockExportOrchestrator.getExportFile.mockResolvedValue({
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        fileName: "report.docx",
        buffer: Buffer.from("fake-docx"),
      });

      await service.exportDocument(
        { format: "word", content: "## Title\nContent", title: "My Report" },
        res,
        "u1",
      );

      expect(mockExportOrchestrator.createExportJob).toHaveBeenCalledWith(
        "u1",
        expect.objectContaining({ format: ExportFormat.DOCX }),
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        "Content-Disposition",
        expect.stringContaining("report.docx"),
      );
      expect(res.send).toHaveBeenCalledWith(Buffer.from("fake-docx"));
    });

    it("returns 500 when export job fails", async () => {
      const res = buildMockRes() as any;

      mockExportOrchestrator.createExportJob.mockResolvedValue({
        jobId: "job-1",
        status: "PENDING",
      });
      mockExportOrchestrator.getJobStatus.mockResolvedValue({
        jobId: "job-1",
        status: "FAILED",
        error: "Conversion failed",
      });

      await service.exportDocument(
        { format: "pdf", content: "content", title: "Title" },
        res,
        "u1",
      );

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});

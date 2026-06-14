/**
 * ReportDataService - CRUD Operations Supplemental Tests
 *
 * Covers uncovered lines:
 * - line 101: InternalServerErrorException after max retries exceeded
 * - line 679-688: deleteReportCascade
 * - lines 693-736: updateReportContent
 * - lines 741-753: getReportRevisions
 * - lines 759-805: rollbackToRevision (found + not found)
 * - lines 811-842: saveAiEditRevision
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { ReportDataService } from "../report-data.service";
import { PrismaService } from "@/common/prisma/prisma.service";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function makeMockPrisma() {
  const tx = {
    dimensionAnalysis: { deleteMany: jest.fn().mockResolvedValue({}) },
    topicReportRevision: {
      deleteMany: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn(),
      create: jest.fn().mockResolvedValue({}),
    },
    reportAnnotation: { deleteMany: jest.fn().mockResolvedValue({}) },
    reportChange: { deleteMany: jest.fn().mockResolvedValue({}) },
    topicReport: {
      delete: jest.fn().mockResolvedValue({}),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
  };

  return {
    topicReport: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    topicReportRevision: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn().mockResolvedValue({}),
    },
    dimensionAnalysis: { create: jest.fn(), findMany: jest.fn() },
    topicEvidence: {
      updateMany: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest
      .fn()
      .mockImplementation(async (fn: (tx: typeof tx) => unknown) => fn(tx)),
    _tx: tx, // expose for assertions
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("ReportDataService (CRUD supplemental)", () => {
  let service: ReportDataService;
  let mockPrisma: ReturnType<typeof makeMockPrisma>;

  beforeEach(async () => {
    mockPrisma = makeMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportDataService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ReportDataService>(ReportDataService);
    jest.clearAllMocks();
  });

  // ─────────────────────────── createDraftReport: max retries ──────────────

  describe("createDraftReport: max retries exceeded", () => {
    it("should throw InternalServerErrorException when maxRetries is 0", async () => {
      // When maxRetries = 0, the for loop never executes, and line 101 is reached directly
      mockPrisma.topicReport.findFirst.mockResolvedValue(null);
      mockPrisma.topicReport.create.mockResolvedValue({ id: "r1" });

      await expect(service.createDraftReport("topic-001", 0)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // ─────────────────────────── deleteReportCascade ────────────────────────

  describe("deleteReportCascade", () => {
    it("should delete all cascade data within a transaction", async () => {
      const tx = mockPrisma._tx;

      await service.deleteReportCascade("report-001");

      expect(tx.dimensionAnalysis.deleteMany).toHaveBeenCalledWith({
        where: { reportId: "report-001" },
      });
      expect(tx.topicReportRevision.deleteMany).toHaveBeenCalledWith({
        where: { reportId: "report-001" },
      });
      expect(tx.reportAnnotation.deleteMany).toHaveBeenCalledWith({
        where: { reportId: "report-001" },
      });
      expect(tx.reportChange.deleteMany).toHaveBeenCalledWith({
        where: { reportId: "report-001" },
      });
      expect(tx.topicReport.delete).toHaveBeenCalledWith({
        where: { id: "report-001" },
      });
    });
  });

  // ─────────────────────────── updateReportContent ───────────────────────

  describe("updateReportContent", () => {
    it("should create a revision and update report content", async () => {
      const tx = mockPrisma._tx;
      const updatedReport = { id: "report-001", fullReport: "New content" };

      tx.topicReportRevision.findFirst.mockResolvedValue({
        revisionNumber: 2,
      });
      tx.topicReport.findUniqueOrThrow.mockResolvedValue({
        fullReport: "Old content",
      });
      tx.topicReport.update.mockResolvedValue(updatedReport);

      const result = await service.updateReportContent("report-001", {
        fullReport: "New content",
        executiveSummary: "New summary",
        changeDescription: "Updated by user",
      });

      expect(tx.topicReportRevision.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reportId: "report-001",
            revisionNumber: 3, // 2 + 1
            content: "Old content",
            changeDescription: "Updated by user",
            editedBy: "user",
          }),
        }),
      );
      expect(tx.topicReport.update).toHaveBeenCalledWith({
        where: { id: "report-001" },
        data: expect.objectContaining({
          executiveSummary: "New summary",
          fullReport: "New content",
        }),
      });
      expect(result).toBe(updatedReport);
    });

    it("should use default changeDescription when not provided", async () => {
      const tx = mockPrisma._tx;

      tx.topicReportRevision.findFirst.mockResolvedValue(null); // No previous revisions
      tx.topicReport.findUniqueOrThrow.mockResolvedValue({
        fullReport: "Current content",
      });
      tx.topicReport.update.mockResolvedValue({ id: "report-001" });

      await service.updateReportContent("report-001", {
        fullReport: "New content",
      });

      expect(tx.topicReportRevision.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            revisionNumber: 1, // 0 + 1 when no previous revisions
            changeDescription: "用户手动编辑", // default
          }),
        }),
      );
    });

    it("should only update non-undefined fields", async () => {
      const tx = mockPrisma._tx;

      tx.topicReportRevision.findFirst.mockResolvedValue(null);
      tx.topicReport.findUniqueOrThrow.mockResolvedValue({
        fullReport: "Current",
      });
      tx.topicReport.update.mockResolvedValue({ id: "report-001" });

      await service.updateReportContent("report-001", {
        executiveSummary: "Only summary update",
        // fullReport not provided
      });

      const updateCall = tx.topicReport.update.mock.calls[0][0];
      expect(updateCall.data).not.toHaveProperty("fullReport");
      expect(updateCall.data).toHaveProperty(
        "executiveSummary",
        "Only summary update",
      );
    });
  });

  // ─────────────────────────── getReportRevisions ───────────────────────

  describe("getReportRevisions", () => {
    it("should return revisions ordered by revisionNumber desc", async () => {
      const mockRevisions = [
        {
          id: "rev-002",
          revisionNumber: 2,
          changeDescription: "Edit 2",
          editedBy: "user",
          editOperation: "manual_edit",
          createdAt: new Date(),
        },
        {
          id: "rev-001",
          revisionNumber: 1,
          changeDescription: "Edit 1",
          editedBy: "user",
          editOperation: "manual_edit",
          createdAt: new Date(),
        },
      ];
      mockPrisma.topicReportRevision.findMany.mockResolvedValue(mockRevisions);

      const result = await service.getReportRevisions("report-001");

      expect(mockPrisma.topicReportRevision.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reportId: "report-001" },
          orderBy: { revisionNumber: "desc" },
          select: expect.objectContaining({
            id: true,
            revisionNumber: true,
            changeDescription: true,
          }),
        }),
      );
      expect(result).toBe(mockRevisions);
    });

    it("should return empty array when no revisions found", async () => {
      mockPrisma.topicReportRevision.findMany.mockResolvedValue([]);

      const result = await service.getReportRevisions("report-001");

      expect(result).toEqual([]);
    });
  });

  // ─────────────────────────── rollbackToRevision ───────────────────────

  describe("rollbackToRevision", () => {
    it("should throw NotFoundException when target revision not found", async () => {
      mockPrisma.topicReportRevision.findFirst.mockResolvedValue(null);

      await expect(
        service.rollbackToRevision("report-001", 5, "current content"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should create a backup revision and rollback to target", async () => {
      const targetRevision = {
        id: "rev-001",
        revisionNumber: 1,
        content: "Version 1 content",
      };

      // First findFirst: target revision
      // Second findFirst: latest revision for new revision number
      mockPrisma.topicReportRevision.findFirst
        .mockResolvedValueOnce(targetRevision)
        .mockResolvedValueOnce({ revisionNumber: 3 });

      const updatedReport = {
        id: "report-001",
        fullReport: "Version 1 content",
      };
      mockPrisma.topicReport.update.mockResolvedValue(updatedReport);

      const result = await service.rollbackToRevision(
        "report-001",
        1,
        "Current pre-rollback content",
      );

      // Should create a backup revision with the current content
      expect(mockPrisma.topicReportRevision.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          reportId: "report-001",
          revisionNumber: 4, // 3 + 1
          content: "Current pre-rollback content",
          editOperation: "rollback",
        }),
      });

      // Should update report to target revision's content
      expect(mockPrisma.topicReport.update).toHaveBeenCalledWith({
        where: { id: "report-001" },
        data: { fullReport: "Version 1 content" },
      });

      expect(result.rolledBackTo).toBe(1);
      expect(result.rolledBackFrom).toBe(3); // newRevisionNumber - 1
      expect(result.report).toBe(updatedReport);
    });

    it("should handle rollback when no previous revisions exist", async () => {
      const targetRevision = {
        id: "rev-001",
        revisionNumber: 1,
        content: "Initial content",
      };

      mockPrisma.topicReportRevision.findFirst
        .mockResolvedValueOnce(targetRevision)
        .mockResolvedValueOnce(null); // No latest revision

      mockPrisma.topicReport.update.mockResolvedValue({
        id: "report-001",
        fullReport: "Initial content",
      });

      const result = await service.rollbackToRevision(
        "report-001",
        1,
        "Current content",
      );

      // newRevisionNumber = (0) + 1 = 1
      expect(result.rolledBackFrom).toBe(0); // 1 - 1
      expect(result.rolledBackTo).toBe(1);
    });
  });

  // ─────────────────────────── saveAiEditRevision ───────────────────────

  describe("saveAiEditRevision", () => {
    it("should create revision and update report in transaction", async () => {
      const tx = mockPrisma._tx;
      const updatedReport = {
        id: "report-001",
        fullReport: "AI-edited content",
      };

      tx.topicReportRevision.findFirst.mockResolvedValue({ revisionNumber: 2 });
      tx.topicReport.update.mockResolvedValue(updatedReport);

      const result = await service.saveAiEditRevision(
        "report-001",
        "Original content",
        "AI-edited content",
        "AI improved clarity",
        "ai_edit",
      );

      expect(tx.topicReportRevision.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          reportId: "report-001",
          revisionNumber: 3, // 2 + 1
          content: "Original content",
          changeDescription: "AI improved clarity",
          editedBy: "ai",
          editOperation: "ai_edit",
        }),
      });

      expect(tx.topicReport.update).toHaveBeenCalledWith({
        where: { id: "report-001" },
        data: { fullReport: "AI-edited content" },
      });

      expect(result).toBe(updatedReport);
    });

    it("should handle no previous revisions (starts at 1)", async () => {
      const tx = mockPrisma._tx;

      tx.topicReportRevision.findFirst.mockResolvedValue(null); // No revisions yet
      tx.topicReport.update.mockResolvedValue({ id: "report-001" });

      await service.saveAiEditRevision(
        "report-001",
        "Original",
        "New content",
        "First AI edit",
        "ai_summarize",
      );

      expect(tx.topicReportRevision.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            revisionNumber: 1, // 0 + 1
          }),
        }),
      );
    });
  });
});

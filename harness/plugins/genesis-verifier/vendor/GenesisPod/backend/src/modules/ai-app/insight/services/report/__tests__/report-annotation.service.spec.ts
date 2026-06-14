/**
 * ReportAnnotationService Unit Tests
 *
 * Coverage targets:
 * - createAnnotation: happy path, prisma create
 * - getAnnotations: with and without status filter
 * - updateAnnotation: not found throws, happy path
 * - deleteAnnotation: not found throws, happy path
 * - resolveAnnotation: not found throws, sets RESOLVED status
 * - resolveAllAnnotations: with and without annotationIds filter
 * - getAnnotationStats: counts by status and type
 */

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { ReportAnnotationService } from "../report-annotation.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { AnnotationStatus, AnnotationType } from "@prisma/client";

// ──────────────────────────────────────────────────────────────────────────────
// Mock fixtures
// ──────────────────────────────────────────────────────────────────────────────

const mockAnnotation = {
  id: "annotation-001",
  reportId: "report-001",
  content: "This needs clarification",
  type: AnnotationType.COMMENT,
  selectedText: "selected text",
  startOffset: 100,
  endOffset: 150,
  status: AnnotationStatus.OPEN,
  createdById: "user-001",
  resolvedById: null,
  resolvedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: {
    id: "user-001",
    username: "testuser",
    fullName: "Test User",
    avatarUrl: null,
  },
};

const mockPrisma = {
  reportAnnotation: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// Test suite
// ──────────────────────────────────────────────────────────────────────────────

describe("ReportAnnotationService", () => {
  let service: ReportAnnotationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportAnnotationService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ReportAnnotationService>(ReportAnnotationService);
    jest.clearAllMocks();
  });

  // ─────────────────────────── createAnnotation ─────────────────────────────

  describe("createAnnotation", () => {
    it("should create an annotation and return it", async () => {
      mockPrisma.reportAnnotation.create.mockResolvedValue(mockAnnotation);

      const result = await service.createAnnotation("report-001", "user-001", {
        content: "This needs clarification",
        type: AnnotationType.COMMENT,
        selectedText: "selected text",
        startOffset: 100,
        endOffset: 150,
      });

      expect(result).toEqual(mockAnnotation);
      expect(mockPrisma.reportAnnotation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reportId: "report-001",
            content: "This needs clarification",
            type: AnnotationType.COMMENT,
            createdById: "user-001",
          }),
        }),
      );
    });
  });

  // ─────────────────────────── getAnnotations ────────────────────────────────

  describe("getAnnotations", () => {
    it("should return all annotations for a report without status filter", async () => {
      mockPrisma.reportAnnotation.findMany.mockResolvedValue([mockAnnotation]);

      const result = await service.getAnnotations("report-001");

      expect(result).toHaveLength(1);
      expect(mockPrisma.reportAnnotation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reportId: "report-001" },
        }),
      );
    });

    it("should filter annotations by status", async () => {
      mockPrisma.reportAnnotation.findMany.mockResolvedValue([]);

      await service.getAnnotations("report-001", AnnotationStatus.RESOLVED);

      expect(mockPrisma.reportAnnotation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reportId: "report-001", status: AnnotationStatus.RESOLVED },
        }),
      );
    });
  });

  // ─────────────────────────── updateAnnotation ─────────────────────────────

  describe("updateAnnotation", () => {
    it("should throw NotFoundException when annotation not found", async () => {
      mockPrisma.reportAnnotation.findUnique.mockResolvedValue(null);

      await expect(
        service.updateAnnotation("nonexistent-id", { content: "updated" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should update annotation content and return updated record", async () => {
      const updatedAnnotation = {
        ...mockAnnotation,
        content: "Updated content",
      };
      mockPrisma.reportAnnotation.findUnique.mockResolvedValue(mockAnnotation);
      mockPrisma.reportAnnotation.update.mockResolvedValue(updatedAnnotation);

      const result = await service.updateAnnotation("annotation-001", {
        content: "Updated content",
      });

      expect(result.content).toBe("Updated content");
      expect(mockPrisma.reportAnnotation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "annotation-001" },
          data: expect.objectContaining({ content: "Updated content" }),
        }),
      );
    });

    it("should update annotation status", async () => {
      mockPrisma.reportAnnotation.findUnique.mockResolvedValue(mockAnnotation);
      mockPrisma.reportAnnotation.update.mockResolvedValue({
        ...mockAnnotation,
        status: AnnotationStatus.DISMISSED,
      });

      await service.updateAnnotation("annotation-001", {
        status: AnnotationStatus.DISMISSED,
      });

      expect(mockPrisma.reportAnnotation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: AnnotationStatus.DISMISSED,
          }),
        }),
      );
    });
  });

  // ─────────────────────────── deleteAnnotation ─────────────────────────────

  describe("deleteAnnotation", () => {
    it("should throw NotFoundException when annotation not found", async () => {
      mockPrisma.reportAnnotation.findUnique.mockResolvedValue(null);

      await expect(service.deleteAnnotation("nonexistent-id")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should delete annotation and return success", async () => {
      mockPrisma.reportAnnotation.findUnique.mockResolvedValue(mockAnnotation);
      mockPrisma.reportAnnotation.delete.mockResolvedValue(mockAnnotation);

      const result = await service.deleteAnnotation("annotation-001");

      expect(result).toEqual({ success: true });
      expect(mockPrisma.reportAnnotation.delete).toHaveBeenCalledWith({
        where: { id: "annotation-001" },
      });
    });
  });

  // ─────────────────────────── resolveAnnotation ────────────────────────────

  describe("resolveAnnotation", () => {
    it("should throw NotFoundException when annotation not found", async () => {
      mockPrisma.reportAnnotation.findUnique.mockResolvedValue(null);

      await expect(
        service.resolveAnnotation("nonexistent-id", "user-001"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should resolve annotation and set status to RESOLVED", async () => {
      const resolvedAnnotation = {
        ...mockAnnotation,
        status: AnnotationStatus.RESOLVED,
        resolvedById: "user-001",
        resolvedAt: new Date(),
      };
      mockPrisma.reportAnnotation.findUnique.mockResolvedValue(mockAnnotation);
      mockPrisma.reportAnnotation.update.mockResolvedValue(resolvedAnnotation);

      const result = await service.resolveAnnotation(
        "annotation-001",
        "user-001",
      );

      expect(result.status).toBe(AnnotationStatus.RESOLVED);
      expect(mockPrisma.reportAnnotation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: AnnotationStatus.RESOLVED,
            resolvedById: "user-001",
          }),
        }),
      );
    });
  });

  // ──────────────────────── resolveAllAnnotations ───────────────────────────

  describe("resolveAllAnnotations", () => {
    it("should resolve all open annotations for a report", async () => {
      mockPrisma.reportAnnotation.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.resolveAllAnnotations(
        "report-001",
        "user-001",
      );

      expect(result).toBe(3);
      expect(mockPrisma.reportAnnotation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            reportId: "report-001",
            status: AnnotationStatus.OPEN,
          }),
        }),
      );
    });

    it("should resolve only specified annotation IDs", async () => {
      mockPrisma.reportAnnotation.updateMany.mockResolvedValue({ count: 2 });

      await service.resolveAllAnnotations("report-001", "user-001", [
        "ann-1",
        "ann-2",
      ]);

      expect(mockPrisma.reportAnnotation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: ["ann-1", "ann-2"] },
          }),
        }),
      );
    });
  });

  // ─────────────────────────── getAnnotationStats ───────────────────────────

  describe("getAnnotationStats", () => {
    it("should return correct counts by status and type", async () => {
      const annotations = [
        {
          status: AnnotationStatus.OPEN,
          type: AnnotationType.COMMENT,
        },
        {
          status: AnnotationStatus.OPEN,
          type: AnnotationType.SUGGESTION,
        },
        {
          status: AnnotationStatus.RESOLVED,
          type: AnnotationType.ISSUE,
        },
        {
          status: AnnotationStatus.DISMISSED,
          type: AnnotationType.REFERENCE,
        },
      ];
      mockPrisma.reportAnnotation.findMany.mockResolvedValue(annotations);

      const stats = await service.getAnnotationStats("report-001");

      expect(stats.total).toBe(4);
      expect(stats.byStatus.open).toBe(2);
      expect(stats.byStatus.resolved).toBe(1);
      expect(stats.byStatus.dismissed).toBe(1);
      expect(stats.byType.comment).toBe(1);
      expect(stats.byType.suggestion).toBe(1);
      expect(stats.byType.issue).toBe(1);
      expect(stats.byType.reference).toBe(1);
    });

    it("should return zeros for empty report", async () => {
      mockPrisma.reportAnnotation.findMany.mockResolvedValue([]);

      const stats = await service.getAnnotationStats("empty-report");

      expect(stats.total).toBe(0);
      expect(stats.byStatus.open).toBe(0);
      expect(stats.byType.comment).toBe(0);
    });
  });
});

/**
 * ReportChangeService Unit Tests
 *
 * Coverage targets:
 * - detectChanges: added, deleted, modified paragraphs, no changes
 * - getChanges: returns all changes ordered by startOffset
 * - getPendingChanges: filters unchecked changes
 * - checkinChange: not found throws, happy path
 * - checkinAllChanges: with and without changeIds filter
 * - getChangeSummary: totals and type breakdown
 */

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { ReportChangeService } from "../report-change.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ChangeType } from "@prisma/client";

// ──────────────────────────────────────────────────────────────────────────────
// Mock fixtures
// ──────────────────────────────────────────────────────────────────────────────

const mockChange = {
  id: "change-001",
  reportId: "report-001",
  changeType: ChangeType.MODIFIED,
  previousContent: "Old paragraph content",
  currentContent: "New paragraph content",
  startOffset: 0,
  endOffset: 50,
  wordsDiff: 2,
  confidence: 1.0,
  checkedInAt: null,
  checkedInById: null,
  createdAt: new Date(),
};

const mockPrisma = {
  reportChange: {
    createMany: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// Test suite
// ──────────────────────────────────────────────────────────────────────────────

describe("ReportChangeService", () => {
  let service: ReportChangeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportChangeService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ReportChangeService>(ReportChangeService);
    jest.clearAllMocks();
  });

  // ─────────────────────────── detectChanges ────────────────────────────────

  describe("detectChanges", () => {
    it("should detect added paragraphs", async () => {
      mockPrisma.reportChange.createMany.mockResolvedValue({ count: 1 });

      const changes = await service.detectChanges(
        "report-001",
        "First paragraph.",
        "First paragraph.\n\nNew added paragraph.",
      );

      expect(changes.some((c) => c.changeType === ChangeType.ADDED)).toBe(true);
      expect(mockPrisma.reportChange.createMany).toHaveBeenCalled();
    });

    it("should detect deleted paragraphs", async () => {
      mockPrisma.reportChange.createMany.mockResolvedValue({ count: 1 });

      const changes = await service.detectChanges(
        "report-001",
        "First paragraph.\n\nSecond paragraph to delete.",
        "First paragraph.",
      );

      expect(changes.some((c) => c.changeType === ChangeType.DELETED)).toBe(
        true,
      );
    });

    it("should detect modified paragraphs", async () => {
      mockPrisma.reportChange.createMany.mockResolvedValue({ count: 1 });

      const changes = await service.detectChanges(
        "report-001",
        "Original paragraph content here.",
        "Modified paragraph content here with more words.",
      );

      expect(changes.some((c) => c.changeType === ChangeType.MODIFIED)).toBe(
        true,
      );
    });

    it("should return empty changes when content is identical", async () => {
      const content = "Same content in both versions.";

      const changes = await service.detectChanges(
        "report-001",
        content,
        content,
      );

      expect(changes).toHaveLength(0);
      expect(mockPrisma.reportChange.createMany).not.toHaveBeenCalled();
    });

    it("should not persist changes when nothing changed", async () => {
      await service.detectChanges(
        "report-001",
        "Unchanged text",
        "Unchanged text",
      );

      expect(mockPrisma.reportChange.createMany).not.toHaveBeenCalled();
    });

    it("should calculate positive wordsDiff for added paragraphs", async () => {
      mockPrisma.reportChange.createMany.mockResolvedValue({ count: 1 });

      const changes = await service.detectChanges(
        "report-001",
        "Short text.",
        "Short text.\n\nA much longer new paragraph with many additional words added here.",
      );

      const addedChange = changes.find(
        (c) => c.changeType === ChangeType.ADDED,
      );
      expect(addedChange?.wordsDiff).toBeGreaterThan(0);
    });

    it("should calculate negative wordsDiff for deleted paragraphs", async () => {
      mockPrisma.reportChange.createMany.mockResolvedValue({ count: 1 });

      const changes = await service.detectChanges(
        "report-001",
        "Remaining text.\n\nThis paragraph will be deleted from the report.",
        "Remaining text.",
      );

      const deletedChange = changes.find(
        (c) => c.changeType === ChangeType.DELETED,
      );
      expect(deletedChange?.wordsDiff).toBeLessThan(0);
    });
  });

  // ─────────────────────────── getChanges ───────────────────────────────────

  describe("getChanges", () => {
    it("should return all changes ordered by startOffset", async () => {
      mockPrisma.reportChange.findMany.mockResolvedValue([mockChange]);

      const result = await service.getChanges("report-001");

      expect(result).toHaveLength(1);
      expect(mockPrisma.reportChange.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reportId: "report-001" },
          orderBy: { startOffset: "asc" },
        }),
      );
    });
  });

  // ─────────────────────────── getPendingChanges ────────────────────────────

  describe("getPendingChanges", () => {
    it("should return changes where checkedInAt is null", async () => {
      mockPrisma.reportChange.findMany.mockResolvedValue([mockChange]);

      const result = await service.getPendingChanges("report-001");

      expect(mockPrisma.reportChange.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reportId: "report-001", checkedInAt: null },
        }),
      );
      expect(result).toHaveLength(1);
    });
  });

  // ─────────────────────────── checkinChange ────────────────────────────────

  describe("checkinChange", () => {
    it("should throw NotFoundException when change not found", async () => {
      mockPrisma.reportChange.findUnique.mockResolvedValue(null);

      await expect(
        service.checkinChange("nonexistent-id", "user-001"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should check in a change and set checkedInAt", async () => {
      const checkedInChange = {
        ...mockChange,
        checkedInAt: new Date(),
        checkedInById: "user-001",
      };
      mockPrisma.reportChange.findUnique.mockResolvedValue(mockChange);
      mockPrisma.reportChange.update.mockResolvedValue(checkedInChange);

      const result = await service.checkinChange("change-001", "user-001");

      expect(result.checkedInAt).toBeDefined();
      expect(mockPrisma.reportChange.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "change-001" },
          data: expect.objectContaining({
            checkedInById: "user-001",
          }),
        }),
      );
    });
  });

  // ─────────────────────────── checkinAllChanges ────────────────────────────

  describe("checkinAllChanges", () => {
    it("should check in all pending changes for a report", async () => {
      mockPrisma.reportChange.updateMany.mockResolvedValue({ count: 5 });

      const result = await service.checkinAllChanges("report-001", "user-001");

      expect(result).toBe(5);
      expect(mockPrisma.reportChange.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            reportId: "report-001",
            checkedInAt: null,
          }),
        }),
      );
    });

    it("should check in only specified change IDs", async () => {
      mockPrisma.reportChange.updateMany.mockResolvedValue({ count: 2 });

      await service.checkinAllChanges("report-001", "user-001", [
        "ch-1",
        "ch-2",
      ]);

      expect(mockPrisma.reportChange.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: ["ch-1", "ch-2"] },
          }),
        }),
      );
    });
  });

  // ─────────────────────────── getChangeSummary ─────────────────────────────

  describe("getChangeSummary", () => {
    it("should return correct summary with all change types", async () => {
      const changes = [
        {
          changeType: ChangeType.ADDED,
          checkedInAt: null,
          wordsDiff: 50,
        },
        {
          changeType: ChangeType.MODIFIED,
          checkedInAt: new Date(),
          wordsDiff: 10,
        },
        {
          changeType: ChangeType.DELETED,
          checkedInAt: null,
          wordsDiff: -30,
        },
      ];
      mockPrisma.reportChange.findMany.mockResolvedValue(changes);

      const summary = await service.getChangeSummary("report-001");

      expect(summary.total).toBe(3);
      expect(summary.pending).toBe(2);
      expect(summary.checkedIn).toBe(1);
      expect(summary.byType.added).toBe(1);
      expect(summary.byType.modified).toBe(1);
      expect(summary.byType.deleted).toBe(1);
      expect(summary.totalWordsDiff).toBe(30); // 50 + 10 - 30
    });

    it("should return zero summary for empty changes", async () => {
      mockPrisma.reportChange.findMany.mockResolvedValue([]);

      const summary = await service.getChangeSummary("report-001");

      expect(summary.total).toBe(0);
      expect(summary.pending).toBe(0);
      expect(summary.totalWordsDiff).toBe(0);
    });
  });
});

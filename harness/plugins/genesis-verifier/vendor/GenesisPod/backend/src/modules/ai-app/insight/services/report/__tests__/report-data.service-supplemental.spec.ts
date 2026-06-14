/**
 * ReportDataService - Supplemental Unit Tests
 *
 * Covers uncovered branches:
 * - getLatestReport: returns report or null
 * - getReport: returns report or null
 * - compareReports: not found throws, topic mismatch throws, changed dimensions detection
 * - markIncrementalChanges: updates report with incremental flag
 * - updateReport: basic update, with highlights/charts conversion
 * - getDimensionAnalysesByTopic: with and without reportId
 * - getReportEvidences: returns evidences
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ReportDataService } from "../report-data.service";
import { PrismaService } from "@/common/prisma/prisma.service";

// ──────────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────────

const mockReport1 = {
  id: "report-001",
  topicId: "topic-001",
  version: 1,
  versionLabel: "v1",
  executiveSummary: "报告摘要",
  fullReport: "完整报告内容",
  highlights: [],
  charts: [],
  totalDimensions: 2,
  totalSources: 10,
  totalTokens: 5000,
  isIncremental: false,
  generatedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
  dimensionAnalyses: [
    {
      id: "da-001",
      dimension: { id: "dim-001", name: "技术现状", sortOrder: 1 },
    },
    {
      id: "da-002",
      dimension: { id: "dim-002", name: "市场格局", sortOrder: 2 },
    },
  ],
  evidences: [],
};

const mockReport2 = {
  id: "report-002",
  topicId: "topic-001",
  version: 2,
  versionLabel: "v2",
  executiveSummary: "新报告摘要",
  fullReport: "新完整报告内容",
  highlights: [],
  charts: [],
  totalDimensions: 3,
  totalSources: 15,
  totalTokens: 7500,
  isIncremental: true,
  generatedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
  dimensionAnalyses: [
    {
      id: "da-003",
      dimension: { id: "dim-001", name: "技术现状", sortOrder: 1 },
    },
    {
      id: "da-004",
      dimension: { id: "dim-003", name: "竞争格局", sortOrder: 3 },
    },
  ],
  evidences: [],
};

const mockPrisma = {
  topicReport: {
    findFirst: jest.fn(),
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
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

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("ReportDataService (supplemental)", () => {
  let service: ReportDataService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportDataService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ReportDataService>(ReportDataService);
  });

  afterEach(() => jest.clearAllMocks());

  // ============================================================
  // getLatestReport
  // ============================================================

  describe("getLatestReport", () => {
    it("should return latest report with dimension analyses and evidences", async () => {
      mockPrisma.topicReport.findFirst.mockResolvedValue(mockReport1);

      const result = await service.getLatestReport("topic-001");

      expect(result).toBe(mockReport1);
      expect(mockPrisma.topicReport.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            topicId: "topic-001",
            dimensionAnalyses: { some: {} },
          }),
          orderBy: { generatedAt: "desc" },
          include: expect.objectContaining({
            dimensionAnalyses: expect.anything(),
            evidences: expect.anything(),
          }),
        }),
      );
    });

    it("should return null when no report found", async () => {
      mockPrisma.topicReport.findFirst.mockResolvedValue(null);

      const result = await service.getLatestReport("topic-999");

      expect(result).toBeNull();
    });
  });

  // ============================================================
  // getReport
  // ============================================================

  describe("getReport", () => {
    it("should return report by id with full includes", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue(mockReport1);

      const result = await service.getReport("report-001");

      expect(result).toBe(mockReport1);
      expect(mockPrisma.topicReport.findUnique).toHaveBeenCalledWith({
        where: { id: "report-001" },
        include: expect.objectContaining({
          dimensionAnalyses: expect.anything(),
          evidences: expect.anything(),
        }),
      });
    });

    it("should return null when report not found", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue(null);

      const result = await service.getReport("nonexistent-report");

      expect(result).toBeNull();
    });
  });

  // ============================================================
  // compareReports
  // ============================================================

  describe("compareReports", () => {
    it("should throw when report1 not found", async () => {
      mockPrisma.topicReport.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockReport2);

      await expect(
        service.compareReports("topic-001", "nonexistent", "report-002"),
      ).rejects.toThrow("One or both reports not found");
    });

    it("should throw when report2 not found", async () => {
      mockPrisma.topicReport.findUnique
        .mockResolvedValueOnce(mockReport1)
        .mockResolvedValueOnce(null);

      await expect(
        service.compareReports("topic-001", "report-001", "nonexistent"),
      ).rejects.toThrow("One or both reports not found");
    });

    it("should throw when reports do not belong to the specified topic", async () => {
      const report1OtherTopic = { ...mockReport1, topicId: "other-topic" };
      mockPrisma.topicReport.findUnique
        .mockResolvedValueOnce(report1OtherTopic)
        .mockResolvedValueOnce(mockReport2);

      await expect(
        service.compareReports("topic-001", "report-001", "report-002"),
      ).rejects.toThrow("Reports do not belong to the specified topic");
    });

    it("should return comparison with changed dimensions", async () => {
      mockPrisma.topicReport.findUnique
        .mockResolvedValueOnce(mockReport1)
        .mockResolvedValueOnce(mockReport2);

      const result = await service.compareReports(
        "topic-001",
        "report-001",
        "report-002",
      );

      expect(result.report1).toBe(mockReport1);
      expect(result.report2).toBe(mockReport2);
      // Report1 has "技术现状" and "市场格局"
      // Report2 has "技术现状" and "竞争格局"
      // Changed = "市场格局" (in r1 not r2) + "竞争格局" (in r2 not r1)
      expect(result.changes.changedDimensions).toContain("市场格局");
      expect(result.changes.changedDimensions).toContain("竞争格局");
      expect(result.changes.sourcesDelta).toBe(5); // 15 - 10
    });

    it("should return empty changedDimensions when reports have same dimensions", async () => {
      const report2SameDims = {
        ...mockReport2,
        dimensionAnalyses: mockReport1.dimensionAnalyses,
      };
      mockPrisma.topicReport.findUnique
        .mockResolvedValueOnce(mockReport1)
        .mockResolvedValueOnce(report2SameDims);

      const result = await service.compareReports(
        "topic-001",
        "report-001",
        "report-002",
      );

      expect(result.changes.changedDimensions).toHaveLength(0);
    });
  });

  // ============================================================
  // markIncrementalChanges
  // ============================================================

  describe("markIncrementalChanges", () => {
    it("should update report with incremental changes data", async () => {
      mockPrisma.topicReport.update.mockResolvedValue({ id: "report-002" });

      await service.markIncrementalChanges(
        "report-002",
        "report-001",
        ["技术现状", "市场格局"],
        5,
      );

      expect(mockPrisma.topicReport.update).toHaveBeenCalledWith({
        where: { id: "report-002" },
        data: {
          isIncremental: true,
          changesFromPrev: expect.objectContaining({
            previousReportId: "report-001",
            dimensionsRefreshed: ["技术现状", "市场格局"],
            newSourcesCount: 5,
            refreshedAt: expect.any(String),
          }),
        },
      });
    });

    it("should handle empty refreshedDimensions array", async () => {
      mockPrisma.topicReport.update.mockResolvedValue({ id: "report-002" });

      await service.markIncrementalChanges("report-002", "report-001", [], 0);

      expect(mockPrisma.topicReport.update).toHaveBeenCalledWith({
        where: { id: "report-002" },
        data: expect.objectContaining({
          isIncremental: true,
        }),
      });
    });
  });

  // ============================================================
  // updateReport
  // ============================================================

  describe("updateReport", () => {
    it("should update report content fields", async () => {
      const updatedReport = { ...mockReport1, executiveSummary: "新摘要" };
      mockPrisma.topicReport.update.mockResolvedValue(updatedReport);

      const result = await service.updateReport("report-001", {
        executiveSummary: "新摘要",
        fullReport: "新报告正文",
        totalDimensions: 3,
        totalSources: 15,
      });

      expect(result).toBe(updatedReport);
      expect(mockPrisma.topicReport.update).toHaveBeenCalledWith({
        where: { id: "report-001" },
        data: expect.objectContaining({
          executiveSummary: "新摘要",
          fullReport: "新报告正文",
          totalDimensions: 3,
          totalSources: 15,
          generatedAt: expect.any(Date),
        }),
      });
    });

    it("should convert highlights to Prisma JSON format", async () => {
      mockPrisma.topicReport.update.mockResolvedValue(mockReport1);

      await service.updateReport("report-001", {
        highlights: ["发现1", "发现2"],
      });

      expect(mockPrisma.topicReport.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            highlights: expect.anything(), // toPrismaJson result
          }),
        }),
      );
    });

    it("should convert charts to Prisma JSON format", async () => {
      mockPrisma.topicReport.update.mockResolvedValue(mockReport1);

      await service.updateReport("report-001", {
        charts: [{ id: "chart-001", type: "bar", title: "趋势图" } as never],
      });

      expect(mockPrisma.topicReport.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            charts: expect.anything(), // toPrismaJson result
          }),
        }),
      );
    });

    it("should update generationTimeMs if provided", async () => {
      mockPrisma.topicReport.update.mockResolvedValue(mockReport1);

      await service.updateReport("report-001", {
        generationTimeMs: 5000,
      });

      expect(mockPrisma.topicReport.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            generationTimeMs: 5000,
          }),
        }),
      );
    });
  });

  // ============================================================
  // getReportEvidences
  // ============================================================

  describe("getReportEvidences", () => {
    it("should return evidences ordered by citationIndex", async () => {
      const mockEvidences = [
        { id: "ev-001", citationIndex: 1, title: "Source 1" },
        { id: "ev-002", citationIndex: 2, title: "Source 2" },
      ];
      mockPrisma.topicEvidence.findMany.mockResolvedValue(mockEvidences);

      const result = await service.getReportEvidences("report-001");

      expect(result).toBe(mockEvidences);
      expect(mockPrisma.topicEvidence.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reportId: "report-001" },
          orderBy: { citationIndex: "asc" },
        }),
      );
    });

    it("should return empty array when no evidences exist", async () => {
      mockPrisma.topicEvidence.findMany.mockResolvedValue([]);

      const result = await service.getReportEvidences("report-empty");

      expect(result).toEqual([]);
    });
  });

  // ============================================================
  // getDimensionAnalysesByTopic
  // ============================================================

  describe("getDimensionAnalysesByTopic", () => {
    it("should query by topicId when no reportId provided", async () => {
      mockPrisma.dimensionAnalysis.findMany.mockResolvedValue([]);

      await service.getDimensionAnalysesByTopic("topic-001");

      expect(mockPrisma.dimensionAnalysis.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ topicId: "topic-001" }),
        }),
      );
    });

    it("should query by reportId when provided", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue({
        topicId: "topic-001",
      });
      mockPrisma.dimensionAnalysis.findMany.mockResolvedValue([]);

      await service.getDimensionAnalysesByTopic("topic-001", "report-001");

      expect(mockPrisma.topicReport.findUnique).toHaveBeenCalledWith({
        where: { id: "report-001" },
        select: { topicId: true },
      });
    });
  });
});

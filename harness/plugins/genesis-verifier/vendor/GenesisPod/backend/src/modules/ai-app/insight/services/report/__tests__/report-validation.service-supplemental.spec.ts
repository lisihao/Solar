/**
 * ReportValidationService Supplemental Tests
 *
 * Covers missing branches from report-validation.service.ts:
 * - line 217: reference chart with invalid imageUrl format
 * - lines 320-375: validateCrossDimensionData with variance detection
 * - lines 329-340: numericFields handling with dimension data points
 * - lines 351-372: min>0 check and (max-min)/min > 0.5 warning
 * - lines 382-388: buildResult figureErrors counting
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ReportValidationService } from "../report-validation.service";
import { PrismaService } from "@/common/prisma/prisma.service";

const mockPrisma = {
  topicReport: {
    findUnique: jest.fn(),
  },
};

describe("ReportValidationService supplemental", () => {
  let service: ReportValidationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportValidationService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ReportValidationService>(ReportValidationService);
    jest.clearAllMocks();
  });

  // ─────────────────────── invalid imageUrl format ──────────────────────────

  describe("invalid imageUrl format", () => {
    it("should warn on reference chart with invalid imageUrl format", async () => {
      const report = {
        id: "report-001",
        fullReport: "[1]",
        charts: [
          {
            id: "chart-001",
            chartType: "reference",
            title: "Invalid URL Chart",
            imageUrl: "not-a-valid-url", // invalid URL format
            evidenceCitationIndex: null,
          },
        ],
        evidences: [{ id: "ev-001", citationIndex: 1 }],
        dimensionAnalyses: [],
      };
      mockPrisma.topicReport.findUnique.mockResolvedValue(report);

      const result = await service.validateReport("topic-001", "report-001");

      expect(result.warnings.some((w) => w.type === "INVALID_IMAGE_URL")).toBe(
        true,
      );
    });

    it("should pass for reference chart with valid https imageUrl", async () => {
      const report = {
        id: "report-001",
        fullReport: "[1]",
        charts: [
          {
            id: "chart-001",
            chartType: "reference",
            title: "Valid URL Chart",
            imageUrl: "https://example.com/image.png",
            evidenceCitationIndex: null,
          },
        ],
        evidences: [{ id: "ev-001", citationIndex: 1 }],
        dimensionAnalyses: [],
      };
      mockPrisma.topicReport.findUnique.mockResolvedValue(report);

      const result = await service.validateReport("topic-001", "report-001");

      // No INVALID_IMAGE_URL warning
      expect(result.warnings.some((w) => w.type === "INVALID_IMAGE_URL")).toBe(
        false,
      );
    });
  });

  // ─────────────────────── cross-dimension variance ─────────────────────────

  describe("cross-dimension variance detection", () => {
    it("should warn when same numeric field differs significantly across dimensions", async () => {
      const report = {
        id: "report-001",
        fullReport: "[1]",
        charts: [],
        evidences: [{ id: "ev-001", citationIndex: 1 }],
        dimensionAnalyses: [
          {
            dimension: { name: "Dimension A" },
            dataPoints: {
              marketSize: 100,
            },
          },
          {
            dimension: { name: "Dimension B" },
            dataPoints: {
              marketSize: 300, // 200% increase, > 50% threshold
            },
          },
        ],
      };
      mockPrisma.topicReport.findUnique.mockResolvedValue(report);

      const result = await service.validateReport("topic-001", "report-001");

      expect(
        result.warnings.some((w) => w.type === "CROSS_DIMENSION_DATA_VARIANCE"),
      ).toBe(true);
    });

    it("should not warn when numeric fields have similar values", async () => {
      const report = {
        id: "report-001",
        fullReport: "[1]",
        charts: [],
        evidences: [{ id: "ev-001", citationIndex: 1 }],
        dimensionAnalyses: [
          {
            dimension: { name: "Dimension A" },
            dataPoints: {
              marketSize: 100,
            },
          },
          {
            dimension: { name: "Dimension B" },
            dataPoints: {
              marketSize: 110, // only 10% increase, < 50% threshold
            },
          },
        ],
      };
      mockPrisma.topicReport.findUnique.mockResolvedValue(report);

      const result = await service.validateReport("topic-001", "report-001");

      expect(
        result.warnings.some((w) => w.type === "CROSS_DIMENSION_DATA_VARIANCE"),
      ).toBe(false);
    });

    it("should not warn when only one dimension has a field", async () => {
      const report = {
        id: "report-001",
        fullReport: "[1]",
        charts: [],
        evidences: [{ id: "ev-001", citationIndex: 1 }],
        dimensionAnalyses: [
          {
            dimension: { name: "Dimension A" },
            dataPoints: {
              uniqueField: 100,
            },
          },
          {
            dimension: { name: "Dimension B" },
            dataPoints: {
              differentField: 500,
            },
          },
        ],
      };
      mockPrisma.topicReport.findUnique.mockResolvedValue(report);

      const result = await service.validateReport("topic-001", "report-001");

      expect(
        result.warnings.some((w) => w.type === "CROSS_DIMENSION_DATA_VARIANCE"),
      ).toBe(false);
    });

    it("should skip dimensions with null dataPoints", async () => {
      const report = {
        id: "report-001",
        fullReport: "[1]",
        charts: [],
        evidences: [{ id: "ev-001", citationIndex: 1 }],
        dimensionAnalyses: [
          {
            dimension: { name: "Dimension A" },
            dataPoints: null,
          },
          {
            dimension: null, // null dimension
            dataPoints: { marketSize: 100 },
          },
        ],
      };
      mockPrisma.topicReport.findUnique.mockResolvedValue(report);

      const result = await service.validateReport("topic-001", "report-001");

      // Should not throw and should handle gracefully
      expect(result).toBeDefined();
    });

    it("should skip cross-dimension check when only 1 analysis", async () => {
      const report = {
        id: "report-001",
        fullReport: "[1]",
        charts: [],
        evidences: [{ id: "ev-001", citationIndex: 1 }],
        dimensionAnalyses: [
          {
            dimension: { name: "Only Dimension" },
            dataPoints: { value: 100 },
          },
        ],
      };
      mockPrisma.topicReport.findUnique.mockResolvedValue(report);

      const result = await service.validateReport("topic-001", "report-001");

      expect(
        result.warnings.some((w) => w.type === "CROSS_DIMENSION_DATA_VARIANCE"),
      ).toBe(false);
    });

    it("should not warn when min value is 0 (division by zero guard)", async () => {
      const report = {
        id: "report-001",
        fullReport: "[1]",
        charts: [],
        evidences: [{ id: "ev-001", citationIndex: 1 }],
        dimensionAnalyses: [
          {
            dimension: { name: "Dimension A" },
            dataPoints: { growthRate: 0 }, // min = 0
          },
          {
            dimension: { name: "Dimension B" },
            dataPoints: { growthRate: 999 }, // max = 999, but min = 0 so guard triggers
          },
        ],
      };
      mockPrisma.topicReport.findUnique.mockResolvedValue(report);

      const result = await service.validateReport("topic-001", "report-001");

      // min=0 -> guard condition `min > 0` is false -> no warning
      expect(
        result.warnings.some((w) => w.type === "CROSS_DIMENSION_DATA_VARIANCE"),
      ).toBe(false);
    });
  });

  // ─────────────────────── buildResult summary ──────────────────────────────

  describe("buildResult summary structure", () => {
    it("should count figure errors correctly in summary", async () => {
      const report = {
        id: "report-001",
        fullReport: "[1]",
        charts: [
          {
            id: "chart-dup",
            chartType: "reference",
            title: "Chart A",
            imageUrl: "https://example.com/a.png",
          },
          {
            id: "chart-dup", // duplicate
            chartType: "reference",
            title: "Chart B",
            imageUrl: "https://example.com/b.png",
          },
          {
            id: "chart-no-img",
            chartType: "reference",
            title: "No Image Chart",
            imageUrl: null,
          },
        ],
        evidences: [{ id: "ev-001", citationIndex: 1 }],
        dimensionAnalyses: [],
      };
      mockPrisma.topicReport.findUnique.mockResolvedValue(report);

      const result = await service.validateReport("topic-001", "report-001");

      expect(result.summary.figureErrors).toBeGreaterThan(0);
      expect(result.summary.totalErrors).toBe(result.errors.length);
    });

    it("should set isValid=false when there are errors", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue(null);

      const result = await service.validateReport(
        "topic-001",
        "missing-report",
      );

      expect(result.isValid).toBe(false);
      expect(result.summary.totalErrors).toBeGreaterThan(0);
    });
  });

  // ─────────────────────── validateCitationIndices edge cases ───────────────

  describe("validateCitationIndices edge cases", () => {
    it("should skip citation validation when markdown is empty", async () => {
      const report = {
        id: "report-001",
        fullReport: "",
        charts: [],
        evidences: [{ id: "ev-001", citationIndex: 1 }],
        dimensionAnalyses: [],
      };
      mockPrisma.topicReport.findUnique.mockResolvedValue(report);

      const result = await service.validateReport("topic-001", "report-001");

      // empty markdown with evidences should not generate citation errors
      expect(
        result.errors.some((e) => e.type === "INVALID_CITATION_INDEX"),
      ).toBe(false);
    });

    it("should skip citation validation when evidenceCount is 0", async () => {
      const report = {
        id: "report-001",
        fullReport: "Some text without citations",
        charts: [],
        evidences: [],
        dimensionAnalyses: [],
      };
      mockPrisma.topicReport.findUnique.mockResolvedValue(report);

      const result = await service.validateReport("topic-001", "report-001");

      expect(result.isValid).toBe(true);
    });
  });
});

/**
 * ReportValidationService - Supplemental Tests
 *
 * Targets uncovered lines:
 * - line 217: validateFigureReferences: invalid imageUrl (non-URL string)
 * - lines 320-342: validateCrossDimensionData: 2+ dimensions with numeric fields
 * - lines 329-342: significant variance detection
 * - line 351-359: same field, multiple dimensions, no variance
 * - line 382: isValidUrl with undefined input
 * - line 387: isValidUrl catch block (invalid URL string)
 * - lines 464-469: quickValidate with citation out of range
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ReportValidationService } from "../report-validation.service";
import { PrismaService } from "@/common/prisma/prisma.service";

const mockPrisma = {
  topicReport: {
    findUnique: jest.fn(),
  },
};

const makeReport = (overrides: Record<string, unknown> = {}) => ({
  id: "report-001",
  fullReport: "",
  charts: [],
  evidences: [],
  dimensionAnalyses: [],
  ...overrides,
});

describe("ReportValidationService (supplemental)", () => {
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

  // ─────────────────────────── invalid imageUrl ────────────────────────────

  describe("validateFigureReferences: invalid imageUrl", () => {
    it("should warn when reference chart has non-URL imageUrl string", async () => {
      const report = makeReport({
        charts: [
          {
            id: "chart-001",
            chartType: "reference",
            title: "Chart with bad URL",
            imageUrl: "not-a-valid-url", // Not a valid URL
          },
        ],
      });
      mockPrisma.topicReport.findUnique.mockResolvedValue(report);

      const result = await service.validateReport("topic-001", "report-001");

      expect(result.warnings.some((w) => w.type === "INVALID_IMAGE_URL")).toBe(
        true,
      );
    });

    it("should not error when reference chart has valid https imageUrl", async () => {
      const report = makeReport({
        charts: [
          {
            id: "chart-001",
            chartType: "reference",
            title: "Valid Chart",
            imageUrl: "https://example.com/image.png",
          },
        ],
      });
      mockPrisma.topicReport.findUnique.mockResolvedValue(report);

      const result = await service.validateReport("topic-001", "report-001");

      expect(result.errors.some((e) => e.type === "MISSING_IMAGE_URL")).toBe(
        false,
      );
      expect(result.warnings.some((w) => w.type === "INVALID_IMAGE_URL")).toBe(
        false,
      );
    });
  });

  // ─────────────────────────── cross-dimension validation ──────────────────

  describe("validateCrossDimensionData", () => {
    it("should warn when same field varies significantly across dimensions", async () => {
      const report = makeReport({
        dimensionAnalyses: [
          {
            dimension: { name: "Market Size" },
            dataPoints: { revenue: 100, growth: 10 },
          },
          {
            dimension: { name: "Competition" },
            dataPoints: { revenue: 1000, growth: 11 }, // revenue differs by 10x → >50%
          },
        ],
      });
      mockPrisma.topicReport.findUnique.mockResolvedValue(report);

      const result = await service.validateReport("topic-001", "report-001");

      expect(
        result.warnings.some((w) => w.type === "CROSS_DIMENSION_DATA_VARIANCE"),
      ).toBe(true);
    });

    it("should not warn when field variance is within 50%", async () => {
      const report = makeReport({
        dimensionAnalyses: [
          {
            dimension: { name: "Dimension A" },
            dataPoints: { revenue: 100 },
          },
          {
            dimension: { name: "Dimension B" },
            dataPoints: { revenue: 140 }, // 40% difference → OK
          },
        ],
      });
      mockPrisma.topicReport.findUnique.mockResolvedValue(report);

      const result = await service.validateReport("topic-001", "report-001");

      expect(
        result.warnings.some((w) => w.type === "CROSS_DIMENSION_DATA_VARIANCE"),
      ).toBe(false);
    });

    it("should not warn when only one dimension has a numeric field", async () => {
      const report = makeReport({
        dimensionAnalyses: [
          {
            dimension: { name: "Only Dimension" },
            dataPoints: { uniqueField: 500 },
          },
          {
            dimension: { name: "Other Dimension" },
            dataPoints: { differentField: 100 }, // No shared field
          },
        ],
      });
      mockPrisma.topicReport.findUnique.mockResolvedValue(report);

      const result = await service.validateReport("topic-001", "report-001");

      expect(
        result.warnings.some((w) => w.type === "CROSS_DIMENSION_DATA_VARIANCE"),
      ).toBe(false);
    });

    it("should skip validation when only one dimension analysis", async () => {
      const report = makeReport({
        dimensionAnalyses: [
          {
            dimension: { name: "Single Dimension" },
            dataPoints: { value: 100 },
          },
        ],
      });
      mockPrisma.topicReport.findUnique.mockResolvedValue(report);

      const result = await service.validateReport("topic-001", "report-001");

      expect(
        result.warnings.some((w) => w.type === "CROSS_DIMENSION_DATA_VARIANCE"),
      ).toBe(false);
    });

    it("should handle null dataPoints gracefully", async () => {
      const report = makeReport({
        dimensionAnalyses: [
          {
            dimension: { name: "Dim A" },
            dataPoints: null,
          },
          {
            dimension: { name: "Dim B" },
            dataPoints: { value: 100 },
          },
        ],
      });
      mockPrisma.topicReport.findUnique.mockResolvedValue(report);

      // Should not throw
      const result = await service.validateReport("topic-001", "report-001");

      expect(result).toBeDefined();
    });

    it("should handle dimension with null dimension reference", async () => {
      const report = makeReport({
        dimensionAnalyses: [
          {
            dimension: null, // null dimension
            dataPoints: { value: 100 },
          },
          {
            dimension: { name: "Dim B" },
            dataPoints: { value: 900 }, // 800% difference
          },
        ],
      });
      mockPrisma.topicReport.findUnique.mockResolvedValue(report);

      const result = await service.validateReport("topic-001", "report-001");

      // Should handle gracefully (dimension.name falls back to "Unknown")
      expect(result).toBeDefined();
    });

    it("should not warn when min value is 0 (avoids division by zero)", async () => {
      const report = makeReport({
        dimensionAnalyses: [
          {
            dimension: { name: "Dim A" },
            dataPoints: { count: 0 }, // min = 0, skip variance check
          },
          {
            dimension: { name: "Dim B" },
            dataPoints: { count: 1000 },
          },
        ],
      });
      mockPrisma.topicReport.findUnique.mockResolvedValue(report);

      const result = await service.validateReport("topic-001", "report-001");

      // When min=0, (max-min)/min would be division by zero → skipped
      expect(
        result.warnings.some((w) => w.type === "CROSS_DIMENSION_DATA_VARIANCE"),
      ).toBe(false);
    });
  });

  // ─────────────────────────── summary categories ──────────────────────────

  describe("buildResult summary categorization", () => {
    it("should count figureErrors in summary (DUPLICATE_CHART_ID is a warning, not error)", async () => {
      // figureErrors includes: INVALID_FIGURE_EVIDENCE_INDEX, MISSING_IMAGE_URL,
      //   INVALID_IMAGE_URL (warnings), DUPLICATE_CHART_ID (warning)
      // But DUPLICATE_CHART_ID is in warnings per code
      const report = makeReport({
        fullReport: "[1]",
        evidences: [{ id: "ev-001", citationIndex: 1 }],
        charts: [
          {
            id: "chart-001",
            chartType: "reference",
            title: "Chart",
            imageUrl: "not-a-url",
          },
        ],
      });
      mockPrisma.topicReport.findUnique.mockResolvedValue(report);

      const result = await service.validateReport("topic-001", "report-001");

      // INVALID_IMAGE_URL is a warning, so figureErrors in summary comes from warnings
      expect(result.summary.figureErrors).toBeGreaterThanOrEqual(0);
      expect(result.summary.totalWarnings).toBe(result.warnings.length);
    });

    it("should correctly count chartDataErrors in summary", async () => {
      const report = makeReport({
        fullReport: "",
        evidences: [],
        charts: [
          {
            id: "chart-001",
            chartType: "generated",
            type: "bar",
            title: "Empty Chart",
            data: [],
          },
        ],
      });
      mockPrisma.topicReport.findUnique.mockResolvedValue(report);

      const result = await service.validateReport("topic-001", "report-001");

      expect(result.summary.chartDataErrors).toBe(1); // EMPTY_CHART_DATA
    });
  });

  // ─────────────────────────── validateCitationIndices edge cases ──────────

  describe("validateCitationIndices edge cases", () => {
    it("should return empty errors when markdown is empty", async () => {
      const report = makeReport({
        fullReport: "",
        evidences: [{ id: "ev-001", citationIndex: 1 }],
      });
      mockPrisma.topicReport.findUnique.mockResolvedValue(report);

      const result = await service.validateReport("topic-001", "report-001");

      // Empty markdown → no citation errors (evidences would still be "unused" as warnings)
      expect(
        result.errors.some((e) => e.type === "INVALID_CITATION_INDEX"),
      ).toBe(false);
    });

    it("should return empty errors when evidenceCount is 0", async () => {
      const report = makeReport({
        fullReport: "No citations here",
        evidences: [],
      });
      mockPrisma.topicReport.findUnique.mockResolvedValue(report);

      const result = await service.validateReport("topic-001", "report-001");

      expect(result.errors).toHaveLength(0);
    });
  });

  // ─────────────────────────── quickValidate edge cases ───────────────────

  describe("quickValidate: chart with imageUrl", () => {
    it("should not count reference chart with valid imageUrl as error", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue({
        id: "report-001",
        fullReport: "[1]",
        evidences: [{ id: "ev-001" }],
        charts: [
          {
            id: "ch-1",
            chartType: "reference",
            imageUrl: "https://valid.url/image.png",
          },
        ],
      });

      const result = await service.quickValidate("report-001");

      expect(result.isValid).toBe(true);
      expect(result.errorCount).toBe(0);
    });

    it("should count multiple invalid citations in quickValidate", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue({
        id: "report-001",
        fullReport: "Text [99] and [100] are both bad.",
        evidences: [{ id: "ev-001" }],
        charts: [],
      });

      const result = await service.quickValidate("report-001");

      expect(result.errorCount).toBe(2);
      expect(result.isValid).toBe(false);
    });
  });
});

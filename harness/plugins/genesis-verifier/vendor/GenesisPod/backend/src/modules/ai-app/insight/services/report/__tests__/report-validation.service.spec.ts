/**
 * ReportValidationService Unit Tests
 *
 * Coverage targets:
 * - validateReport: report not found, valid report, invalid citation indices, unused evidence
 * - validateFigureReferences: duplicate ID, invalid evidence index, missing imageUrl
 * - validateChartData: NaN value, empty label, pie sum != 100, empty data, too many points
 * - validateCrossDimensionData: significant variance warning
 * - quickValidate: report not found, invalid citation, missing chart imageUrl
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ReportValidationService } from "../report-validation.service";
import { PrismaService } from "@/common/prisma/prisma.service";

// ──────────────────────────────────────────────────────────────────────────────
// Mock fixtures
// ──────────────────────────────────────────────────────────────────────────────

const makeReport = (overrides: Record<string, unknown> = {}) => ({
  id: "report-001",
  fullReport: "This is the report text [1] and [2] with citations.",
  charts: [],
  evidences: [
    { id: "ev-001", citationIndex: 1 },
    { id: "ev-002", citationIndex: 2 },
  ],
  dimensionAnalyses: [],
  ...overrides,
});

const mockPrisma = {
  topicReport: {
    findUnique: jest.fn(),
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// Test suite
// ──────────────────────────────────────────────────────────────────────────────

describe("ReportValidationService", () => {
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

  // ─────────────────────────── validateReport ───────────────────────────────

  describe("validateReport", () => {
    it("should return error when report not found", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue(null);

      const result = await service.validateReport("topic-001", "report-001");

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].type).toBe("REPORT_NOT_FOUND");
    });

    it("should return valid result for a clean report", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue(makeReport());

      const result = await service.validateReport("topic-001", "report-001");

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should detect out-of-range citation index", async () => {
      const report = makeReport({
        fullReport: "Text with bad citation [99].",
        evidences: [{ id: "ev-001", citationIndex: 1 }],
      });
      mockPrisma.topicReport.findUnique.mockResolvedValue(report);

      const result = await service.validateReport("topic-001", "report-001");

      expect(
        result.errors.some((e) => e.type === "INVALID_CITATION_INDEX"),
      ).toBe(true);
    });

    it("should warn about unused evidence", async () => {
      const report = makeReport({
        fullReport: "Text with only one citation [1].",
        evidences: [
          { id: "ev-001", citationIndex: 1 },
          { id: "ev-002", citationIndex: 2 }, // never cited
        ],
      });
      mockPrisma.topicReport.findUnique.mockResolvedValue(report);

      const result = await service.validateReport("topic-001", "report-001");

      expect(result.warnings.some((w) => w.type === "UNUSED_EVIDENCE")).toBe(
        true,
      );
    });

    it("should detect duplicate chart IDs", async () => {
      const report = makeReport({
        charts: [
          {
            id: "chart-001",
            chartType: "reference",
            title: "Chart A",
            imageUrl: "https://example.com/a.png",
          },
          {
            id: "chart-001",
            chartType: "reference",
            title: "Chart B duplicate",
            imageUrl: "https://example.com/b.png",
          },
        ],
        fullReport: "",
        evidences: [],
      });
      mockPrisma.topicReport.findUnique.mockResolvedValue(report);

      const result = await service.validateReport("topic-001", "report-001");

      expect(result.warnings.some((e) => e.type === "DUPLICATE_CHART_ID")).toBe(
        true,
      );
    });

    it("should error on reference chart with invalid evidence index", async () => {
      const report = makeReport({
        fullReport: "[1]",
        evidences: [{ id: "ev-001", citationIndex: 1 }],
        charts: [
          {
            id: "chart-001",
            chartType: "reference",
            title: "Chart",
            imageUrl: "https://example.com/chart.png",
            evidenceCitationIndex: 99, // out of range
          },
        ],
      });
      mockPrisma.topicReport.findUnique.mockResolvedValue(report);

      const result = await service.validateReport("topic-001", "report-001");

      expect(
        result.errors.some((e) => e.type === "INVALID_FIGURE_EVIDENCE_INDEX"),
      ).toBe(true);
    });

    it("should error on reference chart with missing imageUrl", async () => {
      const report = makeReport({
        fullReport: "[1]",
        evidences: [{ id: "ev-001", citationIndex: 1 }],
        charts: [
          {
            id: "chart-002",
            chartType: "reference",
            title: "No Image Chart",
            imageUrl: null,
          },
        ],
      });
      mockPrisma.topicReport.findUnique.mockResolvedValue(report);

      const result = await service.validateReport("topic-001", "report-001");

      expect(result.errors.some((e) => e.type === "MISSING_IMAGE_URL")).toBe(
        true,
      );
    });
  });

  // ─────────────────────────── chart data validation ────────────────────────

  describe("chart data validation", () => {
    it("should warn on NaN chart data value", async () => {
      const report = makeReport({
        fullReport: "",
        evidences: [],
        charts: [
          {
            id: "chart-001",
            chartType: "generated",
            type: "bar",
            title: "Test Chart",
            data: [{ label: "A", value: NaN }],
          },
        ],
      });
      mockPrisma.topicReport.findUnique.mockResolvedValue(report);

      const result = await service.validateReport("topic-001", "report-001");

      expect(result.warnings.some((w) => w.type === "INVALID_DATA_VALUE")).toBe(
        true,
      );
    });

    it("should warn on empty chart label", async () => {
      const report = makeReport({
        fullReport: "",
        evidences: [],
        charts: [
          {
            id: "chart-001",
            chartType: "generated",
            type: "bar",
            title: "Test Chart",
            data: [{ label: "", value: 42 }],
          },
        ],
      });
      mockPrisma.topicReport.findUnique.mockResolvedValue(report);

      const result = await service.validateReport("topic-001", "report-001");

      expect(result.warnings.some((w) => w.type === "EMPTY_DATA_LABEL")).toBe(
        true,
      );
    });

    it("should warn when pie chart does not sum to 100", async () => {
      const report = makeReport({
        fullReport: "",
        evidences: [],
        charts: [
          {
            id: "chart-pie",
            chartType: "generated",
            type: "pie",
            title: "Market Share",
            data: [
              { label: "A", value: 30 },
              { label: "B", value: 40 }, // total = 70, not 100
            ],
          },
        ],
      });
      mockPrisma.topicReport.findUnique.mockResolvedValue(report);

      const result = await service.validateReport("topic-001", "report-001");

      expect(
        result.warnings.some((w) => w.type === "PIE_CHART_SUM_NOT_100"),
      ).toBe(true);
    });

    it("should warn on empty chart data array", async () => {
      const report = makeReport({
        fullReport: "",
        evidences: [],
        charts: [
          {
            id: "chart-empty",
            chartType: "generated",
            type: "bar",
            title: "Empty Chart",
            data: [],
          },
        ],
      });
      mockPrisma.topicReport.findUnique.mockResolvedValue(report);

      const result = await service.validateReport("topic-001", "report-001");

      expect(result.warnings.some((w) => w.type === "EMPTY_CHART_DATA")).toBe(
        true,
      );
    });

    it("should warn when chart has too many data points", async () => {
      const manyPoints = Array.from({ length: 101 }, (_, i) => ({
        label: `Item ${i}`,
        value: i,
      }));
      const report = makeReport({
        fullReport: "",
        evidences: [],
        charts: [
          {
            id: "chart-big",
            chartType: "generated",
            type: "bar",
            title: "Big Chart",
            data: manyPoints,
          },
        ],
      });
      mockPrisma.topicReport.findUnique.mockResolvedValue(report);

      const result = await service.validateReport("topic-001", "report-001");

      expect(
        result.warnings.some((w) => w.type === "TOO_MANY_DATA_POINTS"),
      ).toBe(true);
    });
  });

  // ─────────────────────────── quickValidate ────────────────────────────────

  describe("quickValidate", () => {
    it("should return invalid when report not found", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue(null);

      const result = await service.quickValidate("nonexistent-report");

      expect(result.isValid).toBe(false);
      expect(result.errorCount).toBe(1);
    });

    it("should return valid for clean report", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue({
        id: "report-001",
        fullReport: "Text with [1] citation.",
        evidences: [{ id: "ev-001" }],
        charts: [],
      });

      const result = await service.quickValidate("report-001");

      expect(result.isValid).toBe(true);
      expect(result.errorCount).toBe(0);
    });

    it("should count invalid citations as errors", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue({
        id: "report-001",
        fullReport: "Text with [99] invalid citation.",
        evidences: [{ id: "ev-001" }],
        charts: [],
      });

      const result = await service.quickValidate("report-001");

      expect(result.errorCount).toBeGreaterThan(0);
    });

    it("should count reference charts without imageUrl as errors", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue({
        id: "report-001",
        fullReport: "",
        evidences: [],
        charts: [{ id: "ch-1", chartType: "reference", imageUrl: null }],
      });

      const result = await service.quickValidate("report-001");

      expect(result.errorCount).toBeGreaterThan(0);
    });
  });

  // ─────────────────────── summary structure ────────────────────────────────

  describe("validation result summary", () => {
    it("should populate summary counts correctly", async () => {
      const report = makeReport({
        fullReport: "Text [99] bad citation.",
        evidences: [{ id: "ev-001", citationIndex: 1 }],
      });
      mockPrisma.topicReport.findUnique.mockResolvedValue(report);

      const result = await service.validateReport("topic-001", "report-001");

      expect(result.summary.totalErrors).toBe(result.errors.length);
      expect(result.summary.totalWarnings).toBe(result.warnings.length);
      expect(result.summary.citationErrors).toBeGreaterThanOrEqual(0);
    });
  });
});

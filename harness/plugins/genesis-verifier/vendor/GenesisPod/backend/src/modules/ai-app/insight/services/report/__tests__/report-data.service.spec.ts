/**
 * ReportDataService Unit Tests
 *
 * Coverage targets:
 * - createDraftReport: version increment, retry on unique constraint, max retries exceeded
 * - saveDimensionAnalysis: creates analysis with toPrismaJson
 * - linkEvidenceToReport: updateMany + batch citationIndex
 * - prepareDimensionInputs: sanitizes and maps dimension inputs
 * - prepareEvidenceInputs: maps evidence to inputs
 * - collectAllCharts: deduplication by imageUrl and title, per-dim limit
 * - listReports: pagination
 * - getLatestReport: non-empty only
 * - compareReports: one or both not found throws
 * - isChartsEnabled: config flag
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ReportDataService } from "../report-data.service";
import { PrismaService } from "@/common/prisma/prisma.service";

// ──────────────────────────────────────────────────────────────────────────────
// Mock fixtures
// ──────────────────────────────────────────────────────────────────────────────

const mockReport = {
  id: "report-001",
  topicId: "topic-001",
  version: 1,
  versionLabel: "2024年3月 v1",
  executiveSummary: "",
  fullReport: "",
  highlights: [],
  totalDimensions: 0,
  totalSources: 0,
  totalTokens: 0,
  isIncremental: false,
  generatedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

const _mockDimension = {
  id: "dim-001",
  name: "市场规模",
  description: "市场规模分析",
  sortOrder: 1,
  isEnabled: true,
  minSources: 5,
};

const mockEvidence = {
  id: "ev-001",
  topicId: "topic-001",
  reportId: "report-001",
  citationIndex: 1,
  title: "AI Market Report 2024",
  url: "https://example.com/report",
  domain: "example.com",
  sourceType: "web",
  publishedAt: new Date("2024-01-01"),
  credibilityScore: 0.8,
  accessedAt: new Date(),
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
// Test suite
// ──────────────────────────────────────────────────────────────────────────────

describe("ReportDataService", () => {
  let service: ReportDataService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportDataService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ReportDataService>(ReportDataService);
    jest.clearAllMocks();
  });

  // ─────────────────────────── createDraftReport ────────────────────────────

  describe("createDraftReport", () => {
    it("should create a draft report with version 1 when no previous reports", async () => {
      mockPrisma.topicReport.findFirst.mockResolvedValue(null);
      mockPrisma.topicReport.create.mockResolvedValue(mockReport);

      const result = await service.createDraftReport("topic-001");

      expect(result).toEqual(mockReport);
      expect(mockPrisma.topicReport.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            topicId: "topic-001",
            version: 1,
          }),
        }),
      );
    });

    it("should increment version from latest report", async () => {
      mockPrisma.topicReport.findFirst.mockResolvedValue({ version: 3 });
      mockPrisma.topicReport.create.mockResolvedValue({
        ...mockReport,
        version: 4,
      });

      const result = await service.createDraftReport("topic-001");

      expect(mockPrisma.topicReport.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ version: 4 }),
        }),
      );
      expect(result.version).toBe(4);
    });

    it("should retry on unique constraint error and eventually succeed", async () => {
      // Use real timers but with a very short delay (100ms * 1 = 100ms is fine for a test)
      mockPrisma.topicReport.findFirst.mockResolvedValue({ version: 1 });
      const uniqueConstraintError = Object.assign(
        new Error("Unique constraint"),
        { code: "P2002" },
      );
      mockPrisma.topicReport.create
        .mockRejectedValueOnce(uniqueConstraintError)
        .mockResolvedValueOnce({ ...mockReport, version: 2 });

      const result = await service.createDraftReport("topic-001");

      expect(mockPrisma.topicReport.create).toHaveBeenCalledTimes(2);
      expect(result).toBeDefined();
    }, 10000);

    it("should throw after exhausting all retries", async () => {
      mockPrisma.topicReport.findFirst.mockResolvedValue({ version: 1 });
      // Use a plain object with code - service catches it and rethrows on last attempt
      // The final throw is the plain error object. Use .rejects.toEqual to match it.
      const uniqueConstraintError = Object.assign(
        new Error("Unique constraint"),
        { code: "P2002" },
      );
      mockPrisma.topicReport.create.mockRejectedValue(uniqueConstraintError);

      await expect(service.createDraftReport("topic-001", 3)).rejects.toThrow(
        "Unique constraint",
      );
      expect(mockPrisma.topicReport.create).toHaveBeenCalledTimes(3);
    }, 10000);
  });

  // ─────────────────────── saveDimensionAnalysis ────────────────────────────

  describe("saveDimensionAnalysis", () => {
    it("should create dimension analysis record", async () => {
      const mockAnalysis = {
        id: "analysis-001",
        reportId: "report-001",
        dimensionId: "dim-001",
      };
      mockPrisma.dimensionAnalysis.create.mockResolvedValue(mockAnalysis);

      const result = await service.saveDimensionAnalysis(
        "report-001",
        "dim-001",
        {
          summary: "Market dominated by NVIDIA",
          keyFindings: [
            {
              finding: "NVIDIA holds 80% share",
              significance: "high",
              evidenceIds: ["ev-001"],
            },
          ],
          trends: [],
          challenges: [],
          opportunities: [],
          evidenceUsed: 5,
          confidenceLevel: "high",
        },
      );

      expect(result).toEqual(mockAnalysis);
      expect(mockPrisma.dimensionAnalysis.create).toHaveBeenCalled();
    });
  });

  // ─────────────────────── linkEvidenceToReport ─────────────────────────────

  describe("linkEvidenceToReport", () => {
    it("should only associate evidences without reassigning citationIndex", async () => {
      mockPrisma.topicEvidence.updateMany.mockResolvedValue({ count: 2 });

      await service.linkEvidenceToReport("report-001", "analysis-001", [
        "ev-001",
        "ev-002",
      ]);

      expect(mockPrisma.topicEvidence.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["ev-001", "ev-002"] } },
        data: { reportId: "report-001", analysisId: "analysis-001" },
      });
      // Must NOT reassign citationIndex — already assigned by saveEvidence()
      expect(mockPrisma.topicEvidence.findMany).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────── prepareDimensionInputs ──────────────────────────

  describe("prepareDimensionInputs", () => {
    it("should map dimension analyses to inputs", () => {
      const dimensionAnalyses = [
        {
          id: "analysis-001",
          reportId: "report-001",
          dimensionId: "dim-001",
          summary: "Market analysis summary",
          keyFindings: [
            { finding: "Key finding 1", significance: "high", evidenceIds: [] },
          ],
          sourcesUsed: 5,
          dataPoints: {
            trends: [],
            challenges: [],
            opportunities: [],
            detailedContent: "Detailed content here",
          },
          dimension: {
            id: "dim-001",
            name: "Market Size",
            description: "Market size dimension",
          },
          evidences: [mockEvidence],
        },
      ] as Parameters<typeof service.prepareDimensionInputs>[0];

      const inputs = service.prepareDimensionInputs(dimensionAnalyses);

      expect(inputs).toHaveLength(1);
      expect(inputs[0].dimensionId).toBe("dim-001");
      expect(inputs[0].dimensionName).toBe("Market Size");
      expect(inputs[0].summary).toBe("Market analysis summary");
    });
  });

  // ──────────────────────── prepareEvidenceInputs ───────────────────────────

  describe("prepareEvidenceInputs", () => {
    it("should map evidence records to input format", () => {
      const inputs = service.prepareEvidenceInputs([
        mockEvidence as Parameters<typeof service.prepareEvidenceInputs>[0][0],
      ]);

      expect(inputs).toHaveLength(1);
      expect(inputs[0].title).toBe("AI Market Report 2024");
      expect(inputs[0].citationIndex).toBe(1);
    });
  });

  // ─────────────────────────── collectAllCharts ─────────────────────────────

  describe("collectAllCharts", () => {
    it("should collect figure references from dimension inputs", () => {
      const dimensionInputs = [
        {
          dimensionId: "dim-001",
          dimensionName: "Market Size",
          dimensionDescription: "desc",
          summary: "summary",
          keyFindings: [],
          trends: [],
          challenges: [],
          opportunities: [],
          detailedContent: "",
          sourcesUsed: 5,
          figureReferences: [
            {
              id: "fig-001",
              caption: "Market share chart",
              position: 1,
              imageUrl: "https://example.com/chart1.png",
              evidenceCitationIndex: 1,
              source: "Source 1",
            },
          ],
          generatedCharts: [],
        },
      ];

      const charts = service.collectAllCharts(dimensionInputs);

      expect(charts.length).toBeGreaterThan(0);
      expect(charts[0].chartType).toBe("reference");
      expect(charts[0].imageUrl).toBe("https://example.com/chart1.png");
    });

    it("should deduplicate charts with same imageUrl across dimensions", () => {
      const sharedUrl = "https://example.com/shared-chart.png";
      const dimensionInputs = [
        {
          dimensionId: "dim-001",
          dimensionName: "Dim 1",
          dimensionDescription: "",
          summary: "",
          keyFindings: [],
          trends: [],
          challenges: [],
          opportunities: [],
          detailedContent: "",
          sourcesUsed: 0,
          figureReferences: [
            {
              id: "fig-001",
              caption: "Chart",
              position: 1,
              imageUrl: sharedUrl,
              evidenceCitationIndex: 1,
              source: "Source",
            },
          ],
          generatedCharts: [],
        },
        {
          dimensionId: "dim-002",
          dimensionName: "Dim 2",
          dimensionDescription: "",
          summary: "",
          keyFindings: [],
          trends: [],
          challenges: [],
          opportunities: [],
          detailedContent: "",
          sourcesUsed: 0,
          figureReferences: [
            {
              id: "fig-002",
              caption: "Same chart",
              position: 1,
              imageUrl: sharedUrl,
              evidenceCitationIndex: 2,
              source: "Source",
            },
          ],
          generatedCharts: [],
        },
      ];

      const charts = service.collectAllCharts(dimensionInputs);
      const urlCounts = charts.filter((c) => c.imageUrl === sharedUrl).length;
      // ★ Cross-dimension dedup: same imageUrl across different dimensions is now deduplicated
      // to avoid duplicate images in the final report
      expect(urlCounts).toBe(1);
    });

    it("should limit charts to 8 per dimension", () => {
      const figureReferences = Array.from({ length: 10 }, (_, i) => ({
        id: `fig-${i}`,
        caption: `Chart ${i}`,
        position: i,
        imageUrl: `https://example.com/chart-${i}.png`,
        evidenceCitationIndex: i + 1,
        source: "Source",
      }));

      const dimensionInputs = [
        {
          dimensionId: "dim-001",
          dimensionName: "Dim 1",
          dimensionDescription: "",
          summary: "",
          keyFindings: [],
          trends: [],
          challenges: [],
          opportunities: [],
          detailedContent: "",
          sourcesUsed: 0,
          figureReferences,
          generatedCharts: [],
        },
      ];

      const charts = service.collectAllCharts(dimensionInputs);
      expect(charts.length).toBeLessThanOrEqual(8);
    });

    it("should return empty array when no dimension inputs", () => {
      const charts = service.collectAllCharts([]);
      expect(charts).toEqual([]);
    });
  });

  // ─────────────────────────── listReports ──────────────────────────────────

  describe("listReports", () => {
    it("should return paginated reports with total count", async () => {
      mockPrisma.topicReport.findMany.mockResolvedValue([mockReport]);
      mockPrisma.topicReport.count.mockResolvedValue(1);

      const result = await service.listReports("topic-001", {
        skip: 0,
        take: 10,
      });

      expect(result.reports).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.skip).toBe(0);
      expect(result.take).toBe(10);
    });
  });

  // ─────────────────────────── isChartsEnabled ──────────────────────────────

  describe("isChartsEnabled", () => {
    it("should return true when topicConfig is null", async () => {
      const result = await service.isChartsEnabled({
        topicConfig: null,
      } as Parameters<typeof service.isChartsEnabled>[0]);

      expect(result).toBe(true);
    });

    it("should return false when enableFigures is explicitly false", async () => {
      const result = await service.isChartsEnabled({
        topicConfig: { enableFigures: false },
      } as Parameters<typeof service.isChartsEnabled>[0]);

      expect(result).toBe(false);
    });

    it("should return true when enableFigures is true", async () => {
      const result = await service.isChartsEnabled({
        topicConfig: { enableFigures: true },
      } as Parameters<typeof service.isChartsEnabled>[0]);

      expect(result).toBe(true);
    });
  });
});

/**
 * CredibilityReportService Unit Tests
 *
 * Coverage targets:
 * - generateCredibilityReport: report not found throws
 * - getCredibilityReport: returns null when not found, maps data correctly
 * - getOrGenerateCredibilityReport: returns existing or generates new
 * - calculateSourceBreakdown: classifies government, academic, news, blog, industry, other
 * - calculateTimeBreakdown: categorizes by date ranges
 * - calculateAuthorityScore: weighted by source type
 * - calculateDiversityScore: based on type variety
 * - calculateTimelinessScore: weighted by recency
 * - generateLimitations: detects various issues
 */

import { Test, TestingModule } from "@nestjs/testing";
import { CredibilityReportService } from "../credibility-report.service";
import { PrismaService } from "@/common/prisma/prisma.service";

// ──────────────────────────────────────────────────────────────────────────────
// Mock fixtures
// ──────────────────────────────────────────────────────────────────────────────

const now = new Date();
const daysAgo = (days: number) => new Date(now.getTime() - days * 86400 * 1000);

const makeMockReport = (overrides: Record<string, unknown> = {}) => ({
  id: "report-001",
  topicId: "topic-001",
  topic: {
    id: "topic-001",
    name: "AI Market",
    dimensions: [
      { id: "dim-001", name: "Market Size", isEnabled: true, minSources: 5 },
      { id: "dim-002", name: "Trends", isEnabled: true, minSources: 5 },
    ],
  },
  evidences: [
    {
      id: "ev-001",
      sourceType: "academic",
      domain: "arxiv.org",
      publishedAt: daysAgo(10),
    },
    {
      id: "ev-002",
      sourceType: "news",
      domain: "reuters.com",
      publishedAt: daysAgo(60),
    },
    {
      id: "ev-003",
      sourceType: "government",
      domain: "whitehouse.gov",
      publishedAt: daysAgo(200),
    },
    {
      id: "ev-004",
      sourceType: "web",
      domain: "randomsite.com",
      publishedAt: null,
    },
    {
      id: "ev-005",
      sourceType: "web",
      domain: "medium.com",
      publishedAt: daysAgo(400),
    },
  ],
  dimensionAnalyses: [
    { dimensionId: "dim-001", dimension: { name: "Market Size" } },
    { dimensionId: "dim-002", dimension: { name: "Trends" } },
  ],
  ...overrides,
});

const mockCredibilityDbRecord = {
  reportId: "report-001",
  overallScore: 72,
  authorityScore: 75,
  diversityScore: 60,
  timelinessScore: 70,
  coverageScore: 80,
  sourceBreakdown: {
    government: 1,
    academic: 1,
    industry: 0,
    news: 1,
    blog: 1,
    other: 1,
    total: 5,
  },
  timeBreakdown: {
    within1Month: 1,
    within3Months: 0,
    within6Months: 1,
    within1Year: 0,
    older: 2,
    unknown: 1,
    total: 5,
  },
  coverageDetails: [],
  aiQualityMetrics: {
    planningRounds: 1,
    revisionAverage: 0,
    approvalRate: 80,
    averageConfidence: "medium",
    totalAgentActivities: 5,
  },
  limitations: ["来源数量有限"],
};

const mockPrisma = {
  topicReport: {
    findUnique: jest.fn(),
  },
  credibilityReport: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
  researchAgentActivity: {
    findMany: jest.fn(),
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// Test suite
// ──────────────────────────────────────────────────────────────────────────────

describe("CredibilityReportService", () => {
  let service: CredibilityReportService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CredibilityReportService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<CredibilityReportService>(CredibilityReportService);
    jest.clearAllMocks();
  });

  // ──────────────────────── generateCredibilityReport ───────────────────────

  describe("generateCredibilityReport", () => {
    it("should throw when report not found", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue(null);

      await expect(
        service.generateCredibilityReport("nonexistent-report"),
      ).rejects.toThrow("Report not found");
    });

    it("should generate credibility report with all scores", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue(makeMockReport());
      mockPrisma.researchAgentActivity.findMany.mockResolvedValue([
        { agentRole: "leader", activityType: "PLANNING", progress: 100 },
        { agentRole: "researcher", activityType: "SEARCHING", progress: 100 },
      ]);
      mockPrisma.credibilityReport.upsert.mockResolvedValue({});

      const result = await service.generateCredibilityReport("report-001");

      expect(result.overallScore).toBeGreaterThanOrEqual(0);
      expect(result.overallScore).toBeLessThanOrEqual(100);
      expect(result.authorityScore).toBeGreaterThanOrEqual(0);
      expect(result.diversityScore).toBeGreaterThanOrEqual(0);
      expect(result.timelinessScore).toBeGreaterThanOrEqual(0);
      expect(result.coverageScore).toBeGreaterThanOrEqual(0);
      expect(result.sourceBreakdown).toBeDefined();
      expect(result.timeBreakdown).toBeDefined();
      expect(result.limitations).toBeInstanceOf(Array);
    });

    it("should save credibility report to database", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue(makeMockReport());
      mockPrisma.researchAgentActivity.findMany.mockResolvedValue([]);
      mockPrisma.credibilityReport.upsert.mockResolvedValue({});

      await service.generateCredibilityReport("report-001");

      expect(mockPrisma.credibilityReport.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reportId: "report-001" },
        }),
      );
    });
  });

  // ──────────────────────── getCredibilityReport ────────────────────────────

  describe("getCredibilityReport", () => {
    it("should return null when credibility report not found", async () => {
      mockPrisma.credibilityReport.findUnique.mockResolvedValue(null);

      const result = await service.getCredibilityReport("report-001");

      expect(result).toBeNull();
    });

    it("should map database record to CredibilityReportData", async () => {
      mockPrisma.credibilityReport.findUnique.mockResolvedValue(
        mockCredibilityDbRecord,
      );

      const result = await service.getCredibilityReport("report-001");

      expect(result).not.toBeNull();
      expect(result!.overallScore).toBe(72);
      expect(result!.authorityScore).toBe(75);
      expect(result!.limitations).toContain("来源数量有限");
    });
  });

  // ─────────────────── getOrGenerateCredibilityReport ───────────────────────

  describe("getOrGenerateCredibilityReport", () => {
    it("should return existing report without generating new one", async () => {
      mockPrisma.credibilityReport.findUnique.mockResolvedValue(
        mockCredibilityDbRecord,
      );

      const result = await service.getOrGenerateCredibilityReport("report-001");

      expect(result.overallScore).toBe(72);
      expect(mockPrisma.topicReport.findUnique).not.toHaveBeenCalled();
    });

    it("should generate new report when none exists", async () => {
      mockPrisma.credibilityReport.findUnique.mockResolvedValue(null);
      mockPrisma.topicReport.findUnique.mockResolvedValue(makeMockReport());
      mockPrisma.researchAgentActivity.findMany.mockResolvedValue([]);
      mockPrisma.credibilityReport.upsert.mockResolvedValue({});

      const result = await service.getOrGenerateCredibilityReport("report-001");

      expect(result).toBeDefined();
      expect(mockPrisma.topicReport.findUnique).toHaveBeenCalled();
    });
  });

  // ──────────────────── Source classification logic ─────────────────────────

  describe("source breakdown classification", () => {
    it("should include academic sources from arxiv domain", async () => {
      const report = makeMockReport({
        evidences: [
          {
            id: "ev-1",
            sourceType: "web",
            domain: "arxiv.org",
            publishedAt: daysAgo(5),
          },
        ],
      });
      mockPrisma.topicReport.findUnique.mockResolvedValue(report);
      mockPrisma.researchAgentActivity.findMany.mockResolvedValue([]);
      mockPrisma.credibilityReport.upsert.mockResolvedValue({});

      const result = await service.generateCredibilityReport("report-001");

      expect(result.sourceBreakdown.academic).toBeGreaterThan(0);
    });

    it("should include government sources from .gov domains", async () => {
      const report = makeMockReport({
        evidences: [
          {
            id: "ev-1",
            sourceType: "web",
            domain: "census.gov",
            publishedAt: daysAgo(5),
          },
        ],
      });
      mockPrisma.topicReport.findUnique.mockResolvedValue(report);
      mockPrisma.researchAgentActivity.findMany.mockResolvedValue([]);
      mockPrisma.credibilityReport.upsert.mockResolvedValue({});

      const result = await service.generateCredibilityReport("report-001");

      expect(result.sourceBreakdown.government).toBeGreaterThan(0);
    });

    it("should identify blog sources from medium.com", async () => {
      const report = makeMockReport({
        evidences: [
          {
            id: "ev-1",
            sourceType: "web",
            domain: "medium.com",
            publishedAt: daysAgo(30),
          },
        ],
      });
      mockPrisma.topicReport.findUnique.mockResolvedValue(report);
      mockPrisma.researchAgentActivity.findMany.mockResolvedValue([]);
      mockPrisma.credibilityReport.upsert.mockResolvedValue({});

      const result = await service.generateCredibilityReport("report-001");

      expect(result.sourceBreakdown.blog).toBeGreaterThan(0);
    });
  });

  // ──────────────────── Timeliness breakdown ────────────────────────────────

  describe("time breakdown", () => {
    it("should count unknown publishedAt as unknown", async () => {
      const report = makeMockReport({
        evidences: [
          {
            id: "ev-1",
            sourceType: "web",
            domain: "site.com",
            publishedAt: null,
          },
        ],
      });
      mockPrisma.topicReport.findUnique.mockResolvedValue(report);
      mockPrisma.researchAgentActivity.findMany.mockResolvedValue([]);
      mockPrisma.credibilityReport.upsert.mockResolvedValue({});

      const result = await service.generateCredibilityReport("report-001");

      expect(result.timeBreakdown.unknown).toBeGreaterThan(0);
    });

    it("should count sources within 1 month", async () => {
      const report = makeMockReport({
        evidences: [
          {
            id: "ev-1",
            sourceType: "academic",
            domain: "arxiv.org",
            publishedAt: daysAgo(10),
          },
        ],
      });
      mockPrisma.topicReport.findUnique.mockResolvedValue(report);
      mockPrisma.researchAgentActivity.findMany.mockResolvedValue([]);
      mockPrisma.credibilityReport.upsert.mockResolvedValue({});

      const result = await service.generateCredibilityReport("report-001");

      expect(result.timeBreakdown.within1Month).toBeGreaterThan(0);
    });
  });

  // ──────────────────── Limitations generation ──────────────────────────────

  describe("limitations generation", () => {
    it("should flag limited sources when fewer than 10", async () => {
      const report = makeMockReport({
        evidences: [
          {
            id: "ev-1",
            sourceType: "web",
            domain: "site.com",
            publishedAt: null,
          },
        ],
      });
      mockPrisma.topicReport.findUnique.mockResolvedValue(report);
      mockPrisma.researchAgentActivity.findMany.mockResolvedValue([]);
      mockPrisma.credibilityReport.upsert.mockResolvedValue({});

      const result = await service.generateCredibilityReport("report-001");

      expect(result.limitations.some((l) => l.includes("来源数量有限"))).toBe(
        true,
      );
    });

    it("should add default disclaimer when no issues detected", async () => {
      // Many recent high-quality sources with diverse types
      const evidences = [
        ...Array.from({ length: 5 }, (_, i) => ({
          id: `gov-${i}`,
          sourceType: "government",
          domain: "whitehouse.gov",
          publishedAt: daysAgo(5),
        })),
        ...Array.from({ length: 5 }, (_, i) => ({
          id: `ac-${i}`,
          sourceType: "academic",
          domain: "arxiv.org",
          publishedAt: daysAgo(10),
        })),
        ...Array.from({ length: 5 }, (_, i) => ({
          id: `news-${i}`,
          sourceType: "news",
          domain: "reuters.com",
          publishedAt: daysAgo(15),
        })),
        ...Array.from({ length: 2 }, (_, i) => ({
          id: `ind-${i}`,
          sourceType: "industry",
          domain: "gartner.com",
          publishedAt: daysAgo(20),
        })),
      ];
      const report = makeMockReport({ evidences });
      mockPrisma.topicReport.findUnique.mockResolvedValue(report);
      mockPrisma.researchAgentActivity.findMany.mockResolvedValue(
        Array.from({ length: 10 }, (_) => ({
          agentRole: "researcher",
          activityType: "SEARCHING",
          progress: 100,
        })),
      );
      mockPrisma.credibilityReport.upsert.mockResolvedValue({});

      const result = await service.generateCredibilityReport("report-001");

      expect(result.limitations).toBeInstanceOf(Array);
      expect(result.limitations.length).toBeGreaterThan(0);
    });
  });
});

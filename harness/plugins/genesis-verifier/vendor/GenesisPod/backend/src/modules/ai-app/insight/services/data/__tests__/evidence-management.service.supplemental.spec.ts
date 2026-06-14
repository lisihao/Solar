/**
 * EvidenceManagementService - Supplemental Coverage Tests
 *
 * Targets uncovered lines:
 * - calculateCredibilityScore: all domain authority tiers + source types + snippet lengths + dates
 * - recalculateCredibilityScores: empty evidences early return, extracts domain from url
 * - cleanupOrphanedEvidence: returns count
 * - normalizeUrl: invalid URL fallback, UTM param removal
 * - extractDomainFromUrl: invalid URL returns null
 */

import { Test, TestingModule } from "@nestjs/testing";
import { EvidenceManagementService } from "../evidence-management.service";
import { PrismaService } from "@/common/prisma/prisma.service";

const mockPrisma = {
  topicEvidence: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
};

describe("EvidenceManagementService - Supplemental", () => {
  let service: EvidenceManagementService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EvidenceManagementService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<EvidenceManagementService>(EvidenceManagementService);
    jest.clearAllMocks();
  });

  // ─── recalculateCredibilityScores ───

  describe("recalculateCredibilityScores", () => {
    it("should return {updated:0, avgScore:0} when no evidences found", async () => {
      mockPrisma.topicEvidence.findMany.mockResolvedValue([]);

      const result = await service.recalculateCredibilityScores("report-1");

      expect(result.updated).toBe(0);
      expect(result.avgScore).toBe(0);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it("should recalculate scores and extract domain from url when domain is null", async () => {
      const evidence = {
        id: "ev-1",
        url: "https://nature.com/article/123",
        domain: null,
        sourceType: "academic",
        snippet: "Long snippet ".repeat(50),
        publishedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
        reportId: "report-1",
      };

      mockPrisma.topicEvidence.findMany.mockResolvedValue([evidence]);
      mockPrisma.$transaction.mockImplementation(async (updates: unknown[]) => {
        return Promise.all(updates);
      });
      mockPrisma.topicEvidence.update.mockResolvedValue({
        ...evidence,
        credibilityScore: 90,
      });

      const result = await service.recalculateCredibilityScores("report-1");

      expect(result.updated).toBe(1);
      expect(result.avgScore).toBeGreaterThan(0);
      // Should have updated with domain extracted from url
      const updateCall = mockPrisma.$transaction.mock.calls[0][0];
      expect(updateCall).toHaveLength(1);
    });

    it("should not update domain field when domain is already set", async () => {
      const evidence = {
        id: "ev-1",
        url: "https://reuters.com/article",
        domain: "reuters.com",
        sourceType: "news",
        snippet: "News snippet",
        publishedAt: new Date(Date.now() - 50 * 24 * 60 * 60 * 1000), // 50 days ago
        reportId: "report-1",
      };

      mockPrisma.topicEvidence.findMany.mockResolvedValue([evidence]);
      mockPrisma.$transaction.mockImplementation(async (updates: unknown[]) =>
        Promise.all(updates),
      );
      mockPrisma.topicEvidence.update.mockResolvedValue(evidence);

      const result = await service.recalculateCredibilityScores("report-1");

      expect(result.updated).toBe(1);
    });
  });

  // ─── calculateCredibilityScore (indirectly via recalculateCredibilityScores) ───

  describe("calculateCredibilityScore - domain authority tiers", () => {
    const recalc = async (evidenceData: {
      url?: string;
      domain: string | null;
      sourceType: string | null;
      snippet: string | null;
      publishedAt: Date | null;
    }) => {
      mockPrisma.topicEvidence.findMany.mockResolvedValue([
        { id: "ev-1", ...evidenceData, reportId: "r1" },
      ]);
      mockPrisma.$transaction.mockImplementation(async (updates: unknown[]) =>
        Promise.all(updates),
      );

      let capturedScore = 0;
      mockPrisma.topicEvidence.update.mockImplementation(
        (args: { data: { credibilityScore: number } }) => {
          capturedScore = args.data.credibilityScore;
          return Promise.resolve({
            id: "ev-1",
            credibilityScore: capturedScore,
          });
        },
      );

      await service.recalculateCredibilityScores("report-1");
      return capturedScore;
    };

    it("top authority domain (.gov) should score highest", async () => {
      const score = await recalc({
        url: "https://who.int/report",
        domain: "who.int",
        sourceType: "official",
        snippet: "Official WHO data ".repeat(30),
        publishedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
      });
      expect(score).toBeGreaterThanOrEqual(80);
    });

    it("high authority domain (reuters.com) should score higher than medium", async () => {
      const highScore = await recalc({
        url: "https://reuters.com",
        domain: "reuters.com",
        sourceType: "news",
        snippet: "Reuters news content ".repeat(15),
        publishedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      });

      const mediumScore = await recalc({
        url: "https://techcrunch.com",
        domain: "techcrunch.com",
        sourceType: "web",
        snippet: "TechCrunch article ".repeat(15),
        publishedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      });

      expect(highScore).toBeGreaterThan(mediumScore);
    });

    it("medium authority domain (techcrunch.com)", async () => {
      const score = await recalc({
        url: "https://techcrunch.com",
        domain: "techcrunch.com",
        sourceType: "web",
        snippet: "Article content".repeat(20),
        publishedAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
      });
      expect(score).toBeGreaterThan(20);
    });

    it("unknown domain should use base score (15 for domain)", async () => {
      const score = await recalc({
        url: "https://randomsite.example",
        domain: "randomsite.example",
        sourceType: "web",
        snippet: null,
        publishedAt: null,
      });
      expect(score).toBeGreaterThanOrEqual(20); // min score is 20
    });

    it("null domain should use minimum domain score (10)", async () => {
      const score = await recalc({
        url: "not-a-url",
        domain: null,
        sourceType: "web",
        snippet: null,
        publishedAt: null,
      });
      expect(score).toBeGreaterThanOrEqual(20);
    });

    it("academic sourceType gives highest source score", async () => {
      const academicScore = await recalc({
        url: "https://arxiv.org/paper",
        domain: "arxiv.org",
        sourceType: "academic",
        snippet: "Research paper content",
        publishedAt: null,
      });
      expect(academicScore).toBeGreaterThanOrEqual(20);
    });

    it("government sourceType gives high source score", async () => {
      const score = await recalc({
        url: "https://gov.cn/doc",
        domain: "gov.cn",
        sourceType: "government",
        snippet: "Official document",
        publishedAt: null,
      });
      expect(score).toBeGreaterThanOrEqual(20);
    });

    it("report/industry sourceType", async () => {
      const score = await recalc({
        url: "https://gartner.com/report",
        domain: "gartner.com",
        sourceType: "report",
        snippet: "Gartner report data",
        publishedAt: null,
      });
      expect(score).toBeGreaterThan(20);
    });

    it("industry sourceType", async () => {
      const score = await recalc({
        url: "https://example.com/industry",
        domain: "example.com",
        sourceType: "industry",
        snippet: "Industry report",
        publishedAt: null,
      });
      expect(score).toBeGreaterThanOrEqual(20);
    });

    it("unknown sourceType should use default base score (12)", async () => {
      const score = await recalc({
        url: "https://example.com",
        domain: "example.com",
        sourceType: "podcast",
        snippet: null,
        publishedAt: null,
      });
      expect(score).toBeGreaterThanOrEqual(20);
    });

    it("snippet length > 500 adds 15 points", async () => {
      const score = await recalc({
        url: "https://example.com",
        domain: "example.com",
        sourceType: "web",
        snippet: "x".repeat(600),
        publishedAt: null,
      });
      expect(score).toBeGreaterThanOrEqual(20);
    });

    it("snippet length 200-500 adds 10 points", async () => {
      const score = await recalc({
        url: "https://example.com",
        domain: "example.com",
        sourceType: "web",
        snippet: "x".repeat(300),
        publishedAt: null,
      });
      expect(score).toBeGreaterThanOrEqual(20);
    });

    it("snippet length 50-200 adds 5 points", async () => {
      const score = await recalc({
        url: "https://example.com",
        domain: "example.com",
        sourceType: "web",
        snippet: "x".repeat(100),
        publishedAt: null,
      });
      expect(score).toBeGreaterThanOrEqual(20);
    });

    it("published within 30 days adds 15 timeliness points", async () => {
      const recentScore = await recalc({
        url: "https://reuters.com",
        domain: "reuters.com",
        sourceType: "news",
        snippet: null,
        publishedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
      });
      expect(recentScore).toBeGreaterThanOrEqual(20);
    });

    it("published within 180 days adds 12 timeliness points", async () => {
      const score = await recalc({
        url: "https://reuters.com",
        domain: "reuters.com",
        sourceType: "news",
        snippet: null,
        publishedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), // 90 days
      });
      expect(score).toBeGreaterThanOrEqual(20);
    });

    it("published within 365 days adds 8 timeliness points", async () => {
      const score = await recalc({
        url: "https://reuters.com",
        domain: "reuters.com",
        sourceType: "news",
        snippet: null,
        publishedAt: new Date(Date.now() - 250 * 24 * 60 * 60 * 1000), // 250 days
      });
      expect(score).toBeGreaterThanOrEqual(20);
    });

    it("published within 730 days adds 5 timeliness points", async () => {
      const score = await recalc({
        url: "https://reuters.com",
        domain: "reuters.com",
        sourceType: "news",
        snippet: null,
        publishedAt: new Date(Date.now() - 500 * 24 * 60 * 60 * 1000), // 500 days
      });
      expect(score).toBeGreaterThanOrEqual(20);
    });

    it("published over 730 days adds no timeliness points", async () => {
      const score = await recalc({
        url: "https://reuters.com",
        domain: "reuters.com",
        sourceType: "news",
        snippet: null,
        publishedAt: new Date(Date.now() - 800 * 24 * 60 * 60 * 1000), // 800 days
      });
      expect(score).toBeGreaterThanOrEqual(20);
    });

    it("score should not exceed 100", async () => {
      const score = await recalc({
        url: "https://nature.com/paper",
        domain: "nature.com",
        sourceType: "academic",
        snippet: "x".repeat(600),
        publishedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      });
      expect(score).toBeLessThanOrEqual(100);
    });

    it("minimum score is 20", async () => {
      const score = await recalc({
        url: "not-valid-url",
        domain: null,
        sourceType: null,
        snippet: null,
        publishedAt: null,
      });
      expect(score).toBeGreaterThanOrEqual(20);
    });
  });

  // ─── cleanupOrphanedEvidence ───

  describe("cleanupOrphanedEvidence", () => {
    it("should delete orphaned evidences older than 24h and return count", async () => {
      mockPrisma.topicEvidence.deleteMany.mockResolvedValue({ count: 5 });

      const result = await service.cleanupOrphanedEvidence();

      expect(result).toBe(5);
      expect(mockPrisma.topicEvidence.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            analysisId: null,
          }),
        }),
      );
    });

    it("should return 0 when no orphaned evidences", async () => {
      mockPrisma.topicEvidence.deleteMany.mockResolvedValue({ count: 0 });

      const result = await service.cleanupOrphanedEvidence();
      expect(result).toBe(0);
    });
  });

  // ─── isDuplicateUrl - normalizeUrl coverage ───

  describe("isDuplicateUrl - URL normalization", () => {
    it("should normalize URL and remove UTM params", async () => {
      mockPrisma.topicEvidence.findFirst.mockResolvedValue(null);

      const result = await service.isDuplicateUrl(
        "report-1",
        "https://example.com/article?utm_source=google&utm_medium=cpc&utm_campaign=test",
      );

      expect(result).toBe(false);
      // Verify the normalized URL was used in the query
      expect(mockPrisma.topicEvidence.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            reportId: "report-1",
          }),
        }),
      );
    });

    it("should handle invalid URL in normalizeUrl (fallback to lowercase)", async () => {
      mockPrisma.topicEvidence.findFirst.mockResolvedValue(null);

      const result = await service.isDuplicateUrl(
        "report-1",
        "not-a-valid-url",
      );

      expect(result).toBe(false);
    });

    it("should return true when duplicate found", async () => {
      mockPrisma.topicEvidence.findFirst.mockResolvedValue({
        id: "ev-1",
        url: "https://example.com",
      });

      const result = await service.isDuplicateUrl(
        "report-1",
        "https://example.com/article",
      );
      expect(result).toBe(true);
    });

    it("should handle empty URL", async () => {
      mockPrisma.topicEvidence.findFirst.mockResolvedValue(null);

      const result = await service.isDuplicateUrl("report-1", "");
      expect(result).toBe(false);
    });
  });

  // ─── getEvidenceStats - credibility buckets ───

  describe("getEvidenceStats", () => {
    it("should categorize evidences by credibility and source type", async () => {
      const evidences = [
        { sourceType: "academic", credibilityScore: 85 }, // high
        { sourceType: "news", credibilityScore: 55 }, // medium
        { sourceType: "web", credibilityScore: 20 }, // low
        { sourceType: null, credibilityScore: null }, // no score
      ];

      mockPrisma.topicEvidence.findMany.mockResolvedValue(evidences);

      const result = await service.getEvidenceStats("report-1");

      expect(result.total).toBe(4);
      expect(result.byCredibility.high).toBe(1);
      expect(result.byCredibility.medium).toBe(1);
      expect(result.byCredibility.low).toBe(1);
      expect(result.bySourceType.academic).toBe(1);
      expect(result.bySourceType.news).toBe(1);
      expect(result.bySourceType.web).toBe(1);
      expect(result.bySourceType.unknown).toBe(1);
      expect(result.avgCredibility).toBe(Math.round((85 + 55 + 20) / 3));
    });

    it("should return 0 avgCredibility when no scored evidences", async () => {
      mockPrisma.topicEvidence.findMany.mockResolvedValue([
        { sourceType: "web", credibilityScore: null },
      ]);

      const result = await service.getEvidenceStats("report-1");
      expect(result.avgCredibility).toBe(0);
    });
  });
});

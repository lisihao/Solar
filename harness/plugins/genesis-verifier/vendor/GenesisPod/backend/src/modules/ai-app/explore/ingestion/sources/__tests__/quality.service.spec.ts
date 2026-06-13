import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { QualityService } from "../quality.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";

// ============================================================================
// Helpers
// ============================================================================

function makePrismaMock() {
  return {
    dataQualityMetric: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
      upsert: jest.fn(),
    },
    resource: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  };
}

function makeMetric(overrides: Record<string, unknown> = {}) {
  return {
    id: "metric-1",
    resourceId: "res-1",
    resourceType: "BLOG",
    qualityScore: 80,
    completenessScore: 75,
    relevanceScore: 0,
    duplicateScore: 0,
    isDuplicate: false,
    reviewStatus: "PENDING",
    reviewNote: null,
    reviewedAt: null,
    sourceUrl: "https://example.com",
    issues: [],
    tags: [],
    createdAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function makeResource(overrides: Record<string, unknown> = {}) {
  return {
    id: "res-1",
    title: "A Comprehensive Study on AI",
    content: "Full content of the article",
    abstract: null,
    pdfUrl: null,
    authors: ["Alice", "Bob"],
    publishedAt: new Date("2026-01-01"),
    metadata: { key: "value" },
    type: "BLOG",
    sourceUrl: "https://example.com",
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("QualityService", () => {
  let service: QualityService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();

    prisma = makePrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [QualityService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<QualityService>(QualityService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ---------- getIssues ----------

  describe("getIssues", () => {
    it("returns an empty array when no metrics are found", async () => {
      prisma.dataQualityMetric.findMany.mockResolvedValue([]);

      const result = await service.getIssues();

      expect(result).toEqual([]);
    });

    it("parses issues from the metric issues JSON array", async () => {
      const metric = makeMetric({
        issues: [
          { type: "MISSING_TITLE", severity: "HIGH", message: "No title" },
          { type: "MISSING_AUTHOR", severity: "MEDIUM", message: "No author" },
        ],
      });
      prisma.dataQualityMetric.findMany.mockResolvedValue([metric]);

      const result = await service.getIssues();

      expect(result).toHaveLength(2);
      expect(result[0].issueType).toBe("MISSING_TITLE");
      expect(result[0].severity).toBe("HIGH");
      expect(result[1].severity).toBe("MEDIUM");
    });

    it("skips metrics with null issues", async () => {
      const metric = makeMetric({ issues: null });
      prisma.dataQualityMetric.findMany.mockResolvedValue([metric]);

      const result = await service.getIssues();

      expect(result).toHaveLength(0);
    });

    it("filters issues by severity", async () => {
      const metric = makeMetric({
        issues: [
          { type: "MISSING_TITLE", severity: "HIGH", message: "No title" },
          { type: "SHORT_TITLE", severity: "LOW", message: "Too short" },
        ],
      });
      prisma.dataQualityMetric.findMany.mockResolvedValue([metric]);

      const result = await service.getIssues({ severity: "HIGH" });

      expect(result).toHaveLength(1);
      expect(result[0].severity).toBe("HIGH");
    });

    it("passes reviewStatus filter to prisma query", async () => {
      prisma.dataQualityMetric.findMany.mockResolvedValue([]);

      await service.getIssues({ reviewStatus: "REVIEWED" });

      const callArg = prisma.dataQualityMetric.findMany.mock.calls[0][0];
      expect(callArg.where.reviewStatus).toBe("REVIEWED");
    });

    it("applies the limit to prisma query", async () => {
      prisma.dataQualityMetric.findMany.mockResolvedValue([]);

      await service.getIssues({ limit: 25 });

      const callArg = prisma.dataQualityMetric.findMany.mock.calls[0][0];
      expect(callArg.take).toBe(25);
    });

    it("uses default limit of 100 when not specified", async () => {
      prisma.dataQualityMetric.findMany.mockResolvedValue([]);

      await service.getIssues();

      const callArg = prisma.dataQualityMetric.findMany.mock.calls[0][0];
      expect(callArg.take).toBe(100);
    });

    it("builds correct issue id from metricId and issue type", async () => {
      const metric = makeMetric({
        id: "m-42",
        issues: [
          { type: "MISSING_CONTENT", severity: "HIGH", message: "No content" },
        ],
      });
      prisma.dataQualityMetric.findMany.mockResolvedValue([metric]);

      const result = await service.getIssues();

      expect(result[0].id).toBe("m-42_MISSING_CONTENT");
    });
  });

  // ---------- getStats ----------

  describe("getStats", () => {
    it("returns zeros when there are no metrics", async () => {
      prisma.dataQualityMetric.findMany.mockResolvedValue([]);

      const stats = await service.getStats();

      expect(stats.totalResources).toBe(0);
      expect(stats.totalIssues).toBe(0);
      expect(stats.avgQualityScore).toBe(0);
      expect(stats.completenessRate).toBe(0);
      expect(stats.duplicateRate).toBe(0);
    });

    it("computes average quality score across metrics", async () => {
      const metrics = [
        makeMetric({
          qualityScore: 60,
          completenessScore: 50,
          isDuplicate: false,
          issues: [],
        }),
        makeMetric({
          id: "m-2",
          qualityScore: 80,
          completenessScore: 70,
          isDuplicate: false,
          issues: [],
        }),
      ];
      prisma.dataQualityMetric.findMany.mockResolvedValue(metrics);

      const stats = await service.getStats();

      expect(stats.avgQualityScore).toBeCloseTo(70, 1);
      expect(stats.completenessRate).toBeCloseTo(60, 1);
    });

    it("calculates duplicate rate correctly", async () => {
      const metrics = [
        makeMetric({ isDuplicate: true, issues: [] }),
        makeMetric({ id: "m-2", isDuplicate: false, issues: [] }),
      ];
      prisma.dataQualityMetric.findMany.mockResolvedValue(metrics);

      const stats = await service.getStats();

      expect(stats.duplicateRate).toBeCloseTo(50, 1);
    });

    it("counts issues by severity correctly", async () => {
      const metrics = [
        makeMetric({
          issues: [
            { type: "T1", severity: "HIGH", message: "m1" },
            { type: "T2", severity: "MEDIUM", message: "m2" },
            { type: "T3", severity: "LOW", message: "m3" },
          ],
        }),
      ];
      prisma.dataQualityMetric.findMany.mockResolvedValue(metrics);

      const stats = await service.getStats();

      expect(stats.highPriority).toBe(1);
      expect(stats.mediumPriority).toBe(1);
      expect(stats.lowPriority).toBe(1);
      expect(stats.totalIssues).toBe(3);
    });
  });

  // ---------- updateReviewStatus ----------

  describe("updateReviewStatus", () => {
    it("calls updateMany with the correct resourceId and status", async () => {
      prisma.dataQualityMetric.updateMany.mockResolvedValue({ count: 1 });

      await service.updateReviewStatus("res-1", "REVIEWED", "Looks good");

      expect(prisma.dataQualityMetric.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { resourceId: "res-1" },
          data: expect.objectContaining({
            reviewStatus: "REVIEWED",
            reviewNote: "Looks good",
          }),
        }),
      );
    });

    it("sets reviewedAt to a recent Date", async () => {
      prisma.dataQualityMetric.updateMany.mockResolvedValue({ count: 1 });

      const before = new Date();
      await service.updateReviewStatus("res-1", "CLOSED");
      const after = new Date();

      const { data } = prisma.dataQualityMetric.updateMany.mock.calls[0][0];
      expect(data.reviewedAt.getTime()).toBeGreaterThanOrEqual(
        before.getTime(),
      );
      expect(data.reviewedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it("works without an optional note", async () => {
      prisma.dataQualityMetric.updateMany.mockResolvedValue({ count: 1 });

      await expect(
        service.updateReviewStatus("res-1", "RESOLVED"),
      ).resolves.toBeUndefined();
    });
  });

  // ---------- assessResourceQuality ----------

  describe("assessResourceQuality", () => {
    it("returns null when the resource does not exist", async () => {
      prisma.resource.findUnique.mockResolvedValue(null);

      const result = await service.assessResourceQuality("nonexistent");

      expect(result).toBeNull();
    });

    it("returns quality scores and issues for a complete resource", async () => {
      prisma.resource.findUnique.mockResolvedValue(makeResource());
      prisma.dataQualityMetric.upsert.mockResolvedValue({});

      const result = await service.assessResourceQuality("res-1");

      expect(result).not.toBeNull();
      expect(result?.qualityScore).toBe(100); // all fields present → 20+30+20+15+15
      expect(result?.completenessScore).toBe(100);
      expect(result?.issues).toHaveLength(0);
    });

    it("detects MISSING_TITLE issue when title is absent", async () => {
      prisma.resource.findUnique.mockResolvedValue(
        makeResource({ title: null }),
      );
      prisma.dataQualityMetric.upsert.mockResolvedValue({});

      const result = await service.assessResourceQuality("res-1");

      const titles = result?.issues.filter((i) => i.type === "MISSING_TITLE");
      expect(titles).toHaveLength(1);
      expect(titles?.[0].severity).toBe("HIGH");
    });

    it("detects MISSING_CONTENT issue when no content, abstract, or pdfUrl", async () => {
      prisma.resource.findUnique.mockResolvedValue(
        makeResource({ content: null, abstract: null, pdfUrl: null }),
      );
      prisma.dataQualityMetric.upsert.mockResolvedValue({});

      const result = await service.assessResourceQuality("res-1");

      const contentIssues = result?.issues.filter(
        (i) => i.type === "MISSING_CONTENT",
      );
      expect(contentIssues).toHaveLength(1);
    });

    it("detects MISSING_AUTHOR when authors list is empty", async () => {
      prisma.resource.findUnique.mockResolvedValue(
        makeResource({ authors: [] }),
      );
      prisma.dataQualityMetric.upsert.mockResolvedValue({});

      const result = await service.assessResourceQuality("res-1");

      const authorIssues = result?.issues.filter(
        (i) => i.type === "MISSING_AUTHOR",
      );
      expect(authorIssues).toHaveLength(1);
      expect(authorIssues?.[0].severity).toBe("MEDIUM");
    });

    it("detects SHORT_TITLE when title is fewer than 10 characters", async () => {
      prisma.resource.findUnique.mockResolvedValue(
        makeResource({ title: "AI" }),
      );
      prisma.dataQualityMetric.upsert.mockResolvedValue({});

      const result = await service.assessResourceQuality("res-1");

      const shortTitles = result?.issues.filter(
        (i) => i.type === "SHORT_TITLE",
      );
      expect(shortTitles).toHaveLength(1);
      expect(shortTitles?.[0].severity).toBe("LOW");
    });

    it("upserts quality metric record with computed scores", async () => {
      prisma.resource.findUnique.mockResolvedValue(makeResource());
      prisma.dataQualityMetric.upsert.mockResolvedValue({});

      await service.assessResourceQuality("res-1");

      expect(prisma.dataQualityMetric.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            resourceType_resourceId: {
              resourceType: "BLOG",
              resourceId: "res-1",
            },
          },
          create: expect.objectContaining({ resourceId: "res-1" }),
          update: expect.objectContaining({ qualityScore: 100 }),
        }),
      );
    });

    it("accepts pdfUrl as a content source", async () => {
      prisma.resource.findUnique.mockResolvedValue(
        makeResource({
          content: null,
          abstract: null,
          pdfUrl: "https://arxiv.org/pdf/001.pdf",
        }),
      );
      prisma.dataQualityMetric.upsert.mockResolvedValue({});

      const result = await service.assessResourceQuality("res-1");

      const contentIssues = result?.issues.filter(
        (i) => i.type === "MISSING_CONTENT",
      );
      expect(contentIssues).toHaveLength(0);
    });
  });

  // ---------- batchAssessQuality ----------

  describe("batchAssessQuality", () => {
    it("returns the count of successfully assessed resources", async () => {
      const resources = [makeResource(), makeResource({ id: "res-2" })];
      prisma.resource.findMany.mockResolvedValue(resources);
      prisma.resource.findUnique
        .mockResolvedValueOnce(resources[0])
        .mockResolvedValueOnce(resources[1]);
      prisma.dataQualityMetric.upsert.mockResolvedValue({});

      const count = await service.batchAssessQuality(10);

      expect(count).toBe(2);
    });

    it("continues processing on individual failures and still returns a count", async () => {
      const resources = [makeResource(), makeResource({ id: "res-2" })];
      prisma.resource.findMany.mockResolvedValue(resources);
      // First resource lookup throws; second succeeds
      prisma.resource.findUnique
        .mockRejectedValueOnce(new Error("oops"))
        .mockResolvedValueOnce(resources[1]);
      prisma.dataQualityMetric.upsert.mockResolvedValue({});

      const count = await service.batchAssessQuality(10);

      expect(count).toBe(1);
    });

    it("uses the provided limit in the findMany query", async () => {
      prisma.resource.findMany.mockResolvedValue([]);

      await service.batchAssessQuality(50);

      expect(prisma.resource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );
    });

    it("defaults to limit 100 when called with no argument", async () => {
      prisma.resource.findMany.mockResolvedValue([]);

      await service.batchAssessQuality();

      expect(prisma.resource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });
  });
});

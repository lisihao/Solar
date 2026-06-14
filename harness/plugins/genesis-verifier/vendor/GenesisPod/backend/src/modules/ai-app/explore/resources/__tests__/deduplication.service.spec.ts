import { Test, TestingModule } from "@nestjs/testing";
import { DeduplicationService } from "../deduplication.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

describe("DeduplicationService", () => {
  let service: DeduplicationService;
  let mockPrisma: jest.Mocked<Partial<PrismaService>>;

  beforeEach(async () => {
    mockPrisma = {
      resource: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      } as unknown,
      deduplicationRecord: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
      } as unknown,
    } as jest.Mocked<Partial<PrismaService>>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeduplicationService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<DeduplicationService>(DeduplicationService);
  });

  describe("normalizeUrl", () => {
    it("should normalize https and remove tracking params", () => {
      const url =
        "http://example.com/article?utm_source=twitter&utm_medium=social";
      const normalized = service.normalizeUrl(url);

      expect(normalized).not.toContain("utm_source");
      expect(normalized).not.toContain("utm_medium");
      expect(normalized.startsWith("https")).toBe(true);
    });

    it("should remove trailing slash", () => {
      const url = "https://example.com/article/";
      const normalized = service.normalizeUrl(url);

      expect(normalized.endsWith("/")).toBe(false);
    });

    it("should normalize arXiv URLs to abs format", () => {
      const pdfUrl = "https://arxiv.org/pdf/2311.12345";
      const normalized = service.normalizeUrl(pdfUrl);

      expect(normalized).toBe("https://arxiv.org/abs/2311.12345");
    });

    it("should normalize GitHub URLs to repository root", () => {
      const url = "https://github.com/owner/repo/tree/main";
      const normalized = service.normalizeUrl(url);

      expect(normalized).toBe("https://github.com/owner/repo");
    });

    it("should normalize YouTube URLs to watch format and preserve case-sensitive video ID", () => {
      // YouTube video IDs are case-sensitive — kotam_vvnmy ≠ kOTAM_vVnMY.
      // Lowercasing destroys the ID; old behavior caused 8 corrupted records
      // before the 2026-04-29 fix.
      const shortenedUrl = "https://youtu.be/dQw4w9WgXcQ";
      const normalized = service.normalizeUrl(shortenedUrl);

      expect(normalized).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    });

    it("should lowercase host but preserve case in path", () => {
      const url = "https://EXAMPLE.COM/Article";
      const normalized = service.normalizeUrl(url);

      // host lowercased per RFC 3986; path case-sensitive
      expect(normalized).toBe("https://example.com/Article");
    });

    it("should return lowercased original URL when URL is invalid", () => {
      const invalidUrl = "not-a-url";
      const normalized = service.normalizeUrl(invalidUrl);

      expect(normalized).toBe("not-a-url");
    });

    it("should remove common tracking params (fbclid, gclid)", () => {
      const url = "https://example.com/article?fbclid=abc123&gclid=xyz789";
      const normalized = service.normalizeUrl(url);

      expect(normalized).not.toContain("fbclid");
      expect(normalized).not.toContain("gclid");
    });

    it("should keep GitHub blob and issues URLs as-is", () => {
      const url = "https://github.com/owner/repo/blob/main/README.md";
      const normalized = service.normalizeUrl(url);

      expect(normalized).toContain("/blob/");
    });
  });

  describe("computeFingerprint", () => {
    it("should return empty string for short content", () => {
      const result = service.computeFingerprint("short");
      expect(result).toBe("");
    });

    it("should return empty string for null/undefined content", () => {
      expect(service.computeFingerprint("")).toBe("");
    });

    it("should produce consistent fingerprints for same content", () => {
      const content =
        "This is a long enough piece of content to fingerprint properly with multiple words";
      const fp1 = service.computeFingerprint(content);
      const fp2 = service.computeFingerprint(content);

      expect(fp1).toBe(fp2);
    });

    it("should produce different fingerprints for different content", () => {
      const content1 =
        "This is content about machine learning and neural networks in deep learning research";
      const content2 =
        "This is content about cooking recipes and food preparation techniques for restaurants";
      const fp1 = service.computeFingerprint(content1);
      const fp2 = service.computeFingerprint(content2);

      expect(fp1).not.toBe(fp2);
    });

    it("should return a 32-character hex string for valid content", () => {
      const longContent =
        "This is a sufficiently long content string for fingerprinting purposes with many words";
      const fp = service.computeFingerprint(longContent);

      expect(fp).toHaveLength(32);
      expect(fp).toMatch(/^[0-9a-f]+$/);
    });
  });

  describe("computeTitleFingerprint", () => {
    it("should return empty string for short titles", () => {
      expect(service.computeTitleFingerprint("abc")).toBe("");
    });

    it("should return consistent fingerprints for same title", () => {
      const title = "Attention Is All You Need";
      expect(service.computeTitleFingerprint(title)).toBe(
        service.computeTitleFingerprint(title),
      );
    });

    it("should return a 16-character hex string for valid title", () => {
      const fp = service.computeTitleFingerprint("A Long Enough Title");

      expect(fp).toHaveLength(16);
    });
  });

  describe("computeUrlHash", () => {
    it("should compute a hash for a URL", () => {
      const hash = service.computeUrlHash("https://arxiv.org/abs/2311.12345");

      expect(hash).toHaveLength(16);
      expect(hash).toMatch(/^[0-9a-f]+$/);
    });

    it("should produce the same hash for normalized versions of same URL", () => {
      const hash1 = service.computeUrlHash("https://arxiv.org/pdf/2311.12345");
      const hash2 = service.computeUrlHash("https://arxiv.org/abs/2311.12345");

      // Both should normalize to abs format, so hashes should match
      expect(hash1).toBe(hash2);
    });
  });

  describe("calculateJaccardSimilarity", () => {
    it("should return 0 for empty strings", () => {
      expect(service.calculateJaccardSimilarity("", "hello world")).toBe(0);
      expect(service.calculateJaccardSimilarity("hello world", "")).toBe(0);
      expect(service.calculateJaccardSimilarity("", "")).toBe(0);
    });

    it("should return 1.0 for identical strings", () => {
      const text = "attention is all you need";
      expect(service.calculateJaccardSimilarity(text, text)).toBe(1.0);
    });

    it("should return 0 for completely different strings", () => {
      const similarity = service.calculateJaccardSimilarity(
        "apple orange banana",
        "dog cat fish",
      );
      expect(similarity).toBe(0);
    });

    it("should return partial similarity for overlapping strings", () => {
      const similarity = service.calculateJaccardSimilarity(
        "machine learning is great",
        "deep learning is also great",
      );
      expect(similarity).toBeGreaterThan(0);
      expect(similarity).toBeLessThan(1);
    });

    it("should be case-insensitive", () => {
      const sim1 = service.calculateJaccardSimilarity(
        "Hello World",
        "hello world",
      );
      expect(sim1).toBe(1.0);
    });
  });

  describe("checkDuplicate", () => {
    it("should detect exact URL match and return skipped action", async () => {
      (mockPrisma.resource!.findFirst as jest.Mock).mockResolvedValue({
        id: "existing-1",
      });

      const result = await service.checkDuplicate(
        "https://arxiv.org/abs/2311.12345",
        "Some Title",
      );

      expect(result.isDuplicate).toBe(true);
      expect(result.action).toBe("skipped");
      expect(result.reason).toBe("exact_url");
      expect(result.similarity).toBe(1.0);
    });

    it("should detect title similarity above threshold", async () => {
      (mockPrisma.resource!.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.resource!.findMany as jest.Mock).mockResolvedValue([
        { id: "similar-1", title: "Attention Is All You Need Paper" },
      ]);

      const result = await service.checkDuplicate(
        "https://example.com/paper",
        "Attention Is All You Need Paper",
        undefined,
        0.85,
      );

      expect(result.isDuplicate).toBe(true);
      expect(result.action).toBe("merged");
      expect(result.reason).toBe("title_similarity");
    });

    it("should detect content fingerprint match", async () => {
      (mockPrisma.resource!.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.resource!.findMany as jest.Mock).mockResolvedValue([]);
      (
        mockPrisma.deduplicationRecord!.findFirst as jest.Mock
      ).mockResolvedValue({
        resourceId: "existing-by-content",
      });

      const longContent =
        "This is a very long piece of content that should be fingerprinted ".repeat(
          5,
        );

      const result = await service.checkDuplicate(
        "https://example.com/new-article",
        "A Short Title",
        longContent,
      );

      expect(result.isDuplicate).toBe(true);
      expect(result.reason).toBe("content_fingerprint");
    });

    it("should return non-duplicate for unique content", async () => {
      (mockPrisma.resource!.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.resource!.findMany as jest.Mock).mockResolvedValue([]);
      (
        mockPrisma.deduplicationRecord!.findFirst as jest.Mock
      ).mockResolvedValue(null);

      const result = await service.checkDuplicate(
        "https://example.com/unique-article",
        "Completely Unique Title That Nobody Has Written",
      );

      expect(result.isDuplicate).toBe(false);
      expect(result.action).toBe("created");
    });

    it("should skip title check for short titles (< 10 chars)", async () => {
      (mockPrisma.resource!.findFirst as jest.Mock).mockResolvedValue(null);

      await service.checkDuplicate("https://example.com", "Short");

      expect(mockPrisma.resource!.findMany).not.toHaveBeenCalled();
    });

    it("should skip content fingerprint for short content (< 100 chars)", async () => {
      (mockPrisma.resource!.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.resource!.findMany as jest.Mock).mockResolvedValue([]);

      await service.checkDuplicate(
        "https://example.com",
        "A Long Enough Title Here",
        "Short content",
      );

      expect(mockPrisma.deduplicationRecord!.findFirst).not.toHaveBeenCalled();
    });
  });

  describe("assessQuality", () => {
    it("should assign high credibility for arxiv source", () => {
      const result = service.assessQuality({
        source: "arxiv",
        content: "Long content ".repeat(50),
        abstract: "Abstract ".repeat(30),
        publishedAt: new Date(),
      });

      expect(result.sourceCredibility).toBe(95);
    });

    it("should assign low credibility for unknown source", () => {
      const result = service.assessQuality({ source: "unknown" });
      expect(result.sourceCredibility).toBe(30);
    });

    it("should give 100 freshness score for content published within 7 days", () => {
      const result = service.assessQuality({
        source: "arxiv",
        publishedAt: new Date(), // today
      });

      expect(result.freshnessScore).toBe(100);
    });

    it("should give 90 freshness score for content published within 30 days", () => {
      const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
      const result = service.assessQuality({
        source: "arxiv",
        publishedAt: fifteenDaysAgo,
      });

      expect(result.freshnessScore).toBe(90);
    });

    it("should give 30 freshness score for old content (>365 days)", () => {
      const oldDate = new Date("2020-01-01");
      const result = service.assessQuality({
        source: "arxiv",
        publishedAt: oldDate,
      });

      expect(result.freshnessScore).toBe(30);
    });

    it("should give 50 freshness score when no publishedAt", () => {
      const result = service.assessQuality({ source: "arxiv" });
      expect(result.freshnessScore).toBe(50);
    });

    it("should add content completeness for abstract and content", () => {
      const result = service.assessQuality({
        source: "arxiv",
        abstract: "A".repeat(300), // > 200 chars
        content: "B".repeat(3000), // > 2000 chars
        authors: [{ name: "Author 1" }],
      });

      // 25 (abstract > 50) + 10 (abstract > 200) + 25 (content > 500) + 15 (content > 2000) + 15 (authors)
      expect(result.contentCompleteness).toBe(90);
    });

    it("should cap content completeness at 100", () => {
      const result = service.assessQuality({
        source: "arxiv",
        abstract: "A".repeat(500),
        content: "B".repeat(5000),
        authors: [{ name: "Author 1" }, { name: "Author 2" }],
      });

      expect(result.contentCompleteness).toBeLessThanOrEqual(100);
    });

    it("should calculate overall score as weighted average", () => {
      const result = service.assessQuality({
        source: "arxiv", // credibility 95
        abstract: "A".repeat(100),
        publishedAt: new Date(), // freshness 100
        citationCount: 50,
      });

      expect(result.overallScore).toBeGreaterThan(0);
      expect(result.overallScore).toBeLessThanOrEqual(100);
    });

    it("should handle case-insensitive source lookup", () => {
      const result = service.assessQuality({ source: "ARXIV" });
      expect(result.sourceCredibility).toBe(95);
    });
  });

  describe("mergeResources", () => {
    it("should return false when existing resource not found", async () => {
      (mockPrisma.resource!.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.mergeResources("non-existent", {
        title: "New",
      });

      expect(result).toBe(false);
    });

    it("should update with longer title from new data", async () => {
      (mockPrisma.resource!.findUnique as jest.Mock).mockResolvedValue({
        id: "existing-1",
        title: "Short",
        abstract: null,
        content: null,
        aiSummary: null,
      });

      const result = await service.mergeResources("existing-1", {
        title: "A Much Longer and Better Title",
      });

      expect(result).toBe(true);
      expect(mockPrisma.resource!.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: "A Much Longer and Better Title",
          }),
        }),
      );
    });

    it("should update with longer abstract from new data", async () => {
      (mockPrisma.resource!.findUnique as jest.Mock).mockResolvedValue({
        id: "existing-1",
        title: "Title",
        abstract: "Short abstract",
        content: null,
        aiSummary: null,
      });

      const result = await service.mergeResources("existing-1", {
        abstract:
          "A much longer and more detailed abstract with more information",
      });

      expect(result).toBe(true);
    });

    it("should not update when existing data is longer", async () => {
      (mockPrisma.resource!.findUnique as jest.Mock).mockResolvedValue({
        id: "existing-1",
        title: "A Very Long Existing Title That Is Better",
        abstract: "Very long existing abstract with lots of information",
        content: null,
        aiSummary: null,
      });

      const result = await service.mergeResources("existing-1", {
        title: "Short",
        abstract: "Short",
      });

      expect(result).toBe(false);
      expect(mockPrisma.resource!.update).not.toHaveBeenCalled();
    });

    it("should update content when new data has longer content", async () => {
      (mockPrisma.resource!.findUnique as jest.Mock).mockResolvedValue({
        id: "existing-1",
        title: "Title",
        abstract: null,
        content: "Short content",
        aiSummary: null,
      });

      const result = await service.mergeResources("existing-1", {
        content: "A much longer and more complete content for this resource",
      });

      expect(result).toBe(true);
    });

    it("should update aiSummary when new data has longer summary", async () => {
      (mockPrisma.resource!.findUnique as jest.Mock).mockResolvedValue({
        id: "existing-1",
        title: "Title",
        abstract: null,
        content: null,
        aiSummary: "Brief summary",
      });

      const result = await service.mergeResources("existing-1", {
        aiSummary:
          "A much more detailed and comprehensive AI-generated summary",
      });

      expect(result).toBe(true);
    });
  });

  describe("recordDeduplication", () => {
    it("should create a deduplication record in database", async () => {
      (mockPrisma.deduplicationRecord!.create as jest.Mock).mockResolvedValue({
        id: "record-1",
      });

      await service.recordDeduplication({
        taskId: "task-1",
        resourceId: "resource-1",
        duplicateOfId: "existing-1",
        method: "url_match",
        similarity: 1.0,
        decision: "AUTO_SKIP",
        originalData: { title: "Test", url: "https://example.com" },
        url: "https://example.com",
        title: "Test Title",
        content: "Test content for hashing purposes that is long enough",
      });

      expect(mockPrisma.deduplicationRecord!.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            taskId: "task-1",
            resourceId: "resource-1",
            method: "url_match",
            similarity: 1.0,
            decision: "AUTO_SKIP",
          }),
        }),
      );
    });

    it("should handle missing optional params (title, content)", async () => {
      (mockPrisma.deduplicationRecord!.create as jest.Mock).mockResolvedValue({
        id: "record-2",
      });

      await service.recordDeduplication({
        method: "url_match",
        similarity: 1.0,
        decision: "MERGED",
        originalData: {},
        url: "https://example.com",
      });

      expect(mockPrisma.deduplicationRecord!.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            titleHash: null,
            contentFingerprint: null,
          }),
        }),
      );
    });
  });

  describe("getStats", () => {
    it("should return total records and last 24h count", async () => {
      (mockPrisma.deduplicationRecord!.count as jest.Mock)
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(15);

      const result = await service.getStats();

      expect(result.totalRecords).toBe(100);
      expect(result.last24h).toBe(15);
    });

    it("should return zeros when no records", async () => {
      (mockPrisma.deduplicationRecord!.count as jest.Mock).mockResolvedValue(0);

      const result = await service.getStats();

      expect(result.totalRecords).toBe(0);
      expect(result.last24h).toBe(0);
    });
  });
});

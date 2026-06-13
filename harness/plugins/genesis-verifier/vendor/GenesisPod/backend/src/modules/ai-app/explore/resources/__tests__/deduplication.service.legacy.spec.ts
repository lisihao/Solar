import { Test, TestingModule } from "@nestjs/testing";
import { DeduplicationService } from "../deduplication.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

describe("DeduplicationService", () => {
  let service: DeduplicationService;

  const mockPrismaService = {
    resource: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    deduplicationRecord: {
      findFirst: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeduplicationService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<DeduplicationService>(DeduplicationService);

    // Reset mocks
    jest.clearAllMocks();
  });

  describe("normalizeUrl", () => {
    it("should remove tracking parameters", () => {
      const url =
        "https://example.com/page?utm_source=twitter&utm_medium=social&id=123";
      const normalized = service.normalizeUrl(url);
      expect(normalized).toBe("https://example.com/page?id=123");
    });

    it("should remove trailing slash", () => {
      const url = "https://example.com/page/";
      const normalized = service.normalizeUrl(url);
      expect(normalized).toBe("https://example.com/page");
    });

    it("should normalize arXiv URLs to abs format", () => {
      const pdfUrl = "https://arxiv.org/pdf/2311.12345";
      const normalized = service.normalizeUrl(pdfUrl);
      expect(normalized).toBe("https://arxiv.org/abs/2311.12345");
    });

    it("should normalize GitHub repo URLs", () => {
      const url = "https://github.com/owner/repo/tree/main/src";
      const normalized = service.normalizeUrl(url);
      expect(normalized).toBe("https://github.com/owner/repo");
    });

    it("should normalize YouTube URLs", () => {
      const shortUrl = "https://youtu.be/abc123xyz";
      const normalized = service.normalizeUrl(shortUrl);
      expect(normalized).toBe("https://www.youtube.com/watch?v=abc123xyz");
    });

    it("should convert HTTP to HTTPS", () => {
      const url = "http://example.com/page";
      const normalized = service.normalizeUrl(url);
      expect(normalized).toContain("https://");
    });

    it("should lowercase host but preserve path case", () => {
      // Path case is significant (YouTube IDs / Drive IDs / JWT tokens);
      // only host is lowercased per RFC 3986.
      const url = "https://Example.COM/PAGE";
      const normalized = service.normalizeUrl(url);
      expect(normalized).toBe("https://example.com/PAGE");
    });

    it("should handle invalid URLs gracefully", () => {
      const invalidUrl = "not-a-valid-url";
      const normalized = service.normalizeUrl(invalidUrl);
      expect(normalized).toBe("not-a-valid-url");
    });
  });

  describe("computeFingerprint", () => {
    it("should return empty string for short content", () => {
      const fp = service.computeFingerprint("short");
      expect(fp).toBe("");
    });

    it("should generate consistent fingerprint for same content", () => {
      const content =
        "This is a long enough content for fingerprinting purposes that exceeds fifty characters.";
      const fp1 = service.computeFingerprint(content);
      const fp2 = service.computeFingerprint(content);
      expect(fp1).toBe(fp2);
    });

    it("should generate different fingerprints for different content", () => {
      const content1 =
        "This is the first piece of content that is long enough for fingerprinting.";
      const content2 =
        "This is the second piece of content that is completely different from the first.";
      const fp1 = service.computeFingerprint(content1);
      const fp2 = service.computeFingerprint(content2);
      expect(fp1).not.toBe(fp2);
    });

    it("should ignore punctuation and special characters", () => {
      const content1 =
        "Hello, world! This is a test content for fingerprinting purposes.";
      const content2 =
        "Hello world This is a test content for fingerprinting purposes";
      const fp1 = service.computeFingerprint(content1);
      const fp2 = service.computeFingerprint(content2);
      expect(fp1).toBe(fp2);
    });

    it("should handle Chinese characters", () => {
      // The regex /[^\w\s\u4e00-\u9fa5]/g keeps Chinese characters
      // Need enough words (>2 chars each) after split to generate fingerprint
      const content =
        "这是 一段 用于 测试 的 中文 内容 需要 足够 长 才能 生成 指纹 这是 另一段 测试 内容 增加 长度";
      const fp = service.computeFingerprint(content);
      expect(fp).toHaveLength(32);
    });
  });

  describe("computeTitleFingerprint", () => {
    it("should return empty string for short titles", () => {
      const fp = service.computeTitleFingerprint("ab");
      expect(fp).toBe("");
    });

    it("should generate consistent fingerprint", () => {
      const title = "Understanding Large Language Models";
      const fp1 = service.computeTitleFingerprint(title);
      const fp2 = service.computeTitleFingerprint(title);
      expect(fp1).toBe(fp2);
      expect(fp1).toHaveLength(16);
    });

    it("should be case insensitive", () => {
      const fp1 = service.computeTitleFingerprint("Machine Learning Basics");
      const fp2 = service.computeTitleFingerprint("machine learning basics");
      expect(fp1).toBe(fp2);
    });
  });

  describe("calculateJaccardSimilarity", () => {
    it("should return 1 for identical strings", () => {
      const str = "hello world test";
      const similarity = service.calculateJaccardSimilarity(str, str);
      expect(similarity).toBe(1);
    });

    it("should return 0 for completely different strings", () => {
      const str1 = "hello world";
      const str2 = "foo bar baz";
      const similarity = service.calculateJaccardSimilarity(str1, str2);
      expect(similarity).toBe(0);
    });

    it("should return partial similarity for overlapping strings", () => {
      const str1 = "hello world test";
      const str2 = "hello world demo";
      const similarity = service.calculateJaccardSimilarity(str1, str2);
      expect(similarity).toBeGreaterThan(0);
      expect(similarity).toBeLessThan(1);
    });

    it("should return 0 for empty strings", () => {
      expect(service.calculateJaccardSimilarity("", "hello")).toBe(0);
      expect(service.calculateJaccardSimilarity("hello", "")).toBe(0);
    });
  });

  describe("checkDuplicate", () => {
    it("should detect exact URL match", async () => {
      mockPrismaService.resource.findFirst.mockResolvedValue({
        id: "existing-id",
      });

      const result = await service.checkDuplicate(
        "https://example.com/article",
        "Test Article",
      );

      expect(result.isDuplicate).toBe(true);
      expect(result.existingResourceId).toBe("existing-id");
      expect(result.similarity).toBe(1.0);
      expect(result.action).toBe("skipped");
      expect(result.reason).toBe("exact_url");
    });

    it("should detect title similarity", async () => {
      mockPrismaService.resource.findFirst.mockResolvedValue(null);
      mockPrismaService.resource.findMany.mockResolvedValue([
        {
          id: "similar-id",
          title: "Understanding Large Language Models: A Comprehensive Guide",
        },
      ]);

      const result = await service.checkDuplicate(
        "https://example.com/new-article",
        "Understanding Large Language Models: A Comprehensive Guide",
      );

      expect(result.isDuplicate).toBe(true);
      expect(result.existingResourceId).toBe("similar-id");
      expect(result.action).toBe("merged");
      expect(result.reason).toBe("title_similarity");
    });

    it("should return not duplicate for unique content", async () => {
      mockPrismaService.resource.findFirst.mockResolvedValue(null);
      mockPrismaService.resource.findMany.mockResolvedValue([]);
      mockPrismaService.deduplicationRecord.findFirst.mockResolvedValue(null);

      const result = await service.checkDuplicate(
        "https://example.com/unique-article",
        "Completely Unique Title",
      );

      expect(result.isDuplicate).toBe(false);
      expect(result.action).toBe("created");
    });

    it("should detect content fingerprint match", async () => {
      mockPrismaService.resource.findFirst.mockResolvedValue(null);
      mockPrismaService.resource.findMany.mockResolvedValue([]);
      mockPrismaService.deduplicationRecord.findFirst.mockResolvedValue({
        resourceId: "fingerprint-match-id",
      });

      const longContent =
        "This is a very long piece of content that contains more than one hundred characters for proper fingerprinting and deduplication testing purposes.";

      const result = await service.checkDuplicate(
        "https://example.com/article",
        "Some Title",
        longContent,
      );

      expect(result.isDuplicate).toBe(true);
      expect(result.existingResourceId).toBe("fingerprint-match-id");
      expect(result.action).toBe("merged");
      expect(result.reason).toBe("content_fingerprint");
    });
  });

  describe("assessQuality", () => {
    it("should assess high quality academic resource", () => {
      // Create content long enough to trigger all completeness bonuses
      const longContent = "A".repeat(2100); // > 2000 chars for full content bonus
      const longAbstract = "B".repeat(250); // > 200 chars for full abstract bonus

      const resource = {
        source: "arxiv",
        abstract: longAbstract,
        content: longContent,
        citationCount: 50,
        publishedAt: new Date(),
        authors: ["Author 1", "Author 2"],
      };

      const quality = service.assessQuality(resource);

      expect(quality.sourceCredibility).toBe(95);
      // abstract>50 (+25) + abstract>200 (+10) + content>500 (+25) + content>2000 (+15) + authors (+15) = 90
      expect(quality.contentCompleteness).toBeGreaterThanOrEqual(75);
      expect(quality.freshnessScore).toBe(100);
      expect(quality.citationCount).toBe(50);
      // overallScore = 95*0.3 + 90*0.3 + 100*0.2 + min(50/10,100)*0.2 = 28.5 + 27 + 20 + 10 = 85.5 -> 86
      expect(quality.overallScore).toBeGreaterThanOrEqual(70);
    });

    it("should assess low quality blog post", () => {
      const resource = {
        source: "blog",
        abstract: "Short abstract",
        publishedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000), // 400 days ago
      };

      const quality = service.assessQuality(resource);

      expect(quality.sourceCredibility).toBe(50);
      expect(quality.contentCompleteness).toBeLessThan(30);
      expect(quality.freshnessScore).toBe(30);
      expect(quality.overallScore).toBeLessThan(50);
    });

    it("should handle unknown source", () => {
      const resource = {
        source: "random_website",
      };

      const quality = service.assessQuality(resource);

      expect(quality.sourceCredibility).toBe(30);
    });

    it("should calculate freshness correctly", () => {
      // 1 day ago
      const recentResource = {
        source: "github",
        publishedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      };
      expect(service.assessQuality(recentResource).freshnessScore).toBe(100);

      // 15 days ago
      const weekOldResource = {
        source: "github",
        publishedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
      };
      expect(service.assessQuality(weekOldResource).freshnessScore).toBe(90);

      // 60 days ago
      const monthOldResource = {
        source: "github",
        publishedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      };
      expect(service.assessQuality(monthOldResource).freshnessScore).toBe(75);

      // 200 days ago
      const oldResource = {
        source: "github",
        publishedAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
      };
      expect(service.assessQuality(oldResource).freshnessScore).toBe(50);
    });
  });

  describe("mergeResources", () => {
    it("should merge longer content into existing resource", async () => {
      mockPrismaService.resource.findUnique.mockResolvedValue({
        id: "existing-id",
        title: "Short Title",
        abstract: "Short abstract",
        content: "Short content",
      });
      mockPrismaService.resource.update.mockResolvedValue({});

      const result = await service.mergeResources("existing-id", {
        title: "Much Longer and More Descriptive Title",
        abstract:
          "This is a much longer and more comprehensive abstract that provides better context",
        content:
          "This is a much longer and more detailed content that provides better information",
      });

      expect(result).toBe(true);
      expect(mockPrismaService.resource.update).toHaveBeenCalled();
    });

    it("should not update if new data is shorter", async () => {
      mockPrismaService.resource.findUnique.mockResolvedValue({
        id: "existing-id",
        title: "Existing Long Title That Is Very Descriptive",
        abstract:
          "Existing comprehensive abstract that provides detailed context",
        content: "Existing detailed content with lots of information",
      });

      const result = await service.mergeResources("existing-id", {
        title: "Short",
        abstract: "Short",
        content: "Short",
      });

      expect(result).toBe(false);
      expect(mockPrismaService.resource.update).not.toHaveBeenCalled();
    });

    it("should return false if resource not found", async () => {
      mockPrismaService.resource.findUnique.mockResolvedValue(null);

      const result = await service.mergeResources("non-existent-id", {
        title: "New Title",
      });

      expect(result).toBe(false);
    });
  });

  describe("recordDeduplication", () => {
    it("should create deduplication record", async () => {
      mockPrismaService.deduplicationRecord.create.mockResolvedValue({});

      await service.recordDeduplication({
        taskId: "task-1",
        resourceId: "resource-1",
        duplicateOfId: "existing-1",
        method: "title_similarity",
        similarity: 0.92,
        decision: "MERGED",
        originalData: { title: "Test Title" },
        url: "https://example.com/article",
        title: "Test Title",
        content:
          "Test content for fingerprinting purposes that is long enough.",
      });

      expect(mockPrismaService.deduplicationRecord.create).toHaveBeenCalledWith(
        {
          data: expect.objectContaining({
            taskId: "task-1",
            resourceId: "resource-1",
            duplicateOfId: "existing-1",
            method: "title_similarity",
            similarity: 0.92,
            decision: "MERGED",
            processedBy: "SYSTEM",
          }),
        },
      );
    });
  });

  describe("getStats", () => {
    it("should return deduplication statistics", async () => {
      mockPrismaService.deduplicationRecord.count
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(15);

      const stats = await service.getStats();

      expect(stats.totalRecords).toBe(100);
      expect(stats.last24h).toBe(15);
    });
  });
});

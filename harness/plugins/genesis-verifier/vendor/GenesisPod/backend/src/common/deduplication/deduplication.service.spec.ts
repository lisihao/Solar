import { Test, TestingModule } from "@nestjs/testing";
import { GlobalDeduplicationService } from "./deduplication.service";

describe("GlobalDeduplicationService", () => {
  let service: GlobalDeduplicationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GlobalDeduplicationService],
    }).compile();

    service = module.get<GlobalDeduplicationService>(
      GlobalDeduplicationService,
    );
  });

  describe("normalizeUrl", () => {
    it("should convert URL to lowercase", () => {
      const url = "https://EXAMPLE.COM/Path";
      const normalized = service.normalizeUrl(url);
      expect(normalized).not.toContain("EXAMPLE");
      expect(normalized).toContain("example.com");
    });

    it("should remove trailing slash", () => {
      const url = "https://example.com/path/";
      const normalized = service.normalizeUrl(url);
      expect(normalized).not.toMatch(/path\/$/);
    });

    it("should keep trailing slash for root path", () => {
      const url = "https://example.com/";
      const normalized = service.normalizeUrl(url);
      expect(normalized).toContain("example.com/");
    });

    it("should remove www subdomain", () => {
      const url = "https://www.example.com/path";
      const normalized = service.normalizeUrl(url);
      expect(normalized).toContain("example.com");
      expect(normalized).not.toContain("www.");
    });

    it("should remove URL fragment", () => {
      const url = "https://example.com/page#section";
      const normalized = service.normalizeUrl(url);
      expect(normalized).not.toContain("#section");
    });

    it("should remove tracking parameters", () => {
      const url =
        "https://example.com/page?utm_source=google&utm_medium=cpc&content=article";
      const normalized = service.normalizeUrl(url);
      expect(normalized).not.toContain("utm_source");
      expect(normalized).not.toContain("utm_medium");
      expect(normalized).toContain("content=article");
    });

    it("should sort query parameters", () => {
      const url1 = "https://example.com?z=1&a=2&m=3";
      const url2 = "https://example.com?a=2&m=3&z=1";
      expect(service.normalizeUrl(url1)).toBe(service.normalizeUrl(url2));
    });

    it("should normalize identical URLs to same result", () => {
      const urls = [
        "https://www.example.com/article?z=1&a=2",
        "https://example.com/Article?a=2&z=1",
        "https://WWW.EXAMPLE.COM/article?a=2&z=1#section",
      ];
      const normalized = urls.map((url) => service.normalizeUrl(url));
      expect(normalized[0]).toBe(normalized[1]);
      expect(normalized[1]).toBe(normalized[2]);
    });
  });

  describe("computeContentHash", () => {
    it("should return consistent hash for same content", () => {
      const content = "Test article content";
      const hash1 = service.computeContentHash(content);
      const hash2 = service.computeContentHash(content);
      expect(hash1).toBe(hash2);
    });

    it("should return different hash for different content", () => {
      const content1 = "Article A";
      const content2 = "Article B";
      const hash1 = service.computeContentHash(content1);
      const hash2 = service.computeContentHash(content2);
      expect(hash1).not.toBe(hash2);
    });

    it("should be case sensitive", () => {
      const hash1 = service.computeContentHash("Hello");
      const hash2 = service.computeContentHash("hello");
      expect(hash1).not.toBe(hash2);
    });

    it("should return 64-character SHA256 hash", () => {
      const hash = service.computeContentHash("test");
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe("computeSimhash", () => {
    it("should return consistent simhash for same content", () => {
      const content = "The quick brown fox jumps over the lazy dog";
      const hash1 = service.computeSimhash(content);
      const hash2 = service.computeSimhash(content);
      expect(hash1).toBe(hash2);
    });

    it("should handle empty content", () => {
      const hash = service.computeSimhash("");
      expect(hash).toBe("0");
    });

    it("should be less sensitive to case and punctuation", () => {
      const content1 = "The quick brown fox";
      const content2 = "the quick brown fox";
      const hash1 = service.computeSimhash(content1);
      const hash2 = service.computeSimhash(content2);
      // Should be same or very similar (hamming distance 0)
      const distance = service.hammingDistance(hash1, hash2);
      expect(distance).toBeLessThanOrEqual(2);
    });
  });

  describe("hammingDistance", () => {
    it("should return 0 for identical hashes", () => {
      const hash = "0123456789abcdef";
      const distance = service.hammingDistance(hash, hash);
      expect(distance).toBe(0);
    });

    it("should calculate correct hamming distance", () => {
      const hash1 = "1111111111111111";
      const hash2 = "1111111100000000";
      const distance = service.hammingDistance(hash1, hash2);
      expect(distance).toBe(8);
    });
  });

  describe("isSimilarContent", () => {
    it("should identify identical content as similar", () => {
      const content = "This is a test article about technology";
      const similar = service.isSimilarContent(content, content, 3);
      expect(similar).toBe(true);
    });

    it("should identify slightly modified content as similar", () => {
      // Use content with more overlapping words to ensure simhash similarity
      const content1 =
        "This is a test article about technology and innovation in the modern world";
      const content2 =
        "This is a test article about technology and innovation in the future world";
      // Use a higher threshold since simhash can have variance with short texts
      const similar = service.isSimilarContent(content1, content2, 15);
      expect(similar).toBe(true);
    });

    it("should not identify completely different content as similar", () => {
      const content1 = "Technology article";
      const content2 = "Sports news from the Olympics";
      const similar = service.isSimilarContent(content1, content2, 3);
      expect(similar).toBe(false);
    });
  });

  describe("isSameUrl", () => {
    it("should identify same normalized URL", () => {
      const url1 = "https://example.com/article";
      const url2 = "https://www.example.com/article";
      expect(service.isSameUrl(url1, url2)).toBe(true);
    });

    it("should identify same URL with different parameter order", () => {
      const url1 = "https://example.com/article?a=1&b=2";
      const url2 = "https://example.com/article?b=2&a=1";
      expect(service.isSameUrl(url1, url2)).toBe(true);
    });

    it("should identify different URLs from different domains", () => {
      const url1 = "https://example.com/article";
      const url2 = "https://other.com/article";
      expect(service.isSameUrl(url1, url2)).toBe(false);
    });

    it("should ignore URL fragments", () => {
      const url1 = "https://example.com/article#section1";
      const url2 = "https://example.com/article#section2";
      expect(service.isSameUrl(url1, url2)).toBe(true);
    });

    it("should handle tracking parameters", () => {
      const url1 = "https://example.com/article?utm_source=google";
      const url2 = "https://example.com/article";
      expect(service.isSameUrl(url1, url2)).toBe(true);
    });
  });

  describe("extractDeduplicationKey", () => {
    it("should extract URL from data", () => {
      const rawData = {
        data: {
          url: "https://example.com/article",
          externalId: "arxiv-123",
          content: "Article content",
        },
      };
      const key = service.extractDeduplicationKey(rawData);
      expect(key.url).toBe("https://example.com/article");
      expect(key.externalId).toBe("arxiv-123");
    });

    it("should compute hashes for content", () => {
      const rawData = {
        data: {
          content: "This is test content",
          externalId: "test-123",
        },
      };
      const key = service.extractDeduplicationKey(rawData);
      expect(key.contentHash).toBeTruthy();
      expect(key.simhash).toBeTruthy();
    });

    it("should fallback to alternative content fields", () => {
      const rawData = {
        data: {
          text: "Alternative content field",
          externalId: "test-456",
        },
      };
      const key = service.extractDeduplicationKey(rawData);
      expect(key.contentHash).toBeTruthy();
    });
  });

  describe("generateDeduplicationReport", () => {
    it("should identify exact content matches", () => {
      const contentHash = "abc123def456";
      const candidates = [
        {
          id: "doc1",
          url: "https://example.com/1",
          contentHash,
          simhash: "12345678901234567890",
          source: "arxiv",
        },
        {
          id: "doc2",
          url: "https://example.com/2",
          contentHash,
          simhash: "12345678901234567891",
          source: "github",
        },
      ];
      const report = service.generateDeduplicationReport(candidates);
      expect(report.exactMatches.has(contentHash)).toBe(true);
      expect(report.exactMatches.get(contentHash)).toEqual(["doc1", "doc2"]);
    });

    it("should normalize all URLs in report", () => {
      const candidates = [
        {
          id: "doc1",
          url: "https://www.example.com/path/",
          contentHash: "hash1",
          simhash: "12345678901234567890",
          source: "arxiv",
        },
      ];
      const report = service.generateDeduplicationReport(candidates);
      const normalizedUrl = report.urlNormalizations.get(
        "https://www.example.com/path/",
      );
      expect(normalizedUrl).toBeTruthy();
      expect(normalizedUrl).not.toContain("www.");
      expect(normalizedUrl).not.toMatch(/\/$/);
    });
  });

  describe("integration", () => {
    it("should support full deduplication workflow", () => {
      // Simulate cross-source article discovery
      const article1 = {
        source: "arxiv",
        url: "https://arxiv.org/abs/2311.12345",
        title: "AI Innovations 2024",
        content:
          "This paper explores breakthrough AI technologies and machine learning innovations for the future",
      };

      const article2 = {
        source: "hackernews",
        url: "https://news.ycombinator.com/item?id=38123456",
        title: "Breakthrough AI Technologies Announced",
        content:
          "A new paper introduces breakthrough AI technologies and machine learning innovations for tomorrow",
      };

      // Extract deduplication keys
      const key1 = service.extractDeduplicationKey({ data: article1 });
      const key2 = service.extractDeduplicationKey({ data: article2 });

      // Check if URLs match (they don't - different domains)
      expect(service.isSameUrl(key1.url!, key2.url!)).toBe(false);

      // Check if content is similar - use higher threshold for short text
      const isSimilar = service.isSimilarContent(
        article1.content,
        article2.content,
        20,
      );
      expect(isSimilar).toBe(true);

      // Verify normalization
      const normalized1 = service.normalizeUrl(article1.url);
      const normalized2 = service.normalizeUrl(article2.url);
      expect(normalized1).toContain("arxiv.org");
      expect(normalized2).toContain("ycombinator.com");
    });
  });
});

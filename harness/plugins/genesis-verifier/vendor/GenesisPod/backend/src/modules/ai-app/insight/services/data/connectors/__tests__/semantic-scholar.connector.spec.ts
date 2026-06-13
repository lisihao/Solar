import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "@/common/prisma/prisma.service";
import { SecretsService } from "@/modules/platform/facade";
import { ToolKeyResolverService } from "@/modules/platform/credentials/resolution/tool-key-resolver/tool-key-resolver.service";
import { RequestContext } from "@/common/context/request-context";
import { SemanticScholarConnector } from "../semantic-scholar.connector";
import { DataSourceType } from "../../../../types/data-source.types";

const mockFetch = jest.fn();
global.fetch = mockFetch;

const mockConfigService = {
  get: jest.fn(),
};

const mockPrismaService = {
  toolConfig: {
    findUnique: jest.fn().mockResolvedValue(null),
  },
};

const mockSecretsService = {
  getValue: jest.fn().mockResolvedValue(null),
};

const mockToolKeyResolverService = {
  resolveToolKey: jest.fn().mockResolvedValue(null),
};

describe("SemanticScholarConnector", () => {
  let connector: SemanticScholarConnector;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConfigService.get.mockReturnValue(undefined);
    mockPrismaService.toolConfig.findUnique.mockResolvedValue(null);
    mockSecretsService.getValue.mockResolvedValue(null);
    mockToolKeyResolverService.resolveToolKey.mockResolvedValue(null);
    // Default: no userId (system path)
    jest.spyOn(RequestContext, "getUserId").mockReturnValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SemanticScholarConnector,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: SecretsService, useValue: mockSecretsService },
        {
          provide: ToolKeyResolverService,
          useValue: mockToolKeyResolverService,
        },
      ],
    }).compile();

    connector = module.get<SemanticScholarConnector>(SemanticScholarConnector);
  });

  describe("connector metadata", () => {
    it("should have correct sourceType", () => {
      expect(connector.sourceType).toBe(DataSourceType.SEMANTIC_SCHOLAR);
    });

    it("should have correct displayName", () => {
      expect(connector.displayName).toBe("Semantic Scholar");
    });

    it("should not require API key", () => {
      expect(connector.requiresApiKey).toBe(false);
    });
  });

  describe("search", () => {
    const mockPaper = {
      paperId: "abc123",
      title: "Deep Learning for NLP",
      abstract: "We present a new approach to natural language processing...",
      url: "https://www.semanticscholar.org/paper/abc123",
      year: 2023,
      citationCount: 150,
      authors: [
        { name: "Alice Smith", authorId: "author1" },
        { name: "Bob Jones", authorId: "author2" },
      ],
      venue: "NeurIPS",
      fieldsOfStudy: ["Computer Science", "Linguistics"],
      isOpenAccess: true,
      publicationDate: "2023-06-15",
    };

    it("should return results when API succeeds", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: [mockPaper],
          total: 1,
        }),
      });

      const results = await connector.search("deep learning NLP", 10);

      expect(results).toHaveLength(1);
      expect(results[0].sourceType).toBe(DataSourceType.SEMANTIC_SCHOLAR);
      expect(results[0].title).toBe("Deep Learning for NLP");
      expect(results[0].url).toBe(
        "https://www.semanticscholar.org/paper/abc123",
      );
      expect(results[0].domain).toBe("semanticscholar.org");
      expect(results[0].metadata?.paperId).toBe("abc123");
      expect(results[0].metadata?.citationCount).toBe(150);
      expect(results[0].metadata?.authors).toEqual([
        "Alice Smith",
        "Bob Jones",
      ]);
      expect(results[0].metadata?.venue).toBe("NeurIPS");
      expect(results[0].metadata?.fieldsOfStudy).toEqual([
        "Computer Science",
        "Linguistics",
      ]);
      expect(results[0].metadata?.isOpenAccess).toBe(true);
      expect(results[0].metadata?.sourceConnector).toBe("semantic-scholar");
    });

    it("should use abstract as snippet when available", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: [mockPaper] }),
      });

      const results = await connector.search("test", 5);

      expect(results[0].snippet).toContain(
        "We present a new approach to natural language processing",
      );
    });

    it("should fall back to title/author snippet when abstract is missing", async () => {
      const paperNoAbstract = { ...mockPaper, abstract: undefined };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: [paperNoAbstract] }),
      });

      const results = await connector.search("test", 5);

      expect(results[0].snippet).toContain("Deep Learning for NLP");
      expect(results[0].snippet).toContain("Citations: 150");
    });

    it("should use publicationDate for publishedAt when available", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: [mockPaper] }),
      });

      const results = await connector.search("test", 5);

      expect(results[0].publishedAt).toBeInstanceOf(Date);
      expect(results[0].publishedAt?.getFullYear()).toBe(2023);
    });

    it("should fall back to year-based date when publicationDate is missing", async () => {
      const paperWithYear = {
        ...mockPaper,
        publicationDate: undefined,
        year: 2021,
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: [paperWithYear] }),
      });

      const results = await connector.search("test", 5);

      expect(results[0].publishedAt).toBeInstanceOf(Date);
      // Year could be 2020 or 2021 depending on timezone when parsing "2021-01-01"
      const year = results[0].publishedAt?.getFullYear();
      expect(year === 2020 || year === 2021).toBe(true);
    });

    it("should leave publishedAt undefined when no date info available", async () => {
      const paperNoDate = {
        ...mockPaper,
        publicationDate: undefined,
        year: undefined,
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: [paperNoDate] }),
      });

      const results = await connector.search("test", 5);

      expect(results[0].publishedAt).toBeUndefined();
    });

    it("should use semanticscholar.org URL when paper URL is missing", async () => {
      const paperNoUrl = { ...mockPaper, url: undefined };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: [paperNoUrl] }),
      });

      const results = await connector.search("test", 5);

      expect(results[0].url).toBe(
        "https://www.semanticscholar.org/paper/abc123",
      );
    });

    it("should return empty array when API returns empty data", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: [], total: 0 }),
      });

      const results = await connector.search("very obscure topic", 10);

      expect(results).toEqual([]);
    });

    it("should return empty array when data field is missing", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ total: 0 }),
      });

      const results = await connector.search("test", 5);

      expect(results).toEqual([]);
    });

    it("should return empty array when API fails", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
      });

      const results = await connector.search("test", 5);

      expect(results).toEqual([]);
    });

    it("should return empty array on network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const results = await connector.search("test", 5);

      expect(results).toEqual([]);
    });

    it("should cap maxResults at 100", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: [] }),
      });

      await connector.search("test", 500);

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("limit=100");
    });

    it("should include citation sort when sortBy is citations", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: [] }),
      });

      await connector.search("test", 10, { sortBy: "citations" });

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("sort=citationCount%3Adesc");
    });

    it("should include API key header when configured", async () => {
      mockConfigService.get.mockReturnValue("test-ss-api-key");

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SemanticScholarConnector,
          { provide: ConfigService, useValue: mockConfigService },
          { provide: PrismaService, useValue: mockPrismaService },
          { provide: SecretsService, useValue: mockSecretsService },
          {
            provide: ToolKeyResolverService,
            useValue: mockToolKeyResolverService,
          },
        ],
      }).compile();

      const connectorWithKey = module.get<SemanticScholarConnector>(
        SemanticScholarConnector,
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: [] }),
      });

      await connectorWithKey.search("test", 5);

      const callOptions = mockFetch.mock.calls[0][1] as RequestInit;
      expect(
        (callOptions.headers as Record<string, string>)?.["x-api-key"],
      ).toBe("test-ss-api-key");
    });

    it("should truncate abstract to 500 characters for snippet", async () => {
      const longAbstract = "A".repeat(600);
      const paperLongAbstract = { ...mockPaper, abstract: longAbstract };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: [paperLongAbstract] }),
      });

      const results = await connector.search("test", 5);

      expect(results[0].snippet.length).toBeLessThanOrEqual(500);
    });
  });

  describe("isAvailable", () => {
    it("should return true when API is reachable", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const available = await connector.isAvailable();

      expect(available).toBe(true);
    });

    it("should return false when API returns error", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

      const available = await connector.isAvailable();

      expect(available).toBe(false);
    });

    it("should return false when fetch throws", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Timeout"));

      const available = await connector.isAvailable();

      expect(available).toBe(false);
    });
  });

  describe("healthCheck", () => {
    it("should return available=true on success", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const health = await connector.healthCheck();

      expect(health.available).toBe(true);
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
      expect(health.lastChecked).toBeInstanceOf(Date);
      expect(health.error).toBeUndefined();
    });

    it("should return error message when API fails", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 429 });

      const health = await connector.healthCheck();

      expect(health.available).toBe(false);
      expect(health.error).toBe("HTTP 429");
    });

    it("should return error string when fetch throws", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

      const health = await connector.healthCheck();

      expect(health.available).toBe(false);
      expect(health.error).toContain("Connection refused");
    });

    it("should include API key header in healthCheck when available", async () => {
      mockConfigService.get.mockReturnValue("health-check-api-key");

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SemanticScholarConnector,
          { provide: ConfigService, useValue: mockConfigService },
          { provide: PrismaService, useValue: mockPrismaService },
          { provide: SecretsService, useValue: mockSecretsService },
          {
            provide: ToolKeyResolverService,
            useValue: mockToolKeyResolverService,
          },
        ],
      }).compile();

      const connectorWithKey = module.get<SemanticScholarConnector>(
        SemanticScholarConnector,
      );

      mockFetch.mockResolvedValueOnce({ ok: true });

      await connectorWithKey.healthCheck();

      const callOptions = mockFetch.mock.calls[0][1] as RequestInit;
      expect(
        (callOptions.headers as Record<string, string>)?.["x-api-key"],
      ).toBe("health-check-api-key");
    });
  });

  describe("getApiKey - cache and secretsService branches", () => {
    it("should use cached API key on second call (cache hit)", async () => {
      mockConfigService.get.mockReturnValue("cached-api-key");

      mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: [] }),
      });

      // First call - loads from config
      await connector.search("test1", 5);
      // Second call - should use cache (no second DB lookup)
      await connector.search("test2", 5);

      // toolConfig.findUnique should be called only once (first load)
      expect(mockPrismaService.toolConfig.findUnique).toHaveBeenCalledTimes(1);
    });

    it("should use secretKey from SecretsService when available", async () => {
      mockPrismaService.toolConfig.findUnique.mockResolvedValueOnce({
        secretKey: "secret-ref-key",
      });
      mockSecretsService.getValue.mockResolvedValueOnce("decrypted-api-key");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: [] }),
      });

      await connector.search("test", 5);

      const callOptions = mockFetch.mock.calls[0][1] as RequestInit;
      expect(
        (callOptions.headers as Record<string, string>)?.["x-api-key"],
      ).toBe("decrypted-api-key");
    });

    it("should fall back to env var when secretsService returns null", async () => {
      mockPrismaService.toolConfig.findUnique.mockResolvedValueOnce({
        secretKey: "secret-ref-key",
      });
      mockSecretsService.getValue.mockResolvedValueOnce(null);
      mockConfigService.get.mockReturnValue("env-fallback-key");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: [] }),
      });

      await connector.search("test", 5);

      const callOptions = mockFetch.mock.calls[0][1] as RequestInit;
      expect(
        (callOptions.headers as Record<string, string>)?.["x-api-key"],
      ).toBe("env-fallback-key");
    });

    it("should include API key header in isAvailable when configured", async () => {
      mockConfigService.get.mockReturnValue("is-available-key");

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SemanticScholarConnector,
          { provide: ConfigService, useValue: mockConfigService },
          { provide: PrismaService, useValue: mockPrismaService },
          { provide: SecretsService, useValue: mockSecretsService },
          {
            provide: ToolKeyResolverService,
            useValue: mockToolKeyResolverService,
          },
        ],
      }).compile();

      const connectorWithKey = module.get<SemanticScholarConnector>(
        SemanticScholarConnector,
      );

      mockFetch.mockResolvedValueOnce({ ok: true });

      await connectorWithKey.isAvailable();

      const callOptions = mockFetch.mock.calls[0][1] as RequestInit;
      expect(
        (callOptions.headers as Record<string, string>)?.["x-api-key"],
      ).toBe("is-available-key");
    });

    it("should use BYOK key when userId is present", async () => {
      jest.spyOn(RequestContext, "getUserId").mockReturnValue("user-byok");
      mockToolKeyResolverService.resolveToolKey.mockResolvedValue({
        value: "byok-ss-key",
        source: "user",
        secretName: "semantic-scholar-api-key",
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: [] }),
      });

      await connector.search("test", 5);

      expect(mockToolKeyResolverService.resolveToolKey).toHaveBeenCalledWith(
        "semantic-scholar",
        "user-byok",
      );
      const callOptions = mockFetch.mock.calls[0][1] as RequestInit;
      expect(
        (callOptions.headers as Record<string, string>)?.["x-api-key"],
      ).toBe("byok-ss-key");
    });

    it("falls back to admin path when no userId is present", async () => {
      jest.spyOn(RequestContext, "getUserId").mockReturnValue(undefined);
      mockConfigService.get.mockReturnValue("admin-ss-key");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: [] }),
      });

      await connector.search("test", 5);

      expect(mockToolKeyResolverService.resolveToolKey).not.toHaveBeenCalled();
    });
  });
});

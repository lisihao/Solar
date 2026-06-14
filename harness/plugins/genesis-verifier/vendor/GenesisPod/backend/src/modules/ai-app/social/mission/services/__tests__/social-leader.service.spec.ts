// Mock the ai-harness/facade module to prevent module initialization errors
// from the deep import chain (platform/credentials → IsEnum(AIModelType) when
// AIModelType is undefined at load time in the test environment).
jest.mock("@/modules/ai-harness/facade", () => ({
  ChatFacade: jest.fn(),
}));

// Mock @prisma/client enums since the generated client in this worktree
// does not include the social module enums (out-of-sync schema).
jest.mock("@prisma/client", () => ({
  ...jest.requireActual("@prisma/client"),
  SocialContentType: {
    WECHAT_ARTICLE: "WECHAT_ARTICLE",
    XIAOHONGSHU: "XIAOHONGSHU",
    WEIBO: "WEIBO",
  },
  SocialContentStatus: {
    DRAFT: "DRAFT",
    PUBLISHED: "PUBLISHED",
    FAILED: "FAILED",
  },
  SocialContentSourceType: {
    EXTERNAL_URL: "EXTERNAL_URL",
    RESEARCH: "RESEARCH",
    AI_RESEARCH: "AI_RESEARCH",
    AI_TOPIC_INSIGHTS: "AI_TOPIC_INSIGHTS",
  },
  SocialReviewStatus: {
    PENDING: "PENDING",
    APPROVED: "APPROVED",
    REJECTED: "REJECTED",
  },
  Prisma: {
    ...jest.requireActual("@prisma/client").Prisma,
  },
}));

import { BadRequestException, NotFoundException } from "@nestjs/common";
import { SocialLeaderService } from "../social-leader.service";
import type { PrismaService } from "../../../../../../common/prisma/prisma.service";
import type { ChatFacade } from "@/modules/ai-harness/facade";
import type { ContentFetcherService } from "../content-fetcher.service";
import type { ContentTransformerService } from "../content-transformer.service";
import type { ContentCheckerService } from "../content-checker.service";
import type { ContentVersionService } from "../content-version.service";
import type { WechatArticleFormatterService } from "../wechat-article-formatter.service";
import {
  SocialContentStatus,
  SocialContentSourceType,
  SocialContentType,
  SocialReviewStatus,
} from "@prisma/client";

function createMockPrisma() {
  return {
    socialContent: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  } as unknown as jest.Mocked<PrismaService>;
}

function createMockWechatFormatter() {
  return {
    splitMarkdownIntoSections: jest.fn(),
    formatForWechat: jest.fn(),
    generateDigest: jest.fn(),
  } as unknown as jest.Mocked<WechatArticleFormatterService>;
}

function createMockChatFacade() {
  return {} as unknown as jest.Mocked<ChatFacade>;
}

function createMockFetcher() {
  return {
    fetchFromUrl: jest.fn(),
    fetchFromSource: jest.fn(),
  } as unknown as jest.Mocked<ContentFetcherService>;
}

function createMockTransformer() {
  return {
    transform: jest.fn(),
  } as unknown as jest.Mocked<ContentTransformerService>;
}

function createMockChecker() {
  return {
    check: jest.fn(),
  } as unknown as jest.Mocked<ContentCheckerService>;
}

function createMockVersionService() {
  return {
    generateAllVersions: jest.fn(),
  } as unknown as jest.Mocked<ContentVersionService>;
}

const MOCK_USER_ID = "user-uuid-123";
const MOCK_CONTENT_ID = "content-uuid-456";

function createMockFetchedContent(overrides = {}) {
  return {
    title: "Fetched Title",
    content: "Fetched content that is long enough",
    originalContent: "Original content",
    translatedContent: "Translated content",
    isBilingual: false,
    images: ["https://example.com/img.jpg"],
    coverImage: "https://example.com/cover.jpg",
    url: "https://example.com/article",
    ...overrides,
  };
}

function createMockTransformedContent(overrides = {}) {
  return {
    title: "Transformed Title",
    content:
      "Transformed content that is definitely long enough to pass validation checks.",
    digest: "Short digest here",
    tags: ["tag1", "tag2"],
    ...overrides,
  };
}

function createMockCheckResult(passed = true) {
  return {
    passed,
    score: passed ? 90 : 40,
    issues: passed ? [] : ["Contains prohibited content"],
    suggestions: [],
  };
}

function createMockCreatedContent() {
  return {
    id: MOCK_CONTENT_ID,
    userId: MOCK_USER_ID,
    contentType: SocialContentType.WECHAT_ARTICLE,
    sourceType: SocialContentSourceType.EXTERNAL_URL,
    title: "Transformed Title",
    content: "Transformed content",
    status: SocialContentStatus.DRAFT,
    reviewStatus: SocialReviewStatus.PENDING,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("SocialLeaderService", () => {
  let service: SocialLeaderService;
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let mockChatFacade: ReturnType<typeof createMockChatFacade>;
  let mockFetcher: ReturnType<typeof createMockFetcher>;
  let mockTransformer: ReturnType<typeof createMockTransformer>;
  let mockChecker: ReturnType<typeof createMockChecker>;
  let mockVersionService: ReturnType<typeof createMockVersionService>;
  let mockWechatFormatter: ReturnType<typeof createMockWechatFormatter>;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    mockChatFacade = createMockChatFacade();
    mockFetcher = createMockFetcher();
    mockTransformer = createMockTransformer();
    mockChecker = createMockChecker();
    mockVersionService = createMockVersionService();
    mockWechatFormatter = createMockWechatFormatter();

    service = new SocialLeaderService(
      mockPrisma as unknown as PrismaService,
      mockChatFacade as unknown as ChatFacade,
      mockFetcher as unknown as ContentFetcherService,
      mockTransformer as unknown as ContentTransformerService,
      mockChecker as unknown as ContentCheckerService,
      mockVersionService as unknown as ContentVersionService,
      mockWechatFormatter as unknown as WechatArticleFormatterService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("getChatFacade", () => {
    it("should return the chat facade instance", () => {
      expect(service.getChatFacade()).toBe(mockChatFacade);
    });
  });

  describe("processUrl", () => {
    const mockDto = {
      url: "https://example.com/article",
      targetType: SocialContentType.WECHAT_ARTICLE,
    };

    beforeEach(() => {
      mockFetcher.fetchFromUrl.mockResolvedValue(createMockFetchedContent());
      mockTransformer.transform.mockResolvedValue(
        createMockTransformedContent(),
      );
      mockChecker.check.mockResolvedValue(createMockCheckResult(true));
      mockPrisma.socialContent.create.mockResolvedValue(
        createMockCreatedContent(),
      );
      mockPrisma.socialContent.update.mockResolvedValue({
        ...createMockCreatedContent(),
        sourceUrl: "https://example.com/article",
        tags: ["tag1", "tag2"],
      });
      mockVersionService.generateAllVersions.mockResolvedValue([
        { id: "v1" },
        { id: "v2" },
      ]);
    });

    it("should process URL and create content successfully", async () => {
      const result = await service.processUrl(MOCK_USER_ID, mockDto);

      expect(mockFetcher.fetchFromUrl).toHaveBeenCalledWith(mockDto.url);
      expect(mockTransformer.transform).toHaveBeenCalled();
      expect(mockChecker.check).toHaveBeenCalled();
      expect(mockPrisma.socialContent.create).toHaveBeenCalled();
      // Single atomic create (no separate update step)
      expect(result.content).toBeDefined();
      expect(result.checkResult).toBeDefined();
      expect(result.message).toContain("内容已生成");
      expect(result.versionCount).toBe(2);
    });

    it("should throw BadRequestException if transformed content is too short", async () => {
      mockTransformer.transform.mockResolvedValue({
        title: "Title",
        content: "Short",
        tags: [],
      });

      await expect(service.processUrl(MOCK_USER_ID, mockDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should throw BadRequestException if transformed content is empty", async () => {
      mockTransformer.transform.mockResolvedValue({
        title: "Title",
        content: "",
        tags: [],
      });

      await expect(service.processUrl(MOCK_USER_ID, mockDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should include compliance issue message when check fails", async () => {
      mockChecker.check.mockResolvedValue(createMockCheckResult(false));

      const result = await service.processUrl(MOCK_USER_ID, mockDto);

      expect(result.message).toContain("合规问题");
    });

    it("should include version generation failure message when versions fail", async () => {
      mockVersionService.generateAllVersions.mockRejectedValue(
        new Error("Version generation error"),
      );

      const result = await service.processUrl(MOCK_USER_ID, mockDto);

      expect(result.versionGenerationFailed).toBe(true);
      expect(result.message).toContain("版本生成失败");
    });

    it("should include version count in message on success", async () => {
      const result = await service.processUrl(MOCK_USER_ID, mockDto);

      expect(result.message).toContain("2 个平台版本");
    });

    it("should handle null images and tags gracefully", async () => {
      mockFetcher.fetchFromUrl.mockResolvedValue({
        ...createMockFetchedContent(),
        images: null,
        coverImage: null,
      });
      mockTransformer.transform.mockResolvedValue({
        ...createMockTransformedContent(),
        tags: null,
        digest: null,
      });

      const result = await service.processUrl(MOCK_USER_ID, mockDto);

      expect(result.content).toBeDefined();
    });

    it("should propagate database errors", async () => {
      mockPrisma.socialContent.create.mockRejectedValue(
        new Error("DB connection error"),
      );

      await expect(service.processUrl(MOCK_USER_ID, mockDto)).rejects.toThrow(
        "DB connection error",
      );
    });

    it("should retry on transient database errors", async () => {
      const transientError = new Error("ECONNRESET");
      mockPrisma.socialContent.create
        .mockRejectedValueOnce(transientError)
        .mockRejectedValueOnce(transientError)
        .mockResolvedValue(createMockCreatedContent());

      const result = await service.processUrl(MOCK_USER_ID, mockDto);

      expect(result.content).toBeDefined();
      expect(mockPrisma.socialContent.create).toHaveBeenCalledTimes(3);
    });

    it("should truncate very long titles to 200 chars", async () => {
      const longTitle = "A".repeat(300);
      mockTransformer.transform.mockResolvedValue({
        ...createMockTransformedContent(),
        title: longTitle,
      });

      await service.processUrl(MOCK_USER_ID, mockDto);

      const createCall = mockPrisma.socialContent.create.mock.calls[0][0];
      expect(createCall.data.title.length).toBeLessThanOrEqual(200);
    });
  });

  describe("processSource", () => {
    const mockDto = {
      sourceType: SocialContentSourceType.RESEARCH,
      sourceId: "research-uuid-789",
      targetType: SocialContentType.WECHAT_ARTICLE,
    };

    beforeEach(() => {
      mockFetcher.fetchFromSource.mockResolvedValue(createMockFetchedContent());
      mockTransformer.transform.mockResolvedValue(
        createMockTransformedContent(),
      );
      mockChecker.check.mockResolvedValue(createMockCheckResult(true));
      mockVersionService.generateAllVersions.mockResolvedValue([{ id: "v1" }]);

      // $queryRaw should return array with a row
      (mockPrisma.$queryRaw as jest.Mock).mockResolvedValue([
        {
          id: MOCK_CONTENT_ID,
          user_id: MOCK_USER_ID,
          content_type: "WECHAT_ARTICLE",
          source_type: "RESEARCH",
          source_id: "research-uuid-789",
          title: "Transformed Title",
          content: "Transformed content",
          digest: null,
          source_url: null,
          cover_image_url: null,
          images: [],
          tags: ["tag1"],
          compliance_check: {},
          status: "DRAFT",
          review_status: "PENDING",
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]);
    });

    it("should process source and insert via $queryRaw successfully", async () => {
      const result = await service.processSource(MOCK_USER_ID, mockDto);

      expect(mockFetcher.fetchFromSource).toHaveBeenCalledWith(
        mockDto.sourceType,
        mockDto.sourceId,
        MOCK_USER_ID,
      );
      expect(mockPrisma.$queryRaw).toHaveBeenCalled();
      expect(result.content).toBeDefined();
      expect(result.content.id).toBe(MOCK_CONTENT_ID);
    });

    it("should throw BadRequestException if transformed content is too short", async () => {
      mockTransformer.transform.mockResolvedValue({
        title: "T",
        content: "Too short",
        tags: [],
      });

      await expect(
        service.processSource(MOCK_USER_ID, mockDto),
      ).rejects.toThrow(BadRequestException);
    });

    it("should include compliance failure message", async () => {
      mockChecker.check.mockResolvedValue(createMockCheckResult(false));

      const result = await service.processSource(MOCK_USER_ID, mockDto);

      expect(result.message).toContain("合规问题");
    });

    it("should handle version generation failure", async () => {
      mockVersionService.generateAllVersions.mockRejectedValue(
        new Error("Version error"),
      );

      const result = await service.processSource(MOCK_USER_ID, mockDto);

      expect(result.versionGenerationFailed).toBe(true);
    });

    it("should throw when $queryRaw returns empty result", async () => {
      (mockPrisma.$queryRaw as jest.Mock).mockResolvedValue([]);

      await expect(
        service.processSource(MOCK_USER_ID, mockDto),
      ).rejects.toThrow("Insert succeeded but no data returned");
    });

    it("should propagate database errors from $queryRaw", async () => {
      (mockPrisma.$queryRaw as jest.Mock).mockRejectedValue(
        new Error("DB protocol error"),
      );

      await expect(
        service.processSource(MOCK_USER_ID, mockDto),
      ).rejects.toThrow("DB protocol error");
    });
  });

  describe("processKeepFormatSource (via processSource keepFormat) atomicity", () => {
    const mockDto = {
      sourceType: SocialContentSourceType.AI_TOPIC_INSIGHTS,
      sourceId: "topic-uuid-111",
      targetType: SocialContentType.WECHAT_ARTICLE,
    };

    const makeSection = (heading: string) => ({
      heading,
      markdown: `## ${heading}\n\nSome content here.`,
    });

    const makeInsertRow = (id: string, title: string) => ({
      id,
      user_id: MOCK_USER_ID,
      content_type: "WECHAT_ARTICLE",
      source_type: "AI_TOPIC_INSIGHTS",
      source_id: "topic-uuid-111",
      title,
      content: "<p>html</p>",
      digest: null,
      series_id: "series-abc",
      series_order: 1,
      status: "DRAFT",
      created_at: new Date(),
    });

    beforeEach(() => {
      mockFetcher.fetchFromSource.mockResolvedValue({
        title: "Big Report",
        content:
          "## Part 1\n\nContent 1\n\n## Part 2\n\nContent 2\n\n## Part 3\n\nContent 3",
        images: [],
        coverImage: null,
        url: null,
        originalContent: undefined,
        translatedContent: undefined,
        isBilingual: false,
      });
      mockChecker.check.mockResolvedValue({
        passed: true,
        issues: [],
        suggestions: [],
      });
      mockVersionService.generateAllVersions.mockResolvedValue([]);

      mockWechatFormatter.splitMarkdownIntoSections.mockReturnValue([
        makeSection("Part 1"),
        makeSection("Part 2"),
        makeSection("Part 3"),
      ]);
      mockWechatFormatter.formatForWechat.mockReturnValue("<p>html</p>");
      mockWechatFormatter.generateDigest.mockReturnValue("short digest");
    });

    it("insert fails at section 2/3 → transaction rolls back and 0 rows are persisted", async () => {
      // Arrange: $transaction executes the callback using a tx mock whose
      // $queryRaw succeeds on call 1 (section 1) and throws on call 2 (section 2).
      // The real Prisma $transaction would roll back all rows; here we verify
      // the outer call rejects (which is the signal that rollback happened).
      let txQueryRawCallCount = 0;
      const txMock = {
        $queryRaw: jest.fn().mockImplementation(() => {
          txQueryRawCallCount++;
          if (txQueryRawCallCount === 2) {
            return Promise.reject(new Error("DB insert error on section 2"));
          }
          return Promise.resolve([
            makeInsertRow(
              `row-${txQueryRawCallCount}`,
              `Part ${txQueryRawCallCount}`,
            ),
          ]);
        }),
      };

      (mockPrisma.$transaction as jest.Mock).mockImplementation(
        async (callback: (tx: typeof txMock) => Promise<unknown>) => {
          return callback(txMock);
        },
      );

      // Act + Assert: the whole processSource call rejects
      await expect(
        service.processSource(MOCK_USER_ID, mockDto),
      ).rejects.toThrow("DB insert error on section 2");

      // The AI compliance check (section 1 only) ran exactly once — outside tx
      expect(mockChecker.check).toHaveBeenCalledTimes(1);

      // The tx.$queryRaw was called twice before failing (section 1 ok, section 2 throws)
      expect(txMock.$queryRaw).toHaveBeenCalledTimes(2);

      // $transaction was called exactly once (all-or-nothing)
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it("all 3 sections succeed → $transaction called once, 3 rows returned", async () => {
      let txQueryRawCallCount = 0;
      const txMock = {
        $queryRaw: jest.fn().mockImplementation(() => {
          txQueryRawCallCount++;
          return Promise.resolve([
            makeInsertRow(
              `row-${txQueryRawCallCount}`,
              `Part ${txQueryRawCallCount}`,
            ),
          ]);
        }),
      };

      (mockPrisma.$transaction as jest.Mock).mockImplementation(
        async (callback: (tx: typeof txMock) => Promise<unknown>) => {
          return callback(txMock);
        },
      );

      const result = await service.processSource(MOCK_USER_ID, mockDto);

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(txMock.$queryRaw).toHaveBeenCalledTimes(3);
      // AI compliance check called once (first section only), before the transaction
      expect(mockChecker.check).toHaveBeenCalledTimes(1);
      expect(result.seriesId).toBeDefined();
      expect(result.seriesContents).toHaveLength(3);
    });
  });

  describe("regenerateContent", () => {
    it("should regenerate from URL when sourceUrl is set", async () => {
      mockPrisma.socialContent.findFirst.mockResolvedValue({
        sourceUrl: "https://example.com/original",
        contentType: SocialContentType.WECHAT_ARTICLE,
        sourceId: null,
        sourceType: null,
      });

      // Set up mocks for processUrl
      mockFetcher.fetchFromUrl.mockResolvedValue(createMockFetchedContent());
      mockTransformer.transform.mockResolvedValue(
        createMockTransformedContent(),
      );
      mockChecker.check.mockResolvedValue(createMockCheckResult());
      mockPrisma.socialContent.create.mockResolvedValue(
        createMockCreatedContent(),
      );
      mockPrisma.socialContent.update.mockResolvedValue(
        createMockCreatedContent(),
      );
      mockVersionService.generateAllVersions.mockResolvedValue([]);

      const result = await service.regenerateContent(
        MOCK_USER_ID,
        MOCK_CONTENT_ID,
      );

      expect(mockPrisma.socialContent.findFirst).toHaveBeenCalledWith({
        where: { id: MOCK_CONTENT_ID, userId: MOCK_USER_ID },
      });
      expect(mockFetcher.fetchFromUrl).toHaveBeenCalledWith(
        "https://example.com/original",
      );
      expect(result).toBeDefined();
    });

    it("should regenerate from source when sourceId/sourceType are set", async () => {
      mockPrisma.socialContent.findFirst.mockResolvedValue({
        sourceUrl: null,
        sourceId: "research-id-abc",
        sourceType: SocialContentSourceType.AI_RESEARCH,
        contentType: SocialContentType.WECHAT_ARTICLE,
      });

      mockFetcher.fetchFromSource.mockResolvedValue(createMockFetchedContent());
      mockTransformer.transform.mockResolvedValue(
        createMockTransformedContent(),
      );
      mockChecker.check.mockResolvedValue(createMockCheckResult());
      mockVersionService.generateAllVersions.mockResolvedValue([]);
      (mockPrisma.$queryRaw as jest.Mock).mockResolvedValue([
        {
          id: MOCK_CONTENT_ID,
          user_id: MOCK_USER_ID,
          content_type: "WECHAT_ARTICLE",
          source_type: "RESEARCH",
          source_id: "research-id-abc",
          title: "T",
          content: "C",
          digest: null,
          source_url: null,
          cover_image_url: null,
          images: [],
          tags: [],
          compliance_check: {},
          status: "DRAFT",
          review_status: "PENDING",
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]);

      const result = await service.regenerateContent(
        MOCK_USER_ID,
        MOCK_CONTENT_ID,
      );

      expect(mockFetcher.fetchFromSource).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it("should throw NotFoundException when content does not exist", async () => {
      mockPrisma.socialContent.findFirst.mockResolvedValue(null);

      await expect(
        service.regenerateContent(MOCK_USER_ID, "nonexistent-id"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw BadRequestException when neither sourceUrl nor sourceId/sourceType", async () => {
      mockPrisma.socialContent.findFirst.mockResolvedValue({
        sourceUrl: null,
        sourceId: null,
        sourceType: null,
        contentType: SocialContentType.WECHAT_ARTICLE,
      });

      await expect(
        service.regenerateContent(MOCK_USER_ID, MOCK_CONTENT_ID),
      ).rejects.toThrow(BadRequestException);
    });
  });
});

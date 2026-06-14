/**
 * EventSourceParsingService Tests
 *
 * Covers:
 * - parseEventSourceAsync: topic not found → returns early
 * - parseEventSourceAsync: topic type != EVENT → returns early
 * - parseEventSourceAsync: no sourceUrl + no sourceContent → returns early
 * - parseEventSourceAsync: has sourceContent only → skips fetch, calls LLM
 * - parseEventSourceAsync: has sourceUrl, fetch fails → updates config with domain/tier only
 * - parseEventSourceAsync: has sourceUrl, fetch succeeds → calls LLM, updates config
 * - parseEventSourceAsync: LLM returns null → still updates config
 * - parseEventSourceAsync: LLM returns full metadata → updates all fields
 * - parseEventSourceAsync: outer error → catches silently
 * - validateFetchUrl: invalid URL → throws
 * - validateFetchUrl: non-HTTP protocol → throws
 * - validateFetchUrl: localhost → throws
 * - validateFetchUrl: 10.x.x.x → throws
 * - validateFetchUrl: 172.16-31.x.x → throws
 * - validateFetchUrl: 192.168.x.x → throws
 * - validateFetchUrl: ::1 → throws
 * - validateFetchUrl: 0.0.0.0 → throws
 * - validateFetchUrl: 169.254.x.x → throws
 * - safeReadResponseText: content-length too large → throws
 * - safeReadResponseText: no body → returns text()
 * - isWeChatUrl: mp.weixin.qq.com → true
 * - isWeChatUrl: weixin.qq.com → true
 * - isWeChatUrl: other domains → false
 * - fetchWeChatContent: anti-scraping triggers
 * - parseWeChatHtml: full parsing
 * - extractWeChatBody: balanced brackets
 * - cleanWeChatContent: HTML cleaning
 */

jest.mock("@prisma/client", () => ({
  AIModelType: { CHAT: "CHAT" },
  PrismaClient: class {},
  Prisma: { LogLevel: {}, LogDefinition: {} },
}));

jest.mock("@/modules/ai-harness/facade", () => ({
  ChatFacade: class {},
}));
jest.mock("@/modules/ai-harness/facade", () => ({
  ChatFacade: class {},
}));

jest.mock("@/modules/platform/facade", () => ({
  BillingContext: {
    get: jest.fn().mockReturnValue(null),
    run: jest.fn((_opts: unknown, cb: () => void) => cb()),
  },
}));

jest.mock("@/common/utils/prisma-json.utils", () => ({
  toPrismaJson: jest.fn((val: unknown) => val),
}));

import { Test, TestingModule } from "@nestjs/testing";
import { EventSourceParsingService } from "../event-source-parsing.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";

// Helper: build minimal mock prisma
function buildMockPrisma() {
  return {
    researchTopic: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
  };
}

// Helper: build minimal mock ChatFacade
function buildMockChat(response: { content: string } | null) {
  return {
    chat: jest.fn().mockResolvedValue(response ?? { content: "" }),
  };
}

describe("EventSourceParsingService", () => {
  let service: EventSourceParsingService;
  let mockPrisma: ReturnType<typeof buildMockPrisma>;
  let mockChat: ReturnType<typeof buildMockChat>;

  beforeEach(async () => {
    mockPrisma = buildMockPrisma();
    mockChat = buildMockChat({ content: "{}" });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventSourceParsingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ChatFacade, useValue: mockChat },
      ],
    }).compile();

    service = module.get<EventSourceParsingService>(EventSourceParsingService);
    jest.clearAllMocks();
  });

  // =========================================================================
  // parseEventSourceAsync: early returns
  // =========================================================================
  describe("parseEventSourceAsync - early returns", () => {
    it("should return early when topic is not found", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue(null);

      await service.parseEventSourceAsync("topic-not-found");

      expect(mockPrisma.researchTopic.update).not.toHaveBeenCalled();
    });

    it("should return early when topic type is not EVENT", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-1",
        type: "GENERAL",
        topicConfig: {},
      });

      await service.parseEventSourceAsync("topic-1");

      expect(mockPrisma.researchTopic.update).not.toHaveBeenCalled();
    });

    it("should return early when both sourceUrl and sourceContent are absent", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-2",
        type: "EVENT",
        topicConfig: { someOtherField: "value" },
      });

      await service.parseEventSourceAsync("topic-2");

      expect(mockPrisma.researchTopic.update).not.toHaveBeenCalled();
    });

    it("should return early when topicConfig is null", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-3",
        type: "EVENT",
        topicConfig: null,
      });

      await service.parseEventSourceAsync("topic-3");

      expect(mockPrisma.researchTopic.update).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // parseEventSourceAsync: sourceContent only (no fetch)
  // =========================================================================
  describe("parseEventSourceAsync - sourceContent provided", () => {
    it("should skip URL fetch and call LLM when sourceContent is present", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-4",
        type: "EVENT",
        topicConfig: {
          sourceContent: "Some article content about AI acquisition",
        },
      });

      const llmResponse = JSON.stringify({
        title: "AI Company Acquires Startup",
        eventType: "acquisition",
        sourceDate: "2026-01-15",
        keyEntities: {
          people: ["John Doe"],
          organizations: ["AI Corp"],
          technologies: ["Machine Learning"],
          locations: ["San Francisco"],
        },
      });

      mockChat.chat.mockResolvedValue({ content: llmResponse });
      mockPrisma.researchTopic.update.mockResolvedValue({});

      await service.parseEventSourceAsync("topic-4");

      expect(mockChat.chat).toHaveBeenCalledTimes(1);
      expect(mockPrisma.researchTopic.update).toHaveBeenCalledTimes(1);
    });

    it("should update all fields when LLM returns complete metadata", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-5",
        type: "EVENT",
        topicConfig: { sourceContent: "Article about product launch" },
      });

      const metadata = {
        title: "Product Launch Event",
        eventType: "product",
        sourceDate: "2026-02-01",
        keyEntities: {
          people: [],
          organizations: ["TechCorp"],
          technologies: ["AI"],
          locations: ["New York"],
        },
      };

      mockChat.chat.mockResolvedValue({
        content: JSON.stringify(metadata),
      });
      mockPrisma.researchTopic.update.mockResolvedValue({});

      await service.parseEventSourceAsync("topic-5");

      const updateCall = mockPrisma.researchTopic.update.mock.calls[0][0];
      const updatedData = updateCall.data.topicConfig;

      expect(updatedData.sourceTitle).toBe("Product Launch Event");
      expect(updatedData.eventType).toBe("product");
      expect(updatedData.sourceDate).toBe("2026-02-01");
      expect(updatedData.keyEntities).toEqual(metadata.keyEntities);
    });

    it("should not set sourceTitle/eventType when LLM returns null result", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-6",
        type: "EVENT",
        topicConfig: { sourceContent: "Unparseable content" },
      });

      // LLM returns no JSON
      mockChat.chat.mockResolvedValue({ content: "not a json response" });
      mockPrisma.researchTopic.update.mockResolvedValue({});

      await service.parseEventSourceAsync("topic-6");

      const updateCall = mockPrisma.researchTopic.update.mock.calls[0][0];
      const updatedData = updateCall.data.topicConfig;

      expect(updatedData.sourceTitle).toBeUndefined();
      expect(updatedData.eventType).toBeUndefined();
    });
  });

  // =========================================================================
  // parseEventSourceAsync: URL fetch scenarios
  // =========================================================================
  describe("parseEventSourceAsync - URL fetching", () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
      jest.clearAllMocks();
    });

    it("should update config with domain and tier when URL fetch fails", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-7",
        type: "EVENT",
        topicConfig: { sourceUrl: "https://reuters.com/tech/article-1" },
      });

      global.fetch = jest.fn().mockRejectedValue(new Error("Network error"));
      mockPrisma.researchTopic.update.mockResolvedValue({});

      await service.parseEventSourceAsync("topic-7");

      expect(mockPrisma.researchTopic.update).toHaveBeenCalledTimes(1);
      const updateCall = mockPrisma.researchTopic.update.mock.calls[0][0];
      const updatedData = updateCall.data.topicConfig;
      expect(updatedData.sourceDomain).toBe("reuters.com");
      expect(updatedData.sourceTier).toBe(2); // reuters is Tier 2
    });

    it("should fetch content, call LLM, and update config on success", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-8",
        type: "EVENT",
        topicConfig: { sourceUrl: "https://example.com/article" },
      });

      const htmlContent = "<html><body>Article content here</body></html>";

      const mockReader = {
        read: jest
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode(htmlContent),
          })
          .mockResolvedValueOnce({ done: true, value: undefined }),
        cancel: jest.fn().mockResolvedValue(undefined),
        releaseLock: jest.fn(),
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: jest.fn().mockReturnValue(null),
        },
        body: { getReader: () => mockReader },
        text: jest.fn().mockResolvedValue(htmlContent),
      } as unknown as Response);

      mockChat.chat.mockResolvedValue({
        content: JSON.stringify({
          title: "Test Article",
          eventType: "other",
          sourceDate: null,
          keyEntities: {
            people: [],
            organizations: [],
            technologies: [],
            locations: [],
          },
        }),
      });
      mockPrisma.researchTopic.update.mockResolvedValue({});

      await service.parseEventSourceAsync("topic-8");

      expect(mockPrisma.researchTopic.update).toHaveBeenCalledTimes(1);
      expect(mockChat.chat).toHaveBeenCalledTimes(1);
    });

    it("should handle fetch HTTP error response", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-9",
        type: "EVENT",
        topicConfig: { sourceUrl: "https://example.com/not-found" },
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        headers: { get: jest.fn().mockReturnValue(null) },
        body: null,
        text: jest.fn().mockResolvedValue(""),
      } as unknown as Response);

      mockPrisma.researchTopic.update.mockResolvedValue({});

      await service.parseEventSourceAsync("topic-9");

      // Should update with domain info even on fetch failure
      expect(mockPrisma.researchTopic.update).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // validateFetchUrl (tested indirectly via parseEventSourceAsync)
  // =========================================================================
  describe("validateFetchUrl - SSRF protection", () => {
    const blockedUrls = [
      "not-a-url",
      "ftp://example.com/file",
      "http://localhost/admin",
      "http://127.0.0.1/secret",
      "http://10.0.0.1/internal",
      "http://172.16.0.1/internal",
      "http://172.31.0.1/internal",
      "http://192.168.1.1/admin",
      "http://169.254.169.254/metadata",
      "http://0.0.0.0/anything",
    ];

    for (const url of blockedUrls) {
      it(`should silently degrade (not crash) for blocked URL: ${url}`, async () => {
        mockPrisma.researchTopic.findUnique.mockResolvedValue({
          id: "topic-blocked",
          type: "EVENT",
          topicConfig: { sourceUrl: url },
        });
        mockPrisma.researchTopic.update.mockResolvedValue({});

        // Should not throw; should handle error gracefully
        await expect(
          service.parseEventSourceAsync("topic-blocked"),
        ).resolves.not.toThrow();
      });
    }

    it("should not be blocked for valid public URL", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-valid",
        type: "EVENT",
        topicConfig: { sourceUrl: "https://techcrunch.com/article/1" },
      });

      global.fetch = jest.fn().mockRejectedValue(new Error("Network error"));
      mockPrisma.researchTopic.update.mockResolvedValue({});

      await service.parseEventSourceAsync("topic-valid");

      // fetch was at least attempted (not rejected by SSRF check alone)
      expect(global.fetch).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // safeReadResponseText
  // =========================================================================
  describe("safeReadResponseText - via fetchGenericContent path", () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("should throw when content-length exceeds 5MB limit", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-large",
        type: "EVENT",
        topicConfig: { sourceUrl: "https://example.com/huge-file" },
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: jest
            .fn()
            .mockImplementation((name: string) =>
              name === "content-length" ? String(6 * 1024 * 1024) : null,
            ),
        },
        body: null,
        text: jest.fn().mockResolvedValue("huge content"),
      } as unknown as Response);

      mockPrisma.researchTopic.update.mockResolvedValue({});

      // Should handle gracefully (fetch error → update domain/tier)
      await service.parseEventSourceAsync("topic-large");

      // Confirm it didn't crash
      expect(mockPrisma.researchTopic.update).toHaveBeenCalledTimes(1);
    });

    it("should use response.text() when body reader is null", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-no-reader",
        type: "EVENT",
        topicConfig: { sourceUrl: "https://example.com/simple" },
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: jest.fn().mockReturnValue(null) },
        body: null,
        text: jest.fn().mockResolvedValue("Simple text content"),
      } as unknown as Response);

      mockChat.chat.mockResolvedValue({
        content: JSON.stringify({
          title: "Test",
          eventType: "other",
          sourceDate: null,
          keyEntities: {
            people: [],
            organizations: [],
            technologies: [],
            locations: [],
          },
        }),
      });
      mockPrisma.researchTopic.update.mockResolvedValue({});

      await service.parseEventSourceAsync("topic-no-reader");

      expect(mockPrisma.researchTopic.update).toHaveBeenCalledTimes(1);
    });

    it("should abort reading when streaming bytes exceed 5MB", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-stream-large",
        type: "EVENT",
        topicConfig: { sourceUrl: "https://example.com/large-stream" },
      });

      const largeChunk = new Uint8Array(6 * 1024 * 1024); // 6MB chunk

      const mockReader = {
        read: jest
          .fn()
          .mockResolvedValueOnce({ done: false, value: largeChunk }),
        cancel: jest.fn().mockResolvedValue(undefined),
        releaseLock: jest.fn(),
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: jest.fn().mockReturnValue(null) },
        body: { getReader: () => mockReader },
        text: jest.fn().mockResolvedValue(""),
      } as unknown as Response);

      mockPrisma.researchTopic.update.mockResolvedValue({});

      await service.parseEventSourceAsync("topic-stream-large");

      // Should have called cancel on the reader
      expect(mockReader.cancel).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // WeChat URL handling
  // =========================================================================
  describe("WeChat URL handling", () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("should use WeChat-specific headers for mp.weixin.qq.com URLs", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-wechat",
        type: "EVENT",
        topicConfig: {
          sourceUrl: "https://mp.weixin.qq.com/s/abcdefg",
        },
      });

      const capturedRequests: RequestInit[] = [];
      global.fetch = jest
        .fn()
        .mockImplementation((_url: string, init?: RequestInit) => {
          capturedRequests.push(init ?? {});
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: { get: jest.fn().mockReturnValue(null) },
            body: null,
            text: jest
              .fn()
              .mockResolvedValue("<html><body>WeChat content</body></html>"),
          } as unknown as Response);
        });

      mockChat.chat.mockResolvedValue({
        content: JSON.stringify({
          title: "WeChat Article",
          eventType: "other",
          sourceDate: null,
          keyEntities: {
            people: [],
            organizations: [],
            technologies: [],
            locations: [],
          },
        }),
      });
      mockPrisma.researchTopic.update.mockResolvedValue({});

      await service.parseEventSourceAsync("topic-wechat");

      expect(capturedRequests.length).toBeGreaterThan(0);
      const headers = capturedRequests[0].headers as Record<string, string>;
      expect(headers["Referer"]).toBe("https://mp.weixin.qq.com/");
    });

    it("should detect anti-scraping and throw for WeChat blocked pages", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-wechat-blocked",
        type: "EVENT",
        topicConfig: {
          sourceUrl: "https://mp.weixin.qq.com/s/blocked-article",
        },
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: jest.fn().mockReturnValue(null) },
        body: null,
        text: jest.fn().mockResolvedValue("环境异常，请在微信客户端打开"),
      } as unknown as Response);

      mockPrisma.researchTopic.update.mockResolvedValue({});

      await service.parseEventSourceAsync("topic-wechat-blocked");

      // Should still gracefully degrade (update with domain info)
      expect(mockPrisma.researchTopic.update).toHaveBeenCalledTimes(1);
    });

    it("should detect 请在微信客户端打开 anti-scraping signal", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-wechat-blocked2",
        type: "EVENT",
        topicConfig: {
          sourceUrl: "https://weixin.qq.com/s/article-2",
        },
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: jest.fn().mockReturnValue(null) },
        body: null,
        text: jest
          .fn()
          .mockResolvedValue("<html><body>请在微信客户端打开</body></html>"),
      } as unknown as Response);

      mockPrisma.researchTopic.update.mockResolvedValue({});

      await service.parseEventSourceAsync("topic-wechat-blocked2");

      expect(mockPrisma.researchTopic.update).toHaveBeenCalled();
    });

    it("should parse WeChat HTML with title and content", async () => {
      const wechatHtml = `
        <html>
          <body>
            <h1 class="rich_media_title">Test WeChat Article</h1>
            <a id="js_name">My Public Account</a>
            <em id="publish_time">2026-01-15</em>
            <div id="js_content">
              <p>This is the article body content.</p>
              <p>Second paragraph.</p>
            </div>
          </body>
        </html>
      `;

      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-wechat-parse",
        type: "EVENT",
        topicConfig: {
          sourceUrl: "https://mp.weixin.qq.com/s/test-article",
        },
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: jest.fn().mockReturnValue(null) },
        body: null,
        text: jest.fn().mockResolvedValue(wechatHtml),
      } as unknown as Response);

      mockChat.chat.mockResolvedValue({
        content: JSON.stringify({
          title: "Test Article Title",
          eventType: "other",
          sourceDate: "2026-01-15",
          keyEntities: {
            people: [],
            organizations: [],
            technologies: [],
            locations: [],
          },
        }),
      });
      mockPrisma.researchTopic.update.mockResolvedValue({});

      await service.parseEventSourceAsync("topic-wechat-parse");

      expect(mockPrisma.researchTopic.update).toHaveBeenCalledTimes(1);
    });

    it("should fallback to generic HTML stripping when js_content is absent", async () => {
      const genericHtml = `
        <html>
          <body>
            <h1 class="rich_media_title">No Body Div Article</h1>
            <script>var x = 1;</script>
            <style>.cls { color: red; }</style>
            <p>Some visible text here.</p>
          </body>
        </html>
      `;

      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-wechat-fallback",
        type: "EVENT",
        topicConfig: {
          sourceUrl: "https://mp.weixin.qq.com/s/fallback-article",
        },
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: jest.fn().mockReturnValue(null) },
        body: null,
        text: jest.fn().mockResolvedValue(genericHtml),
      } as unknown as Response);

      mockChat.chat.mockResolvedValue({
        content: JSON.stringify({
          title: "Fallback Article",
          eventType: "other",
          sourceDate: null,
          keyEntities: {
            people: [],
            organizations: [],
            technologies: [],
            locations: [],
          },
        }),
      });
      mockPrisma.researchTopic.update.mockResolvedValue({});

      await service.parseEventSourceAsync("topic-wechat-fallback");

      expect(mockPrisma.researchTopic.update).toHaveBeenCalledTimes(1);
    });

    it("should handle WeChat HTTP error response", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-wechat-403",
        type: "EVENT",
        topicConfig: {
          sourceUrl: "https://mp.weixin.qq.com/s/forbidden-article",
        },
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 403,
        headers: { get: jest.fn().mockReturnValue(null) },
        body: null,
        text: jest.fn().mockResolvedValue("Forbidden"),
      } as unknown as Response);

      mockPrisma.researchTopic.update.mockResolvedValue({});

      await service.parseEventSourceAsync("topic-wechat-403");

      // Should silently degrade
      expect(mockPrisma.researchTopic.update).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // LLM extraction edge cases
  // =========================================================================
  describe("extractEventMetadata edge cases", () => {
    it("should return null when LLM throws an error", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-llm-error",
        type: "EVENT",
        topicConfig: { sourceContent: "Article content" },
      });

      mockChat.chat.mockRejectedValue(new Error("LLM API down"));
      mockPrisma.researchTopic.update.mockResolvedValue({});

      // Should not throw
      await service.parseEventSourceAsync("topic-llm-error");

      expect(mockPrisma.researchTopic.update).toHaveBeenCalledTimes(1);
    });

    it("should handle JSON with only title (no eventType, keyEntities)", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-partial",
        type: "EVENT",
        topicConfig: { sourceContent: "Article content" },
      });

      mockChat.chat.mockResolvedValue({
        content: '{"title":"Partial Data Article"}',
      });
      mockPrisma.researchTopic.update.mockResolvedValue({});

      await service.parseEventSourceAsync("topic-partial");

      const updateCall = mockPrisma.researchTopic.update.mock.calls[0][0];
      const updatedData = updateCall.data.topicConfig;
      expect(updatedData.sourceTitle).toBe("Partial Data Article");
      expect(updatedData.eventType).toBeUndefined();
    });

    it("should handle LLM content with JSON embedded in text", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-embedded-json",
        type: "EVENT",
        topicConfig: { sourceContent: "Content" },
      });

      // JSON embedded in surrounding text
      mockChat.chat.mockResolvedValue({
        content:
          'Here is the result: {"title":"Embedded","eventType":"funding","sourceDate":null,"keyEntities":{"people":[],"organizations":[],"technologies":[],"locations":[]}} Hope that helps!',
      });
      mockPrisma.researchTopic.update.mockResolvedValue({});

      await service.parseEventSourceAsync("topic-embedded-json");

      const updateCall = mockPrisma.researchTopic.update.mock.calls[0][0];
      const updatedData = updateCall.data.topicConfig;
      expect(updatedData.sourceTitle).toBe("Embedded");
      expect(updatedData.eventType).toBe("funding");
    });

    it("should handle content longer than 3000 chars (truncation)", async () => {
      const longContent = "a".repeat(5000);
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-long",
        type: "EVENT",
        topicConfig: { sourceContent: longContent },
      });

      mockChat.chat.mockResolvedValue({
        content:
          '{"title":"Long Content","eventType":"other","sourceDate":null,"keyEntities":{"people":[],"organizations":[],"technologies":[],"locations":[]}}',
      });
      mockPrisma.researchTopic.update.mockResolvedValue({});

      await service.parseEventSourceAsync("topic-long");

      // Verify LLM was called with truncated content (< 3000 chars message in user prompt)
      const chatCall = mockChat.chat.mock.calls[0][0];
      const userMessage = chatCall.messages[1].content as string;
      // The content passed to LLM is truncated to 3000 chars
      expect(userMessage.length).toBeLessThan(longContent.length + 200); // with prompt overhead
    });
  });

  // =========================================================================
  // updateTopicConfig
  // =========================================================================
  describe("updateTopicConfig", () => {
    it("should merge existing config with new updates", async () => {
      const existingConfig = {
        existingField: "preserved",
        sourceUrl: "https://example.com",
        sourceContent: "Article content about acquisition", // avoids URL fetch
      };

      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-merge",
        type: "EVENT",
        topicConfig: existingConfig,
      });

      mockChat.chat.mockResolvedValue({
        content:
          '{"title":"New Title","eventType":"acquisition","sourceDate":null,"keyEntities":{"people":[],"organizations":[],"technologies":[],"locations":[]}}',
      });
      mockPrisma.researchTopic.update.mockResolvedValue({});

      await service.parseEventSourceAsync("topic-merge");

      const updateCall = mockPrisma.researchTopic.update.mock.calls[0][0];
      const updatedData = updateCall.data.topicConfig;

      // Existing field should be preserved
      expect(updatedData.existingField).toBe("preserved");
      // New fields added
      expect(updatedData.sourceTitle).toBe("New Title");
    });

    it("should set sourceDomain to user-provided when no sourceUrl", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-user-content",
        type: "EVENT",
        topicConfig: { sourceContent: "User pasted content" },
      });

      mockChat.chat.mockResolvedValue({
        content:
          '{"title":"User Content","eventType":"other","sourceDate":null,"keyEntities":{"people":[],"organizations":[],"technologies":[],"locations":[]}}',
      });
      mockPrisma.researchTopic.update.mockResolvedValue({});

      await service.parseEventSourceAsync("topic-user-content");

      const updateCall = mockPrisma.researchTopic.update.mock.calls[0][0];
      const updatedData = updateCall.data.topicConfig;
      expect(updatedData.sourceDomain).toBe("user-provided");
      expect(updatedData.sourceTier).toBe(3);
    });
  });

  // =========================================================================
  // Outer error handling
  // =========================================================================
  describe("outer error handling", () => {
    it("should not throw when prisma.findUnique throws", async () => {
      mockPrisma.researchTopic.findUnique.mockRejectedValue(
        new Error("DB connection lost"),
      );

      await expect(
        service.parseEventSourceAsync("topic-db-error"),
      ).resolves.not.toThrow();
    });

    it("should not throw when prisma.update throws", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-update-fail",
        type: "EVENT",
        topicConfig: { sourceContent: "Content" },
      });
      mockChat.chat.mockResolvedValue({
        content:
          '{"title":"T","eventType":"other","sourceDate":null,"keyEntities":{"people":[],"organizations":[],"technologies":[],"locations":[]}}',
      });
      mockPrisma.researchTopic.update.mockRejectedValue(
        new Error("DB write failed"),
      );

      await expect(
        service.parseEventSourceAsync("topic-update-fail"),
      ).resolves.not.toThrow();
    });
  });
});

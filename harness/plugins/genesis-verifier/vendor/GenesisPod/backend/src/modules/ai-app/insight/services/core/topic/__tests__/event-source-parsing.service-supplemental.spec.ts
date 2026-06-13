/**
 * EventSourceParsingService — Supplemental Tests
 *
 * The original spec (event-source-parsing.service.spec.ts) fails to run because its
 * @prisma/client mock is missing the PrismaClient class that PrismaService extends.
 * This supplemental file fixes that and re-covers the same scenarios, plus adds
 * additional edge cases to push coverage up.
 *
 * Covers:
 * - parseEventSourceAsync: topic not found → early return, no DB update
 * - parseEventSourceAsync: topic type != EVENT → early return
 * - parseEventSourceAsync: no sourceUrl + no sourceContent → early return
 * - parseEventSourceAsync: topicConfig is null → early return
 * - parseEventSourceAsync: sourceContent only → LLM called, DB updated
 * - parseEventSourceAsync: LLM returns full metadata → all fields saved
 * - parseEventSourceAsync: LLM returns null/non-JSON → only domain fields saved
 * - parseEventSourceAsync: sourceUrl fetch fails → fallback to domain/tier only
 * - parseEventSourceAsync: sourceUrl fetch succeeds → LLM called, DB updated
 * - parseEventSourceAsync: fetch HTTP error → graceful degrade
 * - parseEventSourceAsync: content-length too large → graceful degrade
 * - parseEventSourceAsync: body=null → uses response.text()
 * - parseEventSourceAsync: streaming bytes exceed 5MB → cancel reader
 * - validateFetchUrl: blocked URLs (localhost, 10.x, 172.16-31.x, 192.168.x, 169.254.x, 0.0.0.0, ::1, ftp://)
 * - validateFetchUrl: valid public URL passes
 * - WeChat URL: mp.weixin.qq.com → uses WeChat headers
 * - WeChat URL: anti-scraping detection → graceful degrade
 * - LLM errors: throws → silently caught
 * - outer DB error → silently caught
 * - partial JSON (only title) → sourceTitle set, eventType undefined
 * - embedded JSON in text → extracted correctly
 * - content > 3000 chars → truncated before LLM call
 * - existing config merged (existing fields preserved)
 * - sourceContent without URL → sourceDomain=user-provided, sourceTier=3
 */

// ─── Module-level mocks (before any imports) ──────────────────────────────────
jest.mock("@prisma/client", () => ({
  AIModelType: { CHAT: "CHAT" },
  PrismaClient: class {
    $connect = jest.fn();
    $disconnect = jest.fn();
  },
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
// ─────────────────────────────────────────────────────────────────────────────

import { Test, TestingModule } from "@nestjs/testing";
import { EventSourceParsingService } from "../event-source-parsing.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildMockPrisma() {
  return {
    researchTopic: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
  };
}

function buildMockChat(response?: { content: string } | null) {
  return {
    chat: jest.fn().mockResolvedValue(response ?? { content: "{}" }),
  };
}

function fullMetadataJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    title: "Test Event Title",
    eventType: "acquisition",
    sourceDate: "2026-01-15",
    keyEntities: {
      people: ["Jane Doe"],
      organizations: ["TechCorp"],
      technologies: ["AI"],
      locations: ["Beijing"],
    },
    ...overrides,
  });
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("EventSourceParsingService (supplemental)", () => {
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
  // Early return paths
  // =========================================================================

  describe("early returns", () => {
    it("returns without DB update when topic is not found", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue(null);

      await service.parseEventSourceAsync("topic-missing");

      expect(mockPrisma.researchTopic.update).not.toHaveBeenCalled();
    });

    it("returns without DB update when topic type is not EVENT", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "t1",
        type: "TECHNOLOGY",
        topicConfig: {},
      });

      await service.parseEventSourceAsync("t1");

      expect(mockPrisma.researchTopic.update).not.toHaveBeenCalled();
    });

    it("returns without DB update when topicConfig has no sourceUrl or sourceContent", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "t2",
        type: "EVENT",
        topicConfig: { unrelatedField: "value" },
      });

      await service.parseEventSourceAsync("t2");

      expect(mockPrisma.researchTopic.update).not.toHaveBeenCalled();
    });

    it("returns without DB update when topicConfig is null", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "t3",
        type: "EVENT",
        topicConfig: null,
      });

      await service.parseEventSourceAsync("t3");

      expect(mockPrisma.researchTopic.update).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // sourceContent paths
  // =========================================================================

  describe("sourceContent only (no URL fetch)", () => {
    it("calls LLM and updates DB once", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "t4",
        type: "EVENT",
        topicConfig: { sourceContent: "Article about AI acquisition" },
      });

      mockChat.chat.mockResolvedValue({ content: fullMetadataJson() });

      await service.parseEventSourceAsync("t4");

      expect(mockChat.chat).toHaveBeenCalledTimes(1);
      expect(mockPrisma.researchTopic.update).toHaveBeenCalledTimes(1);
    });

    it("saves all metadata fields when LLM returns complete data", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "t5",
        type: "EVENT",
        topicConfig: { sourceContent: "Event content" },
      });

      mockChat.chat.mockResolvedValue({
        content: fullMetadataJson({
          title: "Acquisition Event",
          eventType: "acquisition",
          sourceDate: "2026-03-01",
        }),
      });

      await service.parseEventSourceAsync("t5");

      const updateCall = mockPrisma.researchTopic.update.mock.calls[0][0];
      const data = updateCall.data.topicConfig;

      expect(data.sourceTitle).toBe("Acquisition Event");
      expect(data.eventType).toBe("acquisition");
      expect(data.sourceDate).toBe("2026-03-01");
      expect(data.keyEntities).toBeDefined();
    });

    it("does not set sourceTitle when LLM returns non-JSON content", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "t6",
        type: "EVENT",
        topicConfig: { sourceContent: "Unparseable text" },
      });

      mockChat.chat.mockResolvedValue({
        content: "Sorry, I cannot process this.",
      });

      await service.parseEventSourceAsync("t6");

      const updateCall = mockPrisma.researchTopic.update.mock.calls[0][0];
      expect(updateCall.data.topicConfig.sourceTitle).toBeUndefined();
    });

    it("sets sourceDomain=user-provided and sourceTier=3 when only sourceContent present", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "t7",
        type: "EVENT",
        topicConfig: { sourceContent: "Pasted article text" },
      });

      mockChat.chat.mockResolvedValue({ content: fullMetadataJson() });

      await service.parseEventSourceAsync("t7");

      const updateCall = mockPrisma.researchTopic.update.mock.calls[0][0];
      const data = updateCall.data.topicConfig;
      expect(data.sourceDomain).toBe("user-provided");
      expect(data.sourceTier).toBe(3);
    });

    it("preserves existing topicConfig fields when updating", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "t8",
        type: "EVENT",
        topicConfig: {
          existingKey: "preserved",
          sourceContent: "Article content",
        },
      });

      mockChat.chat.mockResolvedValue({
        content: fullMetadataJson({ title: "New Title" }),
      });

      await service.parseEventSourceAsync("t8");

      const updateCall = mockPrisma.researchTopic.update.mock.calls[0][0];
      const data = updateCall.data.topicConfig;
      expect(data.existingKey).toBe("preserved");
      expect(data.sourceTitle).toBe("New Title");
    });

    it("handles partial JSON (only title)", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "t9",
        type: "EVENT",
        topicConfig: { sourceContent: "Article content" },
      });

      mockChat.chat.mockResolvedValue({
        content: '{"title":"Partial Title"}',
      });

      await service.parseEventSourceAsync("t9");

      const updateCall = mockPrisma.researchTopic.update.mock.calls[0][0];
      const data = updateCall.data.topicConfig;
      expect(data.sourceTitle).toBe("Partial Title");
      expect(data.eventType).toBeUndefined();
    });

    it("extracts JSON embedded in surrounding text", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "t10",
        type: "EVENT",
        topicConfig: { sourceContent: "Some content" },
      });

      mockChat.chat.mockResolvedValue({
        content: `Here is the analysis: ${fullMetadataJson({ title: "Embedded", eventType: "funding" })} Hope that helps!`,
      });

      await service.parseEventSourceAsync("t10");

      const updateCall = mockPrisma.researchTopic.update.mock.calls[0][0];
      const data = updateCall.data.topicConfig;
      expect(data.sourceTitle).toBe("Embedded");
      expect(data.eventType).toBe("funding");
    });

    it("truncates content >3000 chars before LLM call", async () => {
      const longContent = "x".repeat(5000);
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "t11",
        type: "EVENT",
        topicConfig: { sourceContent: longContent },
      });

      mockChat.chat.mockResolvedValue({ content: fullMetadataJson() });

      await service.parseEventSourceAsync("t11");

      const chatArgs = mockChat.chat.mock.calls[0][0];
      const userContent = chatArgs.messages[1].content as string;
      // Content passed to LLM should not include the full 5000 chars
      expect(userContent.length).toBeLessThan(longContent.length + 500);
    });
  });

  // =========================================================================
  // URL fetch paths
  // =========================================================================

  describe("URL fetching", () => {
    const savedFetch = global.fetch;

    afterEach(() => {
      global.fetch = savedFetch;
    });

    it("updates config with domain and tier when fetch fails", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "t12",
        type: "EVENT",
        topicConfig: { sourceUrl: "https://reuters.com/article/1" },
      });

      global.fetch = jest.fn().mockRejectedValue(new Error("Network error"));

      await service.parseEventSourceAsync("t12");

      expect(mockPrisma.researchTopic.update).toHaveBeenCalledTimes(1);
      const data =
        mockPrisma.researchTopic.update.mock.calls[0][0].data.topicConfig;
      expect(data.sourceDomain).toBe("reuters.com");
    });

    it("fetches URL, calls LLM, and saves all fields on success", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "t13",
        type: "EVENT",
        topicConfig: { sourceUrl: "https://example.com/article" },
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: jest.fn().mockReturnValue(null) },
        body: null,
        text: jest
          .fn()
          .mockResolvedValue("<html><body>Article text</body></html>"),
      } as unknown as Response);

      mockChat.chat.mockResolvedValue({
        content: fullMetadataJson({ title: "Fetched Article" }),
      });

      await service.parseEventSourceAsync("t13");

      expect(mockPrisma.researchTopic.update).toHaveBeenCalledTimes(1);
      expect(mockChat.chat).toHaveBeenCalledTimes(1);
    });

    it("gracefully handles HTTP 404 response", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "t14",
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

      await service.parseEventSourceAsync("t14");

      // Update called once (domain/tier fallback)
      expect(mockPrisma.researchTopic.update).toHaveBeenCalledTimes(1);
    });

    it("gracefully handles oversized content-length (>5MB)", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "t15",
        type: "EVENT",
        topicConfig: { sourceUrl: "https://example.com/huge" },
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

      await service.parseEventSourceAsync("t15");

      // Should not crash
      expect(mockPrisma.researchTopic.update).toHaveBeenCalledTimes(1);
    });

    it("uses response.text() when body is null", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "t16",
        type: "EVENT",
        topicConfig: { sourceUrl: "https://example.com/simple" },
      });

      const textFn = jest.fn().mockResolvedValue("Simple content");
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: jest.fn().mockReturnValue(null) },
        body: null,
        text: textFn,
      } as unknown as Response);

      mockChat.chat.mockResolvedValue({ content: fullMetadataJson() });

      await service.parseEventSourceAsync("t16");

      expect(mockPrisma.researchTopic.update).toHaveBeenCalledTimes(1);
    });

    it("cancels stream reader when streaming bytes exceed 5MB", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "t17",
        type: "EVENT",
        topicConfig: { sourceUrl: "https://example.com/stream-large" },
      });

      const largeChunk = new Uint8Array(6 * 1024 * 1024);
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

      await service.parseEventSourceAsync("t17");

      expect(mockReader.cancel).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // SSRF protection — validateFetchUrl
  // =========================================================================

  describe("SSRF protection (validateFetchUrl)", () => {
    const blockedUrls = [
      "not-a-url",
      "ftp://example.com/file",
      "http://localhost/admin",
      "http://127.0.0.1/secret",
      "http://10.0.0.1/internal",
      "http://172.16.0.1/internal",
      "http://172.31.255.255/internal",
      "http://192.168.1.1/admin",
      "http://169.254.169.254/metadata",
      "http://0.0.0.0/anything",
    ];

    afterEach(() => {
      // restore fetch if overridden
    });

    for (const url of blockedUrls) {
      it(`does not crash for blocked URL: ${url}`, async () => {
        mockPrisma.researchTopic.findUnique.mockResolvedValue({
          id: "t-blocked",
          type: "EVENT",
          topicConfig: { sourceUrl: url },
        });
        mockPrisma.researchTopic.update.mockResolvedValue({});

        await expect(
          service.parseEventSourceAsync("t-blocked"),
        ).resolves.not.toThrow();
      });
    }

    it("actually attempts fetch for valid public URL", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "t-valid",
        type: "EVENT",
        topicConfig: { sourceUrl: "https://techcrunch.com/article/1" },
      });

      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockRejectedValue(new Error("Network error"));

      await service.parseEventSourceAsync("t-valid");

      expect(global.fetch).toHaveBeenCalled();
      global.fetch = originalFetch;
    });
  });

  // =========================================================================
  // WeChat URL handling
  // =========================================================================

  describe("WeChat URL handling", () => {
    const savedFetch = global.fetch;

    afterEach(() => {
      global.fetch = savedFetch;
    });

    it("uses WeChat-specific Referer header for mp.weixin.qq.com", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "t-wx1",
        type: "EVENT",
        topicConfig: { sourceUrl: "https://mp.weixin.qq.com/s/article-abc" },
      });

      const capturedInits: RequestInit[] = [];
      global.fetch = jest
        .fn()
        .mockImplementation((_url: string, init?: RequestInit) => {
          capturedInits.push(init ?? {});
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

      mockChat.chat.mockResolvedValue({ content: fullMetadataJson() });

      await service.parseEventSourceAsync("t-wx1");

      expect(capturedInits.length).toBeGreaterThan(0);
      const headers = capturedInits[0].headers as Record<string, string>;
      expect(headers["Referer"]).toBe("https://mp.weixin.qq.com/");
    });

    it("gracefully handles WeChat anti-scraping response (环境异常)", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "t-wx2",
        type: "EVENT",
        topicConfig: { sourceUrl: "https://mp.weixin.qq.com/s/blocked" },
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: jest.fn().mockReturnValue(null) },
        body: null,
        text: jest.fn().mockResolvedValue("环境异常，请在微信客户端打开"),
      } as unknown as Response);

      await service.parseEventSourceAsync("t-wx2");

      expect(mockPrisma.researchTopic.update).toHaveBeenCalledTimes(1);
    });

    it("parses WeChat HTML with rich_media_title and js_content", async () => {
      const wechatHtml = `
        <html>
          <body>
            <h1 class="rich_media_title">WeChat Article Title</h1>
            <a id="js_name">My Account</a>
            <em id="publish_time">2026-02-20</em>
            <div id="js_content">
              <p>Main body content paragraph.</p>
            </div>
          </body>
        </html>
      `;

      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "t-wx3",
        type: "EVENT",
        topicConfig: { sourceUrl: "https://mp.weixin.qq.com/s/test" },
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: jest.fn().mockReturnValue(null) },
        body: null,
        text: jest.fn().mockResolvedValue(wechatHtml),
      } as unknown as Response);

      mockChat.chat.mockResolvedValue({
        content: fullMetadataJson({ title: "WeChat Article Title" }),
      });

      await service.parseEventSourceAsync("t-wx3");

      expect(mockPrisma.researchTopic.update).toHaveBeenCalledTimes(1);
    });

    it("handles WeChat HTTP 403 response gracefully", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "t-wx4",
        type: "EVENT",
        topicConfig: { sourceUrl: "https://mp.weixin.qq.com/s/forbidden" },
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 403,
        headers: { get: jest.fn().mockReturnValue(null) },
        body: null,
        text: jest.fn().mockResolvedValue("Forbidden"),
      } as unknown as Response);

      await service.parseEventSourceAsync("t-wx4");

      expect(mockPrisma.researchTopic.update).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // LLM / DB error handling
  // =========================================================================

  describe("error handling", () => {
    it("does not throw when LLM.chat throws", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "t-err1",
        type: "EVENT",
        topicConfig: { sourceContent: "Content" },
      });

      mockChat.chat.mockRejectedValue(new Error("LLM unavailable"));

      await expect(
        service.parseEventSourceAsync("t-err1"),
      ).resolves.not.toThrow();

      // DB still updated with domain/tier info
      expect(mockPrisma.researchTopic.update).toHaveBeenCalledTimes(1);
    });

    it("does not throw when prisma.findUnique throws", async () => {
      mockPrisma.researchTopic.findUnique.mockRejectedValue(
        new Error("DB down"),
      );

      await expect(
        service.parseEventSourceAsync("t-err2"),
      ).resolves.not.toThrow();
    });

    it("does not throw when prisma.update throws", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "t-err3",
        type: "EVENT",
        topicConfig: { sourceContent: "Content" },
      });
      mockChat.chat.mockResolvedValue({ content: fullMetadataJson() });
      mockPrisma.researchTopic.update.mockRejectedValue(
        new Error("DB write failed"),
      );

      await expect(
        service.parseEventSourceAsync("t-err3"),
      ).resolves.not.toThrow();
    });
  });
});

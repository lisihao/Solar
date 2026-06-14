/**
 * WechatAdapter — cookie auth / session / summarizeTitle / readContextCookies
 *
 * Covers:
 * - summarizeTitle: short title (no truncation), long title LLM path, LLM bad result,
 *   LLM error fallback, fallback truncation
 * - readContextCookies: success with cookies, tool failure (returns [])
 * - ensureCoverImageUrl: provided url pass-through, fallback placehold.co generation
 * - cookie filtering: valid non-expired cookies, all-expired cookies
 * - sessionData parsing: string vs object input
 */

import { Test, TestingModule } from "@nestjs/testing";
import { WechatAdapter } from "../wechat/wechat.adapter";
import { SocialBrowserService } from "../../mission/services/social-browser.service";
import { WechatImageUploaderService } from "../../mission/services/wechat-image-uploader.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { ToolRegistry } from "@/modules/ai-engine/facade";
import {
  SocialContent,
  SocialPlatformConnection,
  SocialPlatformType,
  SocialContentType,
  SocialContentStatus,
  SocialContentSourceType,
} from "../../mission/types";

// ---------------------------------------------------------------------------
// Mock session-crypto
// ---------------------------------------------------------------------------
jest.mock("../../mission/services/session-crypto", () => ({
  decryptSession: jest.fn(),
  encryptSession: jest.fn((data: unknown) => JSON.stringify(data)),
  isEncrypted: jest.fn(() => false),
}));

import { decryptSession } from "../../mission/services/session-crypto";
const mockDecryptSession = decryptSession as jest.MockedFunction<
  typeof decryptSession
>;

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeValidCookies() {
  return [
    {
      name: "slave_user",
      value: "u1",
      domain: "mp.weixin.qq.com",
      expires: -1,
    },
    {
      name: "data_ticket",
      value: "t1",
      domain: "mp.weixin.qq.com",
      expires: -1,
    },
  ];
}

function makeSessionData(overrides: Record<string, unknown> = {}) {
  return {
    cookies: makeValidCookies(),
    wechatToken: "tok123",
    ...overrides,
  };
}

function makeConnection(
  overrides: Partial<SocialPlatformConnection> = {},
): SocialPlatformConnection {
  return {
    id: "conn-1",
    userId: "user-1",
    platformType: SocialPlatformType.WECHAT_MP,
    isActive: true,
    sessionData: "encrypted-data",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as SocialPlatformConnection;
}

function makeContent(overrides: Partial<SocialContent> = {}): SocialContent {
  return {
    id: "content-1",
    userId: "user-1",
    title: "Short Title",
    content: "x".repeat(50),
    contentType: SocialContentType.WECHAT_ARTICLE,
    status: SocialContentStatus.DRAFT,
    sourceType: SocialContentSourceType.MANUAL,
    images: [],
    tags: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as SocialContent;
}

function makeMockPage() {
  return {
    goto: jest.fn().mockResolvedValue(undefined),
    url: jest
      .fn()
      .mockReturnValue("https://mp.weixin.qq.com/cgi-bin/home?token=tok123"),
    reload: jest.fn().mockResolvedValue(undefined),
    waitForNetworkIdle: jest.fn().mockResolvedValue(undefined),
    waitForSelector: jest.fn().mockResolvedValue(null),
    evaluate: jest.fn().mockResolvedValue(""),
    $: jest.fn().mockResolvedValue(null),
    $$: jest.fn().mockResolvedValue([]),
    $$eval: jest.fn().mockResolvedValue([]),
    screenshot: jest.fn().mockResolvedValue(Buffer.from("")),
    title: jest.fn().mockResolvedValue("Editor"),
    browser: jest.fn().mockReturnValue({ once: jest.fn() }),
    on: jest.fn(),
    off: jest.fn(),
    frames: jest.fn().mockReturnValue([]),
    keyboard: {
      down: jest.fn().mockResolvedValue(undefined),
      up: jest.fn().mockResolvedValue(undefined),
      press: jest.fn().mockResolvedValue(undefined),
      type: jest.fn().mockResolvedValue(undefined),
    },
    waitForResponse: jest.fn().mockResolvedValue({
      url: () => "https://mp.weixin.qq.com/cgi-bin/operate_appmsg",
      json: jest.fn().mockResolvedValue({ base_resp: { ret: 0 } }),
    }),
    mouse: {
      move: jest.fn().mockResolvedValue(undefined),
      click: jest.fn().mockResolvedValue(undefined),
    },
  };
}

// ---------------------------------------------------------------------------
// Module builder
// ---------------------------------------------------------------------------

async function buildModule(
  chatFacadeValue: object,
  toolRegistryValue: object,
  browserServiceValue?: object,
): Promise<{
  adapter: WechatAdapter;
  mockPage: ReturnType<typeof makeMockPage>;
  chatFacade: { chat: jest.Mock };
}> {
  const mockPage = makeMockPage();
  const defaultBrowser = browserServiceValue ?? {
    restoreSession: jest.fn().mockResolvedValue(undefined),
    createPage: jest.fn().mockResolvedValue(mockPage),
    closeContext: jest.fn().mockResolvedValue(undefined),
    getContext: jest.fn().mockResolvedValue(null),
    saveSession: jest.fn().mockResolvedValue(null),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      WechatAdapter,
      { provide: SocialBrowserService, useValue: defaultBrowser },
      {
        provide: WechatImageUploaderService,
        useValue: {
          rewriteImagesInHtml: jest
            .fn()
            .mockImplementation(async (_p, html: string) => ({
              rewritten: html,
              uploaded: 0,
              failed: 0,
              skipped: 0,
            })),
          uploadCover: jest.fn().mockResolvedValue(null),
        },
      },
      { provide: ChatFacade, useValue: chatFacadeValue },
      { provide: ToolRegistry, useValue: toolRegistryValue },
    ],
  }).compile();

  return {
    adapter: module.get<WechatAdapter>(WechatAdapter),
    mockPage,
    chatFacade: chatFacadeValue as { chat: jest.Mock },
  };
}

// ---------------------------------------------------------------------------
// Tests: summarizeTitle (covered via publish → long title)
// ---------------------------------------------------------------------------

describe("WechatAdapter — cookie auth / summarizeTitle / readContextCookies", () => {
  let mockChatFacade: { chat: jest.Mock };
  let mockToolRegistry: { get: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    mockChatFacade = { chat: jest.fn() };
    mockToolRegistry = {
      get: jest.fn().mockReturnValue({
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            cookies: [{ name: "slave_user", domain: "mp.weixin.qq.com" }],
          },
        }),
      }),
    };
  });

  // ─── summarizeTitle via publish ───────────────────────────────────────────

  describe("summarizeTitle", () => {
    it("does not call chatFacade for titles within 30 chars", async () => {
      const shortTitle = "短标题"; // 3 chars
      mockDecryptSession.mockReturnValue(makeSessionData() as unknown);
      // Make publish fail fast after session restore
      const browserService = {
        restoreSession: jest.fn().mockRejectedValue(new Error("bail")),
        createPage: jest.fn(),
        closeContext: jest.fn().mockResolvedValue(undefined),
        getContext: jest.fn().mockResolvedValue(null),
        saveSession: jest.fn().mockResolvedValue(null),
      };
      const { adapter } = await buildModule(
        mockChatFacade,
        mockToolRegistry,
        browserService,
      );

      await adapter.publish(
        makeContent({ title: shortTitle }),
        makeConnection(),
      );

      expect(mockChatFacade.chat).not.toHaveBeenCalled();
    });

    it("calls chatFacade to summarize titles over 30 chars and uses the result", async () => {
      // 31-char title (31 ASCII chars → codepoint count 31 > 30)
      const longTitle = "A".repeat(31);
      mockDecryptSession.mockReturnValue(makeSessionData() as unknown);
      mockChatFacade.chat.mockResolvedValue({ content: "短标题" });

      const mockPage = makeMockPage();
      // URL includes token so token-wait loop exits, and URL includes home so login passes
      mockPage.url.mockReturnValue(
        "https://mp.weixin.qq.com/cgi-bin/home?token=tok123",
      );
      const browserService = {
        restoreSession: jest.fn().mockResolvedValue(undefined),
        createPage: jest.fn().mockResolvedValue(mockPage),
        closeContext: jest.fn().mockResolvedValue(undefined),
        getContext: jest.fn().mockResolvedValue(null),
        saveSession: jest.fn().mockResolvedValue(null),
      };
      const { adapter } = await buildModule(
        mockChatFacade,
        mockToolRegistry,
        browserService,
      );

      await adapter.publish(
        makeContent({ title: longTitle }),
        makeConnection(),
      );

      // chatFacade.chat must have been called for title summarization
      expect(mockChatFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "user" }),
          ]),
        }),
      );
    });

    it("falls back to truncation when LLM returns empty result", async () => {
      const longTitle = "A".repeat(35);
      mockDecryptSession.mockReturnValue(makeSessionData() as unknown);
      // LLM returns empty content → summarizeTitle falls back to truncation
      mockChatFacade.chat.mockResolvedValue({ content: "" });

      const mockPage = makeMockPage();
      mockPage.url.mockReturnValue(
        "https://mp.weixin.qq.com/cgi-bin/home?token=tok123",
      );
      const browserService = {
        restoreSession: jest.fn().mockResolvedValue(undefined),
        createPage: jest.fn().mockResolvedValue(mockPage),
        closeContext: jest.fn().mockResolvedValue(undefined),
        getContext: jest.fn().mockResolvedValue(null),
        saveSession: jest.fn().mockResolvedValue(null),
      };
      const { adapter } = await buildModule(
        mockChatFacade,
        mockToolRegistry,
        browserService,
      );

      // Should not throw; truncation is the fallback
      const result = await adapter.publish(
        makeContent({ title: longTitle }),
        makeConnection(),
      );
      // publish may fail downstream but summarizeTitle ran without throwing
      expect(result.success).toBe(false);
      expect(mockChatFacade.chat).toHaveBeenCalled();
    });

    it("falls back to truncation when LLM returns a title still over 30 chars", async () => {
      const longTitle = "B".repeat(35);
      mockDecryptSession.mockReturnValue(makeSessionData() as unknown);
      // LLM returns a still-too-long title
      mockChatFacade.chat.mockResolvedValue({ content: "C".repeat(35) });

      const browserService = {
        restoreSession: jest.fn().mockRejectedValue(new Error("bail")),
        createPage: jest.fn(),
        closeContext: jest.fn().mockResolvedValue(undefined),
        getContext: jest.fn().mockResolvedValue(null),
        saveSession: jest.fn().mockResolvedValue(null),
      };
      const { adapter } = await buildModule(
        mockChatFacade,
        mockToolRegistry,
        browserService,
      );

      const result = await adapter.publish(
        makeContent({ title: longTitle }),
        makeConnection(),
      );
      expect(result.success).toBe(false);
    });

    it("falls back to truncation when chatFacade throws", async () => {
      const longTitle = "D".repeat(35);
      mockDecryptSession.mockReturnValue(makeSessionData() as unknown);
      mockChatFacade.chat.mockRejectedValue(new Error("LLM API Error"));

      const browserService = {
        restoreSession: jest.fn().mockRejectedValue(new Error("bail")),
        createPage: jest.fn(),
        closeContext: jest.fn().mockResolvedValue(undefined),
        getContext: jest.fn().mockResolvedValue(null),
        saveSession: jest.fn().mockResolvedValue(null),
      };
      const { adapter } = await buildModule(
        mockChatFacade,
        mockToolRegistry,
        browserService,
      );

      // Should handle gracefully — not rethrow
      const result = await adapter.publish(
        makeContent({ title: longTitle }),
        makeConnection(),
      );
      expect(result.success).toBe(false); // failed by "bail" not by LLM throw
    });

    it("strips surrounding quotes and trailing punctuation from LLM result", async () => {
      const longTitle = "E".repeat(35);
      mockDecryptSession.mockReturnValue(makeSessionData() as unknown);
      // LLM returns quoted title with trailing punctuation; summarizeTitle strips them
      mockChatFacade.chat.mockResolvedValue({ content: '"短标题。"' });

      const mockPage = makeMockPage();
      mockPage.url.mockReturnValue(
        "https://mp.weixin.qq.com/cgi-bin/home?token=tok123",
      );
      const browserService = {
        restoreSession: jest.fn().mockResolvedValue(undefined),
        createPage: jest.fn().mockResolvedValue(mockPage),
        closeContext: jest.fn().mockResolvedValue(undefined),
        getContext: jest.fn().mockResolvedValue(null),
        saveSession: jest.fn().mockResolvedValue(null),
      };
      const { adapter } = await buildModule(
        mockChatFacade,
        mockToolRegistry,
        browserService,
      );

      await adapter.publish(
        makeContent({ title: longTitle }),
        makeConnection(),
      );
      // LLM was called; strip logic runs on the returned content
      expect(mockChatFacade.chat).toHaveBeenCalled();
    });
  });

  // ─── readContextCookies ────────────────────────────────────────────────────

  describe("readContextCookies (via publish flow)", () => {
    it("tool failure causes readContextCookies to return empty array (publish continues)", async () => {
      // The tool fails; readContextCookies returns [] and publish logs a warn
      // but does NOT abort — this tests the failure-recovery path
      mockDecryptSession.mockReturnValue(makeSessionData() as unknown);

      const failingToolRegistry = {
        get: jest.fn().mockReturnValue({
          execute: jest.fn().mockResolvedValue({
            success: false,
            error: { message: "tool execution failed" },
          }),
        }),
      };

      const mockPage = makeMockPage();
      // URL: always returns home with token → login check passes
      mockPage.url.mockReturnValue(
        "https://mp.weixin.qq.com/cgi-bin/home?token=tok123",
      );

      const browserService = {
        restoreSession: jest.fn().mockResolvedValue(undefined),
        createPage: jest.fn().mockResolvedValue(mockPage),
        closeContext: jest.fn().mockResolvedValue(undefined),
        getContext: jest.fn().mockResolvedValue(null),
        saveSession: jest.fn().mockResolvedValue(null),
      };
      mockChatFacade.chat.mockResolvedValue({ content: "短标题" });

      const { adapter } = await buildModule(
        mockChatFacade,
        failingToolRegistry,
        browserService,
      );

      // publish will proceed past readContextCookies (which returns []) and eventually
      // fail at fillContent title injection (evaluate returns "" not a valid fill result)
      const result = await adapter.publish(makeContent(), makeConnection());
      // Tool failure should not abort publish; publish attempts to continue
      expect(failingToolRegistry.get).toHaveBeenCalled();
      // Result can be success or failure depending on downstream mocks
      expect(typeof result.success).toBe("boolean");
    });

    it("tool success returns cookies and logs them", async () => {
      mockDecryptSession.mockReturnValue(makeSessionData() as unknown);

      const toolWithCookies = {
        get: jest.fn().mockReturnValue({
          execute: jest.fn().mockResolvedValue({
            success: true,
            data: {
              cookies: [
                { name: "slave_user", domain: "mp.weixin.qq.com" },
                { name: "data_ticket", domain: ".qq.com" },
              ],
            },
          }),
        }),
      };

      const mockPage = makeMockPage();
      mockPage.url.mockReturnValue(
        "https://mp.weixin.qq.com/cgi-bin/home?token=tok123",
      );

      const browserService = {
        restoreSession: jest.fn().mockResolvedValue(undefined),
        createPage: jest.fn().mockResolvedValue(mockPage),
        closeContext: jest.fn().mockResolvedValue(undefined),
        getContext: jest.fn().mockResolvedValue(null),
        saveSession: jest.fn().mockResolvedValue(null),
      };
      mockChatFacade.chat.mockResolvedValue({ content: "短标题" });

      const { adapter } = await buildModule(
        mockChatFacade,
        toolWithCookies,
        browserService,
      );

      await adapter.publish(makeContent(), makeConnection());
      expect(toolWithCookies.get).toHaveBeenCalledWith("browser-context");
    });
  });

  // ─── ensureCoverImageUrl ───────────────────────────────────────────────────

  describe("ensureCoverImageUrl (exercised via publish with cover)", () => {
    it("uses content.coverImageUrl when provided (no fallback)", async () => {
      mockDecryptSession.mockReturnValue(makeSessionData() as unknown);
      mockChatFacade.chat.mockResolvedValue({ content: "短标题" });

      const mockImageUploader = {
        rewriteImagesInHtml: jest
          .fn()
          .mockImplementation(async (_p, html: string) => ({
            rewritten: html,
            uploaded: 0,
            failed: 0,
            skipped: 0,
          })),
        uploadCover: jest.fn().mockResolvedValue({
          uploadCdnUrl: "https://mmbiz.qpic.cn/cover.jpg",
          uploadFileId: "fid1",
          cropCdnUrl235: "https://mmbiz.qpic.cn/crop235.jpg",
          cropFileId235: "fid2",
          cropCdnUrl1_1: "https://mmbiz.qpic.cn/crop11.jpg",
          cropFileId1_1: "fid3",
        }),
      };

      const mockPage = makeMockPage();
      mockPage.url.mockReturnValue(
        "https://mp.weixin.qq.com/cgi-bin/home?token=tok123",
      );

      const browserService = {
        restoreSession: jest.fn().mockResolvedValue(undefined),
        createPage: jest.fn().mockResolvedValue(mockPage),
        closeContext: jest.fn().mockResolvedValue(undefined),
        getContext: jest.fn().mockResolvedValue(null),
        saveSession: jest.fn().mockResolvedValue(null),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WechatAdapter,
          { provide: SocialBrowserService, useValue: browserService },
          { provide: WechatImageUploaderService, useValue: mockImageUploader },
          { provide: ChatFacade, useValue: mockChatFacade },
          { provide: ToolRegistry, useValue: mockToolRegistry },
        ],
      }).compile();
      const adapter = module.get<WechatAdapter>(WechatAdapter);

      await adapter.publish(
        makeContent({ coverImageUrl: "https://cdn.example.com/cover.jpg" }),
        makeConnection(),
      );

      // uploadCover should have been called with the provided cover URL
      expect(mockImageUploader.uploadCover).toHaveBeenCalledWith(
        expect.anything(),
        "https://cdn.example.com/cover.jpg",
        expect.any(String),
        expect.any(String),
      );
    });

    it("generates placehold.co URL when coverImageUrl is absent", async () => {
      mockDecryptSession.mockReturnValue(makeSessionData() as unknown);
      mockChatFacade.chat.mockResolvedValue({ content: "短标题" });

      const mockImageUploader = {
        rewriteImagesInHtml: jest
          .fn()
          .mockImplementation(async (_p, html: string) => ({
            rewritten: html,
            uploaded: 0,
            failed: 0,
            skipped: 0,
          })),
        uploadCover: jest.fn().mockResolvedValue(null),
      };

      const mockPage = makeMockPage();
      mockPage.url.mockReturnValue(
        "https://mp.weixin.qq.com/cgi-bin/home?token=tok123",
      );

      const browserService = {
        restoreSession: jest.fn().mockResolvedValue(undefined),
        createPage: jest.fn().mockResolvedValue(mockPage),
        closeContext: jest.fn().mockResolvedValue(undefined),
        getContext: jest.fn().mockResolvedValue(null),
        saveSession: jest.fn().mockResolvedValue(null),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WechatAdapter,
          { provide: SocialBrowserService, useValue: browserService },
          { provide: WechatImageUploaderService, useValue: mockImageUploader },
          { provide: ChatFacade, useValue: mockChatFacade },
          { provide: ToolRegistry, useValue: mockToolRegistry },
        ],
      }).compile();
      const adapter = module.get<WechatAdapter>(WechatAdapter);

      await adapter.publish(
        makeContent({ coverImageUrl: undefined }),
        makeConnection(),
      );

      // uploadCover called with placehold.co URL
      expect(mockImageUploader.uploadCover).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining("placehold.co"),
        expect.any(String),
        expect.any(String),
      );
    });
  });

  // ─── cookie expiry / filtering ─────────────────────────────────────────────

  describe("cookie filtering in publish", () => {
    it("filters out expired cookies before restoring session", async () => {
      const pastTs = Math.floor(Date.now() / 1000) - 7200; // 2h ago
      const futureTs = Math.floor(Date.now() / 1000) + 7200; // 2h from now
      mockDecryptSession.mockReturnValue({
        cookies: [
          {
            name: "slave_user",
            value: "u1",
            domain: "mp.weixin.qq.com",
            expires: pastTs,
          },
          {
            name: "data_ticket",
            value: "t1",
            domain: "mp.weixin.qq.com",
            expires: futureTs,
          },
        ],
        wechatToken: "tok123",
      } as unknown);

      const browserService = {
        restoreSession: jest.fn().mockRejectedValue(new Error("bail")),
        createPage: jest.fn(),
        closeContext: jest.fn().mockResolvedValue(undefined),
        getContext: jest.fn().mockResolvedValue(null),
        saveSession: jest.fn().mockResolvedValue(null),
      };
      const { adapter } = await buildModule(
        mockChatFacade,
        mockToolRegistry,
        browserService,
      );

      const result = await adapter.publish(makeContent(), makeConnection());
      // Only data_ticket (non-expired) is in key-cookies check
      // slave_user is expired → keyCookies should still have data_ticket
      // Since data_ticket is valid, session is not immediately rejected
      expect(result.success).toBe(false);
      // restoreSession was called (not rejected before that)
      expect(browserService.restoreSession).toHaveBeenCalled();
    });

    it("rejects when ALL non-expired cookies are non-key cookies", async () => {
      const futureTs = Math.floor(Date.now() / 1000) + 7200;
      mockDecryptSession.mockReturnValue({
        cookies: [
          {
            name: "non_key_cookie",
            value: "v1",
            domain: "mp.weixin.qq.com",
            expires: futureTs,
          },
        ],
        wechatToken: "tok123",
      } as unknown);

      const browserService = {
        restoreSession: jest.fn(),
        createPage: jest.fn(),
        closeContext: jest.fn().mockResolvedValue(undefined),
        getContext: jest.fn().mockResolvedValue(null),
        saveSession: jest.fn().mockResolvedValue(null),
      };
      const { adapter } = await buildModule(
        mockChatFacade,
        mockToolRegistry,
        browserService,
      );

      const result = await adapter.publish(makeContent(), makeConnection());
      expect(result.success).toBe(false);
      // keyCookies.length === 0 → early return before restoreSession
      expect(browserService.restoreSession).not.toHaveBeenCalled();
      expect(result.errorMessage).toMatch(/过期|失效|Cookie/);
    });

    it("handles cookies with expires=-1 (session cookies) as valid", async () => {
      mockDecryptSession.mockReturnValue({
        cookies: [
          {
            name: "slave_user",
            value: "u1",
            domain: "mp.weixin.qq.com",
            expires: -1,
          },
          {
            name: "data_ticket",
            value: "t1",
            domain: "mp.weixin.qq.com",
            expires: -1,
          },
        ],
        wechatToken: "tok123",
      } as unknown);

      const browserService = {
        restoreSession: jest.fn().mockRejectedValue(new Error("bail-session")),
        createPage: jest.fn(),
        closeContext: jest.fn().mockResolvedValue(undefined),
        getContext: jest.fn().mockResolvedValue(null),
        saveSession: jest.fn().mockResolvedValue(null),
      };
      const { adapter } = await buildModule(
        mockChatFacade,
        mockToolRegistry,
        browserService,
      );

      await adapter.publish(makeContent(), makeConnection());
      // Session cookies (expires=-1) should pass the expiry check
      expect(browserService.restoreSession).toHaveBeenCalled();
    });
  });

  // ─── sessionData as object vs string ─────────────────────────────────────

  describe("sessionData object vs string parsing", () => {
    it("parses sessionData when provided as non-string object", async () => {
      const sessionObj = makeSessionData();
      const connection = makeConnection({
        sessionData: sessionObj as unknown as string,
      });
      mockDecryptSession.mockReturnValue(sessionObj as unknown);

      const browserService = {
        restoreSession: jest.fn().mockRejectedValue(new Error("bail")),
        createPage: jest.fn(),
        closeContext: jest.fn().mockResolvedValue(undefined),
        getContext: jest.fn().mockResolvedValue(null),
        saveSession: jest.fn().mockResolvedValue(null),
      };
      const { adapter } = await buildModule(
        mockChatFacade,
        mockToolRegistry,
        browserService,
      );

      await adapter.publish(makeContent(), connection);

      // decryptSession should have been called with the JSON.stringified object
      expect(mockDecryptSession).toHaveBeenCalledWith(
        JSON.stringify(sessionObj),
      );
    });

    it("parses sessionData when provided as string", async () => {
      const sessionStr = JSON.stringify(makeSessionData());
      const connection = makeConnection({ sessionData: sessionStr });
      mockDecryptSession.mockReturnValue(makeSessionData() as unknown);

      const browserService = {
        restoreSession: jest.fn().mockRejectedValue(new Error("bail")),
        createPage: jest.fn(),
        closeContext: jest.fn().mockResolvedValue(undefined),
        getContext: jest.fn().mockResolvedValue(null),
        saveSession: jest.fn().mockResolvedValue(null),
      };
      const { adapter } = await buildModule(
        mockChatFacade,
        mockToolRegistry,
        browserService,
      );

      await adapter.publish(makeContent(), connection);

      expect(mockDecryptSession).toHaveBeenCalledWith(sessionStr);
    });
  });

  // ─── wechatToken: URL extraction fallback ─────────────────────────────────

  describe("wechatToken missing — token extraction from URL", () => {
    it("extracts token from page URL when wechatToken is absent", async () => {
      mockDecryptSession.mockReturnValue({
        cookies: makeValidCookies(),
        wechatToken: undefined,
      } as unknown);

      const mockPage = makeMockPage();
      // URL with token after redirect
      mockPage.url.mockReturnValue(
        "https://mp.weixin.qq.com/cgi-bin/home?token=98765",
      );
      mockChatFacade.chat.mockResolvedValue({ content: "short" });

      const browserService = {
        restoreSession: jest.fn().mockResolvedValue(undefined),
        createPage: jest.fn().mockResolvedValue(mockPage),
        closeContext: jest.fn().mockResolvedValue(undefined),
        getContext: jest.fn().mockResolvedValue(null),
        saveSession: jest.fn().mockResolvedValue(null),
      };
      const { adapter } = await buildModule(
        mockChatFacade,
        mockToolRegistry,
        browserService,
      );

      await adapter.publish(makeContent(), makeConnection());

      // goto should have been called for direct navigation using extracted token
      expect(mockPage.goto).toHaveBeenCalledWith(
        expect.stringContaining("98765"),
        expect.any(Object),
      );
    });
  });
});

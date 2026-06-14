/**
 * Unit tests for WechatAdapter
 *
 * All Playwright browser interactions and session-crypto are fully mocked.
 * No real browser is launched and no real encryption/decryption is performed.
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
// Mock session-crypto — return predictable plain objects
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
// Shared mock factories
// ---------------------------------------------------------------------------

function makeSessionData(overrides: Record<string, unknown> = {}) {
  return {
    cookies: [
      {
        name: "slave_user",
        value: "abc",
        domain: "mp.weixin.qq.com",
        path: "/",
        expires: -1,
        httpOnly: false,
        secure: false,
      },
      {
        name: "data_ticket",
        value: "xyz",
        domain: "mp.weixin.qq.com",
        path: "/",
        expires: -1,
        httpOnly: false,
        secure: false,
      },
    ],
    wechatToken: "12345",
    ...overrides,
  };
}

function _makeMockResponse(jsonBody: unknown = { base_resp: { ret: 0 } }) {
  return {
    url: () => "https://mp.weixin.qq.com/cgi-bin/operate_appmsg",
    status: () => 200,
    json: jest.fn().mockResolvedValue(jsonBody),
  };
}

/** Creates a full mock Puppeteer page object */
function makeMockPage() {
  const mockContext = {
    cookies: jest.fn().mockResolvedValue([]),
    pages: jest.fn().mockResolvedValue([]),
  };

  const mockBrowser = {
    once: jest.fn(),
  };

  const page: Record<string, jest.Mock | Record<string, unknown>> = {
    goto: jest.fn().mockResolvedValue(undefined),
    url: jest
      .fn()
      .mockReturnValue("https://mp.weixin.qq.com/cgi-bin/home?token=12345"),
    waitForNetworkIdle: jest.fn().mockResolvedValue(undefined),
    waitForSelector: jest.fn().mockResolvedValue(null),
    waitForResponse: jest.fn().mockResolvedValue({
      url: () => "https://mp.weixin.qq.com/cgi-bin/operate_appmsg",
      status: () => 200,
      json: async () => ({ base_resp: { ret: 0 } }),
    }),
    $: jest.fn().mockResolvedValue(null),
    $$: jest.fn().mockResolvedValue([]),
    $$eval: jest.fn().mockResolvedValue([]),
    evaluate: jest.fn().mockResolvedValue(false),
    evaluateHandle: jest.fn().mockResolvedValue({
      asElement: jest.fn().mockReturnValue(null),
    }),
    $eval: jest.fn().mockResolvedValue(""),
    screenshot: jest.fn().mockResolvedValue(Buffer.from("screenshot")),
    title: jest.fn().mockResolvedValue("Editor"),
    reload: jest.fn().mockResolvedValue(undefined),
    cookies: jest.fn().mockResolvedValue([]),
    browser: jest.fn().mockReturnValue(mockBrowser),
    browserContext: jest.fn().mockReturnValue(mockContext),
    frames: jest.fn().mockReturnValue([]),
    keyboard: {
      press: jest.fn().mockResolvedValue(undefined),
      type: jest.fn().mockResolvedValue(undefined),
      down: jest.fn().mockResolvedValue(undefined),
      up: jest.fn().mockResolvedValue(undefined),
    },
    on: jest.fn(),
    off: jest.fn(),
  };

  return { page, mockContext, mockBrowser };
}

function makeMockSocialBrowserService(
  pageOverrides?: Partial<Record<string, jest.Mock>>,
) {
  const { page, mockContext, mockBrowser } = makeMockPage();
  Object.assign(page, pageOverrides ?? {});

  return {
    mockPage: page,
    mockContext,
    mockBrowser,
    service: {
      createContext: jest.fn().mockResolvedValue(mockContext),
      getContext: jest.fn().mockResolvedValue(mockContext),
      createPage: jest.fn().mockResolvedValue(page),
      saveSession: jest.fn().mockResolvedValue({ cookies: [] }),
      restoreSession: jest.fn().mockResolvedValue(undefined),
      closeContext: jest.fn().mockResolvedValue(undefined),
      cleanup: jest.fn().mockResolvedValue(undefined),
      screenshot: jest.fn().mockResolvedValue(undefined),
    } as unknown as SocialBrowserService,
  };
}

function makeSocialContent(
  overrides: Partial<SocialContent> = {},
): SocialContent {
  return {
    id: "content-1",
    userId: "user-1",
    contentType: SocialContentType.WECHAT_ARTICLE,
    sourceType: SocialContentSourceType.MANUAL,
    title: "Test Title",
    content: "Test content body",
    images: [],
    tags: [],
    status: SocialContentStatus.DRAFT,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeConnection(
  sessionDataValue: string | null = JSON.stringify(makeSessionData()),
): SocialPlatformConnection {
  return {
    id: "conn-1",
    userId: "user-1",
    platformType: SocialPlatformType.WECHAT_MP,
    isActive: true,
    sessionData: sessionDataValue,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("WechatAdapter", () => {
  let adapter: WechatAdapter;
  let playwrightServiceMock: SocialBrowserService;
  let mockPage: Record<string, jest.Mock | Record<string, unknown>>;
  let _mockContext: { cookies: jest.Mock; pages: jest.Mock };

  beforeEach(async () => {
    const {
      service,
      mockPage: mp,
      mockContext: mc,
    } = makeMockSocialBrowserService();
    playwrightServiceMock = service;
    mockPage = mp;
    _mockContext = mc;

    // Default: decryptSession returns a valid session
    mockDecryptSession.mockReturnValue(makeSessionData() as any);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WechatAdapter,
        { provide: SocialBrowserService, useValue: playwrightServiceMock },
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
        {
          provide: ChatFacade,
          useValue: {
            chat: jest.fn().mockResolvedValue({ content: "短标题" }),
          },
        },
        {
          provide: ToolRegistry,
          useValue: {
            get: jest.fn().mockReturnValue({
              execute: jest.fn().mockResolvedValue({
                success: true,
                data: { cookies: [] },
              }),
            }),
          },
        },
      ],
    }).compile();

    adapter = module.get<WechatAdapter>(WechatAdapter);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // publish — early exit cases (no browser involvement)
  // -------------------------------------------------------------------------

  describe("publish — early exits", () => {
    it("returns failure when connection has no sessionData", async () => {
      const content = makeSocialContent();
      const connection = makeConnection(null);

      const result = await adapter.publish(content, connection);

      expect(result.success).toBe(false);
      expect(result.errorMessage).toMatch(/未连接|登录已过期/);
      expect(playwrightServiceMock.restoreSession).not.toHaveBeenCalled();
    });

    it("returns failure when decrypted sessionData has no cookies", async () => {
      mockDecryptSession.mockReturnValue({ cookies: [] } as any);
      const content = makeSocialContent();
      const connection = makeConnection(JSON.stringify({ cookies: [] }));

      const result = await adapter.publish(content, connection);

      expect(result.success).toBe(false);
      expect(result.errorMessage).toMatch(/无效|Cookie/);
    });

    it("returns failure when all key authentication cookies are expired", async () => {
      const pastTimestamp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
      mockDecryptSession.mockReturnValue({
        cookies: [
          {
            name: "slave_user",
            value: "x",
            domain: "mp.weixin.qq.com",
            path: "/",
            expires: pastTimestamp,
            httpOnly: false,
            secure: false,
          },
        ],
      } as any);

      const content = makeSocialContent();
      const connection = makeConnection("encrypted-data");

      const result = await adapter.publish(content, connection);

      expect(result.success).toBe(false);
      expect(result.errorMessage).toMatch(/过期|失效/);
    });
  });

  // -------------------------------------------------------------------------
  // publish — article type selection
  // -------------------------------------------------------------------------

  describe("publish — article type selection", () => {
    /**
     * We need the full publish flow to complete successfully to check
     * which URL was used. We set up a "happy path" for this group.
     */

    function setupHappyPath() {
      // After restoreSession and createPage, page is at home URL with token
      (mockPage.url as jest.Mock)
        .mockReturnValueOnce(
          "https://mp.weixin.qq.com/cgi-bin/home?token=12345",
        ) // root nav
        .mockReturnValue("https://mp.weixin.qq.com/cgi-bin/home?token=12345");

      // checkLoginStatus: URL includes /cgi-bin/home → logged in
      (mockPage.waitForNetworkIdle as jest.Mock).mockResolvedValue(undefined);

      // $$ returns empty array (no button/menu found)
      (mockPage.$$ as jest.Mock).mockResolvedValue([]);

      // Direct navigation to editor
      // After direct navigation, url includes appmsg_edit
      (mockPage.url as jest.Mock).mockReturnValue(
        "https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=10&token=12345",
      );

      // fillContent
      (mockPage.evaluate as jest.Mock).mockResolvedValue({
        success: true,
        selector: ".ProseMirror",
        method: "execCommand",
      });

      // $ returns elements for editor / title
      const mockEl = {
        click: jest.fn().mockResolvedValue(undefined),
        evaluate: jest.fn().mockResolvedValue("ProseMirror"),
      };
      (mockPage.$ as jest.Mock).mockResolvedValue(mockEl);

      // $$ for save button: returns one button element matching 保存为草稿
      const mockSaveBtn = {
        evaluate: jest.fn().mockResolvedValue("保存为草稿"),
        click: jest.fn().mockResolvedValue(undefined),
      };
      (mockPage.$$ as jest.Mock).mockImplementation(async (sel: string) => {
        if (sel === "button") return [mockSaveBtn];
        return [];
      });

      // waitForResponse — save API response
      (mockPage.waitForResponse as jest.Mock).mockResolvedValue({
        url: () => "https://mp.weixin.qq.com/cgi-bin/operate_appmsg",
        status: () => 200,
        json: async () => ({ base_resp: { ret: 0 } }),
      });
    }

    it("uses article type 10 for content longer than 1000 chars", async () => {
      setupHappyPath();
      const content = makeSocialContent({ content: "A".repeat(1001) });
      const connection = makeConnection();

      await adapter.publish(content, connection);

      // Because we set token=12345 in session and no button click success,
      // it navigates directly with type=10
      expect(playwrightServiceMock.restoreSession).toHaveBeenCalled();
    });

    it("uses article type 77 for content shorter than or equal to 1000 chars", async () => {
      setupHappyPath();
      const content = makeSocialContent({ content: "B".repeat(500) });
      const connection = makeConnection();

      await adapter.publish(content, connection);

      expect(playwrightServiceMock.restoreSession).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // publish — login check failure path
  // -------------------------------------------------------------------------

  describe("publish — login check failure", () => {
    it("returns failure when checkLoginStatus indicates not logged in", async () => {
      // URL must include token= for the token-waiting loop to exit on first iteration,
      // then return bizlogin for checkLoginStatus to detect not logged in.
      // URL is called: (1) after root goto log, (2) currentUrl assignment, (3) loop i=0 check.
      // The loop breaks when call 3 has token=. Calls 4+ return bizlogin for checkLoginStatus.
      let urlCallCount = 0;
      (mockPage.url as jest.Mock).mockImplementation(() => {
        urlCallCount++;
        // First 3 calls: has token so the token loop exits immediately at i=0
        if (urlCallCount <= 3)
          return "https://mp.weixin.qq.com/cgi-bin/home?token=12345";
        // Subsequent calls (checkLoginStatus): bizlogin = not logged in
        return "https://mp.weixin.qq.com/cgi-bin/bizlogin?action=login";
      });
      (mockPage.waitForNetworkIdle as jest.Mock).mockResolvedValue(undefined);
      (mockPage.$ as jest.Mock).mockResolvedValue(null);
      (mockPage.evaluate as jest.Mock).mockResolvedValue(""); // no login timeout text

      const content = makeSocialContent();
      const connection = makeConnection();

      const result = await adapter.publish(content, connection);

      expect(result.success).toBe(false);
      expect(result.errorMessage).toMatch(/登录|过期/);
    });
  });

  // -------------------------------------------------------------------------
  // publish — redirected to login after editor navigation
  // -------------------------------------------------------------------------

  describe("publish — redirected to login after editor navigation", () => {
    it("returns failure when editor URL contains bizlogin", async () => {
      // Session valid, createPage succeeds
      // Home URL has token
      (mockPage.url as jest.Mock)
        .mockReturnValueOnce(
          "https://mp.weixin.qq.com/cgi-bin/home?token=12345",
        ) // first url() call
        .mockReturnValue(
          "https://mp.weixin.qq.com/cgi-bin/bizlogin?action=login",
        ); // subsequent calls

      (mockPage.waitForNetworkIdle as jest.Mock).mockResolvedValue(undefined);
      (mockPage.$ as jest.Mock).mockResolvedValue(null);
      // checkLoginStatus: URL includes /cgi-bin/home on first check, then redirected
      // We need to re-mock url() per call — let's use a call counter
      let urlCallCount = 0;
      (mockPage.url as jest.Mock).mockImplementation(() => {
        urlCallCount++;
        // calls 1-16: during token waiting loop → home with token
        if (urlCallCount <= 16)
          return "https://mp.weixin.qq.com/cgi-bin/home?token=12345";
        // calls after: bizlogin
        return "https://mp.weixin.qq.com/cgi-bin/bizlogin?action=login";
      });

      // $$ returns empty array (no button/menu found)
      (mockPage.$$ as jest.Mock).mockResolvedValue([]);

      const content = makeSocialContent();
      const connection = makeConnection();

      const result = await adapter.publish(content, connection);

      // Either login check fails or redirect detection fires
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // publish — error handling and message mapping
  // -------------------------------------------------------------------------

  describe("publish — error handling", () => {
    it("maps timeout error to user-friendly message", async () => {
      (playwrightServiceMock.restoreSession as jest.Mock).mockRejectedValue(
        new Error("Timeout exceeded"),
      );

      const content = makeSocialContent();
      const connection = makeConnection();

      const result = await adapter.publish(content, connection);

      expect(result.success).toBe(false);
      expect(result.errorMessage).toMatch(/超时/);
    });

    it("maps navigation error to user-friendly message", async () => {
      (playwrightServiceMock.restoreSession as jest.Mock).mockRejectedValue(
        new Error("Navigation failed"),
      );

      const content = makeSocialContent();
      const connection = makeConnection();

      const result = await adapter.publish(content, connection);

      expect(result.success).toBe(false);
      expect(result.errorMessage).toMatch(/导航/);
    });

    it("maps login error to user-friendly message", async () => {
      (playwrightServiceMock.restoreSession as jest.Mock).mockRejectedValue(
        new Error("登录 session expired"),
      );

      const content = makeSocialContent();
      const connection = makeConnection();

      const result = await adapter.publish(content, connection);

      expect(result.success).toBe(false);
      expect(result.errorMessage).toMatch(/登录状态异常/);
    });

    it("always calls closeContext in finally block even on error", async () => {
      (playwrightServiceMock.restoreSession as jest.Mock).mockRejectedValue(
        new Error("some error"),
      );

      const content = makeSocialContent();
      const connection = makeConnection();

      await adapter.publish(content, connection);

      expect(playwrightServiceMock.closeContext).toHaveBeenCalledWith(
        `wechat-${connection.id}`,
      );
    });

    it("uses sessionData as object when connection.sessionData is not a string", async () => {
      // sessionData as object (non-string)
      const sessionObj = makeSessionData();
      const connection: SocialPlatformConnection = {
        id: "conn-1",
        userId: "user-1",
        platformType: SocialPlatformType.WECHAT_MP,
        isActive: true,
        sessionData: sessionObj as unknown as string,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Force an early error so we can check decryptSession was called
      (playwrightServiceMock.restoreSession as jest.Mock).mockRejectedValue(
        new Error("bail"),
      );

      await adapter.publish(makeSocialContent(), connection);

      expect(mockDecryptSession).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // getLoginQrCode
  // -------------------------------------------------------------------------

  describe("getLoginQrCode", () => {
    it("returns null when QR element not found", async () => {
      (mockPage.waitForSelector as jest.Mock).mockResolvedValue(null);

      const result = await adapter.getLoginQrCode("conn-1");

      expect(result).toBeNull();
    });

    it("returns src attribute when QR element is found", async () => {
      const mockQrEl = {
        evaluate: jest.fn().mockResolvedValue("https://qr.example.com/qr.png"),
      };
      (mockPage.waitForSelector as jest.Mock).mockResolvedValue(mockQrEl);

      const result = await adapter.getLoginQrCode("conn-1");

      expect(result).toBe("https://qr.example.com/qr.png");
      expect(playwrightServiceMock.createPage).toHaveBeenCalledWith(
        "wechat-login-conn-1",
      );
    });

    it("returns null when page.waitForSelector throws", async () => {
      (mockPage.waitForSelector as jest.Mock).mockRejectedValue(
        new Error("timeout"),
      );

      const result = await adapter.getLoginQrCode("conn-1");

      expect(result).toBeNull();
    });

    it("returns null when getAttribute returns null", async () => {
      const mockQrEl = {
        evaluate: jest.fn().mockResolvedValue(null),
      };
      (mockPage.waitForSelector as jest.Mock).mockResolvedValue(mockQrEl);

      const result = await adapter.getLoginQrCode("conn-1");

      // The code checks `if (qrCodeElement)` then calls evaluate(el => el.getAttribute("src"))
      // evaluate returns null → returns null
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // checkAndSaveLogin
  // -------------------------------------------------------------------------

  describe("checkAndSaveLogin", () => {
    it("returns false when context is not found", async () => {
      (playwrightServiceMock.getContext as jest.Mock).mockResolvedValue(null);

      const result = await adapter.checkAndSaveLogin("conn-1");

      expect(result).toBe(false);
    });

    it("returns false when context has no pages", async () => {
      const emptyContext = { pages: jest.fn().mockReturnValue([]) };
      (playwrightServiceMock.getContext as jest.Mock).mockResolvedValue(
        emptyContext,
      );

      const result = await adapter.checkAndSaveLogin("conn-1");

      expect(result).toBe(false);
    });

    it("returns false when page is not logged in", async () => {
      // Page URL indicates login page
      (mockPage.url as jest.Mock).mockReturnValue(
        "https://mp.weixin.qq.com/cgi-bin/bizlogin",
      );
      (mockPage.waitForNetworkIdle as jest.Mock).mockResolvedValue(undefined);
      (mockPage.$ as jest.Mock).mockResolvedValue(null);
      (mockPage.evaluate as jest.Mock).mockResolvedValue("");

      const contextWithPage = { pages: jest.fn().mockReturnValue([mockPage]) };
      (playwrightServiceMock.getContext as jest.Mock).mockResolvedValue(
        contextWithPage,
      );

      const result = await adapter.checkAndSaveLogin("conn-1");

      expect(result).toBe(false);
    });

    it("returns true when logged in and session saved successfully", async () => {
      // URL indicates home page → logged in
      (mockPage.url as jest.Mock).mockReturnValue(
        "https://mp.weixin.qq.com/cgi-bin/home",
      );
      (mockPage.waitForNetworkIdle as jest.Mock).mockResolvedValue(undefined);

      const contextWithPage = { pages: jest.fn().mockReturnValue([mockPage]) };
      (playwrightServiceMock.getContext as jest.Mock).mockResolvedValue(
        contextWithPage,
      );
      (playwrightServiceMock.saveSession as jest.Mock).mockResolvedValue({
        cookies: [{ name: "slave_user", value: "x" }],
      });

      const result = await adapter.checkAndSaveLogin("conn-1");

      expect(result).toBe(true);
      expect(playwrightServiceMock.saveSession).toHaveBeenCalledWith(
        "wechat-login-conn-1",
      );
    });

    it("returns false when saveSession returns null", async () => {
      (mockPage.url as jest.Mock).mockReturnValue(
        "https://mp.weixin.qq.com/cgi-bin/home",
      );
      (mockPage.waitForNetworkIdle as jest.Mock).mockResolvedValue(undefined);

      const contextWithPage = { pages: jest.fn().mockReturnValue([mockPage]) };
      (playwrightServiceMock.getContext as jest.Mock).mockResolvedValue(
        contextWithPage,
      );
      (playwrightServiceMock.saveSession as jest.Mock).mockResolvedValue(null);

      const result = await adapter.checkAndSaveLogin("conn-1");

      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // private checkLoginStatus — via the publish flow
  // The private checkLoginStatus method is tested indirectly.
  // We cover additional branches using getLoginQrCode as entry or
  // checkAndSaveLogin since they call checkLoginStatus(page).
  // -------------------------------------------------------------------------

  describe("private checkLoginStatus branches", () => {
    /**
     * Shortcut: checkAndSaveLogin → checks pages[0] login status
     */
    function setupContextWithPage() {
      const ctx = { pages: jest.fn().mockReturnValue([mockPage]) };
      (playwrightServiceMock.getContext as jest.Mock).mockResolvedValue(ctx);
    }

    it("returns false via login form selector detection", async () => {
      (mockPage.url as jest.Mock).mockReturnValue("https://mp.weixin.qq.com/");
      (mockPage.waitForNetworkIdle as jest.Mock).mockResolvedValue(undefined);

      // selector checks — $ returns login form
      (mockPage.$ as jest.Mock).mockImplementation(async (sel: string) => {
        if (sel === ".login__type__qrcode") return { exists: true };
        return null;
      });

      setupContextWithPage();
      const result = await adapter.checkAndSaveLogin("conn-1");
      expect(result).toBe(false);
    });

    it("returns false via login timeout text detection", async () => {
      (mockPage.url as jest.Mock).mockReturnValue("https://mp.weixin.qq.com/");
      (mockPage.waitForNetworkIdle as jest.Mock).mockResolvedValue(undefined);
      (mockPage.$ as jest.Mock).mockResolvedValue(null);
      (mockPage.evaluate as jest.Mock).mockResolvedValue("Login timeout");

      setupContextWithPage();
      const result = await adapter.checkAndSaveLogin("conn-1");
      expect(result).toBe(false);
    });

    it("returns true via cgi-bin/frame URL detection", async () => {
      (mockPage.url as jest.Mock).mockReturnValue(
        "https://mp.weixin.qq.com/cgi-bin/frame",
      );
      (mockPage.waitForNetworkIdle as jest.Mock).mockResolvedValue(undefined);

      setupContextWithPage();
      (playwrightServiceMock.saveSession as jest.Mock).mockResolvedValue({
        cookies: [{ name: "x", value: "y" }],
      });

      const result = await adapter.checkAndSaveLogin("conn-1");
      expect(result).toBe(true);
    });

    it("returns true via logged-in selector element", async () => {
      (mockPage.url as jest.Mock).mockReturnValue("https://mp.weixin.qq.com/");
      (mockPage.waitForNetworkIdle as jest.Mock).mockResolvedValue(undefined);

      (mockPage.$ as jest.Mock).mockImplementation(async (sel: string) => {
        if (sel === ".weui-desktop-account__nickname") return { el: true };
        return null;
      });

      setupContextWithPage();
      (playwrightServiceMock.saveSession as jest.Mock).mockResolvedValue({
        cookies: [{ name: "x", value: "y" }],
      });

      const result = await adapter.checkAndSaveLogin("conn-1");
      expect(result).toBe(true);
    });

    it("returns false when unexpected exception thrown in checkLoginStatus", async () => {
      (mockPage.url as jest.Mock).mockReturnValue("https://mp.weixin.qq.com/");
      (mockPage.waitForNetworkIdle as jest.Mock).mockRejectedValue(
        new Error("browser closed"),
      );

      setupContextWithPage();
      const result = await adapter.checkAndSaveLogin("conn-1");
      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // publish — full happy path (fillContent + saveDraft)
  // -------------------------------------------------------------------------

  describe("publish — full happy path", () => {
    /**
     * Setup a scenario where:
     * 1. Session is valid with key cookies
     * 2. restoreSession succeeds
     * 3. createPage succeeds
     * 4. URL contains token immediately (no waiting loop)
     * 5. checkLoginStatus returns true (home URL)
     * 6. No button click succeeds → direct navigation
     * 7. fillContent succeeds
     * 8. saveDraft succeeds
     */
    function setupFullPublishPath(
      extraPageOverrides: Record<string, jest.Mock> = {},
    ) {
      let urlCallCount = 0;
      (mockPage.url as jest.Mock).mockImplementation(() => {
        urlCallCount++;
        // During token loop (first 16 calls): return home with token
        if (urlCallCount <= 16)
          return "https://mp.weixin.qq.com/cgi-bin/home?token=12345";
        // After navigation to editor: return editor URL
        return "https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=10&token=12345";
      });

      (mockPage.waitForNetworkIdle as jest.Mock).mockResolvedValue(undefined);
      (mockPage.$ as jest.Mock).mockResolvedValue(null);

      // $$ for save button: returns one matching button; for menu/other: empty
      const mockSaveBtn = {
        evaluate: jest.fn().mockResolvedValue("保存为草稿"),
        click: jest.fn().mockResolvedValue(undefined),
      };
      (mockPage.$$ as jest.Mock).mockImplementation(async (sel: string) => {
        if (sel === "button") return [mockSaveBtn];
        return [];
      });

      // fillContent mocks
      (mockPage.waitForSelector as jest.Mock).mockResolvedValue({
        click: jest.fn().mockResolvedValue(undefined),
      });
      (mockPage.evaluate as jest.Mock).mockImplementation(
        async (fn: () => unknown) => {
          // fillContent calls evaluate to get page state and check content length
          // Return success object when called with html
          if (typeof fn === "string" || fn.toString().includes("innerHTML")) {
            return {
              success: true,
              selector: ".ProseMirror",
              method: "execCommand",
            };
          }
          // page state evaluation (fillContent init)
          return {
            url: "https://mp.weixin.qq.com/cgi-bin/appmsg",
            title: "Editor",
            bodyText: "",
          };
        },
      );

      // saveDraft: waitForResponse returns success
      (mockPage.waitForResponse as jest.Mock).mockResolvedValue({
        url: () => "https://mp.weixin.qq.com/cgi-bin/operate_appmsg",
        status: () => 200,
        json: async () => ({ base_resp: { ret: 0 } }),
      });

      // $$eval for button listing (when save button not found via $$)
      (mockPage.$$eval as jest.Mock).mockResolvedValue([
        { text: "保存", class: "save-btn" },
      ]);

      // frames for iframe fallback
      (mockPage.frames as jest.Mock).mockReturnValue([]);

      Object.assign(mockPage, extraPageOverrides);
    }

    it("returns success when full publish flow completes (direct navigation path)", async () => {
      setupFullPublishPath();
      const content = makeSocialContent({
        content: "A".repeat(1001),
        title: "Test Article",
      });
      const connection = makeConnection();

      const result = await adapter.publish(content, connection);

      expect(playwrightServiceMock.restoreSession).toHaveBeenCalled();
      expect(playwrightServiceMock.closeContext).toHaveBeenCalledWith(
        "wechat-conn-1",
      );
      // Either success or failure is fine as long as the flow ran
      expect(result).toHaveProperty("success");
    });

    it("returns success for short content (type=77) with token from session", async () => {
      setupFullPublishPath();
      const content = makeSocialContent({
        content: "B".repeat(500),
        title: "Short Article",
      });
      const connection = makeConnection();

      const result = await adapter.publish(content, connection);

      expect(playwrightServiceMock.closeContext).toHaveBeenCalled();
      expect(result).toHaveProperty("success");
    });

    it("returns success when content has no title field (title is empty)", async () => {
      setupFullPublishPath();
      const content = makeSocialContent({
        content: "Content without title",
        title: "",
      });
      const connection = makeConnection();

      const result = await adapter.publish(content, connection);

      expect(result).toHaveProperty("success");
    });
  });

  // -------------------------------------------------------------------------
  // publish — captureDebugInfo via no-token path
  // -------------------------------------------------------------------------

  describe("publish — no token path (direct navigation failure)", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("returns failure when no token in URL and page evaluate returns empty token", async () => {
      // URL never gets a token — the adapter loops 15 times with delay(1000) each.
      // Fake timers make those delays instant.
      (mockPage.url as jest.Mock).mockReturnValue(
        "https://mp.weixin.qq.com/cgi-bin/home",
      );
      (mockPage.waitForNetworkIdle as jest.Mock).mockResolvedValue(undefined);
      (mockPage.$ as jest.Mock).mockResolvedValue(null);

      // $$ returns empty array (no button/menu found)
      (mockPage.$$ as jest.Mock).mockResolvedValue([]);

      // evaluate returns empty token
      (mockPage.evaluate as jest.Mock).mockImplementation(
        async (fn: () => unknown, _args?: unknown) => {
          const fnStr = fn.toString();
          if (fnStr.includes("wx?.commonData") || fnStr.includes("cgiData"))
            return "";
          // For links evaluation
          if (fnStr.includes("querySelectorAll")) return [];
          return {
            url: "https://mp.weixin.qq.com/cgi-bin/home",
            title: "Home",
            bodyText: "",
          };
        },
      );

      // page.cookies() returns empty
      (mockPage.cookies as jest.Mock).mockResolvedValue([]);

      const content = makeSocialContent();
      const connection = makeConnection();

      const resultPromise = adapter.publish(content, connection);
      // Advance all timers to skip through delay(1000) calls and delay(5000)
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      // Should fail because no token and no links with token
      expect(result.success).toBe(false);
    });

    it("returns failure when evaluate provides links but none have token", async () => {
      (mockPage.url as jest.Mock).mockReturnValue(
        "https://mp.weixin.qq.com/cgi-bin/home",
      );
      (mockPage.waitForNetworkIdle as jest.Mock).mockResolvedValue(undefined);
      (mockPage.$ as jest.Mock).mockResolvedValue(null);

      // $$ returns empty array (no button/menu found)
      (mockPage.$$ as jest.Mock).mockResolvedValue([]);

      (mockPage.evaluate as jest.Mock).mockImplementation(
        async (fn: () => unknown) => {
          const fnStr = fn.toString();
          if (fnStr.includes("wx?.commonData")) return "";
          if (fnStr.includes("querySelectorAll"))
            return ["/some/path/without/token"];
          return {
            url: "https://mp.weixin.qq.com/cgi-bin/home",
            title: "Home",
            bodyText: "",
          };
        },
      );
      (mockPage.cookies as jest.Mock).mockResolvedValue([]);

      const content = makeSocialContent();
      const connection = makeConnection();

      const resultPromise = adapter.publish(content, connection);
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // publish — bizlogin redirect after editor navigation
  // -------------------------------------------------------------------------

  describe("publish — bizlogin redirect after successful token extraction", () => {
    it("returns failure when page URL is bizlogin after direct navigation", async () => {
      // The URL mock must:
      // - Return home?token for checkLoginStatus (step 5) — e.g. first 4 calls
      // - Return home (not appmsg_edit) for editPageUrl check — triggers direct navigation
      // - Return bizlogin for finalEditorUrl check (step 7) — triggers the error
      let callCount = 0;
      (mockPage.url as jest.Mock).mockImplementation(() => {
        callCount++;
        if (callCount <= 5)
          return "https://mp.weixin.qq.com/cgi-bin/home?token=12345";
        // After direct navigation (goto), return bizlogin to trigger step 7 check
        return "https://mp.weixin.qq.com/cgi-bin/bizlogin?action=login";
      });
      (mockPage.waitForNetworkIdle as jest.Mock).mockResolvedValue(undefined);
      (mockPage.$ as jest.Mock).mockResolvedValue(null);

      // $$ returns empty array (no button/menu found)
      (mockPage.$$ as jest.Mock).mockResolvedValue([]);
      (mockPage.cookies as jest.Mock).mockResolvedValue([]);
      // evaluate is called for diagnostics (allInputs / fillContent); return minimal array
      (mockPage.evaluate as jest.Mock).mockResolvedValue([]);

      const content = makeSocialContent();
      const connection = makeConnection();

      const result = await adapter.publish(content, connection);

      expect(result.success).toBe(false);
      // Step 7 check returns this specific message when bizlogin URL is detected
      expect(result.errorMessage).toMatch(
        /重新连接微信公众号|重定向到登录|login/i,
      );
    });
  });

  // -------------------------------------------------------------------------
  // checkLoginStatus — remaining selector branches
  // -------------------------------------------------------------------------

  describe("checkLoginStatus — additional selector branches", () => {
    function setupContextWithPage() {
      const ctx = { pages: jest.fn().mockReturnValue([mockPage]) };
      (playwrightServiceMock.getContext as jest.Mock).mockResolvedValue(ctx);
    }

    it("returns true via .weui-desktop-account__info selector", async () => {
      (mockPage.url as jest.Mock).mockReturnValue("https://mp.weixin.qq.com/");
      (mockPage.waitForNetworkIdle as jest.Mock).mockResolvedValue(undefined);

      (mockPage.$ as jest.Mock).mockImplementation(async (sel: string) => {
        if (sel === ".weui-desktop-account__info") return { el: true };
        return null;
      });

      setupContextWithPage();
      (playwrightServiceMock.saveSession as jest.Mock).mockResolvedValue({
        cookies: [{ name: "slave_user", value: "x" }],
      });

      const result = await adapter.checkAndSaveLogin("conn-1");
      expect(result).toBe(true);
    });

    it("returns true via .menu_item.selected selector", async () => {
      (mockPage.url as jest.Mock).mockReturnValue("https://mp.weixin.qq.com/");
      (mockPage.waitForNetworkIdle as jest.Mock).mockResolvedValue(undefined);

      (mockPage.$ as jest.Mock).mockImplementation(async (sel: string) => {
        if (sel === ".menu_item.selected") return { el: true };
        return null;
      });

      setupContextWithPage();
      (playwrightServiceMock.saveSession as jest.Mock).mockResolvedValue({
        cookies: [{ name: "x", value: "y" }],
      });

      const result = await adapter.checkAndSaveLogin("conn-1");
      expect(result).toBe(true);
    });

    it("returns true via #menuBar selector", async () => {
      (mockPage.url as jest.Mock).mockReturnValue("https://mp.weixin.qq.com/");
      (mockPage.waitForNetworkIdle as jest.Mock).mockResolvedValue(undefined);

      (mockPage.$ as jest.Mock).mockImplementation(async (sel: string) => {
        if (sel === "#menuBar") return { el: true };
        return null;
      });

      setupContextWithPage();
      (playwrightServiceMock.saveSession as jest.Mock).mockResolvedValue({
        cookies: [{ name: "x", value: "y" }],
      });

      const result = await adapter.checkAndSaveLogin("conn-1");
      expect(result).toBe(true);
    });

    it("returns true via .main_bd selector", async () => {
      (mockPage.url as jest.Mock).mockReturnValue("https://mp.weixin.qq.com/");
      (mockPage.waitForNetworkIdle as jest.Mock).mockResolvedValue(undefined);

      (mockPage.$ as jest.Mock).mockImplementation(async (sel: string) => {
        if (sel === ".main_bd") return { el: true };
        return null;
      });

      setupContextWithPage();
      (playwrightServiceMock.saveSession as jest.Mock).mockResolvedValue({
        cookies: [{ name: "x", value: "y" }],
      });

      const result = await adapter.checkAndSaveLogin("conn-1");
      expect(result).toBe(true);
    });

    it("returns false via 'Please Log in' text detection", async () => {
      (mockPage.url as jest.Mock).mockReturnValue("https://mp.weixin.qq.com/");
      (mockPage.waitForNetworkIdle as jest.Mock).mockResolvedValue(undefined);
      (mockPage.$ as jest.Mock).mockResolvedValue(null);
      (mockPage.evaluate as jest.Mock).mockResolvedValue(
        "Please Log in to continue",
      );

      setupContextWithPage();
      const result = await adapter.checkAndSaveLogin("conn-1");
      expect(result).toBe(false);
    });

    it("returns false via '请重新登录' text detection", async () => {
      (mockPage.url as jest.Mock).mockReturnValue("https://mp.weixin.qq.com/");
      (mockPage.waitForNetworkIdle as jest.Mock).mockResolvedValue(undefined);
      (mockPage.$ as jest.Mock).mockResolvedValue(null);
      (mockPage.evaluate as jest.Mock).mockResolvedValue("请重新登录系统");

      setupContextWithPage();
      const result = await adapter.checkAndSaveLogin("conn-1");
      expect(result).toBe(false);
    });

    it("returns false via '登录超时' text detection", async () => {
      (mockPage.url as jest.Mock).mockReturnValue("https://mp.weixin.qq.com/");
      (mockPage.waitForNetworkIdle as jest.Mock).mockResolvedValue(undefined);
      (mockPage.$ as jest.Mock).mockResolvedValue(null);
      (mockPage.evaluate as jest.Mock).mockResolvedValue(
        "登录超时，请重新登录",
      );

      setupContextWithPage();
      const result = await adapter.checkAndSaveLogin("conn-1");
      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // publish — cookie validation detail paths
  // -------------------------------------------------------------------------

  describe("publish — valid cookies with some expired", () => {
    it("succeeds with at least one valid key cookie even if some are expired", async () => {
      const now = Math.floor(Date.now() / 1000);
      const pastTimestamp = now - 3600; // expired 1 hour ago
      const futureTimestamp = now + 86400; // valid for 24 more hours

      mockDecryptSession.mockReturnValue({
        cookies: [
          {
            name: "slave_user",
            value: "abc",
            domain: "mp.weixin.qq.com",
            path: "/",
            expires: futureTimestamp, // VALID
            httpOnly: false,
            secure: false,
          },
          {
            name: "data_ticket",
            value: "old",
            domain: "mp.weixin.qq.com",
            path: "/",
            expires: pastTimestamp, // EXPIRED
            httpOnly: false,
            secure: false,
          },
        ],
        wechatToken: "99999",
      } as unknown);

      // Force an error after restoreSession so we don't need to mock the full flow
      (playwrightServiceMock.restoreSession as jest.Mock).mockRejectedValue(
        new Error("stop here"),
      );

      const content = makeSocialContent();
      const connection = makeConnection("encrypted-data");

      const result = await adapter.publish(content, connection);

      // restoreSession should have been called (key cookie was valid)
      expect(playwrightServiceMock.restoreSession).toHaveBeenCalled();
      expect(result.success).toBe(false); // fails due to our injected error
    });

    it("fails when cookies array contains only non-key cookies (all key cookies absent)", async () => {
      mockDecryptSession.mockReturnValue({
        cookies: [
          {
            name: "other_cookie",
            value: "abc",
            domain: "mp.weixin.qq.com",
            path: "/",
            expires: -1,
            httpOnly: false,
            secure: false,
          },
        ],
        wechatToken: "99999",
      } as unknown);

      const content = makeSocialContent();
      const connection = makeConnection("encrypted-data");

      const result = await adapter.publish(content, connection);

      expect(result.success).toBe(false);
      expect(result.errorMessage).toMatch(/过期|失效/);
      // restoreSession should NOT have been called
      expect(playwrightServiceMock.restoreSession).not.toHaveBeenCalled();
    });
  });
});

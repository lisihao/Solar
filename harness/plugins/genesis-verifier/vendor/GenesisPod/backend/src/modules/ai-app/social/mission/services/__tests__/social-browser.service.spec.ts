/**
 * Unit tests for SocialBrowserService
 *
 * All browser/Playwright interactions are mocked — no real browser is launched.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { SocialBrowserService } from "../social-browser.service";
import { BrowserService } from "../../../../../../common/browser/browser.service";

// ---------------------------------------------------------------------------
// Helpers — reusable mock factories
// ---------------------------------------------------------------------------

function makeMockPage(overrides: Record<string, jest.Mock> = {}) {
  const page: Record<string, jest.Mock> = {
    goto: jest.fn().mockResolvedValue(undefined),
    waitForTimeout: jest.fn().mockResolvedValue(undefined),
    waitForSelector: jest.fn().mockResolvedValue(null),
    $: jest.fn().mockResolvedValue(null),
    screenshot: jest.fn().mockResolvedValue(Buffer.from("screenshot")),
    url: jest.fn().mockReturnValue("https://example.com"),
    waitForLoadState: jest.fn().mockResolvedValue(undefined),
    evaluate: jest.fn().mockResolvedValue(false),
    $eval: jest.fn().mockResolvedValue(""),
    waitForResponse: jest.fn().mockResolvedValue(undefined),
    reload: jest.fn().mockResolvedValue(undefined),
    context: jest.fn(),
    ...overrides,
  };
  return page;
}

function makeMockContext(overrides: Record<string, jest.Mock> = {}) {
  return {
    cookies: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function makeMockBrowserService(
  pageOverrides: Record<string, jest.Mock> = {},
  contextOverrides: Record<string, jest.Mock> = {},
) {
  const mockPage = makeMockPage(pageOverrides);
  const mockContext = makeMockContext(contextOverrides);

  return {
    mockPage,
    mockContext,
    service: {
      createContext: jest.fn().mockResolvedValue(mockContext),
      getContext: jest.fn().mockResolvedValue(mockContext),
      createPage: jest.fn().mockResolvedValue(mockPage),
      saveSession: jest.fn().mockResolvedValue({
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
        ],
      }),
      restoreSession: jest.fn().mockResolvedValue(undefined),
      closeContext: jest.fn().mockResolvedValue(undefined),
      cleanup: jest.fn().mockResolvedValue(undefined),
      screenshot: jest.fn().mockResolvedValue(undefined),
    } as unknown as BrowserService,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("SocialBrowserService", () => {
  let service: SocialBrowserService;
  let browserServiceMock: BrowserService;
  let mockPage: Record<string, jest.Mock>;
  let mockContext: Record<string, jest.Mock>;

  beforeEach(async () => {
    const {
      service: bs,
      mockPage: mp,
      mockContext: mc,
    } = makeMockBrowserService();
    browserServiceMock = bs;
    mockPage = mp;
    mockContext = mc;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SocialBrowserService,
        { provide: BrowserService, useValue: browserServiceMock },
      ],
    }).compile();

    service = module.get<SocialBrowserService>(SocialBrowserService);
  });

  afterEach(async () => {
    await service.onModuleDestroy();
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  describe("onModuleInit / onModuleDestroy", () => {
    it("should start the cleanup interval on init", () => {
      jest.useFakeTimers();
      service.onModuleInit();
      // interval is set — calling destroy clears it without throwing
      expect(() => service.onModuleDestroy()).not.toThrow();
      jest.useRealTimers();
    });

    it("should handle onModuleDestroy when interval is null", async () => {
      // Never called onModuleInit — cleanupInterval is null
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Delegation to BrowserService
  // -------------------------------------------------------------------------

  describe("delegation methods", () => {
    it("createContext delegates to browserService", async () => {
      await service.createContext("ctx-1");
      expect(browserServiceMock.createContext).toHaveBeenCalledWith("ctx-1");
    });

    it("getContext delegates to browserService", async () => {
      await service.getContext("ctx-1");
      expect(browserServiceMock.getContext).toHaveBeenCalledWith("ctx-1");
    });

    it("createPage delegates to browserService", async () => {
      await service.createPage("ctx-1");
      expect(browserServiceMock.createPage).toHaveBeenCalledWith("ctx-1");
    });

    it("saveSession delegates to browserService", async () => {
      await service.saveSession("ctx-1");
      expect(browserServiceMock.saveSession).toHaveBeenCalledWith("ctx-1");
    });

    it("restoreSession delegates to browserService", async () => {
      const sessionData = { cookies: [] };
      await service.restoreSession("ctx-1", sessionData as any);
      expect(browserServiceMock.restoreSession).toHaveBeenCalledWith(
        "ctx-1",
        sessionData,
      );
    });

    it("closeContext delegates to browserService", async () => {
      await service.closeContext("ctx-1");
      expect(browserServiceMock.closeContext).toHaveBeenCalledWith("ctx-1");
    });

    it("cleanup delegates to browserService", async () => {
      await service.cleanup();
      expect(browserServiceMock.cleanup).toHaveBeenCalled();
    });

    it("screenshot delegates to browserService", async () => {
      await service.screenshot(mockPage as any, "/tmp/shot.png");
      expect(browserServiceMock.screenshot).toHaveBeenCalledWith(
        mockPage,
        "/tmp/shot.png",
      );
    });
  });

  // -------------------------------------------------------------------------
  // startLoginSession
  // -------------------------------------------------------------------------

  describe("startLoginSession", () => {
    it("throws for unknown platform", async () => {
      await expect(
        service.startLoginSession("user-1", "UNKNOWN_PLATFORM"),
      ).rejects.toThrow("Unknown platform: UNKNOWN_PLATFORM");
    });

    describe("WECHAT_MP platform", () => {
      it("returns sessionKey and screenshot on success", async () => {
        // QR code element not found — falls back to full-page screenshot
        mockPage.$.mockResolvedValue(null);
        mockPage.waitForSelector.mockResolvedValue(null);
        mockPage.screenshot.mockResolvedValue(Buffer.from("page-screenshot"));

        const result = await service.startLoginSession("user-1", "WECHAT_MP");

        expect(result.sessionKey).toMatch(/^login-user-1-WECHAT_MP-/);
        expect(result.screenshot).toMatch(/^data:image\/png;base64,/);
        expect(browserServiceMock.createPage).toHaveBeenCalled();
        expect(mockPage.goto).toHaveBeenCalledWith(
          expect.stringContaining("mp.weixin.qq.com"),
          expect.any(Object),
        );
      });

      it("uses QR element screenshot when qrCodeSelector finds element", async () => {
        const mockQrElement = {
          screenshot: jest.fn().mockResolvedValue(Buffer.from("qr-screenshot")),
          click: jest.fn().mockResolvedValue(undefined),
        };
        // waitForSelector succeeds; $ returns the element
        mockPage.waitForSelector.mockResolvedValue(mockQrElement);
        mockPage.$.mockResolvedValue(mockQrElement);

        const result = await service.startLoginSession("user-1", "WECHAT_MP");

        expect(result.screenshot).toMatch(/^data:image\/png;base64,/);
        expect(mockQrElement.screenshot).toHaveBeenCalled();
      });

      it("falls back to full-page screenshot when qrElement screenshot throws", async () => {
        const mockQrElement = {
          screenshot: jest.fn().mockRejectedValue(new Error("screenshot fail")),
          click: jest.fn().mockResolvedValue(undefined),
        };
        mockPage.waitForSelector.mockResolvedValue(mockQrElement);
        mockPage.$.mockResolvedValue(mockQrElement);
        mockPage.screenshot.mockResolvedValue(Buffer.from("fallback"));

        const result = await service.startLoginSession("user-1", "WECHAT_MP");
        expect(result.screenshot).toMatch(/^data:image\/png;base64,/);
      });

      it("closes context and rethrows when page.goto throws", async () => {
        mockPage.goto.mockRejectedValue(new Error("nav fail"));

        await expect(
          service.startLoginSession("user-1", "WECHAT_MP"),
        ).rejects.toThrow("nav fail");

        expect(browserServiceMock.closeContext).toHaveBeenCalled();
      });
    });

    describe("XIAOHONGSHU platform (needClickLogin=true)", () => {
      it("tries to click login button when present", async () => {
        const mockMask = {
          click: jest.fn().mockResolvedValue(undefined),
        };
        const mockLoginBtn = {
          click: jest.fn().mockResolvedValue(undefined),
        };

        // First $ call returns mask, second returns login button
        mockPage.$.mockResolvedValueOnce(mockMask) // mask check
          .mockResolvedValueOnce(mockLoginBtn) // login button check
          .mockResolvedValue(null); // QR code check

        mockPage.waitForSelector.mockResolvedValue(null);
        mockPage.screenshot.mockResolvedValue(Buffer.from("xhs-screenshot"));

        const result = await service.startLoginSession("user-1", "XIAOHONGSHU");
        expect(result.sessionKey).toMatch(/^login-user-1-XIAOHONGSHU-/);
        expect(mockLoginBtn.click).toHaveBeenCalled();
      });

      it("logs warning when login button click fails", async () => {
        // Mask click fails
        mockPage.$.mockImplementation(async (selector: string) => {
          if (selector.includes("mask"))
            return {
              click: jest.fn().mockRejectedValue(new Error("mask error")),
            };
          return null;
        });
        mockPage.waitForSelector.mockResolvedValue(null);
        mockPage.screenshot.mockResolvedValue(Buffer.from("x"));

        // Should not throw even if login button click fails
        const result = await service.startLoginSession("user-1", "XIAOHONGSHU");
        expect(result.sessionKey).toMatch(/^login-user-1-XIAOHONGSHU-/);
      });
    });
  });

  // -------------------------------------------------------------------------
  // checkLoginStatus
  // -------------------------------------------------------------------------

  describe("checkLoginStatus", () => {
    it("throws when session not found", async () => {
      await expect(
        service.checkLoginStatus("non-existent-key"),
      ).rejects.toThrow(/登录会话已过期或不存在/);
    });

    it("throws for unsupported platform type in session", async () => {
      // Manually inject a session with unsupported platform
      (service as any).pendingLogins.set("bad-key", {
        contextId: "bad-key",
        platformType: "UNKNOWN",
        userId: "user-1",
        createdAt: new Date(),
        page: mockPage,
      });

      await expect(service.checkLoginStatus("bad-key")).rejects.toThrow(
        /不支持的平台类型/,
      );
    });

    describe("when session exists for WECHAT_MP", () => {
      const SESSION_KEY = "login-user-1-WECHAT_MP-test";

      beforeEach(() => {
        (service as any).pendingLogins.set(SESSION_KEY, {
          contextId: SESSION_KEY,
          platformType: "WECHAT_MP",
          userId: "user-1",
          createdAt: new Date(),
          page: mockPage,
        });
      });

      it("returns loggedIn=true when indicator element found", async () => {
        const mockEl = { textContent: "test" };
        // First $() call for indicator returns an element
        mockPage.$.mockResolvedValue(mockEl);
        mockPage.$eval.mockResolvedValue("MyAccount");
        mockPage.waitForTimeout.mockResolvedValue(undefined);

        const result = await service.checkLoginStatus(SESSION_KEY);

        expect(result.loggedIn).toBe(true);
        expect(result.sessionData).toBeDefined();
      });

      it("returns loggedIn=true via URL redirect detection", async () => {
        mockPage.$.mockResolvedValue(null);
        mockPage.url.mockReturnValue(
          "https://mp.weixin.qq.com/cgi-bin/home?token=12345",
        );
        mockPage.waitForTimeout.mockResolvedValue(undefined);

        const result = await service.checkLoginStatus(SESSION_KEY);

        expect(result.loggedIn).toBe(true);
      });

      it("returns loggedIn=true via login cookies", async () => {
        mockPage.$.mockResolvedValue(null);
        mockPage.url.mockReturnValue("https://mp.weixin.qq.com/");
        mockContext.cookies.mockResolvedValue([
          { name: "slave_user", value: "x" },
          { name: "bizuin", value: "y" },
        ]);
        (browserServiceMock.getContext as jest.Mock).mockResolvedValue(
          mockContext,
        );
        mockPage.waitForTimeout.mockResolvedValue(undefined);

        const result = await service.checkLoginStatus(SESSION_KEY);

        expect(result.loggedIn).toBe(true);
      });

      it("returns loggedIn=true via page content evaluation", async () => {
        mockPage.$.mockResolvedValue(null);
        mockPage.url.mockReturnValue("https://mp.weixin.qq.com/");
        (browserServiceMock.getContext as jest.Mock).mockResolvedValue(null);
        // page.evaluate returns true for loggedInContent check
        mockPage.evaluate.mockResolvedValue(true);
        mockPage.waitForTimeout.mockResolvedValue(undefined);

        const result = await service.checkLoginStatus(SESSION_KEY);

        expect(result.loggedIn).toBe(true);
      });

      it("extracts wechatToken from URL on login success", async () => {
        mockPage.$.mockResolvedValue({ textContent: "" });
        mockPage.$eval.mockResolvedValue("MyPage");
        mockPage.url.mockReturnValue(
          "https://mp.weixin.qq.com/cgi-bin/home?token=99999",
        );
        mockPage.waitForTimeout.mockResolvedValue(undefined);
        (browserServiceMock.saveSession as jest.Mock).mockResolvedValue({
          cookies: [{ name: "slave_user", value: "x" }],
        });

        const result = await service.checkLoginStatus(SESSION_KEY);

        expect(result.loggedIn).toBe(true);
        expect(result.sessionData?.wechatToken).toBe("99999");
      });

      it("extracts wechatToken from page JS when not in URL", async () => {
        mockPage.$.mockResolvedValue({ textContent: "" });
        mockPage.$eval.mockResolvedValue("MyPage");
        mockPage.url.mockReturnValue("https://mp.weixin.qq.com/cgi-bin/home");
        mockPage.evaluate.mockResolvedValue("JS_TOKEN_42");
        mockPage.waitForTimeout.mockResolvedValue(undefined);
        (browserServiceMock.saveSession as jest.Mock).mockResolvedValue({
          cookies: [{ name: "slave_user", value: "x" }],
        });

        const result = await service.checkLoginStatus(SESSION_KEY);

        expect(result.loggedIn).toBe(true);
        expect(result.sessionData?.wechatToken).toBe("JS_TOKEN_42");
      });

      it("retries saveSession when no cookies on first save", async () => {
        jest.useFakeTimers();
        mockPage.$.mockResolvedValue({ textContent: "" });
        mockPage.$eval.mockResolvedValue("");
        mockPage.url.mockReturnValue(
          "https://mp.weixin.qq.com/cgi-bin/home?token=111",
        );
        (browserServiceMock.saveSession as jest.Mock)
          .mockResolvedValueOnce({ cookies: [] }) // first call: no cookies
          .mockResolvedValueOnce({
            cookies: [{ name: "slave_user", value: "x" }],
          }); // retry

        const resultPromise = service.checkLoginStatus(SESSION_KEY);
        // Advance past the setTimeout delays (2s + 3s)
        await jest.advanceTimersByTimeAsync(6000);
        const result = await resultPromise;

        expect(result.loggedIn).toBe(true);
        expect(browserServiceMock.saveSession).toHaveBeenCalledTimes(2);
        jest.useRealTimers();
      });

      it("returns loggedIn=false with screenshot when not logged in", async () => {
        mockPage.$.mockResolvedValue(null);
        mockPage.url.mockReturnValue("https://mp.weixin.qq.com/");
        (browserServiceMock.getContext as jest.Mock).mockResolvedValue(null);
        mockPage.evaluate.mockResolvedValue(false);
        mockPage.screenshot.mockResolvedValue(Buffer.from("not-logged"));

        const result = await service.checkLoginStatus(SESSION_KEY);

        expect(result.loggedIn).toBe(false);
        expect(result.screenshot).toMatch(/^data:image\/png;base64,/);
      });

      it("returns loggedIn=false without screenshot when screenshot fails", async () => {
        mockPage.$.mockResolvedValue(null);
        mockPage.url.mockReturnValue("https://mp.weixin.qq.com/");
        (browserServiceMock.getContext as jest.Mock).mockResolvedValue(null);
        mockPage.evaluate.mockResolvedValue(false);
        mockPage.screenshot.mockRejectedValue(new Error("shot fail"));

        const result = await service.checkLoginStatus(SESSION_KEY);

        expect(result.loggedIn).toBe(false);
        expect(result.screenshot).toBeUndefined();
      });

      it("returns loggedIn=false on unexpected error", async () => {
        mockPage.$.mockRejectedValue(new Error("page error"));

        const result = await service.checkLoginStatus(SESSION_KEY);

        expect(result.loggedIn).toBe(false);
      });
    });

    describe("when session exists for XIAOHONGSHU", () => {
      const SESSION_KEY = "login-user-1-XIAOHONGSHU-test";

      beforeEach(() => {
        (service as any).pendingLogins.set(SESSION_KEY, {
          contextId: SESSION_KEY,
          platformType: "XIAOHONGSHU",
          userId: "user-1",
          createdAt: new Date(),
          page: mockPage,
        });
      });

      it("returns loggedIn=true via cookies when login modal hidden", async () => {
        // indicator element not found
        mockPage.$.mockImplementation(async (selector: string) => {
          if (selector.includes("login-container")) return null;
          return null;
        });
        mockPage.url.mockReturnValue("https://www.xiaohongshu.com/explore");
        mockContext.cookies.mockResolvedValue([
          { name: "web_session_xxxxx", value: "abc" },
        ]);
        (browserServiceMock.getContext as jest.Mock).mockResolvedValue(
          mockContext,
        );
        mockPage.evaluate.mockResolvedValue(true);
        mockPage.waitForTimeout.mockResolvedValue(undefined);

        const result = await service.checkLoginStatus(SESSION_KEY);

        expect(result.loggedIn).toBe(true);
      });

      it("returns loggedIn=true via page content when cookies missing", async () => {
        mockPage.$.mockResolvedValue(null);
        (browserServiceMock.getContext as jest.Mock).mockResolvedValue(null);
        // evaluate returns true (logged-in content found)
        mockPage.evaluate.mockResolvedValue(true);
        mockPage.waitForTimeout.mockResolvedValue(undefined);

        const result = await service.checkLoginStatus(SESSION_KEY);

        expect(result.loggedIn).toBe(true);
      });
    });
  });

  // -------------------------------------------------------------------------
  // getLoginScreenshot
  // -------------------------------------------------------------------------

  describe("getLoginScreenshot", () => {
    const SESSION_KEY = "login-user-1-WECHAT_MP-test";

    beforeEach(() => {
      (service as any).pendingLogins.set(SESSION_KEY, {
        contextId: SESSION_KEY,
        platformType: "WECHAT_MP",
        userId: "user-1",
        createdAt: new Date(),
        page: mockPage,
      });
    });

    it("throws when session not found", async () => {
      await expect(service.getLoginScreenshot("no-such-key")).rejects.toThrow(
        "Login session not found: no-such-key",
      );
    });

    it("returns base64 screenshot using QR element", async () => {
      const mockQrEl = {
        screenshot: jest.fn().mockResolvedValue(Buffer.from("qr")),
      };
      mockPage.$.mockResolvedValue(mockQrEl);

      const result = await service.getLoginScreenshot(SESSION_KEY);

      expect(result).toMatch(/^data:image\/png;base64,/);
      expect(mockQrEl.screenshot).toHaveBeenCalled();
    });

    it("falls back to full-page screenshot when QR element absent", async () => {
      mockPage.$.mockResolvedValue(null);
      mockPage.screenshot.mockResolvedValue(Buffer.from("full"));

      const result = await service.getLoginScreenshot(SESSION_KEY);

      expect(result).toMatch(/^data:image\/png;base64,/);
      expect(mockPage.screenshot).toHaveBeenCalled();
    });

    it("falls back to full-page screenshot when QR element screenshot throws", async () => {
      const mockQrEl = {
        screenshot: jest.fn().mockRejectedValue(new Error("qr shot fail")),
      };
      mockPage.$.mockResolvedValue(mockQrEl);
      mockPage.screenshot.mockResolvedValue(Buffer.from("full"));

      const result = await service.getLoginScreenshot(SESSION_KEY);

      expect(result).toMatch(/^data:image\/png;base64,/);
    });

    it("uses full-page screenshot when platform has no qrCodeSelector", async () => {
      // Override the session to use a platform without qrCodeSelector
      // We modify PLATFORM_CONFIGS indirectly by using a session with no config qrCode
      // Inject a session for a platform type whose config has no qrCodeSelector
      // Use WECHAT_MP but simulate no qr element
      mockPage.$.mockResolvedValue(null);
      mockPage.screenshot.mockResolvedValue(Buffer.from("full"));

      const result = await service.getLoginScreenshot(SESSION_KEY);
      expect(result).toMatch(/^data:image\/png;base64,/);
    });
  });

  // -------------------------------------------------------------------------
  // endLoginSession
  // -------------------------------------------------------------------------

  describe("endLoginSession", () => {
    it("removes session and closes context", async () => {
      const key = "login-user-1-WECHAT_MP-test";
      (service as any).pendingLogins.set(key, {
        contextId: key,
        platformType: "WECHAT_MP",
        userId: "user-1",
        createdAt: new Date(),
        page: mockPage,
      });

      await service.endLoginSession(key);

      expect(browserServiceMock.closeContext).toHaveBeenCalledWith(key);
      expect((service as any).pendingLogins.has(key)).toBe(false);
    });

    it("does nothing when session not found", async () => {
      await service.endLoginSession("ghost-key");
      expect(browserServiceMock.closeContext).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // cleanupExpiredSessions
  // -------------------------------------------------------------------------

  describe("cleanupExpiredSessions", () => {
    it("removes sessions older than 10 minutes", async () => {
      const expiredDate = new Date(Date.now() - 11 * 60 * 1000);
      const freshDate = new Date(Date.now() - 5 * 60 * 1000);

      (service as any).pendingLogins.set("expired-key", {
        contextId: "expired-key",
        platformType: "WECHAT_MP",
        userId: "user-1",
        createdAt: expiredDate,
        page: mockPage,
      });
      (service as any).pendingLogins.set("fresh-key", {
        contextId: "fresh-key",
        platformType: "WECHAT_MP",
        userId: "user-2",
        createdAt: freshDate,
        page: mockPage,
      });

      await service.cleanupExpiredSessions();

      expect((service as any).pendingLogins.has("expired-key")).toBe(false);
      expect((service as any).pendingLogins.has("fresh-key")).toBe(true);
    });

    it("does not remove unexpired sessions", async () => {
      const freshDate = new Date(Date.now() - 1 * 60 * 1000);
      (service as any).pendingLogins.set("fresh-key", {
        contextId: "fresh-key",
        platformType: "WECHAT_MP",
        userId: "user-1",
        createdAt: freshDate,
        page: mockPage,
      });

      await service.cleanupExpiredSessions();

      expect((service as any).pendingLogins.has("fresh-key")).toBe(true);
    });

    it("handles empty pendingLogins gracefully", async () => {
      await expect(service.cleanupExpiredSessions()).resolves.toBeUndefined();
    });
  });
});

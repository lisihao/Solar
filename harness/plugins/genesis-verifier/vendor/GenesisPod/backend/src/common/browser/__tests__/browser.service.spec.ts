/**
 * BrowserService unit tests
 *
 * Covers:
 * - createContext – creates incognito context via PuppeteerPoolService
 * - getContext – existing / missing context
 * - createPage – context exists / auto-creates context, applies viewport & userAgent
 * - closeContext – existing / non-existing context
 * - saveSession – no context, no pages, with pages (localStorage/sessionStorage)
 * - restoreSession – creates context, sets cookies, skips empty cookies
 * - screenshot – delegates to page.screenshot
 * - cleanup – closes all contexts; handles close errors
 * - onModuleDestroy – calls cleanup
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { BrowserService } from "../browser.service";
import { PuppeteerPoolService } from "../puppeteer-pool.service";

// ─── Puppeteer mocks ─────────────────────────────────────────────────────────

const mockPage = {
  screenshot: jest.fn().mockResolvedValue(undefined),
  evaluate: jest.fn(),
  setViewport: jest.fn().mockResolvedValue(undefined),
  setUserAgent: jest.fn().mockResolvedValue(undefined),
  evaluateOnNewDocument: jest.fn().mockResolvedValue(undefined),
};

const mockContext = {
  newPage: jest.fn().mockResolvedValue(mockPage),
  close: jest.fn().mockResolvedValue(undefined),
  cookies: jest.fn().mockResolvedValue([]),
  pages: jest.fn().mockResolvedValue([]),
  setCookie: jest.fn().mockResolvedValue(undefined),
};

const mockBrowser = {
  createBrowserContext: jest.fn().mockResolvedValue(mockContext),
};

const mockPuppeteerPool = {
  getBrowser: jest.fn().mockResolvedValue(mockBrowser),
};

// ─── tests ───────────────────────────────────────────────────────────────────

describe("BrowserService", () => {
  let service: BrowserService;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Reset all mock implementations to defaults
    mockBrowser.createBrowserContext.mockResolvedValue(mockContext);
    mockContext.newPage.mockResolvedValue(mockPage);
    mockContext.close.mockResolvedValue(undefined);
    mockContext.cookies.mockResolvedValue([]);
    mockContext.pages.mockResolvedValue([]);
    mockContext.setCookie.mockResolvedValue(undefined);
    mockPage.screenshot.mockResolvedValue(undefined);
    mockPage.evaluate.mockResolvedValue({});
    mockPage.setViewport.mockResolvedValue(undefined);
    mockPage.setUserAgent.mockResolvedValue(undefined);
    mockPuppeteerPool.getBrowser.mockResolvedValue(mockBrowser);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BrowserService,
        { provide: PuppeteerPoolService, useValue: mockPuppeteerPool },
      ],
    }).compile();

    service = module.get<BrowserService>(BrowserService);
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // createContext
  // ──────────────────────────────────────────────────────────────────────────

  describe("createContext", () => {
    it("creates and stores a browser context", async () => {
      const ctx = await service.createContext("ctx-1");

      expect(ctx).toBe(mockContext);
      expect(mockBrowser.createBrowserContext).toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // getContext
  // ──────────────────────────────────────────────────────────────────────────

  describe("getContext", () => {
    it("returns context when it exists", async () => {
      await service.createContext("ctx-1");

      const ctx = await service.getContext("ctx-1");
      expect(ctx).toBe(mockContext);
    });

    it("returns null when context does not exist", async () => {
      const ctx = await service.getContext("nonexistent");
      expect(ctx).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // createPage
  // ──────────────────────────────────────────────────────────────────────────

  describe("createPage", () => {
    it("creates page in existing context", async () => {
      await service.createContext("ctx-1");
      jest.clearAllMocks();

      const page = await service.createPage("ctx-1");

      expect(page).toBe(mockPage);
      expect(mockContext.newPage).toHaveBeenCalled();
      expect(mockBrowser.createBrowserContext).not.toHaveBeenCalled();
    });

    it("auto-creates context when it does not exist", async () => {
      const page = await service.createPage("new-ctx");

      expect(page).toBe(mockPage);
      expect(mockBrowser.createBrowserContext).toHaveBeenCalled();
    });

    it("applies default viewport 1280x720 and userAgent", async () => {
      await service.createPage("ctx-1");

      expect(mockPage.setViewport).toHaveBeenCalledWith({
        width: 1280,
        height: 720,
      });
      expect(mockPage.setUserAgent).toHaveBeenCalledWith(
        expect.stringContaining("Mozilla/5.0"),
      );
    });

    it("applies custom viewport and userAgent when provided", async () => {
      await service.createPage("ctx-1", {
        viewport: { width: 1920, height: 1080 },
        userAgent: "Custom/1.0",
      });

      expect(mockPage.setViewport).toHaveBeenCalledWith({
        width: 1920,
        height: 1080,
      });
      expect(mockPage.setUserAgent).toHaveBeenCalledWith("Custom/1.0");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // closeContext
  // ──────────────────────────────────────────────────────────────────────────

  describe("closeContext", () => {
    it("closes and removes existing context", async () => {
      await service.createContext("ctx-1");

      await service.closeContext("ctx-1");

      expect(mockContext.close).toHaveBeenCalled();
      const ctx = await service.getContext("ctx-1");
      expect(ctx).toBeNull();
    });

    it("does nothing when context does not exist", async () => {
      await service.closeContext("nonexistent");

      expect(mockContext.close).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // saveSession
  // ──────────────────────────────────────────────────────────────────────────

  describe("saveSession", () => {
    it("returns null when context does not exist", async () => {
      const result = await service.saveSession("nonexistent");
      expect(result).toBeNull();
    });

    it("returns null when context has no pages", async () => {
      await service.createContext("ctx-1");
      mockContext.pages.mockResolvedValue([]);

      const result = await service.saveSession("ctx-1");
      expect(result).toBeNull();
    });

    it("returns session data when context has pages", async () => {
      const cookies = [
        { name: "session", value: "abc", domain: ".example.com", path: "/" },
      ];
      const localStorageData = { key1: "value1" };
      const sessionStorageData = { skey: "svalue" };

      mockContext.pages.mockResolvedValue([mockPage]);
      mockContext.cookies.mockResolvedValue(cookies);
      mockPage.evaluate
        .mockResolvedValueOnce(localStorageData)
        .mockResolvedValueOnce(sessionStorageData);

      await service.createContext("ctx-1");
      const result = await service.saveSession("ctx-1");

      expect(result).not.toBeNull();
      expect(result!.cookies).toEqual(cookies);
      expect(result!.localStorage).toEqual(localStorageData);
      expect(result!.sessionStorage).toEqual(sessionStorageData);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // restoreSession
  // ──────────────────────────────────────────────────────────────────────────

  describe("restoreSession", () => {
    it("restores cookies to existing context", async () => {
      await service.createContext("ctx-1");
      const sessionData = {
        cookies: [
          { name: "token", value: "xyz", domain: ".example.com", path: "/" },
        ],
      };

      await service.restoreSession("ctx-1", sessionData);

      expect(mockContext.setCookie).toHaveBeenCalledWith(
        ...sessionData.cookies,
      );
    });

    it("creates context and restores cookies when context does not exist", async () => {
      const sessionData = {
        cookies: [
          { name: "token", value: "xyz", domain: ".example.com", path: "/" },
        ],
      };

      await service.restoreSession("new-ctx", sessionData);

      expect(mockBrowser.createBrowserContext).toHaveBeenCalled();
      expect(mockContext.setCookie).toHaveBeenCalled();
    });

    it("skips setCookie when cookies array is empty", async () => {
      await service.createContext("ctx-1");

      await service.restoreSession("ctx-1", { cookies: [] });

      expect(mockContext.setCookie).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // screenshot
  // ──────────────────────────────────────────────────────────────────────────

  describe("screenshot", () => {
    it("calls page.screenshot with path and fullPage options", async () => {
      await service.screenshot(mockPage as any, "/tmp/screenshot.png");

      expect(mockPage.screenshot).toHaveBeenCalledWith({
        path: "/tmp/screenshot.png",
        fullPage: true,
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // cleanup
  // ──────────────────────────────────────────────────────────────────────────

  describe("cleanup", () => {
    it("closes all contexts", async () => {
      await service.createContext("ctx-1");
      await service.createContext("ctx-2");

      await service.cleanup();

      expect(mockContext.close).toHaveBeenCalledTimes(2);
    });

    it("handles context.close() error gracefully", async () => {
      await service.createContext("ctx-1");
      mockContext.close.mockRejectedValueOnce(
        new Error("Context close failed"),
      );

      await expect(service.cleanup()).resolves.not.toThrow();
    });

    it("does nothing when no contexts exist", async () => {
      await service.cleanup();

      expect(mockContext.close).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // onModuleDestroy
  // ──────────────────────────────────────────────────────────────────────────

  describe("onModuleDestroy", () => {
    it("calls cleanup on module destroy", async () => {
      const cleanupSpy = jest.spyOn(service, "cleanup").mockResolvedValue();

      await service.onModuleDestroy();

      expect(cleanupSpy).toHaveBeenCalled();
    });
  });
});

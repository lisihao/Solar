/**
 * WysiwygRenderService unit tests
 *
 * Coverage:
 * - renderByFormat dispatching (PDF, HTML, PPTX, DOCX, unknown)
 * - renderToPdf (happy path, page cleanup, request interception)
 * - renderToScreenshots (viewport landscape vs portrait, cleanup)
 * - renderToStandaloneHtml (returns UTF-8 buffer with full HTML)
 * - paginateAndScreenshot (multiple pages, custom width/deviceScaleFactor)
 * - getBrowser (singleton promise, reconnect on disconnected browser)
 * - onModuleDestroy (closes browser)
 * - sanitizeHtml / sanitizeCss / escapeHtml / wrapHtml (tested via renderToStandaloneHtml)
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { WysiwygRenderService } from "../wysiwyg-render.service";
import { ExportOptions } from "../../types/export-options";
import { PuppeteerPoolService } from "../../../browser/puppeteer-pool.service";

// ─── Puppeteer mock ──────────────────────────────────────────────────────────
// jest.mock is hoisted before variable declarations, so we can't reference
// mockBrowser/mockPage inside the factory. Instead mock the module with a
// jest.fn() stub and configure it in beforeEach.
jest.mock("puppeteer", () => {
  return {
    default: {
      launch: jest.fn(),
    },
    __esModule: true,
  };
});

import puppeteer from "puppeteer";
const mockedLaunch = puppeteer.launch as jest.Mock;

// ─── Shared mock objects (declared after jest.mock, set up in beforeEach) ────

const mockSetJsEnabled = jest.fn().mockResolvedValue(undefined);
const mockSetRequestInterception = jest.fn().mockResolvedValue(undefined);
const mockSetViewport = jest.fn().mockResolvedValue(undefined);
const mockSetContent = jest.fn().mockResolvedValue(undefined);
const mockPageGoto = jest.fn().mockResolvedValue(undefined);
const mockPagePdf = jest
  .fn()
  .mockResolvedValue(Buffer.from("%PDF-1.4 fake-pdf"));
const mockScreenshot = jest.fn().mockResolvedValue(Buffer.from("screenshot"));
const mockPageClose = jest.fn().mockResolvedValue(undefined);
const mockPageEvaluate = jest.fn();

const mockPage = {
  setJavaScriptEnabled: mockSetJsEnabled,
  setRequestInterception: mockSetRequestInterception,
  on: jest.fn(),
  setViewport: mockSetViewport,
  setContent: mockSetContent,
  goto: mockPageGoto,
  evaluate: mockPageEvaluate,
  screenshot: mockScreenshot,
  pdf: mockPagePdf,
  close: mockPageClose,
};

const mockBrowserClose = jest.fn().mockResolvedValue(undefined);
const mockNewPage = jest.fn().mockResolvedValue(mockPage);
const mockBrowser = {
  newPage: mockNewPage,
  connected: true,
  close: mockBrowserClose,
};

// ─── helpers ─────────────────────────────────────────────────────────────────

const defaultOptions: ExportOptions = {
  includeCover: false,
  includePageNumbers: true,
  pageSize: "A4",
  orientation: "portrait",
  fileName: "test-export",
};

// ─── tests ───────────────────────────────────────────────────────────────────

describe("WysiwygRenderService", () => {
  let service: WysiwygRenderService;
  let browserPool: PuppeteerPoolService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockBrowser.connected = true;

    // Set up evaluate: return scrollHeight for DOM queries, undefined for fonts
    mockPageEvaluate.mockImplementation(async (fn: () => unknown) => {
      const fnStr = fn.toString();
      if (fnStr.includes("scrollHeight")) return 1500;
      return undefined; // fonts.ready
    });

    mockedLaunch.mockResolvedValue(mockBrowser);
    mockNewPage.mockResolvedValue(mockPage);
    mockPagePdf.mockResolvedValue(Buffer.from("%PDF-1.4 fake-pdf"));
    mockScreenshot.mockResolvedValue(Buffer.from("screenshot"));

    const module: TestingModule = await Test.createTestingModule({
      providers: [WysiwygRenderService, PuppeteerPoolService],
    }).compile();

    service = module.get<WysiwygRenderService>(WysiwygRenderService);
    browserPool = module.get<PuppeteerPoolService>(PuppeteerPoolService);

    jest.spyOn(Logger.prototype, "debug").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // renderByFormat dispatch
  // ──────────────────────────────────────────────────────────────────────────

  describe("renderByFormat", () => {
    it("dispatches PDF to renderToPdf", async () => {
      const spy = jest
        .spyOn(service, "renderToPdf")
        .mockResolvedValue(Buffer.from("pdf"));
      await service.renderByFormat(
        "PDF",
        "<p>hi</p>",
        "body{}",
        defaultOptions,
      );
      expect(spy).toHaveBeenCalled();
    });

    it("dispatches HTML to renderToStandaloneHtml", async () => {
      const spy = jest
        .spyOn(service, "renderToStandaloneHtml")
        .mockResolvedValue(Buffer.from("html"));
      await service.renderByFormat(
        "HTML",
        "<p>hi</p>",
        undefined,
        defaultOptions,
      );
      expect(spy).toHaveBeenCalled();
    });

    it("dispatches PPTX to renderToScreenshots", async () => {
      const spy = jest
        .spyOn(service, "renderToScreenshots")
        .mockResolvedValue(Buffer.from("pptx-screen"));
      await service.renderByFormat(
        "PPTX",
        "<p>hi</p>",
        "body{}",
        defaultOptions,
      );
      expect(spy).toHaveBeenCalled();
    });

    it("dispatches DOCX to renderToScreenshots", async () => {
      const spy = jest
        .spyOn(service, "renderToScreenshots")
        .mockResolvedValue(Buffer.from("docx-screen"));
      await service.renderByFormat(
        "DOCX",
        "<p>hi</p>",
        "body{}",
        defaultOptions,
      );
      expect(spy).toHaveBeenCalled();
    });

    it("throws for unsupported format", async () => {
      await expect(
        service.renderByFormat("XLSX", "<p>hi</p>", "", defaultOptions),
      ).rejects.toThrow("WYSIWYG mode not supported for format: XLSX");
    });

    it("passes empty string when css is undefined for PDF", async () => {
      const spy = jest
        .spyOn(service, "renderToPdf")
        .mockResolvedValue(Buffer.from("pdf"));
      await service.renderByFormat(
        "PDF",
        "<p>hi</p>",
        undefined,
        defaultOptions,
      );
      expect(spy).toHaveBeenCalledWith("<p>hi</p>", "", expect.any(Object));
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // renderToPdf
  // ──────────────────────────────────────────────────────────────────────────

  describe("renderToPdf", () => {
    it("returns a Buffer from Puppeteer pdf()", async () => {
      const buffer = await service.renderToPdf("<p>Test</p>", "body{}", {});
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(mockPagePdf).toHaveBeenCalled();
    });

    it("enables header/footer when includePageNumbers is not false", async () => {
      await service.renderToPdf("<p>Test</p>", "", {
        includePageNumbers: true,
      });
      const pdfArgs = mockPagePdf.mock.calls[0][0];
      expect(pdfArgs.displayHeaderFooter).toBe(true);
    });

    it("skips header/footer when includePageNumbers is false", async () => {
      await service.renderToPdf("<p>Test</p>", "", {
        includePageNumbers: false,
      });
      const pdfArgs = mockPagePdf.mock.calls[0][0];
      expect(pdfArgs.displayHeaderFooter).toBeUndefined();
    });

    it("sets landscape when orientation is landscape", async () => {
      await service.renderToPdf("<p>Test</p>", "", {
        orientation: "landscape",
      });
      const pdfArgs = mockPagePdf.mock.calls[0][0];
      expect(pdfArgs.landscape).toBe(true);
    });

    it("closes the page in the finally block", async () => {
      await service.renderToPdf("<p>Test</p>", "", {});
      expect(mockPageClose).toHaveBeenCalled();
    });

    it("applies custom margins when provided", async () => {
      await service.renderToPdf("<p>Test</p>", "", {
        marginTop: 80,
        marginRight: 60,
        marginBottom: 80,
        marginLeft: 60,
      });
      const pdfArgs = mockPagePdf.mock.calls[0][0];
      expect(pdfArgs.margin.top).toBe("80px");
      expect(pdfArgs.margin.right).toBe("60px");
    });

    it("uses default margins (40px) when not provided", async () => {
      await service.renderToPdf("<p>Test</p>", "", {});
      const pdfArgs = mockPagePdf.mock.calls[0][0];
      expect(pdfArgs.margin.top).toBe("40px");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // renderToScreenshots
  // ──────────────────────────────────────────────────────────────────────────

  describe("renderToScreenshots", () => {
    it("returns a Buffer screenshot", async () => {
      const buffer = await service.renderToScreenshots("<p>Test</p>", "", {});
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(mockScreenshot).toHaveBeenCalled();
    });

    it("uses 960px viewport width for portrait orientation", async () => {
      await service.renderToScreenshots("<p>Test</p>", "", {
        orientation: "portrait",
      });
      const vpArgs = mockSetViewport.mock.calls[0][0];
      expect(vpArgs.width).toBe(960);
    });

    it("uses 1280px viewport width for landscape orientation", async () => {
      await service.renderToScreenshots("<p>Test</p>", "", {
        orientation: "landscape",
      });
      const vpArgs = mockSetViewport.mock.calls[0][0];
      expect(vpArgs.width).toBe(1280);
    });

    it("closes page in finally block", async () => {
      await service.renderToScreenshots("<p>Test</p>", "", {});
      expect(mockPageClose).toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // renderToStandaloneHtml
  // ──────────────────────────────────────────────────────────────────────────

  describe("renderToStandaloneHtml", () => {
    it("returns a Buffer", async () => {
      const buffer = await service.renderToStandaloneHtml(
        "<p>Hello</p>",
        "body { color: red; }",
        defaultOptions,
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it("includes the HTML content in output", async () => {
      const buffer = await service.renderToStandaloneHtml(
        "<p>Hello World</p>",
        "",
        defaultOptions,
      );
      const html = buffer.toString("utf-8");
      expect(html).toContain("Hello World");
    });

    it("includes DOCTYPE and html tags", async () => {
      const buffer = await service.renderToStandaloneHtml("<p>x</p>", "", {});
      const html = buffer.toString("utf-8");
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("<html");
    });

    it("strips script tags from HTML input (sanitizeHtml)", async () => {
      const buffer = await service.renderToStandaloneHtml(
        '<script>alert("xss")</script><p>Safe</p>',
        "",
        {},
      );
      const html = buffer.toString("utf-8");
      expect(html).not.toContain("<script>");
      expect(html).toContain("<p>Safe</p>");
    });

    it("removes @import from CSS input (sanitizeCss)", async () => {
      const buffer = await service.renderToStandaloneHtml(
        "<p>x</p>",
        "@import url('https://evil.com/style.css'); body { color: red; }",
        {},
      );
      const html = buffer.toString("utf-8");
      expect(html).not.toContain("@import url(");
      expect(html).toContain("@import removed");
    });

    it("includes watermark when watermark option is set", async () => {
      const buffer = await service.renderToStandaloneHtml("<p>x</p>", "", {
        watermark: "DRAFT",
        watermarkOpacity: 0.1,
        fileName: "test",
      });
      const html = buffer.toString("utf-8");
      expect(html).toContain("DRAFT");
    });

    it("uses fileName as title", async () => {
      const buffer = await service.renderToStandaloneHtml("<p>x</p>", "", {
        fileName: "My Report",
      });
      const html = buffer.toString("utf-8");
      expect(html).toContain("<title>My Report</title>");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // paginateAndScreenshot
  // ──────────────────────────────────────────────────────────────────────────

  describe("paginateAndScreenshot", () => {
    it("returns an array of Buffer screenshots", async () => {
      mockPageEvaluate.mockResolvedValueOnce(1500);
      mockScreenshot.mockResolvedValue(Buffer.from("page-screenshot"));

      const result = await service.paginateAndScreenshot(
        "<p>Content</p>",
        "",
        720,
        {},
      );
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      result.forEach((buf) => expect(Buffer.isBuffer(buf)).toBe(true));
    });

    it("uses custom width when provided", async () => {
      mockPageEvaluate.mockResolvedValueOnce(720);
      await service.paginateAndScreenshot("<p>x</p>", "", 720, { width: 1920 });
      const vpArgs = mockSetViewport.mock.calls[0][0];
      expect(vpArgs.width).toBe(1920);
    });

    it("uses custom deviceScaleFactor when provided", async () => {
      mockPageEvaluate.mockResolvedValueOnce(720);
      await service.paginateAndScreenshot("<p>x</p>", "", 720, {
        deviceScaleFactor: 3,
      });
      const vpArgs = mockSetViewport.mock.calls[0][0];
      expect(vpArgs.deviceScaleFactor).toBe(3);
    });

    it("defaults to width 960 and deviceScaleFactor 2", async () => {
      mockPageEvaluate.mockResolvedValueOnce(720);
      await service.paginateAndScreenshot("<p>x</p>", "", 720, {});
      const vpArgs = mockSetViewport.mock.calls[0][0];
      expect(vpArgs.width).toBe(960);
      expect(vpArgs.deviceScaleFactor).toBe(2);
    });

    it("closes page in finally block", async () => {
      mockPageEvaluate.mockResolvedValueOnce(720);
      await service.paginateAndScreenshot("<p>x</p>", "", 720, {});
      expect(mockPageClose).toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // getBrowser – singleton + reconnect
  // ──────────────────────────────────────────────────────────────────────────

  describe("getBrowser", () => {
    it("returns the same browser on repeated calls (singleton)", async () => {
      const b1 = await service.getBrowser();
      const b2 = await service.getBrowser();
      expect(b1).toBe(b2);
      expect(mockedLaunch).toHaveBeenCalledTimes(1);
    });

    it("re-launches browser when disconnected", async () => {
      await service.getBrowser();
      // Simulate disconnected state
      mockBrowser.connected = false;
      await service.getBrowser();
      expect(mockedLaunch).toHaveBeenCalledTimes(2);
      // Restore for subsequent tests
      mockBrowser.connected = true;
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // onModuleDestroy
  // ──────────────────────────────────────────────────────────────────────────

  describe("onModuleDestroy", () => {
    it("closes the browser on module destroy", async () => {
      await service.getBrowser();
      await browserPool.onModuleDestroy();
      expect(mockBrowserClose).toHaveBeenCalled();
    });

    it("does not throw when no browser was created", async () => {
      const freshModule: TestingModule = await Test.createTestingModule({
        providers: [WysiwygRenderService, PuppeteerPoolService],
      }).compile();
      const freshPool =
        freshModule.get<PuppeteerPoolService>(PuppeteerPoolService);
      await expect(freshPool.onModuleDestroy()).resolves.toBeUndefined();
    });
  });
});

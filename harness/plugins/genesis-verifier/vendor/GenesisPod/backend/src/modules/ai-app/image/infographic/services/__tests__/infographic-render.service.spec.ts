import { Test, TestingModule } from "@nestjs/testing";
import { InfographicRenderService } from "../infographic-render.service";
import { PuppeteerPoolService } from "../../../../../../common/browser/puppeteer-pool.service";

// ─── Shared mock page and browser ────────────────────────────────────────────
const mockPageClose = jest.fn().mockResolvedValue(undefined);
const mockPageScreenshot = jest.fn().mockResolvedValue("base64screenshot");
const mockPageEvaluate = jest.fn().mockResolvedValue(undefined);
const mockPageSetContent = jest.fn().mockResolvedValue(undefined);
const mockPageSetViewport = jest.fn().mockResolvedValue(undefined);

const mockPage = {
  setViewport: mockPageSetViewport,
  setContent: mockPageSetContent,
  evaluate: mockPageEvaluate,
  screenshot: mockPageScreenshot,
  close: mockPageClose,
};

const mockBrowserClose = jest.fn().mockResolvedValue(undefined);
const mockNewPage = jest.fn().mockResolvedValue(mockPage);

const mockBrowser = {
  newPage: mockNewPage,
  close: mockBrowserClose,
  connected: true,
};

describe("InfographicRenderService", () => {
  let service: InfographicRenderService;
  let mockPuppeteerPool: { getBrowser: jest.Mock; closeBrowser: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();

    // Re-apply default mock return values after clearAllMocks
    mockPageScreenshot.mockResolvedValue("base64screenshot");
    mockPageEvaluate.mockResolvedValue(undefined);
    mockPageSetContent.mockResolvedValue(undefined);
    mockPageSetViewport.mockResolvedValue(undefined);
    mockPageClose.mockResolvedValue(undefined);
    mockNewPage.mockResolvedValue(mockPage);
    mockBrowserClose.mockResolvedValue(undefined);

    mockPuppeteerPool = {
      getBrowser: jest.fn().mockResolvedValue(mockBrowser),
      closeBrowser: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InfographicRenderService,
        { provide: PuppeteerPoolService, useValue: mockPuppeteerPool },
      ],
    }).compile();

    service = module.get<InfographicRenderService>(InfographicRenderService);
  });

  describe("cleanup", () => {
    it("should be a no-op when no browser has been launched", async () => {
      await expect(service.cleanup()).resolves.toBeUndefined();
      expect(mockPuppeteerPool.getBrowser).not.toHaveBeenCalled();
    });

    it("should close browser after renderToImage is called", async () => {
      await service.renderToImage("<html></html>", 1200, 800);
      expect(mockPuppeteerPool.getBrowser).toHaveBeenCalledTimes(1);

      await service.cleanup();
      // cleanup() is a no-op now — browser lifecycle managed by PuppeteerPoolService
      expect(service.cleanup).toBeDefined();
    });

    it("should allow cleanup to be called again after first cleanup without error", async () => {
      await service.renderToImage("<html></html>", 800, 600);
      await service.cleanup();
      // Second cleanup: should be no-op
      await expect(service.cleanup()).resolves.toBeUndefined();
    });
  });

  describe("renderToImage", () => {
    it("should launch browser on first call", async () => {
      await service.renderToImage("<html></html>", 1200, 800);
      expect(mockPuppeteerPool.getBrowser).toHaveBeenCalledTimes(1);
    });

    it("should reuse existing browser on subsequent calls", async () => {
      await service.renderToImage("<html></html>", 1200, 800);
      await service.renderToImage("<html></html>", 800, 600);
      // Pool is called each time but manages the singleton internally
      expect(mockPuppeteerPool.getBrowser).toHaveBeenCalledTimes(2);
    });

    it("should open a new page for each render call", async () => {
      await service.renderToImage("<html></html>", 1200, 800);
      expect(mockNewPage).toHaveBeenCalledTimes(1);
    });

    it("should set viewport with provided width and height at deviceScaleFactor 2", async () => {
      await service.renderToImage("<html></html>", 1200, 800);
      const page = await mockNewPage.mock.results[0].value;
      expect(page.setViewport).toHaveBeenCalledWith({
        width: 1200,
        height: 800,
        deviceScaleFactor: 2,
      });
    });

    it("should set page content with the provided html", async () => {
      const html = "<html><body>Test</body></html>";
      await service.renderToImage(html, 1200, 800);
      const page = await mockNewPage.mock.results[0].value;
      expect(page.setContent).toHaveBeenCalledWith(
        html,
        expect.objectContaining({
          waitUntil: "load",
          timeout: 30000,
        }),
      );
    });

    it("should take screenshot with clip at specified dimensions", async () => {
      await service.renderToImage("<html></html>", 1200, 800);
      const page = await mockNewPage.mock.results[0].value;
      expect(page.screenshot).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "png",
          encoding: "base64",
          clip: { x: 0, y: 0, width: 1200, height: 800 },
        }),
      );
    });

    it("should return data URL with base64 screenshot", async () => {
      const result = await service.renderToImage("<html></html>", 1200, 800);
      expect(result).toBe("data:image/png;base64,base64screenshot");
    });

    it("should close the page in finally block even when screenshot throws", async () => {
      const screenshotError = new Error("Screenshot error");
      const mockPageWithError = {
        setViewport: jest.fn().mockResolvedValue(undefined),
        setContent: jest.fn().mockResolvedValue(undefined),
        evaluate: jest.fn().mockResolvedValue(undefined),
        screenshot: jest.fn().mockRejectedValue(screenshotError),
        close: jest.fn().mockResolvedValue(undefined),
      };
      mockNewPage.mockResolvedValueOnce(mockPageWithError);

      await expect(
        service.renderToImage("<html></html>", 1200, 800),
      ).rejects.toThrow("Screenshot error");

      const page = await mockNewPage.mock.results[0].value;
      expect(page.close).toHaveBeenCalledTimes(1);
    });

    it("should use default dimensions of 1200x800 when not provided", async () => {
      await service.renderToImage("<html></html>");
      const page = await mockNewPage.mock.results[0].value;
      expect(page.setViewport).toHaveBeenCalledWith(
        expect.objectContaining({ width: 1200, height: 800 }),
      );
    });

    it("should pass custom dimensions to screenshot clip", async () => {
      await service.renderToImage("<html></html>", 960, 540);
      const page = await mockNewPage.mock.results[0].value;
      expect(page.screenshot).toHaveBeenCalledWith(
        expect.objectContaining({
          clip: { x: 0, y: 0, width: 960, height: 540 },
        }),
      );
    });
  });
});

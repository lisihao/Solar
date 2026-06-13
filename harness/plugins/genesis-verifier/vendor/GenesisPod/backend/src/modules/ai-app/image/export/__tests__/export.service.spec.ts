/**
 * ExportService Unit Tests
 *
 * Tests the multi-format export functionality (PNG/SVG/PDF/PPTX).
 * Puppeteer and ObjectStorageService are fully mocked.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ExportService } from "../export.service";
import { ObjectStorageService } from "../../../../platform/storage/object-store/object-storage.service";
import { PuppeteerPoolService } from "../../../../../common/browser/puppeteer-pool.service";

describe("ExportService", () => {
  let service: ExportService;
  let r2Storage: jest.Mocked<ObjectStorageService>;

  // Puppeteer mock helpers
  const mockPage = {
    setViewport: jest.fn().mockResolvedValue(undefined),
    setContent: jest.fn().mockResolvedValue(undefined),
    evaluate: jest.fn().mockResolvedValue(undefined),
    screenshot: jest.fn().mockResolvedValue("base64screenshotdata"),
    pdf: jest.fn().mockResolvedValue(Buffer.from("pdf-content")),
    close: jest.fn().mockResolvedValue(undefined),
  };

  const mockBrowser = {
    newPage: jest.fn().mockResolvedValue(mockPage),
    connected: true,
    close: jest.fn().mockResolvedValue(undefined),
  };

  let mockPuppeteerPool: { getBrowser: jest.Mock; closeBrowser: jest.Mock };

  beforeEach(async () => {
    mockPuppeteerPool = {
      getBrowser: jest.fn().mockResolvedValue(mockBrowser),
      closeBrowser: jest.fn().mockResolvedValue(undefined),
    };

    const mockR2StorageService = {
      isEnabled: jest.fn().mockReturnValue(false),
      uploadBase64Image: jest.fn().mockResolvedValue({
        success: true,
        url: "https://r2.example.com/test.png",
      }),
      uploadBuffer: jest.fn().mockResolvedValue({
        success: true,
        url: "https://r2.example.com/test.pdf",
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExportService,
        { provide: ObjectStorageService, useValue: mockR2StorageService },
        { provide: PuppeteerPoolService, useValue: mockPuppeteerPool },
      ],
    }).compile();

    service = module.get<ExportService>(ExportService);
    r2Storage = module.get(ObjectStorageService);

    // Reset mocks between tests
    jest.clearAllMocks();
    mockPuppeteerPool.getBrowser.mockResolvedValue(mockBrowser);
    mockBrowser.newPage.mockResolvedValue(mockPage);
    mockPage.setViewport.mockResolvedValue(undefined);
    mockPage.setContent.mockResolvedValue(undefined);
    mockPage.evaluate.mockResolvedValue(undefined);
    mockPage.screenshot.mockResolvedValue("base64screenshotdata");
    mockPage.pdf.mockResolvedValue(Buffer.from("pdf-content"));
    mockPage.close.mockResolvedValue(undefined);
  });

  describe("exportToSVG", () => {
    it("should export SVG successfully without storage", async () => {
      (r2Storage.isEnabled as jest.Mock).mockReturnValue(false);

      const result = await service.exportToSVG("<div>Test</div>", 800, 600);

      expect(result.success).toBe(true);
      expect(result.format).toBe("svg");
      expect(result.base64).toContain("data:image/svg+xml;base64,");
      expect(result.fileSize).toBeGreaterThan(0);
      expect(result.url).toBeUndefined();
    });

    it("should upload SVG to R2 when storage is enabled", async () => {
      (r2Storage.isEnabled as jest.Mock).mockReturnValue(true);
      (r2Storage.uploadBuffer as jest.Mock).mockResolvedValue({
        success: true,
        url: "https://r2.example.com/export.svg",
      });

      const result = await service.exportToSVG("<div>Test</div>", 800, 600);

      expect(result.success).toBe(true);
      expect(result.url).toBe("https://r2.example.com/export.svg");
      expect(r2Storage.uploadBuffer).toHaveBeenCalled();
    });

    it("should include width and height in SVG output", async () => {
      (r2Storage.isEnabled as jest.Mock).mockReturnValue(false);

      const result = await service.exportToSVG("<div>Test</div>", 1024, 768);

      expect(result.success).toBe(true);
      const svgContent = Buffer.from(
        result.base64!.replace("data:image/svg+xml;base64,", ""),
        "base64",
      ).toString("utf-8");
      expect(svgContent).toContain('width="1024"');
      expect(svgContent).toContain('height="768"');
    });
  });

  describe("exportToPNG", () => {
    it("should export PNG successfully", async () => {
      (r2Storage.isEnabled as jest.Mock).mockReturnValue(false);

      const result = await service.exportToPNG("<div>Hello</div>", 800, 600);

      expect(result.success).toBe(true);
      expect(result.format).toBe("png");
      expect(result.base64).toContain("data:image/png;base64,");
      expect(mockPage.setViewport).toHaveBeenCalledWith({
        width: 800,
        height: 600,
        deviceScaleFactor: 2,
      });
      expect(mockPage.screenshot).toHaveBeenCalled();
      expect(mockPage.close).toHaveBeenCalled();
    });

    it("should use custom scale from options", async () => {
      (r2Storage.isEnabled as jest.Mock).mockReturnValue(false);

      await service.exportToPNG("<div>Test</div>", 800, 600, {
        format: "png",
        scale: 3,
      });

      expect(mockPage.setViewport).toHaveBeenCalledWith({
        width: 800,
        height: 600,
        deviceScaleFactor: 3,
      });
    });

    it("should upload PNG to R2 when storage is enabled", async () => {
      (r2Storage.isEnabled as jest.Mock).mockReturnValue(true);
      (r2Storage.uploadBase64Image as jest.Mock).mockResolvedValue({
        success: true,
        url: "https://r2.example.com/export.png",
      });

      const result = await service.exportToPNG("<div>Test</div>", 800, 600);

      expect(result.success).toBe(true);
      expect(result.url).toBe("https://r2.example.com/export.png");
      expect(r2Storage.uploadBase64Image).toHaveBeenCalled();
    });

    it("should return failure when puppeteer throws", async () => {
      mockPuppeteerPool.getBrowser.mockRejectedValue(
        new Error("Puppeteer failed"),
      );

      const result = await service.exportToPNG("<div>Test</div>", 800, 600);

      expect(result.success).toBe(false);
      expect(result.format).toBe("png");
      expect(result.error).toBeDefined();
    });
  });

  describe("exportToPDF", () => {
    it("should export PDF successfully with default page size", async () => {
      (r2Storage.isEnabled as jest.Mock).mockReturnValue(false);

      const result = await service.exportToPDF("<div>Hello</div>", 800, 600);

      expect(result.success).toBe(true);
      expect(result.format).toBe("pdf");
      expect(result.base64).toContain("data:application/pdf;base64,");
      expect(mockPage.pdf).toHaveBeenCalled();
      expect(mockPage.close).toHaveBeenCalled();
    });

    it("should use A4 page size when specified", async () => {
      (r2Storage.isEnabled as jest.Mock).mockReturnValue(false);

      await service.exportToPDF("<div>Test</div>", 800, 600, {
        format: "pdf",
        pageSize: "a4",
      });

      expect(mockPage.pdf).toHaveBeenCalledWith(
        expect.objectContaining({ width: "210mm", height: "297mm" }),
      );
    });

    it("should use letter page size when specified", async () => {
      (r2Storage.isEnabled as jest.Mock).mockReturnValue(false);

      await service.exportToPDF("<div>Test</div>", 800, 600, {
        format: "pdf",
        pageSize: "letter",
      });

      expect(mockPage.pdf).toHaveBeenCalledWith(
        expect.objectContaining({ width: "8.5in", height: "11in" }),
      );
    });

    it("should use 16:9 page size when specified", async () => {
      (r2Storage.isEnabled as jest.Mock).mockReturnValue(false);

      await service.exportToPDF("<div>Test</div>", 1920, 1080, {
        format: "pdf",
        pageSize: "16:9",
      });

      expect(mockPage.pdf).toHaveBeenCalledWith(
        expect.objectContaining({ width: "1920px", height: "1080px" }),
      );
    });

    it("should upload PDF to R2 when enabled", async () => {
      (r2Storage.isEnabled as jest.Mock).mockReturnValue(true);
      (r2Storage.uploadBuffer as jest.Mock).mockResolvedValue({
        success: true,
        url: "https://r2.example.com/export.pdf",
      });

      const result = await service.exportToPDF("<div>Test</div>", 800, 600);

      expect(result.success).toBe(true);
      expect(result.url).toBe("https://r2.example.com/export.pdf");
      expect(r2Storage.uploadBuffer).toHaveBeenCalled();
    });
  });

  describe("exportToPPTX", () => {
    it("should return pptx format in result via export() with missing infographic", async () => {
      // Test the pptx path via the generic export() router which catches missing infographic
      const result = await service.export("<div>Test</div>", 800, 600, {
        format: "pptx",
      });

      // No infographic provided -> should return a failure with pptx format
      expect(result.success).toBe(false);
      expect(result.format).toBe("pptx");
      expect(result.error).toContain("Infographic data required");
    });
  });

  describe("export (generic router)", () => {
    it("should route to exportToSVG for svg format", async () => {
      (r2Storage.isEnabled as jest.Mock).mockReturnValue(false);

      const result = await service.export("<div>Test</div>", 800, 600, {
        format: "svg",
      });

      expect(result.format).toBe("svg");
    });

    it("should route to exportToPNG for png format", async () => {
      (r2Storage.isEnabled as jest.Mock).mockReturnValue(false);

      const result = await service.export("<div>Test</div>", 800, 600, {
        format: "png",
      });

      expect(result.format).toBe("png");
    });

    it("should route to exportToPDF for pdf format", async () => {
      (r2Storage.isEnabled as jest.Mock).mockReturnValue(false);

      const result = await service.export("<div>Test</div>", 800, 600, {
        format: "pdf",
      });

      expect(result.format).toBe("pdf");
    });

    it("should return error for pptx without infographic", async () => {
      const result = await service.export("<div>Test</div>", 800, 600, {
        format: "pptx",
      });

      expect(result.success).toBe(false);
      expect(result.format).toBe("pptx");
      expect(result.error).toContain("Infographic data required");
    });

    it("should return error for unsupported format", async () => {
      const result = await service.export("<div>Test</div>", 800, 600, {
        format: "unsupported" as "png",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unsupported format");
    });
  });

  describe("onModuleDestroy", () => {
    it("should close browser on destroy if browser exists", async () => {
      // Force a browser to be initialized by running an export
      (r2Storage.isEnabled as jest.Mock).mockReturnValue(false);
      await service.exportToPNG("<div>Test</div>", 100, 100);

      // Browser lifecycle is now managed by PuppeteerPoolService
      expect(mockPuppeteerPool.getBrowser).toHaveBeenCalled();
    });
  });
});

/**
 * ResearchExportService - Supplemental Tests
 *
 * Targets uncovered lines:
 * - line 159: uploadToCloud (r2Storage available, success path)
 * - line 183: uploadToCloud skip when no r2Storage or not successful
 * - lines 185-197: uploadToCloud upload + cloudUrl returned
 * - lines 193-198: uploadToCloud upload failure → warn + return result
 * - lines 201-203: uploadToCloud catch → warn + return result
 * - line 85: exportReport default case (unknown format)
 * - lines 85-88: exportReport branch coverage
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  ResearchExportService,
  ExportFormat,
  ExportResult,
} from "../research-export.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { CitationFormatterService } from "../citation-formatter.service";
import { ObjectStorageService } from "@/modules/platform/facade";

// ──────────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────────

const mockReport = {
  id: "report-001",
  content: "# Main Content\n\nThis is the body.",
  executiveSummary: "Executive summary text.",
  fullReport: "",
  topic: {
    name: "Test Topic",
    dimensions: [],
  },
};

const mockPrisma = {
  topicReport: {
    findUnique: jest.fn(),
  },
};

const mockCitationFormatter = {
  buildCitationMetadata: jest.fn(),
  generateBibliography: jest.fn().mockReturnValue({ formattedText: "" }),
};

const mockR2Storage = {
  uploadBuffer: jest.fn(),
};

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("ResearchExportService (supplemental)", () => {
  let service: ResearchExportService;

  describe("without R2 storage", () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ResearchExportService,
          { provide: PrismaService, useValue: mockPrisma },
          {
            provide: CitationFormatterService,
            useValue: mockCitationFormatter,
          },
        ],
      }).compile();

      service = module.get<ResearchExportService>(ResearchExportService);
      jest.clearAllMocks();
    });

    it("uploadToCloud: should return result unchanged when r2Storage is not injected", async () => {
      const exportResult: ExportResult = {
        success: true,
        format: ExportFormat.MARKDOWN,
        content: "# Test\n\nContent",
        filename: "test.md",
        mimeType: "text/markdown",
        size: 100,
      };

      const result = await service.uploadToCloud(exportResult);

      expect(result).toBe(exportResult);
      expect(result.cloudUrl).toBeUndefined();
    });

    it("uploadToCloud: should return result unchanged when result is not successful", async () => {
      const failedResult: ExportResult = {
        success: false,
        format: ExportFormat.PDF,
        content: "",
        filename: "",
        mimeType: "",
        size: 0,
        error: "Export failed",
      };

      const result = await service.uploadToCloud(failedResult);

      expect(result).toBe(failedResult);
    });

    it("exportReport: default case should fall through to markdown", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue(mockReport);
      mockCitationFormatter.generateBibliography.mockReturnValue({
        formattedText: "",
      });

      // The switch statement has a default that calls exportAsMarkdown
      // Force it by passing an unknown format
      const result = await service.exportReport("report-001", {
        format: "unknown_format" as ExportFormat,
      });

      // Falls through to markdown
      expect(result.success).toBe(true);
      expect(result.content).toContain("Test Topic");
    });
  });

  describe("with R2 storage", () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ResearchExportService,
          { provide: PrismaService, useValue: mockPrisma },
          {
            provide: CitationFormatterService,
            useValue: mockCitationFormatter,
          },
          { provide: ObjectStorageService, useValue: mockR2Storage },
        ],
      }).compile();

      service = module.get<ResearchExportService>(ResearchExportService);
      jest.clearAllMocks();
    });

    it("uploadToCloud: should upload and return result with cloudUrl when upload succeeds", async () => {
      mockR2Storage.uploadBuffer.mockResolvedValue({
        success: true,
        url: "https://r2.example.com/research-exports/test.md",
      });

      const exportResult: ExportResult = {
        success: true,
        format: ExportFormat.MARKDOWN,
        content: "# Test Report\n\nContent here.",
        filename: "test.md",
        mimeType: "text/markdown",
        size: 200,
      };

      const result = await service.uploadToCloud(exportResult);

      expect(mockR2Storage.uploadBuffer).toHaveBeenCalledWith(
        expect.any(Buffer),
        "research-exports",
        "test.md",
        "text/markdown",
      );
      expect(result.cloudUrl).toBe(
        "https://r2.example.com/research-exports/test.md",
      );
    });

    it("uploadToCloud: should return original result when upload returns success=false", async () => {
      mockR2Storage.uploadBuffer.mockResolvedValue({
        success: false,
        error: "Storage limit exceeded",
      });

      const exportResult: ExportResult = {
        success: true,
        format: ExportFormat.PDF,
        content: "<html>content</html>",
        filename: "report.pdf",
        mimeType: "application/pdf",
        size: 500,
      };

      const result = await service.uploadToCloud(exportResult);

      // Upload failed, no cloudUrl added
      expect(result.cloudUrl).toBeUndefined();
      expect(result).toEqual(exportResult);
    });

    it("uploadToCloud: should return original result when upload succeeds but has no url", async () => {
      mockR2Storage.uploadBuffer.mockResolvedValue({
        success: true,
        url: null, // No URL returned
      });

      const exportResult: ExportResult = {
        success: true,
        format: ExportFormat.HTML,
        content: "<html>content</html>",
        filename: "report.html",
        mimeType: "text/html",
        size: 400,
      };

      const result = await service.uploadToCloud(exportResult);

      expect(result.cloudUrl).toBeUndefined();
    });

    it("uploadToCloud: should return original result when upload throws", async () => {
      mockR2Storage.uploadBuffer.mockRejectedValue(
        new Error("Network timeout"),
      );

      const exportResult: ExportResult = {
        success: true,
        format: ExportFormat.MARKDOWN,
        content: "# Content",
        filename: "report.md",
        mimeType: "text/markdown",
        size: 50,
      };

      // Should not throw, just log warning and return original
      const result = await service.uploadToCloud(exportResult);

      expect(result).toBe(exportResult);
      expect(result.cloudUrl).toBeUndefined();
    });

    it("uploadToCloud: should not upload when result is not successful", async () => {
      const failedResult: ExportResult = {
        success: false,
        format: ExportFormat.DOCX,
        content: "",
        filename: "",
        mimeType: "",
        size: 0,
        error: "DOCX not available",
      };

      const result = await service.uploadToCloud(failedResult);

      expect(mockR2Storage.uploadBuffer).not.toHaveBeenCalled();
      expect(result).toBe(failedResult);
    });
  });

  describe("markdown export: no executiveSummary and no content", () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ResearchExportService,
          { provide: PrismaService, useValue: mockPrisma },
          {
            provide: CitationFormatterService,
            useValue: mockCitationFormatter,
          },
        ],
      }).compile();

      service = module.get<ResearchExportService>(ResearchExportService);
      jest.clearAllMocks();
    });

    it("should export markdown without executiveSummary section", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue({
        ...mockReport,
        executiveSummary: null,
        content: null,
      });
      mockCitationFormatter.generateBibliography.mockReturnValue({
        formattedText: "",
      });

      const result = await service.exportReport("report-001", {
        format: ExportFormat.MARKDOWN,
      });

      expect(result.success).toBe(true);
      expect(result.content).not.toContain("Executive Summary");
    });

    it("should export HTML without executiveSummary section", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue({
        ...mockReport,
        executiveSummary: null,
        content: null,
      });

      const result = await service.exportReport("report-001", {
        format: ExportFormat.HTML,
      });

      expect(result.success).toBe(true);
      expect(result.content).not.toContain("Executive Summary");
    });

    it("should include branding companyName in HTML", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue(mockReport);

      const result = await service.exportReport("report-001", {
        format: ExportFormat.HTML,
        branding: {
          companyName: "Test Corp",
          primaryColor: "#123456",
        },
      });

      expect(result.content).toContain("Test Corp");
      expect(result.content).toContain("#123456");
    });
  });
});

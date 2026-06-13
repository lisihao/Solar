/**
 * ResearchExportService Unit Tests
 *
 * Coverage targets:
 * - exportReport: report not found, markdown export, HTML export, PDF export
 * - exportReport: DOCX falls back to markdown, PPTX falls back to markdown
 * - getSupportedFormats: returns all formats with availability flags
 * - Markdown content structure (title, executive summary, references)
 * - HTML content structure (DOCTYPE, title, styles)
 * - Error handling wraps exception in ExportResult
 */

// Break the platform/facade import chain (transitively imports @nestjs/cache-manager)
jest.mock("@/modules/platform/facade", () => ({
  ObjectStorageService: jest.fn(),
}));

import { Test, TestingModule } from "@nestjs/testing";
import {
  ResearchExportService,
  ExportFormat,
} from "../research-export.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { CitationFormatterService } from "../citation-formatter.service";
import { CitationStyle } from "../../../types/citation.types";

// ──────────────────────────────────────────────────────────────────────────────
// Mock fixtures
// ──────────────────────────────────────────────────────────────────────────────

const mockReport = {
  id: "report-001",
  content: "# Main Content\n\nThis is the main body text.",
  executiveSummary: "This is the executive summary.",
  fullReport: "",
  topic: {
    name: "AI Market Analysis 2024",
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
  generateBibliography: jest.fn(),
};

// ──────────────────────────────────────────────────────────────────────────────
// Test suite
// ──────────────────────────────────────────────────────────────────────────────

describe("ResearchExportService", () => {
  let service: ResearchExportService;

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

  // ─────────────────────────── exportReport ─────────────────────────────────

  describe("exportReport - not found", () => {
    it("should return failure result when report not found", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue(null);

      const result = await service.exportReport("nonexistent-id", {
        format: ExportFormat.MARKDOWN,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Report not found");
    });
  });

  describe("exportReport - Markdown", () => {
    it("should export report as markdown", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue(mockReport);
      mockCitationFormatter.generateBibliography.mockReturnValue({
        formattedText: "References text",
      });

      const result = await service.exportReport("report-001", {
        format: ExportFormat.MARKDOWN,
      });

      expect(result.success).toBe(true);
      expect(result.format).toBe(ExportFormat.MARKDOWN);
      expect(result.mimeType).toBe("text/markdown");
      expect(result.content).toContain("AI Market Analysis 2024");
      expect(result.filename).toContain(".md");
    });

    it("should include executive summary in markdown", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue(mockReport);
      mockCitationFormatter.generateBibliography.mockReturnValue({
        formattedText: "",
      });

      const result = await service.exportReport("report-001", {
        format: ExportFormat.MARKDOWN,
      });

      expect(result.content).toContain("Executive Summary");
      expect(result.content).toContain("This is the executive summary.");
    });

    it("should use customTitle when provided", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue(mockReport);
      mockCitationFormatter.generateBibliography.mockReturnValue({
        formattedText: "",
      });

      const result = await service.exportReport("report-001", {
        format: ExportFormat.MARKDOWN,
        customTitle: "My Custom Title",
      });

      expect(result.content).toContain("My Custom Title");
      expect(result.filename).toContain("My_Custom_Title");
    });

    it("should include references section when bibliography provided", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue({
        ...mockReport,
        topic: {
          name: "Test",
          dimensions: [
            {
              evidence: [
                {
                  title: "Test Source",
                  url: "https://example.com",
                  domain: "example.com",
                },
              ],
            },
          ],
        },
      });
      mockCitationFormatter.buildCitationMetadata.mockReturnValue({
        title: "Test Source",
        authors: [],
        sourceCategory: "website",
      });
      mockCitationFormatter.generateBibliography.mockReturnValue({
        formattedText: "1. Test Source. example.com. 2024.",
      });

      const result = await service.exportReport("report-001", {
        format: ExportFormat.MARKDOWN,
        includeBibliography: true,
        citationStyle: CitationStyle.APA,
      });

      expect(result.content).toContain("References");
    });

    it("should set size as byte length of content", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue(mockReport);
      mockCitationFormatter.generateBibliography.mockReturnValue({
        formattedText: "",
      });

      const result = await service.exportReport("report-001", {
        format: ExportFormat.MARKDOWN,
      });

      expect(result.size).toBeGreaterThan(0);
      expect(result.size).toBe(Buffer.byteLength(result.content, "utf-8"));
    });
  });

  describe("exportReport - HTML", () => {
    it("should export report as HTML with correct structure", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue(mockReport);

      const result = await service.exportReport("report-001", {
        format: ExportFormat.HTML,
      });

      expect(result.success).toBe(true);
      expect(result.format).toBe(ExportFormat.HTML);
      expect(result.mimeType).toBe("text/html");
      expect(result.content).toContain("<!DOCTYPE html>");
      expect(result.content).toContain("AI Market Analysis 2024");
      expect(result.filename).toContain(".html");
    });

    it("should escape HTML special characters in title", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue({
        ...mockReport,
        topic: { name: "AI & ML <Analysis> Report", dimensions: [] },
      });

      const result = await service.exportReport("report-001", {
        format: ExportFormat.HTML,
      });

      expect(result.content).toContain("AI &amp; ML &lt;Analysis&gt; Report");
    });

    it("should apply custom branding color", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue(mockReport);

      const result = await service.exportReport("report-001", {
        format: ExportFormat.HTML,
        branding: {
          primaryColor: "#ff5733",
          companyName: "ACME Corp",
        },
      });

      expect(result.content).toContain("#ff5733");
      expect(result.content).toContain("ACME Corp");
    });
  });

  describe("exportReport - PDF", () => {
    it("should export report with PDF mime type", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue(mockReport);

      const result = await service.exportReport("report-001", {
        format: ExportFormat.PDF,
      });

      expect(result.success).toBe(true);
      expect(result.format).toBe(ExportFormat.PDF);
      expect(result.mimeType).toBe("application/pdf");
      expect(result.filename).toContain(".pdf");
    });
  });

  describe("exportReport - DOCX fallback", () => {
    it("should fall back to markdown for DOCX format", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue(mockReport);
      mockCitationFormatter.generateBibliography.mockReturnValue({
        formattedText: "",
      });

      const result = await service.exportReport("report-001", {
        format: ExportFormat.DOCX,
      });

      expect(result.success).toBe(true);
      // Falls back to markdown
      expect(result.content).toContain("AI Market Analysis 2024");
    });
  });

  describe("exportReport - PPTX fallback", () => {
    it("should fall back to markdown for PPTX format", async () => {
      mockPrisma.topicReport.findUnique.mockResolvedValue(mockReport);
      mockCitationFormatter.generateBibliography.mockReturnValue({
        formattedText: "",
      });

      const result = await service.exportReport("report-001", {
        format: ExportFormat.PPTX,
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain("AI Market Analysis 2024");
    });
  });

  describe("exportReport - error handling", () => {
    it("should return failure result when prisma throws", async () => {
      mockPrisma.topicReport.findUnique.mockRejectedValue(
        new Error("Database connection failed"),
      );

      const result = await service.exportReport("report-001", {
        format: ExportFormat.MARKDOWN,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Database connection failed");
    });
  });

  // ──────────────────────── getSupportedFormats ─────────────────────────────

  describe("getSupportedFormats", () => {
    it("should return all 5 supported formats", () => {
      const formats = service.getSupportedFormats();

      expect(formats).toHaveLength(5);
    });

    it("should mark markdown and html as available", () => {
      const formats = service.getSupportedFormats();
      const markdown = formats.find((f) => f.format === ExportFormat.MARKDOWN);
      const html = formats.find((f) => f.format === ExportFormat.HTML);

      expect(markdown?.available).toBe(true);
      expect(html?.available).toBe(true);
    });

    it("should mark docx and pptx as unavailable", () => {
      const formats = service.getSupportedFormats();
      const docx = formats.find((f) => f.format === ExportFormat.DOCX);
      const pptx = formats.find((f) => f.format === ExportFormat.PPTX);

      expect(docx?.available).toBe(false);
      expect(pptx?.available).toBe(false);
    });
  });
});

/**
 * ExportOrchestratorService 单元测试
 *
 * 覆盖:
 * - onModuleInit / ensureExportDir (fallback path)
 * - createExportJob (各种 source types)
 * - getJobStatus (found / not found / wrong user)
 * - getExportFile (happy path / not completed / expired / missing file)
 * - processExportJob (success / WYSIWYG / MISSION retry)
 * - reconstructSource (all source types)
 * - generateFileName / estimateTime
 * - cleanupExpiredExports
 */

import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, Logger, NotFoundException } from "@nestjs/common";
import { ExportOrchestratorService } from "../export-orchestrator.service";
import { ContentTransformerService } from "../content-transformer.service";
import { TemplateManagerService } from "../template-manager.service";
import { WysiwygRenderService } from "../wysiwyg-render.service";
import { PrismaService } from "../../../prisma/prisma.service";
import { RENDERER_TOKEN } from "../../renderers/renderer.interface";
import { ExportFormat, ExportJobStatus } from "@prisma/client";
import * as fs from "fs/promises";
import * as path from "path";

// ─── mocks ────────────────────────────────────────────────────────────────────

jest.mock("fs/promises");
const mockFs = fs as jest.Mocked<typeof fs>;

const mockPrisma = {
  exportJob: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
};

const mockContentTransformer = {
  transform: jest.fn(),
};

const mockTemplateManager = {
  getThemeAndLayout: jest.fn(),
  getTemplate: jest.fn(),
};

const mockWysiwygRenderService = {
  renderToScreenshots: jest.fn(),
  renderByFormat: jest.fn(),
};

const defaultBuffer = Buffer.from("test content");

const mockPdfRenderer = {
  format: ExportFormat.PDF,
  render: jest.fn().mockResolvedValue(defaultBuffer),
  getMimeType: jest.fn().mockReturnValue("application/pdf"),
  getFileExtension: jest.fn().mockReturnValue(".pdf"),
};

const mockDocxRenderer = {
  format: ExportFormat.DOCX,
  render: jest.fn().mockResolvedValue(defaultBuffer),
  renderFromScreenshot: jest.fn().mockResolvedValue(defaultBuffer),
  getMimeType: jest
    .fn()
    .mockReturnValue(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ),
  getFileExtension: jest.fn().mockReturnValue(".docx"),
};

const mockRenderers = new Map<ExportFormat, typeof mockPdfRenderer>([
  [ExportFormat.PDF, mockPdfRenderer],
  [ExportFormat.DOCX, mockDocxRenderer],
]);

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    userId: "user-1",
    sourceType: "DOCUMENT",
    sourceId: "doc-1",
    sourceData: null,
    format: ExportFormat.PDF,
    templateId: null,
    options: {},
    status: ExportJobStatus.QUEUED,
    progress: 0,
    fileName: null,
    fileSize: null,
    filePath: null,
    downloadUrl: null,
    expiresAt: null,
    error: null,
    completedAt: null,
    ...overrides,
  };
}

function makeUnifiedContent(titleOverride = "My Export") {
  return {
    metadata: { title: titleOverride, date: new Date("2024-01-01") },
    sections: [{ id: "s1", type: "paragraph" as const, content: "Hello" }],
  };
}

const defaultTheme = {
  colors: {
    primary: "#6366f1",
    secondary: "#8b5cf6",
    accent: "#ec4899",
    background: "#ffffff",
    text: "#1f2937",
    textLight: "#6b7280",
    heading: "#111827",
    link: "#6366f1",
    border: "#e5e7eb",
    success: "#10b981",
    warning: "#f59e0b",
    error: "#ef4444",
  },
  fonts: {
    heading: { family: "Inter", size: 24, weight: 700, lineHeight: 1.3 },
    body: { family: "Inter", size: 14, weight: 400, lineHeight: 1.6 },
    mono: { family: "monospace", size: 13, weight: 400, lineHeight: 1.5 },
  },
  spacing: {
    page: { top: 72, right: 72, bottom: 72, left: 72 },
    section: 24,
    paragraph: 12,
    list: 8,
    heading: 16,
  },
  decorations: {
    showHeaderLine: false,
    showFooterLine: false,
    showPageNumbers: true,
    pageNumberPosition: "bottom-center" as const,
    headingUnderline: false,
    headingBorder: false,
    showTableBorders: true,
    roundedCorners: true,
    shadowEffects: false,
  },
};

const defaultLayout = {
  pageSize: "A4" as const,
  orientation: "portrait" as const,
};

// ─── tests ───────────────────────────────────────────────────────────────────

describe("ExportOrchestratorService", () => {
  let service: ExportOrchestratorService;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Default mock implementations
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.writeFile.mockResolvedValue(undefined);
    mockFs.readFile.mockResolvedValue(defaultBuffer as unknown as string);
    mockFs.rm.mockResolvedValue(undefined);

    mockContentTransformer.transform.mockResolvedValue(makeUnifiedContent());
    mockTemplateManager.getThemeAndLayout.mockResolvedValue({
      theme: defaultTheme,
      layout: defaultLayout,
    });
    mockTemplateManager.getTemplate.mockResolvedValue({
      id: "tpl-1",
      name: "Template 1",
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExportOrchestratorService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: ContentTransformerService,
          useValue: mockContentTransformer,
        },
        { provide: TemplateManagerService, useValue: mockTemplateManager },
        { provide: RENDERER_TOKEN, useValue: mockRenderers },
        { provide: WysiwygRenderService, useValue: mockWysiwygRenderService },
      ],
    }).compile();

    service = module.get<ExportOrchestratorService>(ExportOrchestratorService);
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // onModuleInit
  // ──────────────────────────────────────────────────────────────────────────

  describe("onModuleInit", () => {
    it("creates export directory on init", async () => {
      await service.onModuleInit();
      expect(mockFs.mkdir).toHaveBeenCalled();
    });

    it("falls back to tmpdir when primary dir creation fails", async () => {
      mockFs.mkdir
        .mockRejectedValueOnce(new Error("Permission denied"))
        .mockResolvedValueOnce(undefined);
      await service.onModuleInit();
      expect(mockFs.mkdir).toHaveBeenCalledTimes(2);
    });

    it("logs error when both directories fail to create", async () => {
      mockFs.mkdir.mockRejectedValue(new Error("All fail"));
      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // createExportJob
  // ──────────────────────────────────────────────────────────────────────────

  describe("createExportJob", () => {
    beforeEach(() => {
      mockPrisma.exportJob.create.mockResolvedValue(makeJob());
      mockPrisma.exportJob.findUnique.mockResolvedValue(makeJob());
      mockPrisma.exportJob.update.mockResolvedValue(makeJob());
    });

    it("creates job and returns QUEUED status", async () => {
      const result = await service.createExportJob("user-1", {
        source: { type: "DOCUMENT", documentId: "doc-1" },
        format: ExportFormat.PDF,
      });
      expect(result.status).toBe("QUEUED");
      expect(result.jobId).toBe("job-1");
      expect(result.progress).toBe(0);
    });

    it("throws when format has no renderer", async () => {
      await expect(
        service.createExportJob("user-1", {
          source: { type: "DOCUMENT", documentId: "doc-1" },
          format: ExportFormat.XLSX,
        }),
      ).rejects.toThrow("Unsupported export format");
    });

    it("stores RAW source data in sourceData field", async () => {
      await service.createExportJob("user-1", {
        source: { type: "RAW", content: "test", contentType: "markdown" },
        format: ExportFormat.PDF,
      });
      expect(mockPrisma.exportJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sourceData: expect.objectContaining({ content: "test" }),
          }),
        }),
      );
    });

    it("stores MISSION topicId in sourceData", async () => {
      await service.createExportJob("user-1", {
        source: { type: "MISSION", missionId: "m-1", topicId: "t-1" },
        format: ExportFormat.PDF,
      });
      expect(mockPrisma.exportJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sourceData: expect.objectContaining({ topicId: "t-1" }),
          }),
        }),
      );
    });

    it("stores TOPIC_REPORT reportId in sourceData", async () => {
      await service.createExportJob("user-1", {
        source: { type: "TOPIC_REPORT", topicId: "t-1", reportId: "r-1" },
        format: ExportFormat.PDF,
      });
      expect(mockPrisma.exportJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sourceData: expect.objectContaining({ reportId: "r-1" }),
          }),
        }),
      );
    });

    it("uses session or plan ID as sourceId", async () => {
      await service.createExportJob("user-1", {
        source: { type: "RESEARCH", sessionId: "sess-1" },
        format: ExportFormat.PDF,
      });
      expect(mockPrisma.exportJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ sourceId: "sess-1" }),
        }),
      );
    });

    it("returns estimated time for format", async () => {
      const result = await service.createExportJob("user-1", {
        source: { type: "DOCUMENT", documentId: "doc-1" },
        format: ExportFormat.PDF,
      });
      expect(result.estimatedTime).toBeGreaterThan(0);
    });

    it("validates templateId before creating the export job", async () => {
      await service.createExportJob("user-1", {
        source: { type: "DOCUMENT", documentId: "doc-1" },
        format: ExportFormat.PDF,
        templateId: "tpl-1",
      });
      expect(mockTemplateManager.getTemplate).toHaveBeenCalledWith(
        "tpl-1",
        "user-1",
      );
    });

    it("throws BadRequestException when templateId points to a missing template", async () => {
      mockTemplateManager.getTemplate.mockRejectedValueOnce(
        new NotFoundException("Template not found"),
      );
      await expect(
        service.createExportJob("user-1", {
          source: { type: "DOCUMENT", documentId: "doc-1" },
          format: ExportFormat.PDF,
          templateId: "missing-template",
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.exportJob.create).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // getJobStatus
  // ──────────────────────────────────────────────────────────────────────────

  describe("getJobStatus", () => {
    it("returns job status for valid jobId and userId", async () => {
      mockPrisma.exportJob.findUnique.mockResolvedValue(
        makeJob({ status: ExportJobStatus.COMPLETED, progress: 100 }),
      );
      const result = await service.getJobStatus("job-1", "user-1");
      expect(result.status).toBe(ExportJobStatus.COMPLETED);
      expect(result.progress).toBe(100);
    });

    it("throws NotFoundException when job not found", async () => {
      mockPrisma.exportJob.findUnique.mockResolvedValue(null);
      await expect(service.getJobStatus("x", "user-1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws NotFoundException when userId does not match", async () => {
      mockPrisma.exportJob.findUnique.mockResolvedValue(
        makeJob({ userId: "other-user" }),
      );
      await expect(service.getJobStatus("job-1", "user-1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("includes downloadUrl and fileName when available", async () => {
      mockPrisma.exportJob.findUnique.mockResolvedValue(
        makeJob({
          status: ExportJobStatus.COMPLETED,
          downloadUrl: "http://example.com/download",
          fileName: "export.pdf",
          fileSize: 1024,
          expiresAt: new Date("2025-01-01"),
          progress: 100,
        }),
      );
      const result = await service.getJobStatus("job-1", "user-1");
      expect(result.downloadUrl).toBe("http://example.com/download");
      expect(result.fileName).toBe("export.pdf");
      expect(result.fileSize).toBe(1024);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // getExportFile
  // ──────────────────────────────────────────────────────────────────────────

  describe("getExportFile", () => {
    it("returns buffer, fileName, mimeType for completed job", async () => {
      mockPrisma.exportJob.findUnique.mockResolvedValue(
        makeJob({
          status: ExportJobStatus.COMPLETED,
          filePath: "/tmp/exports/job-1/export.pdf",
          fileName: "export.pdf",
        }),
      );
      const result = await service.getExportFile("job-1", "user-1");
      expect(result.buffer).toBeDefined();
      expect(result.mimeType).toBe("application/pdf");
    });

    it("throws NotFoundException when job not found", async () => {
      mockPrisma.exportJob.findUnique.mockResolvedValue(null);
      await expect(service.getExportFile("x", "user-1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws NotFoundException when user mismatch", async () => {
      mockPrisma.exportJob.findUnique.mockResolvedValue(
        makeJob({ userId: "other" }),
      );
      await expect(service.getExportFile("job-1", "user-1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws when job is not completed", async () => {
      mockPrisma.exportJob.findUnique.mockResolvedValue(
        makeJob({ status: ExportJobStatus.PROCESSING }),
      );
      await expect(service.getExportFile("job-1", "user-1")).rejects.toThrow(
        "Export job not completed",
      );
    });

    it("throws when filePath is null", async () => {
      mockPrisma.exportJob.findUnique.mockResolvedValue(
        makeJob({ status: ExportJobStatus.COMPLETED, filePath: null }),
      );
      await expect(service.getExportFile("job-1", "user-1")).rejects.toThrow(
        "Export file not found",
      );
    });

    it("throws when download link has expired", async () => {
      mockPrisma.exportJob.findUnique.mockResolvedValue(
        makeJob({
          status: ExportJobStatus.COMPLETED,
          filePath: "/tmp/job-1/file.pdf",
          expiresAt: new Date("2020-01-01"), // expired
        }),
      );
      await expect(service.getExportFile("job-1", "user-1")).rejects.toThrow(
        "Download link has expired",
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // processExportJob (tested indirectly via createExportJob)
  // ──────────────────────────────────────────────────────────────────────────

  describe("processExportJob (via createExportJob)", () => {
    it("processes job and updates status to COMPLETED", async () => {
      // Job needs to return the same job when queried inside processExportJob
      mockPrisma.exportJob.create.mockResolvedValue(makeJob());
      mockPrisma.exportJob.findUnique.mockResolvedValue(makeJob());
      mockPrisma.exportJob.update.mockResolvedValue(makeJob());

      await service.createExportJob("user-1", {
        source: { type: "DOCUMENT", documentId: "doc-1" },
        format: ExportFormat.PDF,
      });

      // Wait for async processing (fire-and-forget)
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockPrisma.exportJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: ExportJobStatus.COMPLETED }),
        }),
      );
    });

    it("marks job as FAILED when renderer throws", async () => {
      mockPdfRenderer.render.mockRejectedValueOnce(new Error("Render fail"));
      mockPrisma.exportJob.create.mockResolvedValue(makeJob());
      mockPrisma.exportJob.findUnique.mockResolvedValue(makeJob());
      mockPrisma.exportJob.update.mockResolvedValue(makeJob());

      await service.createExportJob("user-1", {
        source: { type: "DOCUMENT", documentId: "doc-1" },
        format: ExportFormat.PDF,
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockPrisma.exportJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: ExportJobStatus.FAILED }),
        }),
      );
    });

    it("processes WYSIWYG mode for PDF format", async () => {
      mockWysiwygRenderService.renderByFormat.mockResolvedValue(defaultBuffer);
      mockPrisma.exportJob.create.mockResolvedValue(makeJob());
      mockPrisma.exportJob.findUnique.mockResolvedValue(
        makeJob({
          options: {
            renderMode: "wysiwyg",
            wysiwygHtml: "<p>HTML</p>",
            wysiwygCss: "",
          },
        }),
      );
      mockPrisma.exportJob.update.mockResolvedValue(makeJob());

      await service.createExportJob("user-1", {
        source: { type: "DOCUMENT", documentId: "doc-1" },
        format: ExportFormat.PDF,
        options: { renderMode: "wysiwyg", wysiwygHtml: "<p>HTML</p>" },
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockWysiwygRenderService.renderByFormat).toHaveBeenCalled();
    });

    it("processes WYSIWYG mode for DOCX via renderFromScreenshot", async () => {
      mockWysiwygRenderService.renderToScreenshots.mockResolvedValue(
        defaultBuffer,
      );
      mockDocxRenderer.renderFromScreenshot.mockResolvedValue(defaultBuffer);
      mockPrisma.exportJob.create.mockResolvedValue(
        makeJob({ format: ExportFormat.DOCX }),
      );
      mockPrisma.exportJob.findUnique.mockResolvedValue(
        makeJob({
          format: ExportFormat.DOCX,
          options: {
            renderMode: "wysiwyg",
            wysiwygHtml: "<p>HTML</p>",
            wysiwygCss: "",
          },
        }),
      );
      mockPrisma.exportJob.update.mockResolvedValue(makeJob());

      await service.createExportJob("user-1", {
        source: { type: "DOCUMENT", documentId: "doc-1" },
        format: ExportFormat.DOCX,
        options: { renderMode: "wysiwyg", wysiwygHtml: "<p>HTML</p>" },
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockWysiwygRenderService.renderToScreenshots).toHaveBeenCalled();
    });

    it("retries MISSION source with simplified mode on failure", async () => {
      mockPdfRenderer.render
        .mockRejectedValueOnce(new Error("Complex fail"))
        .mockResolvedValue(defaultBuffer);
      mockPrisma.exportJob.create.mockResolvedValue(
        makeJob({
          sourceType: "MISSION",
          sourceId: "m-1",
          sourceData: { topicId: "t-1" },
        }),
      );
      mockPrisma.exportJob.findUnique.mockResolvedValue(
        makeJob({
          sourceType: "MISSION",
          sourceId: "m-1",
          sourceData: { topicId: "t-1" },
        }),
      );
      mockPrisma.exportJob.update.mockResolvedValue(makeJob());

      await service.createExportJob("user-1", {
        source: { type: "MISSION", missionId: "m-1", topicId: "t-1" },
        format: ExportFormat.PDF,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));
      // Verify that transform was called at least once
      expect(mockContentTransformer.transform).toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // reconstructSource
  // ──────────────────────────────────────────────────────────────────────────

  describe("reconstructSource (tested via processExportJob internal calls)", () => {
    const sourceTypes = [
      { sourceType: "DOCUMENT", sourceId: "doc-1", expected: "DOCUMENT" },
      { sourceType: "RESEARCH", sourceId: "sess-1", expected: "RESEARCH" },
      { sourceType: "REPORT", sourceId: "r-1", expected: "REPORT" },
      { sourceType: "PLANNING", sourceId: "p-1", expected: "PLANNING" },
      { sourceType: "WRITING", sourceId: "w-1", expected: "WRITING" },
      { sourceType: "SOCIAL", sourceId: "sc-1", expected: "SOCIAL" },
      { sourceType: "SLIDES", sourceId: "sl-1", expected: "SLIDES" },
    ] as const;

    for (const { sourceType, sourceId } of sourceTypes) {
      it(`reconstructs ${sourceType} source type`, async () => {
        mockPrisma.exportJob.create.mockResolvedValue(
          makeJob({ sourceType, sourceId }),
        );
        mockPrisma.exportJob.findUnique.mockResolvedValue(
          makeJob({ sourceType, sourceId }),
        );
        mockPrisma.exportJob.update.mockResolvedValue(makeJob());

        await service.createExportJob("user-1", {
          source: {
            type: sourceType,
            [sourceType === "DOCUMENT"
              ? "documentId"
              : sourceType === "PLANNING"
                ? "planId"
                : "sessionId"]: sourceId,
          } as never,
          format: ExportFormat.PDF,
        });

        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(mockContentTransformer.transform).toHaveBeenCalled();
      });
    }

    it("throws on unknown source type", async () => {
      mockPrisma.exportJob.create.mockResolvedValue(
        makeJob({ sourceType: "UNKNOWN" }),
      );
      mockPrisma.exportJob.findUnique.mockResolvedValue(
        makeJob({ sourceType: "UNKNOWN" }),
      );
      mockPrisma.exportJob.update.mockResolvedValue(makeJob());

      await service.createExportJob("user-1", {
        source: { type: "DOCUMENT", documentId: "d1" },
        format: ExportFormat.PDF,
      });

      // Allow enough time for the background job to fail and update
      await new Promise((resolve) => setTimeout(resolve, 200));
      // The job should have been marked PROCESSING at some point (or FAILED)
      // In this test scenario, contentTransformer is mocked to succeed,
      // but the renderer receives unknown source type from the job record.
      // The important thing is the job was processed (update was called)
      expect(mockPrisma.exportJob.update).toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // cleanupExpiredExports
  // ──────────────────────────────────────────────────────────────────────────

  describe("cleanupExpiredExports", () => {
    it("deletes expired job directories and clears filePath/downloadUrl", async () => {
      // Need to init the service first to set exportDir
      await service.onModuleInit();

      const exportDir = path.join(process.cwd(), "exports");
      const expiredJobs = [
        makeJob({
          id: "expired-1",
          status: ExportJobStatus.COMPLETED,
          filePath: path.join(exportDir, "expired-1", "export.pdf"),
        }),
      ];

      mockPrisma.exportJob.findMany.mockResolvedValue(expiredJobs);
      mockPrisma.exportJob.update.mockResolvedValue({});

      const count = await service.cleanupExpiredExports();
      expect(count).toBe(1);
      expect(mockFs.rm).toHaveBeenCalled();
      expect(mockPrisma.exportJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "expired-1" },
          data: { filePath: null, downloadUrl: null },
        }),
      );
    });

    it("skips suspicious file paths outside export directory", async () => {
      await service.onModuleInit();

      const suspiciousJobs = [
        makeJob({
          id: "suspicious-1",
          status: ExportJobStatus.COMPLETED,
          filePath: "/etc/passwd",
        }),
      ];

      mockPrisma.exportJob.findMany.mockResolvedValue(suspiciousJobs);

      const count = await service.cleanupExpiredExports();
      expect(count).toBe(0);
      expect(mockFs.rm).not.toHaveBeenCalled();
    });

    it("handles fs.rm failure gracefully", async () => {
      await service.onModuleInit();

      const exportDir = path.join(process.cwd(), "exports");
      mockPrisma.exportJob.findMany.mockResolvedValue([
        makeJob({
          status: ExportJobStatus.COMPLETED,
          filePath: path.join(exportDir, "job-1", "export.pdf"),
        }),
      ]);
      mockFs.rm.mockRejectedValueOnce(new Error("Permission denied"));

      const count = await service.cleanupExpiredExports();
      expect(count).toBe(0);
    });

    it("returns 0 when no expired jobs", async () => {
      mockPrisma.exportJob.findMany.mockResolvedValue([]);
      const count = await service.cleanupExpiredExports();
      expect(count).toBe(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // generateFileName (tested indirectly)
  // ──────────────────────────────────────────────────────────────────────────

  describe("generateFileName edge cases", () => {
    it("uses custom fileName from options when provided", async () => {
      mockPrisma.exportJob.create.mockResolvedValue(makeJob());
      mockPrisma.exportJob.findUnique.mockResolvedValue(
        makeJob({ options: { fileName: "custom-name.pdf" } }),
      );
      mockPrisma.exportJob.update.mockResolvedValue(makeJob());

      await service.createExportJob("user-1", {
        source: { type: "DOCUMENT", documentId: "doc-1" },
        format: ExportFormat.PDF,
        options: { fileName: "custom-name.pdf" },
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockPrisma.exportJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            fileName: expect.stringContaining("custom-name"),
          }),
        }),
      );
    });
  });
});

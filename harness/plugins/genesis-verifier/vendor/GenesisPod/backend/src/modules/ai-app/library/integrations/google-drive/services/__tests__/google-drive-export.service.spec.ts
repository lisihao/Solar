/**
 * GoogleDriveExportService unit tests
 *
 * Covers:
 * - exportResources: no Google Drive connection → throws BadRequestException
 * - exportResources: successful single-resource export
 * - exportResources: partial failure (one resource fails, others succeed)
 * - exportResources: createFolders=true creates a folder before exporting
 * - exportResources: createFolders=true, folder creation fails gracefully
 * - generateExportFile format dispatch: ORIGINAL, MARKDOWN, TXT, HTML
 * - generateExportFile: PDF / DOCX throw BadRequestException
 */

import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, Logger } from "@nestjs/common";

import { GoogleDriveExportService } from "../google-drive-export.service";
import { GoogleDriveFileService } from "../google-drive-file.service";
import { PrismaService } from "../../../../../../../common/prisma/prisma.service";
import { ExportResourcesDto, ExportFormat } from "../../dto/google-drive.dto";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockConnection = { id: "conn-1", userId: "user-1" };

const mockResource = {
  title: "Test Article",
  content: "# Heading\n\nBody content here.",
  abstract: "A short abstract.",
  sourceUrl: "https://example.com/article",
  tags: ["ai", "research"],
};

const mockUploadedFile = { id: "gdrive-file-1", name: "Test_Article.md" };

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("GoogleDriveExportService", () => {
  let service: GoogleDriveExportService;

  let prisma: {
    googleDriveConnection: {
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    googleDriveSyncHistory: {
      create: jest.Mock;
      update: jest.Mock;
    };
    resource: {
      findFirst: jest.Mock;
    };
  };

  let fileService: jest.Mocked<
    Pick<GoogleDriveFileService, "createFolder" | "uploadFile">
  >;

  beforeEach(async () => {
    prisma = {
      googleDriveConnection: {
        findFirst: jest.fn().mockResolvedValue(mockConnection),
        update: jest.fn().mockResolvedValue(mockConnection),
      },
      googleDriveSyncHistory: {
        create: jest.fn().mockResolvedValue({ id: "hist-1" }),
        update: jest.fn().mockResolvedValue(undefined),
      },
      resource: {
        findFirst: jest.fn().mockResolvedValue(mockResource),
      },
    };

    fileService = {
      createFolder: jest
        .fn()
        .mockResolvedValue({ id: "folder-1", name: "Exports" }),
      uploadFile: jest.fn().mockResolvedValue(mockUploadedFile),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoogleDriveExportService,
        { provide: PrismaService, useValue: prisma },
        { provide: GoogleDriveFileService, useValue: fileService },
      ],
    }).compile();

    service = module.get<GoogleDriveExportService>(GoogleDriveExportService);

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // No connection
  // -------------------------------------------------------------------------

  describe("when Google Drive is not connected", () => {
    it("throws BadRequestException when no connection is found", async () => {
      prisma.googleDriveConnection.findFirst.mockResolvedValue(null);

      const dto: ExportResourcesDto = { resourceIds: ["res-1"] };

      await expect(service.exportResources("user-1", dto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Successful export
  // -------------------------------------------------------------------------

  describe("successful export", () => {
    it("exports a single resource and returns correct counts", async () => {
      const dto: ExportResourcesDto = {
        resourceIds: ["res-1"],
        format: ExportFormat.MARKDOWN,
      };

      const result = await service.exportResources("user-1", dto);

      expect(result.totalResources).toBe(1);
      expect(result.exported).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.fileIds).toContain(mockUploadedFile.id);
      expect(result.errors).toHaveLength(0);
    });

    it("calls fileService.uploadFile with the correct userId", async () => {
      const dto: ExportResourcesDto = {
        resourceIds: ["res-1"],
        format: ExportFormat.MARKDOWN,
      };

      await service.exportResources("user-1", dto);

      expect(fileService.uploadFile).toHaveBeenCalledWith(
        "user-1",
        undefined, // no targetFolderId provided
        expect.any(String),
        expect.any(Buffer),
        expect.any(String),
      );
    });

    it("updates the connection lastSyncAt after export", async () => {
      const dto: ExportResourcesDto = { resourceIds: ["res-1"] };

      await service.exportResources("user-1", dto);

      expect(prisma.googleDriveConnection.update).toHaveBeenCalledWith({
        where: { id: mockConnection.id },
        data: { lastSyncAt: expect.any(Date) },
      });
    });

    it("creates sync history records for each resource", async () => {
      const dto: ExportResourcesDto = { resourceIds: ["res-1", "res-2"] };

      await service.exportResources("user-1", dto);

      expect(prisma.googleDriveSyncHistory.create).toHaveBeenCalledTimes(2);
    });

    it("marks sync history as SUCCESS for each exported resource", async () => {
      const dto: ExportResourcesDto = { resourceIds: ["res-1"] };

      await service.exportResources("user-1", dto);

      expect(prisma.googleDriveSyncHistory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "SUCCESS" }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // createFolders option
  // -------------------------------------------------------------------------

  describe("createFolders option", () => {
    it("creates an export folder when createFolders=true and no folderId given", async () => {
      const dto: ExportResourcesDto = {
        resourceIds: ["res-1"],
        createFolders: true,
      };

      await service.exportResources("user-1", dto);

      expect(fileService.createFolder).toHaveBeenCalled();
    });

    it("does not create a folder when folderId is already provided", async () => {
      const dto: ExportResourcesDto = {
        resourceIds: ["res-1"],
        createFolders: true,
        folderId: "existing-folder",
      };

      await service.exportResources("user-1", dto);

      expect(fileService.createFolder).not.toHaveBeenCalled();
    });

    it("continues export gracefully when folder creation fails", async () => {
      fileService.createFolder.mockRejectedValue(
        new Error("Drive quota exceeded"),
      );

      const dto: ExportResourcesDto = {
        resourceIds: ["res-1"],
        createFolders: true,
      };

      // Should not throw — folder creation failure is a soft warning
      const result = await service.exportResources("user-1", dto);
      expect(result.exported).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Partial failure
  // -------------------------------------------------------------------------

  describe("partial failure", () => {
    it("counts failed resources when individual resource export throws", async () => {
      // First resource succeeds, second fails
      prisma.resource.findFirst
        .mockResolvedValueOnce(mockResource)
        .mockResolvedValueOnce(null); // triggers BadRequestException

      const dto: ExportResourcesDto = {
        resourceIds: ["res-1", "res-2"],
        format: ExportFormat.MARKDOWN,
      };

      const result = await service.exportResources("user-1", dto);

      expect(result.exported).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].resourceId).toBe("res-2");
    });

    it("marks failed sync history records as FAILED", async () => {
      prisma.resource.findFirst.mockResolvedValue(null); // all fail

      const dto: ExportResourcesDto = { resourceIds: ["res-bad"] };

      await service.exportResources("user-1", dto);

      expect(prisma.googleDriveSyncHistory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "FAILED" }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Export format dispatch
  // -------------------------------------------------------------------------

  describe("export format dispatch", () => {
    const formatsAndExtensions: Array<[ExportFormat, string, string]> = [
      [ExportFormat.ORIGINAL, ".txt", "text/plain"],
      [ExportFormat.MARKDOWN, ".md", "text/markdown"],
      [ExportFormat.TXT, ".txt", "text/plain"],
      [ExportFormat.HTML, ".html", "text/html"],
    ];

    it.each(formatsAndExtensions)(
      "uploads a file with correct extension and mimeType for format=%s",
      async (format, ext, mimeType) => {
        const dto: ExportResourcesDto = { resourceIds: ["res-1"], format };

        await service.exportResources("user-1", dto);

        const [, , fileName, , uploadedMimeType] =
          fileService.uploadFile.mock.calls[0];
        expect(fileName).toMatch(new RegExp(`\\${ext}$`));
        expect(uploadedMimeType).toBe(mimeType);
      },
    );

    it("throws BadRequestException for PDF format", async () => {
      prisma.resource.findFirst.mockResolvedValue(mockResource);
      const dto: ExportResourcesDto = {
        resourceIds: ["res-1"],
        format: ExportFormat.PDF,
      };

      const result = await service.exportResources("user-1", dto);

      // PDF throws inside the per-resource try/catch, so it becomes a failure
      expect(result.failed).toBe(1);
      expect(result.errors[0].error).toMatch(/PDF/i);
    });

    it("throws BadRequestException for DOCX format", async () => {
      const dto: ExportResourcesDto = {
        resourceIds: ["res-1"],
        format: ExportFormat.DOCX,
      };

      const result = await service.exportResources("user-1", dto);

      expect(result.failed).toBe(1);
      expect(result.errors[0].error).toMatch(/DOCX/i);
    });
  });

  // -------------------------------------------------------------------------
  // fileNamePrefix option
  // -------------------------------------------------------------------------

  describe("fileNamePrefix option", () => {
    it("prepends the prefix to the uploaded file name", async () => {
      const dto: ExportResourcesDto = {
        resourceIds: ["res-1"],
        format: ExportFormat.MARKDOWN,
        fileNamePrefix: "2026-03-",
      };

      await service.exportResources("user-1", dto);

      const [, , fileName] = fileService.uploadFile.mock.calls[0];
      expect(fileName).toMatch(/^2026-03-/);
    });
  });
});

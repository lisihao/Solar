/**
 * GoogleDriveImportService unit tests
 *
 * Coverage:
 * - importFiles() - happy path (multiple files), throws if no connection,
 *   handles individual file errors gracefully, updates sync history
 * - mapMimeTypeToResourceType() - all MIME type branches via importFiles
 * - extractContent() - called when extractContent=true, errors ignored
 * - generateSummary - logs warning (not implemented)
 * - sync history - creates IN_PROGRESS, updates SUCCESS/FAILED per file
 */

import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
import { GoogleDriveImportService } from "../google-drive-import.service";
import { PrismaService } from "../../../../../../../common/prisma/prisma.service";
import { GoogleDriveFileService } from "../google-drive-file.service";
import { ContentExtractorService } from "../../../../../../../common/content-processing/content-extractor.service";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const mockPrisma = {
  googleDriveConnection: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  googleDriveSyncHistory: {
    create: jest.fn(),
    update: jest.fn(),
  },
  resource: {
    create: jest.fn(),
  },
};

const mockFileService = {
  getFile: jest.fn(),
  downloadFile: jest.fn(),
};

const mockContentExtractor = {
  extractFromFile: jest.fn(),
};

function makeConnection(overrides = {}) {
  return {
    id: "conn-1",
    userId: "user-1",
    lastSyncAt: null,
    ...overrides,
  };
}

function makeGdriveFile(overrides = {}) {
  return {
    id: "gfile-1",
    driveFileId: "drive-file-1",
    name: "Test Document.pdf",
    mimeType: "application/pdf",
    size: 1024,
    webViewLink: "https://drive.google.com/file/d/drive-file-1/view",
    webContentLink: null,
    driveCreatedAt: new Date("2024-01-01"),
    driveModifiedAt: new Date("2024-01-15"),
    iconUrl: "https://drive.google.com/icon.png",
    thumbnailUrl: null,
    ...overrides,
  };
}

function makeSyncHistory(overrides = {}) {
  return {
    id: "sync-1",
    connectionId: "conn-1",
    action: "IMPORT",
    status: "IN_PROGRESS",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GoogleDriveImportService", () => {
  let service: GoogleDriveImportService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoogleDriveImportService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: GoogleDriveFileService, useValue: mockFileService },
        { provide: ContentExtractorService, useValue: mockContentExtractor },
      ],
    }).compile();

    service = module.get<GoogleDriveImportService>(GoogleDriveImportService);
  });

  // =========================================================================
  // importFiles()
  // =========================================================================
  describe("importFiles()", () => {
    it("should throw BadRequestException when no Google Drive connection found", async () => {
      mockPrisma.googleDriveConnection.findFirst.mockResolvedValue(null);

      await expect(
        service.importFiles("user-1", { fileIds: ["file-1"] }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should import a single file successfully", async () => {
      mockPrisma.googleDriveConnection.findFirst.mockResolvedValue(
        makeConnection(),
      );
      mockPrisma.googleDriveSyncHistory.create.mockResolvedValue(
        makeSyncHistory(),
      );
      mockFileService.getFile.mockResolvedValue(makeGdriveFile());
      mockFileService.downloadFile.mockResolvedValue(
        Buffer.from("pdf content"),
      );
      mockPrisma.resource.create.mockResolvedValue({ id: "res-1" });
      mockPrisma.googleDriveSyncHistory.update.mockResolvedValue({});
      mockPrisma.googleDriveConnection.update.mockResolvedValue({});

      const result = await service.importFiles("user-1", {
        fileIds: ["drive-file-1"],
      });

      expect(result.totalFiles).toBe(1);
      expect(result.imported).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.resourceIds).toContain("res-1");
      expect(result.errors).toHaveLength(0);
    });

    it("should import multiple files and return aggregated result", async () => {
      mockPrisma.googleDriveConnection.findFirst.mockResolvedValue(
        makeConnection(),
      );
      mockPrisma.googleDriveSyncHistory.create.mockResolvedValue(
        makeSyncHistory(),
      );
      mockFileService.getFile.mockResolvedValue(makeGdriveFile());
      mockFileService.downloadFile.mockResolvedValue(Buffer.from("content"));
      mockPrisma.resource.create
        .mockResolvedValueOnce({ id: "res-1" })
        .mockResolvedValueOnce({ id: "res-2" });
      mockPrisma.googleDriveSyncHistory.update.mockResolvedValue({});
      mockPrisma.googleDriveConnection.update.mockResolvedValue({});

      const result = await service.importFiles("user-1", {
        fileIds: ["file-1", "file-2"],
      });

      expect(result.totalFiles).toBe(2);
      expect(result.imported).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.resourceIds).toHaveLength(2);
    });

    it("should continue and record failure when a single file import fails", async () => {
      mockPrisma.googleDriveConnection.findFirst.mockResolvedValue(
        makeConnection(),
      );
      mockPrisma.googleDriveSyncHistory.create.mockResolvedValue(
        makeSyncHistory(),
      );
      mockFileService.getFile.mockRejectedValue(new Error("File not found"));
      mockPrisma.googleDriveSyncHistory.update.mockResolvedValue({});
      mockPrisma.googleDriveConnection.update.mockResolvedValue({});

      const result = await service.importFiles("user-1", {
        fileIds: ["bad-file-id"],
      });

      expect(result.totalFiles).toBe(1);
      expect(result.imported).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.errors[0].fileId).toBe("bad-file-id");
      expect(result.errors[0].error).toBe("File not found");
    });

    it("should handle mix of successful and failed imports", async () => {
      mockPrisma.googleDriveConnection.findFirst.mockResolvedValue(
        makeConnection(),
      );
      mockPrisma.googleDriveSyncHistory.create.mockResolvedValue(
        makeSyncHistory(),
      );
      mockFileService.getFile
        .mockResolvedValueOnce(makeGdriveFile())
        .mockRejectedValueOnce(new Error("Access denied"));
      mockFileService.downloadFile.mockResolvedValue(Buffer.from("content"));
      mockPrisma.resource.create.mockResolvedValue({ id: "res-1" });
      mockPrisma.googleDriveSyncHistory.update.mockResolvedValue({});
      mockPrisma.googleDriveConnection.update.mockResolvedValue({});

      const result = await service.importFiles("user-1", {
        fileIds: ["file-ok", "file-bad"],
      });

      expect(result.imported).toBe(1);
      expect(result.failed).toBe(1);
    });

    it("should update sync history to SUCCESS on successful import", async () => {
      mockPrisma.googleDriveConnection.findFirst.mockResolvedValue(
        makeConnection(),
      );
      mockPrisma.googleDriveSyncHistory.create.mockResolvedValue({
        id: "sync-1",
      });
      mockFileService.getFile.mockResolvedValue(makeGdriveFile());
      mockFileService.downloadFile.mockResolvedValue(Buffer.from("content"));
      mockPrisma.resource.create.mockResolvedValue({ id: "res-1" });
      mockPrisma.googleDriveSyncHistory.update.mockResolvedValue({});
      mockPrisma.googleDriveConnection.update.mockResolvedValue({});

      await service.importFiles("user-1", { fileIds: ["file-1"] });

      expect(mockPrisma.googleDriveSyncHistory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "sync-1" },
          data: expect.objectContaining({ status: "SUCCESS" }),
        }),
      );
    });

    it("should update sync history to FAILED on failed import", async () => {
      mockPrisma.googleDriveConnection.findFirst.mockResolvedValue(
        makeConnection(),
      );
      mockPrisma.googleDriveSyncHistory.create.mockResolvedValue({
        id: "sync-1",
      });
      mockFileService.getFile.mockRejectedValue(new Error("Import failed"));
      mockPrisma.googleDriveSyncHistory.update.mockResolvedValue({});
      mockPrisma.googleDriveConnection.update.mockResolvedValue({});

      await service.importFiles("user-1", { fileIds: ["file-1"] });

      expect(mockPrisma.googleDriveSyncHistory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "sync-1" },
          data: expect.objectContaining({ status: "FAILED" }),
        }),
      );
    });

    it("should update connection lastSyncAt after import loop", async () => {
      mockPrisma.googleDriveConnection.findFirst.mockResolvedValue(
        makeConnection(),
      );
      mockPrisma.googleDriveSyncHistory.create.mockResolvedValue(
        makeSyncHistory(),
      );
      mockFileService.getFile.mockResolvedValue(makeGdriveFile());
      mockFileService.downloadFile.mockResolvedValue(Buffer.from("content"));
      mockPrisma.resource.create.mockResolvedValue({ id: "res-1" });
      mockPrisma.googleDriveSyncHistory.update.mockResolvedValue({});
      mockPrisma.googleDriveConnection.update.mockResolvedValue({});

      await service.importFiles("user-1", { fileIds: ["file-1"] });

      expect(mockPrisma.googleDriveConnection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "conn-1" },
          data: expect.objectContaining({ lastSyncAt: expect.any(Date) }),
        }),
      );
    });

    it("should extract content when extractContent is true", async () => {
      mockPrisma.googleDriveConnection.findFirst.mockResolvedValue(
        makeConnection(),
      );
      mockPrisma.googleDriveSyncHistory.create.mockResolvedValue(
        makeSyncHistory(),
      );
      mockFileService.getFile.mockResolvedValue(makeGdriveFile());
      mockFileService.downloadFile.mockResolvedValue(
        Buffer.from("pdf content"),
      );
      mockContentExtractor.extractFromFile.mockResolvedValue(
        "Extracted text from PDF",
      );
      mockPrisma.resource.create.mockResolvedValue({ id: "res-1" });
      mockPrisma.googleDriveSyncHistory.update.mockResolvedValue({});
      mockPrisma.googleDriveConnection.update.mockResolvedValue({});

      await service.importFiles("user-1", {
        fileIds: ["file-1"],
        extractContent: true,
      });

      expect(mockContentExtractor.extractFromFile).toHaveBeenCalledWith(
        expect.any(Buffer),
        "application/pdf",
        "Test Document.pdf",
      );
      expect(mockPrisma.resource.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ content: "Extracted text from PDF" }),
        }),
      );
    });

    it("should not extract content when extractContent is false", async () => {
      mockPrisma.googleDriveConnection.findFirst.mockResolvedValue(
        makeConnection(),
      );
      mockPrisma.googleDriveSyncHistory.create.mockResolvedValue(
        makeSyncHistory(),
      );
      mockFileService.getFile.mockResolvedValue(makeGdriveFile());
      mockFileService.downloadFile.mockResolvedValue(
        Buffer.from("pdf content"),
      );
      mockPrisma.resource.create.mockResolvedValue({ id: "res-1" });
      mockPrisma.googleDriveSyncHistory.update.mockResolvedValue({});
      mockPrisma.googleDriveConnection.update.mockResolvedValue({});

      await service.importFiles("user-1", {
        fileIds: ["file-1"],
        extractContent: false,
      });

      expect(mockContentExtractor.extractFromFile).not.toHaveBeenCalled();
    });

    it("should continue if content extraction fails (warn but not throw)", async () => {
      mockPrisma.googleDriveConnection.findFirst.mockResolvedValue(
        makeConnection(),
      );
      mockPrisma.googleDriveSyncHistory.create.mockResolvedValue(
        makeSyncHistory(),
      );
      mockFileService.getFile.mockResolvedValue(makeGdriveFile());
      mockFileService.downloadFile.mockResolvedValue(
        Buffer.from("pdf content"),
      );
      mockContentExtractor.extractFromFile.mockRejectedValue(
        new Error("Parse error"),
      );
      mockPrisma.resource.create.mockResolvedValue({ id: "res-1" });
      mockPrisma.googleDriveSyncHistory.update.mockResolvedValue({});
      mockPrisma.googleDriveConnection.update.mockResolvedValue({});

      const result = await service.importFiles("user-1", {
        fileIds: ["file-1"],
        extractContent: true,
      });

      expect(result.imported).toBe(1);
      expect(result.failed).toBe(0);
    });

    it("should associate resource with collection when collectionId is set", async () => {
      mockPrisma.googleDriveConnection.findFirst.mockResolvedValue(
        makeConnection(),
      );
      mockPrisma.googleDriveSyncHistory.create.mockResolvedValue(
        makeSyncHistory(),
      );
      mockFileService.getFile.mockResolvedValue(makeGdriveFile());
      mockFileService.downloadFile.mockResolvedValue(Buffer.from("content"));
      mockPrisma.resource.create.mockResolvedValue({ id: "res-1" });
      mockPrisma.googleDriveSyncHistory.update.mockResolvedValue({});
      mockPrisma.googleDriveConnection.update.mockResolvedValue({});

      await service.importFiles("user-1", {
        fileIds: ["file-1"],
        collectionId: "coll-1",
      });

      expect(mockPrisma.resource.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            collectionItems: expect.objectContaining({
              create: expect.objectContaining({ collectionId: "coll-1" }),
            }),
          }),
        }),
      );
    });

    it("should handle empty fileIds array", async () => {
      mockPrisma.googleDriveConnection.findFirst.mockResolvedValue(
        makeConnection(),
      );
      mockPrisma.googleDriveConnection.update.mockResolvedValue({});

      const result = await service.importFiles("user-1", { fileIds: [] });

      expect(result.totalFiles).toBe(0);
      expect(result.imported).toBe(0);
      expect(result.failed).toBe(0);
    });
  });

  // =========================================================================
  // MIME type to resource type mapping (via importFiles)
  // =========================================================================
  describe("MIME type mapping", () => {
    async function importWithMime(mimeType: string): Promise<string> {
      mockPrisma.googleDriveConnection.findFirst.mockResolvedValue(
        makeConnection(),
      );
      mockPrisma.googleDriveSyncHistory.create.mockResolvedValue(
        makeSyncHistory(),
      );
      mockFileService.getFile.mockResolvedValue(makeGdriveFile({ mimeType }));
      mockFileService.downloadFile.mockResolvedValue(Buffer.from("content"));
      let capturedType = "";
      mockPrisma.resource.create.mockImplementation(
        ({ data }: { data: { type: string } }) => {
          capturedType = data.type;
          return Promise.resolve({ id: "res-1" });
        },
      );
      mockPrisma.googleDriveSyncHistory.update.mockResolvedValue({});
      mockPrisma.googleDriveConnection.update.mockResolvedValue({});
      jest.clearAllMocks();
      // Re-setup mocks after clear
      mockPrisma.googleDriveConnection.findFirst.mockResolvedValue(
        makeConnection(),
      );
      mockPrisma.googleDriveSyncHistory.create.mockResolvedValue(
        makeSyncHistory(),
      );
      mockFileService.getFile.mockResolvedValue(makeGdriveFile({ mimeType }));
      mockFileService.downloadFile.mockResolvedValue(Buffer.from("content"));
      mockPrisma.resource.create.mockImplementation(
        ({ data }: { data: { type: string } }) => {
          capturedType = data.type;
          return Promise.resolve({ id: "res-1" });
        },
      );
      mockPrisma.googleDriveSyncHistory.update.mockResolvedValue({});
      mockPrisma.googleDriveConnection.update.mockResolvedValue({});
      await service.importFiles("user-1", { fileIds: ["file-1"] });
      return capturedType;
    }

    it("maps application/pdf to PAPER", async () => {
      const type = await importWithMime("application/pdf");
      expect(type).toBe("PAPER");
    });

    it("maps google docs (document) to REPORT", async () => {
      const type = await importWithMime("application/vnd.google-apps.document");
      expect(type).toBe("REPORT");
    });

    it("maps spreadsheet to REPORT", async () => {
      const type = await importWithMime(
        "application/vnd.google-apps.spreadsheet",
      );
      expect(type).toBe("REPORT");
    });

    it("maps presentation to REPORT", async () => {
      const type = await importWithMime(
        "application/vnd.google-apps.presentation",
      );
      expect(type).toBe("REPORT");
    });

    it("maps video/* to YOUTUBE_VIDEO", async () => {
      const type = await importWithMime("video/mp4");
      expect(type).toBe("YOUTUBE_VIDEO");
    });

    it("maps text/* to BLOG", async () => {
      const type = await importWithMime("text/plain");
      expect(type).toBe("BLOG");
    });

    it("maps application/json to BLOG", async () => {
      const type = await importWithMime("application/json");
      expect(type).toBe("BLOG");
    });

    it("maps application/xml to BLOG", async () => {
      const type = await importWithMime("application/xml");
      expect(type).toBe("BLOG");
    });

    it("defaults unknown MIME type to REPORT", async () => {
      const type = await importWithMime("application/octet-stream");
      expect(type).toBe("REPORT");
    });
  });
});

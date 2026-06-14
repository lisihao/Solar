/**
 * GoogleDriveFileService - Unit Tests
 *
 * Targets uncovered branches: ~92 lines, 4.16% coverage
 * Focus: listFiles (query building, sortBy alias, folder path),
 *        getFile, downloadFile (workspace vs regular),
 *        exportGoogleWorkspaceFile (all mime types),
 *        uploadFile, createFolder
 */

import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
import { GoogleDriveFileService } from "../google-drive-file.service";
import { GoogleDriveAuthService } from "../google-drive-auth.service";

// Mock @googleapis/drive
jest.mock("@googleapis/drive", () => ({
  drive: jest.fn(),
}));

import { drive } from "@googleapis/drive";
const mockDrive = drive as jest.MockedFunction<typeof drive>;

const buildMockDriveClient = () => ({
  files: {
    list: jest.fn(),
    get: jest.fn(),
    export: jest.fn(),
    create: jest.fn(),
  },
});

const buildMockFile = (overrides: Record<string, unknown> = {}) => ({
  id: "file-1",
  name: "test.pdf",
  mimeType: "application/pdf",
  size: "1024",
  createdTime: "2024-01-01T00:00:00Z",
  modifiedTime: "2024-01-02T00:00:00Z",
  iconLink: "http://icon.url",
  thumbnailLink: "http://thumb.url",
  webViewLink: "http://view.url",
  webContentLink: "http://content.url",
  parents: ["parent-1"],
  ...overrides,
});

describe("GoogleDriveFileService", () => {
  let service: GoogleDriveFileService;
  let mockAuthService: jest.Mocked<GoogleDriveAuthService>;
  let mockDriveClient: ReturnType<typeof buildMockDriveClient>;

  beforeEach(async () => {
    mockDriveClient = buildMockDriveClient();

    mockAuthService = {
      getAuthenticatedClient: jest.fn().mockResolvedValue({ oauth2: "client" }),
    } as unknown as jest.Mocked<GoogleDriveAuthService>;

    mockDrive.mockReturnValue(mockDriveClient as never);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoogleDriveFileService,
        { provide: GoogleDriveAuthService, useValue: mockAuthService },
      ],
    })
      .setLogger({
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
        verbose: jest.fn(),
      })
      .compile();

    service = module.get<GoogleDriveFileService>(GoogleDriveFileService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================
  // listFiles
  // ============================================================

  describe("listFiles", () => {
    it("should list files in root directory by default", async () => {
      mockDriveClient.files.list.mockResolvedValue({
        data: { files: [buildMockFile()], nextPageToken: undefined },
      });

      const result = await service.listFiles("user-1", {});

      expect(result.files).toHaveLength(1);
      expect(result.files[0].id).toBe("file-1");
      expect(result.pagination.page).toBe(1);
    });

    it("should list files in specific folder when folderId provided", async () => {
      mockDriveClient.files.list.mockResolvedValue({
        data: { files: [], nextPageToken: undefined },
      });
      // buildFolderPath needs a files.get mock for folderId != root
      mockDriveClient.files.get.mockResolvedValue({
        data: buildMockFile({ id: "folder-1", name: "My Folder", parents: [] }),
      });

      await service.listFiles("user-1", { folderId: "folder-1" });

      const query = mockDriveClient.files.list.mock.calls[0][0] as {
        q: string;
      };
      expect(query.q).toContain("folder-1");
    });

    it("should use parentId alias when folderId is not provided", async () => {
      mockDriveClient.files.list.mockResolvedValue({
        data: { files: [], nextPageToken: undefined },
      });
      mockDriveClient.files.get.mockResolvedValue({
        data: buildMockFile({
          id: "folder-2",
          name: "Parent Folder",
          parents: [],
        }),
      });

      await service.listFiles("user-1", { parentId: "folder-2" });

      const query = mockDriveClient.files.list.mock.calls[0][0] as {
        q: string;
      };
      expect(query.q).toContain("folder-2");
    });

    it("should build query with search term", async () => {
      mockDriveClient.files.list.mockResolvedValue({
        data: { files: [], nextPageToken: undefined },
      });

      await service.listFiles("user-1", { search: "report" });

      const query = mockDriveClient.files.list.mock.calls[0][0] as {
        q: string;
      };
      expect(query.q).toContain("name contains 'report'");
    });

    it("should pass raw search query when it contains 'contains' operator", async () => {
      mockDriveClient.files.list.mockResolvedValue({
        data: { files: [], nextPageToken: undefined },
      });

      await service.listFiles("user-1", { search: "name contains 'doc'" });

      const query = mockDriveClient.files.list.mock.calls[0][0] as {
        q: string;
      };
      expect(query.q).toContain("name contains 'doc'");
    });

    it("should build orderBy from sortBy + sortOrder", async () => {
      mockDriveClient.files.list.mockResolvedValue({
        data: { files: [], nextPageToken: undefined },
      });

      await service.listFiles("user-1", { sortBy: "name", sortOrder: "asc" });

      const call = mockDriveClient.files.list.mock.calls[0][0] as {
        orderBy: string;
      };
      expect(call.orderBy).toBe("name");
    });

    it("should build orderBy with desc when sortOrder is not asc", async () => {
      mockDriveClient.files.list.mockResolvedValue({
        data: { files: [], nextPageToken: undefined },
      });

      await service.listFiles("user-1", {
        sortBy: "createdTime",
        sortOrder: "desc",
      });

      const call = mockDriveClient.files.list.mock.calls[0][0] as {
        orderBy: string;
      };
      expect(call.orderBy).toBe("createdTime desc");
    });

    it("should use limit alias for pageSize", async () => {
      mockDriveClient.files.list.mockResolvedValue({
        data: { files: [], nextPageToken: undefined },
      });

      await service.listFiles("user-1", { limit: 50 });

      const call = mockDriveClient.files.list.mock.calls[0][0] as {
        pageSize: number;
      };
      expect(call.pageSize).toBe(50);
    });

    it("should include nextPageToken in result when present", async () => {
      mockDriveClient.files.list.mockResolvedValue({
        data: { files: [], nextPageToken: "token-abc" },
      });

      const result = await service.listFiles("user-1", {});

      expect(result.nextPageToken).toBe("token-abc");
      expect(result.pagination.totalPages).toBe(2);
    });

    it("should identify folders by mimeType", async () => {
      mockDriveClient.files.list.mockResolvedValue({
        data: {
          files: [
            buildMockFile({ mimeType: "application/vnd.google-apps.folder" }),
          ],
          nextPageToken: undefined,
        },
      });

      const result = await service.listFiles("user-1", {});

      expect(result.files[0].isFolder).toBe(true);
    });

    it("should throw BadRequestException when Drive API fails", async () => {
      mockDriveClient.files.list.mockRejectedValue(new Error("API error"));

      await expect(service.listFiles("user-1", {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should not append folder path for root folder", async () => {
      mockDriveClient.files.list.mockResolvedValue({
        data: { files: [], nextPageToken: undefined },
      });

      const result = await service.listFiles("user-1", { folderId: "root" });

      expect(result.folderPath).toBeUndefined();
    });
  });

  // ============================================================
  // getFile
  // ============================================================

  describe("getFile", () => {
    it("should return file info successfully", async () => {
      mockDriveClient.files.get.mockResolvedValue({
        data: buildMockFile(),
      });

      const result = await service.getFile("user-1", "file-1");

      expect(result.id).toBe("file-1");
      expect(result.name).toBe("test.pdf");
      expect(result.isFolder).toBe(false);
      expect(result.syncStatus).toBe("SUCCESS");
    });

    it("should return size 0 when file has no size field", async () => {
      mockDriveClient.files.get.mockResolvedValue({
        data: buildMockFile({ size: undefined }),
      });

      const result = await service.getFile("user-1", "file-1");

      expect(result.size).toBe(0);
    });

    it("should throw BadRequestException when Drive API fails", async () => {
      mockDriveClient.files.get.mockRejectedValue(new Error("Not found"));

      await expect(service.getFile("user-1", "missing-file")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should return null for missing optional fields", async () => {
      mockDriveClient.files.get.mockResolvedValue({
        data: buildMockFile({
          iconLink: undefined,
          thumbnailLink: undefined,
          webContentLink: undefined,
          parents: undefined,
        }),
      });

      const result = await service.getFile("user-1", "file-1");

      expect(result.iconUrl).toBeNull();
      expect(result.thumbnailUrl).toBeNull();
      expect(result.webContentLink).toBeNull();
      expect(result.parentId).toBeNull();
    });
  });

  // ============================================================
  // downloadFile
  // ============================================================

  describe("downloadFile", () => {
    it("should download regular file directly", async () => {
      mockDriveClient.files.get
        .mockResolvedValueOnce({ data: buildMockFile() }) // getFile call
        .mockResolvedValueOnce({ data: Buffer.from("file content") }); // alt=media call

      const result = await service.downloadFile("user-1", "file-1");

      expect(Buffer.isBuffer(result)).toBe(true);
    });

    it("should export Google Docs file as DOCX", async () => {
      mockDriveClient.files.get.mockResolvedValue({
        data: buildMockFile({
          mimeType: "application/vnd.google-apps.document",
        }),
      });
      mockDriveClient.files.export.mockResolvedValue({
        data: Buffer.from("docx content"),
      });

      const result = await service.downloadFile("user-1", "file-1");

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(mockDriveClient.files.export).toHaveBeenCalledWith(
        expect.objectContaining({
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
        expect.anything(),
      );
    });

    it("should export Google Sheets file as XLSX", async () => {
      mockDriveClient.files.get.mockResolvedValue({
        data: buildMockFile({
          mimeType: "application/vnd.google-apps.spreadsheet",
        }),
      });
      mockDriveClient.files.export.mockResolvedValue({
        data: Buffer.from("xlsx content"),
      });

      await service.downloadFile("user-1", "file-1");

      expect(mockDriveClient.files.export).toHaveBeenCalledWith(
        expect.objectContaining({
          mimeType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
        expect.anything(),
      );
    });

    it("should export Google Slides file as PPTX", async () => {
      mockDriveClient.files.get.mockResolvedValue({
        data: buildMockFile({
          mimeType: "application/vnd.google-apps.presentation",
        }),
      });
      mockDriveClient.files.export.mockResolvedValue({
        data: Buffer.from("pptx content"),
      });

      await service.downloadFile("user-1", "file-1");

      expect(mockDriveClient.files.export).toHaveBeenCalledWith(
        expect.objectContaining({
          mimeType:
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        }),
        expect.anything(),
      );
    });

    it("should export Google Drawing file as PDF", async () => {
      mockDriveClient.files.get.mockResolvedValue({
        data: buildMockFile({
          mimeType: "application/vnd.google-apps.drawing",
        }),
      });
      mockDriveClient.files.export.mockResolvedValue({
        data: Buffer.from("pdf content"),
      });

      await service.downloadFile("user-1", "file-1");

      expect(mockDriveClient.files.export).toHaveBeenCalledWith(
        expect.objectContaining({ mimeType: "application/pdf" }),
        expect.anything(),
      );
    });

    it("should export unknown Google workspace file type as PDF", async () => {
      mockDriveClient.files.get.mockResolvedValue({
        data: buildMockFile({
          mimeType: "application/vnd.google-apps.unknown",
        }),
      });
      mockDriveClient.files.export.mockResolvedValue({
        data: Buffer.from("pdf content"),
      });

      await service.downloadFile("user-1", "file-1");

      expect(mockDriveClient.files.export).toHaveBeenCalledWith(
        expect.objectContaining({ mimeType: "application/pdf" }),
        expect.anything(),
      );
    });

    it("should throw BadRequestException when download fails", async () => {
      mockDriveClient.files.get.mockResolvedValue({
        data: buildMockFile(),
      });
      mockDriveClient.files.get
        .mockRejectedValueOnce(new Error("Download failed"))
        .mockResolvedValueOnce({
          data: buildMockFile(),
        });

      // Second get (for alt=media download) fails
      mockDriveClient.files.get
        .mockResolvedValueOnce({ data: buildMockFile() })
        .mockRejectedValueOnce(new Error("Download failed"));

      await expect(service.downloadFile("user-1", "file-1")).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ============================================================
  // uploadFile
  // ============================================================

  describe("uploadFile", () => {
    it("should upload a file successfully", async () => {
      const uploadedFile = buildMockFile({
        id: "new-file-1",
        name: "uploaded.pdf",
        mimeType: "application/pdf",
      });
      mockDriveClient.files.create.mockResolvedValue({ data: uploadedFile });

      const result = await service.uploadFile(
        "user-1",
        "folder-1",
        "uploaded.pdf",
        Buffer.from("file content"),
        "application/pdf",
      );

      expect(result.id).toBe("new-file-1");
      expect(result.name).toBe("uploaded.pdf");
      expect(result.parentId).toBe("folder-1");
    });

    it("should upload file without folder (to root)", async () => {
      const uploadedFile = buildMockFile({ id: "root-file-1" });
      mockDriveClient.files.create.mockResolvedValue({ data: uploadedFile });

      const result = await service.uploadFile(
        "user-1",
        undefined,
        "file.pdf",
        Buffer.from("content"),
        "application/pdf",
      );

      expect(result.parentId).toBeNull();
    });

    it("should throw BadRequestException when upload fails", async () => {
      mockDriveClient.files.create.mockRejectedValue(
        new Error("Upload failed"),
      );

      await expect(
        service.uploadFile(
          "user-1",
          undefined,
          "file.pdf",
          Buffer.from(""),
          "application/pdf",
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ============================================================
  // createFolder
  // ============================================================

  describe("createFolder", () => {
    it("should create folder successfully", async () => {
      const createdFolder = buildMockFile({
        id: "folder-new",
        name: "New Folder",
        mimeType: "application/vnd.google-apps.folder",
      });
      mockDriveClient.files.create.mockResolvedValue({ data: createdFolder });

      const result = await service.createFolder(
        "user-1",
        "parent-1",
        "New Folder",
      );

      expect(result.id).toBe("folder-new");
      expect(result.isFolder).toBe(true);
      expect(result.size).toBe(0);
    });

    it("should create folder without parent (at root)", async () => {
      const createdFolder = buildMockFile({
        id: "root-folder",
        mimeType: "application/vnd.google-apps.folder",
      });
      mockDriveClient.files.create.mockResolvedValue({ data: createdFolder });

      const result = await service.createFolder(
        "user-1",
        undefined,
        "Root Folder",
      );

      expect(result.parentId).toBeNull();
    });

    it("should throw BadRequestException when folder creation fails", async () => {
      mockDriveClient.files.create.mockRejectedValue(
        new Error("Create failed"),
      );

      await expect(
        service.createFolder("user-1", undefined, "New Folder"),
      ).rejects.toThrow(BadRequestException);
    });
  });
});

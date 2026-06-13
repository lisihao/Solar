import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
import { GoogleDriveSyncService } from "../google-drive-sync.service";
import { PrismaService } from "../../../../../../../common/prisma/prisma.service";
import { GoogleDriveFileService } from "../google-drive-file.service";
import { GoogleDriveImportService } from "../google-drive-import.service";

describe("GoogleDriveSyncService", () => {
  let service: GoogleDriveSyncService;
  let prisma: jest.Mocked<PrismaService>;
  let fileService: jest.Mocked<GoogleDriveFileService>;
  let importService: jest.Mocked<GoogleDriveImportService>;

  const mockConnection = {
    id: "conn-1",
    userId: "user-1",
    googleId: "gid-1",
    email: "test@example.com",
    displayName: "Test User",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    tokenExpiry: new Date(Date.now() + 3600000),
    status: "ACTIVE",
    lastSyncAt: null,
    lastError: null,
  };

  const mockImportedFile = {
    id: "imported-1",
    connectionId: "conn-1",
    googleFileId: "drive-file-1",
    googleFileName: "test.pdf",
    mimeType: "application/pdf",
    resourceId: "resource-1",
    lastSyncedAt: new Date("2024-01-01"),
    googleModifiedTime: new Date("2024-01-01"),
  };

  const mockResource = {
    id: "resource-1",
    title: "Test Resource",
    content: "Content",
    abstract: null,
    updatedAt: new Date("2024-01-02"), // Newer than lastSyncedAt
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const prismaMock = {
      googleDriveConnection: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      googleDriveImportedFile: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        upsert: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
      resource: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      googleDriveSyncHistory: {
        findMany: jest.fn(),
      },
    };

    const fileServiceMock = {
      getFile: jest.fn(),
      uploadFile: jest.fn(),
    };

    const importServiceMock = {
      importFiles: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoogleDriveSyncService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: GoogleDriveFileService, useValue: fileServiceMock },
        { provide: GoogleDriveImportService, useValue: importServiceMock },
      ],
    }).compile();

    service = module.get<GoogleDriveSyncService>(GoogleDriveSyncService);
    prisma = module.get(PrismaService);
    fileService = module.get(GoogleDriveFileService);
    importService = module.get(GoogleDriveImportService);
  });

  // ============ getSyncStatus ============

  describe("getSyncStatus", () => {
    it("should return sync status for connected user", async () => {
      prisma.googleDriveConnection.findFirst.mockResolvedValue(
        mockConnection as any,
      );
      prisma.googleDriveImportedFile.findMany.mockResolvedValue([]);
      prisma.resource.findMany.mockResolvedValue([]);

      const result = await service.getSyncStatus("user-1");

      expect(prisma.googleDriveConnection.findFirst).toHaveBeenCalledWith({
        where: { userId: "user-1" },
      });
      expect(result.connectionId).toBe("conn-1");
      expect(result.isSyncing).toBe(false);
      expect(result.pendingChanges).toBeDefined();
    });

    it("should throw BadRequestException when Google Drive not connected", async () => {
      prisma.googleDriveConnection.findFirst.mockResolvedValue(null);

      await expect(service.getSyncStatus("user-1")).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.getSyncStatus("user-1")).rejects.toThrow(
        "Google Drive not connected",
      );
    });

    it("should report pending local changes correctly", async () => {
      const recentlySynced = new Date("2024-01-01");
      const updatedAfterSync = new Date("2024-01-02");

      prisma.googleDriveConnection.findFirst.mockResolvedValue(
        mockConnection as any,
      );
      prisma.googleDriveImportedFile.findMany.mockResolvedValue([
        {
          ...mockImportedFile,
          lastSyncedAt: recentlySynced,
          resourceId: "resource-1",
        },
      ] as any);
      prisma.resource.findMany.mockResolvedValue([
        { id: "resource-1", updatedAt: updatedAfterSync },
      ] as any);

      const result = await service.getSyncStatus("user-1");

      expect(result.pendingChanges.local).toBe(1);
    });
  });

  // ============ sync ============

  describe("sync", () => {
    beforeEach(() => {
      prisma.googleDriveConnection.findFirst.mockResolvedValue(
        mockConnection as any,
      );
      prisma.googleDriveImportedFile.findMany.mockResolvedValue([]);
      prisma.resource.findMany.mockResolvedValue([]);
      prisma.googleDriveConnection.update.mockResolvedValue({} as any);
    });

    it("should complete sync successfully with no changes", async () => {
      const result = await service.sync("user-1");

      expect(result.success).toBe(true);
      expect(result.imported).toBe(0);
      expect(result.exported).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it("should throw BadRequestException when Google Drive not connected", async () => {
      prisma.googleDriveConnection.findFirst.mockResolvedValue(null);

      await expect(service.sync("user-1")).rejects.toThrow(
        "Google Drive not connected",
      );
    });

    it("should throw BadRequestException when sync already in progress", async () => {
      // First sync call sets syncInProgress
      prisma.googleDriveImportedFile.findMany.mockResolvedValue([]);
      prisma.resource.findMany.mockResolvedValue([]);

      // Simulate sync in progress by calling sync and checking concurrent call
      const firstSync = service.sync("user-1");
      await expect(service.sync("user-1")).rejects.toThrow(
        "Sync already in progress",
      );
      await firstSync; // Let first sync complete
    });

    it("should import remote changes when not export-forced", async () => {
      const pastDate = new Date("2024-01-01");
      const futureDate = new Date("2024-12-31");

      prisma.googleDriveImportedFile.findMany.mockResolvedValue([
        { ...mockImportedFile, lastSyncedAt: pastDate },
      ] as any);
      prisma.resource.findMany.mockResolvedValue([
        { ...mockResource, updatedAt: pastDate }, // Not locally modified
      ] as any);
      fileService.getFile.mockResolvedValue({
        id: "drive-file-1",
        name: "test.pdf",
        mimeType: "application/pdf",
        driveModifiedAt: futureDate.toISOString(), // Remote has been modified
      } as any);
      importService.importFiles.mockResolvedValue([
        { id: "resource-1" },
      ] as any);

      const result = await service.sync("user-1");

      expect(importService.importFiles).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({ fileIds: ["drive-file-1"] }),
      );
      expect(result.imported).toBe(1);
    });

    it("should skip import when forceDirection=export", async () => {
      await service.sync("user-1", { forceDirection: "export" });

      expect(importService.importFiles).not.toHaveBeenCalled();
    });

    it("should export local changes when not import-forced", async () => {
      const pastDate = new Date("2024-01-01");

      prisma.googleDriveImportedFile.findMany.mockResolvedValue([
        { ...mockImportedFile, lastSyncedAt: pastDate },
      ] as any);
      prisma.resource.findMany.mockResolvedValue([
        { ...mockResource, updatedAt: new Date("2024-06-01") }, // Local modified
      ] as any);
      fileService.getFile.mockResolvedValue({
        id: "drive-file-1",
        name: "test.pdf",
        mimeType: "application/pdf",
        driveModifiedAt: pastDate.toISOString(), // Remote NOT modified
      } as any);
      prisma.resource.findUnique.mockResolvedValue(mockResource as any);
      fileService.uploadFile.mockResolvedValue({ id: "new-drive-file" } as any);
      prisma.googleDriveImportedFile.updateMany.mockResolvedValue({
        count: 1,
      } as any);

      await service.sync("user-1", { forceDirection: "import" });

      // With forceDirection=import, export is skipped
      expect(fileService.uploadFile).not.toHaveBeenCalled();
    });

    it("should update lastSyncAt on connection after sync completes", async () => {
      await service.sync("user-1");

      expect(prisma.googleDriveConnection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ lastSyncAt: expect.any(Date) }),
        }),
      );
    });

    it("should record import errors without stopping sync", async () => {
      const pastDate = new Date("2024-01-01");
      const futureDate = new Date("2024-12-31");

      prisma.googleDriveImportedFile.findMany.mockResolvedValue([
        { ...mockImportedFile, lastSyncedAt: pastDate },
      ] as any);
      prisma.resource.findMany.mockResolvedValue([
        { ...mockResource, updatedAt: pastDate },
      ] as any);
      fileService.getFile.mockResolvedValue({
        id: "drive-file-1",
        name: "test.pdf",
        mimeType: "application/pdf",
        driveModifiedAt: futureDate.toISOString(),
      } as any);
      importService.importFiles.mockRejectedValue(new Error("Import failed"));

      const result = await service.sync("user-1");

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toBe("Import failed");
    });

    it("should detect and record conflicts", async () => {
      const pastDate = new Date("2024-01-01");
      const futureDate = new Date("2024-12-31");

      prisma.googleDriveImportedFile.findMany.mockResolvedValue([
        { ...mockImportedFile, lastSyncedAt: pastDate },
      ] as any);
      prisma.resource.findMany.mockResolvedValue([
        { ...mockResource, updatedAt: futureDate }, // Local modified AFTER pastDate
      ] as any);
      fileService.getFile.mockResolvedValue({
        id: "drive-file-1",
        name: "test.pdf",
        mimeType: "application/pdf",
        driveModifiedAt: futureDate.toISOString(), // Remote ALSO modified
      } as any);

      const result = await service.sync("user-1");

      expect(result.conflicts).toHaveLength(1);
    });
  });

  // ============ resolveConflict ============

  describe("resolveConflict", () => {
    it("should export local version when resolution=keep_local", async () => {
      prisma.googleDriveImportedFile.findUnique.mockResolvedValue(
        mockImportedFile as any,
      );
      prisma.resource.findUnique.mockResolvedValue(mockResource as any);
      fileService.uploadFile.mockResolvedValue({} as any);
      prisma.googleDriveImportedFile.updateMany.mockResolvedValue({
        count: 1,
      } as any);
      prisma.googleDriveImportedFile.update.mockResolvedValue({} as any);

      await service.resolveConflict("user-1", "imported-1", "keep_local");

      expect(fileService.uploadFile).toHaveBeenCalled();
      expect(prisma.googleDriveImportedFile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ lastSyncedAt: expect.any(Date) }),
        }),
      );
    });

    it("should import remote version when resolution=keep_remote", async () => {
      prisma.googleDriveImportedFile.findUnique.mockResolvedValue(
        mockImportedFile as any,
      );
      importService.importFiles.mockResolvedValue([
        { id: "resource-1" },
      ] as any);
      prisma.googleDriveImportedFile.update.mockResolvedValue({} as any);

      await service.resolveConflict("user-1", "imported-1", "keep_remote");

      expect(importService.importFiles).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({ fileIds: ["drive-file-1"] }),
      );
    });

    it("should throw BadRequestException when conflict not found", async () => {
      prisma.googleDriveImportedFile.findUnique.mockResolvedValue(null);

      await expect(
        service.resolveConflict("user-1", "missing-id", "keep_local"),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.resolveConflict("user-1", "missing-id", "keep_local"),
      ).rejects.toThrow("Conflict not found");
    });
  });

  // ============ linkResource ============

  describe("linkResource", () => {
    it("should link a resource to a Google Drive file", async () => {
      prisma.googleDriveConnection.findFirst.mockResolvedValue(
        mockConnection as any,
      );
      fileService.getFile.mockResolvedValue({
        id: "drive-file-1",
        name: "test.pdf",
        mimeType: "application/pdf",
        driveModifiedAt: new Date().toISOString(),
      } as any);
      prisma.googleDriveImportedFile.upsert.mockResolvedValue({} as any);

      await service.linkResource("user-1", "resource-1", "drive-file-1");

      expect(prisma.googleDriveImportedFile.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            connectionId: "conn-1",
            googleFileId: "drive-file-1",
            resourceId: "resource-1",
          }),
          update: expect.objectContaining({ resourceId: "resource-1" }),
        }),
      );
    });

    it("should throw BadRequestException when Google Drive not connected", async () => {
      prisma.googleDriveConnection.findFirst.mockResolvedValue(null);

      await expect(
        service.linkResource("user-1", "resource-1", "drive-1"),
      ).rejects.toThrow("Google Drive not connected");
    });
  });

  // ============ unlinkResource ============

  describe("unlinkResource", () => {
    it("should delete import mapping for the resource", async () => {
      prisma.googleDriveConnection.findFirst.mockResolvedValue(
        mockConnection as any,
      );
      prisma.googleDriveImportedFile.deleteMany.mockResolvedValue({
        count: 1,
      } as any);

      await service.unlinkResource("user-1", "resource-1");

      expect(prisma.googleDriveImportedFile.deleteMany).toHaveBeenCalledWith({
        where: { connectionId: "conn-1", resourceId: "resource-1" },
      });
    });

    it("should throw BadRequestException when Google Drive not connected", async () => {
      prisma.googleDriveConnection.findFirst.mockResolvedValue(null);

      await expect(
        service.unlinkResource("user-1", "resource-1"),
      ).rejects.toThrow("Google Drive not connected");
    });
  });

  // ============ getSyncHistory ============

  describe("getSyncHistory", () => {
    it("should return sync history for a connection", async () => {
      prisma.googleDriveSyncHistory.findMany.mockResolvedValue([
        { id: "hist-1", connectionId: "conn-1" },
      ] as any);

      const result = await service.getSyncHistory("conn-1");

      expect(prisma.googleDriveSyncHistory.findMany).toHaveBeenCalledWith({
        where: { connectionId: "conn-1" },
        orderBy: { startedAt: "desc" },
        take: 10,
      });
      expect(result).toHaveLength(1);
    });

    it("should respect custom limit", async () => {
      prisma.googleDriveSyncHistory.findMany.mockResolvedValue([]);

      await service.getSyncHistory("conn-1", 5);

      expect(prisma.googleDriveSyncHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 }),
      );
    });
  });
});

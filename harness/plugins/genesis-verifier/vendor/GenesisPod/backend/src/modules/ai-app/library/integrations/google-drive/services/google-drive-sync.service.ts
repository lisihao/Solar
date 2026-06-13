import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { GoogleDriveFileService } from "./google-drive-file.service";
import { GoogleDriveImportService } from "./google-drive-import.service";

export interface SyncConfig {
  /** Auto-sync interval in minutes (0 = disabled) */
  autoSyncInterval: number;
  /** Sync direction: 'bidirectional' | 'import_only' | 'export_only' */
  direction: "bidirectional" | "import_only" | "export_only";
  /** Conflict resolution: 'local_wins' | 'remote_wins' | 'manual' */
  conflictResolution: "local_wins" | "remote_wins" | "manual";
  /** Folders to sync (empty = all) */
  syncFolders: string[];
}

export interface SyncStatus {
  connectionId: string;
  isSyncing: boolean;
  lastSyncAt: Date | null;
  lastSyncResult: SyncResult | null;
  pendingChanges: {
    local: number;
    remote: number;
    conflicts: number;
  };
}

export interface FileChange {
  type: "added" | "modified" | "deleted";
  source: "local" | "remote";
  fileId: string;
  fileName: string;
  modifiedAt: Date;
  resourceId?: string;
  googleFileId?: string;
}

export interface SyncConflict {
  fileId: string;
  fileName: string;
  localModified: Date;
  remoteModified: Date;
  resourceId: string;
  googleFileId: string;
}

export interface SyncResult {
  success: boolean;
  imported: number;
  exported: number;
  conflicts: SyncConflict[];
  errors: Array<{ fileId: string; error: string }>;
  syncedAt: Date;
}

@Injectable()
export class GoogleDriveSyncService {
  private readonly logger = new Logger(GoogleDriveSyncService.name);
  private syncInProgress = new Map<string, boolean>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly fileService: GoogleDriveFileService,
    private readonly importService: GoogleDriveImportService,
  ) {}

  /**
   * Get sync status for a user
   */
  async getSyncStatus(userId: string): Promise<SyncStatus> {
    const connection = await this.prisma.googleDriveConnection.findFirst({
      where: { userId },
    });

    if (!connection) {
      throw new BadRequestException("Google Drive not connected");
    }

    const pendingChanges = await this.detectPendingChanges(
      userId,
      connection.id,
    );

    return {
      connectionId: connection.id,
      isSyncing: this.syncInProgress.get(connection.id) || false,
      lastSyncAt: connection.lastSyncAt,
      lastSyncResult: null, // Could store in DB for persistence
      pendingChanges,
    };
  }

  /**
   * Detect pending changes on both sides
   */
  private async detectPendingChanges(
    _userId: string,
    connectionId: string,
  ): Promise<{ local: number; remote: number; conflicts: number }> {
    try {
      // Get imported files mapping
      const importedFiles = await this.prisma.googleDriveImportedFile.findMany({
        where: { connectionId },
      });

      // Get local resources that were imported from Google Drive
      const localResources = await this.prisma.resource.findMany({
        where: {
          id: { in: importedFiles.map((f) => f.resourceId) },
        },
        select: {
          id: true,
          updatedAt: true,
        },
      });

      const localMap = new Map(localResources.map((r) => [r.id, r]));

      let localChanges = 0;
      let remoteChanges = 0;
      const conflicts = 0;

      // Check for local changes
      for (const imported of importedFiles) {
        const localResource = localMap.get(imported.resourceId);
        if (localResource && localResource.updatedAt > imported.lastSyncedAt) {
          localChanges++;
        }
      }

      // Check for remote changes (simplified - would need API call for real check)
      // For now, just count unsynced files
      remoteChanges = 0; // Would need to list Drive files and compare

      return { local: localChanges, remote: remoteChanges, conflicts };
    } catch (error) {
      this.logger.error(`Failed to detect pending changes: ${error}`);
      return { local: 0, remote: 0, conflicts: 0 };
    }
  }

  /**
   * Perform bidirectional sync
   */
  async sync(
    userId: string,
    options: { forceDirection?: "import" | "export" } = {},
  ): Promise<SyncResult> {
    const connection = await this.prisma.googleDriveConnection.findFirst({
      where: { userId },
    });

    if (!connection) {
      throw new BadRequestException("Google Drive not connected");
    }

    // Prevent concurrent syncs
    if (this.syncInProgress.get(connection.id)) {
      throw new BadRequestException("Sync already in progress");
    }

    this.syncInProgress.set(connection.id, true);

    const result: SyncResult = {
      success: false,
      imported: 0,
      exported: 0,
      conflicts: [],
      errors: [],
      syncedAt: new Date(),
    };

    try {
      this.logger.log(`Starting sync for user ${userId}`);

      // Detect changes
      const { localChanges, remoteChanges, conflicts } =
        await this.detectChanges(userId, connection.id);

      result.conflicts = conflicts;

      // Handle conflicts based on resolution strategy (default: manual)
      if (conflicts.length > 0) {
        this.logger.warn(`Found ${conflicts.length} conflicts`);
        // For now, skip conflicting files - they need manual resolution
      }

      // Import remote changes (unless export_only)
      if (options.forceDirection !== "export") {
        for (const change of remoteChanges) {
          if (change.type === "added" || change.type === "modified") {
            try {
              await this.importService.importFiles(userId, {
                fileIds: [change.fileId],
                extractContent: true,
              });
              result.imported++;
            } catch (error) {
              result.errors.push({
                fileId: change.fileId,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }
      }

      // Export local changes (unless import_only)
      if (options.forceDirection !== "import") {
        for (const change of localChanges) {
          if (
            change.type === "modified" &&
            change.resourceId &&
            change.googleFileId
          ) {
            try {
              // Update existing file in Google Drive
              await this.updateRemoteFile(
                userId,
                change.resourceId,
                change.googleFileId,
              );
              result.exported++;
            } catch (error) {
              result.errors.push({
                fileId: change.resourceId,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }
      }

      // Update last sync time
      await this.prisma.googleDriveConnection.update({
        where: { id: connection.id },
        data: { lastSyncAt: new Date() },
      });

      result.success = result.errors.length === 0;
      this.logger.log(
        `Sync completed: ${result.imported} imported, ${result.exported} exported, ${result.errors.length} errors`,
      );

      return result;
    } catch (error) {
      this.logger.error(`Sync failed: ${error}`);
      result.errors.push({
        fileId: "sync",
        error: error instanceof Error ? error.message : String(error),
      });
      return result;
    } finally {
      this.syncInProgress.set(connection.id, false);
    }
  }

  /**
   * Detect changes on both sides
   */
  private async detectChanges(
    userId: string,
    connectionId: string,
  ): Promise<{
    localChanges: FileChange[];
    remoteChanges: FileChange[];
    conflicts: SyncConflict[];
  }> {
    const localChanges: FileChange[] = [];
    const remoteChanges: FileChange[] = [];
    const conflicts: SyncConflict[] = [];

    // Get imported files mapping
    const importedFiles = await this.prisma.googleDriveImportedFile.findMany({
      where: { connectionId },
    });

    // Get local resources
    const resources = await this.prisma.resource.findMany({
      where: {
        id: { in: importedFiles.map((f) => f.resourceId) },
      },
    });

    const resourceMap = new Map(resources.map((r) => [r.id, r]));

    // Check each synced file
    for (const imported of importedFiles) {
      const localResource = resourceMap.get(imported.resourceId);
      if (!localResource) continue;

      const localModified = localResource.updatedAt > imported.lastSyncedAt;

      // Get remote file info
      try {
        const remoteFile = await this.fileService.getFile(
          userId,
          imported.googleFileId,
        );
        const remoteModified =
          new Date(remoteFile.driveModifiedAt) > imported.lastSyncedAt;

        if (localModified && remoteModified) {
          // Conflict
          conflicts.push({
            fileId: imported.id,
            fileName: imported.googleFileName,
            localModified: localResource.updatedAt,
            remoteModified: new Date(remoteFile.driveModifiedAt),
            resourceId: imported.resourceId,
            googleFileId: imported.googleFileId,
          });
        } else if (localModified) {
          localChanges.push({
            type: "modified",
            source: "local",
            fileId: imported.resourceId,
            fileName: localResource.title,
            modifiedAt: localResource.updatedAt,
            resourceId: imported.resourceId,
            googleFileId: imported.googleFileId,
          });
        } else if (remoteModified) {
          remoteChanges.push({
            type: "modified",
            source: "remote",
            fileId: imported.googleFileId,
            fileName: remoteFile.name,
            modifiedAt: new Date(remoteFile.driveModifiedAt),
            resourceId: imported.resourceId,
            googleFileId: imported.googleFileId,
          });
        }
      } catch (error) {
        this.logger.warn(
          `Failed to get remote file ${imported.googleFileId}: ${error}`,
        );
      }
    }

    return { localChanges, remoteChanges, conflicts };
  }

  /**
   * Update a file in Google Drive with local changes
   */
  private async updateRemoteFile(
    userId: string,
    resourceId: string,
    googleFileId: string,
  ): Promise<void> {
    const resource = await this.prisma.resource.findUnique({
      where: { id: resourceId },
    });

    if (!resource) {
      throw new BadRequestException(`Resource ${resourceId} not found`);
    }

    // Generate content for export
    const content = resource.content || resource.abstract || "";
    const fileName = `${resource.title}.txt`;

    // Upload as new version (Google Drive handles versioning)
    await this.fileService.uploadFile(
      userId,
      undefined, // Keep in same folder
      fileName,
      Buffer.from(content, "utf-8"),
      "text/plain",
    );

    // Update sync timestamp
    await this.prisma.googleDriveImportedFile.updateMany({
      where: { resourceId, googleFileId },
      data: { lastSyncedAt: new Date() },
    });
  }

  /**
   * Resolve a conflict by choosing which version to keep
   */
  async resolveConflict(
    userId: string,
    conflictId: string,
    resolution: "keep_local" | "keep_remote",
  ): Promise<void> {
    const imported = await this.prisma.googleDriveImportedFile.findUnique({
      where: { id: conflictId },
    });

    if (!imported) {
      throw new BadRequestException("Conflict not found");
    }

    if (resolution === "keep_local") {
      // Export local version to Google Drive
      await this.updateRemoteFile(
        userId,
        imported.resourceId,
        imported.googleFileId,
      );
    } else {
      // Import remote version
      await this.importService.importFiles(userId, {
        fileIds: [imported.googleFileId],
        extractContent: true,
      });
    }

    // Update sync timestamp
    await this.prisma.googleDriveImportedFile.update({
      where: { id: conflictId },
      data: { lastSyncedAt: new Date() },
    });
  }

  /**
   * Link a local resource to a Google Drive file for future sync
   */
  async linkResource(
    userId: string,
    resourceId: string,
    googleFileId: string,
  ): Promise<void> {
    const connection = await this.prisma.googleDriveConnection.findFirst({
      where: { userId },
    });

    if (!connection) {
      throw new BadRequestException("Google Drive not connected");
    }

    // Get file info
    const file = await this.fileService.getFile(userId, googleFileId);

    // Create or update mapping
    await this.prisma.googleDriveImportedFile.upsert({
      where: {
        connectionId_googleFileId: {
          connectionId: connection.id,
          googleFileId,
        },
      },
      create: {
        connectionId: connection.id,
        googleFileId,
        googleFileName: file.name,
        mimeType: file.mimeType,
        googleModifiedTime: new Date(file.driveModifiedAt),
        resourceId,
        lastSyncedAt: new Date(),
      },
      update: {
        resourceId,
        lastSyncedAt: new Date(),
      },
    });

    this.logger.log(
      `Linked resource ${resourceId} to Google Drive file ${googleFileId}`,
    );
  }

  /**
   * Unlink a resource from Google Drive sync
   */
  async unlinkResource(userId: string, resourceId: string): Promise<void> {
    const connection = await this.prisma.googleDriveConnection.findFirst({
      where: { userId },
    });

    if (!connection) {
      throw new BadRequestException("Google Drive not connected");
    }

    await this.prisma.googleDriveImportedFile.deleteMany({
      where: {
        connectionId: connection.id,
        resourceId,
      },
    });

    this.logger.log(`Unlinked resource ${resourceId} from Google Drive sync`);
  }

  /**
   * 获取同步历史记录
   */
  async getSyncHistory(connectionId: string, limit: number = 10) {
    return this.prisma.googleDriveSyncHistory.findMany({
      where: { connectionId },
      orderBy: { startedAt: "desc" },
      take: limit,
    });
  }
}

/**
 * LibraryExportService — cross-app sanctioned facade for saving deliverables
 * to a user's connected cloud storage integration.
 *
 * Architectural role (2026-06-05, export/ subpath allowlisted):
 *   ai-app/* → library/export/ (this facade)
 *                 └─ GoogleDriveAuthService  ← intra-library (allowed)
 *                 └─ GoogleDriveFileService  ← intra-library (allowed)
 *
 * Single public method: saveMarkdownToUserStorage().
 * Best-effort semantics: never throws. Returns { saved: false } when no
 * integration is connected, on auth failure, or on upload error.
 *
 * Priority order: Google Drive (only integration with outbound file-write API).
 * Feishu / Notion have no outbound write API → skipped.
 */

import { Injectable, Logger } from "@nestjs/common";
import { GoogleDriveAuthService } from "../integrations/google-drive/services/google-drive-auth.service";
import { GoogleDriveFileService } from "../integrations/google-drive/services/google-drive-file.service";

export interface SaveResult {
  saved: boolean;
  provider?: string;
}

@Injectable()
export class LibraryExportService {
  private readonly logger = new Logger(LibraryExportService.name);

  constructor(
    private readonly driveAuth: GoogleDriveAuthService,
    private readonly driveFile: GoogleDriveFileService,
  ) {}

  /**
   * Upload a markdown string to the user's first connected cloud storage.
   * Currently supports Google Drive only (priority provider).
   *
   * @param userId   - The user whose integrations to check.
   * @param fileName - Desired file name (e.g. "mission-abc123-report.md").
   * @param content  - Markdown text to upload.
   * @returns `{ saved: true, provider: "google-drive" }` on success,
   *          `{ saved: false }` if no integration connected or on any error.
   */
  async saveMarkdownToUserStorage(
    userId: string,
    fileName: string,
    content: string,
  ): Promise<SaveResult> {
    try {
      const connection = await this.driveAuth.getConnection(userId);
      if (!connection) {
        this.logger.debug(
          `[LibraryExport] No Google Drive connection for user ${userId}`,
        );
        return { saved: false };
      }

      const buffer = Buffer.from(content, "utf-8");
      await this.driveFile.uploadFile(
        userId,
        undefined,
        fileName,
        buffer,
        "text/markdown",
      );

      this.logger.log(
        `[LibraryExport] Uploaded "${fileName}" to Google Drive for user ${userId}`,
      );
      return { saved: true, provider: "google-drive" };
    } catch (err) {
      this.logger.warn(
        `[LibraryExport] Failed to save "${fileName}" for user ${userId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { saved: false };
    }
  }
}

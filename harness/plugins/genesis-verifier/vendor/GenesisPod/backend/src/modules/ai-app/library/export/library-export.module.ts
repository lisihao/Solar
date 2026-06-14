/**
 * LibraryExportModule — NestJS module for the cross-app deliverable-export facade.
 *
 * Exposes LibraryExportService as the ONLY public entry point.
 * Internals (GoogleDriveAuthService / GoogleDriveFileService) remain
 * encapsulated within the library module tree — consumers never import
 * the google-drive integration directly.
 *
 * Import this module in any ai-app module that needs to save deliverables
 * to user-connected cloud storage (e.g. AiAskModule for self-driven reports).
 */

import { Module } from "@nestjs/common";
import { GoogleDriveModule } from "../integrations/google-drive/google-drive.module";
import { LibraryExportService } from "./library-export.service";

@Module({
  imports: [GoogleDriveModule],
  providers: [LibraryExportService],
  exports: [LibraryExportService],
})
export class LibraryExportModule {}

import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { GoogleDriveController } from "./google-drive.controller";
import { GoogleDriveAuthService } from "./services/google-drive-auth.service";
import { GoogleDriveFileService } from "./services/google-drive-file.service";
import { GoogleDriveImportService } from "./services/google-drive-import.service";
import { GoogleDriveExportService } from "./services/google-drive-export.service";
import { GoogleDriveSyncService } from "./services/google-drive-sync.service";
import { PrismaModule } from "../../../../../common/prisma/prisma.module";
import { ContentProcessingModule } from "../../../../../common/content-processing/content-processing.module";

@Module({
  imports: [PrismaModule, HttpModule, ContentProcessingModule],
  controllers: [GoogleDriveController],
  providers: [
    GoogleDriveAuthService,
    GoogleDriveFileService,
    GoogleDriveImportService,
    GoogleDriveExportService,
    GoogleDriveSyncService,
  ],
  exports: [
    GoogleDriveAuthService,
    GoogleDriveFileService,
    GoogleDriveImportService,
    GoogleDriveExportService,
    GoogleDriveSyncService,
  ],
})
export class GoogleDriveModule {}

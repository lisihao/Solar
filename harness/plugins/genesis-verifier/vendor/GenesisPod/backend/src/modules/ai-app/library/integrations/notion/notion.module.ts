import { Module } from "@nestjs/common";
import { NotionController } from "./notion.controller";
import { NotionAuthService } from "./services/notion-auth.service";
import { NotionSyncService } from "./services/notion-sync.service";
import { NotionPageService } from "./services/notion-page.service";
import { PrismaModule } from "../../../../../common/prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  controllers: [NotionController],
  providers: [NotionAuthService, NotionSyncService, NotionPageService],
  exports: [NotionAuthService, NotionSyncService, NotionPageService],
})
export class NotionModule {}

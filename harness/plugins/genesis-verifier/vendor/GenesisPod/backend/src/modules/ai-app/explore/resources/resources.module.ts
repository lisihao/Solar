import { Module } from "@nestjs/common";
import { ResourcesController } from "./resources.controller";
import { ResourcesService } from "./resources.service";
import { ResourcesRepository } from "./resources.repository";
import { AIEnrichmentService } from "./ai-enrichment.service";
import { PdfThumbnailService } from "./pdf-thumbnail.service";
import { DynamicThumbnailService } from "./dynamic-thumbnail.service";
import { ResourceHealthCheckScheduler } from "./resource-health-check.scheduler";
import { ResourceLifecycleModule } from "./resource-lifecycle.module";
import { PrismaModule } from "../../../../common/prisma/prisma.module";
import { RawDataModule } from "@/modules/ai-app/explore/rawdata/rawdata.module";
import { IngestionConfigModule } from "../../explore/ingestion/config/config.module";
import { StorageModule } from "../../../platform/storage/storage.module";
import { ProxyModule } from "../../library/proxy/proxy.module";

/**
 * 资源管理模块
 */
@Module({
  imports: [
    PrismaModule,
    RawDataModule,
    IngestionConfigModule,
    StorageModule,
    ProxyModule, // 用于 FlareSolverr 支持
    ResourceLifecycleModule,
  ],
  controllers: [ResourcesController],
  providers: [
    ResourcesRepository,
    ResourcesService,
    AIEnrichmentService,
    PdfThumbnailService,
    DynamicThumbnailService,
    ResourceHealthCheckScheduler,
  ],
  exports: [
    ResourcesRepository,
    ResourcesService,
    AIEnrichmentService,
    PdfThumbnailService,
    DynamicThumbnailService,
    ResourceLifecycleModule,
  ],
})
export class ResourcesModule {}

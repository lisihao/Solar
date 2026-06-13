import { Module, OnModuleInit, Logger } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { HttpModule } from "@nestjs/axios";
import { PrismaModule } from "../../../../../common/prisma/prisma.module";
import { RawDataModule } from "@/modules/ai-app/explore/rawdata/rawdata.module";
import { SourceWhitelistService } from "./services/source-whitelist.service";
import { SourceWhitelistController } from "./controllers/source-whitelist.controller";
import { CollectionRuleService } from "./services/collection-rule.service";
import { CollectionRuleController } from "./controllers/collection-rule.controller";
import { CollectionConfigurationService } from "./services/collection-configuration.service";
import { CollectionConfigurationController } from "./controllers/collection-configuration.controller";
import { ImportManagerService } from "./services/import-manager.service";
import { ImportManagerController } from "./controllers/import-manager.controller";
import { ImportTaskProcessorService } from "./services/import-task-processor.service";
import { MetadataExtractorService } from "./services/metadata-extractor.service";
import { DuplicateDetectorService } from "./services/duplicate-detector.service";
import { PaperMetadataExtractorService } from "./services/paper-metadata-extractor.service";
import { DashboardService } from "./services/dashboard.service";
import { IngestionConfigDashboardController } from "./controllers/dashboard.controller";
import { ConfigurationController } from "./controllers/configuration.controller";
import { ConfigurationService } from "./services/configuration.service";
import { AiUrlClassifierService } from "./services/ai-url-classifier.service";
import { ResourceLifecycleModule } from "../../../explore/resources/resource-lifecycle.module";

/**
 * Ingestion Config Module (数据采集配置模块)
 *
 * 管理数据采集的配置和规则：
 * - 来源白名单管理
 * - 采集规则引擎
 * - 采集配置管理
 * - 导入管理和URL解析
 */
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    HttpModule,
    RawDataModule,
    ResourceLifecycleModule,
  ],
  providers: [
    SourceWhitelistService,
    CollectionRuleService,
    CollectionConfigurationService,
    ImportManagerService,
    ImportTaskProcessorService,
    MetadataExtractorService,
    DuplicateDetectorService,
    PaperMetadataExtractorService,
    DashboardService,
    ConfigurationService,
    AiUrlClassifierService,
  ],
  controllers: [
    SourceWhitelistController,
    CollectionRuleController,
    CollectionConfigurationController,
    ImportManagerController,
    IngestionConfigDashboardController,
    ConfigurationController,
  ],
  exports: [
    SourceWhitelistService,
    CollectionRuleService,
    CollectionConfigurationService,
    ImportManagerService,
    MetadataExtractorService,
    DuplicateDetectorService,
    AiUrlClassifierService,
  ],
})
export class IngestionConfigModule implements OnModuleInit {
  private readonly logger = new Logger(IngestionConfigModule.name);

  constructor(
    private sourceWhitelistService: SourceWhitelistService,
    private collectionRuleService: CollectionRuleService,
  ) {}

  async onModuleInit() {
    try {
      await this.sourceWhitelistService.initializeDefaultWhitelists();
      await this.collectionRuleService.initializeDefaultRules();
    } catch (error) {
      this.logger.warn(
        "Failed to initialize ingestion config defaults:",
        error,
      );
    }
  }
}

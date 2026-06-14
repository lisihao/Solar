import { Module } from "@nestjs/common";
import { PrismaModule } from "../../../../../common/prisma/prisma.module";
import { RawDataModule } from "@/modules/ai-app/explore/rawdata/rawdata.module";
import { CrawlersModule } from "../crawlers/crawlers.module";

// Services
import { DataSourceService } from "./data-source.service";
import { CollectionTaskService } from "./collection-task.service";
import { DashboardService } from "./dashboard.service";
import { MonitorService } from "./monitor.service";
import { QualityService } from "./quality.service";
import { HistoryService } from "./history.service";
import { DataSourceSeederService } from "./data-source-seeder.service";

// Controllers
import { DataSourceController } from "./data-source.controller";
import { CollectionTaskController } from "./collection-task.controller";
import { IngestionSourcesDashboardController } from "./dashboard.controller";
import { MonitorController } from "./monitor.controller";
import { QualityController } from "./quality.controller";
import { HistoryController } from "./history.controller";

/**
 * Sources Module (数据源管理模块)
 *
 * 管理数据采集源和任务：
 * - 数据源 CRUD
 * - 采集任务调度
 * - 采集监控和质量检查
 */
@Module({
  imports: [PrismaModule, RawDataModule, CrawlersModule],
  controllers: [
    DataSourceController,
    CollectionTaskController,
    IngestionSourcesDashboardController,
    MonitorController,
    QualityController,
    HistoryController,
  ],
  providers: [
    DataSourceService,
    CollectionTaskService,
    DashboardService,
    MonitorService,
    QualityService,
    HistoryService,
    DataSourceSeederService,
  ],
  exports: [
    DataSourceService,
    CollectionTaskService,
    DashboardService,
    MonitorService,
    QualityService,
    HistoryService,
  ],
})
export class SourcesModule {}

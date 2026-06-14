import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "../../../../../common/prisma/prisma.module";
import { SourcesModule } from "../sources/sources.module";
import { DataCollectionSchedulerService } from "./data-collection-scheduler.service";
import { DataCollectionSchedulerController } from "./data-collection-scheduler.controller";

/**
 * Scheduler Module
 * 通用数据采集调度器模块
 *
 * 功能:
 * - 定时执行各类型数据源的采集任务
 * - 支持所有 22+ 种数据源类型
 * - 提供 API 端点用于手动触发和配置管理
 */
@Module({
  imports: [ConfigModule, PrismaModule, SourcesModule],
  controllers: [DataCollectionSchedulerController],
  providers: [DataCollectionSchedulerService],
  exports: [DataCollectionSchedulerService],
})
export class SchedulerModule {}

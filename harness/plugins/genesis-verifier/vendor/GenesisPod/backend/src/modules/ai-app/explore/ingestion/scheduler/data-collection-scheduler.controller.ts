import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  Logger,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { DataCollectionSchedulerService } from "./data-collection-scheduler.service";
import {
  SchedulerStatus,
  TriggerResult,
  UpdateSchedulerConfigDto,
} from "./data-collection-scheduler.types";

/**
 * Data Collection Scheduler Controller
 * 提供调度器管理 API 端点
 */
@ApiTags("Data Collection - Scheduler")
@Controller("data-collection/scheduler")
export class DataCollectionSchedulerController {
  private readonly logger = new Logger(DataCollectionSchedulerController.name);

  constructor(
    private readonly schedulerService: DataCollectionSchedulerService,
  ) {}

  /**
   * 获取调度器状态
   * GET /data-collection/scheduler/status
   */
  @Get("status")
  async getStatus(): Promise<SchedulerStatus> {
    this.logger.log("Getting scheduler status");
    const status = await this.schedulerService.getStatus();
    return status;
  }

  /**
   * 手动触发单个资源类型的采集
   * POST /data-collection/scheduler/trigger/:resourceType
   */
  @Post("trigger/:resourceType")
  @HttpCode(HttpStatus.OK)
  async triggerByType(
    @Param("resourceType") resourceType: string,
  ): Promise<TriggerResult> {
    this.logger.log(`Triggering collection for ${resourceType}`);
    const result =
      await this.schedulerService.executeCollectionForResourceType(
        resourceType,
      );
    return result;
  }

  /**
   * 手动触发所有类型的采集
   * POST /data-collection/scheduler/trigger-all
   */
  @Post("trigger-all")
  @HttpCode(HttpStatus.OK)
  async triggerAll(): Promise<TriggerResult[]> {
    this.logger.log("Triggering collection for all resource types");
    const results = await this.schedulerService.triggerAll();
    return results;
  }

  /**
   * 更新调度器配置
   * PUT /data-collection/scheduler/config
   */
  @Put("config")
  async updateConfig(
    @Body() dto: UpdateSchedulerConfigDto,
  ): Promise<SchedulerStatus> {
    this.logger.log(`Updating scheduler config: ${JSON.stringify(dto)}`);
    const status = await this.schedulerService.updateConfig(dto);
    return status;
  }

  /**
   * 重启所有调度器
   * POST /data-collection/scheduler/restart
   */
  @Post("restart")
  @HttpCode(HttpStatus.OK)
  async restart(): Promise<{ message: string }> {
    this.logger.log("Restarting all schedulers");
    await this.schedulerService.restartSchedulers();
    return { message: "Schedulers restarted successfully" };
  }
}

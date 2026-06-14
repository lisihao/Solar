import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { MonitorService } from "./monitor.service";

@ApiTags("Data Collection - Monitor")
@Controller("data-collection/monitor")
export class MonitorController {
  constructor(private readonly monitorService: MonitorService) {}

  /**
   * 获取所有运行中的任务
   * GET /data-collection/monitor/tasks
   * GET /data-collection/monitor/running (别名)
   */
  @Get("tasks")
  async getRunningTasks() {
    const tasks = await this.monitorService.getRunningTasks();
    return tasks;
  }

  /**
   * 获取所有运行中的任务（别名路由）
   * GET /data-collection/monitor/running
   */
  @Get("running")
  async getRunningTasksAlias() {
    return this.getRunningTasks();
  }

  /**
   * 获取系统指标
   * GET /data-collection/monitor/metrics
   */
  @Get("metrics")
  async getMetrics() {
    const metrics = await this.monitorService.getSystemMetrics();
    return metrics;
  }

  /**
   * 获取任务详情
   * GET /data-collection/monitor/tasks/:id
   */
  @Get("tasks/:id")
  async getTaskDetail(@Param("id") id: string) {
    const detail = await this.monitorService.getTaskDetail(id);
    return detail;
  }

  /**
   * 获取最近日志
   * GET /data-collection/monitor/logs?taskId=xxx
   */
  @Get("logs")
  async getLogs(@Query("taskId") taskId?: string) {
    const logs = await this.monitorService.getRecentLogs(taskId);
    return logs;
  }

  /**
   * 获取性能指标
   * GET /data-collection/monitor/performance?hours=1
   */
  @Get("performance")
  async getPerformance(@Query("hours") hours?: string) {
    const metrics = await this.monitorService.getPerformanceMetrics(
      hours ? parseInt(hours) : 1,
    );
    return metrics;
  }
}

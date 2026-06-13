import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { HistoryService } from "./history.service";
import { CollectionTaskStatus } from "@prisma/client";

@ApiTags("Data Collection - History")
@Controller("data-collection/history")
export class HistoryController {
  constructor(private readonly historyService: HistoryService) {}

  /**
   * 获取历史记录列表
   * GET /data-collection/history
   */
  @Get()
  async getHistory(
    @Query("status") status?: CollectionTaskStatus,
    @Query("sourceId") sourceId?: string,
    @Query("startDate") startDate?: string,
    @Query("endDate") endDate?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    const result = await this.historyService.getHistory({
      status,
      sourceId,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
    });

    return {
      data: result.records,
      total: result.total,
    };
  }

  /**
   * 获取历史统计
   * GET /data-collection/history/stats?period=week
   */
  @Get("stats")
  async getStats(@Query("period") period?: "day" | "week" | "month") {
    const stats = await this.historyService.getStats(period || "week");
    return stats;
  }

  /**
   * 获取任务详细历史
   * GET /data-collection/history/:id
   */
  @Get(":id")
  async getTaskHistory(@Param("id") id: string) {
    const history = await this.historyService.getTaskHistory(id);
    return history;
  }

  /**
   * 删除历史记录
   * DELETE /data-collection/history/:id
   */
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteHistory(@Param("id") id: string) {
    await this.historyService.deleteHistory(id);
  }

  /**
   * 清理旧历史记录
   * DELETE /data-collection/history/cleanup?days=30
   */
  @Delete("cleanup/old")
  async cleanOldHistory(@Query("days") days?: string) {
    const cleaned = await this.historyService.cleanOldHistory(
      days ? parseInt(days) : 30,
    );
    return {
      message: `Cleaned ${cleaned} old records`,
      cleaned,
    };
  }
}

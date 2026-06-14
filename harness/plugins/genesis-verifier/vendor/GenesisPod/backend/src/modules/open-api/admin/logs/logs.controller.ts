import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";
import { LogsService } from "../services/logs.service";

@ApiTags("Admin - Logs")
@Controller("admin/logs")
@UseGuards(JwtAuthGuard, AdminGuard)
export class LogsController {
  constructor(private readonly logsService: LogsService) {}

  @Get("stats")
  async getStats() {
    return this.logsService.getLogsStats();
  }

  @Get("login-history")
  async getLoginHistory(
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Query("search") search?: string,
  ) {
    return this.logsService.getLoginHistory({
      page: page ? parseInt(page, 10) || undefined : undefined,
      limit: limit ? parseInt(limit, 10) || undefined : undefined,
      search,
    });
  }

  @Get("task-history")
  async getTaskHistory(
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Query("status") status?: string,
  ) {
    return this.logsService.getTaskHistory({
      page: page ? parseInt(page, 10) || undefined : undefined,
      limit: limit ? parseInt(limit, 10) || undefined : undefined,
      status,
    });
  }
}

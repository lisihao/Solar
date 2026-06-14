/**
 * AI Kernel Admin Controller
 * 提供 Kernel 进程管理、事件日志查询等管理端点
 * 统一路由前缀: /admin/kernel
 */
import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  UseGuards,
  Logger,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";
import {
  KernelApiService,
  ProcessJournalQueryService,
} from "../../../ai-harness/facade";
import { MemoryLayer, ProcessState } from "@prisma/client";

@ApiTags("Admin - AI Kernel")
@Controller("admin/kernel")
@UseGuards(JwtAuthGuard, AdminGuard)
export class KernelController {
  private readonly logger = new Logger(KernelController.name);

  constructor(
    private readonly kernelApi: KernelApiService,
    private readonly journalService: ProcessJournalQueryService,
  ) {}

  // ─── Process Management ───

  @Get("processes")
  @ApiOperation({ summary: "List all kernel processes" })
  @ApiQuery({
    name: "userId",
    required: false,
    description: "Filter by user ID",
  })
  @ApiQuery({
    name: "states",
    required: false,
    description: "Comma-separated process states filter",
  })
  @ApiQuery({
    name: "limit",
    required: false,
    description: "Max results (default 50)",
  })
  @ApiResponse({ status: 200, description: "List of kernel processes" })
  async listProcesses(
    @Query("userId") userId?: string,
    @Query("states") states?: string,
    @Query("limit") limit?: string,
  ) {
    const validStates = Object.values(ProcessState);
    const stateFilter = states
      ? states
          .split(",")
          .filter((s): s is ProcessState =>
            validStates.includes(s as ProcessState),
          )
      : undefined;
    const maxResults = parseInt(limit ?? "50", 10) || 50;

    const processes = userId
      ? await this.kernelApi.listProcesses(
          userId,
          stateFilter?.length ? stateFilter : undefined,
        )
      : await this.kernelApi.listAllProcesses(
          stateFilter?.length ? stateFilter : undefined,
          maxResults,
        );

    return {
      processes: processes.slice(0, maxResults),
      total: processes.length,
    };
  }

  @Get("processes/:id")
  @ApiOperation({ summary: "Get kernel process details" })
  @ApiResponse({ status: 200, description: "Process details" })
  @ApiResponse({ status: 404, description: "Process not found" })
  async getProcess(@Param("id") processId: string) {
    const process = await this.kernelApi.getProcess(processId);
    if (!process) {
      return { error: "Process not found", processId };
    }
    return process;
  }

  @Get("processes/:id/journal")
  @ApiOperation({ summary: "Get process event journal" })
  @ApiQuery({
    name: "limit",
    required: false,
    description: "Max events (default 100)",
  })
  @ApiQuery({
    name: "offset",
    required: false,
    description: "Pagination offset",
  })
  @ApiResponse({ status: 200, description: "Process event history" })
  async getProcessJournal(
    @Param("id") processId: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    const result = await this.kernelApi.getEventHistory(processId, {
      limit: parseInt(limit ?? "100", 10) || 100,
      offset: parseInt(offset ?? "0", 10) || 0,
    });
    return result;
  }

  @Get("processes/:id/budget")
  @ApiOperation({ summary: "Check process budget status" })
  @ApiResponse({ status: 200, description: "Budget check result" })
  async checkBudget(@Param("id") processId: string) {
    return this.kernelApi.checkBudget(processId);
  }

  // ─── Process Actions ───

  @Post("processes/:id/pause")
  @ApiOperation({ summary: "Pause a running process" })
  @ApiResponse({ status: 200, description: "Process paused" })
  async pauseProcess(@Param("id") processId: string) {
    this.logger.log(`Admin pausing process ${processId}`);
    const process = await this.kernelApi.pauseProcess(processId);
    return { success: true, process };
  }

  @Post("processes/:id/resume")
  @ApiOperation({ summary: "Resume a paused process" })
  @ApiResponse({ status: 200, description: "Process resumed" })
  async resumeProcess(@Param("id") processId: string) {
    this.logger.log(`Admin resuming process ${processId}`);
    const process = await this.kernelApi.resumeProcess(processId);
    return { success: true, process };
  }

  @Post("processes/:id/cancel")
  @ApiOperation({ summary: "Cancel a process" })
  @ApiResponse({ status: 200, description: "Process cancelled" })
  async cancelProcess(@Param("id") processId: string) {
    this.logger.log(`Admin cancelling process ${processId}`);
    const process = await this.kernelApi.cancelProcess(processId);
    return { success: true, process };
  }

  // ─── Mission Actions ───

  @Post("processes/:id/complete")
  @ApiOperation({ summary: "Force-complete a mission process" })
  @ApiResponse({ status: 200, description: "Mission marked complete" })
  async completeMission(@Param("id") processId: string) {
    this.logger.log(`Admin force-completing mission process ${processId}`);
    await this.kernelApi.completeMission(processId, {
      reason: "admin_force_complete",
    });
    return { success: true };
  }

  @Post("processes/:id/fail")
  @ApiOperation({ summary: "Force-fail a mission process" })
  @ApiResponse({ status: 200, description: "Mission marked failed" })
  async failMission(@Param("id") processId: string) {
    this.logger.log(`Admin force-failing mission process ${processId}`);
    await this.kernelApi.failMission(processId, "Admin force-failed");
    return { success: true };
  }

  // ─── Journal (Global) ───

  @Get("journal")
  @ApiOperation({ summary: "List recent events across all processes" })
  @ApiQuery({ name: "processId", required: false })
  @ApiQuery({ name: "type", required: false })
  @ApiQuery({ name: "limit", required: false })
  @ApiResponse({ status: 200, description: "Global event list" })
  async listJournal(
    @Query("processId") processId?: string,
    @Query("type") type?: string,
    @Query("limit") limit?: string,
  ) {
    const take = parseInt(limit ?? "100", 10) || 100;
    return this.journalService.listJournal({ processId, type, take });
  }

  // ─── Memory (Admin) ───

  @Get("memory")
  @ApiOperation({ summary: "Query process memory entries" })
  @ApiQuery({ name: "processId", required: true })
  @ApiQuery({ name: "layer", required: false })
  @ApiQuery({ name: "limit", required: false })
  @ApiResponse({ status: 200, description: "Memory entries" })
  async queryMemory(
    @Query("processId") processId: string,
    @Query("layer") layer?: string,
    @Query("limit") limit?: string,
  ) {
    const query: {
      processId: string;
      layer?: MemoryLayer;
      limit?: number;
    } = { processId };
    if (layer && Object.values(MemoryLayer).includes(layer as MemoryLayer)) {
      query.layer = layer as MemoryLayer;
    }
    if (limit) query.limit = parseInt(limit, 10) || 50;

    const entries = await this.kernelApi.queryMemory(query);
    return { entries, total: entries.length };
  }

  @Delete("memory/:processId/expired")
  @ApiOperation({ summary: "Clean up expired memory entries" })
  @ApiResponse({ status: 200, description: "Cleanup result" })
  async cleanupExpiredMemory(@Param("processId") processId: string) {
    this.logger.log(`Admin cleaning expired memory for process ${processId}`);
    const deleted = await this.kernelApi.cleanupExpiredMemory(processId);
    return { success: true, deleted };
  }

  // ─── IPC ───

  @Get("ipc/stats")
  @ApiOperation({ summary: "Get IPC statistics" })
  @ApiResponse({ status: 200, description: "IPC stats" })
  async getIpcStats() {
    const eventBusStats = this.kernelApi.getEventBusStats();
    const activeTasks = this.kernelApi.getActiveTasks();
    return {
      ...eventBusStats,
      activeTaskCount: activeTasks.length,
    };
  }

  @Get("ipc/progress")
  @ApiOperation({ summary: "List active tracked tasks" })
  @ApiResponse({ status: 200, description: "Active tasks" })
  getActiveProgress() {
    const tasks = this.kernelApi.getActiveTasks();
    return { tasks, total: tasks.length };
  }

  @Get("ipc/messages/:sessionId")
  @ApiOperation({ summary: "Get message bus history for session" })
  @ApiResponse({ status: 200, description: "Message history" })
  getMessageHistory(@Param("sessionId") sessionId: string) {
    const messages = this.kernelApi.getMessageBusHistory(sessionId);
    return { messages, total: messages.length };
  }

  // ─── Resources ───

  @Get("resources/circuit-breakers")
  @ApiOperation({ summary: "Get all circuit breaker health metrics" })
  @ApiResponse({ status: 200, description: "Circuit breaker metrics" })
  getCircuitBreakers() {
    const metrics = this.kernelApi.getCircuitBreakerMetrics();
    return { breakers: metrics, total: metrics.length };
  }

  @Get("resources/circuit-breakers/stats")
  @ApiOperation({ summary: "Get circuit breaker summary stats" })
  @ApiResponse({ status: 200, description: "Circuit breaker stats" })
  getCircuitBreakerStats() {
    return this.kernelApi.getCircuitBreakerStats();
  }

  @Post("resources/circuit-breakers/:id/reset")
  @ApiOperation({ summary: "Reset a circuit breaker" })
  @ApiResponse({ status: 200, description: "Circuit breaker reset" })
  resetCircuitBreaker(@Param("id") entityId: string) {
    this.logger.log(`Admin resetting circuit breaker for ${entityId}`);
    this.kernelApi.resetCircuitBreaker(entityId);
    return { success: true, entityId };
  }

  // ─── Observability ───

  @Get("observability/dashboard")
  @ApiOperation({ summary: "Get LLM metrics dashboard" })
  @ApiQuery({
    name: "period",
    required: false,
    description: "Period in minutes (default 60)",
  })
  @ApiResponse({ status: 200, description: "Observability dashboard" })
  async getDashboard(@Query("period") period?: string) {
    const periodMinutes = parseInt(period ?? "60", 10) || 60;
    const raw = await this.kernelApi.getDashboardWithFallback(periodMinutes);

    return {
      period: {
        startTime: raw.period.start.toISOString(),
        endTime: raw.period.end.toISOString(),
        minutes: periodMinutes,
      },
      totalCalls: raw.totalCalls,
      totalTokens: { input: 0, output: 0, total: raw.totalTokens },
      totalCost: raw.totalCost,
      successRate: raw.successRate,
      latency: {
        p50: raw.avgLatencyMs,
        p95: raw.p95LatencyMs,
        p99: raw.p99LatencyMs,
      },
      fallbackRate: raw.fallbackRate,
      byModel: Object.entries(raw.byModel).map(([model, m]) => ({
        model,
        ...m,
      })),
      byModule: Object.entries(raw.byModule).map(([moduleType, m]) => ({
        moduleType,
        ...m,
      })),
      byUser: raw.byUser,
      recentErrors: raw.recentErrors.map((err, idx) => ({
        id: `err-${idx}`,
        model: err.model,
        error: err.error,
        timestamp:
          err.timestamp instanceof Date
            ? err.timestamp.toISOString()
            : String(err.timestamp),
      })),
    };
  }

  @Get("observability/costs")
  @ApiOperation({ summary: "Get cost attribution report" })
  @ApiQuery({
    name: "hours",
    required: false,
    description: "Period in hours (default 24)",
  })
  @ApiResponse({ status: 200, description: "Cost report" })
  async getCostReport(@Query("hours") hours?: string) {
    const periodHours = parseInt(hours ?? "24", 10) || 24;
    const raw = this.kernelApi.getCostReport({ periodHours });

    return {
      period: {
        hours: periodHours,
        startTime: raw.period.start.toISOString(),
        endTime: raw.period.end.toISOString(),
      },
      totalCost: raw.totalCost,
      totalTokens: { input: 0, output: 0, total: raw.totalTokens },
      byUser: raw.byUser,
      byModule: raw.byModule,
      byModel: raw.byModel,
      hourlyTrend: raw.hourlyTrend,
    };
  }

  @Get("observability/costs/trend")
  @ApiOperation({ summary: "Get hourly cost trend" })
  @ApiQuery({
    name: "hours",
    required: false,
    description: "Hours of history (default 24)",
  })
  @ApiResponse({ status: 200, description: "Hourly cost trend" })
  async getCostTrend(@Query("hours") hours?: string) {
    const h = parseInt(hours ?? "24", 10) || 24;
    const trend = this.kernelApi.getHourlyTrend(h);
    return { trend, total: trend.length };
  }

  // ─── Security ───

  @Get("security/capabilities/:processId")
  @ApiOperation({ summary: "Get process capabilities" })
  @ApiResponse({ status: 200, description: "Process capabilities" })
  async getCapabilities(@Param("processId") processId: string) {
    return this.kernelApi.getCapabilities(processId);
  }

  // ─── Scheduler ───

  @Get("scheduler/stats")
  @ApiOperation({ summary: "Get scheduler statistics" })
  @ApiResponse({ status: 200, description: "Scheduler stats" })
  async getSchedulerStats() {
    return this.kernelApi.getSchedulerStats();
  }
}

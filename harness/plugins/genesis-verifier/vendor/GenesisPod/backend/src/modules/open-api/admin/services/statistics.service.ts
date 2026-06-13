import { Injectable, Logger, Optional } from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { KernelApiService } from "../../../ai-harness/facade";
import { MCPServerService } from "../../../open-api/external/mcp/mcp-server.service";
import { GuardrailsPipelineService } from "../../../ai-engine/facade";

/**
 * Statistics Service
 * Handles system-wide statistics and metrics for admin dashboard
 */
@Injectable()
export class StatisticsService {
  private readonly logger = new Logger(StatisticsService.name);

  constructor(
    private prisma: PrismaService,
    @Optional() private kernelApi?: KernelApiService,
    @Optional() private mcpServer?: MCPServerService,
    @Optional() private guardrailsPipeline?: GuardrailsPipelineService,
  ) {}

  /**
   * 获取 Overview 页面各模块统计数据（供架构图展示）
   */
  async getOverviewStats(): Promise<Record<string, number>> {
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [
      resources,
      researchMissions,
      officeDocuments,
      topics,
      debateSessions,
      simScenarios,
      simRuns,
      writingProjects,
      socialContent,
      tools,
      skills,
      aiModels,
      totalUsers,
      activeUsers,
      secrets,
      kernelProcesses,
      kernelRunning,
      kernelEvents,
      kernelMemories,
      // L1 Infrastructure stats
      adminUsers,
      creditAccounts,
      creditTransactions,
      notifications,
      systemSettings,
      monitoringErrors,
      totalLogins,
      mcpServers,
      // L6/L5/L4/L2 stats
      askSessions,
      agentTraces,
      webhookSubscriptions,
      knowledgeBases,
      feedbackCount,
      agents,
      harnessEvalRuns,
      // L4 Library-specific: bookmarked resources
      bookmarkedResources,
      // L3 Observability: DB-backed LLM call count (last 24h)
      llmCallsDb,
    ] = await Promise.all([
      this.prisma.resource.count(),
      this.prisma.researchMission.count(),
      this.prisma.officeDocument.count(),
      this.prisma.topic.count(),
      this.prisma.debateSession.count(),
      this.prisma.simulationScenario.count(),
      this.prisma.simulationRun.count(),
      this.prisma.writingProject.count(),
      this.prisma.socialContent.count(),
      this.prisma.toolConfig.count(),
      this.prisma.skillConfig.count(),
      this.prisma.aIModel.count(),
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.secret.count(),
      this.safeCount(() => this.prisma.agentProcess.count()),
      this.safeCount(() =>
        this.prisma.agentProcess.count({ where: { state: "RUNNING" } }),
      ),
      this.safeCount(() => this.prisma.processEvent.count()),
      this.safeCount(() => this.prisma.processMemory.count()),
      // L1 Infrastructure stats
      this.prisma.user.count({ where: { role: "ADMIN" } }),
      this.safeCount(() => this.prisma.creditAccount.count()),
      this.safeCount(() => this.prisma.creditTransaction.count()),
      this.safeCount(() => this.prisma.notification.count()),
      this.safeCount(() => this.prisma.systemSetting.count()),
      this.safeCount(() =>
        this.prisma.systemErrorLog.count({
          where: { createdAt: { gte: last24h } },
        }),
      ),
      this.safeCount(() => this.prisma.loginHistory.count()),
      this.safeCount(() => this.prisma.mCPServerConfig.count()),
      // L6 Ask sessions, L6 Agent traces, L5 Webhooks, L4 RAG, L4 Feedback, L2 Agents
      this.safeCount(() => this.prisma.askSession.count()),
      this.safeCount(() => this.prisma.agentTrace.count()),
      this.safeCount(() => this.prisma.webhookSubscription.count()),
      this.safeCount(() => this.prisma.knowledgeBase.count()),
      this.safeCount(() => this.prisma.feedback.count()),
      this.safeCount(() => this.prisma.agentConfig.count()),
      this.getHarnessEvalRunCount(),
      // L4 Library: user-saved items in collections
      this.safeCount(() => this.prisma.collectionItem.count()),
      // L3 Observability: LLM calls persisted in DB (last 24h)
      this.safeCount(() =>
        this.prisma.aIEngineMetric.count({
          where: {
            metricType: "llm_call",
            createdAt: { gte: last24h },
          },
        }),
      ),
    ]);

    // Kernel in-memory stats (IPC, Resources)
    const kernelInMemory = this.getKernelInMemoryStats();

    // MCP Server registered tools (runtime count)
    const mcpRegisteredTools = this.getMcpRegisteredTools();

    // DB table count (from PostgreSQL information_schema)
    const dbTables = await this.getDbTableCount();

    return {
      resources,
      researchMissions,
      officeDocuments,
      topics,
      debateSessions,
      simScenarios,
      simRuns,
      writingProjects,
      socialContent,
      tools,
      skills,
      aiModels,
      totalUsers,
      activeUsers,
      secrets,
      kernelProcesses,
      kernelRunning,
      kernelEvents,
      kernelMemories,
      ...kernelInMemory,
      // L1 Infrastructure
      adminUsers,
      creditAccounts,
      creditTransactions,
      notifications,
      dbTables,
      storageProviders: 5, // static: 5 supported providers
      systemSettings,
      totalLogins,
      monitoringErrors,
      // L3 Engine
      mcpServers,
      agents,
      knowledgeBases,
      guardrailRules: this.getGuardrailRulesCount(),
      // L3 Observability: use DB count when in-memory is 0
      kernelLLMCalls:
        kernelInMemory.kernelLLMCalls > 0
          ? kernelInMemory.kernelLLMCalls
          : llmCallsDb,
      // L5 Open API
      webhookSubscriptions,
      mcpRegisteredTools,
      // L6 Gateway
      askSessions,
      agentTraces,
      // L4 Apps
      feedbackCount,
      bookmarkedResources,
      harnessEvalRuns,
    };
  }

  /**
   * Kernel in-memory stats (not in database)
   * IPC subscriptions, circuit breakers, LLM call counts
   */
  private getKernelInMemoryStats(): Record<string, number> {
    if (!this.kernelApi) {
      return { kernelSubscriptions: 0, kernelBreakers: 0, kernelLLMCalls: 0 };
    }

    try {
      const ipcStats = this.kernelApi.getEventBusStats();
      const breakers = this.kernelApi.getCircuitBreakerMetrics();
      const dashboard = this.kernelApi.getDashboard(60);

      return {
        kernelSubscriptions: ipcStats.activeSubscriptions,
        kernelBreakers: breakers.length,
        kernelLLMCalls: dashboard.totalCalls,
      };
    } catch {
      return { kernelSubscriptions: 0, kernelBreakers: 0, kernelLLMCalls: 0 };
    }
  }

  /** Guardrail rules count from pipeline service */
  private getGuardrailRulesCount(): number {
    if (!this.guardrailsPipeline) return 0;
    try {
      return this.guardrailsPipeline.getRegisteredGuardrails().totalRules;
    } catch {
      return 0;
    }
  }

  /** MCP Server runtime registered tool count */
  private getMcpRegisteredTools(): number {
    if (!this.mcpServer) return 0;
    try {
      return this.mcpServer.getDetailedStatus().totalToolCount;
    } catch {
      return 0;
    }
  }

  /** Count real DB tables from PostgreSQL information_schema */
  private async getDbTableCount(): Promise<number> {
    try {
      const result = await this.prisma.$queryRaw<[{ count: bigint }]>`
        SELECT count(*)::bigint as count
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      `;
      return Number(result[0]?.count ?? 0);
    } catch (e) {
      this.logger.warn(`Failed to query DB table count: ${e}`);
      return 0;
    }
  }

  private async getHarnessEvalRunCount(): Promise<number> {
    try {
      const result = await this.prisma.$queryRaw<[{ count: bigint }]>`
        SELECT count(*)::bigint as count
        FROM "harness_eval_runs"
      `;
      return Number(result[0]?.count ?? 0);
    } catch {
      return 0;
    }
  }

  /** Table-safe count — returns 0 if the table does not exist */
  private async safeCount(fn: () => Promise<number>): Promise<number> {
    try {
      return await fn();
    } catch {
      return 0;
    }
  }

  /**
   * 获取系统统计信息
   */
  async getSystemStats() {
    const [
      totalUsers,
      activeUsers,
      totalResources,
      resourcesByType,
      recentUsers,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.resource.count(),
      this.prisma.resource.groupBy({
        by: ["type"],
        _count: { type: true },
      }),
      this.prisma.user.count({
        where: {
          createdAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          },
        },
      }),
    ]);

    return {
      users: {
        total: totalUsers,
        active: activeUsers,
        newLast7Days: recentUsers,
      },
      resources: {
        total: totalResources,
        byType: resourcesByType.reduce(
          (
            acc: Record<string, number>,
            item: { type: string; _count: { type: number } },
          ) => {
            acc[item.type] = item._count.type;
            return acc;
          },
          {} as Record<string, number>,
        ),
      },
    };
  }
}

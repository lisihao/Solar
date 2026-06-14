import { Injectable, Logger, Optional } from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { KernelApiService } from "../../../ai-harness/facade";
import { GuardrailsPipelineService } from "../../../ai-engine/facade";

export type CardHealth = "healthy" | "degraded" | "down";

export interface CardStatus {
  status: CardHealth;
  /** 动态指标（key 与前端 architecture.ts 的 statusMetrics 对应） */
  metrics: Record<string, number>;
}

export interface OverviewStatusDto {
  timestamp: string;
  global: {
    healthScore: number;
    status: "healthy" | "degraded" | "unhealthy";
    dbStatus: "healthy" | "unhealthy";
    dbLatencyMs: number;
    errors24h: number;
    critical24h: number;
    llmCalls24h: number;
    llmSuccessRate24h: number;
    runningProcesses: number;
    openBreakers: number;
  };
  /** key = 架构图卡片 id（frontend/lib/features/admin/architecture.ts） */
  cards: Record<string, CardStatus>;
}

/** 成功率告警阈值（%），与 monitoring.controller 的 aiMetrics 阈值一致 */
const RATE_DEGRADED_BELOW = 95;
const RATE_DOWN_BELOW = 50;
/** 样本数低于该值时不依据成功率判定状态（避免冷启动误报） */
const RATE_MIN_SAMPLES = 10;
const DB_LATENCY_DEGRADED_MS = 500;
const ERRORS_24H_DEGRADED_AT = 50;

/**
 * Overview Status Service
 * 架构图实时状态聚合：每张卡片的健康状态 + 动态指标 + 全局健康分。
 * 设计约束：供前端 30s 轮询，只做廉价查询（indexed count / 内存读取），
 * 不调用 diagnoseAllCapabilities 等重诊断。
 */
@Injectable()
export class OverviewStatusService {
  private readonly logger = new Logger(OverviewStatusService.name);

  constructor(
    private prisma: PrismaService,
    @Optional() private kernelApi?: KernelApiService,
    @Optional() private guardrailsPipeline?: GuardrailsPipelineService,
  ) {}

  async getOverviewStatus(): Promise<OverviewStatusDto> {
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [
      // L2.5 Harness execution
      running,
      failed24h,
      zombie,
      // L2.5 memory
      memories,
      events24h,
      // L3 apps
      researchActive,
      researchFailed24h,
      topics24h,
      debates24h,
      simRuns24h,
      docs24h,
      social24h,
      // L2 engine: LLM / tool 调用质量
      llmCalls24h,
      llmSuccess24h,
      toolExec24h,
      toolSuccess24h,
      // L1
      errors24h,
      critical24h,
      logins24h,
      activeUsers24h,
      pendingKeyRequests,
      secrets,
      evalRuns,
      // DB
      dbHealth,
      poolStats,
    ] = await Promise.all([
      this.safeCount(() =>
        this.prisma.agentProcess.count({ where: { state: "RUNNING" } }),
      ),
      this.safeCount(() =>
        this.prisma.agentProcess.count({
          where: { state: "FAILED", updatedAt: { gte: last24h } },
        }),
      ),
      this.safeCount(() =>
        this.prisma.agentProcess.count({ where: { state: "ZOMBIE" } }),
      ),
      this.safeCount(() => this.prisma.processMemory.count()),
      this.safeCount(() =>
        this.prisma.processEvent.count({
          where: { createdAt: { gte: last24h } },
        }),
      ),
      this.safeCount(() =>
        this.prisma.researchMission.count({
          where: { status: { in: ["PLANNING", "EXECUTING", "REVIEWING"] } },
        }),
      ),
      this.safeCount(() =>
        this.prisma.researchMission.count({
          where: { status: "FAILED", updatedAt: { gte: last24h } },
        }),
      ),
      this.safeCount(() =>
        this.prisma.topic.count({ where: { createdAt: { gte: last24h } } }),
      ),
      this.safeCount(() =>
        this.prisma.debateSession.count({
          where: { createdAt: { gte: last24h } },
        }),
      ),
      this.safeCount(() =>
        this.prisma.simulationRun.count({
          where: { createdAt: { gte: last24h } },
        }),
      ),
      this.safeCount(() =>
        this.prisma.officeDocument.count({
          where: { createdAt: { gte: last24h } },
        }),
      ),
      this.safeCount(() =>
        this.prisma.socialContent.count({
          where: { createdAt: { gte: last24h } },
        }),
      ),
      this.safeCount(() =>
        this.prisma.aIEngineMetric.count({
          where: { metricType: "llm_call", createdAt: { gte: last24h } },
        }),
      ),
      this.safeCount(() =>
        this.prisma.aIEngineMetric.count({
          where: {
            metricType: "llm_call",
            createdAt: { gte: last24h },
            success: true,
          },
        }),
      ),
      this.safeCount(() =>
        this.prisma.aIEngineMetric.count({
          where: { metricType: "tool_execution", createdAt: { gte: last24h } },
        }),
      ),
      this.safeCount(() =>
        this.prisma.aIEngineMetric.count({
          where: {
            metricType: "tool_execution",
            createdAt: { gte: last24h },
            success: true,
          },
        }),
      ),
      this.safeCount(() =>
        this.prisma.systemErrorLog.count({
          where: { createdAt: { gte: last24h } },
        }),
      ),
      this.safeCount(() =>
        this.prisma.systemErrorLog.count({
          where: { severity: "critical", createdAt: { gte: last24h } },
        }),
      ),
      this.safeCount(() =>
        this.prisma.loginHistory.count({
          where: { loginAt: { gte: last24h } },
        }),
      ),
      this.getDistinctActiveUsers(last24h),
      this.safeCount(() =>
        this.prisma.keyRequest.count({ where: { status: "PENDING" } }),
      ),
      this.safeCount(() => this.prisma.secret.count()),
      this.getHarnessEvalRunCount(),
      this.prisma.healthCheck(),
      this.prisma.getPoolStats(),
    ]);

    const kernel = this.getKernelInMemoryStats();
    const guardrailRules = this.getGuardrailRulesCount();

    const llmRate = this.successRate(llmSuccess24h, llmCalls24h);
    const toolRate = this.successRate(toolSuccess24h, toolExec24h);
    const dbDown = dbHealth.status !== "healthy";

    const rateStatus = (rate: number, samples: number): CardHealth => {
      if (samples < RATE_MIN_SAMPLES) return "healthy";
      if (rate < RATE_DOWN_BELOW) return "down";
      if (rate < RATE_DEGRADED_BELOW) return "degraded";
      return "healthy";
    };

    const cards: Record<string, CardStatus> = {
      // ===== L3 AI Apps =====
      aiAppsInsights: {
        status: researchFailed24h > 0 ? "degraded" : "healthy",
        metrics: { researchActive, researchFailed24h, topics24h },
      },
      aiAppsPlanning: {
        status: "healthy",
        metrics: { debates24h, simRuns24h },
      },
      aiAppsContent: {
        status: "healthy",
        metrics: { docs24h, social24h },
      },
      aiAppsLabs: {
        status: rateStatus(toolRate, toolExec24h),
        metrics: { toolExec24h, toolSuccessRate24h: toolRate },
      },
      // ===== L2.5 AI Harness =====
      harnessExecution: {
        status: failed24h > 0 || zombie > 0 ? "degraded" : "healthy",
        metrics: { running, failed24h, zombie },
      },
      harnessMemory: {
        status: "healthy",
        metrics: { memories, events24h },
      },
      harnessGovernance: {
        status: "healthy",
        metrics: { evalRuns, guardrailRules },
      },
      harnessInterop: {
        status: "healthy",
        metrics: {
          subscriptions: kernel.subscriptions,
          breakers: kernel.breakers,
        },
      },
      // ===== L2 AI Engine =====
      models: {
        status:
          kernel.openBreakers > 0
            ? "degraded"
            : rateStatus(llmRate, llmCalls24h),
        metrics: {
          llmCalls24h,
          llmSuccessRate24h: llmRate,
          openBreakers: kernel.openBreakers,
        },
      },
      tools: {
        status: rateStatus(toolRate, toolExec24h),
        metrics: { toolExec24h, toolSuccessRate24h: toolRate },
      },
      skills: { status: "healthy", metrics: {} },
      knowledge: { status: "healthy", metrics: {} },
      // ===== L1 Infrastructure =====
      userManagement: {
        status: "healthy",
        metrics: { activeUsers24h, logins24h },
      },
      secretManagement: {
        status: pendingKeyRequests > 0 ? "degraded" : "healthy",
        metrics: { pendingKeyRequests, secrets },
      },
      dataManagement: {
        status: dbDown
          ? "down"
          : dbHealth.latency > DB_LATENCY_DEGRADED_MS
            ? "degraded"
            : "healthy",
        metrics: {
          dbLatencyMs: dbHealth.latency,
          activeConnections: poolStats.activeConnections,
        },
      },
      systemManagement: {
        status: dbDown
          ? "down"
          : critical24h > 0 || errors24h >= ERRORS_24H_DEGRADED_AT
            ? "degraded"
            : "healthy",
        metrics: { errors24h, critical24h },
      },
    };

    const healthScore = this.calculateHealthScore(cards, critical24h);

    return {
      timestamp: new Date().toISOString(),
      global: {
        healthScore,
        status:
          healthScore >= 80
            ? "healthy"
            : healthScore >= 50
              ? "degraded"
              : "unhealthy",
        dbStatus: dbDown ? "unhealthy" : "healthy",
        dbLatencyMs: dbHealth.latency,
        errors24h,
        critical24h,
        llmCalls24h,
        llmSuccessRate24h: llmRate,
        runningProcesses: running,
        openBreakers: kernel.openBreakers,
      },
      cards,
    };
  }

  /** 健康分：满分 100，按卡片状态与严重错误扣分（轮询用的轻量算法） */
  private calculateHealthScore(
    cards: Record<string, CardStatus>,
    critical24h: number,
  ): number {
    let score = 100;
    for (const card of Object.values(cards)) {
      if (card.status === "down") score -= 20;
      else if (card.status === "degraded") score -= 7;
    }
    score -= Math.min(critical24h * 5, 20);
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  private successRate(success: number, total: number): number {
    if (total <= 0) return 100;
    return Math.round((success / total) * 100 * 10) / 10;
  }

  /** Kernel 内存态指标（IPC 订阅、熔断器） */
  private getKernelInMemoryStats(): {
    subscriptions: number;
    breakers: number;
    openBreakers: number;
  } {
    if (!this.kernelApi) {
      return { subscriptions: 0, breakers: 0, openBreakers: 0 };
    }
    try {
      const ipc = this.kernelApi.getEventBusStats();
      const breakers = this.kernelApi.getCircuitBreakerMetrics() as Array<{
        state?: string;
      }>;
      return {
        subscriptions: ipc.activeSubscriptions,
        breakers: breakers.length,
        openBreakers: breakers.filter((b) => b.state === "OPEN").length,
      };
    } catch {
      return { subscriptions: 0, breakers: 0, openBreakers: 0 };
    }
  }

  private getGuardrailRulesCount(): number {
    if (!this.guardrailsPipeline) return 0;
    try {
      return this.guardrailsPipeline.getRegisteredGuardrails().totalRules;
    } catch {
      return 0;
    }
  }

  /** 24h 内有登录记录的去重用户数 */
  private async getDistinctActiveUsers(since: Date): Promise<number> {
    try {
      const result = await this.prisma.$queryRaw<[{ count: bigint }]>`
        SELECT count(DISTINCT user_id)::bigint as count
        FROM "login_history"
        WHERE login_at >= ${since}
      `;
      return Number(result[0]?.count ?? 0);
    } catch {
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

  /** 表不存在等异常时返回 0，保证状态接口永不 500 */
  private async safeCount(fn: () => Promise<number>): Promise<number> {
    try {
      return await fn();
    } catch (e) {
      this.logger.debug(`overview-status count failed: ${e}`);
      return 0;
    }
  }
}

/**
 * Unified Health Check Service
 *
 * 提供全平台健康检查，聚合所有子系统状态：
 * - 数据库 (PostgreSQL via Prisma)
 * - 缓存 (Redis)
 * - AI Engine (LLM 可用性、可观测性)
 * - MCP Server (会话管理)
 *
 * 返回标准化的健康状态响应，支持：
 * - 总体状态 (healthy / degraded / unhealthy)
 * - 各子系统独立状态
 * - 延迟指标
 * - AI Engine 仪表盘快照
 */

import { Injectable, Optional, Inject } from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { CacheService } from "../../../../common/cache/cache.service";
import {
  type IAiObservability,
  AI_OBSERVABILITY_TOKEN,
} from "../../abstractions/ai-services.interface";
import { APP_CONFIG } from "../../../../common/config/app.config";

/**
 * 子系统健康状态
 */
export interface SubsystemHealth {
  status: "healthy" | "degraded" | "unhealthy";
  latencyMs?: number;
  message?: string;
  details?: Record<string, unknown>;
}

/**
 * 完整健康检查响应
 */
export interface HealthCheckResponse {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  service: string;
  version: string;
  uptime: number;
  subsystems: Record<string, SubsystemHealth>;
  ai?: {
    totalCalls: number;
    successRate: number;
    avgLatencyMs: number;
    activeModels: number;
  };
}

@Injectable()
export class HealthCheckService {
  private readonly startedAt = new Date();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly cache?: CacheService,
    @Inject(AI_OBSERVABILITY_TOKEN)
    @Optional()
    private readonly observability?: IAiObservability,
  ) {}

  /**
   * 执行全面健康检查
   */
  async check(): Promise<HealthCheckResponse> {
    const subsystems: Record<string, SubsystemHealth> = {};

    // 并行执行所有检查
    const [dbHealth, cacheHealth, aiHealth] = await Promise.allSettled([
      this.checkDatabase(),
      this.checkCache(),
      this.checkAiEngine(),
    ]);

    subsystems.database =
      dbHealth.status === "fulfilled"
        ? dbHealth.value
        : { status: "unhealthy", message: "Check failed" };

    subsystems.cache =
      cacheHealth.status === "fulfilled"
        ? cacheHealth.value
        : { status: "unhealthy", message: "Check failed" };

    subsystems.aiEngine =
      aiHealth.status === "fulfilled"
        ? aiHealth.value
        : { status: "unhealthy", message: "Check failed" };

    // 计算总体状态
    const statuses = Object.values(subsystems).map((s) => s.status);
    let overallStatus: "healthy" | "degraded" | "unhealthy" = "healthy";

    if (statuses.includes("unhealthy")) {
      // 数据库不健康 = 整体不健康，其他不健康 = 降级
      overallStatus =
        subsystems.database?.status === "unhealthy" ? "unhealthy" : "degraded";
    } else if (statuses.includes("degraded")) {
      overallStatus = "degraded";
    }

    // AI Engine 仪表盘快照
    let ai: HealthCheckResponse["ai"];
    if (this.observability) {
      try {
        const dashboard = this.observability.getDashboard(60);
        ai = {
          totalCalls: dashboard.totalCalls,
          successRate: dashboard.successRate,
          avgLatencyMs: dashboard.avgLatencyMs,
          activeModels: Object.keys(dashboard.byModel).length,
        };
      } catch {
        // Dashboard snapshot is best-effort; don't fail the health check
      }
    }

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      service: APP_CONFIG.brand.fullName,
      version: process.env.npm_package_version || "3.70.0",
      uptime: Math.floor((Date.now() - this.startedAt.getTime()) / 1000),
      subsystems,
      ai,
    };
  }

  /**
   * 检查数据库连接
   */
  private async checkDatabase(): Promise<SubsystemHealth> {
    const start = Date.now();
    try {
      const result = await this.prisma.healthCheck();
      return {
        status: result.status === "healthy" ? "healthy" : "unhealthy",
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      return {
        status: "unhealthy",
        latencyMs: Date.now() - start,
        message:
          error instanceof Error ? error.message : "Database unreachable",
      };
    }
  }

  /**
   * 检查缓存服务
   */
  private async checkCache(): Promise<SubsystemHealth> {
    if (!this.cache) {
      return { status: "degraded", message: "Cache service not available" };
    }

    const start = Date.now();
    try {
      const testKey = "__health_check__";
      await this.cache.set(testKey, "ok", 10);
      const val = await this.cache.get<string>(testKey);
      return {
        status: val === "ok" ? "healthy" : "unhealthy",
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      return {
        status: "unhealthy",
        latencyMs: Date.now() - start,
        message: error instanceof Error ? error.message : "Cache unavailable",
      };
    }
  }

  /**
   * 检查 AI Engine 状态
   */
  private async checkAiEngine(): Promise<SubsystemHealth> {
    if (!this.observability) {
      return { status: "degraded", message: "Observability not available" };
    }

    try {
      const dashboard = this.observability.getDashboard(5); // Last 5 minutes

      // AI Engine is degraded if error rate > 50% in recent calls
      if (dashboard.totalCalls > 0 && dashboard.successRate < 0.5) {
        return {
          status: "degraded",
          message: `High error rate: ${((1 - dashboard.successRate) * 100).toFixed(1)}%`,
          details: {
            totalCalls: dashboard.totalCalls,
            successRate: dashboard.successRate,
            avgLatencyMs: dashboard.avgLatencyMs,
          },
        };
      }

      return {
        status: "healthy",
        details: {
          totalCalls: dashboard.totalCalls,
          successRate: dashboard.successRate,
          avgLatencyMs: dashboard.avgLatencyMs,
        },
      };
    } catch (error) {
      return {
        status: "unhealthy",
        message:
          error instanceof Error ? error.message : "AI Engine check failed",
      };
    }
  }
}

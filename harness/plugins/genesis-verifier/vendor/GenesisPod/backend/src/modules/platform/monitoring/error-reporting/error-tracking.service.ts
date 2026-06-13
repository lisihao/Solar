import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { Prisma } from "@prisma/client";
import * as crypto from "crypto";

/**
 * 错误聚合结果
 */
export interface ErrorAggregation {
  errorCode: string;
  count: number;
  latestMessage: string;
  latestOccurrence: Date;
  severity: string;
  component: string | null;
}

/**
 * 错误统计摘要
 */
export interface ErrorStats {
  total: number;
  critical: number;
  error: number;
  warning: number;
  resolved: number;
  unresolved: number;
  byComponent: Record<string, number>;
  byErrorCode: Record<string, number>;
  trend: Array<{ date: string; count: number }>;
}

/**
 * 系统错误跟踪服务
 * 提供错误收集、聚合、查询功能
 * 替代 Sentry 的核心功能
 */
@Injectable()
export class ErrorTrackingService {
  private readonly logger = new Logger(ErrorTrackingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 记录错误
   */
  async logError(params: {
    errorCode: string;
    errorType: string;
    message: string;
    stackTrace?: string;
    severity?: "warning" | "error" | "critical";
    component?: string;
    path?: string;
    method?: string;
    statusCode?: number;
    userId?: string;
    requestId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<string> {
    // 生成错误指纹用于聚合
    const fingerprint = this.generateFingerprint(
      params.errorCode,
      params.message,
      params.stackTrace,
    );

    const record = await this.prisma.systemErrorLog.create({
      data: {
        errorCode: params.errorCode,
        errorType: params.errorType,
        message: params.message,
        stackTrace: params.stackTrace,
        severity: params.severity || "error",
        component: params.component,
        path: params.path,
        method: params.method,
        statusCode: params.statusCode,
        userId: params.userId,
        requestId: params.requestId,
        fingerprint,
        metadata: (params.metadata || {}) as Prisma.InputJsonValue,
      },
    });

    this.logger.warn(
      `[ErrorTracking] ${params.severity || "error"}: ${params.errorCode} - ${params.message.substring(0, 100)}`,
    );

    return record.id;
  }

  /**
   * 获取错误统计摘要
   */
  async getErrorStats(options?: {
    startDate?: Date;
    endDate?: Date;
    component?: string;
  }): Promise<ErrorStats> {
    const where: Record<string, unknown> = {};

    if (options?.startDate || options?.endDate) {
      where.createdAt = {};
      if (options?.startDate) {
        (where.createdAt as Record<string, unknown>).gte = options.startDate;
      }
      if (options?.endDate) {
        (where.createdAt as Record<string, unknown>).lte = options.endDate;
      }
    }

    if (options?.component) {
      where.component = options.component;
    }

    // 并行查询各项统计
    const [
      total,
      critical,
      error,
      warning,
      resolved,
      byComponent,
      byErrorCode,
      trendData,
    ] = await Promise.all([
      this.prisma.systemErrorLog.count({ where }),
      this.prisma.systemErrorLog.count({
        where: { ...where, severity: "critical" },
      }),
      this.prisma.systemErrorLog.count({
        where: { ...where, severity: "error" },
      }),
      this.prisma.systemErrorLog.count({
        where: { ...where, severity: "warning" },
      }),
      this.prisma.systemErrorLog.count({ where: { ...where, resolved: true } }),
      this.prisma.systemErrorLog.groupBy({
        by: ["component"],
        where,
        _count: { id: true },
      }),
      this.prisma.systemErrorLog.groupBy({
        by: ["errorCode"],
        where,
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 10,
      }),
      this.getTrendData(where),
    ]);

    return {
      total,
      critical,
      error,
      warning,
      resolved,
      unresolved: total - resolved,
      byComponent: byComponent.reduce(
        (acc, item) => {
          acc[item.component || "unknown"] = item._count.id;
          return acc;
        },
        {} as Record<string, number>,
      ),
      byErrorCode: byErrorCode.reduce(
        (acc, item) => {
          acc[item.errorCode] = item._count.id;
          return acc;
        },
        {} as Record<string, number>,
      ),
      trend: trendData,
    };
  }

  /**
   * 获取错误聚合列表
   */
  async getAggregatedErrors(options?: {
    startDate?: Date;
    endDate?: Date;
    severity?: string;
    component?: string;
    resolved?: boolean;
    limit?: number;
  }): Promise<ErrorAggregation[]> {
    const where: Record<string, unknown> = {};

    if (options?.startDate || options?.endDate) {
      where.createdAt = {};
      if (options?.startDate) {
        (where.createdAt as Record<string, unknown>).gte = options.startDate;
      }
      if (options?.endDate) {
        (where.createdAt as Record<string, unknown>).lte = options.endDate;
      }
    }

    if (options?.severity) {
      where.severity = options.severity;
    }

    if (options?.component) {
      where.component = options.component;
    }

    if (options?.resolved !== undefined) {
      where.resolved = options.resolved;
    }

    // 按 errorCode 聚合
    const aggregations = await this.prisma.systemErrorLog.groupBy({
      by: ["errorCode", "severity", "component"],
      where,
      _count: { id: true },
      _max: { createdAt: true, message: true },
      orderBy: { _count: { id: "desc" } },
      take: options?.limit || 50,
    });

    return aggregations.map((agg) => ({
      errorCode: agg.errorCode,
      count: agg._count.id,
      latestMessage: agg._max.message || "",
      latestOccurrence: agg._max.createdAt || new Date(),
      severity: agg.severity,
      component: agg.component,
    }));
  }

  /**
   * 获取错误详情列表
   */
  async getErrorList(options?: {
    startDate?: Date;
    endDate?: Date;
    errorCode?: string;
    severity?: string;
    component?: string;
    resolved?: boolean;
    limit?: number;
    offset?: number;
  }) {
    const where: Record<string, unknown> = {};

    if (options?.startDate || options?.endDate) {
      where.createdAt = {};
      if (options?.startDate) {
        (where.createdAt as Record<string, unknown>).gte = options.startDate;
      }
      if (options?.endDate) {
        (where.createdAt as Record<string, unknown>).lte = options.endDate;
      }
    }

    if (options?.errorCode) {
      where.errorCode = options.errorCode;
    }

    if (options?.severity) {
      where.severity = options.severity;
    }

    if (options?.component) {
      where.component = options.component;
    }

    if (options?.resolved !== undefined) {
      where.resolved = options.resolved;
    }

    const [errors, total] = await Promise.all([
      this.prisma.systemErrorLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: options?.limit || 50,
        skip: options?.offset || 0,
        select: {
          id: true,
          errorCode: true,
          errorType: true,
          severity: true,
          component: true,
          message: true,
          path: true,
          method: true,
          statusCode: true,
          userId: true,
          resolved: true,
          createdAt: true,
        },
      }),
      this.prisma.systemErrorLog.count({ where }),
    ]);

    return { errors, total };
  }

  /**
   * 获取错误详情
   */
  async getErrorDetail(id: string) {
    return this.prisma.systemErrorLog.findUnique({
      where: { id },
    });
  }

  /**
   * 标记错误为已解决
   */
  async resolveError(id: string, resolvedBy: string) {
    return this.prisma.systemErrorLog.update({
      where: { id },
      data: {
        resolved: true,
        resolvedAt: new Date(),
        resolvedBy,
      },
    });
  }

  /**
   * 批量标记错误为已解决（按错误码）
   */
  async resolveErrorsByCode(errorCode: string, resolvedBy: string) {
    const result = await this.prisma.systemErrorLog.updateMany({
      where: { errorCode, resolved: false },
      data: {
        resolved: true,
        resolvedAt: new Date(),
        resolvedBy,
      },
    });

    this.logger.log(
      `[ErrorTracking] Resolved ${result.count} errors with code: ${errorCode}`,
    );

    return { resolved: result.count };
  }

  /**
   * 获取趋势数据（过去 7 天）
   */
  private async getTrendData(
    baseWhere: Record<string, unknown>,
  ): Promise<Array<{ date: string; count: number }>> {
    const trend: Array<{ date: string; count: number }> = [];
    const now = new Date();

    for (let i = 6; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);

      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      const count = await this.prisma.systemErrorLog.count({
        where: {
          ...baseWhere,
          createdAt: {
            gte: date,
            lt: nextDate,
          },
        },
      });

      trend.push({
        date: date.toISOString().split("T")[0],
        count,
      });
    }

    return trend;
  }

  /**
   * 生成错误指纹用于聚合
   */
  private generateFingerprint(
    errorCode: string,
    message: string,
    stackTrace?: string,
  ): string {
    // 提取栈顶位置作为指纹的一部分
    let stackLocation = "";
    if (stackTrace) {
      const firstLine = stackTrace.split("\n")[1] || "";
      stackLocation = firstLine.trim().substring(0, 100);
    }

    const content = `${errorCode}:${message.substring(0, 200)}:${stackLocation}`;
    return crypto
      .createHash("md5")
      .update(content)
      .digest("hex")
      .substring(0, 16);
  }

  /**
   * 清理旧错误日志（保留最近 30 天）
   */
  async cleanupOldErrors(daysToKeep: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = await this.prisma.systemErrorLog.deleteMany({
      where: {
        createdAt: { lt: cutoffDate },
        resolved: true, // 只清理已解决的
      },
    });

    this.logger.log(
      `[ErrorTracking] Cleaned up ${result.count} old error logs`,
    );

    return result.count;
  }
}

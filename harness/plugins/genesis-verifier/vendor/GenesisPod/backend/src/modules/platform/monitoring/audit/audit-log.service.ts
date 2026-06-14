import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../../common/prisma/prisma.service";

/**
 * 高敏操作审计 — append-only 写入 audit_logs。
 *
 * 设计原则：
 * - append-only：只 create，永不 update/delete（合规留痕）。
 * - 写失败不可吞错也不可阻断主操作：结构化 logger.warn('audit_write_failed')，
 *   让审计写失败本身可观测，但高敏主操作（冻结/删除/取消）继续完成。
 *
 * 写入点（真实调用）：
 * - CreditsService.freezeAccount         → 'credit.freeze'
 * - SecretsService.getValue              → 'secret.access'
 * - AgentPlaygroundController.cancel     → 'mission.cancel'
 * - AgentPlaygroundController.delete     → 'mission.delete'
 */

export type AuditResult = "success" | "denied" | "error";

export interface AuditRecordInput {
  actorUserId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string;
  result: AuditResult;
  ip?: string;
  traceId?: string;
  metadata?: Record<string, unknown>;
}

export interface AuditQueryFilter {
  actorUserId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  result?: AuditResult;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * append-only 写一条审计记录。写失败不抛错（不阻断主操作），但结构化 warn 留痕。
   */
  async record(input: AuditRecordInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorUserId: input.actorUserId ?? null,
          action: input.action,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          result: input.result,
          ip: input.ip,
          traceId: input.traceId,
          metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      // 审计写失败本身要可观测，但绝不阻断主操作。
      this.logger.warn(
        `audit_write_failed action=${input.action} resourceType=${input.resourceType} ` +
          `resourceId=${input.resourceId ?? "-"} actorUserId=${input.actorUserId ?? "-"} ` +
          `error=${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 读审计记录（按 filter）。倒序返回，含分页。
   */
  async query(filter: AuditQueryFilter = {}) {
    const where: Prisma.AuditLogWhereInput = {};

    if (filter.actorUserId) where.actorUserId = filter.actorUserId;
    if (filter.action) where.action = filter.action;
    if (filter.resourceType) where.resourceType = filter.resourceType;
    if (filter.resourceId) where.resourceId = filter.resourceId;
    if (filter.result) where.result = filter.result;

    if (filter.startDate || filter.endDate) {
      where.createdAt = {};
      if (filter.startDate) where.createdAt.gte = filter.startDate;
      if (filter.endDate) where.createdAt.lte = filter.endDate;
    }

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: filter.limit ?? 50,
        skip: filter.offset ?? 0,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { items, total };
  }
}

import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import {
  StoryBibleChangeType,
  StoryBibleEntityType,
  StoryBibleAuditLog,
  Prisma,
} from "@prisma/client";

/**
 * StoryBibleAuditService - Story Bible 审计日志服务 (P1-B02)
 *
 * 核心职责：
 * - 记录 StoryBible 所有变更
 * - 支持变更历史查询
 * - 支持版本对比
 */

export interface AuditLogEntry {
  id: string;
  bibleId: string;
  version: number;
  changeType: "CREATE" | "UPDATE" | "DELETE";
  entityType:
    | "BIBLE"
    | "CHARACTER"
    | "WORLD_SETTING"
    | "TIMELINE"
    | "TERMINOLOGY"
    | "FACTION";
  entityId?: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  changedBy: string; // 'user' | 'story-architect' | 'bible-keeper' 等
  reason?: string;
  createdAt: Date;
}

export interface CreateAuditLogDto {
  bibleId: string;
  version: number;
  changeType: StoryBibleChangeType;
  entityType: StoryBibleEntityType;
  entityId?: string;
  field: string;
  oldValue?: unknown;
  newValue?: unknown;
  changedBy: string;
  reason?: string;
}

export interface ChangeHistoryOptions {
  entityType?: StoryBibleEntityType;
  entityId?: string;
  limit?: number;
  offset?: number;
  startDate?: Date;
  endDate?: Date;
}

export interface VersionDiff {
  field: string;
  entityType: StoryBibleEntityType;
  entityId?: string;
  v1Value: unknown;
  v2Value: unknown;
  changeType: "added" | "removed" | "modified";
}

@Injectable()
export class StoryBibleAuditService {
  private readonly logger = new Logger(StoryBibleAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 记录单个变更
   */
  async logChange(
    entry: Omit<CreateAuditLogDto, "id" | "createdAt">,
  ): Promise<StoryBibleAuditLog> {
    try {
      return await this.prisma.storyBibleAuditLog.create({
        data: {
          bibleId: entry.bibleId,
          version: entry.version,
          changeType: entry.changeType,
          entityType: entry.entityType,
          entityId: entry.entityId,
          field: entry.field,
          oldValue: entry.oldValue as Prisma.InputJsonValue,
          newValue: entry.newValue as Prisma.InputJsonValue,
          changedBy: entry.changedBy,
          reason: entry.reason,
        },
      });
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to log change: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * 批量记录变更
   */
  async logBulkChanges(
    entries: Omit<CreateAuditLogDto, "id" | "createdAt">[],
  ): Promise<number> {
    try {
      const result = await this.prisma.storyBibleAuditLog.createMany({
        data: entries.map((entry) => ({
          bibleId: entry.bibleId,
          version: entry.version,
          changeType: entry.changeType,
          entityType: entry.entityType,
          entityId: entry.entityId,
          field: entry.field,
          oldValue: entry.oldValue as Prisma.InputJsonValue,
          newValue: entry.newValue as Prisma.InputJsonValue,
          changedBy: entry.changedBy,
          reason: entry.reason,
        })),
      });

      this.logger.log(`Bulk logged ${result.count} changes`);
      return result.count;
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Failed to bulk log changes: ${err.message}`,
        err.stack,
      );
      throw error;
    }
  }

  /**
   * 获取变更历史
   */
  async getChangeHistory(
    bibleId: string,
    options?: ChangeHistoryOptions,
  ): Promise<{
    logs: StoryBibleAuditLog[];
    total: number;
    hasMore: boolean;
  }> {
    try {
      // 验证 Bible 是否存在
      const bible = await this.prisma.storyBible.findUnique({
        where: { id: bibleId },
      });

      if (!bible) {
        throw new NotFoundException("Story Bible not found");
      }

      // 构建查询条件
      const where: Prisma.StoryBibleAuditLogWhereInput = { bibleId };

      if (options?.entityType) {
        where.entityType = options.entityType;
      }

      if (options?.entityId) {
        where.entityId = options.entityId;
      }

      if (options?.startDate || options?.endDate) {
        where.createdAt = {};
        if (options.startDate) {
          where.createdAt.gte = options.startDate;
        }
        if (options.endDate) {
          where.createdAt.lte = options.endDate;
        }
      }

      // 查询总数
      const total = await this.prisma.storyBibleAuditLog.count({ where });

      // 查询日志
      const limit = options?.limit || 50;
      const offset = options?.offset || 0;

      const logs = await this.prisma.storyBibleAuditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
      });

      return {
        logs,
        total,
        hasMore: offset + logs.length < total,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Failed to get change history: ${err.message}`,
        err.stack,
      );
      throw error;
    }
  }

  /**
   * 获取实体历史
   */
  async getEntityHistory(
    bibleId: string,
    entityType: StoryBibleEntityType,
    entityId: string,
  ): Promise<StoryBibleAuditLog[]> {
    try {
      // 验证 Bible 是否存在
      const bible = await this.prisma.storyBible.findUnique({
        where: { id: bibleId },
      });

      if (!bible) {
        throw new NotFoundException("Story Bible not found");
      }

      return await this.prisma.storyBibleAuditLog.findMany({
        where: {
          bibleId,
          entityType,
          entityId,
        },
        orderBy: { createdAt: "asc" },
      });
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Failed to get entity history: ${err.message}`,
        err.stack,
      );
      throw error;
    }
  }

  /**
   * 对比两个版本
   */
  async compareVersions(
    bibleId: string,
    v1: number,
    v2: number,
  ): Promise<{
    version1: number;
    version2: number;
    differences: VersionDiff[];
    totalChanges: number;
  }> {
    try {
      // 验证 Bible 是否存在
      const bible = await this.prisma.storyBible.findUnique({
        where: { id: bibleId },
      });

      if (!bible) {
        throw new NotFoundException("Story Bible not found");
      }

      // 确保 v1 < v2
      const [fromVersion, toVersion] = v1 < v2 ? [v1, v2] : [v2, v1];

      // 获取两个版本之间的所有变更
      const changes = await this.prisma.storyBibleAuditLog.findMany({
        where: {
          bibleId,
          version: {
            gt: fromVersion,
            lte: toVersion,
          },
        },
        orderBy: { version: "asc" },
      });

      // 构建差异列表
      const differences: VersionDiff[] = [];
      const fieldMap = new Map<string, StoryBibleAuditLog[]>();

      // 按字段分组变更
      for (const change of changes) {
        const key = `${change.entityType}:${change.entityId || "root"}:${change.field}`;
        if (!fieldMap.has(key)) {
          fieldMap.set(key, []);
        }
        fieldMap.get(key)!.push(change);
      }

      // 计算每个字段的差异
      for (const [key, fieldChanges] of fieldMap.entries()) {
        const [entityType, entityId, field] = key.split(":");
        const firstChange = fieldChanges[0];
        const lastChange = fieldChanges[fieldChanges.length - 1];

        // 确定变更类型
        let changeType: "added" | "removed" | "modified";
        let v1Value: unknown;
        let v2Value: unknown;

        if (firstChange.changeType === "CREATE") {
          changeType = "added";
          v1Value = null;
          v2Value = lastChange.newValue;
        } else if (lastChange.changeType === "DELETE") {
          changeType = "removed";
          v1Value = firstChange.oldValue;
          v2Value = null;
        } else {
          changeType = "modified";
          v1Value = firstChange.oldValue;
          v2Value = lastChange.newValue;
        }

        differences.push({
          field,
          entityType: entityType as StoryBibleEntityType,
          entityId: entityId === "root" ? undefined : entityId,
          v1Value,
          v2Value,
          changeType,
        });
      }

      return {
        version1: fromVersion,
        version2: toVersion,
        differences,
        totalChanges: changes.length,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Failed to compare versions: ${err.message}`,
        err.stack,
      );
      throw error;
    }
  }

  /**
   * 获取最新版本号
   */
  async getLatestVersion(bibleId: string): Promise<number> {
    try {
      const bible = await this.prisma.storyBible.findUnique({
        where: { id: bibleId },
        select: { version: true },
      });

      if (!bible) {
        throw new NotFoundException("Story Bible not found");
      }

      return bible.version;
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Failed to get latest version: ${err.message}`,
        err.stack,
      );
      throw error;
    }
  }

  /**
   * 获取版本变更统计
   */
  async getVersionStats(
    bibleId: string,
    version: number,
  ): Promise<{
    version: number;
    totalChanges: number;
    changesByType: Record<string, number>;
    changesByEntity: Record<string, number>;
    changedBy: Record<string, number>;
  }> {
    try {
      const logs = await this.prisma.storyBibleAuditLog.findMany({
        where: { bibleId, version },
      });

      const changesByType: Record<string, number> = {};
      const changesByEntity: Record<string, number> = {};
      const changedBy: Record<string, number> = {};

      for (const log of logs) {
        // 统计变更类型
        changesByType[log.changeType] =
          (changesByType[log.changeType] || 0) + 1;

        // 统计实体类型
        changesByEntity[log.entityType] =
          (changesByEntity[log.entityType] || 0) + 1;

        // 统计变更者
        changedBy[log.changedBy] = (changedBy[log.changedBy] || 0) + 1;
      }

      return {
        version,
        totalChanges: logs.length,
        changesByType,
        changesByEntity,
        changedBy,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Failed to get version stats: ${err.message}`,
        err.stack,
      );
      throw error;
    }
  }

  /**
   * 清理旧的审计日志（可选，用于数据维护）
   */
  async cleanupOldLogs(
    bibleId: string,
    keepDays: number = 90,
  ): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - keepDays);

      const result = await this.prisma.storyBibleAuditLog.deleteMany({
        where: {
          bibleId,
          createdAt: {
            lt: cutoffDate,
          },
        },
      });

      this.logger.log(
        `Cleaned up ${result.count} audit logs older than ${keepDays} days`,
      );
      return result.count;
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Failed to cleanup old logs: ${err.message}`,
        err.stack,
      );
      throw error;
    }
  }
}

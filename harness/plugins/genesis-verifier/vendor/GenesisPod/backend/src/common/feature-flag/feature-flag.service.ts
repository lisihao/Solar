/**
 * FeatureFlagService — PR-A6 (2026-05-07)
 *
 * 上游：docs/architecture/ai-harness/evaluation/report-assembly-invariant-redesign.md
 *      v1.4 §5.2 per-workspace 灰度基础设施
 *
 * 职责：
 *   - 读取 feature_flag_workspace_grant 表回答 isEnabled(flagKey, workspaceId)
 *   - 让 admin grant / revoke / update 走 audit log
 *   - 默认行为：grant 表无记录或 enabled=false 时返回 false（默认灰度关闭）
 *
 * 与 design v1.4 一致：
 *   - 不用 Redis Set（DB 表便于审计 + 与 admin UI 集成）
 *   - 安全：admin RBAC 在 controller 层，本 service 只做 DB IO
 *   - expiresAt 过期自动失效（不依赖 cron 清理）
 *
 * 反向证据 spec：feature-flag.service.spec.ts
 */

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export const FEATURE_FLAG_KEYS = {
  PLAYGROUND_USE_STRUCTURAL_ASSEMBLER: "PLAYGROUND_USE_STRUCTURAL_ASSEMBLER",
  PLAYGROUND_USE_REHYPE_SANITIZE: "PLAYGROUND_USE_REHYPE_SANITIZE",
} as const;

export type FeatureFlagKey =
  (typeof FEATURE_FLAG_KEYS)[keyof typeof FEATURE_FLAG_KEYS];

export interface FeatureFlagGrantInput {
  flagKey: string;
  workspaceId: string;
  enabled: boolean;
  grantedBy: string;
  expiresAt?: Date | null;
  reason?: string | null;
}

@Injectable()
export class FeatureFlagService {
  private readonly log = new Logger(FeatureFlagService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 查询某 workspace 是否启用了某 flag。
   *
   * 优先级：
   *   1. 找不到 grant 记录 → false（默认灰度关闭）
   *   2. enabled=false → false
   *   3. expiresAt 已过期 → false
   *   4. 其它 → true
   *
   * 不抛错（DB 故障 fall back 到 false，避免 flag 服务挂掉拖垮业务）。
   */
  async isEnabled(flagKey: string, workspaceId: string): Promise<boolean> {
    try {
      const grant = await this.prisma.featureFlagWorkspaceGrant.findUnique({
        where: { flagKey_workspaceId: { flagKey, workspaceId } },
      });
      if (!grant || !grant.enabled) return false;
      if (grant.expiresAt && grant.expiresAt < new Date()) return false;
      return true;
    } catch (err) {
      this.log.warn(
        `[isEnabled ${flagKey}/${workspaceId}] DB lookup failed (degrade to false): ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  /**
   * 列某 workspace 当前所有已启用且未过期的 flagKey。
   * 前端 /api/v1/me/feature-flags 端点用（避免每个页面都 round-trip）。
   */
  async listEnabledForWorkspace(workspaceId: string): Promise<string[]> {
    const grants = await this.prisma.featureFlagWorkspaceGrant
      .findMany({
        where: { workspaceId, enabled: true },
      })
      .catch((err: unknown) => {
        this.log.warn(
          `[listEnabledForWorkspace ${workspaceId}] failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return [];
      });
    const now = new Date();
    return grants
      .filter((g) => !g.expiresAt || g.expiresAt > now)
      .map((g) => g.flagKey);
  }

  /**
   * Admin grant —— upsert grant 表 + 写 audit log（同事务）。
   *
   * **安全**：caller 必须保证 grantedBy 来自验证过的 admin session
   * （RolesGuard 已校验）。本 service 不做 RBAC，避免与 controller 重复。
   *
   * 返回：(prevEnabled, nextEnabled) 二元组让 caller emit observability event。
   */
  async grant(input: FeatureFlagGrantInput): Promise<{
    prevEnabled: boolean | null;
    nextEnabled: boolean;
  }> {
    return this.prisma.$transaction(async (tx) => {
      const prev = await tx.featureFlagWorkspaceGrant.findUnique({
        where: {
          flagKey_workspaceId: {
            flagKey: input.flagKey,
            workspaceId: input.workspaceId,
          },
        },
        select: { enabled: true },
      });

      await tx.featureFlagWorkspaceGrant.upsert({
        where: {
          flagKey_workspaceId: {
            flagKey: input.flagKey,
            workspaceId: input.workspaceId,
          },
        },
        create: {
          flagKey: input.flagKey,
          workspaceId: input.workspaceId,
          enabled: input.enabled,
          grantedBy: input.grantedBy,
          expiresAt: input.expiresAt ?? null,
          reason: input.reason ?? null,
        },
        update: {
          enabled: input.enabled,
          grantedBy: input.grantedBy,
          expiresAt: input.expiresAt ?? null,
          reason: input.reason ?? null,
        },
      });

      await tx.featureFlagAuditLog.create({
        data: {
          flagKey: input.flagKey,
          workspaceId: input.workspaceId,
          action: prev ? "update" : "grant",
          actorUserId: input.grantedBy,
          prevEnabled: prev?.enabled ?? null,
          nextEnabled: input.enabled,
          reason: input.reason ?? null,
        },
      });

      return {
        prevEnabled: prev?.enabled ?? null,
        nextEnabled: input.enabled,
      };
    });
  }

  /**
   * Admin revoke —— 把 grant.enabled 设 false（保留行让 audit 可查）+ 写 audit log。
   */
  async revoke(args: {
    flagKey: string;
    workspaceId: string;
    actorUserId: string;
    reason?: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const prev = await tx.featureFlagWorkspaceGrant.findUnique({
        where: {
          flagKey_workspaceId: {
            flagKey: args.flagKey,
            workspaceId: args.workspaceId,
          },
        },
        select: { enabled: true },
      });
      if (!prev) {
        // 没记录 = 已经是 disabled，audit log 仍写让管理员能看到尝试
        await tx.featureFlagAuditLog.create({
          data: {
            flagKey: args.flagKey,
            workspaceId: args.workspaceId,
            action: "revoke",
            actorUserId: args.actorUserId,
            prevEnabled: null,
            nextEnabled: false,
            reason: args.reason ?? "no-prior-grant",
          },
        });
        return;
      }
      await tx.featureFlagWorkspaceGrant.update({
        where: {
          flagKey_workspaceId: {
            flagKey: args.flagKey,
            workspaceId: args.workspaceId,
          },
        },
        data: { enabled: false },
      });
      await tx.featureFlagAuditLog.create({
        data: {
          flagKey: args.flagKey,
          workspaceId: args.workspaceId,
          action: "revoke",
          actorUserId: args.actorUserId,
          prevEnabled: prev.enabled,
          nextEnabled: false,
          reason: args.reason ?? null,
        },
      });
    });
  }
}

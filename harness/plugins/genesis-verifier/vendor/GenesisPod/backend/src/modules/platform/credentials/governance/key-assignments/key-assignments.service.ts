import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { KeyAssignment, KeyAssignmentStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { SecretsService } from "@/modules/platform/credentials/storage/secrets/secrets.service";
import { NotificationPresetsService } from "@/modules/platform/notifications/presets/notification-presets.service";
import { QuotaExceededError } from "../../resolution/key-resolver/key-resolver.errors";

/**
 * 2026-05-08 v5（drop_distributable_keys）:
 *   - 删除 DistributableKey 双源抽象
 *   - KeyAssignment 直接关联 AIModel.id（modelDbId）
 *   - 授权语义=管理员把某模型开放给某用户；不再有"密钥池分配"中间层
 *   - 解析 apiKey 直接读 AIModel.apiKey/secretKey（支持 SecretsService 间接引用）
 */

export interface AssignmentView {
  id: string;
  modelDbId: string;
  provider: string;
  modelId: string;
  userId: string;
  userQuotaCents: number | null;
  userSpendCents: number;
  status: KeyAssignmentStatus;
  validityType: string;
  recurrenceUnit: string | null;
  recurrenceInterval: number | null;
  nextRenewalAt: Date | null;
  assignedAt: Date;
  assignedBy: string | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  revokedBy: string | null;
  revokedReason: string | null;
  note: string | null;
}

export interface UserAssignmentView extends AssignmentView {
  modelDisplayName: string;
  modelEnabled: boolean;
  // 2026-05-08：扩展给「我的模型」tab 用，让 SYSTEM-granted 行能展示和 PERSONAL
  // 一致的 Type / Capabilities 列。这些字段都是 AIModel 上的 admin 配置，授权
  // 时立刻 join 进来比让前端再去 /ai/models 查一次代价更低。
  modelType: string;
  modelIsReasoning: boolean;
  modelMaxTokens: number;
  modelSupportsTemperature: boolean;
  modelSupportsStreaming: boolean;
  modelSupportsFunctionCalling: boolean;
  modelSupportsVision: boolean;
}

export interface ResolvedAssignment {
  assignmentId: string;
  modelDbId: string;
  apiKey: string;
  apiEndpoint: string | null;
  userQuotaCents: number | null;
  userSpendCents: number;
}

export interface GrantModelInput {
  /** AIModel.id（不是字符串 modelId；UI 选具体模型行后传 id） */
  modelDbId: string;
  userQuotaCents?: number | null;
}

export type ValidityType = "ONE_TIME" | "RECURRING";
export type RecurrenceUnit = "WEEK" | "MONTH" | "YEAR";

export interface GrantBatchInput {
  userId: string;
  models: GrantModelInput[];
  validityType: ValidityType;
  expiresAt?: Date | null; // ONE_TIME 用
  recurrenceUnit?: RecurrenceUnit; // RECURRING 用
  recurrenceInterval?: number; // RECURRING 用，1=每月，3=每季度
  assignedBy?: string;
  note?: string;
  /**
   * 跳过 KEY_GRANTED 通知（默认 false）。
   * 由"批准 KeyRequest"流程使用——因 approve 已发 KEY_REQUEST_APPROVED，
   * 避免给用户重复推送两条通知。
   */
  skipUserNotification?: boolean;
}

export interface GrantBatchFailure {
  modelDbId: string;
  reason: string;
}

export interface GrantBatchResult {
  succeeded: KeyAssignment[];
  failed: GrantBatchFailure[];
}

@Injectable()
export class KeyAssignmentsService {
  private readonly logger = new Logger(KeyAssignmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
    /**
     * Optional：通知发送是 fire-and-forget，模块拼装失败时不应阻塞授权主流程。
     */
    @Optional()
    private readonly notifyPresets?: NotificationPresetsService,
  ) {}

  /**
   * 调整分配（配额 / 到期 / 备注 / 状态）。不允许从 Revoked 复活。
   */
  async update(
    id: string,
    patch: {
      userQuotaCents?: number | null;
      expiresAt?: Date | null;
      note?: string | null;
      status?: KeyAssignmentStatus;
    },
  ): Promise<KeyAssignment> {
    const existing = await this.prisma.keyAssignment.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException("Assignment not found");
    if (
      patch.status === KeyAssignmentStatus.ACTIVE &&
      existing.status === KeyAssignmentStatus.REVOKED
    ) {
      throw new ConflictException("Cannot reactivate a revoked assignment");
    }

    const data: Prisma.KeyAssignmentUpdateInput = {};
    if (patch.userQuotaCents !== undefined)
      data.userQuotaCents = patch.userQuotaCents;
    if (patch.expiresAt !== undefined) data.expiresAt = patch.expiresAt;
    if (patch.note !== undefined) data.note = patch.note;
    if (patch.status !== undefined) data.status = patch.status;

    return this.prisma.keyAssignment.update({ where: { id }, data });
  }

  async revoke(
    id: string,
    by?: string,
    reason?: string,
  ): Promise<KeyAssignment> {
    const existing = await this.prisma.keyAssignment.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException("Assignment not found");
    // 幂等：已经是 REVOKED 的分配不再更新
    if (existing.status === KeyAssignmentStatus.REVOKED) return existing;
    return this.prisma.keyAssignment.update({
      where: { id },
      data: {
        status: KeyAssignmentStatus.REVOKED,
        revokedAt: new Date(),
        revokedBy: by,
        revokedReason: reason,
      },
    });
  }

  /**
   * 2026-05-12 PR-6：STALE → ACTIVE 反向恢复。
   *
   * 触发场景：admin 在 /admin/ai/models 重新启用某模型（isEnabled false→true），
   * 联动让该模型下所有 STALE 的 KeyAssignment 恢复为 ACTIVE，用户原有权益自动复活。
   *
   * 设计原则：
   * - 仅恢复 STALE，**不动** REVOKED / EXPIRED（admin 显式撤销 / 已过期不复活）
   * - 仅恢复当前 enabled 的 modelDbId 关联，避免反复 toggle 误恢复
   * - 幂等：无 STALE 行时 count=0，不报错
   *
   * 该方法补 byok-maintenance.scheduler.markStaleAssignments 注释承诺
   * "恢复路径在 admin 重启 model 时显式触发"——之前未实现。
   */
  async reactivateStale(modelDbId: string): Promise<{ count: number }> {
    const result = await this.prisma.keyAssignment.updateMany({
      where: {
        modelDbId,
        status: KeyAssignmentStatus.STALE,
      },
      data: {
        status: KeyAssignmentStatus.ACTIVE,
      },
    });
    if (result.count > 0) {
      this.logger.log(
        `[reactivateStale] Restored ${result.count} STALE assignments → ACTIVE for model ${modelDbId}`,
      );
    }
    return result;
  }

  /**
   * 解析用户对某 provider+modelId 的活跃授权；返回已解密的 Key（供 LLM 直调）。
   * 仅由 KeyResolverService 调用，不暴露给外部。
   *
   * 行为：
   *   - 不存在活跃分配 → 返回 null
   *   - 分配已过期 → 标记 EXPIRED 后返回 null
   *   - 用户级配额已耗尽 → 抛 QuotaExceededError
   *   - 关联 AIModel 已 disabled / 解密失败 → 返回 null
   *
   * 当前 KeyResolverService.resolveUserKey 调用是 (userId, provider) 二元；
   * 这里查找逻辑是 modelDbId 唯一约束 [userId, modelDbId]，所以一个 user 在
   * 一个 provider 下可能有多条 assignment（每个具体 model 一条）。返回首条
   * 可用的（按 model.priority desc, assignedAt desc 排序）。
   */
  async resolveActive(
    userId: string,
    provider: string,
  ): Promise<ResolvedAssignment | null> {
    const normalized = provider.toLowerCase();
    const candidates = await this.prisma.keyAssignment.findMany({
      where: {
        userId,
        provider: normalized,
        status: KeyAssignmentStatus.ACTIVE,
      },
      include: {
        model: {
          select: {
            id: true,
            apiKey: true,
            apiEndpoint: true,
            secretKey: true,
            isEnabled: true,
            priority: true,
          },
        },
      },
      orderBy: [{ assignedAt: "desc" }],
    });
    if (!candidates.length) return null;

    // 按 model.priority desc, assignedAt desc 排序
    const sorted = candidates.slice().sort((a, b) => {
      const pa = a.model?.priority ?? 0;
      const pb = b.model?.priority ?? 0;
      if (pa !== pb) return pb - pa;
      return b.assignedAt.getTime() - a.assignedAt.getTime();
    });

    for (const assignment of sorted) {
      // 过期检查
      if (assignment.expiresAt && assignment.expiresAt < new Date()) {
        await this.prisma.keyAssignment
          .update({
            where: { id: assignment.id },
            data: { status: KeyAssignmentStatus.EXPIRED },
          })
          .catch((err) =>
            this.logger.warn(
              `Failed to mark assignment ${assignment.id} as EXPIRED: ${err}`,
            ),
          );
        continue;
      }

      // 用户级配额检查
      if (
        assignment.userQuotaCents !== null &&
        assignment.userSpendCents >= assignment.userQuotaCents
      ) {
        throw new QuotaExceededError(normalized, "ASSIGNED", {
          usedCents: assignment.userSpendCents,
          limitCents: assignment.userQuotaCents,
        });
      }

      // 关联 model 检查
      if (!assignment.model || !assignment.model.isEnabled) continue;

      const apiKey = await this.resolveModelApiKey(assignment.model);
      if (!apiKey) continue;

      return {
        assignmentId: assignment.id,
        modelDbId: assignment.modelDbId,
        apiKey,
        apiEndpoint: assignment.model.apiEndpoint ?? null,
        userQuotaCents: assignment.userQuotaCents,
        userSpendCents: assignment.userSpendCents,
      };
    }
    return null;
  }

  /**
   * failover 入口：列出该 user/provider 下所有 ACTIVE 且可用的分配。
   * 跟 resolveActive 区别：返回数组，配额耗尽改为不返回（不抛错）。
   */
  async listActive(
    userId: string,
    provider: string,
  ): Promise<ResolvedAssignment[]> {
    const normalized = provider.toLowerCase();
    const candidates = await this.prisma.keyAssignment.findMany({
      where: {
        userId,
        provider: normalized,
        status: KeyAssignmentStatus.ACTIVE,
      },
      include: {
        model: {
          select: {
            id: true,
            apiKey: true,
            apiEndpoint: true,
            secretKey: true,
            isEnabled: true,
            priority: true,
          },
        },
      },
    });
    if (!candidates.length) return [];

    const sorted = candidates.slice().sort((a, b) => {
      const pa = a.model?.priority ?? 0;
      const pb = b.model?.priority ?? 0;
      if (pa !== pb) return pb - pa;
      return b.assignedAt.getTime() - a.assignedAt.getTime();
    });

    const results: ResolvedAssignment[] = [];
    for (const assignment of sorted) {
      if (assignment.expiresAt && assignment.expiresAt < new Date()) continue;
      if (
        assignment.userQuotaCents !== null &&
        assignment.userSpendCents >= assignment.userQuotaCents
      )
        continue;
      if (!assignment.model || !assignment.model.isEnabled) continue;
      const apiKey = await this.resolveModelApiKey(assignment.model);
      if (!apiKey) continue;
      results.push({
        assignmentId: assignment.id,
        modelDbId: assignment.modelDbId,
        apiKey,
        apiEndpoint: assignment.model.apiEndpoint ?? null,
        userQuotaCents: assignment.userQuotaCents,
        userSpendCents: assignment.userSpendCents,
      });
    }
    return results;
  }

  /**
   * 模型粒度批量授权
   *
   * Admin 在 UI 选 N 个 AIModel 行（用 modelDbId 而非字符串 modelId）+ 单次/周期有效期：
   *   - 每个 modelDbId 查 AIModel 拿 provider/modelId 填充冗余字段
   *   - upsert KeyAssignment(userId, modelDbId)
   *   - 单 model 失败不阻塞其他（如 "model not found" / "user already active"）
   *   - 返回 succeeded[] + failed[{ modelDbId, reason }]
   *
   * RECURRING 自动计算 nextRenewalAt = now + recurrenceInterval × recurrenceUnit
   */
  async grantBatch(input: GrantBatchInput): Promise<GrantBatchResult> {
    const succeeded: KeyAssignment[] = [];
    const failed: GrantBatchFailure[] = [];

    if (!input.models.length) {
      return { succeeded, failed };
    }

    // RECURRING 校验
    if (input.validityType === "RECURRING") {
      if (!input.recurrenceUnit || !input.recurrenceInterval) {
        throw new ConflictException(
          "RECURRING validity requires recurrenceUnit + recurrenceInterval",
        );
      }
      if (input.recurrenceInterval < 1) {
        throw new ConflictException("recurrenceInterval must be >= 1");
      }
    }

    const nextRenewalAt =
      input.validityType === "RECURRING"
        ? this.computeNextRenewalAt(
            new Date(),
            input.recurrenceUnit!,
            input.recurrenceInterval!,
          )
        : null;

    for (const m of input.models) {
      try {
        // 1. 查 model 拿 provider/modelId 填充冗余
        const model = await this.prisma.aIModel.findUnique({
          where: { id: m.modelDbId },
          select: { id: true, provider: true, modelId: true, isEnabled: true },
        });
        if (!model) {
          failed.push({
            modelDbId: m.modelDbId,
            reason: `Model not found: ${m.modelDbId}`,
          });
          continue;
        }
        if (!model.isEnabled) {
          failed.push({
            modelDbId: m.modelDbId,
            reason: `Model is disabled: ${model.modelId}`,
          });
          continue;
        }

        const provider = model.provider.toLowerCase();

        // 2. upsert
        const created = await this.prisma.$transaction(async (tx) => {
          const existing = await tx.keyAssignment.findUnique({
            where: {
              userId_modelDbId: {
                userId: input.userId,
                modelDbId: model.id,
              },
            },
          });
          if (existing && existing.status === KeyAssignmentStatus.ACTIVE) {
            throw new ConflictException(
              `User already has active assignment for ${provider}/${model.modelId}`,
            );
          }
          if (existing) {
            await tx.keyAssignment.delete({ where: { id: existing.id } });
          }
          // ★ 评审 P1-A1：provider/modelId 是冗余字段（grant 时由 AIModel 派生），
          //   AIModel.provider/modelId 后续若被 admin 改名，本表不会自动同步。
          //   单一源是 modelDbId（FK），listing 用冗余字段免 join。如需"重命名后冗余字段
          //   全量刷新"能力，未来加 cron / trigger（OUT OF SCOPE 本次）。
          return tx.keyAssignment.create({
            data: {
              modelDbId: model.id,
              userId: input.userId,
              provider,
              modelId: model.modelId,
              userQuotaCents: m.userQuotaCents ?? null,
              validityType: input.validityType,
              expiresAt:
                input.validityType === "ONE_TIME"
                  ? (input.expiresAt ?? null)
                  : null,
              recurrenceUnit:
                input.validityType === "RECURRING"
                  ? input.recurrenceUnit!
                  : null,
              recurrenceInterval:
                input.validityType === "RECURRING"
                  ? input.recurrenceInterval!
                  : null,
              nextRenewalAt,
              assignedBy: input.assignedBy,
              note: input.note,
            },
          });
        });
        succeeded.push(created);
      } catch (err) {
        failed.push({
          modelDbId: m.modelDbId,
          reason: (err as Error).message ?? "Unknown error",
        });
      }
    }

    this.logger.log(
      `[grantBatch] user=${input.userId} succeeded=${succeeded.length} failed=${failed.length}`,
    );

    // fire-and-forget: admin 主动授权时通知被授权用户。approve 流程会自己发
    // KEY_REQUEST_APPROVED，避免重复故 skipUserNotification=true。
    if (
      !input.skipUserNotification &&
      this.notifyPresets &&
      succeeded.length > 0
    ) {
      const presets = this.notifyPresets;
      const userId = input.userId;
      const assignmentIds = succeeded.map((s) => s.id);
      const modelLabels = succeeded.map((s) => s.modelId);
      void presets
        .notifyKeyGranted({ userId, assignmentIds, modelLabels })
        .catch((err) =>
          this.logger.warn(
            `[notify] notifyKeyGranted failed for user ${userId}: ${(err as Error).message}`,
          ),
        );
    }

    return { succeeded, failed };
  }

  /**
   * RECURRING 推算下次续期时间（跨月边界 clamp）。
   * public：cron 续期逻辑也复用此方法，避免双源（feedback_no_dual_sources）。
   */
  computeNextRenewalAt(
    from: Date,
    unit: RecurrenceUnit,
    interval: number,
  ): Date {
    const next = new Date(from);
    if (unit === "WEEK") {
      next.setDate(next.getDate() + 7 * interval);
    } else if (unit === "MONTH") {
      const day = next.getDate();
      next.setDate(1); // 先 reset day=1 防止 setMonth 溢出
      next.setMonth(next.getMonth() + interval);
      const maxDay = new Date(
        next.getFullYear(),
        next.getMonth() + 1,
        0,
      ).getDate();
      next.setDate(Math.min(day, maxDay));
    } else if (unit === "YEAR") {
      const day = next.getDate();
      const month = next.getMonth();
      next.setDate(1);
      next.setFullYear(next.getFullYear() + interval);
      next.setMonth(month);
      const maxDay = new Date(
        next.getFullYear(),
        next.getMonth() + 1,
        0,
      ).getDate();
      next.setDate(Math.min(day, maxDay));
    }
    return next;
  }

  /**
   * 记账：用户级 spend 累加。
   * 池级 spend 概念已删除（重构后没有"池"），spend 走 userSpendCents +
   * CreditsService 总账。
   */
  async incrementSpend(assignmentId: string, costCents: number): Promise<void> {
    if (costCents <= 0) return;
    await this.prisma.keyAssignment
      .update({
        where: { id: assignmentId },
        data: { userSpendCents: { increment: costCents } },
      })
      .catch((err) =>
        this.logger.warn(
          `[incrementSpend] failed for assignment ${assignmentId}: ${(err as Error).message}`,
        ),
      );
  }

  /**
   * 用户可用的 Provider（仅 ACTIVE 分配，distinct provider）
   */
  async getAvailableProviders(userId: string): Promise<string[]> {
    const rows = await this.prisma.keyAssignment.findMany({
      where: { userId, status: KeyAssignmentStatus.ACTIVE },
      select: { provider: true },
      distinct: ["provider"],
    });
    return rows.map((r) => r.provider);
  }

  /**
   * 用户视角：我被授权的模型清单（含剩余配额等展示信息，不包含密文）
   */
  async listByUser(userId: string): Promise<UserAssignmentView[]> {
    const rows = await this.prisma.keyAssignment.findMany({
      where: { userId },
      include: {
        model: {
          select: {
            displayName: true,
            isEnabled: true,
            modelType: true,
            isReasoning: true,
            maxTokens: true,
            supportsTemperature: true,
            supportsStreaming: true,
            supportsFunctionCalling: true,
            supportsVision: true,
          },
        },
      },
      orderBy: [{ status: "asc" }, { assignedAt: "desc" }],
    });
    return rows.map((a) => ({
      ...this.toView(a),
      modelDisplayName: a.model?.displayName ?? a.modelId,
      modelEnabled: a.model?.isEnabled ?? false,
      modelType: a.model?.modelType ?? "CHAT",
      modelIsReasoning: a.model?.isReasoning ?? false,
      modelMaxTokens: a.model?.maxTokens ?? 0,
      modelSupportsTemperature: a.model?.supportsTemperature ?? false,
      modelSupportsStreaming: a.model?.supportsStreaming ?? false,
      modelSupportsFunctionCalling: a.model?.supportsFunctionCalling ?? false,
      modelSupportsVision: a.model?.supportsVision ?? false,
    }));
  }

  /**
   * 管理员视角：某 model 的所有授权
   */
  async listByModel(modelDbId: string): Promise<AssignmentView[]> {
    const rows = await this.prisma.keyAssignment.findMany({
      where: { modelDbId },
      orderBy: [{ status: "asc" }, { assignedAt: "desc" }],
    });
    return rows.map((a) => this.toView(a));
  }

  /**
   * 管理员视角：全局授权清单（支持分页 + provider filter）
   */
  async listAll(filters?: {
    status?: KeyAssignmentStatus;
    provider?: string;
    userId?: string;
    take?: number;
    skip?: number;
  }): Promise<AssignmentView[]> {
    const where: Prisma.KeyAssignmentWhereInput = {};
    if (filters?.status) where.status = filters.status;
    if (filters?.provider) where.provider = filters.provider.toLowerCase();
    if (filters?.userId) where.userId = filters.userId;
    const rows = await this.prisma.keyAssignment.findMany({
      where,
      orderBy: [{ assignedAt: "desc" }],
      take: filters?.take ?? 50,
      skip: filters?.skip ?? 0,
    });
    return rows.map((a) => this.toView(a));
  }

  private toView(a: KeyAssignment): AssignmentView {
    return {
      id: a.id,
      modelDbId: a.modelDbId,
      provider: a.provider,
      modelId: a.modelId,
      userId: a.userId,
      userQuotaCents: a.userQuotaCents,
      userSpendCents: a.userSpendCents,
      status: a.status,
      validityType: a.validityType,
      recurrenceUnit: a.recurrenceUnit,
      recurrenceInterval: a.recurrenceInterval,
      nextRenewalAt: a.nextRenewalAt,
      assignedAt: a.assignedAt,
      assignedBy: a.assignedBy,
      expiresAt: a.expiresAt,
      revokedAt: a.revokedAt,
      revokedBy: a.revokedBy,
      revokedReason: a.revokedReason,
      note: a.note,
    };
  }

  /**
   * 从 AIModel 行解析最终的 apiKey 字符串。
   *   - 优先 secretKey（SecretsService 间接引用）
   *   - fallback apiKey（legacy 直存字段）
   */
  private async resolveModelApiKey(model: {
    id: string;
    apiKey: string | null;
    secretKey: string | null;
  }): Promise<string | null> {
    if (model.secretKey) {
      try {
        const secretValue = await this.secrets.getValueInternal(
          model.secretKey,
        );
        if (secretValue?.trim()) return secretValue.trim();
      } catch (err) {
        this.logger.warn(
          `[resolveModelApiKey] secret lookup failed for model ${model.id} (secretKey=${model.secretKey}): ${(err as Error).message}`,
        );
      }
    }
    // 2026-05-12 PR-4: 删除 AIModel.apiKey 明文列 fallback
    return null;
  }
}

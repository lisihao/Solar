/**
 * CapabilityOverridesWriterService —— v3.1 §B.3 写入面 SSOT
 *
 * 唯一负责把 admin / BYOK / self-heal 的 capability_overrides patch 写入 DB +
 * 同事务记 AuditLog（§4.5 强一致）。所有写入路径必经此 service，禁止其它路径
 * 直接 update capability_overrides 列。
 *
 * scope 矩阵（§4.2 D2 修订）：
 *   - PERSONAL → UserModelConfig.capabilityOverrides
 *   - ADMIN    → AIModel.capabilityOverrides
 *   - SYSTEM   → UserModelConfig.capabilityOverrides（self-heal，actor.role='system'）
 *   - ASSIGNED 已删除（D2 第一期不存在该用例）→ ForbiddenException
 *
 * 严校三层：
 *   1. patch 入口 ModelCapabilitiesOverridesSchema.safeParse（zod .strict()）
 *   2. deep-merge 结果再 safeParse 一次（防 patch 合并出 typo）
 *   3. reason ≥30 字符 service 内 assert（DTO 兜底）
 *
 * 事务边界：
 *   - applyOverrideTransactional：自带 $transaction（admin / BYOK controller 用）
 *   - applyOverrideInTx：传入外部 tx（self-heal 用，避免 nested transaction）
 *   - 两者共享内部 _doApplyOverride
 *
 * 失败语义：fail-closed —— 任何子步骤失败立即抛错，整个事务回滚
 *   （AuditLog 不会成"业务回滚但 audit 留痕"的不一致；业务成功必有 audit）。
 */

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  Optional,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../../../../../common/prisma/prisma.service";

import { CapabilityFeatureFlagsService } from "./capability-feature-flags.service";
import { parseCapabilityOverrides } from "./capability-overrides-parser";
import {
  ModelCapabilitiesOverridesSchema,
  type ModelCapabilitiesOverrides,
} from "./model-capability.types";
import type {
  ApplyOverrideOptions,
  ApplyOverrideResult,
  CapabilityOverrideTarget,
  ClearOverrideResult,
} from "./capability-overrides-writer.types";

/** 顶层字段以外的 JSON value 视作 plain object 时合并；其它（数组 / 标量 / null）整体覆盖。 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * Deep-merge `patch` into `base`：同 key 路径覆盖；不存在的 key 路径保留 base。
 * - plain object value 递归合并
 * - array / scalar / null 整体覆盖（语义：用户明确清空字段）
 * - undefined 值跳过（不覆盖 base）
 *
 * 不使用 lodash —— 5 行手写避免新依赖（CLAUDE.md 反过度抽象）。
 */
function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, val] of Object.entries(patch)) {
    if (val === undefined) continue;
    const cur = out[key];
    if (isPlainObject(val) && isPlainObject(cur)) {
      out[key] = deepMerge(cur, val);
    } else {
      out[key] = val;
    }
  }
  return out;
}

@Injectable()
export class CapabilityOverridesWriterService {
  private readonly logger = new Logger(CapabilityOverridesWriterService.name);

  constructor(
    private readonly prisma: PrismaService,
    // v3.1 §B.7 (2026-05-24)：feature flag 服务（Optional 保留 BC）。
    // 仅 applyOverrideTransactional 入口校验（admin/BYOK 路径），
    // applyOverrideInTx 不校验（self-heal 已通过 self-heal 服务的 flag 拦截）。
    @Optional()
    private readonly flags?: CapabilityFeatureFlagsService,
  ) {}

  /**
   * 公开 API —— admin / BYOK controller 直接调；自带 $transaction。
   */
  async applyOverrideTransactional(
    opts: ApplyOverrideOptions,
  ): Promise<ApplyOverrideResult> {
    // v3.1 §B.7：feature flag 全局禁用写入面（紧急 kill switch）
    if (this.flags) {
      const enabled = await this.flags.isOverridesWriteEnabled();
      if (!enabled) {
        throw new ForbiddenException(
          "capability overrides write is disabled by feature flag",
        );
      }
    }
    this.guardScope(opts);
    this.guardReason(opts.reason);
    this.guardPatchShape(opts.patch);

    return this.prisma.$transaction(async (tx) => {
      return this._doApplyOverride(tx, opts);
    });
  }

  /**
   * self-heal 内嵌入外部 $transaction（self-heal 自己持 advisory lock）的入口。
   * caller 必须保证 tx 在 transaction 内调用，并已持 advisory lock。
   */
  async applyOverrideInTx(
    tx: Prisma.TransactionClient,
    opts: ApplyOverrideOptions,
  ): Promise<ApplyOverrideResult> {
    this.guardScope(opts);
    this.guardReason(opts.reason);
    this.guardPatchShape(opts.patch);

    return this._doApplyOverride(tx, opts);
  }

  /**
   * v3.1 §B+.4：admin/BYOK DELETE 真清 overlay（SET capabilityOverrides=NULL）。
   *
   * 与 applyOverrideTransactional 的区别：
   *   - apply:  deep-merge patch 进现有 overlay（保留其它路径），patch=`{}` 等价 noop
   *   - clear:  整列 UPDATE 为 SQL NULL（不再 deep-merge），audit afterValue=null
   *
   * 旧 admin DELETE 路径用 `patch={}` + applyOverrideTransactional 等价"不覆盖任何
   * 字段" —— 与用户期望的"清空整 overlay"语义不一致；本方法修正。
   *
   * 事务边界：自带 $transaction，同 tx 内 SELECT-before → UPDATE → INSERT audit。
   */
  async clearOverrideTransactional(
    opts: Omit<ApplyOverrideOptions, "patch">,
  ): Promise<ClearOverrideResult> {
    if (this.flags) {
      const enabled = await this.flags.isOverridesWriteEnabled();
      if (!enabled) {
        throw new ForbiddenException(
          "capability overrides write is disabled by feature flag",
        );
      }
    }
    // 复用 scope / reason guards；patch shape guard 不适用（无 patch）
    this.guardScope({ ...opts, patch: {} } as ApplyOverrideOptions);
    this.guardReason(opts.reason);

    return this.prisma.$transaction(async (tx) => {
      return this._doClearOverride(tx, opts);
    });
  }

  /**
   * scopeKey 算法（**仅 hint，非权威**）：
   *   admin (ai_model)        → 'admin:ai_models:<id>'
   *   user / system (BYOK)    → 'user:<userId>:user_model_config:<id>'
   *
   * 用于 AuditLog 索引 + self-heal cooling-off 守护查询 key。
   *
   * @deprecated 仅作 cooling-off 查询前的 hint 估算，**不是权威 scopeKey**。
   *   user_model_config 路径下，actor.id='system' (self-heal) 时该字段不可用作
   *   userId；最终权威 scopeKey 由 `_doApplyOverride` → `buildScopeKeyResolved`
   *   在事务内读 user_model_config.userId 重算。外部消费方请勿直接依赖本方法。
   */
  static buildScopeKeyHint(opts: ApplyOverrideOptions): string {
    if (opts.target.kind === "ai_model") {
      return `admin:ai_models:${opts.target.id}`;
    }
    // user_model_config：userId 取自 actor（self-heal 时 actor.id='system' 不可用
    // → 必须传 userId via target.id 本身能反查出 userId，写入时下面 _doApplyOverride
    // 会读出当前行的 userId 拼）—— 这里仅作 hint，最终 scopeKey 在事务内重算。
    return `user:${opts.actor.id}:user_model_config:${opts.target.id}`;
  }

  // ─────────── guards ───────────

  private guardScope(opts: ApplyOverrideOptions): void {
    // PERSONAL / ADMIN / SYSTEM 三态白名单；任何其它（包括历史 'ASSIGNED'）拒
    if (
      opts.scope !== "PERSONAL" &&
      opts.scope !== "ADMIN" &&
      opts.scope !== "SYSTEM"
    ) {
      throw new ForbiddenException(
        `capability override scope='${String(opts.scope)}' not allowed (D2: only PERSONAL/ADMIN/SYSTEM)`,
      );
    }
    // scope ↔ target.kind 匹配守护
    if (opts.scope === "ADMIN" && opts.target.kind !== "ai_model") {
      throw new ForbiddenException("ADMIN scope must target ai_model rows");
    }
    if (
      (opts.scope === "PERSONAL" || opts.scope === "SYSTEM") &&
      opts.target.kind !== "user_model_config"
    ) {
      throw new ForbiddenException(
        `${opts.scope} scope must target user_model_config rows`,
      );
    }
    // scope ↔ actor.role 匹配守护
    if (opts.scope === "ADMIN" && opts.actor.role !== "admin") {
      throw new ForbiddenException("ADMIN scope requires actor.role='admin'");
    }
    if (opts.scope === "SYSTEM" && opts.actor.role !== "system") {
      throw new ForbiddenException("SYSTEM scope requires actor.role='system'");
    }
    if (opts.scope === "PERSONAL" && opts.actor.role !== "user") {
      throw new ForbiddenException("PERSONAL scope requires actor.role='user'");
    }
  }

  private guardReason(reason: string): void {
    if (typeof reason !== "string" || reason.trim().length < 30) {
      throw new BadRequestException(
        "capability override reason must be ≥30 chars (audit traceability)",
      );
    }
    if (reason.length > 2000) {
      throw new BadRequestException(
        "capability override reason must be ≤2000 chars",
      );
    }
  }

  private guardPatchShape(patch: ModelCapabilitiesOverrides): void {
    const parsed = ModelCapabilitiesOverridesSchema.safeParse(patch);
    if (!parsed.success) {
      throw new BadRequestException(
        `invalid capability_overrides patch: ${JSON.stringify(parsed.error.issues).slice(0, 300)}`,
      );
    }
  }

  // ─────────── core ───────────

  private async _doApplyOverride(
    tx: Prisma.TransactionClient,
    opts: ApplyOverrideOptions,
  ): Promise<ApplyOverrideResult> {
    // 1. 读当前行 capability_overrides + 必要元信息（user_model_config 需 userId 拼 scopeKey）
    const { beforeRaw, ownerUserId } = await this.loadCurrent(tx, opts.target);

    // 2. parse before（fail-open）→ deep-merge patch → strict-parse 合并结果（fail-closed）
    const before =
      parseCapabilityOverrides(beforeRaw, {
        kind: opts.target.kind === "ai_model" ? "admin" : "user",
        modelId: opts.target.id,
        logger: this.logger,
      }) ?? null;

    const mergedRaw = deepMerge(
      (before ?? {}) as Record<string, unknown>,
      opts.patch as Record<string, unknown>,
    );
    const mergedParsed = ModelCapabilitiesOverridesSchema.safeParse(mergedRaw);
    if (!mergedParsed.success) {
      throw new BadRequestException(
        `merged capability_overrides failed strict parse: ${JSON.stringify(mergedParsed.error.issues).slice(0, 300)}`,
      );
    }
    const after: ModelCapabilitiesOverrides = mergedParsed.data;

    // 3. UPDATE 行
    await this.updateTarget(tx, opts.target, after);

    // 4. INSERT AuditLog（同事务）
    const scopeKey = this.buildScopeKeyResolved(opts, ownerUserId);
    await tx.capabilityOverrideAuditLog.create({
      data: {
        actorId: opts.actor.id,
        actorRole: opts.actor.role,
        scope: opts.scope,
        scopeKey,
        aiModelId: opts.target.kind === "ai_model" ? opts.target.id : null,
        userModelConfigId:
          opts.target.kind === "user_model_config" ? opts.target.id : null,
        field: "<root>", // B 子片 2：以 root patch 粒度记审计，B+ 可细到 field 路径
        beforeValue: before as unknown as Prisma.InputJsonValue,
        afterValue: after as unknown as Prisma.InputJsonValue,
        source: opts.source,
        reason: opts.reason,
        ipAddress: opts.ipAddress ?? null,
        userAgent: opts.userAgent ?? null,
      },
    });

    return { before, after };
  }

  private async _doClearOverride(
    tx: Prisma.TransactionClient,
    opts: Omit<ApplyOverrideOptions, "patch">,
  ): Promise<ClearOverrideResult> {
    // 1. 读当前行 capability_overrides + 必要元信息
    const { beforeRaw, ownerUserId } = await this.loadCurrent(tx, opts.target);

    // 2. parse before（fail-open）— after 固定为 null（真清）
    const before =
      parseCapabilityOverrides(beforeRaw, {
        kind: opts.target.kind === "ai_model" ? "admin" : "user",
        modelId: opts.target.id,
        logger: this.logger,
      }) ?? null;

    // 3. UPDATE 整列为 SQL NULL（Prisma.DbNull）
    const data = { capabilityOverrides: Prisma.DbNull };
    if (opts.target.kind === "ai_model") {
      await tx.aIModel.update({ where: { id: opts.target.id }, data });
    } else {
      await tx.userModelConfig.update({ where: { id: opts.target.id }, data });
    }

    // 4. INSERT AuditLog（同事务；afterValue=null 表示整列被清）
    const scopeKey = this.buildScopeKeyResolved(
      opts as ApplyOverrideOptions,
      ownerUserId,
    );
    await tx.capabilityOverrideAuditLog.create({
      data: {
        actorId: opts.actor.id,
        actorRole: opts.actor.role,
        scope: opts.scope,
        scopeKey,
        aiModelId: opts.target.kind === "ai_model" ? opts.target.id : null,
        userModelConfigId:
          opts.target.kind === "user_model_config" ? opts.target.id : null,
        field: "<root>",
        beforeValue: before as unknown as Prisma.InputJsonValue,
        afterValue: Prisma.DbNull,
        source: opts.source,
        reason: opts.reason,
        ipAddress: opts.ipAddress ?? null,
        userAgent: opts.userAgent ?? null,
      },
    });

    // after = null（与 applyOverrideTransactional 不同：apply 返非 null after，clear 返 null）
    return { before, after: null };
  }

  private async loadCurrent(
    tx: Prisma.TransactionClient,
    target: CapabilityOverrideTarget,
  ): Promise<{ beforeRaw: unknown; ownerUserId: string | null }> {
    if (target.kind === "ai_model") {
      const row = await tx.aIModel.findUnique({
        where: { id: target.id },
        select: { id: true, capabilityOverrides: true },
      });
      if (!row) {
        throw new BadRequestException(
          `AIModel ${target.id} not found for capability override`,
        );
      }
      return { beforeRaw: row.capabilityOverrides, ownerUserId: null };
    }
    const row = await tx.userModelConfig.findUnique({
      where: { id: target.id },
      select: { id: true, userId: true, capabilityOverrides: true },
    });
    if (!row) {
      throw new BadRequestException(
        `UserModelConfig ${target.id} not found for capability override`,
      );
    }
    return { beforeRaw: row.capabilityOverrides, ownerUserId: row.userId };
  }

  private async updateTarget(
    tx: Prisma.TransactionClient,
    target: CapabilityOverrideTarget,
    after: ModelCapabilitiesOverrides,
  ): Promise<void> {
    const data = {
      capabilityOverrides: after as unknown as Prisma.InputJsonValue,
    };
    if (target.kind === "ai_model") {
      await tx.aIModel.update({ where: { id: target.id }, data });
    } else {
      await tx.userModelConfig.update({ where: { id: target.id }, data });
    }
  }

  private buildScopeKeyResolved(
    opts: ApplyOverrideOptions,
    ownerUserId: string | null,
  ): string {
    if (opts.target.kind === "ai_model") {
      return `admin:ai_models:${opts.target.id}`;
    }
    // user_model_config —— 必须用行的真实 userId 而非 actor.id，
    // 否则 self-heal (actor.id='system') 会污染 cooling-off 查询 key
    const userId = ownerUserId ?? opts.actor.id;
    return `user:${userId}:user_model_config:${opts.target.id}`;
  }
}

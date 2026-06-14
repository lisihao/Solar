/**
 * CapabilitySelfHealService —— v3.1 §B.4 自愈写入 SSOT
 *
 * 决策栈（short-circuit early）：
 *   1. feature flag: process.env.ENABLE_CAPABILITY_SELF_HEAL !== 'false'
 *   2. 错误信号 4 重严校（§4.3，B 子片 2 简化 4 条；B 子片 3 接严格实现）
 *   3. cooling-off 守护：24h 内同 scopeKey+field 有 admin override → 拒（§4.4）
 *   4. 阈值计数：Redis INCR + EXPIRE 600s；count < 3 → 拒（§4.4）
 *   5. advisory_xact_lock + writer.applyOverrideInTx 写入 + 清 counter
 *
 * scope 固定：'SYSTEM'（actor.role='system'）—— self-heal 仅自愈 BYOK 路径
 * （UserModelConfig 行），永不触及 admin 全局表（§4.2 D2）。
 *
 * SSOT：DB 唯一权威，Redis 只承担阈值计数（D7）。本服务**只**通过
 * CapabilityOverridesWriterService 写 DB；禁直接 prisma.update。
 *
 * 错误处理：fail-closed —— 任何决策步骤异常返回 `{ healed: false, reason }`
 *   不抛错（self-heal 是后台路径，不能因自愈失败让业务请求挂）。
 */

import { Injectable, Logger, Optional } from "@nestjs/common";

import { CacheService } from "../../../../../common/cache/cache.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

import { CapabilityFeatureFlagsService } from "./capability-feature-flags.service";
import { CapabilityOverridesWriterService } from "./capability-overrides-writer.service";
import type {
  ApplyOverrideOptions,
  CapabilityOverrideTarget,
} from "./capability-overrides-writer.types";
import { DEGENERATE_OUTPUT_ERROR_CODE } from "./error-signal.types";
import type { ErrorSignal } from "./error-signal.types";
import type { ModelCapabilitiesOverrides } from "./model-capability.types";

const SELF_HEAL_THRESHOLD = 3;
const SELF_HEAL_WINDOW_SECONDS = 600;
const COOLING_OFF_HOURS = 24;

// 200 仅在与合成 degenerate-output errorCode 配对时被接受（真实 provider 响应
// 永不产生该 code）—— 让"接受 response_format 却吐退化输出"的模型也能自愈降档。
const ALLOWED_HTTP_STATUSES = new Set([200, 400, 422]);
const ALLOWED_ERROR_CODES = new Set([
  "unsupported_response_format",
  "invalid_request_error",
  "feature_not_supported",
  DEGENERATE_OUTPUT_ERROR_CODE,
]);

export interface MaybeSelfHealOptions {
  target: CapabilityOverrideTarget; // 自愈仅 user_model_config（service 内 guard）
  field: string; // e.g. 'structuredOutput.nativeMode'
  fromValue: unknown; // 当前值（self-heal 触发的"坏"值）
  toValue: unknown; // 降级目标值（如 'none'）
  errorSignal: ErrorSignal;
}

export interface MaybeSelfHealResult {
  healed: boolean;
  reason: string;
}

@Injectable()
export class CapabilitySelfHealService {
  private readonly logger = new Logger(CapabilitySelfHealService.name);

  constructor(
    private readonly cache: CacheService,
    private readonly prisma: PrismaService,
    private readonly writer: CapabilityOverridesWriterService,
    // v3.1 §B.7 (2026-05-24)：feature flag 服务（Optional 保留 BC；
    // 注入后用 isSelfHealEnabled() 替代原 process.env 直读）。
    @Optional()
    private readonly flags?: CapabilityFeatureFlagsService,
  ) {}

  async maybeSelfHeal(
    opts: MaybeSelfHealOptions,
  ): Promise<MaybeSelfHealResult> {
    try {
      // 1. feature flag（v3.1 §B.7：flags service 优先，env 作为 fallback；都不命中默认开）
      if (this.flags) {
        const enabled = await this.flags.isSelfHealEnabled();
        if (!enabled) {
          return { healed: false, reason: "feature_flag_disabled" };
        }
      } else if (process.env.ENABLE_CAPABILITY_SELF_HEAL === "false") {
        // 未注入 flags（旧 spec 路径）→ 退回 env 直读，保留 BC
        return { healed: false, reason: "feature_flag_disabled" };
      }

      // 2. target 限定：self-heal 永不触及 admin 全局表（§4.2 D2）
      if (opts.target.kind !== "user_model_config") {
        this.logger.warn(
          `[self-heal] rejected non-user_model_config target kind=${opts.target.kind}`,
        );
        return { healed: false, reason: "target_kind_not_supported" };
      }

      // 3. 错误信号 4 重严校（B 子片 2 简化）
      const signalCheck = this.checkErrorSignal(opts);
      if (!signalCheck.ok) {
        return { healed: false, reason: signalCheck.reason };
      }

      // 4. cooling-off 守护：24h 内同 scopeKey+field 有 admin override → 拒
      const ownerUserId = await this.lookupOwnerUserId(opts.target);
      if (!ownerUserId) {
        return { healed: false, reason: "target_row_missing" };
      }
      const scopeKey = `user:${ownerUserId}:user_model_config:${opts.target.id}`;
      const cooledOff = await this.hasRecentAdminOverride(scopeKey, opts.field);
      if (cooledOff) {
        return { healed: false, reason: "admin_override_cooling_off" };
      }

      // 5. 阈值计数（Redis INCR + EXPIRE，count<3 → 拒）
      const counterKey = this.buildCounterKey(scopeKey, opts);
      const count = await this.cache.incrby(counterKey, 1);
      // 仅第一次设置 expire；后续 INCR 不重置（Redis 原生 INCR 不触 TTL）
      if (count === 1) {
        await this.cache.expire(counterKey, SELF_HEAL_WINDOW_SECONDS);
      }
      if (count < SELF_HEAL_THRESHOLD) {
        return {
          healed: false,
          reason: `threshold_not_reached(${count}/${SELF_HEAL_THRESHOLD})`,
        };
      }

      // 6. advisory lock + writer 写入
      await this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`
            SELECT pg_advisory_xact_lock(hashtext(${`${scopeKey}:${opts.field}`}))::text AS lock
          `;

          // TOCTOU 防护：拿锁后再次检查 cooling-off（admin 可能在我们 INCR 后写入）
          const stillSafe = await this.hasRecentAdminOverride(
            scopeKey,
            opts.field,
          );
          if (stillSafe) {
            throw new Error("admin_override_cooling_off_after_lock");
          }

          const patch = this.buildSelfHealPatch(opts);
          const reason = this.buildSelfHealReason(opts);

          const writeOpts: ApplyOverrideOptions = {
            target: opts.target,
            scope: "SYSTEM",
            actor: { id: "system", role: "system" },
            patch,
            source: "self-heal-user",
            reason,
          };
          await this.writer.applyOverrideInTx(tx, writeOpts);
        },
        { maxWait: 5_000, timeout: 30_000 },
      );

      // 7. 写入成功 → 清 Redis counter（不影响下次自愈窗口）
      await this.cache.del(counterKey);

      this.logger.log(
        `[self-heal] healed scopeKey=${scopeKey} field=${opts.field} from=${String(opts.fromValue)} to=${String(opts.toValue)}`,
      );
      return { healed: true, reason: "self_healed" };
    } catch (err) {
      // self-heal 是后台路径，吞错避免业务挂；记 warn 让 SRE 看见
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `[self-heal] exception healed=false err=${msg.slice(0, 200)}`,
      );
      return { healed: false, reason: `exception:${msg.slice(0, 80)}` };
    }
  }

  // ─────────── helpers ───────────

  private checkErrorSignal(opts: MaybeSelfHealOptions): {
    ok: boolean;
    reason: string;
  } {
    const sig = opts.errorSignal;
    // 1. HTTP status 白名单
    if (!ALLOWED_HTTP_STATUSES.has(sig.httpStatus)) {
      return { ok: false, reason: "http_status_not_whitelisted" };
    }
    // 1b. 200 仅允许与合成 degenerate-output 配对（防止任何非退化的 200 信号
    //     绕过；真实 provider 错误恒为 4xx/5xx）。
    if (
      sig.httpStatus === 200 &&
      sig.errorCode !== DEGENERATE_OUTPUT_ERROR_CODE
    ) {
      return { ok: false, reason: "http_200_requires_degenerate_code" };
    }
    // 2. error code 白名单
    if (!ALLOWED_ERROR_CODES.has(sig.errorCode)) {
      return { ok: false, reason: "error_code_not_whitelisted" };
    }
    // 3. body 反查：含 fromValue 字符串或 field 字段名
    const fromValueStr = String(opts.fromValue);
    const fieldLeaf = opts.field.split(".").pop() ?? opts.field;
    const bodyLower = sig.bodySnippet.toLowerCase();
    if (
      !bodyLower.includes(fromValueStr.toLowerCase()) &&
      !bodyLower.includes(fieldLeaf.toLowerCase())
    ) {
      return { ok: false, reason: "body_snippet_no_evidence" };
    }
    return { ok: true, reason: "passed" };
  }

  private async lookupOwnerUserId(
    target: CapabilityOverrideTarget,
  ): Promise<string | null> {
    if (target.kind !== "user_model_config") return null;
    const row = await this.prisma.userModelConfig.findUnique({
      where: { id: target.id },
      select: { userId: true },
    });
    return row?.userId ?? null;
  }

  private async hasRecentAdminOverride(
    scopeKey: string,
    field: string,
  ): Promise<boolean> {
    const since = new Date(Date.now() - COOLING_OFF_HOURS * 3600 * 1000);
    const hit = await this.prisma.capabilityOverrideAuditLog.findFirst({
      where: {
        scopeKey,
        field,
        source: "admin-override",
        createdAt: { gte: since },
      },
      select: { id: true },
    });
    return !!hit;
  }

  private buildCounterKey(
    scopeKey: string,
    opts: MaybeSelfHealOptions,
  ): string {
    const safeFrom = String(opts.fromValue).replace(/[^a-z0-9_-]/gi, "");
    return `capability:selfheal:counter:${scopeKey}:${opts.field}:${safeFrom}`;
  }

  /**
   * 把 `field='structuredOutput.nativeMode' + toValue='none'` 转换成嵌套
   * patch 体 `{ structuredOutput: { nativeMode: 'none' } }` + `__meta` 标记。
   *
   * 手写 5 行 set-path，避免 lodash 依赖（CLAUDE.md 反过度抽象）。
   */
  private buildSelfHealPatch(
    opts: MaybeSelfHealOptions,
  ): ModelCapabilitiesOverrides {
    const segs = opts.field.split(".");
    // 从叶子往上嵌套：'structuredOutput.nativeMode' + 'none'
    //   step 1: { nativeMode: 'none' }
    //   step 2: { structuredOutput: { nativeMode: 'none' } }
    let nested: Record<string, unknown> = {
      [segs[segs.length - 1]]: opts.toValue,
    };
    for (let i = segs.length - 2; i >= 0; i--) {
      nested = { [segs[i]]: nested };
    }
    // __meta 顶层附加（与嵌套的 structuredOutput / toolUse / ... 并列）
    nested.__meta = {
      autoDowngraded: true,
      selfHealedAt: new Date().toISOString(),
      selfHealedReason:
        `${opts.errorSignal.httpStatus}_${opts.errorSignal.errorCode}`.slice(
          0,
          100,
        ),
      source: "self-heal-user" as const,
    };
    return nested as ModelCapabilitiesOverrides;
  }

  private buildSelfHealReason(opts: MaybeSelfHealOptions): string {
    // 必须 ≥30 字符（writer service guardReason）
    return `auto self-heal: HTTP ${opts.errorSignal.httpStatus} ${opts.errorSignal.errorCode}; field=${opts.field}; threshold=${SELF_HEAL_THRESHOLD} hits/${SELF_HEAL_WINDOW_SECONDS}s`;
  }
}

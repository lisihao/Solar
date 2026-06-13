/**
 * BusinessAgentTeam — Rerun Guard Framework（P5 Wave 1，2026-05-24）
 *
 * @migrated-from ai-app/playground/services/mission/rerun/rerun-guard.service.ts
 *
 * 抽出 RerunGuardService 的机制部分（business-agnostic 骨架），让 social/radar 反向迁移
 * 时只需注入 4 个业务 hook 即可获得完整能力：
 *
 *   机制（framework 提供）：
 *     - checkInFlight 骨架：调 hook 读 detail / latest-business-event-ts → decideMissionInFlight
 *     - ensureRerunable 骨架：checkInFlight 包 fail-closed try/catch → throw BadRequest
 *     - zombieCleanup 骨架：detail 二次校验 + finalize（条件写仲裁）+ clearHeartbeat
 *     - emit zombie-cleanup event helper（业务方提供 type 字符串）
 *
 *   业务（hook）：
 *     - detailReader: 业务怎么读主行 + heartbeatAt（business store schema）
 *     - latestBusinessEventTsReader: 业务怎么查 latest business event（业务表名 / 事件前缀）
 *     - eventEmitter: 怎么写 zombie-cleanup audit event（业务事件表）
 *     - eventTypes / errorMessage: 业务 type 字符串 + i18n 错误消息
 */

import { BadRequestException, Logger } from "@nestjs/common";
import {
  decideMissionInFlight,
  HEARTBEAT_FRESH_THRESHOLD_MS_DEFAULT,
  BUSINESS_EVENT_FRESH_THRESHOLD_MS_DEFAULT,
} from "./heartbeat-decision";
import type { IBusinessRerunGuard } from "../abstractions/rerun-guard.interface";
import type {
  MissionLifecycleManager,
  MissionTerminalArbiter,
} from "../../../lifecycle/mission-lifecycle/mission-lifecycle-manager";

/**
 * Guard 读出的 detail 最小投影（framework 仅需 status / heartbeatAt）。
 * 业务侧的 detail 可携带更多字段，作为 TDetail 透传给 finalize extra。
 */
export interface BusinessRerunGuardDetailMinimal {
  readonly id?: string;
  readonly status: string;
  readonly heartbeatAt?: Date | null;
}

/**
 * Guard 框架 hook 集合 — business 子类构造时提供。
 *
 * @template TDetail business 主行 detail（≥ BusinessRerunGuardDetailMinimal）
 * @template TTerminalExtra business 终态 extra payload（lifecycleManager.finalize 用）
 */
export interface BusinessTeamRerunGuardHooks<
  TDetail extends BusinessRerunGuardDetailMinimal,
  TTerminalExtra,
> {
  /** 读 mission 主行（含 ownership 校验）；null → 视为不存在跳过判定 */
  readonly detailReader: (
    missionId: string,
    userId: string,
  ) => Promise<TDetail | null>;
  /** 查最近一条 business event ts（毫秒）；null → 无业务活迹 */
  readonly latestBusinessEventTsReader: (
    missionId: string,
  ) => Promise<number | null>;
  /** clearHeartbeat 写库（业务 store 实现） */
  readonly clearHeartbeat: (missionId: string, userId: string) => Promise<void>;
  /** 写一条 zombie-cleanup audit 事件（业务事件表） */
  readonly emitZombieCleanup: (event: {
    missionId: string;
    userId: string;
    payload: Record<string, unknown>;
  }) => Promise<void>;
  /** finalize 仲裁器（业务 store 实现 MissionTerminalArbiter） */
  readonly terminalArbiter: MissionTerminalArbiter<TTerminalExtra>;
  /** 构造 zombie cleanup 时的终态 extra payload（业务 shape） */
  readonly buildZombieTerminalExtra: (args: {
    missionId: string;
    userId: string;
  }) => TTerminalExtra;
  /** 业务 type 字符串 / 错误消息 */
  readonly eventTypes: {
    readonly zombieCleanup: string;
  };
  /** running status 判定字符串（默认 ["running"]） */
  readonly runningStatuses?: readonly string[];
  /** heartbeat fresh 阈值（默认 60s） */
  readonly heartbeatFreshThresholdMs?: number;
  /** business event fresh 阈值（默认 5min） */
  readonly businessEventFreshThresholdMs?: number;
  /** namespace（log 前缀） */
  readonly namespace: string;
}

export interface BusinessRerunGuardResult {
  readonly inFlight: boolean;
  readonly zombieDetected: boolean;
  readonly status: string;
  readonly heartbeatAgeMs: number | null;
  readonly latestBusinessEventAgeMs: number | null;
  readonly reason?: string;
}

/**
 * Rerun guard framework — 提供 checkInFlight / ensureRerunable / zombieCleanup 骨架。
 * 业务方继承 + 提供 hook 即可获得 9-cell 决策 + zombie 主动清理能力。
 */
export abstract class BusinessTeamRerunGuardFramework<
  TDetail extends BusinessRerunGuardDetailMinimal,
  TTerminalExtra,
> implements IBusinessRerunGuard {
  protected readonly log: Logger;

  constructor(
    protected readonly lifecycleManager: MissionLifecycleManager,
    protected readonly hooks: BusinessTeamRerunGuardHooks<
      TDetail,
      TTerminalExtra
    >,
  ) {
    this.log = new Logger(`${hooks.namespace}-rerun-guard`);
  }

  async checkInFlight(
    missionId: string,
    userId: string,
  ): Promise<BusinessRerunGuardResult> {
    const detail = await this.hooks.detailReader(missionId, userId);
    if (!detail) {
      return {
        inFlight: false,
        zombieDetected: false,
        status: "failed",
        heartbeatAgeMs: null,
        latestBusinessEventAgeMs: null,
      };
    }

    const runningStatuses = this.hooks.runningStatuses ?? ["running"];
    if (!runningStatuses.includes(detail.status)) {
      return {
        inFlight: false,
        zombieDetected: false,
        status: detail.status,
        heartbeatAgeMs: null,
        latestBusinessEventAgeMs: null,
      };
    }

    const now = Date.now();
    const heartbeatAgeMs = detail.heartbeatAt
      ? now - detail.heartbeatAt.getTime()
      : detail.heartbeatAt === null
        ? null
        : null;
    const latestBusinessTs =
      await this.hooks.latestBusinessEventTsReader(missionId);
    const latestBusinessEventAgeMs =
      latestBusinessTs != null ? now - latestBusinessTs : null;

    const decision = decideMissionInFlight({
      status: detail.status,
      heartbeatAgeMs,
      latestBusinessEventAgeMs,
      heartbeatFreshThresholdMs:
        this.hooks.heartbeatFreshThresholdMs ??
        HEARTBEAT_FRESH_THRESHOLD_MS_DEFAULT,
      businessEventFreshThresholdMs:
        this.hooks.businessEventFreshThresholdMs ??
        BUSINESS_EVENT_FRESH_THRESHOLD_MS_DEFAULT,
      runningStatuses,
    });

    return {
      inFlight: decision.inFlight,
      zombieDetected: decision.zombieDetected,
      status: detail.status,
      heartbeatAgeMs,
      latestBusinessEventAgeMs,
      ...(decision.reason ? { reason: decision.reason } : {}),
    };
  }

  async ensureRerunable(missionId: string, userId: string): Promise<void> {
    let guard: BusinessRerunGuardResult;
    try {
      guard = await this.checkInFlight(missionId, userId);
    } catch (err) {
      this.log.warn(
        `[${this.hooks.namespace}-rerun-guard ${missionId}] checkInFlight threw, fail-closed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw new BadRequestException("rerun guard 服务异常，请稍后重试");
    }

    if (guard.inFlight) {
      throw new BadRequestException(
        `mission ${missionId} is in-flight (${guard.reason ?? "running"})`,
      );
    }

    if (guard.zombieDetected) {
      await this.zombieCleanup(missionId, userId);
    }
  }

  /**
   * 主动清理 zombie mission（heartbeat fresh + business event stale）。
   *
   * 安全要点（与 reference impl 一致）：
   *   1. 再读 detail：跨用户 missionId 返回 null → 跳过
   *   2. status 已非 running → 跳过（race resolved）
   *   3. lifecycleManager.finalize 单入口仲裁（条件写 WHERE status='running' 首写赢）
   *   4. clearHeartbeat + emit zombie-cleanup audit event（best-effort）
   */
  protected async zombieCleanup(
    missionId: string,
    userId: string,
  ): Promise<void> {
    const detail = await this.hooks.detailReader(missionId, userId);
    if (!detail) {
      this.log.warn(
        `[${this.hooks.namespace}-rerun-guard ${missionId}] zombieCleanup skip: mission not owned by user ${userId}`,
      );
      return;
    }
    const runningStatuses = this.hooks.runningStatuses ?? ["running"];
    if (!runningStatuses.includes(detail.status)) {
      this.log.warn(
        `[${this.hooks.namespace}-rerun-guard ${missionId}] zombieCleanup skip: status=${detail.status} (race resolved)`,
      );
      return;
    }

    await this.lifecycleManager.finalize<TTerminalExtra>({
      missionId,
      intent: {
        status: "failed",
        extra: this.hooks.buildZombieTerminalExtra({ missionId, userId }),
      },
      arbiter: this.hooks.terminalArbiter,
    });
    await this.hooks.clearHeartbeat(missionId, userId).catch((err: unknown) => {
      this.log.warn(
        `[${this.hooks.namespace}-rerun-guard ${missionId}] clearHeartbeat threw (best-effort): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
    await this.hooks
      .emitZombieCleanup({
        missionId,
        userId,
        payload: {
          triggeredBy: userId,
          ts: Date.now(),
          reason: "heartbeat fresh but no BUSINESS event ≥ threshold",
        },
      })
      .catch((err: unknown) => {
        this.log.warn(
          `[${this.hooks.namespace}-rerun-guard ${missionId}] emit zombie-cleanup event threw: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    this.log.warn(
      `[${this.hooks.namespace}-rerun-guard ${missionId}] zombie cleanup performed (user ${userId})`,
    );
  }
}

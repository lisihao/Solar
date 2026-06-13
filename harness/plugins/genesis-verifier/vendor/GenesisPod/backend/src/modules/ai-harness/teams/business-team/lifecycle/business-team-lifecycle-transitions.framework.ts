/**
 * BusinessAgentTeam — Mission Lifecycle State Transitions Framework
 * (P6 Wave 1, 2026-05-24)
 *
 * @migrated-from ai-app/playground/services/mission/lifecycle/mission-lifecycle.helper.ts
 *
 * 抽出 mission 状态机通用机制：
 *   - writeCompleted / writeCancelled / writeFailed —— 条件写 WHERE status='running'
 *     首写者赢 (返回 boolean: true=本次赢、false=已终态 no-op)
 *   - markReopened —— failed/quality-failed → running 反向 transition
 *   - report payload 超限保护（hard limit 抛 PayloadTooLargeException / soft limit truncate）
 *
 * 业务方注入：
 *   - buildCompletedUpdate / buildFailedUpdate / buildCancelledUpdate (data shape)
 *   - conditionalUpdate / reopenTransaction (DB IO)
 *   - reopenResetData (业务侧 reset 字段)
 */

import {
  BadRequestException,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from "@nestjs/common";
import {
  DEFAULT_REOPENABLE_STATUSES,
  REPORT_HARD_LIMIT_BYTES,
  REPORT_SOFT_LIMIT_BYTES,
  type LifecycleTransitionHooks,
  type UpdateData,
} from "./abstractions/lifecycle-state-transitions.contract";

/** Framework 调用方传入的 report payload 形状（机制层只 size-check，不读字段）。 */
interface ReportPayloadShape {
  readonly content?: {
    fullMarkdown?: string;
    fullReportSize?: number;
    truncated?: boolean;
    originalBytes?: number;
  };
}

export abstract class BusinessTeamLifecycleTransitionsFramework<
  TCompletedDetail extends { report?: ReportPayloadShape | unknown },
  TFailedDetail extends { report?: ReportPayloadShape | unknown },
> {
  protected readonly log: Logger;
  protected readonly reopenableStatuses: readonly string[];

  constructor(
    protected readonly hooks: LifecycleTransitionHooks<
      TCompletedDetail,
      TFailedDetail
    >,
    loggerNamespace: string,
  ) {
    this.log = new Logger(loggerNamespace);
    this.reopenableStatuses =
      hooks.reopenableStatuses ?? DEFAULT_REOPENABLE_STATUSES;
  }

  /**
   * 写 completed 终态。条件写 WHERE status='running'，首写者赢。
   * 内置 report payload size guard（hard 10MB 抛、soft 5MB warn+truncate）。
   */
  async writeCompleted(
    missionId: string,
    detail: TCompletedDetail,
    userId?: string,
  ): Promise<boolean> {
    this.guardReportSize(
      missionId,
      detail.report as ReportPayloadShape | undefined,
    );
    const data = this.hooks.buildCompletedUpdate(detail);
    const affected = await this.hooks
      .conditionalUpdate(missionId, { userId }, data)
      .catch((err: unknown) => {
        this.log.warn(
          `[writeCompleted ${missionId}] guarded update failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return 0;
      });
    await this.hooks.clearCheckpoint(missionId);
    return affected > 0;
  }

  /** 写 cancelled 终态。 */
  async writeCancelled(missionId: string, userId?: string): Promise<boolean> {
    const data = this.hooks.buildCancelledUpdate();
    const affected = await this.hooks
      .conditionalUpdate(missionId, { userId }, data)
      .catch((err: unknown) => {
        this.log.warn(
          `[writeCancelled ${missionId}] failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return 0;
      });
    await this.hooks.clearCheckpoint(missionId);
    return affected > 0;
  }

  /** 写 failed 终态（含 leader refusal → quality-failed 分支）。 */
  async writeFailed(
    missionId: string,
    detail: TFailedDetail,
    userId?: string,
  ): Promise<boolean> {
    // Failure 路径 report 超限不抛错（业务侧 detail.report 已被 patch 为 undefined）
    const reportShape = detail.report as ReportPayloadShape | undefined;
    if (reportShape && typeof reportShape === "object") {
      const failSize = Buffer.byteLength(JSON.stringify(reportShape), "utf8");
      if (failSize > REPORT_HARD_LIMIT_BYTES) {
        // 业务方在 buildFailedUpdate 内部会处理（移除 report 字段+errorMessage='report_too_large'）
        this.log.warn(
          `[writeFailed ${missionId}] report size ${failSize} > hard limit; business hook expected to drop it`,
        );
      }
    }
    const { update } = this.hooks.buildFailedUpdate(detail);
    const affected = await this.hooks
      .conditionalUpdate(missionId, { userId }, update)
      .catch((err: unknown) => {
        this.log.warn(
          `[writeFailed ${missionId}] failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return 0;
      });
    await this.hooks.clearCheckpoint(missionId);
    return affected > 0;
  }

  /**
   * 反向 transition：failed/quality-failed → running。乐观锁 + probe 校验。
   */
  async markReopened(missionId: string, userId: string): Promise<void> {
    const { affected, currentStatus } = await this.hooks.reopenTransaction(
      missionId,
      userId,
      this.reopenableStatuses,
    );
    if (affected > 0) return;
    if (currentStatus === null) {
      throw new NotFoundException(
        `mission ${missionId} not found or not owned by ${userId}`,
      );
    }
    throw new BadRequestException(
      `cannot reopen mission in status=${currentStatus} (allowed: ${this.reopenableStatuses.join("|")})`,
    );
  }

  /**
   * Report payload size guard（completed 路径）：
   *   - hard limit (10MB)：直接抛 PayloadTooLargeException
   *   - soft limit (5MB)：warn + truncate fullMarkdown 到 100K 字符
   */
  protected guardReportSize(
    missionId: string,
    report: ReportPayloadShape | undefined,
  ): void {
    if (!report || typeof report !== "object") return;
    const size = Buffer.byteLength(JSON.stringify(report), "utf8");
    if (size > REPORT_HARD_LIMIT_BYTES) {
      throw new PayloadTooLargeException(
        `report_too_large: ${size} bytes exceeds ${REPORT_HARD_LIMIT_BYTES} byte hard limit`,
      );
    }
    if (size > REPORT_SOFT_LIMIT_BYTES) {
      this.log.warn(
        `[writeCompleted ${missionId}] report size ${size} > ${REPORT_SOFT_LIMIT_BYTES} bytes — truncating`,
      );
      const r = report;
      if (r.content?.fullMarkdown && r.content.fullMarkdown.length > 100_000) {
        r.content.fullMarkdown =
          r.content.fullMarkdown.slice(0, 100_000) +
          `\n\n... (truncated, ${size} bytes total)`;
        r.content.truncated = true;
        r.content.originalBytes = size;
      }
    }
  }

  /** Helper: 业务方在 buildXxxUpdate 内部用，统一 errorMessage 截断到 2000 chars。 */
  protected truncateErrorMessage(message: string | undefined): string | null {
    if (message == null) return null;
    return message.slice(0, 2000);
  }
}

/** Re-export update shape for business subclasses. */
export type { UpdateData };

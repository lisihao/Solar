/**
 * BusinessTeamResumeRerunPolicyFramework — Backend-authoritative resumable/rerunnable policy（B6-L4 lift）
 *
 * 落地依据：thinning plan §6.5.1 / §6.5.1.b / §6.5.2 / §6.5.2.a / §5.3 / §8.2 lift criteria
 *
 * 2026-05-26 lift：核心 policy 算法对所有 mission-based app 通用；
 * 业务方仅注入 stage matrix + ordered stage ids 即可复用。
 *
 * §8.2 lift criteria：
 *   ✅ business-name-agnostic（不依赖具体 app 名）
 *   ✅ parameterizable（matrix + ordered stage ids 由调用方传入）
 *   ✅ no app code import
 *   ✅ harness-only fixture-testable
 */

import { Logger } from "@nestjs/common";
import type { MissionStatus as MissionViewStatus } from "../abstractions/mission-view-base.contract";

// ============================================================================
// Stage matrix & ordering (app-provided)
// ============================================================================

export interface StageResumeRule {
  /** checkpoint 存在时是否允许 resume（§6.5.1.b matrix）。 */
  allowedIfCheckpoint: boolean;
  /** 拒绝原因（denied 时给前端展示）。 */
  reasonDenied?: string;
}

/**
 * App-provided stage matrix：14 个 stage id → resume rule。
 * key 顺序无关；执行顺序由 orderedStageIds 决定。
 */
export type StageResumeMatrix = Readonly<Record<string, StageResumeRule>>;

// ============================================================================
// Decision shapes
// ============================================================================

export interface ResumeDecision {
  resumable: boolean;
  reason?: string;
}

export interface RerunnableStageEntry {
  id: string;
  allowed: boolean;
  reason?: string;
}

export interface PolicyInput {
  publicStatus: MissionViewStatus;
  hasConfigSnapshot: boolean;
  hasCheckpoint: boolean;
  /** Prisma `last_completed_stage` Int 序数（1-based，对齐 orderedStageIds）。 */
  lastCompletedStageOrdinal: number | null;
}

// ============================================================================
// Framework
// ============================================================================

export interface BusinessTeamResumeRerunPolicyOptions {
  orderedStageIds: readonly string[];
  stageMatrix: StageResumeMatrix;
  loggerNamespace?: string;
}

export class BusinessTeamResumeRerunPolicyFramework {
  protected readonly log: Logger;
  protected readonly orderedStageIds: readonly string[];
  protected readonly stageMatrix: StageResumeMatrix;

  constructor(options: BusinessTeamResumeRerunPolicyOptions) {
    this.orderedStageIds = options.orderedStageIds;
    this.stageMatrix = options.stageMatrix;
    this.log = new Logger(
      options.loggerNamespace ?? "BusinessTeamResumeRerunPolicy",
    );
  }

  /**
   * §6.5.1 resumable 决策。
   *
   * 4 rule 检查：configSnapshot / checkpoint / status / stage matrix。
   */
  computeResumable(input: PolicyInput): ResumeDecision {
    // §5.3 rule 3
    if (!input.hasConfigSnapshot) {
      return {
        resumable: false,
        reason:
          "legacy mission row without configSnapshot — cannot resume through canonical path",
      };
    }
    // §6.5.1 rule 1
    if (!input.hasCheckpoint) {
      return { resumable: false, reason: "no checkpoint available" };
    }
    // §6.5.1 rule 2
    if (
      input.publicStatus === "completed" ||
      input.publicStatus === "quality-failed"
    ) {
      return {
        resumable: false,
        reason: "mission already terminal-success or quality-failed",
      };
    }
    if (input.publicStatus === "running" || input.publicStatus === "starting") {
      return {
        resumable: false,
        reason: "mission still active, resume not applicable",
      };
    }
    // failed/cancelled + checkpoint + configSnapshot → stage matrix
    const stage = this.ordinalToStageId(input.lastCompletedStageOrdinal);
    if (stage && this.stageMatrix[stage]?.allowedIfCheckpoint === false) {
      return {
        resumable: false,
        reason:
          this.stageMatrix[stage]?.reasonDenied ??
          "stage not in resumable matrix",
      };
    }
    return { resumable: true };
  }

  /**
   * §6.5.2.a first-cut rerun policy.
   *
   * rerunnableStages 数组按 orderedStageIds 顺序输出。
   * cascade 由 rerun controller 决定；本 framework 只返回 allowed + 静态原因。
   */
  computeRerunnableStages(input: PolicyInput): RerunnableStageEntry[] {
    if (!input.hasConfigSnapshot) {
      return this.orderedStageIds.map((id) => ({
        id,
        allowed: false,
        reason:
          "legacy mission row without configSnapshot — cannot rerun through canonical path",
      }));
    }
    if (input.publicStatus === "running" || input.publicStatus === "starting") {
      return this.orderedStageIds.map((id) => ({
        id,
        allowed: false,
        reason: "mission still active; cancel or wait before rerun",
      }));
    }
    return this.orderedStageIds.map((id) => {
      const matrix = this.stageMatrix[id];
      if (!matrix) {
        return { id, allowed: false, reason: "stage not in canonical matrix" };
      }
      if (!matrix.allowedIfCheckpoint) {
        return { id, allowed: false, reason: matrix.reasonDenied };
      }
      return { id, allowed: true };
    });
  }

  /** 1-based ordinal → stage id。越界返回 null。 */
  protected ordinalToStageId(ordinal: number | null): string | null {
    if (ordinal == null) return null;
    if (ordinal < 1 || ordinal > this.orderedStageIds.length) return null;
    return this.orderedStageIds[ordinal - 1];
  }
}

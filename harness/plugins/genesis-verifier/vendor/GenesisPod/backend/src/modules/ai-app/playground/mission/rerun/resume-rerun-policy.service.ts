/**
 * ResumeRerunPolicyService — Backend-authoritative resumable/rerunnable decisions
 *
 * 落地依据：thinning plan §6.5.1 / §6.5.1.b / §6.5.2 / §6.5.2.a / §5.3
 *
 * 2026-05-26 B6-L4：本 service 现 thin-wrap BusinessTeamResumeRerunPolicyFramework
 * （注入 playground 专属 stage matrix + ORDERED_STAGE_IDS），core policy 算法
 * 共享给 social/radar 复用。
 */

import { Injectable } from "@nestjs/common";

import type { RerunnableStageEntry } from "../../api/contracts/view-state.contract";
import type { MissionDetail } from "../lifecycle/mission-store.service";
import { PrismaMissionCheckpointStore } from "../lifecycle/prisma-mission-checkpoint.store";
import {
  BusinessTeamResumeRerunPolicyFramework,
  type StageResumeMatrix,
  type ResumeDecision,
  type PolicyInput,
} from "@/modules/ai-harness/facade";

// ============================================================================
// §6.5.1.b first-cut resume matrix（playground 14 canonical stages）
// ============================================================================

const STAGE_RESUME_MATRIX: StageResumeMatrix = {
  "s1-budget": {
    allowedIfCheckpoint: false,
    reasonDenied: "cheap to restart, no meaningful checkpoint value",
  },
  "s2-leader-plan": { allowedIfCheckpoint: true },
  "s3-researchers": { allowedIfCheckpoint: true },
  "s4-leader-assess": { allowedIfCheckpoint: true },
  "s5-reconciler": { allowedIfCheckpoint: true },
  "s6-analyst": { allowedIfCheckpoint: true },
  "s7-writer-outline": { allowedIfCheckpoint: true },
  "s8-writer-draft": { allowedIfCheckpoint: true },
  "s8b-quality-enhancement": { allowedIfCheckpoint: true },
  "s9-critic-l4": { allowedIfCheckpoint: true },
  "s9b-objective-evaluation": { allowedIfCheckpoint: true },
  "s10-leader-signoff": { allowedIfCheckpoint: true },
  "s11-persist": {
    allowedIfCheckpoint: false,
    reasonDenied: "treat as rerun or restart boundary",
  },
  "s12-self-evolution": {
    allowedIfCheckpoint: false,
    reasonDenied: "postlude, non-blocking in public contract",
  },
};

/** matrix key 顺序（B2-2 projector 输出 rerunnableStages 时按此顺序排列）。 */
export const ORDERED_STAGE_IDS: readonly string[] = [
  "s1-budget",
  "s2-leader-plan",
  "s3-researchers",
  "s4-leader-assess",
  "s5-reconciler",
  "s6-analyst",
  "s7-writer-outline",
  "s8-writer-draft",
  "s8b-quality-enhancement",
  "s9-critic-l4",
  "s9b-objective-evaluation",
  "s10-leader-signoff",
  "s11-persist",
  "s12-self-evolution",
];

// ============================================================================
// Re-exports for backward compatibility
// ============================================================================

export type { ResumeDecision };
export type RerunDecisionInput = PolicyInput;

// ============================================================================
// Service
// ============================================================================

@Injectable()
export class ResumeRerunPolicyService extends BusinessTeamResumeRerunPolicyFramework {
  constructor(private readonly checkpointStore: PrismaMissionCheckpointStore) {
    super({
      orderedStageIds: ORDERED_STAGE_IDS,
      stageMatrix: STAGE_RESUME_MATRIX,
      loggerNamespace: "ResumeRerunPolicyService",
    });
  }

  /**
   * 加载 checkpoint 存在性（§5.3 rule "checkpoint exists" 实质 = configSnapshot 非空
   * 且 checkpoint store 能 reconstruct enough state）。
   *
   * legacy null config snapshot 直接判 false（§5.3 rule 3）。
   */
  async loadCheckpointAvailability(
    mission: MissionDetail,
  ): Promise<{ hasConfigSnapshot: boolean; hasCheckpoint: boolean }> {
    const hasConfigSnapshot = mission.configSnapshot != null;
    if (!hasConfigSnapshot) {
      return { hasConfigSnapshot: false, hasCheckpoint: false };
    }
    const snapshot = await this.checkpointStore.load(mission.id);
    return { hasConfigSnapshot, hasCheckpoint: snapshot != null };
  }

  // Type-narrow framework's RerunnableStageEntry → view-state contract's variant.
  // 两者形状一致；nominal 化 cast 让 controller 类型 stable。
  computeRerunnableStages(input: PolicyInput): RerunnableStageEntry[] {
    return super.computeRerunnableStages(input) as RerunnableStageEntry[];
  }
}

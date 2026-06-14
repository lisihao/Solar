/**
 * radar/api/contracts/view-state.contract.ts — Radar canonical view contract（B7-2）
 *
 * 落地依据：thinning plan §B7-2 / §6.2 / §6.4.1.a (per-app status mapping).
 *
 * Radar's "mission" persistence row is `RadarRun`（不叫 mission，是 cron-driven 刷新）。
 * Mirror playground pattern — 复用 harness MissionViewBase，extend radar-specific 字段。
 */

export {
  TERMINAL_MISSION_STATUSES,
  isMissionTerminal,
} from "@/modules/ai-harness/facade";
export type {
  MissionViewStatus as MissionStatus,
  MissionViewStageStatus as StageStatus,
  MissionViewAgentPhase as AgentPhase,
  RefreshHintFamily,
  RefreshHint,
  RerunnableStageEntry,
  MissionViewBaseMission,
  MissionViewBaseStage,
  MissionViewBaseAgent,
  EmptyArtifactSentinel,
  MissionMemorySentinel,
  MissionCostView,
} from "@/modules/ai-harness/facade";

import type {
  MissionViewBase,
  MissionViewBaseMission,
  TodoBoardSentinel,
} from "@/modules/ai-harness/facade";

// ============================================================================
// Radar-specific domain shape (§B7-2)
// ============================================================================

/**
 * Radar persistence-to-view status mapping (§6.4.1.a):
 *   running   -> running
 *   completed -> completed
 *   failed    -> failed
 *   cancelled -> cancelled        (radar-specific, social uses aborted)
 *   rejected  -> quality-failed   (same as playground pattern)
 *
 * Note radar mission output is per-day "briefing" (separate RadarDailyBriefing
 * model) rather than per-run report; canonical view exposes briefingRef foreign
 * key when terminal, full briefing detail goes via a sibling endpoint.
 */
export type RadarRunTrigger = "MANUAL" | "SCHEDULED" | "BOOTSTRAP";

export interface RadarBriefingRef {
  date: string;
  briefingId?: string;
}

export type RadarTodoBoardEntry = {
  id: string;
  origin: string;
  scope: "mission" | "system";
  status: "pending" | "in_progress" | "done" | "failed";
  title: string;
  systemStageId?: string;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
};

/**
 * RadarDomainView — extends harness MissionViewBase。
 *
 * §6.3 radar frozen extension fields:
 *   topicId / trigger / payload summary / metrics summary / failureCode /
 *   briefingRef / lastCompletedStage
 */
export interface RadarDomainView
  extends MissionViewBase<RadarBriefingRef, RadarTodoBoardEntry> {
  mission: MissionViewBaseMission & {
    topicId?: string;
    trigger?: RadarRunTrigger;
    durationMs?: number | null;
    wallTimeCapMs?: number | null;
    maxCredits?: number;
    failureCode?: string | null;
    terminalOutcome?: string | null;
    /** B7-2 first-cut: full metrics shape kept opaque; sibling endpoint owns detail. */
    metricsSummary?: { fetched?: number; accepted?: number; llmCost?: number };
  };
}

// ============================================================================
// View envelope
// ============================================================================

export interface RadarMissionViewEnvelope {
  view: RadarDomainView;
}

export type RadarTodoBoardSentinel = TodoBoardSentinel<RadarTodoBoardEntry>;

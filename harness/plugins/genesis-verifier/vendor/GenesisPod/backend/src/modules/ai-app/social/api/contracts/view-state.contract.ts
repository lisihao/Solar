/**
 * social/api/contracts/view-state.contract.ts — Social canonical view contract（B7-1）
 *
 * 落地依据：thinning plan §B7-1 / §6.2 / §6.4.1.a (per-app status mapping).
 *
 * Mirror playground 的 contract 模式 — 复用 harness MissionViewBase canonical types,
 * 在本文件 extend social-specific 业务字段。
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
// Social-specific domain shape (§B7-1)
// ============================================================================

/**
 * Social mission-row outward view fields。
 *
 * Persistence-to-view mapping (§6.4.1.a / readiness assessment §2):
 *   running     -> running
 *   completed   -> completed
 *   failed      -> failed
 *   aborted     -> cancelled    ← social-specific mapping
 *   (social has no quality-failed concept)
 */
export type SocialPlatform =
  | "WECHAT_MP"
  | "XIAOHONGSHU"
  | "ZHIHU"
  | "WEIBO"
  | "TWITTER"
  | "LINKEDIN";

export interface SocialPublishedSummary {
  platform: SocialPlatform;
  status: "draft" | "published" | "scheduled" | "failed";
  publishedAt?: string;
  externalUrl?: string;
}

export type SocialTodoBoardEntry = {
  id: string;
  origin: string;
  scope: "mission" | "platform" | "system";
  status: "pending" | "in_progress" | "done" | "failed";
  title: string;
  platform?: SocialPlatform;
  systemStageId?: string;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
};

/**
 * SocialDomainView — extends harness MissionViewBase with social-specific fields。
 *
 * §6.3 social frozen extension fields:
 *   contentId / platforms / connectionIds keys / depth / budgetProfile /
 *   language / maxCredits / trajectory summary / published summaries / failureCode
 */
export interface SocialDomainView
  extends MissionViewBase<SocialPublishedSummary[], SocialTodoBoardEntry> {
  mission: MissionViewBaseMission & {
    contentId?: string;
    platforms?: SocialPlatform[];
    connectionIds?: Record<string, string>;
    depth?: string;
    budgetProfile?: string;
    language?: string;
    maxCredits?: number;
    failureCode?: string | null;
    /** social aborted -> cancelled outward mapping (§6.4.1.a per-app rule). */
    terminalOutcome?: string | null;
  };
}

// ============================================================================
// View envelope
// ============================================================================

export interface SocialMissionViewEnvelope {
  view: SocialDomainView;
}

// re-export the narrowed TodoBoardSentinel for caller convenience
export type SocialTodoBoardSentinel = TodoBoardSentinel<SocialTodoBoardEntry>;

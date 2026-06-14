/**
 * social-mission-view.projector.ts — Pure projector for social canonical view（B7-1）
 *
 * 落地依据：thinning plan §B7-1 / §6.4.1.a (social aborted -> cancelled mapping).
 *
 * First cut：
 *   ✅ mission row → SocialDomainView.mission 基础映射
 *   ✅ §6.4.1.a per-app status mapping（social aborted -> cancelled）
 *   ✅ cost view
 *   ✅ sentinels for stages/agents/reportArtifact/todoBoard/memory
 *   ⏳ stage projection (B7 follow-up — social pipeline 12 stages)
 *   ⏳ agent projection (B7 follow-up)
 *   ⏳ artifact composer (B7 follow-up — trajectory shape ≠ playground reportArtifact)
 *   ⏳ todoBoard projector (B7 follow-up)
 *
 * §6.7.1 timelineVersion/snapshotVersion 由 mission row 字段 + lastCompletedStage 派生。
 */

import type { SocialMissionQueryInputs } from "../query/social-mission-query.service";
import type {
  MissionStatus,
  SocialDomainView,
  EmptyArtifactSentinel,
  SocialPublishedSummary,
  SocialPlatform,
} from "../../api/contracts/view-state.contract";
import {
  projectStagesByOrdinal,
  type StagePresetEntry,
} from "@/modules/ai-harness/facade";
import type { MissionViewBaseStage } from "@/modules/ai-harness/facade";
import { projectSocialTodoBoard } from "./social-todo-board.projector";
import {
  buildMissionCostView,
  deriveSnapshotVersionFromRow,
} from "@/modules/ai-harness/facade";

// Social pipeline 13 个 stage（mirror social/mission/pipeline/stages/ 目录）
const SOCIAL_STAGES: ReadonlyArray<StagePresetEntry> = [
  { id: "s1-mission-budget-eval", label: "预算评估" },
  { id: "s2-platform-probe", label: "平台探测" },
  { id: "s3-content-transform", label: "内容转换" },
  { id: "s4-leader-assess-transform", label: "Leader 评审转换" },
  { id: "s5-cover-craft", label: "封面制作" },
  { id: "s6-body-compose", label: "正文组装" },
  { id: "s7-polish-review", label: "润色复审" },
  { id: "s8-publish-execute", label: "发布执行" },
  { id: "s8b-publish-retry", label: "发布重试" },
  { id: "s9-publish-verify", label: "发布核验" },
  { id: "s10-leader-signoff", label: "Leader 签字" },
  { id: "s11-mission-persist", label: "持久化" },
  { id: "s12-self-evolution", label: "自我进化" },
];

/**
 * Stage projection — 委托 harness projectStagesByOrdinal helper（C / B6 share）。
 * social-specific stage list 由 SOCIAL_STAGES 提供；其余通用 ordinal 算法走 harness。
 */
function projectSocialStages(
  lastCompletedStage: number | null | undefined,
  missionStatus: MissionStatus,
): MissionViewBaseStage[] {
  return projectStagesByOrdinal(
    SOCIAL_STAGES,
    lastCompletedStage,
    missionStatus,
  );
}

export function projectSocialMissionView(
  inputs: SocialMissionQueryInputs,
): SocialDomainView {
  const row = inputs.row!;

  const publicStatus = resolvePublicStatus(row.status);

  return {
    mission: {
      id: row.id,
      title: undefined, // social mission no title field (content owns)
      status: publicStatus,
      startedAt: row.startedAt?.toISOString(),
      finishedAt: row.completedAt?.toISOString(),
      finalScore: undefined, // social has no aggregate score; per-platform success only
      failureMessage: row.errorMessage ?? undefined,
      resumable: false, // first cut: social resume policy TBD
      canCancel: publicStatus === "running" || publicStatus === "starting",
      rerunnableStages: [], // first cut: B7 follow-up
      contentId: row.contentId,
      platforms: row.platforms as SocialDomainView["mission"]["platforms"],
      connectionIds:
        (row.connectionIds as Record<string, string> | null) ?? undefined,
      depth: row.depth,
      budgetProfile: row.budgetProfile,
      language: row.language,
      maxCredits: row.maxCredits,
      failureCode: row.failureCode ?? null,
      terminalOutcome: deriveTerminalOutcome(row.status),
    },
    stages: projectSocialStages(row.lastCompletedStage, publicStatus),
    agents: projectSocialAgents(row),
    reportArtifact: composeSocialArtifact(row),
    todoBoard: projectSocialTodoBoard(row, inputs.events),
    cost: buildMissionCostView({
      tokensUsed: row.tokensUsed,
      costUsd: row.costUsd,
      elapsedWallTimeMs: row.elapsedWallTimeMs,
    }),
    memory: { kind: "empty-memory" },
    timelineVersion: row.lastCompletedStage ?? 0,
    snapshotVersion: deriveSnapshotVersion(row),
    refreshHints: [],
  };
}

// ============================================================================
// §6.4.1.a per-app status mapping for social
// ============================================================================

function resolvePublicStatus(persisted: string): MissionStatus {
  switch (persisted) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "aborted":
      // social-specific mapping per readiness assessment §2:
      // aborted -> cancelled (social has no quality-failed)
      return "cancelled";
    case "running":
      return "running";
    default:
      return "running";
  }
}

function deriveTerminalOutcome(persisted: string): string | null {
  if (persisted === "completed") return "completed";
  if (persisted === "failed") return "failed";
  if (persisted === "aborted") return "cancelled";
  return null;
}

// ============================================================================
// Agent projection (B7-1b first cut — row-based, no events join yet)
// ============================================================================

/**
 * Social agents projection — first cut 基于 row.platforms 派生最小代理列表。
 *
 * - Leader：每个 social mission 都有 mission leader agent
 * - 每个 platform target → 一个 publisher agent（platform name 当 id）
 *
 * 完整 events-based projection（含 trace / phase 变迁）排 B7 follow-up，
 * 与 playground projectAgents 等价路径。
 */
function projectSocialAgents(row: {
  status: string;
  platforms?: unknown;
}): SocialDomainView["agents"] {
  const status = row.status;
  const isTerminal =
    status === "completed" || status === "failed" || status === "aborted";
  const phase: "pending" | "running" | "completed" | "failed" =
    status === "completed"
      ? "completed"
      : status === "failed" || status === "aborted"
        ? "failed"
        : status === "running"
          ? "running"
          : "pending";

  const agents: SocialDomainView["agents"] = [
    {
      id: "leader",
      role: "leader",
      phase,
    },
  ];

  const platforms = Array.isArray(row.platforms)
    ? (row.platforms as Array<unknown>).filter(
        (p): p is string => typeof p === "string",
      )
    : [];
  for (const p of platforms) {
    agents.push({
      id: `publisher:${p}`,
      role: "publisher",
      phase: isTerminal ? phase : "pending",
    });
  }
  return agents;
}

// ============================================================================
// Sentinels
// ============================================================================

/**
 * Social artifact composer (B7-1b) — row.trajectory → SocialPublishedSummary[]
 *
 * trajectory shape（来自 S11 mission-persist 写入）：
 *   {
 *     probeResults: [...],
 *     platformVersions: { [platform]: { coverUrl, body, ... } },
 *     publishResults: [{ platform, status, publishedUrl, ... }],
 *     verifyResults: [{ platform, publishedUrl, titleMatch, ... }]
 *   }
 *
 * 投影策略：
 *   - 优先用 verifyResults（含 publishedUrl + 核验信息）
 *   - 否则用 publishResults
 *   - 都缺则按 row.platforms 派生空骨架
 *   - trajectory 为 null（未到 S11）→ empty-artifact sentinel
 */
function composeSocialArtifact(row: {
  trajectory?: unknown;
  status?: string;
  platforms?: unknown;
}): SocialPublishedSummary[] | EmptyArtifactSentinel {
  if (row.trajectory == null) {
    return { kind: "empty-artifact", reason: "not-yet-materialized" };
  }
  const t = row.trajectory as Record<string, unknown>;

  // 优先级：verifyResults > publishResults > platforms 骨架
  const verifyResults = Array.isArray(t.verifyResults)
    ? (t.verifyResults as Array<Record<string, unknown>>)
    : [];
  const publishResults = Array.isArray(t.publishResults)
    ? (t.publishResults as Array<Record<string, unknown>>)
    : [];

  const byPlatform = new Map<string, SocialPublishedSummary>();
  for (const r of publishResults) {
    const platform = typeof r.platform === "string" ? r.platform : null;
    if (!platform) continue;
    const statusRaw = typeof r.status === "string" ? r.status : "";
    const status: SocialPublishedSummary["status"] =
      statusRaw === "PUBLISHED"
        ? "published"
        : statusRaw === "FAILED"
          ? "failed"
          : "draft";
    byPlatform.set(platform, {
      platform: platform as SocialPlatform,
      status,
      externalUrl:
        typeof r.publishedUrl === "string"
          ? r.publishedUrl
          : typeof r.draftUrl === "string"
            ? r.draftUrl
            : undefined,
    });
  }
  // verifyResults 覆盖 publishResults（核验拿到的 url 更准）
  for (const r of verifyResults) {
    const platform = typeof r.platform === "string" ? r.platform : null;
    if (!platform) continue;
    const existing = byPlatform.get(platform);
    const url = typeof r.publishedUrl === "string" ? r.publishedUrl : undefined;
    byPlatform.set(platform, {
      platform: platform as SocialPlatform,
      status: existing?.status ?? "published",
      externalUrl: url ?? existing?.externalUrl,
      publishedAt: existing?.publishedAt,
    });
  }

  // 补齐 row.platforms 中没有发布结果的（标 draft）
  if (Array.isArray(row.platforms)) {
    for (const p of row.platforms as Array<unknown>) {
      if (typeof p !== "string") continue;
      if (!byPlatform.has(p)) {
        byPlatform.set(p, {
          platform: p as SocialPlatform,
          status: "draft",
        });
      }
    }
  }

  const items = Array.from(byPlatform.values());
  if (items.length === 0) {
    return { kind: "empty-artifact", reason: "v1-needs-normalization" };
  }
  return items;
}

function deriveSnapshotVersion(row: {
  lastCompletedStage?: number | null;
  completedAt?: Date | null;
  errorMessage?: string | null;
}): number {
  return deriveSnapshotVersionFromRow(row, {
    extraFlags: [row.errorMessage],
  });
}

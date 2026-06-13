/**
 * radar-mission-view.projector.ts — Pure projector for radar canonical view（B7-2）
 *
 * 落地依据：thinning plan §B7-2 / §6.4.1.a (radar status mapping).
 *
 * First cut：mission row → RadarDomainView 基础映射 + sentinels for stages /
 * agents / artifact / todo / memory。完整 stage/agent/briefing projection 留
 * follow-up（plan §B7 readiness §4 + §5）。
 */

import type { RadarMissionQueryInputs } from "../query/radar-mission-query.service";
import type {
  MissionStatus,
  RadarDomainView,
  RadarBriefingRef,
  EmptyArtifactSentinel,
} from "../../api/contracts/view-state.contract";
import {
  projectStagesByOrdinal,
  type StagePresetEntry,
} from "@/modules/ai-harness/facade";
import type { MissionViewBaseStage } from "@/modules/ai-harness/facade";
import { projectRadarTodoBoard } from "./radar-todo-board.projector";
import {
  buildMissionCostView,
  deriveSnapshotVersionFromRow,
} from "@/modules/ai-harness/facade";

// Radar pipeline 9 个 stage（mirror radar/mission/pipeline/stages/ 目录）
const RADAR_STAGES: ReadonlyArray<StagePresetEntry> = [
  { id: "s1-source-resolve", label: "信息源解析" },
  { id: "s2-collect", label: "信源采集" },
  { id: "s3-dedupe", label: "去重清洗" },
  { id: "s4-relevance", label: "相关性筛选" },
  { id: "s5-quality", label: "质量评估" },
  { id: "s6-entity", label: "实体抽取" },
  { id: "s7-insight", label: "洞察生成" },
  { id: "s8-persist", label: "持久化" },
  { id: "s9-daily-top-n", label: "Daily Top-N" },
];

function projectRadarStages(
  lastCompletedStage: number | null | undefined,
  missionStatus: MissionStatus,
): MissionViewBaseStage[] {
  return projectStagesByOrdinal(
    RADAR_STAGES,
    lastCompletedStage,
    missionStatus,
  );
}

export function projectRadarMissionView(
  inputs: RadarMissionQueryInputs,
): RadarDomainView {
  const row = inputs.row;
  const publicStatus = resolvePublicStatus(row.status);
  const metricsSummary = extractMetricsSummary(row.metrics);

  return {
    mission: {
      id: row.id,
      title: undefined, // radar run no title field
      status: publicStatus,
      startedAt: row.startedAt?.toISOString(),
      finishedAt: row.completedAt?.toISOString(),
      finalScore: undefined,
      failureMessage: row.error ?? undefined,
      resumable: false, // radar runs are cron-driven; resume = next scheduled run
      canCancel: publicStatus === "running",
      rerunnableStages: [],
      topicId: row.topicId,
      trigger: row.trigger as RadarDomainView["mission"]["trigger"],
      durationMs: row.durationMs ?? null,
      wallTimeCapMs: row.wallTimeCapMs ?? null,
      maxCredits: row.maxCredits,
      failureCode: row.failureCode ?? null,
      terminalOutcome: deriveTerminalOutcome(row.status),
      metricsSummary,
    },
    stages: projectRadarStages(row.lastCompletedStage, publicStatus),
    agents: projectRadarAgents(row),
    reportArtifact: buildBriefingRefOrSentinel(row),
    todoBoard: projectRadarTodoBoard(row, inputs.events),
    cost: buildMissionCostView({
      // radar tracks via metrics.llmCost (USD); tokens not directly persisted
      tokensUsed: null,
      costUsd: metricsSummary?.llmCost ?? null,
      elapsedWallTimeMs: row.durationMs ?? null,
    }),
    memory: { kind: "empty-memory" },
    timelineVersion: row.lastCompletedStage ?? 0,
    snapshotVersion: deriveSnapshotVersion(row),
    refreshHints: [],
  };
}

// ============================================================================
// §6.4.1.a per-app status mapping for radar
// ============================================================================

function resolvePublicStatus(persisted: string): MissionStatus {
  switch (persisted) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "rejected":
      return "quality-failed";
    case "running":
      return "running";
    default:
      return "running";
  }
}

function deriveTerminalOutcome(persisted: string): string | null {
  if (persisted === "completed") return "completed";
  if (persisted === "failed") return "failed";
  if (persisted === "cancelled") return "cancelled";
  if (persisted === "rejected") return "quality-failed";
  return null;
}

/**
 * Radar agents projection — first cut 基于 row 派生 9-stage pipeline 中的 5 个固定 agent role：
 *   collector / dedupe / relevance-judge / quality-assessor / insight-writer
 *
 * radar 没有 dimension fanout（与 social 同 content-based），但 stage 序列固定，
 * 每个高层 role 对应几个 stage。完整 events-based projection 排 B7 follow-up。
 */
function projectRadarAgents(row: {
  status: string;
}): RadarDomainView["agents"] {
  const status = row.status;
  const phase: "pending" | "running" | "completed" | "failed" =
    status === "completed"
      ? "completed"
      : status === "failed" || status === "cancelled" || status === "rejected"
        ? "failed"
        : status === "running"
          ? "running"
          : "pending";
  const roles: Array<{ id: string; role: string }> = [
    { id: "collector", role: "collector" },
    { id: "dedupe", role: "deduper" },
    { id: "relevance-judge", role: "judge" },
    { id: "quality-assessor", role: "judge" },
    { id: "insight-writer", role: "writer" },
  ];
  return roles.map((r) => ({ id: r.id, role: r.role, phase }));
}

// ============================================================================
// Helpers
// ============================================================================

function extractMetricsSummary(metrics: unknown): {
  fetched?: number;
  accepted?: number;
  llmCost?: number;
} {
  if (!metrics || typeof metrics !== "object") return {};
  const m = metrics as Record<string, unknown>;
  return {
    fetched: typeof m.fetched === "number" ? m.fetched : undefined,
    accepted: typeof m.accepted === "number" ? m.accepted : undefined,
    llmCost: typeof m.llmCost === "number" ? m.llmCost : undefined,
  };
}

function buildBriefingRefOrSentinel(row: {
  topicId: string;
  startedAt?: Date | null;
  status: string;
}): RadarBriefingRef | EmptyArtifactSentinel {
  // For radar, the user-facing artifact is the daily briefing for this topic.
  // First cut: return briefingRef stub when completed; otherwise sentinel.
  if (row.status === "completed" && row.startedAt) {
    return {
      date: row.startedAt.toISOString().slice(0, 10),
      briefingId: undefined,
    };
  }
  return { kind: "empty-artifact", reason: "not-yet-materialized" };
}

function deriveSnapshotVersion(row: {
  lastCompletedStage?: number | null;
  completedAt?: Date | null;
  error?: string | null;
}): number {
  return deriveSnapshotVersionFromRow(row, {
    extraFlags: [row.error],
  });
}

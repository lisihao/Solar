/**
 * MissionUpdateHelper — 用户主动修改 mission 元数据
 *
 * ★ 2026-05-24 P6 Wave 1：framework 化下沉到
 *   `ai-harness/teams/business-team/lifecycle/business-team-update-helper.framework.ts`。
 *   本文件仅注入 playground 专属业务字段映射 + Prisma delegate IO，
 *   保留 update*ByUser / resetFields / markRerunPatch / markIntermediateState 的对外签名。
 */

import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import {
  applyInputPatch,
  BusinessTeamUpdateHelperFramework,
  type UpdateHelperHooks,
} from "@/modules/ai-harness/facade";
import type { PlaygroundConfigSnapshot } from "../../runtime/playground.input-rebuilder";

const RESET_FIELD_MAP = {
  report_full: "reportFull",
  report_artifact_version: "reportArtifactVersion",
  completed_at: "completedAt",
  final_score: "finalScore",
  status: "status",
  error_message: "errorMessage",
  dimensions: "dimensions",
  theme_summary: "themeSummary",
  reconciliation_report: "reconciliationReport",
  verdicts: "verdicts",
  leader_journal: "leaderJournal",
  leader_signed: "leaderSigned",
  leader_overall_score: "leaderOverallScore",
  leader_verdict: "leaderVerdict",
  outline_plan: "outlinePlan",
  analyst_output: "analystOutput",
  tokens_used: "tokensUsed",
  cost_usd: "costUsd",
  trajectory_stored: "trajectoryStored",
  last_completed_stage: "lastCompletedStage",
  max_credits: "maxCredits",
} as const;

export class MissionUpdateHelper extends BusinessTeamUpdateHelperFramework {
  constructor(private readonly prisma: PrismaService) {
    const hooks: UpdateHelperHooks = {
      loggerNamespace: "MissionUpdateHelper",
      updateManyByOwner: async (missionId, userId, data) => {
        await prisma.agentPlaygroundMission.updateMany({
          where: { id: missionId, userId },
          data: data as Prisma.AgentPlaygroundMissionUpdateManyMutationInput,
        });
      },
      updateAnyById: async (missionId, data) => {
        await prisma.agentPlaygroundMission.update({
          where: { id: missionId },
          data: data as Prisma.AgentPlaygroundMissionUpdateInput,
        });
      },
    };
    super(hooks);
  }

  async updateTopicByUser(
    id: string,
    userId: string,
    topic: string,
  ): Promise<void> {
    await this.runUpdate(
      id,
      userId,
      { topic: topic.slice(0, 500) },
      "updateTopicByUser",
    );
  }

  async updateBudgetByUser(
    id: string,
    userId: string,
    patch: {
      maxCredits?: number;
      wallTimeCapMs?: number;
      budgetMultiplierOverride?: number;
    },
  ): Promise<{ ok: boolean; reason?: string }> {
    const row = await this.prisma.agentPlaygroundMission.findFirst({
      where: { id, userId },
      select: { id: true, status: true, configSnapshot: true },
    });
    if (!row) return { ok: false, reason: "not_found" };
    const NON_TERMINAL = new Set(["running", "queued", "pending"]);
    if (NON_TERMINAL.has(row.status)) {
      return { ok: false, reason: "non_terminal_status" };
    }
    const data: Record<string, unknown> = {};
    if (typeof patch.maxCredits === "number")
      data.maxCredits = patch.maxCredits;
    const snap = row.configSnapshot as PlaygroundConfigSnapshot | null;
    if (snap?.schemaVersion != null) {
      const budgetOverride =
        typeof patch.maxCredits === "number" ||
        typeof patch.budgetMultiplierOverride === "number"
          ? {
              maxCredits: patch.maxCredits,
              budgetMultiplier: patch.budgetMultiplierOverride,
            }
          : undefined;
      const runtimeLimitsOverride =
        typeof patch.wallTimeCapMs === "number"
          ? { wallTimeCapMs: patch.wallTimeCapMs }
          : undefined;
      const next = applyInputPatch(
        snap,
        { budgetOverride, runtimeLimitsOverride },
        { snapshotId: randomUUID(), mutationReason: "settings_patch" },
      );
      data.configSnapshot = next as unknown as Prisma.InputJsonValue;
    }
    if (Object.keys(data).length === 0) {
      return { ok: false, reason: "empty_patch" };
    }
    try {
      const res = await this.prisma.agentPlaygroundMission.updateMany({
        where: { id, userId },
        data,
      });
      if (res.count === 0) return { ok: false, reason: "no_row_updated" };
      return { ok: true };
    } catch (err) {
      this.log.warn(
        `[updateBudgetByUser ${id}] update failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return {
        ok: false,
        reason: `db_error: ${err instanceof Error ? err.message.slice(0, 200) : "unknown"}`,
      };
    }
  }

  async resetFields(
    missionId: string,
    fields: ReadonlyArray<string>,
    userId?: string,
  ): Promise<void> {
    await this.resetFieldsFrameworkCore(
      missionId,
      fields,
      RESET_FIELD_MAP,
      userId,
    );
  }

  async markRerunPatch(
    id: string,
    patch: {
      themeSummary?: string;
      dimensions?: unknown;
      reportFull?: unknown;
      verdicts?: unknown;
      reportArtifactVersion?: number;
      reconciliationReport?: unknown;
      leaderOverallScore?: number;
      leaderSigned?: boolean;
      leaderVerdict?: string;
      finalScore?: number;
      tokensUsed?: number;
      costUsd?: number;
      reportTitle?: string;
      reportSummary?: string;
    },
    userId?: string,
  ): Promise<void> {
    const update: Prisma.AgentPlaygroundMissionUpdateInput = {};
    if (patch.themeSummary !== undefined)
      update.themeSummary = patch.themeSummary;
    if (patch.dimensions !== undefined)
      update.dimensions = (patch.dimensions ?? null) as Prisma.InputJsonValue;
    if (patch.reportFull !== undefined)
      update.reportFull = (patch.reportFull ?? null) as Prisma.InputJsonValue;
    if (patch.verdicts !== undefined)
      update.verdicts = (patch.verdicts ?? null) as Prisma.InputJsonValue;
    if (patch.reportArtifactVersion !== undefined)
      update.reportArtifactVersion = patch.reportArtifactVersion;
    if (patch.reconciliationReport !== undefined)
      update.reconciliationReport = (patch.reconciliationReport ??
        null) as Prisma.InputJsonValue;
    if (patch.leaderOverallScore !== undefined)
      update.leaderOverallScore = patch.leaderOverallScore;
    if (patch.leaderSigned !== undefined)
      update.leaderSigned = patch.leaderSigned;
    if (patch.leaderVerdict !== undefined)
      update.leaderVerdict = patch.leaderVerdict;
    if (patch.finalScore !== undefined) update.finalScore = patch.finalScore;
    if (patch.tokensUsed !== undefined) update.tokensUsed = patch.tokensUsed;
    if (patch.costUsd !== undefined) update.costUsd = patch.costUsd;
    if (patch.reportTitle !== undefined)
      update.reportTitle = patch.reportTitle.slice(0, 500);
    if (patch.reportSummary !== undefined)
      update.reportSummary = patch.reportSummary;
    await this.runUpdate(id, userId, update, "markRerunPatch");
  }

  async markIntermediateState(
    id: string,
    patch: {
      reportFull?: unknown;
      reportArtifactVersion?: number;
      outlinePlan?: unknown;
      analystOutput?: unknown;
      verdicts?: unknown;
      reconciliationReport?: unknown;
      dimensions?: unknown;
      themeSummary?: string;
      leaderJournal?: unknown;
      leaderSigned?: boolean;
      leaderOverallScore?: number;
      leaderVerdict?: string;
      lastCompletedStage?: number;
    },
    userId?: string,
  ): Promise<void> {
    const update: Prisma.AgentPlaygroundMissionUpdateInput = {
      heartbeatAt: new Date(),
    };
    if (patch.reportFull !== undefined)
      update.reportFull = (patch.reportFull ?? null) as Prisma.InputJsonValue;
    if (patch.reportArtifactVersion !== undefined)
      update.reportArtifactVersion = patch.reportArtifactVersion;
    if (patch.outlinePlan !== undefined)
      update.outlinePlan = (patch.outlinePlan ?? null) as Prisma.InputJsonValue;
    if (patch.analystOutput !== undefined)
      update.analystOutput = (patch.analystOutput ??
        null) as Prisma.InputJsonValue;
    if (patch.verdicts !== undefined)
      update.verdicts = (patch.verdicts ?? null) as Prisma.InputJsonValue;
    if (patch.reconciliationReport !== undefined)
      update.reconciliationReport = (patch.reconciliationReport ??
        null) as Prisma.InputJsonValue;
    if (patch.dimensions !== undefined)
      update.dimensions = (patch.dimensions ?? null) as Prisma.InputJsonValue;
    if (patch.themeSummary !== undefined)
      update.themeSummary = patch.themeSummary;
    if (patch.leaderJournal !== undefined)
      update.leaderJournal = (patch.leaderJournal ??
        null) as Prisma.InputJsonValue;
    if (patch.leaderSigned !== undefined)
      update.leaderSigned = patch.leaderSigned;
    if (patch.leaderOverallScore !== undefined)
      update.leaderOverallScore = patch.leaderOverallScore;
    if (patch.leaderVerdict !== undefined)
      update.leaderVerdict = patch.leaderVerdict;
    if (patch.lastCompletedStage !== undefined)
      update.lastCompletedStage = patch.lastCompletedStage;
    await this.runUpdate(id, userId, update, "markIntermediateState");
  }

  /**
   * @deprecated framework `runUpdate` 已暴露；保留以维持 callers 兼容。
   */
  async _runMissionUpdate(
    id: string,
    userId: string | undefined,
    data: Prisma.AgentPlaygroundMissionUpdateInput,
    label: string,
  ): Promise<void> {
    await this.runUpdate(id, userId, data, label);
  }
}

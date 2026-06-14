/**
 * Stage S1 — Budget evaluation gate (Steward 4 闸)
 *
 *   reads  ctx: missionId, userId, input, pool, billing
 *   writes ctx: (none —— emit mission:started + 4 闸 verdict 写 narrative)
 *
 * Failure modes:
 *   - any of 4 gates fail (steward verdict=gated)         → throw (mission 终止)
 *   - steward agent failed/timeout                         → throw
 */

import type { MissionInvariants } from "../../context/mission-context";
import type { CommonDeps } from "../../context/mission-deps";
import { narrate } from "../narrative.util";

export async function runMissionBudgetEvalStage(
  ctx: MissionInvariants,
  deps: CommonDeps,
  workspaceId?: string,
): Promise<void> {
  const { missionId, userId, input, t0, pool, billing } = ctx;

  await deps
    .emit({
      type: "social.mission:started",
      missionId,
      userId,
      payload: { input, workspaceId, startedAt: t0 },
    })
    .catch((err: unknown) => {
      deps.log.warn(
        `[${missionId}] emit social.mission:started failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

  await narrate(deps.emit, missionId, userId, {
    stage: "s1-budget-eval",
    role: "mission",
    tag: "info",
    text: `Mission 已启动 · 平台 ${input.platforms.join(", ")} · 档位 ${input.depth} / ${input.budgetProfile}`,
  });

  // dispatcher 在 mission 启动时已查 DB 装配 stewardInputs（remainingCredits /
  // estimatedCost / 各平台 sessionExpiresAt / inProgressMissionCount / key 健康）。
  // 本 stage 仅做 invoke + verdict 检查。
  const stewardInputs = ctx.stewardInputs;
  const stewardResult = await deps.steward.run({
    input: {
      userId,
      platforms: [...input.platforms],
      remainingCreditsUsd: stewardInputs.remainingCreditsUsd,
      estimatedCostUsd: stewardInputs.estimatedCostUsd,
      sessionExpiresAt: stewardInputs.sessionExpiresAt,
      inProgressMissionCount: stewardInputs.inProgressMissionCount,
      keyCooldownCount1h: stewardInputs.keyCooldownCount1h,
    },
    ctx: {
      missionId,
      userId,
      agentId: `steward-${missionId}`,
      role: "steward",
      envAdapter: billing,
    },
    pool,
  });

  if (stewardResult.state === "failed") {
    throw new Error(`[s1] Steward agent failed for mission ${missionId}`);
  }

  const verdict = stewardResult.output;
  if (verdict?.verdict === "gated") {
    await narrate(deps.emit, missionId, userId, {
      stage: "s1-budget-eval",
      role: "steward",
      tag: "warning",
      text: `预算/资源闸 fail：${verdict.gateFailed} · ${verdict.evidence}`,
    });
    await deps
      .emit({
        type: "social.mission:gated",
        missionId,
        userId,
        payload: { gateFailed: verdict.gateFailed, evidence: verdict.evidence },
      })
      .catch(() => {});
    throw new Error(
      `Mission ${missionId} 4 闸 ${verdict.gateFailed} 不通过：${verdict.evidence}`,
    );
  }

  await narrate(deps.emit, missionId, userId, {
    stage: "s1-budget-eval",
    role: "steward",
    tag: "success",
    text: `4 闸通过 · 估算 ${verdict?.estimatedCostUsd ?? "?"} USD / 余 ${verdict?.remainingCreditsUsd ?? "?"} USD`,
  });
}

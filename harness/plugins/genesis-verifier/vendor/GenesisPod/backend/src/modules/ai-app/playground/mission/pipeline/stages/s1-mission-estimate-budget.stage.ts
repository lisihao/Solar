/**
 * Stage S1 — Budget estimate
 *
 * 第一站：mission 启动前的预算闸门，按 budgetMultiplier 估出本次 mission 大概会
 * 烧多少 token，对照用户余额做 affordable 校验。
 *
 *   reads  ctx: input, t0, billing, budgetMultiplier
 *   writes ctx: (none —— 仅 emit mission:started 事件 + 视情况 throw)
 *   deps:       emit, log, billing.estimateAffordable
 *
 * Failure modes:
 *   - estimate.affordable === false + suggestion="abort"  → throw (mission 终止)
 *   - estimate.affordable === false + suggestion="warn"   → emit budget-warning-soft (继续)
 *   - estimateAffordable 自身抛错                         → log warn + 继续（不阻塞）
 */

import type { MissionInvariants } from "../../context/mission-context";
import type { CommonDeps } from "../../context/mission-deps";
import { narrate } from "../../artifacts/narrative.util";
import { resolveMissionCredits } from "../../../api/dto/run-mission.dto";
import { CREDITS_TO_TOKENS } from "@/modules/ai-harness/facade";

export async function runBudgetEstimateStage(
  ctx: MissionInvariants,
  deps: CommonDeps,
  workspaceId?: string,
): Promise<void> {
  const { missionId, userId, input, t0, billing, budgetMultiplier } = ctx;

  await deps
    .emit({
      type: "playground.mission:started",
      missionId,
      userId,
      payload: { input, workspaceId, startedAt: t0 },
    })
    .catch((err: unknown) => {
      deps.log.warn(
        `[${missionId}] emit mission:started failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  // ★ 2026-05-06 单轨化: stage 状态由 orchestrator stage:lifecycle 唯一推进
  await narrate(deps.emit, missionId, userId, {
    stage: "s1-budget",
    role: "mission",
    tag: "info",
    text: `Mission 已启动 · 主题「${input.topic}」 · 深度 ${input.depth} · 预算档位 ${input.budgetProfile}`,
  });

  // ★ R2-#45: estimate against the REAL resolved cap — resolveMissionCredits
  //   reads input.maxCredits or falls back to the DEPTH_BUDGET_TIERS default,
  //   then multiplies by CREDITS_TO_TOKENS (single constant from ResolvedBudgetCaps)
  //   so credit↔token conversion is uniform across billing + pre-flight gate.
  //   budgetMultiplier is applied as a scale on top to reflect the actual per-agent
  //   allocation headroom.
  const resolvedCredits = resolveMissionCredits(input);
  const estimateBudget = Math.round(
    resolvedCredits * CREDITS_TO_TOKENS * Math.max(0.1, budgetMultiplier),
  );
  let estimate: Awaited<ReturnType<typeof billing.estimateAffordable>>;
  try {
    estimate = await billing.estimateAffordable({
      maxTokens: estimateBudget,
    });
  } catch (err) {
    deps.log.warn(
      `[${missionId}] budget estimate failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  if (!estimate.affordable) {
    const warningType =
      estimate.suggestion === "abort"
        ? "playground.mission:budget-warning-hard"
        : "playground.mission:budget-warning-soft";
    await deps
      .emit({
        type: warningType,
        missionId,
        userId,
        payload: {
          shortfall: estimate.shortfall,
          suggestion: estimate.suggestion,
          estimatedCredits: estimate.estimatedCredits,
          currentBalance: estimate.currentBalance,
        },
      })
      .catch((err: unknown) => {
        deps.log.warn(
          `[${missionId}] emit ${warningType} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    if (estimate.suggestion === "abort") {
      await narrate(deps.emit, missionId, userId, {
        stage: "s1-budget",
        role: "mission",
        tag: "warning",
        text: `余额不足以启动（短缺 ${estimate.shortfall} credits），mission 终止`,
      });
      throw new Error(
        `余额不足以启动 mission（短缺 ${estimate.shortfall} credits），请充值后重试`,
      );
    }
    await narrate(deps.emit, missionId, userId, {
      stage: "s1-budget",
      role: "mission",
      tag: "warning",
      text: `预算软告警：估算 ${estimate.estimatedCredits} credits，余额 ${estimate.currentBalance}（建议 ${estimate.suggestion}），mission 继续`,
    });
  } else {
    await narrate(deps.emit, missionId, userId, {
      stage: "s1-budget",
      role: "mission",
      tag: "success",
      text: `预算校验通过 · 估算 ${estimate.estimatedCredits} credits 内可完成`,
    });
  }
}

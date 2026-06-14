/**
 * Stage S1 — Mission Budget Eval (预算闸)
 *
 *   reads  ctx: missionId, userId, input, t0, pool
 *   writes ctx: budgetEval = { approved, estimatedTokens, estimatedCostUsd, reason? }
 *   checkpoint:  deps.store.markIntermediateState (关键产物后持久化)
 *
 * 无 LLM 调用；复用 ctx.pool (MissionBudgetPool) 校验额度：
 *   - 池子已耗尽 → throw（任务直接终止，前端可见真实原因）
 *   - 余量不足估算量（pool 已使用 > cap 80%）→ markStageDegraded（软失败，继续执行）
 *
 * Failure modes:
 *   - pool.isExhausted() at entry          → throw（关键路径，预算硬闸）
 *   - snapshot().poolCostRemaining too low  → markStageDegraded（软失败，继续 mission）
 */

import { narrate as harnessNarrate } from "@/modules/ai-harness/facade";
import type { NarrativeEvent } from "@/modules/ai-harness/facade";

import type {
  WritingMissionInvariants,
  BudgetPhaseCtx,
} from "../../context/mission-context";
import type { CommonDeps } from "../../context/mission-deps";

// writing-specific narrative event type（对齐 social "social.agent:narrative" 命名风格）
const WRITING_NARRATIVE_EVENT = "writing.agent:narrative";

async function narrate(
  emit: CommonDeps["emit"],
  missionId: string,
  userId: string,
  ev: NarrativeEvent,
): Promise<void> {
  return harnessNarrate(emit, missionId, userId, WRITING_NARRATIVE_EVENT, ev);
}

/** 写作任务 token 估算基准（各 task type 乘数，无 LLM 调用时用固定基准） */
const TASK_TYPE_TOKEN_ESTIMATE: Record<string, number> = {
  full_story: 200_000,
  outline: 20_000,
  chapter: 30_000,
  revision: 25_000,
  consistency_check: 15_000,
  edit: 25_000,
};

/** 每 token 估算成本（USD，粗估，用于预算检查） */
const COST_PER_TOKEN_USD = 0.000_003; // ~$3 per 1M tokens（中等模型均价）

export async function runBudgetEvalStage(
  ctx: WritingMissionInvariants & BudgetPhaseCtx,
  deps: CommonDeps,
): Promise<void> {
  const { missionId, userId, input, t0, pool } = ctx;

  // ─── 四件套 step 1: lifecycle started ─────────────────────────────────
  await deps.lifecycle(
    missionId,
    userId,
    "budget-eval",
    "guardrail",
    "started",
  );

  // ─── 四件套 step 2: narrate ────────────────────────────────────────────
  await narrate(deps.emit, missionId, userId, {
    stage: "s1-budget-eval",
    role: "guardrail",
    tag: "info",
    text: `Writing Mission 已启动 · 类型 ${input.missionType} · 项目 ${input.projectId} · 预算检查中`,
  });

  // ─── emit mission:started ─────────────────────────────────────────────
  await deps
    .emit({
      type: "writing.mission:started",
      missionId,
      userId,
      payload: { input, startedAt: t0 },
    })
    .catch((err: unknown) => {
      deps.log.warn(
        `[${missionId}] emit writing.mission:started failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

  // ─── 预算硬闸：池子已耗尽直接终止 ──────────────────────────────────────
  if (pool.isExhausted()) {
    const snap = pool.snapshot();
    await narrate(deps.emit, missionId, userId, {
      stage: "s1-budget-eval",
      role: "guardrail",
      tag: "warning",
      text: `预算池已耗尽，mission 终止 · 已用 ${snap.poolTokensUsed.toLocaleString()} tokens / $${snap.poolCostUsd.toFixed(4)} USD · 余 $${snap.poolCostRemaining.toFixed(4)} USD`,
    });
    await deps.lifecycle(
      missionId,
      userId,
      "budget-eval",
      "guardrail",
      "failed",
      {
        reason: "pool exhausted at stage entry",
      },
    );
    throw new Error(
      `[s1] Budget pool exhausted for mission ${missionId}: used=${snap.poolTokensUsed} tokens, cost=$${snap.poolCostUsd.toFixed(4)} USD`,
    );
  }

  // ─── 估算本次任务开销 ────────────────────────────────────────────────
  const estimatedTokens =
    TASK_TYPE_TOKEN_ESTIMATE[input.missionType] ??
    TASK_TYPE_TOKEN_ESTIMATE.full_story;
  const estimatedCostUsd = estimatedTokens * COST_PER_TOKEN_USD;

  const snap = pool.snapshot();
  const remainingCostUsd = snap.poolCostRemaining;

  // ─── 软失败：余量不足估算量（继续 mission，但标为 degraded）──────────────
  const budgetTight = remainingCostUsd < estimatedCostUsd;
  if (budgetTight) {
    deps.log.warn(
      `[${missionId}] s1 budget tight: estimated $${estimatedCostUsd.toFixed(4)} USD but only $${remainingCostUsd.toFixed(4)} remaining — continuing degraded`,
    );
    await deps.store.markStageDegraded(
      missionId,
      userId,
      "s1-mission-budget-eval",
      `预算余量（$${remainingCostUsd.toFixed(4)}）< 估算开销（$${estimatedCostUsd.toFixed(4)}），mission 可能因预算不足中断`,
    );
  }

  // ─── 产出写 ctx ────────────────────────────────────────────────────────
  const budgetEval: NonNullable<BudgetPhaseCtx["budgetEval"]> = {
    approved: !budgetTight,
    estimatedTokens,
    estimatedCostUsd,
    reason: budgetTight
      ? `余量 $${remainingCostUsd.toFixed(4)} < 估算 $${estimatedCostUsd.toFixed(4)}`
      : undefined,
  };
  ctx.budgetEval = budgetEval;

  // ─── checkpoint：持久化中间产物（cascade-rerun 可从 DB 回灌）────────────
  await deps.store.markIntermediateState(missionId, { budgetEval }, userId);

  // ─── 四件套 step 4: lifecycle completed + narrate ────────────────────
  await deps.lifecycle(
    missionId,
    userId,
    "budget-eval",
    "guardrail",
    "completed",
    {
      approved: budgetEval.approved,
      estimatedTokens,
      estimatedCostUsd,
    },
  );

  await narrate(deps.emit, missionId, userId, {
    stage: "s1-budget-eval",
    role: "guardrail",
    tag: budgetTight ? "warning" : "success",
    text: budgetTight
      ? `预算闸通过（余量偏紧）· 估算 ${estimatedTokens.toLocaleString()} tokens / $${estimatedCostUsd.toFixed(4)} USD · 余 $${remainingCostUsd.toFixed(4)} USD`
      : `预算闸通过 · 估算 ${estimatedTokens.toLocaleString()} tokens / $${estimatedCostUsd.toFixed(4)} USD · 余 $${remainingCostUsd.toFixed(4)} USD`,
  });
}

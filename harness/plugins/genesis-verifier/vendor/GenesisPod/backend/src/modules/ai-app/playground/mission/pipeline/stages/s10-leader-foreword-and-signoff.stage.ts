/**
 * Stage S10 — Leader writes foreword and signs off
 *
 * Mission 末段 Leader 总收尾两个动作：
 *   foreword:  Leader 看完整报告 + 全部 verdicts 后写综合摘要（whatWeAnswered /
 *              whatRemainsUnclear / howToRead / recommendedFollowUp）
 *   signoff:   Leader 签字 + accountabilityNote（强制引用历史决策的问责文）
 *
 *   reads  ctx: reportArtifact, plan, researcherResults, reconciliationReport,
 *               verifierVerdicts, leader
 *   mutate ctx.reportArtifact.metadata.leaderForeword = foreword 输出
 *   writes ctx: leaderForeword, leaderSignOff
 *   deps:       leader.writeForeword, leader.signOff, emit, log
 *
 * Skip 条件: !ctx.reportArtifact || !ctx.plan || !ctx.researcherResults → return
 * 顺序约束: signoff 仅在 foreword 成功时跑（foreword 为签字依据）
 * Failure modes: foreword 失败 → log warn，跳过 signoff（mission 仍 markCompleted）
 *                signoff  失败 → log warn，下游 persist 走"无签字"分支（markCompleted）
 *
 * 注：signoff 拒签（signed=false）不算"失败"——是 Leader 主动行使否决权，
 *     persist stage 会据此 markFailed("Leader 拒绝签字")。
 */

import type {
  MissionContext,
  MissionInvariants,
  PlanPhaseCtx,
  ResearchPhaseCtx,
  SynthesisPhaseCtx,
  WriterPhaseCtx,
  QualityPhaseCtx,
  SignoffPhaseCtx,
} from "../../context/mission-context";
import type { MissionDeps } from "../../context/mission-deps";
import { narrate } from "../../artifacts/narrative.util";
import { lengthTargetFor } from "@/modules/ai-harness/facade";

/**
 * ★ 假完成防御：leader signoff 字数 hard floor，按 lengthProfile 6 档分级。
 *
 * 旧版：MIN_CONTENT_WORDS_RATIO = 0.3 + HARD_FLOOR_WORDS = 500 单档常量。
 * 问题：
 *   - mega (200K target) × 30% = 60K 阈值过严，"近 5 mission 全 fail"主因之一
 *   - brief (3K target) × 30% = 900 + floor 500 → 实际只看 floor，不分档
 *
 * 新策略（评审反馈"按 quick/deep/mega 分档"+ project_agent_playground_quality_gap）：
 *   越短的档比例越严（字数本身少，比例不收紧分不出"假完成"）
 *   越长的档比例越宽（承诺过高难全兑现，60K 阈值会让 mega 永远不签字）
 *   floor 阶梯化（mega 至少 2K 字，避免 200K 承诺只给 500 字仍签字）
 *
 * 计算：minWords = max(target × ratio, floor)
 */
type LengthProfile =
  | "brief"
  | "standard"
  | "deep"
  | "extended"
  | "epic"
  | "mega";

const SIGNOFF_POLICY: Record<LengthProfile, { ratio: number; floor: number }> =
  {
    brief: { ratio: 0.5, floor: 500 }, //  3K target → minWords 1500
    standard: { ratio: 0.4, floor: 500 }, //  8K target → minWords 3200
    deep: { ratio: 0.35, floor: 800 }, // 15K target → minWords 5250
    extended: { ratio: 0.25, floor: 1000 }, // 25K target → minWords 6250
    epic: { ratio: 0.15, floor: 1500 }, // 80K target → minWords 12000
    mega: { ratio: 0.1, floor: 2000 }, // 200K target → minWords 20000
  };

export function signoffPolicyFor(lengthProfile: string | undefined): {
  ratio: number;
  floor: number;
} {
  const key = (lengthProfile as LengthProfile | undefined) ?? "standard";
  return SIGNOFF_POLICY[key] ?? SIGNOFF_POLICY.standard;
}

function forcedUnsigned(refusalReason: string, accountabilityNote: string) {
  return {
    phase: "signoff" as const,
    signed: false,
    leaderVerdict: "failed" as const,
    leaderOverallScore: 0,
    refusalReason,
    accountabilityNote,
  };
}

async function emitLeaderSigned(
  ctx: MissionContext,
  deps: MissionDeps,
): Promise<void> {
  if (!ctx.leaderSignOff) return;

  // ★ 2026-05-07 R1 共识 P0 (architect+tester): cascade rerun 删 reset-before-rerun 后
  //   s10 必须主动持久化 leaderSigned/leaderOverallScore/leaderVerdict 到主行，否则
  //   从 s10 重跑且 cascade 在 s11 失败时主行 leader_* 字段保持 markReopened 后的 NULL，
  //   用户看不到本次签收结果。与 s6/s7/s8/s8b 同模式（PR-R4 主动持久化）。
  if (typeof deps.store?.markIntermediateState === "function") {
    await deps.store
      .markIntermediateState(
        ctx.missionId,
        {
          leaderSigned: ctx.leaderSignOff.signed ?? undefined,
          leaderOverallScore: ctx.leaderSignOff.leaderOverallScore ?? undefined,
          leaderVerdict: ctx.leaderSignOff.leaderVerdict ?? undefined,
        },
        ctx.userId,
      )
      .catch((err: unknown) => {
        deps.log.warn(
          `[${ctx.missionId}] S10 markIntermediateState (leaderSignOff) failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }

  await deps
    .emit({
      type: "playground.leader:signed",
      missionId: ctx.missionId,
      userId: ctx.userId,
      payload: ctx.leaderSignOff,
    })
    // ★ P0-2 (2026-05-06): 不再静默吞 emit 错误，至少 log warn 让 Railway 可见
    .catch((err: unknown) => {
      deps.log.warn(
        `[${ctx.missionId}] S10 emit leader:signed failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  // ★ 2026-05-06 (P0-A): emit stage:completed 一并由 signed 事件触发，覆盖所有早返路径
}

export async function runLeaderForewordAndSignoffStage(
  ctx: MissionInvariants &
    PlanPhaseCtx &
    ResearchPhaseCtx &
    SynthesisPhaseCtx &
    WriterPhaseCtx &
    QualityPhaseCtx &
    SignoffPhaseCtx,
  deps: MissionDeps,
): Promise<void> {
  // ★ 2026-05-06 (P0-A): S10 之前从未 emit stage:started/completed，前端 todo-ledger
  //   's10-leader-signoff' 占位卡永远翻不了牌。
  // ★ P0-LIVE-PATCH-SILENT (2026-04-30): 之前 reportArtifact 缺失时静默 return,
  //   下游 persist 走 markCompleted（默认成功路径）→ mission 假成功。修改为：
  //   reportArtifact 缺失 = S8 装配失败硬伤，必须显式拒签让 markFailed 生效。
  if (!ctx.reportArtifact) {
    deps.log.warn(
      `[${ctx.missionId}] S10 entered without reportArtifact — likely S8 assembler failed. ` +
        `Forcing signOff=false to surface as quality-failed (was silent skip → fake completion).`,
    );
    ctx.leaderSignOff = forcedUnsigned(
      "report_artifact_missing",
      "[S8-Assembler-Failed-Hard-Block] reportArtifact 装配失败，无可签字依据，强制拒签。" +
        "用户可在前端选 重跑 / 修改 lengthProfile 后重启。",
    );
    await emitLeaderSigned(ctx, deps);
    return;
  }
  if (!ctx.plan) {
    ctx.leaderSignOff = forcedUnsigned(
      "plan_missing",
      "[S10-Plan-Missing-Hard-Block] Leader signoff 缺少 mission plan，上游规划产物不可用，强制拒签。",
    );
    await emitLeaderSigned(ctx, deps);
    return;
  }
  if (!ctx.researcherResults) {
    ctx.leaderSignOff = forcedUnsigned(
      "researcher_results_missing",
      "[S10-Research-Missing-Hard-Block] Leader signoff 缺少 researcher results，上游研究产物不可用，强制拒签。",
    );
    await emitLeaderSigned(ctx, deps);
    return;
  }

  const { reportArtifact, plan, researcherResults, leader, input } = ctx;
  const reconciliationReport = ctx.reconciliationReport;
  const verifierVerdicts = ctx.verifierVerdicts ?? [];

  // ── 准备 stage outcome 摘要 ──
  const dimStateOf = (d: {
    name: string;
  }): "completed" | "degraded" | "failed" => {
    const r = researcherResults.find((x) => x.dimension === d.name);
    const findings = (r as { findings?: unknown[] })?.findings ?? [];
    if (findings.length === 0) return "failed";
    const summary = (r as { summary?: string })?.summary ?? "";
    return summary.startsWith("(failed") ? "degraded" : "completed";
  };
  const dimensionStates = plan.dimensions.map((d) => ({
    name: d.name,
    state: dimStateOf(d),
  }));
  const reconStats = reconciliationReport
    ? {
        factCount:
          (reconciliationReport as { factTable?: unknown[] }).factTable
            ?.length ?? 0,
        conflictCount:
          (reconciliationReport as { conflicts?: unknown[] }).conflicts
            ?.length ?? 0,
        criticalGaps: (
          (
            reconciliationReport as {
              gaps?: {
                severity?: string;
                expectedAspects?: string[];
              }[];
            }
          ).gaps ?? []
        )
          .filter((g) => g.severity === "critical")
          .map((g) => (g.expectedAspects ?? []).join(", "))
          .filter(Boolean),
      }
    : undefined;
  const reviewerAvg =
    verifierVerdicts.length > 0
      ? Math.round(
          (verifierVerdicts as { score?: number }[]).reduce(
            (sum: number, v) => sum + (v.score ?? 0),
            0,
          ) / verifierVerdicts.length,
        )
      : undefined;
  const criticWarnings = reportArtifact.quality.warnings.filter((w) =>
    w.dimension?.startsWith("l4-"),
  );
  const criticBlindspots = criticWarnings
    .filter((w) => w.dimension === "l4-blindspot")
    .map((w) => w.message);
  const criticBiases = criticWarnings
    .filter((w) => w.dimension === "l4-bias")
    .map((w) => w.message);
  const criticVerdictRaw = criticWarnings.find(
    (w) => w.dimension === "l4-critic",
  )?.message;
  const criticVerdict = criticVerdictRaw?.startsWith("[fail]")
    ? "fail"
    : criticVerdictRaw?.startsWith("[concerns]")
      ? "concerns"
      : criticVerdictRaw?.startsWith("[pass]")
        ? "pass"
        : undefined;

  // ── foreword: leader.writeForeword() ──
  try {
    await narrate(deps.emit, ctx.missionId, ctx.userId, {
      stage: "s10-leader-signoff",
      role: "leader",
      tag: "writing",
      text: "Leader 综合所有产出 + Critic 警示，开始写前言（whatWeAnswered / whatRemains / howToRead）",
      agentId: "leader",
    });
    const leaderForeword = await leader.writeForeword({
      researcherStates: dimensionStates,
      reconciliation: reconStats,
      writerSections: reportArtifact.sections.map((s) => s.title),
      qualitySnapshot: {
        sourceCount: reportArtifact.citations.length,
        coverageScore: reportArtifact.quality.dimensions.coverage,
        overall: reportArtifact.quality.overall,
        finalVerdict: reportArtifact.quality.finalVerdict ?? "?",
        reviewerAvgScore: reviewerAvg,
        criticVerdict,
        criticBlindspots,
        criticBiases,
        // ★ 沉淀消费 v3: 注入 10 维客观评分（如果 s9b 跑过）
        objectiveScore: ctx.reportEvaluation?.overallScore,
        objectiveGrade: ctx.reportEvaluation?.grade,
        objectiveFeedback: ctx.reportEvaluation?.feedback,
      },
    });
    ctx.leaderForeword = leaderForeword;
    reportArtifact.metadata.leaderForeword = leaderForeword;
    await deps
      .emit({
        type: "playground.leader:foreword",
        missionId: ctx.missionId,
        userId: ctx.userId,
        payload: leaderForeword,
      })
      // ★ P0-2 (2026-05-06): 不再静默吞 emit 错误
      .catch((err: unknown) => {
        deps.log.warn(
          `[${ctx.missionId}] S10 emit leader:foreword failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  } catch (err) {
    deps.log.warn(
      `[${ctx.missionId}] foreword failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
    );
    ctx.leaderSignOff = forcedUnsigned(
      "foreword_failed",
      `[S10-Foreword-Failed-Hard-Block] Leader foreword 生成失败，无法形成签收依据：${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    await emitLeaderSigned(ctx, deps);
    return;
  }

  // ── signoff: leader.signOff() —— 仅在 foreword 成功时跑 ──
  if (ctx.leaderForeword) {
    try {
      const leaderSignOff = await leader.signOff(
        {
          sourceCount: reportArtifact.citations.length,
          coverageScore: reportArtifact.quality.dimensions.coverage,
          overall: reportArtifact.quality.overall,
          finalVerdict: reportArtifact.quality.finalVerdict ?? "?",
          wordCount: reportArtifact.metadata.wordCount,
          reviewerAvgScore: reviewerAvg,
          criticVerdict,
          // ★ 沉淀消费 v3: 注入 10 维客观评分
          objectiveScore: ctx.reportEvaluation?.overallScore,
          objectiveGrade: ctx.reportEvaluation?.grade,
          objectiveFeedback: ctx.reportEvaluation?.feedback,
          // ★ P0#3 (2026-04-29): 注入字数兑现率 + 用户期望字数
          // 让 Leader 看到"承诺 vs 实际"，<60 时按 signoff.md 规则强制 verdict ≤ acceptable
          lengthAccuracy: reportArtifact.quality.dimensions.lengthAccuracy,
          targetWordCount: lengthTargetFor(input.lengthProfile),
        },
        dimensionStates,
      );
      // ★ P0-LIVE-PATCH-SILENT (2026-04-30): S4 patch 失败硬约束。
      //   Leader 在 S4 已自己说"必须 patch"该 dim，patch 又失败 = mission 产出
      //   不达 Leader 自定的硬性 success criteria。强制 signed=false 避免静默
      //   通过；overall 至少 -10 标 degraded；accountabilityNote 注明真因，让
      //   下游 markFailed (quality-failed) 路径生效，DB 状态与现实一致。
      const patchFailures = ctx.s4PatchFailures ?? [];
      if (patchFailures.length > 0 && leaderSignOff.signed) {
        const failedDimNames = patchFailures
          .map((f) => f.dimensionName)
          .join("、");
        leaderSignOff.signed = false;
        leaderSignOff.leaderVerdict = "failed";
        leaderSignOff.leaderOverallScore = Math.max(
          0,
          (leaderSignOff.leaderOverallScore ?? 60) - 10,
        );
        leaderSignOff.accountabilityNote =
          `${leaderSignOff.accountabilityNote ?? ""}\n\n` +
          `[S4-Patch-Failed-Hard-Block] Leader 在 S4 评审阶段判定以下维度需 patch：` +
          `${failedDimNames}（共 ${patchFailures.length} 个 dim）。所有 patch 重派均失败` +
          `（${patchFailures.map((f) => `${f.dimensionName}: ${f.error.slice(0, 80)}`).join("; ")}）。` +
          `按 Leader 自定 successCriteria，本 mission 未达硬性要求，强制拒签；` +
          `用户可在前端选 重跑 / 接受退化产物 / 修改 lengthProfile 后重启。`.trim();
        deps.log.warn(
          `[${ctx.missionId}] S10 强制拒签：S4 patch 失败 ${patchFailures.length} 个 dim，` +
            `Leader 自定 success criteria 不达 → signed=false`,
        );
      }

      // ★ 假完成防御 post-validation：leader signoff 字数 hard floor，按 tier 分档
      //   即便 leader prompt 判定通过，也要看实际报告字数。
      //   低于 max(target × ratio_for_tier, floor_for_tier) 强制 unsign。
      //   数据路径：reportArtifact.metadata.wordCount（实际字数，单位 words）
      //             lengthTargetFor(input.lengthProfile) （目标字数，单位 words）
      if (leaderSignOff.signed === true) {
        const actualWords = reportArtifact.metadata.wordCount ?? 0;
        const targetWords = lengthTargetFor(input.lengthProfile);
        const policy = signoffPolicyFor(input.lengthProfile);
        const minWords = Math.max(targetWords * policy.ratio, policy.floor);

        if (actualWords < minWords) {
          deps.log.warn(
            `[${ctx.missionId}] leader signoff overridden: actualWords=${actualWords} < ` +
              `minWords=${Math.ceil(minWords)} (target=${targetWords}, profile=${input.lengthProfile}, ` +
              `ratio=${policy.ratio}, floor=${policy.floor}) → unsign`,
          );
          leaderSignOff.signed = false;
          leaderSignOff.leaderVerdict = "failed";
          // ★ P0-8 (audit 2026-05-06): 加 refusalReason 让前端区分拒签 sub-class
          leaderSignOff.refusalReason = "insufficient_content";
          leaderSignOff.accountabilityNote =
            `${leaderSignOff.accountabilityNote ?? ""}\n\n` +
            `[Insufficient-Content-Hard-Block] 报告实际字数 ${actualWords} 低于最低门槛 ` +
            `${Math.ceil(minWords)}（target=${targetWords} × ${policy.ratio * 100}%, ` +
            `tier-floor=${policy.floor}, profile=${input.lengthProfile}）。` +
            `强制拒签避免假完成（mission 字数过短却标已完成）；` +
            `用户可在前端选 重跑 / 修改 lengthProfile 后重启。`.trim();
        }
      }

      ctx.leaderSignOff = leaderSignOff;
      // ★ 2026-05-06 (P0-A): 走 emitLeaderSigned 让 stage:completed 一并发出
      await emitLeaderSigned(ctx, deps);
    } catch (err) {
      deps.log.warn(
        `[${ctx.missionId}] signoff failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
      ctx.leaderSignOff = forcedUnsigned(
        "signoff_failed",
        `[S10-Signoff-Failed-Hard-Block] Leader signoff 调用失败，报告未通过最终负责人签收：${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      await emitLeaderSigned(ctx, deps);
    }
  }
}

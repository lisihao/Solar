/**
 * Stage S9 — Reviewer runs L4 critic (meta-review)
 *
 * Writer 起草 + reviewer 三路评分（self/external/critical）全部完成后，跑一轮
 * 独立的 L4 meta-level 审查：识别报告里的 blindspots（漏掉的视角）/ biasFlags
 * （写作倾向）/ suggestions（改进建议），给出 pass / concerns / fail 总判定。
 * fail/concerns 会触发对 reportArtifact.quality 各 dim 的降权。
 *
 * 这里"L4"是审查层级编号（layer-4 critic），不要与 mission stage 序号混淆。
 *
 *   reads  ctx: reportArtifact, verifierVerdicts, reviewScore, input
 *   mutate ctx.reportArtifact: quality.warnings / qualityTrace / hardGateViolations,
 *                              quality.overall / dimensions.novelty/styleConformance
 *   deps:       reviewer.criticL4, invoker (preDisable + tickCost), emit, log
 *
 * Skip 条件: !enableCritic 时直接 return（minimal 档位 + 非 executive 受众）
 * Failure modes: 任何抛错 → log warn + 继续（不阻塞，下游 Leader foreword 仍可工作）
 */

import type {
  MissionInvariants,
  PlanPhaseCtx,
  ResearchPhaseCtx,
  SynthesisPhaseCtx,
  WriterPhaseCtx,
  QualityPhaseCtx,
} from "../../context/mission-context";
import type { MissionDeps } from "../../context/mission-deps";
import { extractTokenSpend } from "@/modules/ai-harness/facade";
import { narrate } from "../../artifacts/narrative.util";
import { scaleScore } from "@/modules/ai-harness/facade";

export async function runCriticStage(
  ctx: MissionInvariants &
    PlanPhaseCtx &
    ResearchPhaseCtx &
    SynthesisPhaseCtx &
    WriterPhaseCtx &
    QualityPhaseCtx,
  deps: MissionDeps,
): Promise<void> {
  const {
    reportArtifact,
    input,
    missionId,
    userId,
    billing,
    pool,
    budgetMultiplier,
  } = ctx;
  if (!reportArtifact) return;
  const verifierVerdicts = ctx.verifierVerdicts ?? [];
  const reviewScore = ctx.reviewScore ?? 0;

  const enableCritic =
    input.auditLayers === "thorough" ||
    input.auditLayers === "thorough+" ||
    (input.audienceProfile === "executive" && input.auditLayers !== "minimal");
  if (!enableCritic) return;

  // ★ 2026-05-06 (P0-A): S9 之前从未 emit stage:started/completed，前端 todo-ledger
  //   占位卡永远翻不了牌。stage='critic' 与前端 line ~510 handler 对应。
  try {
    await narrate(deps.emit, missionId, userId, {
      stage: "s9-critic-l4",
      role: "critic",
      tag: "judging",
      text: "Critic L4 启动独立复审，从盲点 / 偏见 / 改进建议三个维度独立评估报告",
      agentId: "critic",
    });
    // Phase P16-5: Critic 也接 FailureLearner
    await deps.invoker.preDisableKnownFailingModels(
      billing,
      "playground.critic",
      `${input.topic}::critic::${input.language}`,
    );
    // ★ Phase Lead-Services: 通过 ReviewerService.criticL4()
    const criticRes = await deps.reviewer.criticL4(
      {
        topic: input.topic,
        language: input.language,
        audienceProfile: input.audienceProfile,
        styleProfile: input.styleProfile,
        lengthProfile: input.lengthProfile,
        artifactSummary: {
          title: reportArtifact.metadata.topic,
          executiveSummary:
            reportArtifact.quickView.executiveSummary.markdown.slice(0, 1500),
          sectionCount: reportArtifact.sections.length,
          sectionTitles: reportArtifact.sections.map((s) => s.title),
          citationCount: reportArtifact.citations.length,
          factCount: reportArtifact.factTable.length,
          figureCount: reportArtifact.figures.length,
          overallQuality: reportArtifact.quality.overall,
          qualityDimensions: reportArtifact.quality.dimensions,
        },
        upstreamReviewerVerdict:
          verifierVerdicts.length > 0
            ? {
                score: reviewScore,
                critique: (verifierVerdicts[0] as { critique?: string })
                  ?.critique,
              }
            : undefined,
      },
      {
        missionId,
        userId,
        agentId: "critic",
        role: "critic",
        envAdapter: billing,
        budgetMultiplier,
      },
    );
    await deps.invoker.tickCost(
      missionId,
      userId,
      "reviewer",
      pool,
      extractTokenSpend(criticRes.events),
      criticRes.events,
    );
    // ★ degraded 也算成功——L4 critic 即使 verifier 评分微低也仍输出有效 verdict
    if (
      (criticRes.state === "completed" || criticRes.state === "degraded") &&
      criticRes.output
    ) {
      // ★ P1-G (2026-04-29): LLM 返回 schema 不全时强制 fallback，避免 .map() 抛 TypeError
      const rawOut = criticRes.output as Record<string, unknown>;
      const validVerdicts = ["pass", "concerns", "fail"] as const;
      const criticOut = {
        overallVerdict: validVerdicts.includes(
          rawOut.overallVerdict as "pass" | "concerns" | "fail",
        )
          ? (rawOut.overallVerdict as "pass" | "concerns" | "fail")
          : ("concerns" as const),
        blindspots: Array.isArray(rawOut.blindspots)
          ? (rawOut.blindspots as string[])
          : [],
        biasFlags: Array.isArray(rawOut.biasFlags)
          ? (rawOut.biasFlags as string[])
          : [],
        suggestions: Array.isArray(rawOut.suggestions)
          ? (rawOut.suggestions as string[])
          : [],
        rationale: typeof rawOut.rationale === "string" ? rawOut.rationale : "",
      };
      // ★ Phase P21-2: emit 独立 critic:verdict 事件给前端 trace
      await deps
        .emit({
          type: "playground.critic:verdict",
          missionId,
          userId,
          payload: {
            verdict: criticOut.overallVerdict,
            overall: criticOut.overallVerdict,
            blindspotCount: criticOut.blindspots.length,
            biasCount: criticOut.biasFlags.length,
            suggestionCount: criticOut.suggestions.length,
            rationale: criticOut.rationale,
            warnings: [
              ...criticOut.blindspots.map((b) => ({
                kind: "l4-blindspot",
                message: b,
                severity: "warning",
              })),
              ...criticOut.biasFlags.map((b) => ({
                kind: "l4-bias",
                message: b,
                severity: "warning",
              })),
              ...criticOut.suggestions.map((s) => ({
                kind: "l4-suggestion",
                message: s,
                severity: "info",
              })),
            ],
          },
        })
        .catch((err: unknown) => {
          deps.log.warn(
            `[${missionId}] emit critic:verdict failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      await narrate(deps.emit, missionId, userId, {
        stage: "s9-critic-l4",
        role: "critic",
        tag:
          criticOut.overallVerdict === "pass"
            ? "success"
            : criticOut.overallVerdict === "fail"
              ? "warning"
              : "info",
        text: `L4 独立复审完成 · ${criticOut.overallVerdict} · 盲点 ${criticOut.blindspots.length} / 偏见 ${criticOut.biasFlags.length} / 建议 ${criticOut.suggestions.length}`,
        agentId: "critic",
      });
      // 把 critic 输出写到 quality.warnings（不阻塞 mission）
      const criticMessages: { dimension: string; message: string }[] = [
        {
          dimension: "l4-critic",
          message: `[${criticOut.overallVerdict}] ${criticOut.rationale}`,
        },
        ...criticOut.blindspots.map((b) => ({
          dimension: "l4-blindspot",
          message: b,
        })),
        ...criticOut.biasFlags.map((b) => ({
          dimension: "l4-bias",
          message: b,
        })),
        ...criticOut.suggestions.map((s) => ({
          dimension: "l4-suggestion",
          message: s,
        })),
      ];
      reportArtifact.quality.warnings.push(...criticMessages);
      reportArtifact.quality.qualityTrace.push({
        stage: "critic",
        check: "l4-meta-review",
        passed: criticOut.overallVerdict === "pass",
        timestamp: Date.now(),
      });
      // fail verdict → 降低 overall + novelty + factualConsistency
      // ★ P1-NEW-C (round 2): 用 scaleScore 统一 0-100 + NaN clamp
      if (criticOut.overallVerdict === "fail") {
        reportArtifact.quality.hardGateViolations.push({
          dimension: "l4-critic",
          severity: "warning",
          message: `L4 critic 给出 fail 判定（${criticOut.rationale.slice(0, 100)}）`,
        });
        reportArtifact.quality.overall = scaleScore(
          reportArtifact.quality.overall,
          0.7,
        );
        reportArtifact.quality.dimensions.novelty = scaleScore(
          reportArtifact.quality.dimensions.novelty,
          0.6,
        );
        if (criticOut.biasFlags.length > 0) {
          reportArtifact.quality.dimensions.styleConformance = scaleScore(
            reportArtifact.quality.dimensions.styleConformance,
            0.7,
          );
        }
      } else if (criticOut.overallVerdict === "concerns") {
        reportArtifact.quality.overall = scaleScore(
          reportArtifact.quality.overall,
          0.9,
        );
        reportArtifact.quality.dimensions.novelty = scaleScore(
          reportArtifact.quality.dimensions.novelty,
          0.85,
        );
      }
    }

    // ★ Forecast 红队 (2026-05-29 L2)：仅当报告含 foresight 时，对前瞻判断做事前验尸。
    //   与 L4 critic 同阶段、同 auditLayers 分档；评的是"未来脆性"而非当下质量。
    //   折叠进 s9（而非新建 pipeline step）：避免 step 注册 / rerun / 13-step 断言的机械改动。
    await runForecastRedTeam(ctx, deps);
  } catch (err) {
    // ★ 2026-05-06 (A-6): swallow 改成 markStageDegraded
    const message = err instanceof Error ? err.message : String(err);
    deps.log.warn(`[${missionId}] L4 critic failed (non-fatal): ${message}`);
    await deps.markStageDegraded(
      missionId,
      userId,
      "s9-critic",
      `L4 critic 失败但 mission 继续：${message.slice(0, 200)}`,
    );
  }
}

/**
 * Forecast 红队（事前验尸）—— s9 critic 阶段内的前瞻脆性对抗复核。
 *
 * 仅当 reportArtifact.quickView.foresight 含 baseCase 时运行。结果：
 *   - ctx.reportRedTeamVerdict 落 ctx（供 s10 foreword / 持久化）
 *   - 回灌 foresight.couldBeWrongIf + foresight.robustness（前端"未来推演"卡片渲染）
 *   - 写 quality.warnings / qualityTrace；robustness < 50 记 hardGateViolation
 * 非致命：任何失败只 log.warn，不影响 mission。
 */
type RedTeamOutput = NonNullable<QualityPhaseCtx["reportRedTeamVerdict"]>;

async function runForecastRedTeam(
  ctx: MissionInvariants &
    PlanPhaseCtx &
    ResearchPhaseCtx &
    SynthesisPhaseCtx &
    WriterPhaseCtx &
    QualityPhaseCtx,
  deps: MissionDeps,
): Promise<void> {
  const {
    reportArtifact,
    input,
    missionId,
    userId,
    billing,
    pool,
    budgetMultiplier,
  } = ctx;
  const foresight = reportArtifact?.quickView.foresight;
  if (!reportArtifact || !foresight || foresight.baseCase.length === 0) return;

  try {
    await deps.invoker.preDisableKnownFailingModels(
      billing,
      "playground.forecast-red-team",
      `${input.topic}::redteam::${input.language}`,
    );
    const rtRes = await deps.reviewer.forecastRedTeam<unknown, RedTeamOutput>(
      {
        topic: input.topic,
        language: input.language,
        baseCase: foresight.baseCase.map((b) => ({
          judgment: b.judgment,
          probability: b.probability,
          confidence: b.confidence,
          horizon: b.horizon,
        })),
        scenarios: foresight.scenarios.map((s) => ({
          kind: s.kind,
          narrative: s.narrative,
          probability: s.probability,
        })),
        criticalUncertainties: foresight.criticalUncertainties,
      },
      {
        missionId,
        userId,
        agentId: "forecast-red-team",
        role: "critic",
        envAdapter: billing,
        budgetMultiplier,
      },
    );
    await deps.invoker.tickCost(
      missionId,
      userId,
      "reviewer",
      pool,
      extractTokenSpend(rtRes.events),
      rtRes.events,
    );
    if (
      (rtRes.state !== "completed" && rtRes.state !== "degraded") ||
      !rtRes.output
    ) {
      return;
    }
    // ★ schema 兜底：LLM 偶发字段缺失时不让 .map / 数值运算抛错
    const raw = rtRes.output as Record<string, unknown>;
    const robustness =
      typeof raw.overallRobustness === "number" &&
      Number.isFinite(raw.overallRobustness)
        ? Math.max(0, Math.min(100, raw.overallRobustness))
        : 50;
    const couldBeWrongIf = Array.isArray(raw.couldBeWrongIf)
      ? (raw.couldBeWrongIf as string[])
      : [];
    const vulnerabilities = Array.isArray(raw.vulnerabilities)
      ? (raw.vulnerabilities as RedTeamOutput["vulnerabilities"])
      : [];
    const rationale = typeof raw.rationale === "string" ? raw.rationale : "";

    const verdict: RedTeamOutput = {
      vulnerabilities,
      couldBeWrongIf,
      overallRobustness: robustness,
      rationale,
    };
    ctx.reportRedTeamVerdict = verdict;
    // 回灌前端"未来推演"卡片
    foresight.couldBeWrongIf = couldBeWrongIf;
    foresight.robustness = robustness;

    reportArtifact.quality.warnings.push(
      {
        dimension: "forecast-redteam",
        message: `前瞻韧性 ${robustness}/100 · ${rationale.slice(0, 120)}`,
      },
      ...vulnerabilities.slice(0, 5).map((v) => ({
        dimension: "forecast-vulnerability",
        message: `[${v.impactIfFails ?? "?"}/${v.timeHorizon ?? "?"}] ${v.statement} → ${v.failureScenario}`,
      })),
    );
    reportArtifact.quality.qualityTrace.push({
      stage: "critic",
      check: "forecast-red-team",
      passed: robustness >= 50,
      timestamp: Date.now(),
    });
    // 韧性过低 → 记 hardGate 警告（不阻塞，但前端高亮）
    if (robustness < 50) {
      reportArtifact.quality.hardGateViolations.push({
        dimension: "forecast-redteam",
        severity: "warning",
        message: `前瞻判断韧性偏低（${robustness}/100）：${rationale.slice(0, 100)}`,
      });
    }

    await deps
      .emit({
        type: "playground.red-team:verdict",
        missionId,
        userId,
        payload: {
          robustness,
          vulnerabilityCount: vulnerabilities.length,
          couldBeWrongIfCount: couldBeWrongIf.length,
          rationale,
        },
      })
      .catch((err: unknown) => {
        deps.log.warn(
          `[${missionId}] emit red-team:verdict failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    await narrate(deps.emit, missionId, userId, {
      stage: "s9-critic-l4",
      role: "critic",
      tag: robustness >= 70 ? "success" : robustness >= 50 ? "info" : "warning",
      text: `Forecast 红队完成 · 前瞻韧性 ${robustness}/100 · ${vulnerabilities.length} 处脆弱点 / ${couldBeWrongIf.length} 条反指标`,
      agentId: "critic",
    });
  } catch (err) {
    deps.log.warn(
      `[${missionId}] forecast red-team failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

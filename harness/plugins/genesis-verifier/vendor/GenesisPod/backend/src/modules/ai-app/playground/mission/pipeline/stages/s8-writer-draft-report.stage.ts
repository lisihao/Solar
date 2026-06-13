/**
 * Stage S8 — Writer + L3 reviewer consensus + memory index + report assembly
 *
 * Writer 起草 + judgeWithConsensus 评分 + 必要时 retry，整篇成稿后做 memory
 * trajectory 入库 + ReportArtifact v2 装配 + reconciliation/coverage/reviewer
 * 三路质量信号融合到 quality.dimensions。这是 mission 的核心成果集合点。
 *
 *   reads  ctx: plan, researcherResults, reconciliationReport, analystOutput,
 *               input.workspaceId / depth / topic / language / withFigures /
 *               styleProfile / lengthProfile / audienceProfile, billing, pool, t0
 *   writes ctx: report (ResearchReport v1) + reportArtifact (v2) + reviewScore +
 *               verifierVerdicts + trajectoryStored
 *   deps:       invoker (runAndRelay SingleShotWriterAgent + tickCost +
 *                        preDisable + resolveLoopOverride),
 *               judge (judgeWithConsensus —— self/external/critical 三路评分),
 *               indexer (indexAgentTrajectory),
 *               reportAssembler (assemble v2),
 *               per-call BillingContext handles credits,
 *               missionState (compressIfNeeded for analyst handoff),
 *               emit, lifecycle, log
 *
 * 内置容错：
 *   - judgeWithConsensus < 70 分 → retry writer（MAX_WRITER_ATTEMPTS=2）
 *   - writer 全失败 → throw（mission 终止，下游 stage 不跑）
 *   - memory indexer 失败 → 记 0，不阻塞
 *   - reportAssembler 失败 → log warn，reportArtifact = undefined，下游兜底
 *
 * Failure modes: writer 2 次都失败 → throw "Writer 失败 (尝试 2 次)..."
 *                其它子步骤失败均就地降级（memory/assembler 不阻塞）
 */

import { SingleShotWriterAgent } from "../../agents/writer/single-shot-writer.agent";
import type {
  MissionInvariants,
  PlanPhaseCtx,
  ResearchPhaseCtx,
  SynthesisPhaseCtx,
  WriterPhaseCtx,
  PersistPhaseCtx,
} from "../../context/mission-context";
import type { MissionDeps } from "../../context/mission-deps";
import type {
  IAgent,
  IAgentEvent,
  IContextEnvelope,
} from "@/modules/ai-harness/facade";
import type { ResearchReport } from "../../../api/dto/run-mission.dto";
import { extractTokenSpend } from "@/modules/ai-harness/facade";
import { extractFailureMessage } from "@/modules/ai-harness/facade";
import {
  REVIEW_PASS_THRESHOLD,
  MISSION_WRITER_MAX_ATTEMPTS,
} from "@/modules/ai-harness/facade";
import { narrate } from "../../artifacts/narrative.util";
import { agentUsageDetail } from "../helpers/agent-usage.util";
import { clampScore, scaleScore } from "@/modules/ai-harness/facade";
import { defaultStructuralReportAssembler } from "@/modules/ai-harness/facade";
import { extractReportSegments } from "../../artifacts/util/segment-extractors.util";
import { redactCreditCards } from "../../artifacts/util/pii-redactor.util";

// ★ 2026-05-01 (PR-G iter8): 走 ai-harness 集中阈值（quality-thresholds.constants.ts）
const MAX_WRITER_ATTEMPTS = MISSION_WRITER_MAX_ATTEMPTS;

/** 给 memory indexer 用的 fallback proxy agent（writer 失败时用）。 */
function makeProxyAgent(missionId: string, roleId: string): IAgent {
  const env: IContextEnvelope = {
    id: missionId,
    system: "",
    messages: [],
    reminders: [],
    tools: [],
    memory: { sessionId: missionId },
    budget: {
      tokensUsed: 0,
      tokensRemaining: 0,
      iterationsUsed: 0,
      iterationsRemaining: 0,
      wallTimeStartMs: Date.now(),
    },
  };
  return {
    id: missionId,
    identity: {
      role: { id: roleId, name: roleId, description: "demo proxy agent" },
      skills: [],
      tools: [],
    },
    state: "completed",
    execute: async function* () {
      /* no-op */
    },
    spawnSubagent: async () => {
      throw new Error("proxy agent cannot spawn");
    },
    getEnvelope: () => env,
    cancel: async () => {
      /* no-op */
    },
  };
}

export async function runWriterStage(
  ctx: MissionInvariants &
    PlanPhaseCtx &
    ResearchPhaseCtx &
    SynthesisPhaseCtx &
    WriterPhaseCtx &
    PersistPhaseCtx,
  deps: MissionDeps,
  analyst: {
    insights: unknown[];
    themeSummary: string;
    contradictions?: unknown[];
    // ★ Foresight L1：透传给 extractReportSegments → Outlook 章节 + 未来推演卡片
    foresight?: unknown;
  },
  workspaceId: string | undefined,
): Promise<void> {
  const {
    missionId,
    userId,
    input,
    billing,
    pool,
    t0,
    plan,
    researcherResults,
    reconciliationReport,
  } = ctx;
  if (!plan || !researcherResults) {
    throw new Error("S8 writer requires plan + researcherResults");
  }

  // ── 1. Writer 起草 + judgeConsensus retry loop ──
  let attempts = 0;
  let report: ResearchReport | null = null;
  let reviewScore = 0;
  let verifierVerdicts: unknown[] = [];
  let lastWriterAgent: IAgent | null = null;
  let lastWriterEvents: readonly IAgentEvent[] = [];
  let lastWriterFailMsg: string | undefined;

  do {
    attempts += 1;
    const writerAgentId = `writer#${attempts}`;

    await deps.lifecycle(
      missionId,
      userId,
      writerAgentId,
      "writer",
      "started",
      {
        attempt: attempts,
      },
    );
    await narrate(deps.emit, missionId, userId, {
      stage: "s8-writer-draft",
      role: "writer",
      tag: "writing",
      text:
        attempts === 1
          ? "Writer 开始起草报告（基于 Analyst 洞察 + 原始 finding）"
          : `Writer 第 ${attempts} 轮重写（上一轮评分未达 70）`,
      agentId: writerAgentId,
    });
    // ★ Phase P4-3: Writer 跨 mission 失败模式预查
    await deps.invoker.preDisableKnownFailingModels(
      billing,
      "playground.writer",
      `${input.topic}::writer::${input.language}`,
    );
    // ★ Phase P5-4: Writer 输入 Summarize-on-Handoff
    const writerInsights = deps.missionState.compressIfNeeded(
      analyst.insights,
      "writer.insights",
    );
    const writerContradictions = deps.missionState.compressIfNeeded(
      analyst.contradictions,
      "writer.contradictions",
    );
    const rawFindings: {
      dimension: string;
      claim: string;
      evidence: string;
      source: string;
    }[] = [];
    for (const r of researcherResults) {
      for (const f of r.findings ?? []) {
        rawFindings.push({
          dimension: r.dimension,
          claim: f.claim,
          evidence: f.evidence,
          source: f.source,
        });
      }
    }
    // judgeWithConsensus 需要 writerRes.agent.getEnvelope()，所以这里用 invoker.invoke
    // 拿原始 RunResult（含 .agent）
    const writerRes = await deps.invoker.invoke(
      SingleShotWriterAgent,
      {
        topic: input.topic,
        depth: input.depth,
        language: input.language,
        insights: writerInsights,
        themeSummary: analyst.themeSummary,
        contradictions: writerContradictions,
        rawFindings,
        // ★ P1-E (2026-04-29): 注入 S7 outline，让 Writer 严格按章节大纲起草
        // 仅 thorough+ 档位 S7 跑了 outline-planner，否则 ctx.outlinePlan 为空
        outlinePlan: ctx.outlinePlan,
      },
      {
        missionId,
        userId,
        agentId: writerAgentId,
        role: "writer",
        envAdapter: billing,
        loopOverride: deps.invoker.resolveLoopOverride(
          input.auditLayers,
          "writer",
        ),
      },
    );
    await deps.invoker.tickCost(
      missionId,
      userId,
      "writer",
      pool,
      extractTokenSpend(writerRes.events),
      writerRes.events,
    );
    // ★ degraded 算成功：reflexion verifier 评分略低于阈值但 outputSchema 合法
    const writerUsable =
      (writerRes.state === "completed" || writerRes.state === "degraded") &&
      !!writerRes.output;
    await deps.lifecycle(
      missionId,
      userId,
      writerAgentId,
      "writer",
      writerUsable ? "completed" : "failed",
      {
        wallTimeMs: writerRes.wallTimeMs,
        iterations: writerRes.iterations,
        attempt: attempts,
        ...agentUsageDetail(writerRes),
        error: extractFailureMessage(
          writerRes.events,
          writerRes.state,
          !!writerRes.output,
          {
            iterations: writerRes.iterations,
            wallTimeMs: writerRes.wallTimeMs,
          },
        ),
        degraded: writerRes.state === "degraded" || undefined,
      },
    );
    if (!writerUsable) {
      lastWriterFailMsg = extractFailureMessage(
        writerRes.events,
        writerRes.state,
        !!writerRes.output,
        {
          iterations: writerRes.iterations,
          wallTimeMs: writerRes.wallTimeMs,
        },
      );
      continue;
    }
    report = writerRes.output as ResearchReport;
    lastWriterAgent = writerRes.agent;
    lastWriterEvents = writerRes.events;
    await deps
      .emit({
        type: "playground.report:draft",
        missionId,
        userId,
        agentId: writerAgentId,
        payload: { attempt: attempts, report },
      })
      .catch((err: unknown) => {
        deps.log.warn(
          `[${missionId}] emit report:draft failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    const sectionCount =
      (report as unknown as { sections?: unknown[] }).sections?.length ?? 0;
    await narrate(deps.emit, missionId, userId, {
      stage: "s8-writer-draft",
      role: "writer",
      tag: "success",
      text: `第 ${attempts} 轮起草完成 · ${sectionCount} 个章节`,
      agentId: writerAgentId,
    });
    await narrate(deps.emit, missionId, userId, {
      stage: "s8-writer-draft",
      role: "reviewer",
      tag: "judging",
      text: `Reviewer 启动 L3 三路评分（self / external / critical）`,
      agentId: "reviewer",
    });

    // ── L3 reviewer consensus（self/external/critical 三路评分） ──

    await deps.lifecycle(missionId, userId, "reviewer", "reviewer", "started", {
      attempt: attempts,
    });
    const verdict = await deps.judge.judgeWithConsensus({
      output: report,
      envelope: writerRes.agent.getEnvelope(),
      verifierIds: ["self", "external", "critical"],
      // ★ 2026-05-01 (PR-G iter8): 走 ai-harness 集中阈值，与 reflexion +
      //   per-dim-pipeline 同源（quality-thresholds.constants.ts）
      passThreshold: REVIEW_PASS_THRESHOLD,
    });
    reviewScore = verdict.decision.score;
    verifierVerdicts = verdict.verdicts as unknown[];
    for (const v of verdict.verdicts) {
      // ★ P1-J (2026-04-29): 残缺 verdict 元素跳过（缺 judgeId 或 score）
      if (!v?.judgeId || typeof v.score !== "number") {
        deps.log.warn(
          `[${missionId}] malformed verdict skipped: ${JSON.stringify(v)}`,
        );
        continue;
      }
      await deps
        .emit({
          type: "playground.verifier:verdict",
          missionId,
          userId,
          agentId: "reviewer",
          payload: {
            verifierId: v.judgeId,
            score: v.score,
            critique: v.critique,
            criteria: v.criteria,
            modelId: v.modelId,
            attempt: attempts,
          },
        })
        .catch((err: unknown) => {
          deps.log.warn(
            `[${missionId}] emit verifier:verdict failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    }
    await deps.lifecycle(
      missionId,
      userId,
      "reviewer",
      "reviewer",
      "completed",
      {
        attempt: attempts,
        consensusScore: reviewScore,
        consensusVerdict: verdict.decision.verdict,
      },
    );

    await narrate(deps.emit, missionId, userId, {
      stage: "s8-writer-draft",
      role: "reviewer",
      tag: verdict.decision.verdict === "pass" ? "success" : "warning",
      text:
        verdict.decision.verdict === "pass"
          ? `三路共识 · 通过（${reviewScore} 分）`
          : `三路共识 · 不通过（${reviewScore} 分），将触发 Writer 重写`,
      agentId: "reviewer",
    });
    if (verdict.decision.verdict === "pass") break;
  } while (attempts < MAX_WRITER_ATTEMPTS);

  if (!report) {
    throw new Error(
      lastWriterFailMsg
        ? `Writer 失败 (尝试 ${MAX_WRITER_ATTEMPTS} 次)：${lastWriterFailMsg}`
        : `Writer failed after ${MAX_WRITER_ATTEMPTS} attempts`,
    );
  }

  // ── 2. Memory auto-index ──
  const indexAgent = lastWriterAgent ?? makeProxyAgent(missionId, "team");
  const indexed = await deps.indexer
    .indexAgentTrajectory(indexAgent, lastWriterEvents, {
      namespace: workspaceId ?? userId,
      source: "playground.team",
      tags: [input.depth, input.topic],
      confidence: reviewScore / 100,
      metadata: { topic: input.topic, missionId },
    })
    .catch((err: unknown) => {
      deps.log.warn(
        `[indexer] failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 0;
    });
  await deps
    .emit({
      type: "playground.memory:indexed",
      missionId,
      userId,
      payload: {
        chunks: indexed,
        namespace: workspaceId ?? userId,
        tags: [input.depth, input.topic],
      },
    })
    .catch((err: unknown) => {
      deps.log.warn(
        `[${missionId}] emit memory:indexed failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

  const snap = pool.snapshot();
  // ★ 2026-04-30: 移走 S8 的 mission:completed —— 此时 S8B/S9/S9B/S10/S11/S12 都未跑，
  //   提前 emit 让前端误判 mission 已完成（且 DB 行还是 running，造成"假成功"）。
  //   mission:completed 改在 S11 markCompleted 成功后 emit。
  //   S8 只 emit draft:completed 让前端知道写作环节已结束、进入审稿/签字。
  const wallTimeMs = Date.now() - t0;
  await deps
    .emit({
      type: "playground.draft:completed",
      missionId,
      userId,
      payload: {
        reviewScore,
        costUsd: snap.poolCostUsd,
        tokensUsed: snap.poolTokensUsed,
        trajectoryStored: indexed,
        wallTimeMs,
        verifierVerdicts,
      },
    })
    .catch((err: unknown) => {
      deps.log.warn(
        `[${missionId}] emit draft:completed failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

  // ── 3. ReportArtifact v2 装配 ──
  // Credits are charged per model call by the AI facade BillingContext. A
  // second mission-total charge here would double-bill platform-key users and
  // incorrectly charge personal BYOK users.
  let reportArtifact:
    | import("@/modules/ai-harness/facade").ReportArtifact
    | undefined;
  try {
    const modelIds = new Set<string>();
    let writerStartTs: number | undefined;
    let writerEndTs: number | undefined;
    for (const ev of lastWriterEvents ?? []) {
      if (ev.type === "thinking") {
        const p = ev.payload as { modelId?: string } | null;
        if (p?.modelId) modelIds.add(p.modelId);
      }
      if (writerStartTs === undefined) writerStartTs = ev.timestamp;
      writerEndTs = ev.timestamp;
    }
    const modelTrail = Array.from(modelIds);
    const writerGenerationMs =
      writerStartTs && writerEndTs ? writerEndTs - writerStartTs : wallTimeMs;
    reportArtifact = deps.reportAssembler.assemble({
      topic: input.topic,
      language: input.language,
      styleProfile: input.styleProfile,
      lengthProfile: input.lengthProfile,
      audienceProfile: input.audienceProfile,
      searchTimeRange: input.searchTimeRange,
      plan: {
        themeSummary: plan.themeSummary,
        dimensions: plan.dimensions.map((d) => ({
          id: d.id,
          name: d.name,
          rationale: d.rationale,
        })),
      },
      researcherResults: researcherResults.map((r) => ({
        dimension: r.dimension,
        findings: r.findings,
        summary: r.summary,
        // ★ per-dim chapter pipeline 产物（fullMarkdown 是 81K 字的"原料"，要传给 assembler）
        fullMarkdown: (r as { fullMarkdown?: string }).fullMarkdown,
        // ★ 2026-05-08 PR-1: figureReferences 必须透传，否则 reportAssembler.buildFigures
        //   优先路径（chapter.figureReferences）永远走不到，commit 331b9eebf 设计的图
        //   文匹配闭环失效，markdown 中 0 个 #fig 占位（mission 843f6958 实证）。
        chapters: (
          r as {
            chapters?: {
              index: number;
              heading: string;
              body: string;
              wordCount: number;
              figureReferences?: {
                figureId: string;
                anchorParagraph?: number;
                caption?: string;
              }[];
            }[];
          }
        ).chapters,
        figureCandidates: (r as { figureCandidates?: unknown[] })
          .figureCandidates as
          | {
              sourceUrl: string;
              imageUrl?: string;
              caption: string;
              sourcePageOrSection?: string;
              relevanceHint?: "high" | "medium" | "low";
            }[]
          | undefined,
      })),
      analyst: {
        // ★ P1-C (2026-04-29): 优先用 analyst.themeSummary（已整合 reconciler）；
        // 若缺失再 fallback 到 writer 起草的 summary，避免报告头摘要与 plan/正文割裂
        themeSummary: analyst?.themeSummary || report.summary,
      },
      writerReport: report,
      reconciliationReport: (reconciliationReport ?? undefined) as Parameters<
        typeof deps.reportAssembler.assemble
      >[0]["reconciliationReport"],
      generationTimeMs: writerGenerationMs,
      totalTokens: {
        prompt: 0,
        completion: snap.poolTokensUsed,
        total: snap.poolTokensUsed,
      },
      costCents: Math.round((snap.poolCostUsd ?? 0) * 100),
      modelTrail,
    });
  } catch (err) {
    deps.log.warn(
      `[${missionId}] reportAssembler failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // ★ P1-M (2026-04-29): reportAssembler 即使失败，reconciliation 的关键 warning 也要 emit 给前端
  // 否则 conflicts/gaps 信号永久丢失，leader signoff 无法据此判断
  if (!reportArtifact && reconciliationReport) {
    const conflicts =
      (reconciliationReport as { conflicts?: { resolutionType: string }[] })
        .conflicts ?? [];
    const unresolved = conflicts.filter(
      (c) => c.resolutionType === "flagged-unresolved",
    ).length;
    const gaps =
      (reconciliationReport as { gaps?: { severity: string }[] }).gaps ?? [];
    const criticalGaps = gaps.filter((g) => g.severity === "critical").length;
    if (unresolved > 0 || criticalGaps > 0) {
      await deps
        .emit({
          type: "playground.reconciliation:warnings-orphaned",
          missionId,
          userId,
          payload: {
            unresolvedConflicts: unresolved,
            criticalGaps,
            note: "reportAssembler failed; reconciliation warnings emitted directly",
          },
        })
        .catch((err: unknown) => {
          deps.log.warn(
            `[s8 ${missionId}] emit reconciliation:warnings-orphaned failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    }
  }

  // ── 5. 把 reconciliation/coverage/reviewer 三路质量信号融合到 quality.dimensions ──
  if (reportArtifact && reconciliationReport) {
    reportArtifact.quality.qualityTrace.push({
      stage: "reconciler",
      check: `${(reconciliationReport as { factTable?: unknown[] }).factTable?.length ?? 0} facts / ${(reconciliationReport as { conflicts?: unknown[] }).conflicts?.length ?? 0} conflicts`,
      passed:
        ((
          reconciliationReport as {
            conflicts?: { resolutionType: string }[];
          }
        ).conflicts?.filter((c) => c.resolutionType === "flagged-unresolved")
          .length ?? 0) === 0,
      timestamp: Date.now(),
    });
    const conflicts =
      (reconciliationReport as { conflicts?: { resolutionType: string }[] })
        .conflicts ?? [];
    const unresolved = conflicts.filter(
      (c) => c.resolutionType === "flagged-unresolved",
    ).length;
    if (unresolved > 0) {
      const drop = Math.min(0.5, unresolved * 0.15);
      // ★ P1-NEW-C (round 2): 用 scaleScore 统一 0-100 + NaN clamp
      reportArtifact.quality.dimensions.factualConsistency = scaleScore(
        reportArtifact.quality.dimensions.factualConsistency,
        1 - drop,
      );
      reportArtifact.quality.warnings.push({
        dimension: "factualConsistency",
        message: `Reconciler 标记 ${unresolved} 项 unresolved 冲突`,
      });
    }
    const gaps =
      (reconciliationReport as { gaps?: { severity: string }[] }).gaps ?? [];
    const criticalGaps = gaps.filter((g) => g.severity === "critical").length;
    if (criticalGaps > 0) {
      reportArtifact.quality.dimensions.coverage = scaleScore(
        reportArtifact.quality.dimensions.coverage,
        0.8,
      );
      reportArtifact.quality.warnings.push({
        dimension: "coverage",
        message: `Reconciler 识别 ${criticalGaps} 项 critical gap 未覆盖`,
      });
    }
  }
  if (
    reportArtifact &&
    input.withFigures &&
    reportArtifact.figures.length === 0
  ) {
    reportArtifact.quality.warnings.push({
      dimension: "withFigures",
      message:
        "用户开启图文并茂，但终稿无可用图（researcher 未抽到符合红线的图）",
    });
  }
  if (reportArtifact) {
    const totalDims = plan.dimensions.length;
    const degradedDims = researcherResults.filter(
      (r) => r.findings.length === 0,
    ).length;
    if (totalDims > 0 && degradedDims / totalDims > 0.3) {
      reportArtifact.quality.dimensions.coverage = scaleScore(
        reportArtifact.quality.dimensions.coverage,
        0.6,
      );
      reportArtifact.quality.warnings.push({
        dimension: "coverage",
        message: `${degradedDims}/${totalDims} 维度降级（无 findings）`,
      });
    }
  }
  if (reportArtifact && reviewScore > 0) {
    const reviewerSignal = clampScore(reviewScore);
    // ★ P1-NEW-C (round 2): blend 内部最终用 clampScore 兜底，防止累积 NaN/越界
    const blend = (cur: number, signal: number, w = 0.4): number =>
      clampScore(cur * (1 - w) + signal * w);
    reportArtifact.quality.dimensions.traceability = blend(
      reportArtifact.quality.dimensions.traceability,
      reviewerSignal,
    );
    reportArtifact.quality.dimensions.factualConsistency = blend(
      reportArtifact.quality.dimensions.factualConsistency,
      reviewerSignal,
      0.3,
    );
    reportArtifact.quality.dimensions.styleConformance = blend(
      reportArtifact.quality.dimensions.styleConformance,
      reviewerSignal,
      0.5,
    );
    const dims = reportArtifact.quality.dimensions;
    reportArtifact.quality.overall = clampScore(
      Object.values(dims).reduce((a, b) => a + b, 0) / Object.keys(dims).length,
    );
    reportArtifact.quality.qualityTrace.push({
      stage: "reviewer-l3",
      check: "blended-into-quality-dimensions",
      passed: reviewerSignal >= 70,
      timestamp: Date.now(),
    });
    if (reportArtifact.quality.qualityTrace.length > 50) {
      reportArtifact.quality.qualityTrace =
        reportArtifact.quality.qualityTrace.slice(-30);
    }
    for (const v of verifierVerdicts) {
      const ver = v as { verifierId?: string; score?: number };
      if (ver?.verifierId && typeof ver.score === "number") {
        reportArtifact.quality.qualityTrace.push({
          stage: ver.verifierId,
          check: `score=${ver.score}`,
          passed: ver.score >= 70,
          timestamp: Date.now(),
        });
      }
    }
  }

  // ── 4.5 v1.6 切主线 — StructuralReportAssembler 接管 fullMarkdown + sections ──
  //
  // 文档：docs/architecture/ai-harness/evaluation/report-assembly-invariant-redesign.md v1.4/v1.5/v1.6
  //
  // v1.4-v1.5 是 shadow path（feature flag 控制）；v1.6 删 flag 切主线：
  //   - structural 永远开启（无 env 切换）
  //   - structural 异常时 legacy fullMarkdown / sections 保留为 catch fallback
  //   - structural 成功时 fullMarkdown 来自结构化拼装（offset 一次性确定，不依赖 buildSectionTree
  //     反向解析），sections[].citations / figureIds 通过 legacy reportAssembler.recomputeXxx
  //     公共方法重新关联到 structural sections（NB 二轮架构师 hard miss A 修）
  //   - sanitizerVersion 真正合并到 metadata（NB-8 收尾）
  if (reportArtifact) {
    try {
      const legacySectionsSnapshot = reportArtifact.sections;
      const segments = extractReportSegments({
        plan: {
          themeSummary: plan.themeSummary,
          dimensions: plan.dimensions.map((d) => ({
            id: d.id,
            name: d.name,
            rationale: d.rationale,
          })),
        },
        analystOutput: analyst as Parameters<
          typeof extractReportSegments
        >[0]["analystOutput"],
        reconcilerOutput: reconciliationReport as Parameters<
          typeof extractReportSegments
        >[0]["reconcilerOutput"],
        researcherResults: researcherResults.map((r) => ({
          dimension: r.dimension,
          fullMarkdown: (r as { fullMarkdown?: string }).fullMarkdown,
          summary: r.summary,
        })),
        citations: reportArtifact.citations,
        figures: reportArtifact.figures,
        factTable: reportArtifact.factTable,
        metadata: reportArtifact.metadata,
        qualityInputs: {
          verifierScores: { reviewer: reviewScore || 70 },
          warnings: reportArtifact.quality.warnings.map((w) => ({
            severity: "warn" as const,
            scopeKey: w.dimension,
            message: w.message,
          })),
        },
      });
      const structural = defaultStructuralReportAssembler.assemble(segments);
      // 关联回填（v1.6 NB-A 修）：structural.sections 仅含基本元信息，
      // citations / figureIds / factIds 全是 []。legacy assembler 提供两个
      // public helper 让我们按 structural 的 fullMarkdown 重新扫 [N] 编号
      // + 按 sourceDimensionId 映射 figures.sectionId。
      deps.reportAssembler.recomputeCitationOccurrencesPublic(
        reportArtifact.citations,
        structural.sections,
        structural.content.fullMarkdown,
      );
      deps.reportAssembler.recomputeSectionFigureIdsPublic(
        reportArtifact.figures,
        structural.sections,
        legacySectionsSnapshot,
      );
      // 用 structural 的 fullMarkdown + sections + quickView + metadata；
      // 保留 legacy 的 citations / figures（已重新关联）/ factTable / quality 信号
      reportArtifact = {
        ...reportArtifact,
        content: structural.content,
        sections: structural.sections,
        quickView: structural.quickView,
        metadata: structural.metadata,
      };
      // ★ 2026-05-08 PR-1 (mission 843f6958 实证修): structural 覆盖了
      //   legacy 的 fullMarkdown，injectFigurePlaceholders（line 189）跑过的
      //   #fig 占位被全丢失。这里用 structural sections + 已 build 的 figures
      //   再注入一次，让前端 ArtifactMarkdown 真能渲染图。
      //   PR-7 (R2 第 4 路指出): 注入后 fullMarkdown 字符流增长，sections offset
      //   漂移，必须 rebuildSectionTreePublic 重建 + 重映射 figure.sectionId。
      if (reportArtifact.figures.length > 0) {
        const withFigs = deps.reportAssembler.injectFigurePlaceholdersPublic(
          reportArtifact.content.fullMarkdown,
          reportArtifact.sections,
          reportArtifact.figures,
        );
        if (withFigs !== reportArtifact.content.fullMarkdown) {
          // ★ PR-7: rebuild sectionTree（offset 漂移修复）
          const sectionsBeforeInject = reportArtifact.sections;
          const sectionsAfterInject =
            deps.reportAssembler.rebuildSectionTreePublic(
              withFigs,
              plan.dimensions.map((d) => ({
                id: d.id,
                name: d.name,
                rationale: d.rationale,
              })),
              input.language,
            );
          // figure.sectionId 重映射到 inject 后 sections（按 sourceDimensionId 优先）
          deps.reportAssembler.recomputeSectionFigureIdsPublic(
            reportArtifact.figures,
            sectionsAfterInject,
            sectionsBeforeInject,
          );
          reportArtifact = {
            ...reportArtifact,
            content: {
              ...reportArtifact.content,
              fullMarkdown: withFigs,
              fullReportSize: withFigs.length,
            },
            sections: sectionsAfterInject,
          };
          // citation occurrences + section.citations 在 inject 后 fullMarkdown 上重扫
          deps.reportAssembler.recomputeCitationOccurrencesPublic(
            reportArtifact.citations,
            reportArtifact.sections,
            withFigs,
          );
        }
      }
    } catch (err) {
      deps.log.warn(
        `[${missionId}] structural assembler failed (non-fatal, fallback to legacy): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // ── E46 (2026-05-25): 报告输出侧脱敏高置信 PII ──
  // 仅脱敏过 Luhn 校验的信用卡号（等长替换，不破坏 section/角标 offset）。
  // 研究报告里 email / 长数字 ID 是合法正文，不动（见 pii-redactor.util 注释）。
  // 放在 ctx 写回 + markIntermediateState 持久化之前，覆盖 持久化 + 前端展示。
  if (reportArtifact?.content?.fullMarkdown) {
    const { text: redacted, redactedCount } = redactCreditCards(
      reportArtifact.content.fullMarkdown,
    );
    if (redactedCount > 0) {
      reportArtifact = {
        ...reportArtifact,
        content: { ...reportArtifact.content, fullMarkdown: redacted },
      };
      deps.log.warn(
        `[${missionId}] E46: redacted ${redactedCount} credit-card-like sequence(s) from report output`,
      );
    }
  }

  // ── 写回 ctx ──
  ctx.report = report;
  ctx.reportArtifact = reportArtifact;
  ctx.reviewScore = reviewScore;
  ctx.verifierVerdicts = verifierVerdicts;
  ctx.trajectoryStored = indexed;

  // ★ PR-R4 (2026-05-07): stage 主动持久化 reportArtifact 到 mission 行，
  //   让 S9/S9b/S10/S11 重跑路径在 cdHydrate 时读到 S8 已生成的 v2 artifact，
  //   不必从 S6 全量回跑。reportArtifact 缺失时不写（避免覆盖前一轮成功值）。
  // ★ 收尾评审第三轮 P0-S (2026-05-07): 传 userId 走严格隔离
  if (reportArtifact) {
    await deps.store.markIntermediateState(
      missionId,
      {
        reportFull: reportArtifact,
        reportArtifactVersion: 2,
      },
      userId,
    );
  }

  // ★ 2026-04-30: reportArtifact 装配完成后 emit 一个 light 事件让 socket store 知道
  //   v2 artifact 已就绪。前端不接收 full artifact（避免 256K event cap），而是收到此事件
  //   后异步 re-fetch getMissionDetail 拿持久化好的 reportFull。
  //   注：此时 DB 还没写（S11 才写），但 ctx.reportArtifact 已就位。前端 listener 应等
  //   mission:completed（S11 emit）再 fetch，本事件只用于"能力切换"提示（Quality 闭环开始）。
  if (reportArtifact) {
    await deps
      .emit({
        type: "playground.report:assembled",
        missionId,
        userId,
        payload: {
          version: 2,
          sectionsCount: reportArtifact.sections.length,
          citationsCount: reportArtifact.citations.length,
          figuresCount: reportArtifact.figures.length,
          fullMarkdownSize: reportArtifact.content.fullReportSize,
          qualityOverall: reportArtifact.quality.overall,
        },
      })
      .catch((err: unknown) => {
        deps.log.warn(
          `[s8 ${missionId}] emit report:assembled failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

    // ★ 2026-05-13 #63: Leader signoff 预警 — S8 已经能算出最终签字阻断条件
    //   （sourceCount / coverage / lengthAccuracy），提前 emit 让前端 timeline
    //   渲染红段 + tooltip，避免到 S10 才"突然"拒签让用户措手不及。
    //   阻断条件对齐 leader/SKILL.md `<!-- duty:signoff:start -->` 段（sourceCount /
    //   coverage / lengthAccuracy 三阈值检查）。
    const reasons: {
      code: string;
      message: string;
      current?: number;
      threshold?: number;
    }[] = [];
    const sourceCount = reportArtifact.citations.length;
    const minSources = plan.goals?.qualityBar?.minSources ?? 0;
    const minCoverage = plan.goals?.qualityBar?.minCoverage ?? 0;
    const coverage = reportArtifact.quality.dimensions.coverage;
    const lengthAccuracy = reportArtifact.quality.dimensions.lengthAccuracy;

    if (minSources > 0 && sourceCount < minSources * 0.6) {
      reasons.push({
        code: "INSUFFICIENT_SOURCES",
        message: `来源数 ${sourceCount} < 最低要求 ${minSources} × 60%（${Math.ceil(minSources * 0.6)} 条）`,
        current: sourceCount,
        threshold: Math.ceil(minSources * 0.6),
      });
    }
    if (minCoverage > 0 && coverage < minCoverage * 0.7) {
      reasons.push({
        code: "LOW_COVERAGE",
        message: `覆盖度 ${Math.round(coverage)} < 最低要求 ${minCoverage} × 70%（${Math.ceil(minCoverage * 0.7)}）`,
        current: Math.round(coverage),
        threshold: Math.ceil(minCoverage * 0.7),
      });
    }
    if (typeof lengthAccuracy === "number" && lengthAccuracy < 60) {
      reasons.push({
        code: "LENGTH_UNDERDELIVERED",
        message: `字数兑现率 ${Math.round(lengthAccuracy)}/100 严重缩水（< 60），Leader 会按 signoff.md 规则限制 verdict ≤ acceptable`,
        current: Math.round(lengthAccuracy),
        threshold: 60,
      });
    }
    if (reasons.length > 0) {
      // 任一 reason 已是 hard-block 级别（signoff.md 已写明）→ severity="block"
      // 若未来加 warn-only 条件可在此区分
      await deps
        .emit({
          type: "playground.mission:preflight-warning",
          missionId,
          userId,
          payload: {
            severity: "block",
            stageId: "s8-writer-draft",
            affectsStageId: "writer",
            reasons,
          },
        })
        .catch((err: unknown) => {
          deps.log.warn(
            `[${missionId}] emit mission:preflight-warning failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    }
  }
}

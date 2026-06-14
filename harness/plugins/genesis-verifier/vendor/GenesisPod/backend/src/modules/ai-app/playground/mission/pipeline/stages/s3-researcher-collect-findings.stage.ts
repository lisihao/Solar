/**
 * Stage S3 — Researcher×N dispatch (含 self-heal + per-dim chapter pipeline)
 *
 * 给每个 plan.dimension 派一个 ResearcherAgent，并行（or 拓扑序按 dependsOn 分批）跑。
 * 单 dim 失败不阻塞 mission：发"(failed: ...)"占位让 Analyst 拿剩余 dim 继续。
 *
 *   reads  ctx: plan, input, missionId, userId, billing, pool, budgetMultiplier
 *   writes ctx: researcherResults[]（dim → findings/summary，含每个 dim 的 chapter
 *               pipeline 增强字段）
 *   deps:       invoker (invoke + tickCost + preDisable + concurrency / DAG),
 *               failureLearner (lookup / recordFailure / recordSuccessfulFallback),
 *               writer + reviewer (per-dim chapter pipeline 内部用),
 *               emit, lifecycle, log
 *
 * 内置三层容错：
 *   L1 self-heal      RECOVERABLE failureCode 触发 +50% budget 重跑（researcher loop 内）
 *   L2 cross-mission  failure pattern 预查 → markModelDisabled → react-loop 自动 fallback
 *   L3 dim degraded   单 dim 失败收敛为 "(failed: ...)" 占位，emit ORCH_DIMENSION_DEGRADED
 *
 * Per-dim chapter pipeline 由 ../per-dim-pipeline.util.ts 完成，
 * minimal/quick 档位跳过（直接退化为 raw researcherOut）。
 *
 * Failure modes: 单 dim 失败均就地降级为占位，stage 自身不抛错；下游 reconciler/analyst
 *                看到 findings=[] 自然过滤。
 */

import pLimit from "p-limit";
import { ResearcherAgent } from "../../agents/researcher/researcher.agent";
import type {
  MissionContext,
  MissionInvariants,
  PlanPhaseCtx,
  ResearchPhaseCtx,
} from "../../context/mission-context";
import type { MissionDeps } from "../../context/mission-deps";
import { agentUsageDetail } from "../helpers/agent-usage.util";
import { extractTokenSpend } from "@/modules/ai-harness/facade";
import { MissionAbortReason } from "@/modules/ai-harness/facade";
import {
  extractAgentFailureDiagnostic,
  extractFailureMessage,
} from "@/modules/ai-harness/facade";
import { runPerDimPipeline } from "../helpers/per-dim-pipeline.util";
import { narrate } from "../../artifacts/narrative.util";
// ★ 2026-05-13: route min-findings retry threshold through typed runtime config
import { loadPlaygroundRuntimeConfig } from "../../../runtime/playground-runtime.config";

interface ResearcherDimResult {
  dimension: string;
  findings: { claim: string; evidence: string; source: string }[];
  summary: string;
  chapters?: {
    index: number;
    heading: string;
    body: string;
    wordCount: number;
  }[];
  abstract?: string;
  keyFindings?: string[];
  fullMarkdown?: string;
  grade?: {
    overall: number;
    grade: string;
    axes: Record<string, { score: number; comment: string }>;
    summary: string;
  };
}

const RECOVERABLE_FAILURES = new Set([
  "RUNNER_OUTPUT_SCHEMA_MISMATCH",
  "RUNNER_WALL_TIME_EXCEEDED",
  // ★ 2026-05-23 fix：harness 从不 emit "RUNNER_LOOP_LIMIT"（仅旧注释残留）。
  //   两个最常见的非 completed 退出码是 LOOP_MAX_ITERATIONS / LOOP_BUDGET_EXHAUSTED
  //   （react-loop.ts:1341 / :553）。原来挂在死码上 → +50% 预算自愈重试对它们永不触发。
  "LOOP_MAX_ITERATIONS",
  "LOOP_BUDGET_EXHAUSTED",
  "LOOP_EMPTY_RESPONSE_IMMEDIATE",
  "LOOP_REASONING_COT_EXHAUSTION",
  "PARSE_MALFORMED_JSON",
  "PARSE_MISSING_ACTION",
  "PARSE_UNKNOWN_ACTION_KIND",
  "PARSE_EMPTY_ACTIONS_ARRAY",
]);

/**
 * ★ 2026-05-23 P0-1 抢救：从 run 结果里抠出 well-formed finding。
 * 非 completed ≠ 无数据：
 *   - degraded（finalize 被 force-accept：schema 通过、仅业务规则未达标）→ r.output 已是合法 findings
 *   - failed/max-iter → r.output=undefined，但 r.partialOutput 可能携带 schema 合法的部分 findings
 * 只接受 claim/evidence/source 均为非空字符串的条目，raw decision JSON 等垃圾被过滤掉
 * → 不回归 2026-04-30「不把垃圾当 finding」的本意。
 */
function salvageResearcherFindings(res: {
  output?: unknown;
  partialOutput?: unknown;
}): { claim: string; evidence: string; source: string }[] {
  const out = (res.output ?? res.partialOutput) as
    | { findings?: unknown }
    | undefined;
  const raw: unknown[] = Array.isArray(out?.findings)
    ? (out?.findings as unknown[])
    : [];
  return raw.filter(
    (f): f is { claim: string; evidence: string; source: string } =>
      !!f &&
      typeof (f as { claim?: unknown }).claim === "string" &&
      typeof (f as { evidence?: unknown }).evidence === "string" &&
      typeof (f as { source?: unknown }).source === "string" &&
      (f as { claim: string }).claim.trim().length > 0 &&
      (f as { source: string }).source.trim().length > 0 &&
      // ★ 2026-05-23 review-fix #1a：evidence 也必须非空，与 researcher
      //   validateBusinessRules 的 evidence 门槛对齐——salvage 不得放进比 loop 自身
      //   gate 更弱的 finding（防止 evidence 空白的"伪 finding"进入写作）。
      (f as { evidence: string }).evidence.trim().length > 0,
  );
}

export async function runResearcherDispatchStage(
  ctx: MissionInvariants & PlanPhaseCtx & ResearchPhaseCtx,
  deps: MissionDeps,
): Promise<void> {
  const { missionId, userId, input, pool, plan } = ctx;
  if (!plan) throw new Error("S3 researcher dispatch requires ctx.plan");

  if (!ctx.focusDimension) {
    await narrate(deps.emit, missionId, userId, {
      stage: "s3-researchers",
      role: "researcher",
      tag: "info",
      text: `派遣 ${plan.dimensions.length} 个 Researcher 并行采集（concurrency=${input.concurrency}）`,
    });
  }

  // ★ Phase P1-17: 检测 dependsOn → 走 DAG 调度；否则全并行
  const hasDependencies = plan.dimensions.some(
    (d) => (d as { dependsOn?: string[] }).dependsOn?.length,
  );
  if (hasDependencies) {
  }

  // ★ 2026-05-01 两阶段调度（治本：mission da6e2af7 用户实证 dim research 看似批量）
  //   Phase A: research-only（researcher invoke + retry + figure 抽图）—— 高并发（默认 6）
  //   Phase B: chapter pipeline（outline + chapter writers + integrator + grade）—— 中并发（默认 3）
  //
  //   原 runOneDim 把 research + chapter pipeline 一起跑在 pLimit(3) 下，
  //   chapter pipeline 慢（5+ min）占住槽位，下一个 dim 的 research 要等满
  //   chapter pipeline 完成才能 start，造成"伪批量"假象。
  //
  //   分两阶段：research 阶段所有 dim 真并行（research API 通常 1 min 以内），
  //   chapter pipeline 阶段才控制并发。视觉上 dim research 真正全并行 start。
  //
  //   DAG 路径（hasDependencies）保持原有 runOneDim 单段，因为依赖关系跨阶段推断
  //   太复杂；非 DAG 路径走两阶段。
  const chapterPipelineConcurrency = Math.max(
    1,
    Math.min(input.concurrency ?? 3, 6),
  );
  const researchConcurrency = Math.max(
    chapterPipelineConcurrency,
    Math.min(plan.dimensions.length, 6),
  );

  // ★ #37 (2026-05-23): fire-and-forget per-dim checkpoint helper.
  // Saves a single dim's result into crossState.s3PartialResults + persists
  // a checkpoint so pod crashes don't force the entire S3 re-run.
  // Best-effort: checkpoint failure must never block the mission.
  function fireDimCheckpoint(
    dim: NonNullable<MissionContext["plan"]>["dimensions"][number],
    result: ResearcherDimResult,
  ): void {
    if (!deps.checkpointDimension) return;
    void deps
      .checkpointDimension(missionId, dim.id, result)
      .catch((err: unknown) => {
        deps.log.warn(
          `[s3 dim-checkpoint ${missionId}] dim "${dim.name}" checkpoint failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }

  // ★ 2026-05-29 单维度 scope 局部重跑：只重跑 ctx.focusDimension 指定的维度，
  //   其余维度复用 hydrate 出的已有产物（ctx.researcherResults），merge 后交下游 cascade。
  //   不触碰下面的多维度 phase A/B 逻辑。focus 维度不在 plan 时落回全维度路径。
  if (ctx.focusDimension) {
    const focusName = ctx.focusDimension;
    const focusIdx = plan.dimensions.findIndex(
      (d) => d.name === focusName || d.id === focusName,
    );
    if (focusIdx >= 0) {
      const prior = ctx.researcherResults ?? [];
      await narrate(deps.emit, missionId, userId, {
        stage: "s3-researchers",
        role: "researcher",
        tag: "info",
        text: `单维度局部重跑：仅重新采集「${plan.dimensions[focusIdx].name}」（保留其余 ${Math.max(prior.length - 1, 0)} 个维度已有产物）`,
      });
      const skipChapterPipeline =
        input.auditLayers === "minimal" || input.depth === "quick";
      const fresh = await runOneDim(
        ctx,
        deps,
        plan.dimensions[focusIdx],
        focusIdx,
        {
          skipChapterPipeline,
        },
      );
      fireDimCheckpoint(plan.dimensions[focusIdx], fresh);
      ctx.researcherResults = prior.some((r) => r.dimension === fresh.dimension)
        ? prior.map((r) => (r.dimension === fresh.dimension ? fresh : r))
        : [...prior, fresh];
      // ★ 2026-05-29 修：local rerun 走裸 stage handler，不经 orchestrator 后置的
      //   saveResearchResult；单维度重跑必须在此显式落库 agent_playground_research_results
      //   （retryLabel='' 覆盖 baseline 行），否则只改内存 ctx → ctx-hydrator re-fetch 读回旧
      //   findings = 像没重跑。与 orchestrator 后置（playground-business-orchestrator:508-517）
      //   同 state 映射 + best-effort .catch 非致命（FK 由 saveResearchResult 内部兜底）。
      await deps.store
        .saveResearchResult({
          missionId,
          dimension: fresh.dimension,
          findings: fresh.findings,
          summary: fresh.summary,
          state: fresh.findings.length === 0 ? "failed" : "completed",
        })
        .catch((err: unknown) => {
          deps.log.warn(
            `[s3 single-dim rerun saveResearchResult] dim=${fresh.dimension} failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      await narrate(deps.emit, missionId, userId, {
        stage: "s3-researchers",
        role: "researcher",
        tag: fresh.findings.length > 0 ? "success" : "warning",
        text: `维度「${fresh.dimension}」重新采集完成（${fresh.findings.length} 条 finding），下游章节将据此更新`,
      });
      return;
    }
  }

  let researcherResults: ResearcherDimResult[];
  if (hasDependencies) {
    researcherResults = await deps.invoker.runDagConcurrency(
      plan.dimensions,
      chapterPipelineConcurrency,
      async (dim, idx) => {
        const result = await runOneDim(ctx, deps, dim, idx);
        fireDimCheckpoint(dim, result);
        return result;
      },
    );
  } else {
    // Phase A: research only（高并发）
    const phaseALimit = pLimit(researchConcurrency);
    const researchOnly = await Promise.all(
      plan.dimensions.map((dim, idx) =>
        phaseALimit(() => runResearchPhase(ctx, deps, dim, idx)),
      ),
    );
    // Phase B: chapter pipeline（中并发）
    const skipChapterPipeline =
      input.auditLayers === "minimal" || input.depth === "quick";
    if (skipChapterPipeline) {
      // In skip-chapter mode, Phase A result IS the final result per dim.
      // Fire checkpoint now that each dim is fully done.
      for (let i = 0; i < researchOnly.length; i++) {
        fireDimCheckpoint(plan.dimensions[i], researchOnly[i]);
      }
      researcherResults = researchOnly;
    } else {
      // ★ P0-5a (audit 2026-05-06): Promise.allSettled 防 1 dim 同步 throw 拖累全部。
      //   runChapterPhase 内部已 try-catch 返回 researchResult 兜底，但
      //   任何边界遗漏（emit reject / .catch 之外的 throw）一旦冒泡，
      //   Promise.all 会让已完成 dim 的结果被一并丢弃。allSettled 让每个
      //   dim 独立结算，rejected 的 dim 回退到 Phase A 的 research 结果。
      const phaseBLimit = pLimit(chapterPipelineConcurrency);
      const settled = await Promise.allSettled(
        researchOnly.map((res, idx) =>
          phaseBLimit(() =>
            runChapterPhase(ctx, deps, plan.dimensions[idx], idx, res),
          ),
        ),
      );
      researcherResults = settled.map((s, idx) => {
        const finalResult =
          s.status === "fulfilled"
            ? s.value
            : (() => {
                const reason =
                  s.reason instanceof Error
                    ? s.reason.message
                    : String(s.reason);
                deps.log.warn(
                  `[s3 phase B] dim "${plan.dimensions[idx].name}" rejected: ${reason} — fallback to phase-A research result`,
                );
                return researchOnly[idx];
              })();
        // ★ #37: fire per-dim checkpoint after Phase A+B both done for this dim
        fireDimCheckpoint(plan.dimensions[idx], finalResult);
        return finalResult;
      });
    }
  }

  ctx.researcherResults = researcherResults;
  const okCount = researcherResults.filter((r) => r.findings.length > 0).length;
  await narrate(deps.emit, missionId, userId, {
    stage: "s3-researchers",
    role: "researcher",
    tag: okCount === researcherResults.length ? "success" : "warning",
    text: `${okCount} / ${researcherResults.length} 个维度采集完成${okCount < researcherResults.length ? "（部分维度降级）" : ""}`,
  });

  if (pool.isExhausted()) {
    await deps
      .emit({
        type: "playground.budget:exhausted",
        missionId,
        userId,
        payload: pool.snapshot(),
      })
      .catch((err: unknown) => {
        deps.log.error(
          `[${missionId}] budget:exhausted emit failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    // ★ P1-修2 (2026-05-06): budget exhausted 立刻 abort mission，让所有未完成
    //   stage 内部的 await 立即看到 abort signal 失败。之前只 emit 不 abort，
    //   mission 会继续到 wall-time 4h 才超时，浪费时间 + token。
    // abort 不依赖 emit 成功，独立执行。
    deps.abortRegistry.abort(missionId, MissionAbortReason.budget_exhausted);
  }
}

/**
 * Phase A: 单 dim 仅跑 research（不跑 chapter pipeline）
 * 用于两阶段调度，让 research 阶段所有 dim 真并行（pLimit 不被 chapter pipeline 占用）。
 *
 * 行为与 runOneDim 的前半段（步骤 1-4 + figure 抽图）等价，区别只是不调
 * runPerDimPipeline。失败路径返回降级占位（与 runOneDim 一致）。
 */
async function runResearchPhase(
  ctx: MissionContext,
  deps: MissionDeps,
  dim: NonNullable<MissionContext["plan"]>["dimensions"][number],
  idx: number,
): Promise<ResearcherDimResult> {
  return runOneDim(ctx, deps, dim, idx, { skipChapterPipeline: true });
}

/**
 * Phase B: 单 dim 仅跑 chapter pipeline（research 已在 Phase A 完成）
 * 接收 Phase A 的 ResearcherDimResult，进入 per-dim-pipeline 做 outline + chapter
 * writing + integrator + grade。降级 / 失败路径直接返回输入（保留 research 阶段产出）。
 */
async function runChapterPhase(
  ctx: MissionContext,
  deps: MissionDeps,
  dim: NonNullable<MissionContext["plan"]>["dimensions"][number],
  idx: number,
  researchResult: ResearcherDimResult,
): Promise<ResearcherDimResult> {
  const { missionId, userId, input, billing, pool, budgetMultiplier } = ctx;
  const agentId = `researcher#${idx}`;
  // ★ 2026-05-01 深度仿真发现的漏洞补丁：research 阶段已降级（findings=[]）时
  //   直接透传不调 per-dim-pipeline。但 per-dim-pipeline 是 dim:graded 终态事件
  //   的唯一发射点，跳过它会让前端卡"等待评分"。这里手动发一个 graded(failed,
  //   skipped, phase=research-failed)，保持 INVARIANT：每个 dim 必有终态事件。
  if (researchResult.findings.length === 0) {
    await deps
      .emit({
        type: "playground.dimension:graded",
        missionId,
        userId,
        agentId: `quality-judge#${idx}`,
        payload: {
          dimension: dim.name,
          overall: 0,
          grade: "F",
          axes: {},
          summary: `${dim.name} · research 阶段降级（无 finding），跳过 chapter pipeline + 评分。`,
          failed: true,
          skipped: true,
          phase: "research-failed",
        },
      })
      .catch((err: unknown) => {
        deps.log.warn(
          `[${missionId}] emit dimension:graded (research-failed) for "${dim.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    return researchResult;
  }
  try {
    return await runPerDimPipeline(
      {
        missionId,
        userId,
        dimensionIdx: idx,
        dimensionName: dim.name,
        topic: input.topic,
        language: input.language,
        depth: input.depth,
        lengthProfile: input.lengthProfile,
        dimensionCount: ctx.plan?.dimensions.length,
        pool,
        researcherOut: researchResult,
        billing,
        budgetMultiplier,
      },
      deps,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.log.warn(
      `[per-dim pipeline ${idx}] threw on "${dim.name}": ${message}`,
    );
    await deps
      .emit({
        type: "playground.dimension:degraded",
        missionId,
        userId,
        agentId,
        payload: {
          dimension: dim.name,
          state: "chapter-pipeline-failed",
          failureCode: "ORCH_CHAPTER_PIPELINE_FAILED",
          innerFailureCode: "ORCH_CHAPTER_PIPELINE_FAILED",
          innerMessage: message,
          diagnostic: {
            stage: "per-dim-chapter-pipeline",
            errorMessage: message,
          },
        },
      })
      .catch((err: unknown) => {
        deps.log.warn(
          `[${missionId}] emit dimension:degraded (chapter-pipeline-failed) for "${dim.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    return {
      ...researchResult,
      findings: [],
      summary: `(failed: chapter-pipeline-failed) ${dim.name} · ${message.slice(0, 150)}`,
    };
  }
}

/** 单个 dim 的 researcher 执行：cross-mission preDisable + self-heal + per-dim chapter pipeline。
 *
 * @param opts.skipChapterPipeline 强制跳过 chapter pipeline（用于 Phase A 拆分）
 */
async function runOneDim(
  ctx: MissionContext,
  deps: MissionDeps,
  dim: NonNullable<MissionContext["plan"]>["dimensions"][number],
  idx: number,
  opts: { skipChapterPipeline?: boolean } = {},
): Promise<ResearcherDimResult> {
  const { missionId, userId, input, billing, pool, budgetMultiplier } = ctx;
  const agentId = `researcher#${idx}`;

  try {
    // ── L2: 跨 mission failure pattern 预查 ──
    const promptKey = `${input.topic}::${dim.name}::${input.language}`;
    const knownFailures = await deps.failureLearner
      .lookup({
        agentSpecId: "playground.researcher",
        systemPrompt: promptKey,
      })
      .catch((err: unknown) => {
        deps.log.warn(
          `[researcher#${idx}] failureLearner.lookup failed for dim "${dim.name}" (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
        );
        return [];
      });
    const preDisabled: { failed: string; fallback: string }[] = [];
    for (const rec of knownFailures) {
      if (rec.count >= 2 && rec.lastFallbackModel) {
        // billing.markModelDisabled 是 async (Promise<void>)，fire-and-forget
        // pre-disable 不阻塞 researcher 主流程；失败由 BillingAdapter 内部 log
        void billing.markModelDisabled(rec.modelId, rec.lastFallbackModel);
        preDisabled.push({
          failed: rec.modelId,
          fallback: rec.lastFallbackModel,
        });
      }
    }
    if (preDisabled.length > 0) {
      deps.log.log(
        `[researcher#${idx}] pre-disabled ${preDisabled.length} known-failing model(s) on dim "${dim.name}": ${preDisabled.map((d) => `${d.failed}→${d.fallback}`).join(", ")}`,
      );
      await deps
        .emit({
          type: "playground.failure-pattern:pre-applied",
          missionId,
          userId,
          agentId,
          payload: {
            dimension: dim.name,
            preDisabled,
            matchedRecords: knownFailures.length,
          },
        })
        .catch((err: unknown) => {
          deps.log.warn(
            `[${missionId}] emit failure-pattern:pre-applied for "${dim.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    }

    await deps.lifecycle(missionId, userId, agentId, "researcher", "started", {
      dimension: dim.name,
    });

    // ── per-dim research:started（invoke 之前 emit，前端立刻看到该 dim 开始采集）──
    await deps
      .emit({
        type: "playground.dimension:research:started",
        missionId,
        userId,
        agentId,
        payload: {
          dimension: dim.name,
          dimensionId: dim.id,
          dimensionIdx: idx,
        },
      })
      .catch((err: unknown) => {
        deps.log.warn(
          `[${missionId}] emit dimension:research:started for "${dim.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

    const runResearcher = (
      attempt: number,
      bumpedMult: number,
      topicSuffix = "",
    ) =>
      deps.invoker.invoke(
        ResearcherAgent,
        {
          topic: input.topic + topicSuffix,
          dimension: dim.name,
          description: input.description,
          language: input.language,
          withFigures: input.withFigures,
          knowledgeBaseIds: input.knowledgeBaseIds,
          searchTimeRange: input.searchTimeRange,
        },
        {
          missionId,
          userId,
          agentId: attempt > 0 ? `${agentId}.retry${attempt}` : agentId,
          role: "researcher",
          envAdapter: billing,
          budgetMultiplier: bumpedMult,
          toolRecallHint: dim.toolHint
            ? {
                categories: dim.toolHint.categories,
                preferIds: dim.toolHint.preferIds,
              }
            : undefined,
        },
      );

    let r = await runResearcher(0, budgetMultiplier);

    // ── L1: self-heal RECOVERABLE failureCode → +50% budget 重跑 ──
    if (salvageResearcherFindings(r).length === 0) {
      const innerFail0 = extractAgentFailureDiagnostic(r.events);
      const code0 = innerFail0?.failureCode;
      if (code0 && RECOVERABLE_FAILURES.has(code0)) {
        deps.log.warn(
          `[researcher#${idx}] dim "${dim.name}" first attempt failed (${code0}); retrying with +50% budget`,
        );
        await deps
          .emit({
            type: "playground.dimension:retrying",
            missionId,
            userId,
            agentId,
            payload: {
              dimension: dim.name,
              reason: code0,
              bumpedBudgetMultiplier: budgetMultiplier * 1.5,
            },
          })
          .catch((err: unknown) => {
            deps.log.warn(
              `[${missionId}] emit dimension:retrying (self-heal) for "${dim.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
        r = await runResearcher(
          1,
          budgetMultiplier * 1.5,
          `（重试：上一轮以 ${code0} 失败，请先返回符合 schema 的 finalize；4-5 条 finding，每条带 source URL）`,
        );
      }
    }

    // ── C: min-findings 退出闸 —— findings.length < 5 强制 retry ──────────────
    // (C-alignment 2026-05-06): 对齐 Topic Insight 报告标准，每 dim 至少 5 条 finding
    // 才能保证下游 quality-judge sources_sufficiency 评分通过。即使 schema 校验通过
    // (≥4 条，validateBusinessRules 阈值)，5 条以下也触发一次 retry。
    // 仅在首次 attempt (r.state === "completed") 后且第一次自愈还未用过时执行，
    // 避免与 L1 self-heal 冲突（L1 已用过 attempt=1 时跳过本检查）。
    //
    // ★ 2026-05-13 (root-fix): 从 typed runtime config 读阈值。本地推理模型
    // (Nemotron / DeepSeek-R1) plateaus at 3-4 findings per dim，硬编码 5 会
    // 触发无效的 self-heal retry。PLAYGROUND_TUNING_PROFILE=local-reasoning /
    // local-quantized 把阈值降到 3，per-knob env MIN_FINDINGS_THRESHOLD 进一步覆盖。
    const MIN_FINDINGS_THRESHOLD =
      loadPlaygroundRuntimeConfig().minFindingsThreshold;
    if (
      r.state === "completed" &&
      r.output &&
      ((r.output as { findings?: unknown[] }).findings ?? []).length <
        MIN_FINDINGS_THRESHOLD
    ) {
      const actualCount = (
        (r.output as { findings?: unknown[] }).findings ?? []
      ).length;
      deps.log.warn(
        `[researcher#${idx}] dim "${dim.name}" completed but findings.length=${actualCount} < ${MIN_FINDINGS_THRESHOLD}; forcing retry to collect more findings`,
      );
      await deps
        .emit({
          type: "playground.dimension:retrying",
          missionId,
          userId,
          agentId,
          payload: {
            dimension: dim.name,
            reason: `min-findings-not-met (${actualCount} < ${MIN_FINDINGS_THRESHOLD})`,
            bumpedBudgetMultiplier: budgetMultiplier * 1.5,
          },
        })
        .catch((err: unknown) => {
          deps.log.warn(
            `[${missionId}] emit dimension:retrying (min-findings) for "${dim.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      r = await runResearcher(
        2,
        budgetMultiplier * 1.5,
        `（当前只有 ${actualCount} 条 finding，要求至少 ${MIN_FINDINGS_THRESHOLD} 条。请多调 1-2 轮搜索，把 finding 补到 ≥${MIN_FINDINGS_THRESHOLD} 条，每条带不同 source URL）`,
      );
    }

    // ── 跑通 + 用了 fallback model → 回写 successfulFallback ──
    if (r.state === "completed" && r.output && preDisabled.length > 0) {
      let actualModelId: string | undefined;
      for (let i = r.events.length - 1; i >= 0; i--) {
        const ev = r.events[i];
        if (ev.type === "thinking") {
          const p = ev.payload as { modelId?: string } | null;
          if (p?.modelId) {
            actualModelId = p.modelId;
            break;
          }
        }
      }
      if (actualModelId) {
        for (const pd of preDisabled) {
          if (actualModelId === pd.fallback) {
            for (const rec of knownFailures.filter(
              (r0) => r0.modelId === pd.failed,
            )) {
              await deps.failureLearner
                .recordSuccessfulFallback({
                  key: {
                    agentSpecId: "playground.researcher",
                    modelId: pd.failed,
                    systemPrompt: promptKey,
                    failureCode: rec.failureCode,
                  },
                  fallbackModelId: pd.fallback,
                })
                .catch((err: unknown) => {
                  deps.log.warn(
                    `[researcher#${idx}] failureLearner.recordSuccessfulFallback failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
                  );
                });
            }
          }
        }
      }
    }

    // ★ 2026-05-23 P0-1 抢救：state≠completed 不等于无数据；抢到 well-formed finding 就用。
    const salvagedFindings = salvageResearcherFindings(r);
    const salvagedOutput = (r.output ?? r.partialOutput) as
      | { dimension?: unknown; summary?: unknown; figureCandidates?: unknown }
      | undefined;
    const salvagedDimension =
      salvagedOutput && typeof salvagedOutput.dimension === "string"
        ? salvagedOutput.dimension
        : dim.name;
    const salvagedSummary =
      salvagedOutput && typeof salvagedOutput.summary === "string"
        ? salvagedOutput.summary
        : "";
    // ★ 2026-05-23 review-fix #1b：salvage 的 figureCandidates 也要过 zod 同等校验
    //   （sourceUrl 必须是 http(s)、caption 非空），不能 raw cast 直接放行。
    const salvagedFigureCandidates = (
      Array.isArray(salvagedOutput?.figureCandidates)
        ? (salvagedOutput?.figureCandidates as {
            sourceUrl?: unknown;
            imageUrl?: unknown;
            caption?: unknown;
            sourcePageOrSection?: unknown;
            relevanceHint?: unknown;
          }[])
        : []
    ).filter(
      (
        c,
      ): c is {
        sourceUrl: string;
        imageUrl?: string;
        caption: string;
        sourcePageOrSection?: string;
        relevanceHint?: "high" | "medium" | "low";
      } =>
        !!c &&
        typeof c.sourceUrl === "string" &&
        /^https?:\/\//i.test(c.sourceUrl) &&
        typeof c.caption === "string" &&
        c.caption.trim().length > 0,
    );
    const collectionUsable =
      r.state !== "cancelled" && salvagedFindings.length > 0;

    await deps.invoker.tickCost(
      missionId,
      userId,
      "researchers",
      pool,
      extractTokenSpend(r.events),
      r.events,
    );
    await deps.lifecycle(
      missionId,
      userId,
      agentId,
      "researcher",
      collectionUsable ? "completed" : "failed",
      {
        wallTimeMs: r.wallTimeMs,
        iterations: r.iterations,
        dimension: dim.name,
        ...agentUsageDetail(r),
        error: extractFailureMessage(r.events, r.state, !!r.output, {
          iterations: r.iterations,
          wallTimeMs: r.wallTimeMs,
        }),
      },
    );
    const finalFindingsCount = salvagedFindings.length;
    // ── per-dim research:completed（与 researcher:completed 并存，携带明确 dimensionRef）──
    await deps
      .emit({
        type: "playground.dimension:research:completed",
        missionId,
        userId,
        agentId,
        payload: {
          dimension: dim.name,
          state: collectionUsable ? "completed" : r.state,
          findingsCount: finalFindingsCount,
        },
      })
      .catch((err: unknown) => {
        deps.log.warn(
          `[${missionId}] emit dimension:research:completed for "${dim.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    await deps
      .emit({
        type: "playground.researcher:completed",
        missionId,
        userId,
        agentId,
        payload: {
          dimension: dim.name,
          state: collectionUsable ? "completed" : r.state,
          iterations: r.iterations,
          wallTimeMs: r.wallTimeMs,
          summary: salvagedSummary || undefined,
          findingsCount: finalFindingsCount,
        },
      })
      .catch((err: unknown) => {
        deps.log.warn(
          `[${missionId}] emit researcher:completed for "${dim.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    await narrate(deps.emit, missionId, userId, {
      stage: "s3-researchers",
      role: "researcher",
      tag: collectionUsable ? "success" : "warning",
      text: collectionUsable
        ? `维度「${dim.name}」采集完成 · ${finalFindingsCount} 条 finding · ${r.iterations} 轮思考`
        : `维度「${dim.name}」未完成（${r.state}），下游走退化路径`,
      dimension: dim.name,
      agentId,
    });

    if (!collectionUsable) {
      // ── L3: dim 降级（mission 仍继续）+ 入库 failure pattern ──
      const innerFailure = extractAgentFailureDiagnostic(r.events);
      await deps
        .emit({
          type: "playground.dimension:degraded",
          missionId,
          userId,
          agentId,
          payload: {
            dimension: dim.name,
            state: r.state,
            failureCode: "ORCH_DIMENSION_DEGRADED",
            innerFailureCode: innerFailure?.failureCode,
            innerMessage: innerFailure?.message,
            diagnostic: {
              ...(innerFailure?.diagnostic ?? {}),
              stage: "researcher",
              iterations: r.iterations,
              wallTimeMs: r.wallTimeMs,
            },
            recoveryHint: innerFailure?.recoveryHint,
          },
        })
        .catch((err: unknown) => {
          deps.log.warn(
            `[${missionId}] emit dimension:degraded (ORCH_DIMENSION_DEGRADED) for "${dim.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      if (innerFailure?.failureCode) {
        const innerModelId = (innerFailure.diagnostic?.modelId ??
          "unknown") as string;
        await deps.failureLearner
          .recordFailure({
            key: {
              agentSpecId: "playground.researcher",
              modelId: innerModelId,
              systemPrompt: `${input.topic}::${dim.name}::${input.language}`,
              failureCode: innerFailure.failureCode,
            },
            missionId,
            userId,
            diagnostic: innerFailure.diagnostic,
          })
          .catch((err: unknown) => {
            deps.log.warn(
              `[researcher#${idx}] failureLearner.recordFailure for dim "${dim.name}" failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
            );
          });
      }
      return {
        dimension: dim.name,
        findings: [],
        summary: `(failed: ${r.state}${innerFailure?.failureCode ? `, code=${innerFailure.failureCode}` : ""})`,
      };
    }

    const researcherOut: {
      dimension: string;
      findings: { claim: string; evidence: string; source: string }[];
      summary: string;
      figureCandidates?: {
        sourceUrl: string;
        imageUrl?: string;
        caption: string;
        sourcePageOrSection?: string;
        relevanceHint?: "high" | "medium" | "low";
      }[];
    } = {
      dimension: salvagedDimension,
      findings: salvagedFindings,
      summary: salvagedSummary,
      figureCandidates: salvagedFigureCandidates,
    };

    // ── 沉淀（2026-04-29）: figure pipeline 自动抽图 ─────────────────
    //   不再依赖 LLM 主动抽 figureCandidates（researcher 经常忽略 prompt）。
    //   从 findings.source URL 自动 web-scraper 抽图 → embedding 相关性过滤 →
    //   填回 researcherOut.figureCandidates。
    if (input.withFigures && researcherOut.findings.length > 0) {
      try {
        // 取前 3 个高质量 source URL（避免抽太多浪费时间）
        const sourceUrls = Array.from(
          new Set(
            researcherOut.findings
              .map((f) => f.source)
              .filter(
                (s): s is string =>
                  typeof s === "string" && /^https?:\/\//i.test(s),
              )
              // ★ 2026-05-02 (用户实证图片严重缺失)：原 slice(0,3) 太严，每 dim
              //   只抽 3 个 URL，半数 mission 抓不到合适图。提到 6 给 figure
              //   relevance filter 更多候选。relevant.slice(0,3) 仍保留每 dim 上限。
              .slice(0, 6),
          ),
        );
        if (sourceUrls.length > 0) {
          const allFigures = (
            await Promise.all(
              sourceUrls.map((url) =>
                deps.figureExtractor
                  .extractFiguresFromUrl(url, 15_000)
                  .catch((err: unknown) => {
                    deps.log.debug(
                      `[researcher#${idx}] figureExtractor failed for url=${url}: ${err instanceof Error ? err.message : String(err)}`,
                    );
                    return [];
                  }),
              ),
            )
          ).flat();
          if (allFigures.length > 0) {
            const relevant = await deps.figureRelevance
              .filterRelevantFigures(allFigures, dim.name)
              .catch((err: unknown) => {
                deps.log.warn(
                  `[researcher#${idx}] filterRelevantFigures failed for dim "${dim.name}" (fallback to allFigures): ${err instanceof Error ? err.message : String(err)}`,
                );
                return allFigures;
              });
            // 取前 3 张高相关度图填到 figureCandidates
            researcherOut.figureCandidates = relevant
              .slice(0, 3)
              .map(
                (f: {
                  imageUrl: string;
                  caption?: string;
                  alt?: string;
                  type?: string;
                }) => ({
                  sourceUrl: f.imageUrl, // 沉淀实现里 imageUrl 是绝对 URL
                  imageUrl: f.imageUrl,
                  caption: f.caption || `(图自 ${dim.name})`,
                  sourcePageOrSection: f.alt,
                  relevanceHint:
                    f.type === "chart" || f.type === "table"
                      ? "high"
                      : "medium",
                }),
              );
            deps.log.log(
              `[s3 figure-pipeline ${idx}] dim "${dim.name}" 抽 ${allFigures.length} 张 → 相关 ${relevant.length} → 用 ${(researcherOut.figureCandidates ?? []).length}`,
            );
          }
        }
      } catch (err) {
        deps.log.warn(
          `[s3 figure-pipeline ${idx}] failed (best-effort): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // ── per-dim chapter pipeline (skip 在 minimal / quick 档位 OR Phase A 强制跳过) ──
    const skipChapterPipeline =
      opts.skipChapterPipeline === true ||
      input.auditLayers === "minimal" ||
      input.depth === "quick";
    if (skipChapterPipeline) return researcherOut;

    try {
      return await runPerDimPipeline(
        {
          missionId,
          userId,
          dimensionIdx: idx,
          dimensionName: dim.name,
          topic: input.topic,
          language: input.language,
          depth: input.depth,
          lengthProfile: input.lengthProfile,
          dimensionCount: ctx.plan?.dimensions.length,
          pool,
          researcherOut,
          billing,
          budgetMultiplier,
        },
        deps,
      );
    } catch (err) {
      // ★ P0-LIVE-PATCH-SILENT (2026-04-30): per-dim chapter pipeline 失败之前
      //   静默 log warn 后 return researcherOut，UI 看不到该 dim 章节缺失，
      //   下游 S8 writer 基于无章节数据装配，产出严重退化。修复：emit
      //   dimension:degraded 事件 + summary 注 [chapter-pipeline-failed]，
      //   下游 writer / S10 signoff 都能看到。
      const message = err instanceof Error ? err.message : String(err);
      deps.log.warn(
        `[per-dim pipeline ${idx}] threw on "${dim.name}": ${message}`,
      );
      await deps
        .emit({
          type: "playground.dimension:degraded",
          missionId,
          userId,
          agentId,
          payload: {
            dimension: dim.name,
            state: "chapter-pipeline-failed",
            failureCode: "ORCH_CHAPTER_PIPELINE_FAILED",
            innerFailureCode: "ORCH_CHAPTER_PIPELINE_FAILED",
            innerMessage: message,
            diagnostic: {
              stage: "per-dim-chapter-pipeline",
              errorMessage: message,
            },
          },
        })
        .catch((err2: unknown) => {
          deps.log.warn(
            `[${missionId}] emit dimension:degraded (ORCH_CHAPTER_PIPELINE_FAILED) for "${dim.name}" failed: ${err2 instanceof Error ? err2.message : String(err2)}`,
          );
        });
      return {
        ...researcherOut,
        summary:
          `${researcherOut.summary ?? ""}\n\n[chapter-pipeline-failed] ${message.slice(0, 150)}`.trim(),
      };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errName = err instanceof Error ? err.name : "Unknown";
    deps.log.warn(
      `[researcher#${idx}] threw on dim "${dim.name}" (${errName}): ${message}`,
    );
    await deps
      .lifecycle(missionId, userId, agentId, "researcher", "failed", {
        dimension: dim.name,
        error: message,
      })
      .catch((emitErr: unknown) => {
        deps.log.warn(
          `[researcher#${idx}] lifecycle emit (failed) for dim "${dim.name}" failed (non-fatal): ${emitErr instanceof Error ? emitErr.message : String(emitErr)}`,
        );
      });
    let innerFailureCode = "UNKNOWN";
    if (errName === "ByokRequiredError") {
      innerFailureCode = "PROVIDER_BYOK_MODEL_NOT_FOUND";
    } else if (
      errName === "InputValidationError" ||
      errName === "DefineAgentMissingError"
    ) {
      innerFailureCode = "RUNNER_INPUT_SCHEMA_MISMATCH";
    } else if (/timeout|timed out/i.test(message)) {
      innerFailureCode = "RUNNER_WALL_TIME_EXCEEDED";
    } else if (/rate.?limit|429/i.test(message)) {
      innerFailureCode = "PROVIDER_RATE_LIMIT";
    } else if (!/aborted|cancelled/i.test(message)) {
      innerFailureCode = "PROVIDER_API_ERROR";
    }
    await deps
      .emit({
        type: "playground.dimension:degraded",
        missionId,
        userId,
        agentId,
        payload: {
          dimension: dim.name,
          state: "exception",
          failureCode: "ORCH_DIMENSION_DEGRADED",
          innerFailureCode,
          innerMessage: message,
          diagnostic: {
            stage: "researcher",
            errorName: errName,
            errorMessage: message,
            errorStack: err instanceof Error ? err.stack : undefined,
          },
        },
      })
      .catch((emitErr: unknown) => {
        deps.log.warn(
          `[${missionId}] emit dimension:degraded (exception) for "${dim.name}" failed: ${emitErr instanceof Error ? emitErr.message : String(emitErr)}`,
        );
      });
    return {
      dimension: dim.name,
      findings: [],
      summary: `(error: ${message})`,
    };
  }
}

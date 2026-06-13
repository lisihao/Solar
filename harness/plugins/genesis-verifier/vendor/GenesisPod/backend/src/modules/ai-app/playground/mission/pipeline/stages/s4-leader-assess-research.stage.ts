/**
 * Stage S4 — Leader assesses research progress and dispatches corrective actions
 *
 * researcher×N 跑完之后，Leader 看到每个 dim 的 findings/sources/state，给出过程
 * 管理决策：accept-all / patch / redirect / abort，并把决策真正落到调度上。
 *
 *   reads  ctx: plan, researcherResults, leader
 *   mutate ctx: plan.dimensions (redirect 追加新 dim) +
 *               researcherResults (retry/abort/extend 后的结果)
 *   deps:       invoker (重派 researcher), emit, lifecycle, log
 *
 * Per-dim action 处理矩阵：
 *   accept / accept-degraded   → no-op，保留原 researcher 产出
 *   retry-with-critique        → 带 critique 重派 ResearcherAgent，覆盖原 result
 *   replace-spec               → 当前只注册 ResearcherAgent，降级为带换 spec 提示的 retry
 *   abort                      → 该 dim 标记 findings=[] + summary="(aborted by Leader)"
 * Mission-level decision:
 *   abort                      → throw "Leader aborted mission..."（mission 终止）
 *   redirect.newDimensions[]   → 追加 dim 到 plan + 跑 ResearcherAgent
 *
 * Failure modes: leader.assessResearchers 抛错（非 Leader 主动 abort）→ log warn + 继续
 *                Leader 主动 abort → rethrow（mission 终止）
 */

import { ResearcherAgent } from "../../agents/researcher/researcher.agent";
import type {
  MissionContext,
  MissionInvariants,
  PlanPhaseCtx,
  ResearchPhaseCtx,
} from "../../context/mission-context";
import type { MissionDeps } from "../../context/mission-deps";
import { extractTokenSpend } from "@/modules/ai-harness/facade";
import { extractFailureMessage } from "@/modules/ai-harness/facade";
import { narrate } from "../../artifacts/narrative.util";
import { agentUsageDetail } from "../helpers/agent-usage.util";
import { runPerDimPipeline } from "../helpers/per-dim-pipeline.util";
// ★ 2026-05-21 P2 闭环：来源充分性单一权威（含域名多样性）
import { computeEvidenceBudget } from "../../artifacts/evidence-budget";
// ★ Phase 7 (2026-04-29): 用 ai-harness 沉淀的 DAGExecutor 替代 Promise.allSettled
import { DAGExecutor, type DAGAdapter } from "@/modules/ai-harness/facade";

/**
 * Leader 主动 abort 的哨兵错误。用类型识别（instanceof）而非 message 前缀匹配 ——
 * 后者在错误文案本地化后会失配，把"应终止 mission"的 abort 误吞成"非致命继续"。
 */
class LeaderAbortError extends Error {
  readonly isLeaderAbort = true;
}

interface PlanDimensionLite {
  id: string;
  name: string;
  rationale: string;
  toolHint?: {
    categories: string[];
    preferIds?: string[];
  };
  dependsOn?: string[];
}

export async function runLeaderAssessResearchStage(
  ctx: MissionInvariants & PlanPhaseCtx & ResearchPhaseCtx,
  deps: MissionDeps,
): Promise<void> {
  const { missionId, userId, plan, researcherResults, leader } = ctx;
  if (!plan || !researcherResults) {
    throw new Error("Leader assess stage requires plan + researcherResults");
  }

  // ★ 2026-05-06 (P0-A 截图 4 红框 #11 卡待启动): S4 之前从未 emit stage:started/completed，
  //   前端 todo-ledger 占位卡永远翻不了牌。同 S7/S8B/S9B 修复模式。
  try {
    await narrate(deps.emit, missionId, userId, {
      stage: "s4-leader-assess",
      role: "leader",
      tag: "thinking",
      text: `Leader 开始评审 ${plan.dimensions.length} 个维度的产出，决定是否需要补研究 / 砍维度`,
      agentId: "leader",
    });
    // ★ 2026-05-07 P0 修法 A：给 Leader 显式 PASS/FAIL 标记，避免 LLM 心算 findings
    //   vs minSources 不准 → 习惯性挑"看起来略弱"的 2 个 retry。
    //   minSources 来自 mission plan.goals.qualityBar（Leader 自己 M0 定的下限）。
    const minSourcesRequired = plan.goals?.qualityBar?.minSources ?? 0;
    const researcherOutcomes = plan.dimensions.map((d) => {
      const r = researcherResults.find((x) => x.dimension === d.name);
      const findings = r?.findings ?? [];
      const summary = r?.summary ?? "";
      const state: "completed" | "degraded" | "failed" =
        findings.length === 0
          ? "failed"
          : summary.startsWith("(failed") || summary.startsWith("(error")
            ? "degraded"
            : "completed";
      const sources = findings
        .map((f) => f.source)
        .filter((s): s is string => typeof s === "string")
        .slice(0, 5);
      const failureCodeMatch = summary.match(/code=([A-Z_]+)/);
      // ★ 2026-05-21 P2 闭环：来源充分性纳入"域名多样性"。findings 数达标但全部同域
      //   （uniqueDomains < 2）视为覆盖不足 → 复用既有 leader 重采（retry-with-critique，
      //   已有 max 1 轮 / max 2 dim 风暴护栏），让"采得多但全同源"也能触发回采。
      const budget = computeEvidenceBudget(findings);
      const singleDomainRisk = findings.length >= 2 && budget.uniqueDomains < 2;
      const meetsMinSources =
        (minSourcesRequired === 0 || findings.length >= minSourcesRequired) &&
        !singleDomainRisk;
      const minSourcesDelta = Math.max(0, minSourcesRequired - findings.length);
      return {
        dimensionId: d.id,
        dimensionName: d.name,
        state,
        findingsCount: findings.length,
        sources,
        summary: summary.slice(0, 300),
        failureCode: failureCodeMatch ? failureCodeMatch[1] : undefined,
        // ★ A 修法：明确达标判定 + 阈值，让 prompt 渲染 ✓/✗ 不靠 LLM 心算
        meetsMinSources,
        minSourcesRequired,
        minSourcesDelta, // 缺多少条；达标时 = 0
        // ★ P2：域名多样性（信息性）；singleDomainRisk 已折进 meetsMinSources
        uniqueDomains: budget.uniqueDomains,
      };
    });
    const m1Raw = await leader.assessResearchers(researcherOutcomes);
    // ★ P0-5 (2026-04-29): S4 多轮 patch 全局上限 —— 第二轮起所有 retry 强制降级 accept-degraded
    //    防止 Leader 反复返回 patch 决策让 stage 被无限重入（mission 8c7b4358 runaway 同源）。
    // ★ 全覆盖审计修 (2026-05-06): 在自增前先检查是否已超限，超限直接 return。
    //   原逻辑先自增再检查，若外层有重入（ctx 被共享引用）会导致计数不准：
    //   第 1 次进入已经 round=1>MAX，理应 no-op 却还走降级逻辑并继续；
    //   提前 return 确保超限时完全不执行任何 retry 分支。
    const MAX_S4_ROUNDS = 1; // 只允许第一轮真正 retry
    if ((ctx.s4PatchRound ?? 0) >= MAX_S4_ROUNDS) {
      deps.log.warn(
        `[${missionId}] S4 already at round ${ctx.s4PatchRound ?? 0} >= MAX_S4_ROUNDS(${MAX_S4_ROUNDS}): forced early-exit to prevent retry storm`,
      );
      return;
    }
    ctx.s4PatchRound = (ctx.s4PatchRound ?? 0) + 1;
    if (ctx.s4PatchRound > MAX_S4_ROUNDS) {
      let downgraded = 0;
      for (const a of m1Raw.perDimension) {
        if (a.action === "retry-with-critique" || a.action === "replace-spec") {
          (a as unknown as { action: string }).action = "accept-degraded";
          downgraded++;
        }
      }
      // 同时把 mission-level decision 从 patch/redirect 强降为 accept-all
      if (m1Raw.decision === "patch" || m1Raw.decision === "redirect") {
        (m1Raw as unknown as { decision: string }).decision = "accept-all";
      }
      deps.log.warn(
        `[${missionId}] S4 round ${ctx.s4PatchRound} > ${MAX_S4_ROUNDS}: forced ${downgraded} retry→accept-degraded to prevent retry storm`,
      );
    }
    // ★ 防 retry 风暴：单轮 patch 数 ≤ 2。Leader 若返回 >2 个 retry-with-critique，
    //    保留 finding-count 最少的 2 个（最弱的）继续 retry，其余降级为 accept-degraded。
    //    rationale: 5 个 dim 同时 retry 会撞 wall-time + 预算池；保留 4 个 dim 工作
    //    + 修最弱 2 个 比"重做 5 个 dim 但全部崩溃"质量更高（NaN 不是质量）。
    const MAX_PATCHES_PER_ROUND = 2;
    const retryActions = m1Raw.perDimension.filter(
      (a) => a.action === "retry-with-critique" || a.action === "replace-spec",
    );
    let cappedNote: string | null = null;
    if (retryActions.length > MAX_PATCHES_PER_ROUND) {
      // 按 finding-count 升序 → 最弱的 dim 排在前面
      const findingCountByDimId = new Map<string, number>();
      for (const o of researcherOutcomes) {
        findingCountByDimId.set(o.dimensionId, o.findingsCount);
      }
      const ranked = [...retryActions].sort(
        (a, b) =>
          (findingCountByDimId.get(a.dimensionId) ?? 0) -
          (findingCountByDimId.get(b.dimensionId) ?? 0),
      );
      const keepIds = new Set(
        ranked.slice(0, MAX_PATCHES_PER_ROUND).map((a) => a.dimensionId),
      );
      let downgraded = 0;
      for (const a of m1Raw.perDimension) {
        if (
          (a.action === "retry-with-critique" || a.action === "replace-spec") &&
          !keepIds.has(a.dimensionId)
        ) {
          // Cast through unknown — perDimension.action 是 zod 联合类型，运行时降级到 accept-degraded 安全
          (a as unknown as { action: string }).action = "accept-degraded";
          downgraded++;
        }
      }
      cappedNote = `单轮 patch 上限=${MAX_PATCHES_PER_ROUND}；Leader 返回 ${retryActions.length} 个 retry，最弱 ${MAX_PATCHES_PER_ROUND} 个保留，其余 ${downgraded} 个降级 accept-degraded`;
      deps.log.warn(`[${missionId}] ${cappedNote}`);
    }
    const m1 = m1Raw;
    await deps
      .emit({
        type: "playground.leader:decision",
        missionId,
        userId,
        payload: {
          phase: "assess-research",
          decision: m1.decision,
          rationale: m1.rationale,
          perDimension: m1.perDimension,
          newDimensionsCount: m1.newDimensions.length,
          patchCap: cappedNote ?? undefined,
        },
      })
      .catch((err: unknown) => {
        deps.log.warn(
          `[${missionId}] emit leader:decision (assess-research) failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

    if (m1.decision === "abort") {
      // ★ 2026-05-30：用户面错误文案确定性本地化（匹配 mission 语言），不依赖 LLM
      //   rationale 的语言（英文 rationale 已随上方 leader:decision 事件持久化，
      //   「详情」可展开原始判词）。用结构化数据拼"哪些维度零来源 / 未达标"。
      const zh = ctx.input.language !== "en-US";
      const zeroSourceDims = researcherOutcomes.filter(
        (o) => o.state === "failed" || o.findingsCount === 0,
      );
      const belowMinDims = researcherOutcomes.filter(
        (o) =>
          o.state !== "failed" && o.findingsCount > 0 && !o.meetsMinSources,
      );
      const fmtNames = (list: typeof researcherOutcomes): string =>
        list
          .map((o) => (zh ? `「${o.dimensionName}」` : `"${o.dimensionName}"`))
          .join(zh ? "" : ", ");
      const parts: string[] = [];
      if (zeroSourceDims.length) {
        parts.push(
          zh
            ? `维度${fmtNames(zeroSourceDims)}零来源`
            : `dimensions ${fmtNames(zeroSourceDims)} returned zero sources`,
        );
      }
      if (belowMinDims.length) {
        parts.push(
          zh
            ? `另有 ${belowMinDims.length} 个维度未达到最低来源要求`
            : `${belowMinDims.length} other dimension(s) did not meet the minimum-sources requirement`,
        );
      }
      const body = parts.length
        ? parts.join(zh ? "；" : "; ")
        : zh
          ? "多个维度研究质量不达标"
          : "several dimensions fell short on research quality";
      throw new LeaderAbortError(
        zh
          ? `研究质量不达标，Leader 中止任务：${body}。请检查密钥额度 / 搜索可用性后重跑。`
          : `Research quality insufficient — Leader aborted the mission: ${body}. Please check API key quota / search availability, then rerun.`,
      );
    }
    // 把 patch/redirect 决策落到 researcher 重派
    if (m1.decision === "patch" || m1.decision === "redirect") {
      const stats = await dispatchAssessActions({
        ctx,
        deps,
        m1,
      });
      deps.log.log(
        `[${missionId}] Leader assess dispatch=${m1.decision}: retried=${stats.retried} aborted=${stats.aborted} appended=${stats.appended} skipped=${stats.skipped}`,
      );
      await deps
        .emit({
          type: "playground.leader:decision",
          missionId,
          userId,
          payload: {
            phase: "assess-research-dispatched",
            decision: m1.decision,
            stats,
          },
        })
        .catch((err: unknown) => {
          deps.log.warn(
            `[${missionId}] emit leader:decision (assess-research-dispatched) failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    }
  } catch (err) {
    // Leader 主动 abort → rethrow 终止 mission（用 instanceof 而非 message 前缀，
    // 文案本地化后前缀匹配会失效，详见 LeaderAbortError 注释）。
    if (err instanceof LeaderAbortError) {
      throw err;
    }
    // ★ 2026-05-06 (A-6): swallow 改成 markStageDegraded — 前端 narrative 可见
    const message = err instanceof Error ? err.message : String(err);
    deps.log.warn(
      `[${missionId}] M1 assess-research failed (non-fatal, mission proceeds): ${message}`,
    );
    await deps.markStageDegraded(
      missionId,
      userId,
      "s4-leader-assess",
      `Leader 评审失败但 mission 继续：${message.slice(0, 200)}`,
    );
    // legacy 兼容：原 stage:completed status='failed' 仍 emit 让现有 metrics 链路读到
  }
}

// ── helpers ──

async function dispatchAssessActions(args: {
  ctx: MissionContext;
  deps: MissionDeps;
  m1: {
    decision: "accept-all" | "patch" | "redirect" | "abort";
    perDimension: {
      dimensionId: string;
      action:
        | "accept"
        | "accept-degraded"
        | "retry-with-critique"
        | "replace-spec"
        | "abort";
      critique?: string;
      newAgentSpecId?: string;
    }[];
    newDimensions: PlanDimensionLite[];
  };
}): Promise<{
  retried: number;
  aborted: number;
  appended: number;
  skipped: number;
}> {
  const { ctx, deps, m1 } = args;
  const { missionId, userId, budgetMultiplier } = ctx;
  const plan = ctx.plan!;
  const researcherResults = ctx.researcherResults!;

  let retried = 0;
  let aborted = 0;
  let appended = 0;
  let skipped = 0;

  // ── per-dim actions ──
  // ★ 2026-04-30 REDESIGN (task #61): 双路径 retry job
  //   strategy='fresh-collect' (默认) → 重新跑 researcher + chapter pipeline，独立 retryLabel pipeline
  //   strategy='reuse-recompute' → 不跑 researcher，复用 findings，只重跑 chapter pipeline + grade，
  //                                就地更新原 dim pipeline.grade，不新增 todo（前端原 dim todo 退回 in_progress）
  // 先处理同步动作（accept / abort / 找不到 dim），收集需要 retry/replace 的 action
  type RetryJob = {
    idx: number;
    dim: { id: string; name: string; rationale: string };
    critique: string;
    retryLabel: string;
    reason: "leader-assess-retry" | "leader-assess-replace";
    strategy: "fresh-collect" | "reuse-recompute";
  };
  const retryJobs: RetryJob[] = [];
  for (const action of m1.perDimension) {
    const idx = plan.dimensions.findIndex((d) => d.id === action.dimensionId);
    if (idx < 0) {
      deps.log.warn(
        `[${missionId}] M1 dispatch: dim id "${action.dimensionId}" not in plan, skipped`,
      );
      skipped++;
      continue;
    }
    const dim = plan.dimensions[idx];
    if (action.action === "accept" || action.action === "accept-degraded") {
      continue;
    }
    if (action.action === "abort") {
      researcherResults[idx] = {
        dimension: dim.name,
        findings: [],
        summary: `(aborted by Leader: ${action.critique?.slice(0, 200) ?? "abandoned"})`,
      };
      aborted++;
      await deps
        .emit({
          type: "playground.dimension:retrying",
          missionId,
          userId,
          agentId: `researcher#${idx}`,
          payload: {
            dimension: dim.name,
            reason: "leader-assess-abort",
            critique: action.critique,
          },
        })
        .catch((err: unknown) => {
          deps.log.warn(
            `[${missionId}] emit dimension:retrying (leader-assess-abort) for "${dim.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      continue;
    }
    const critique =
      action.action === "replace-spec"
        ? `[Leader 在评审阶段要求换 spec → 当前只注册了 ResearcherAgent，请用更激进的搜索策略] ${action.critique ?? ""} ${action.newAgentSpecId ? `(原意换为 ${action.newAgentSpecId})` : ""}`.trim()
        : (action.critique ??
          "Leader 在评审阶段要求重做该维度，请提升覆盖率与来源质量");
    // strategy 默认 fresh-collect（兼容旧路径），LLM 显式 reuse-recompute 才走利旧重算
    const strategy: "fresh-collect" | "reuse-recompute" =
      (action as { strategy?: "fresh-collect" | "reuse-recompute" }).strategy ??
      "fresh-collect";
    retryJobs.push({
      idx,
      dim,
      critique,
      retryLabel: `leader-assess-${action.action === "replace-spec" ? "replace" : "retry"}`,
      reason:
        action.action === "replace-spec"
          ? "leader-assess-replace"
          : "leader-assess-retry",
      strategy,
    });
  }

  // ★ BUG-F 修复：retry 改并行 dispatch（之前 for-of await 串行，dim-2 要等 dim-1
  //   跑完才起跑；上限已被 Iter 1b 卡到 2 个，并行不会爆预算）。
  //   独立 budget multiplier 让每个 Researcher 跑自己的预算空间。
  if (retryJobs.length > 0) {
    // 先一次性 emit 所有 retry 事件让前端立即看到
    for (const job of retryJobs) {
      await deps
        .emit({
          type: "playground.dimension:retrying",
          missionId,
          userId,
          agentId: `researcher#${job.idx}`,
          payload: {
            dimension: job.dim.name,
            reason: job.reason,
            critique: job.critique,
            bumpedBudgetMultiplier: budgetMultiplier * 1.3,
            // ★ 2026-04-30 REDESIGN (task #61): strategy + retryLabel 让前端区分两路径
            strategy: job.strategy,
            retryLabel: job.retryLabel,
          },
        })
        .catch((err: unknown) => {
          deps.log.warn(
            `[${missionId}] emit dimension:retrying (pre-batch) for "${job.dim.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    }
    // ★ Phase P1 fix (2026-04-29 mission 8c7b4358)：retry phase 启动里程碑事件，
    //   让 UI / 监控立即看到 "M1 patch dispatching N dims, expected wall=Xs"
    //   原 case：18:05:53 leader:decision 后到 18:50:07 才有第一个 lifecycle:completed，
    //   中间 44 min UI 看不到任何 milestone，只有 cost:tick 在涨。
    const retryStartMs = Date.now();
    await deps
      .emit({
        type: "playground.dimension:retry-phase:started",
        missionId,
        userId,
        payload: {
          dimsRetrying: retryJobs.map((j) => ({
            idx: j.idx,
            dimension: j.dim.name,
            reason: j.reason,
          })),
          bumpedBudgetMultiplier: budgetMultiplier * 1.3,
          startMs: retryStartMs,
        },
      })
      .catch((err: unknown) => {
        deps.log.warn(
          `[${missionId}] emit dimension:retry-phase:started failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    // ★ Phase 7 (2026-04-29): 用 ai-harness 沉淀的 DAGExecutor 替代 Promise.allSettled
    // 优势：① 内置 maxConcurrent 限流防 reasoning 模型 rate limit
    //       ② 单 job 失败不污染整批（同 allSettled），但更显式
    //       ③ 死锁 / 取消感知预留扩展点
    type RetryDAGTask = {
      id: string;
      idx: number;
      dim: { id: string; name: string; rationale: string };
      critique: string;
      retryLabel: string;
    };
    const dagTasks: RetryDAGTask[] = retryJobs.map((j) => ({
      id: `dim-${j.idx}`,
      idx: j.idx,
      dim: j.dim,
      critique: j.critique,
      retryLabel: j.retryLabel,
    }));
    const results: (Awaited<
      ReturnType<typeof runResearcherWithCritique>
    > | null)[] = new Array(retryJobs.length).fill(null);
    // ★ P0-LIVE-MISSION-DONE-LEFTOVER (2026-04-30): 记录每个 retry job 的失败
    //   原因，让后续 emit dimension:retry-failed 携带 reason 给 ledger 收尾。
    const errors: (string | null)[] = new Array(retryJobs.length).fill(null);
    let dispatched = false;
    const adapter: DAGAdapter<RetryDAGTask> = {
      fetchExecutable: async () =>
        dispatched ? [] : ((dispatched = true), dagTasks),
      executor: async (task) => {
        try {
          // ★ 2026-04-30 REDESIGN (task #61): reuse-recompute 路径不重跑 researcher
          //   直接复用 researcherResults[idx]（旧 findings），下面 chapter pipeline 重跑 + grade
          const slot = retryJobs.findIndex((j) => j.idx === task.idx);
          if (slot < 0) return;
          const job = retryJobs[slot];
          if (job.strategy === "reuse-recompute") {
            const existing = researcherResults[job.idx];
            if (existing) {
              results[slot] = {
                dimension: existing.dimension,
                findings: existing.findings,
                summary:
                  `${existing.summary ?? ""}\n[reuse-recompute] Leader 要求重写章节 + 重新评分（沿用原 findings）：${task.critique.slice(0, 200)}`.trim(),
              };
              return;
            }
            // 没有 existing → fallback to fresh-collect
          }
          const out = await runResearcherWithCritique(ctx, deps, {
            dim: task.dim,
            idx: task.idx,
            budgetMultiplier: budgetMultiplier * 1.3,
            critique: task.critique,
            retryLabel: task.retryLabel,
          });
          if (slot >= 0) results[slot] = out;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          deps.log.warn(
            `[${missionId}] retry DAG task ${task.id} threw: ${msg}`,
          );
          const slot = retryJobs.findIndex((j) => j.idx === task.idx);
          if (slot >= 0) errors[slot] = msg.slice(0, 300);
        }
      },
      countPending: async () => 0, // 一次性调度后无 pending
      // ★ P1-R5-C (2026-04-30): 之前只看 pool 是否耗尽 → 用户主动取消时 abort
      //   signal 触发但 pool 未耗尽 → DAG 继续跑 retry 5-10min 烧 credits。
      //   补一路 signal.aborted；isCancelled 任一 true 即停。
      isCancelled: async () =>
        (ctx.pool.isExhausted?.() ?? false) ||
        (deps.abortRegistry?.isAborted(missionId) ?? false),
    };
    const dagExec = new DAGExecutor();
    // maxConcurrent=2 与 MAX_PATCHES_PER_ROUND 对齐, 防止 reasoning 模型 rate limit
    await dagExec.run(adapter, {
      maxConcurrent: 2,
      pollIntervalMs: 100,
      postTaskDelayMs: 0,
      maxConsecutiveWaits: 5,
    });
    for (let i = 0; i < retryJobs.length; i++) {
      const job = retryJobs[i];
      const newOut = results[i];
      if (newOut) {
        // ★ 2026-04-30 fix (#36/#37 retry todo 借用第一次 grade)：
        //   之前 retry researcher 跑完只覆盖 researcherResults[idx]，但 chapters /
        //   fullMarkdown / grade 都是首次 S3 per-dim chapter pipeline 出的 stale 值。
        //   下游 S8 writer 装配 reportArtifact 用的还是老 grade，前端 retry todo
        //   绑定该 dim 显示的 grade 跟第一次一模一样（用户截图的"评审重派 80/80
        //   两次评分一样"假象）。修复：retry 成功后重跑 runPerDimPipeline 拿新
        //   chapter pipeline 产物（含新 5-axis grade），整体覆盖 researcherResults[idx]。
        const skipChapterPipeline =
          ctx.input.auditLayers === "minimal" || ctx.input.depth === "quick";
        if (skipChapterPipeline) {
          researcherResults[job.idx] = newOut;
        } else {
          try {
            // ★ 2026-04-30 REDESIGN (task #61): retryLabel 让 dimension:graded 携带；
            //   reuse-recompute 路径 retryLabel=undefined → 就地更新原 dim pipeline.grade
            //   fresh-collect 路径 retryLabel=job.retryLabel → 独立 pipeline 索引
            const pipelineRetryLabel =
              job.strategy === "fresh-collect" ? job.retryLabel : undefined;
            const dimPipelineOut = await runPerDimPipeline(
              {
                missionId,
                userId: ctx.userId,
                dimensionIdx: job.idx,
                dimensionName: job.dim.name,
                topic: ctx.input.topic,
                language: ctx.input.language,
                depth: ctx.input.depth,
                lengthProfile: ctx.input.lengthProfile,
                dimensionCount: ctx.plan?.dimensions.length,
                pool: ctx.pool,
                researcherOut: newOut,
                billing: ctx.billing,
                budgetMultiplier: ctx.budgetMultiplier * 1.3,
                retryLabel: pipelineRetryLabel,
              },
              deps,
            );
            researcherResults[job.idx] = dimPipelineOut;
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            deps.log.warn(
              `[s4-retry-pipeline ${job.idx}] re-run chapter pipeline failed for "${job.dim.name}": ${errMsg}; falling back to researcher output only`,
            );
            researcherResults[job.idx] = newOut;
          }
        }
        retried++;
      } else {
        skipped++;
        const errMsg = errors[i] ?? "retry produced no output (silent skip)";
        // ★ P0-LIVE-PATCH-SILENT (2026-04-30): retry 失败必须三处可见
        //   (1) emit dimension:retry-failed — 让 ledger 闭环 retry todo 状态
        //   (2) push 到 ctx.s4PatchFailures — 让 S10 leader signoff 看到这是
        //       Leader 自己说"必须 patch"但 patch 失败的硬伤，强制至少 quality-degraded
        //   (3) researcherResults[idx].summary 注 [degraded]，writer 至少能看到
        await deps
          .emit({
            type: "playground.dimension:retry-failed",
            missionId,
            userId,
            agentId: `researcher#${job.idx}`,
            payload: {
              dimension: job.dim.name,
              reason: job.reason,
              error: errMsg,
              retryLabel: job.retryLabel,
            },
          })
          .catch((err: unknown) => {
            deps.log.warn(
              `[${missionId}] emit dimension:retry-failed for "${job.dim.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
        ctx.s4PatchFailures = ctx.s4PatchFailures ?? [];
        ctx.s4PatchFailures.push({
          dimensionId: job.dim.id,
          dimensionName: job.dim.name,
          retryLabel: job.retryLabel,
          reason: job.reason,
          error: errMsg,
          occurredAt: Date.now(),
        });
        const existing = researcherResults[job.idx];
        if (existing) {
          researcherResults[job.idx] = {
            ...existing,
            summary:
              `${existing.summary ?? ""}\n\n[degraded] Leader 重派失败 (${errMsg})；本维度沿用首轮 findings`.trim(),
          };
        }
      }
    }
    // ★ 业务链修3 (2026-05-06): S4 retry 后 researcherResults 已被覆盖（line 282 abort
    //   / 465/492/498 retry / 614 extend），但首轮 saveResearchResult 不会再跑。
    //   在 retry 阶段尾部把所有 researcherResults 重新 saveResearchResult 一遍（upsert
    //   按 missionId+dim+retryLabel(null) 唯一，覆盖原 findings）。下次 rerun cache hit
    //   能拿到 retry 优化后的产物，与 trajectory 持久化一致。
    for (const r of researcherResults) {
      await deps.store
        ?.saveResearchResult?.({
          missionId,
          dimension: r.dimension,
          findings: r.findings,
          summary: r.summary,
          state: r.findings.length === 0 ? "failed" : "completed",
        })
        .catch((err: unknown) => {
          deps.log.warn(
            `[s4 ${missionId}] saveResearchResult for dim=${r.dimension} failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    }

    // ★ retry 阶段后做一次 mission-level 显式 emit, 让前端 / Leader signoff 看到
    if (skipped > 0) {
      await deps
        .emit({
          type: "playground.mission:degraded",
          missionId,
          userId,
          payload: {
            reason: "s4-patch-failed",
            patchFailures: ctx.s4PatchFailures ?? [],
            failedCount: skipped,
            retriedCount: retried,
          },
        })
        .catch((err: unknown) => {
          deps.log.warn(
            `[${missionId}] emit mission:degraded (s4-patch-failed) failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      deps.log.warn(
        `[${missionId}] S4 patch dispatch 失败 ${skipped}/${retryJobs.length}，` +
          `mission 进入 degraded 模式（Leader signoff 阶段会读 ctx.s4PatchFailures）`,
      );
    }
    // retry phase 完成里程碑（含每 dim 是否成功 + 总耗时）
    await deps
      .emit({
        type: "playground.dimension:retry-phase:completed",
        missionId,
        userId,
        payload: {
          retried,
          skipped,
          wallTimeMs: Date.now() - retryStartMs,
          perDim: retryJobs.map((j, i) => ({
            idx: j.idx,
            dimension: j.dim.name,
            success: !!results[i],
          })),
        },
      })
      .catch((err: unknown) => {
        deps.log.warn(
          `[${missionId}] emit dimension:retry-phase:completed failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }

  // ── newDimensions[] (redirect) ──
  for (const newDim of m1.newDimensions) {
    if (plan.dimensions.some((d) => d.id === newDim.id)) {
      deps.log.warn(
        `[${missionId}] M1 dispatch: newDimension id "${newDim.id}" conflicts with existing dim, skipped`,
      );
      skipped++;
      continue;
    }
    plan.dimensions.push(newDim);
    const idx = plan.dimensions.length - 1;
    await deps
      .emit({
        type: "playground.dimension:retrying",
        missionId,
        userId,
        agentId: `researcher#${idx}`,
        payload: {
          dimension: newDim.name,
          reason: "leader-assess-extend",
          rationale: newDim.rationale,
        },
      })
      .catch((err: unknown) => {
        deps.log.warn(
          `[${missionId}] emit dimension:retrying (leader-assess-extend) for "${newDim.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    const out = await runResearcherWithCritique(ctx, deps, {
      dim: newDim,
      idx,
      budgetMultiplier,
      critique: `Leader 在评审阶段追加了这个维度（rationale: ${newDim.rationale.slice(0, 150)}）`,
      retryLabel: "lead-m1-extend",
    });
    researcherResults.push(
      out ?? {
        dimension: newDim.name,
        findings: [],
        summary: "(failed: lead-m1-extend dispatch produced no output)",
      },
    );
    if (out) appended++;
    else skipped++;
  }

  return { retried, aborted, appended, skipped };
}

async function runResearcherWithCritique(
  ctx: MissionContext,
  deps: MissionDeps,
  args: {
    dim: PlanDimensionLite;
    idx: number;
    budgetMultiplier: number;
    critique: string;
    retryLabel: string;
  },
): Promise<{
  dimension: string;
  findings: { claim: string; evidence: string; source: string }[];
  summary: string;
} | null> {
  const { dim, idx, budgetMultiplier, critique, retryLabel } = args;
  const { missionId, userId, input, billing, pool } = ctx;
  const agentId = `researcher#${idx}.${retryLabel}`;
  await deps.lifecycle(missionId, userId, agentId, "researcher", "started", {
    dimension: dim.name,
    retryLabel,
  });
  const r = await deps.invoker.invoke(
    ResearcherAgent,
    {
      topic: input.topic,
      dimension: dim.name,
      language: input.language,
      critique,
    },
    {
      missionId,
      userId,
      agentId,
      role: "researcher",
      envAdapter: billing,
      budgetMultiplier,
      toolRecallHint: dim.toolHint
        ? {
            categories: dim.toolHint.categories,
            preferIds: dim.toolHint.preferIds,
          }
        : undefined,
    },
  );
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
    r.state === "completed" ? "completed" : "failed",
    {
      wallTimeMs: r.wallTimeMs,
      iterations: r.iterations,
      dimension: dim.name,
      retryLabel,
      ...agentUsageDetail(r),
      error: extractFailureMessage(r.events, r.state, !!r.output, {
        iterations: r.iterations,
        wallTimeMs: r.wallTimeMs,
      }),
    },
  );
  if (r.state !== "completed" || !r.output) return null;
  const output = r.output as {
    dimension: string;
    findings: { claim: string; evidence: string; source: string }[];
    summary: string;
  };
  // ★ 2026-04-30 fix (#36 retry researcher 不发 researcher:completed)：
  //   原本只 emit lifecycle，前端 todo-ledger 只看 researcher:completed 事件
  //   判断 retry 真实完成。漏 emit 导致 retry todo 借用 dim 第一次 grade，
  //   两次评分一模一样的假象。这里补 emit。
  await deps
    .emit({
      type: "playground.researcher:completed",
      missionId,
      userId,
      agentId,
      payload: {
        dimension: dim.name,
        state: "completed",
        iterations: r.iterations,
        wallTimeMs: r.wallTimeMs,
        summary: output.summary,
        findingsCount: output.findings?.length ?? 0,
        retryLabel,
      },
    })
    .catch((err: unknown) => {
      deps.log.warn(
        `[${missionId}] emit researcher:completed (retry) for "${dim.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  return output;
}

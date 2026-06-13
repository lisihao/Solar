/**
 * Stage S6 — Analyst: 跨 dim 综合分析
 *
 * 把 reconciler 对完账的 factTable + 各 dim 的 findings 综合成 mission-level 视角：
 * insights（跨 dim 综合判断 ≥ 2 dim 支持）/ contradictions（处理跨源冲突的判断）/
 * themeSummary（贯穿主题的总论点）。Writer 起草时直接消费这些 insights，不再读 raw findings。
 *
 *   reads  ctx: plan, researcherResults, reconciliationReport
 *   writes ctx: analystOutput = { insights[], themeSummary, contradictions? }
 *   deps:       analyst.analyze, invoker (preDisable + tickCost),
 *               missionState (compressIfNeeded), emit, lifecycle
 *
 * Failure modes: analystRes.state !== completed → 降级发空 analystOutput 让 mission 跑完
 *                （含 provider 层失败，2026-06-02 起不再硬终止），下游 Writer 直接基于
 *                raw findings 撰写，质量打折但不全废。
 */

import type {
  MissionInvariants,
  PlanPhaseCtx,
  ResearchPhaseCtx,
  SynthesisPhaseCtx,
} from "../../context/mission-context";
import type { MissionDeps } from "../../context/mission-deps";
import { extractTokenSpend } from "@/modules/ai-harness/facade";
import {
  extractAgentFailureDiagnostic,
  extractFailureMessage,
} from "@/modules/ai-harness/facade";
import { narrate } from "../../artifacts/narrative.util";
import { agentUsageFromEvents } from "../helpers/agent-usage.util";

/**
 * Provider 层失败码：发送给同一 provider 的下游调用必然也会失败，
 * 此时 analyst 兜底空 output 没意义，反而是 lying success（[[feedback_no_lying_assertion]]）。
 * 应该 fail-loud，让 mission 进入 failed 状态、用户能立即看到真实根因（如 API key 失效）。
 */
const PROVIDER_LEVEL_FAILURE_CODES = new Set<string>([
  "PROVIDER_API_ERROR",
  "PROVIDER_RATE_LIMIT",
  "PROVIDER_QUOTA_EXCEEDED",
  "PROVIDER_SAFETY_REFUSAL",
  "PROVIDER_BYOK_MODEL_NOT_FOUND",
]);

export interface AnalystOutputShape {
  insights: {
    headline: string;
    narrative: string;
    supportingDimensions: string[];
    confidence: number;
  }[];
  themeSummary: string;
  contradictions?: {
    claim: string;
    conflictingSources: string[];
    resolution: string;
  }[];
  // ★ PR-quickview-parity (2026-05-09): 结构化 quickView 字段（与 analyst.agent.ts Output 一致）。
  preface?: string;
  crossDimAnalysis?: string;
  riskAssessment?: string;
  strategicRecommendations?: string;
  conclusion?: string;
  keyFindingsByDimension?: {
    dimensionName: string;
    findings: {
      finding: string;
      // ★ 2026-05-27 (#108): analyst LLM 输出可选 body 解释段。
      body?: string;
      significance: "high" | "medium" | "low";
    }[];
  }[];
  trendsByDimension?: {
    dimensionName: string;
    trends: {
      trend: string;
      direction: "increasing" | "decreasing" | "stable" | "emerging";
      timeframe: string;
    }[];
  }[];
  riskMatrix?: {
    riskType: string;
    probability: "高" | "中" | "低";
    impact: "高" | "中" | "低";
    timeframe: string;
  }[];
  recommendationsByAudience?: {
    forEnterprise?: { shortTerm: string[]; midTerm: string[] };
    forInvestors?: { shortTerm: string[]; midTerm: string[] };
  };
  whatYouWillLearn?: string[];
  // ★ Foresight (2026-05-29 前瞻洞察 L1)：Outlook 章节 + 未来推演卡片的来源。
  foresight?: {
    baseCase: {
      judgment: string;
      probability: number;
      confidence: "low" | "moderate" | "high";
      horizon: "0-6m" | "6-18m" | "18m-3y" | "3y+";
      resolutionCriteria: string;
      baseRate?: string;
      evidenceIds: string[];
    }[];
    scenarios: {
      kind: "bull" | "base" | "bear";
      narrative: string;
      trigger: string;
      probability: number;
    }[];
    predeterminedElements: string[];
    criticalUncertainties: string[];
    leadingIndicators: { signal: string; watchFor: string }[];
  };
}

export async function runAnalystStage(
  ctx: MissionInvariants & PlanPhaseCtx & ResearchPhaseCtx & SynthesisPhaseCtx,
  deps: MissionDeps,
): Promise<AnalystOutputShape> {
  const {
    missionId,
    userId,
    input,
    billing,
    pool,
    budgetMultiplier,
    researcherResults,
    reconciliationReport,
  } = ctx;
  // ★ 2026-05-22 契约对齐：analyst.agent inputSchema 要求 researcherResults.min(1)，
  //   故空数组也不合法（旧守护只查 null → 空数组会穿到 agent 触发 schema 校验失败）。
  if (!researcherResults?.length) {
    throw new Error("Analyst stage requires researcherResults to be populated");
  }

  await deps.lifecycle(missionId, userId, "analyst", "analyst", "started");
  await narrate(deps.emit, missionId, userId, {
    stage: "s6-analyst",
    role: "analyst",
    tag: "analyzing",
    text: "Analyst 开始整合所有维度的发现，提炼跨维度核心洞察",
    agentId: "analyst",
  });

  // ★ Phase P1-10: Summarize-on-Handoff（baseline §9.1）
  const analystResearcherInput = deps.missionState.compressIfNeeded(
    researcherResults,
    "analyst.researcherResults",
  );
  // ★ Phase P3-2: 跨 mission 失败模式预查
  await deps.invoker.preDisableKnownFailingModels(
    billing,
    "playground.analyst",
    `${input.topic}::analyst::${input.language}`,
  );
  // ★ Phase Lead-Services: AnalystService.analyze()
  // 双轮防 null：第一次 LLM 返回 null（schema mismatch）时，自动降级提示再跑一次
  // 才报错。避免前面 6 个 dim 的产出被一次 LLM 毛刺整个 mission 全废。
  let analystRes = await deps.analyst.analyze(
    {
      topic: input.topic,
      language: input.language,
      researcherResults: analystResearcherInput,
      reconciliationReport: reconciliationReport ?? undefined,
    },
    {
      missionId,
      userId,
      agentId: "analyst",
      role: "analyst",
      envAdapter: billing,
      budgetMultiplier,
      loopOverride: deps.invoker.resolveLoopOverride(
        input.auditLayers,
        "analyst",
      ),
    },
  );
  await deps.invoker.tickCost(
    missionId,
    userId,
    "analyst",
    pool,
    extractTokenSpend(analystRes.events),
    analystRes.events,
  );

  // ★ 第一轮 null / 失败 → 简化提示重试一次（不放弃质量，只是给 LLM 一次机会修正格式）
  //   degraded 也算"有产出"（reflexion verifier 评分略低于阈值但结构合法）→ 不重试。
  //   只有真正的 failed/cancelled 或空 output 才走重试。
  const firstRoundUsable =
    (analystRes.state === "completed" || analystRes.state === "degraded") &&
    !!analystRes.output;
  if (!firstRoundUsable) {
    deps.log.warn(
      `[${missionId}] analyst first attempt returned no output (state=${analystRes.state}) — retrying once with simplified prompt`,
    );
    await narrate(deps.emit, missionId, userId, {
      stage: "s6-analyst",
      role: "analyst",
      tag: "warning",
      text: "Analyst 首轮无有效输出，简化提示后重试 1 次（避免单次 LLM 格式问题导致全 mission 失败）",
      agentId: "analyst",
    });
    analystRes = await deps.analyst.analyze(
      {
        topic: input.topic,
        language: input.language,
        researcherResults: analystResearcherInput,
        reconciliationReport: reconciliationReport ?? undefined,
        retryHint:
          "上一次输出为 null 或格式错误。请严格按 outputSchema 返回 { insights[], themeSummary }；contradictions 可以省略。每个 insight 至少 2 个 supportingDimensions。",
      },
      {
        missionId,
        userId,
        agentId: "analyst.retry",
        role: "analyst",
        envAdapter: billing,
        budgetMultiplier,
        loopOverride: deps.invoker.resolveLoopOverride(
          input.auditLayers,
          "analyst",
        ),
      },
    );
    await deps.invoker.tickCost(
      missionId,
      userId,
      "analyst",
      pool,
      extractTokenSpend(analystRes.events),
      analystRes.events,
    );
  }

  const analystFailMsg = extractFailureMessage(
    analystRes.events,
    analystRes.state,
    !!analystRes.output,
    {
      iterations: analystRes.iterations,
      wallTimeMs: analystRes.wallTimeMs,
    },
  );
  // ★ degraded（reflexion verifier 评分 < passThreshold 但结构合法）算成功
  const finalUsable =
    (analystRes.state === "completed" || analystRes.state === "degraded") &&
    !!analystRes.output;
  await deps.lifecycle(
    missionId,
    userId,
    "analyst",
    "analyst",
    finalUsable ? "completed" : "failed",
    {
      wallTimeMs: analystRes.wallTimeMs,
      iterations: analystRes.iterations,
      error: analystFailMsg,
      degraded: analystRes.state === "degraded" || undefined,
      ...agentUsageFromEvents(analystRes.events),
    },
  );
  if (!finalUsable) {
    // ★ P0-LIVE-NULL-OUTPUT (2026-04-30): gpt-5.4 reasoning model 在 analyst
    //   prompt 下两次都返 visible content = null（CoT 吃光 max_completion_tokens）,
    //   RUNNER_OUTPUT_SCHEMA_MISMATCH。之前直接 throw 让 mission 全死, 浪费已采集的
    //   6 维 researcher results + reconciler facts。改成发空 analystOutput 让下游
    //   writer / reviewer 至少能把已有 facts 渲成报告。
    // ★ 2026-05-13 (P1-FAIL-LOUD-PROVIDER) → 2026-06-02 修订：此前对 provider 层失败
    //   直接 throw 终止 mission（怕 lying success）。但 writer/reviewer 各有独立的跨模型
    //   failover，单 provider 故障未必拖垮下游，硬终止反而浪费已采集的多维 findings。
    //   现统一降级兜底，但对 provider 层失败用更醒目的 narrate fail-loud（见下分支），
    //   保留"用户能看到真实根因"的初衷，去掉"必然失败"的过强假设。
    const diagnostic = extractAgentFailureDiagnostic(analystRes.events);
    const failureCode = diagnostic?.failureCode;
    const isProviderLevel =
      !!failureCode && PROVIDER_LEVEL_FAILURE_CODES.has(failureCode);
    // ★ 2026-06-02 (single-provider 不硬终止): provider 层失败（如某把 BYOK key 偶发
    //   401/限流）此前直接 throw 让整个 mission failed。但下游 writer/reviewer 各自带
    //   跨 12 模型的 model-failover，单个 provider 故障未必拖垮下游；且配合凭证层修复
    //   （偶发 401 不再立即把 key 标 DEAD），provider 大概率已自愈。改为：降级发空
    //   analystOutput 让 mission 跑完，同时 fail-loud 把真实 provider 根因 narrate 给
    //   用户（非静默 lying success），报告里明确标注"analyst 因 provider 故障降级"。
    if (isProviderLevel) {
      deps.log.warn(
        `[${missionId}] analyst provider-level failure (${failureCode}); degrading to empty analystOutput instead of failing the mission — downstream writer/reviewer have independent model-failover and may still succeed (cause: ${diagnostic?.message ?? analystFailMsg ?? "unknown"})`,
      );
      await narrate(deps.emit, missionId, userId, {
        stage: "s6-analyst",
        role: "analyst",
        tag: "warning",
        text: `Analyst 调用因 provider 故障失败 (${failureCode}：${diagnostic?.message ?? analystFailMsg ?? "未知"})。已降级——下游 Writer 将用独立的模型 failover 基于 ${researcherResults.length} 维 raw findings 继续撰写，报告质量可能打折。`,
        agentId: "analyst",
      });
    } else {
      deps.log.warn(
        `[${missionId}] analyst 两次失败 (code=${failureCode ?? "UNKNOWN"})，发空 analystOutput 兜底让 mission 跑完（${analystFailMsg ?? analystRes.state}）`,
      );
      await narrate(deps.emit, missionId, userId, {
        stage: "s6-analyst",
        role: "analyst",
        tag: "warning",
        text: `Analyst 综合阶段连续 2 次未产出（code=${failureCode ?? "UNKNOWN"}）。发空 insights 兜底，下游 Writer 直接基于 ${researcherResults.length} 维度 raw findings 写报告（质量会打折）。`,
        agentId: "analyst",
      });
    }
    const fallback: AnalystOutputShape = {
      insights: [],
      themeSummary: `（analyst 阶段未产出有效综合分析；下游基于 ${researcherResults.length} 个维度的原始研究发现直接撰写报告）`,
      contradictions: [],
      // ★ PR-quickview-parity: 兜底空数组让 buildQuickView 走"卡片短路"，前端不渲染对应区块
      keyFindingsByDimension: [],
      trendsByDimension: [],
      riskMatrix: [],
      recommendationsByAudience: undefined,
      whatYouWillLearn: [],
      // ★ Foresight 兜底 undefined → Outlook 章节短路、未来推演卡片不渲染（无回归）
      foresight: undefined,
    };

    ctx.analystOutput = fallback;
    // ★ PR-R4 (2026-05-07): stage 主动持久化中间产物（analystOutput 落盘 mission 行）
    //   让 ctx-hydrator 在重跑时永远从 DB 读到最新中间状态，不依赖 S11。
    //   失败不阻塞主流程（markIntermediateState 内部 catch + log.warn）。
    // ★ 收尾评审第三轮 P0-S (2026-05-07): 传 userId 走严格隔离（depth defense）
    await deps.store.markIntermediateState(
      missionId,
      { analystOutput: fallback },
      userId,
    );
    return fallback;
  }
  const analyst = analystRes.output as AnalystOutputShape;

  await narrate(deps.emit, missionId, userId, {
    stage: "s6-analyst",
    role: "analyst",
    tag: "success",
    text: `Analyst 综合完成 · 提炼 ${analyst.insights.length} 条核心洞察${analyst.contradictions?.length ? ` · 标记 ${analyst.contradictions.length} 处冲突` : ""}`,
    agentId: "analyst",
  });
  // ★ 2026-05-29 快速视图拆调用：keyFindingsByDimension(含 body)/trends/riskMatrix
  //   等结构化字段原本和 6 个散文章节挤在 analyst 一次 long(≈8K) 调用里，排在尾部
  //   的 body 被 token 预算饿死 → 快速视图卡片只剩干瘪标题（连续视图正常因为它走
  //   Writer 链路）。这里用一次聚焦调用(extended+medium，body 必填)重产这 5 组字段，
  //   覆盖 analyst 内联的薄版本。失败兜底：保留 analyst 主调用字段，零回归。
  type QuickViewFields = Pick<
    AnalystOutputShape,
    | "keyFindingsByDimension"
    | "trendsByDimension"
    | "riskMatrix"
    | "recommendationsByAudience"
    | "whatYouWillLearn"
  >;
  try {
    // ★ M3 (2026-05-29 评审整改)：第二次 LLM 调用同样接 FailureLearner 预禁用，
    //   避免已知失败模型在 quickview 调用上空烧 token 后才降级。
    await deps.invoker.preDisableKnownFailingModels(
      billing,
      "playground.quick-view-synthesizer",
      `${input.topic}::quickview::${input.language}`,
    );
    const qvRes = await deps.analyst.synthesizeQuickView<
      unknown,
      QuickViewFields
    >(
      {
        topic: input.topic,
        language: input.language,
        researcherResults: analystResearcherInput,
        themeSummary: analyst.themeSummary,
        insights: analyst.insights,
      },
      {
        missionId,
        userId,
        agentId: "analyst.quickview",
        role: "analyst",
        envAdapter: billing,
        budgetMultiplier,
      },
    );
    await deps.invoker.tickCost(
      missionId,
      userId,
      "analyst",
      pool,
      extractTokenSpend(qvRes.events),
      qvRes.events,
    );
    const qv = qvRes.output;
    if ((qvRes.state === "completed" || qvRes.state === "degraded") && qv) {
      if (qv.keyFindingsByDimension?.length)
        analyst.keyFindingsByDimension = qv.keyFindingsByDimension;
      if (qv.trendsByDimension?.length)
        analyst.trendsByDimension = qv.trendsByDimension;
      if (qv.riskMatrix?.length) analyst.riskMatrix = qv.riskMatrix;
      if (qv.recommendationsByAudience)
        analyst.recommendationsByAudience = qv.recommendationsByAudience;
      if (qv.whatYouWillLearn?.length)
        analyst.whatYouWillLearn = qv.whatYouWillLearn;
      deps.log.log(
        `[${missionId}] quick-view synthesis merged (${qv.keyFindingsByDimension?.length ?? 0} dims with findings)`,
      );
    } else {
      deps.log.warn(
        `[${missionId}] quick-view synthesis returned no usable output (state=${qvRes.state}); keeping analyst inline fields`,
      );
    }
  } catch (e) {
    deps.log.warn(
      `[${missionId}] quick-view synthesis failed, keeping analyst inline fields: ${(e as Error).message}`,
    );
  }

  ctx.analystOutput = analyst;
  // ★ PR-R4 (2026-05-07): stage 主动持久化 — 写 analystOutput
  // ★ 收尾评审第三轮 P0-S (2026-05-07): 传 userId 走严格隔离
  await deps.store.markIntermediateState(
    missionId,
    { analystOutput: analyst },
    userId,
  );
  return analyst;
}

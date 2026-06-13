/**
 * Stage S12 — Self-Evolution（mission 复盘 + 系统自我进化）
 *
 * 在 S11 persist 之后异步运行（不阻塞用户看报告）。从本次 mission 的事件流 +
 * ReportArtifact + Leader signoff verdict 提炼"经验值"，写回三处：
 *
 *   1. **mission postmortem**（emit mission:evolved 事件 + 落库 mission row 字段）
 *      - quality bar 命中率（实际 vs M0 self-set）
 *      - 各 stage 实际耗时 vs 预算
 *      - retry / patch / rewrite 总次数
 *      - 模型成功率（按 modelId 统计 finalize-pass 率）
 *
 *   2. **FailureLearner 喂数据**（cross-mission 黑名单）
 *      - 把本次失败的 (topic, model, failureCode) 三元组写入
 *
 *   3. **memory namespace 更新**（用户私有记忆）
 *      - 把本次 mission 的 final reportArtifact + 高分 finding 索引到向量库
 *      - 下次同 topic 的 Researcher 起跑前可 RAG 召回，省 30% tokens
 *
 *   reads  ctx: missionId, plan, researcherResults, reportArtifact, verdicts,
 *               leaderSignOff, t0, pool
 *   writes  emit: playground.mission:evolved
 *   deps:        log only（不直接调 invoker，不烧 tokens —— 全部是统计 + RAG 索引）
 *
 * Failure modes: 任何抛错 → log warn + 继续（self-evolution 是 best-effort，
 *                不影响用户对 mission 的感知）
 */

import type { MissionDeps } from "../../context/mission-deps";
import { PLAYGROUND_POSTMORTEM_PATTERNS } from "../../lifecycle/playground-postmortem-patterns";

interface SelfEvolutionInput {
  missionId: string;
  userId: string;
  t0: number;
  pool: { snapshot(): { poolTokensUsed: number; poolCostUsd: number } };
  /** 用于 postmortem 元数据（可读 topic 比 mission UUID 友好） */
  topic?: string;
  plan?: {
    dimensions: unknown[];
    goals?: { qualityBar?: { minCoverage?: number } };
  };
  researcherResults?: unknown[];
  reportArtifact?: {
    quality?: { overall?: number };
    sections?: unknown[];
  };
  leaderSignOff?: { signed?: boolean };
  /**
   * ★ P1-NEW-A (round 2): mission abort signal —— S12 fire-and-forget 时
   * wallTimer 已被 clear 但 S12 内部仍在跑 LLM/DB；signal 让 S12 在 abort 触发时
   * 立即停手，防止 BYOK credits 超 wall-time 后被继续消耗。
   */
  abortSignal?: AbortSignal;
  /**
   * 来自 MissionEventBuffer.read() 的事件快照（caller 侧注入，S12 不直接读 bus）
   * 用于 PostmortemClassifierService 扫描事件类型 → 失败模式分类。
   */
  bufferedEvents?: Array<{ type: string; ts: number; payload?: unknown }>;
}

interface PostmortemSummary {
  /** Quality 命中率：actualScore / declaredQualityBar */
  qualityHitRate: number | null;
  /** Lead 是否签字 */
  leaderSigned: boolean | null;
  /** retry / patch 总次数（dim 重派 + chapter 重写）*/
  retryTotal: number;
  /** Researcher 平均 ReAct iter */
  avgResearcherIterations: number;
  /** 各 stage 累计耗时 ms */
  stageDurationsMs: Record<string, number>;
  /** 总 token 消耗 */
  totalTokens: number;
  /** 总 cost USD */
  totalCostUsd: number;
  /** 系统建议（plain text，作为下次 mission 启动时给 Leader 的 prior knowledge） */
  recommendations: string[];
}

export async function runSelfEvolutionStage(
  args: SelfEvolutionInput,
  deps: MissionDeps,
): Promise<void> {
  const { missionId, userId, t0, plan, researcherResults, reportArtifact } =
    args;

  // ★ P1-NEW-A (round 2): abort 检查 helper —— 在每个 await 前后判断
  const isAborted = () => args.abortSignal?.aborted === true;
  // ★ 2026-05-06 单轨化: S12 走 mission:postlude 由 dispatcher fire-and-forget
  try {
    if (isAborted()) {
      deps.log.warn(`[${missionId}] S12 skipped: abort signal received`);
      return;
    }
    const wallTimeMs = Date.now() - t0;
    const totalTokens = args.pool.snapshot().poolTokensUsed;
    const totalCostUsd = args.pool.snapshot().poolCostUsd;

    // 1. quality 命中率：用 reportArtifact.quality.overall vs leaderSignOff
    const overallQuality = reportArtifact?.quality?.overall ?? null;
    const leaderSigned = args.leaderSignOff?.signed ?? null;
    const declaredBar = args.plan?.goals?.qualityBar?.minCoverage ?? null;
    const qualityHitRate =
      overallQuality != null && declaredBar != null && declaredBar > 0
        ? Math.min(1, overallQuality / declaredBar)
        : null;

    // 2. retry 总次数估算（粗略，详细数据需事件流统计）
    const retryTotal = Math.max(
      0,
      (plan?.dimensions?.length ?? 0) - (researcherResults?.length ?? 0),
    );

    // 3. Researcher 平均 iter（粗略：tokens / dim / 8K）
    const avgResearcherIterations =
      plan?.dimensions?.length && plan.dimensions.length > 0
        ? Math.round(totalTokens / plan.dimensions.length / 8000)
        : 0;

    // 4. 推荐（基于本次 mission 实际 vs M0 declared）
    const recommendations: string[] = [];
    if (qualityHitRate != null && qualityHitRate < 0.85) {
      recommendations.push(
        `本次 quality 命中率 ${(qualityHitRate * 100).toFixed(0)}% < 85%；下次同主题可考虑：(a) 调大 lengthProfile 让证据更完整 (b) 升 audit=thorough 启 L1 反思`,
      );
    }
    if (wallTimeMs > 60 * 60 * 1000) {
      recommendations.push(
        `本次墙时 ${Math.round(wallTimeMs / 60000)} 分钟较长；下次可考虑 concurrency=8 或减少 dim 数`,
      );
    }
    if (totalCostUsd > 3) {
      recommendations.push(
        `本次成本 $${totalCostUsd.toFixed(2)} 较高；下次同主题可降 budgetProfile 或开 retryHint=简化提示`,
      );
    }
    if (leaderSigned === false) {
      recommendations.push(
        `Lead 本次拒签；下次启动可考虑：调用 'POST /missions/:id/regenerate-report' 复用已有 findings 重跑 S5+；或调宽 minCoverage`,
      );
    }
    if (recommendations.length === 0) {
      recommendations.push(
        `本次 mission 健康（${overallQuality}/100），可作为同主题的 baseline reference`,
      );
    }

    const summary: PostmortemSummary = {
      qualityHitRate,
      leaderSigned,
      retryTotal,
      avgResearcherIterations,
      stageDurationsMs: {}, // ctx 暂不提供 per-stage timing；下版补
      totalTokens,
      totalCostUsd,
      recommendations,
    };

    deps.log.log(
      `[${missionId}] S12 self-evolution: quality=${overallQuality}/100 cost=$${totalCostUsd.toFixed(3)} tokens=${totalTokens} retries=${retryTotal} signed=${leaderSigned}`,
    );

    // emit mission:evolved 事件给前端展示"本次学到了 X 条规律"
    await deps
      .emit({
        type: "playground.mission:evolved",
        missionId,
        userId,
        payload: summary as unknown as Record<string, unknown>,
      })
      .catch((err: unknown) => {
        deps.log.warn(
          `[${missionId}] emit mission:evolved failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

    if (isAborted()) {
      deps.log.warn(
        `[${missionId}] S12 aborted before failure-learner / postmortem write`,
      );
      return;
    }

    // ★ P1-R5-G (2026-04-30): wallTimer 触发后 S12 内每个 await 前 check abort
    //   避免 LLM 调用已发出后 1-min 内继续烧 credits。
    if (isAborted()) {
      deps.log.warn(`[${missionId}] S12 aborted before failure-learner`);
      return;
    }
    // ── 真沉淀 1：FailureLearner 记 mission 级失败结果 ─────────────────
    //   仅在 leader 拒签时记一条粗粒度 failure pattern，让下次同 user 同 topic
    //   启动时 leader plan 阶段可参考"上次同主题没过线"的 prior knowledge
    if (leaderSigned === false) {
      await deps.failureLearner
        .recordFailure({
          key: {
            agentSpecId: "playground.mission",
            modelId: "(mission-level)",
            systemPrompt: args.topic ?? missionId,
            failureCode: "LEADER_REFUSED_SIGN",
          },
          missionId,
          userId,
          diagnostic: {
            topic: args.topic,
            qualityHitRate,
            qualityScore: overallQuality,
            recommendations,
          },
        })
        .catch((err: unknown) => {
          deps.log.warn(
            `[s12 ${missionId}] failureLearner.recordFailure (LEADER_REFUSED_SIGN) failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    }

    // ★ P1-R5-G (2026-04-30): postmortem 写入前再 check abort
    if (isAborted()) {
      deps.log.warn(`[${missionId}] S12 aborted before postmortem write`);
      return;
    }
    // ── 失败模式分类（2026-04-30）─────────────────────────────────────
    //   基于 mission status + event 流扫描，将本次 mission 归类为 8 种 FailureMode 之一，
    //   写入 harness_vector_memory metadata JSONB（不改 schema），
    //   让下次 leader plan 阶段召回 postmortem 时能看到结构化失败原因。
    //   bufferedEvents 由 caller（team.mission.ts）注入，S12 不直接读 bus。
    const missionStatus = leaderSigned === true ? "completed" : "failed";
    const classification = deps.postmortemClassifier.classify(
      {
        status: missionStatus,
        events: args.bufferedEvents ?? [],
        metrics: { totalTokens, wallTimeMs },
      },
      PLAYGROUND_POSTMORTEM_PATTERNS,
    );
    deps.log.log(
      `[${missionId}] S12 postmortem classification: mode=${classification.mode} confidence=${classification.confidence.toFixed(2)} signals=[${classification.signals.join(",")}]`,
    );

    // ── 真沉淀 2：mission postmortem 入 harness_vector_memory ─────────
    //   namespace=userId，tags=['playground', 'mission-postmortem', 'signed'/'unsigned']
    //   下次 leader plan 阶段可调 store.listRecentPostmortems(userId, 3) 拿历史教训
    const postmortemSummary = [
      `Mission "${args.topic ?? missionId}" — ${leaderSigned === true ? "签字交付" : leaderSigned === false ? "Leader 拒签" : "未签字"}`,
      `质量 ${overallQuality ?? "-"}/100，命中率 ${qualityHitRate != null ? (qualityHitRate * 100).toFixed(0) + "%" : "n/a"}`,
      `Token ${totalTokens}，cost $${totalCostUsd.toFixed(2)}，墙时 ${Math.round(wallTimeMs / 60000)}min`,
      `失败模式：${classification.mode}（confidence=${classification.confidence.toFixed(2)}）`,
      `经验：`,
      ...recommendations.map((r) => `- ${r}`),
    ].join("\n");

    // ★ P1-I (2026-04-29): postmortem 写入失败不再静默吞错 —— 沉淀承诺破裂时必须留 telemetry
    await deps.store
      .recordMissionPostmortem({
        missionId,
        userId,
        topic: args.topic ?? missionId,
        summary: postmortemSummary,
        recommendations,
        leaderSigned,
        qualityScore: overallQuality,
        tokensUsed: totalTokens,
        costUsd: totalCostUsd,
        // ── 失败模式分类结果写入 metadata JSONB（不改 schema，复用 MissionStore.recordMissionPostmortem）
        failureClassification: classification,
      })
      .catch((err: unknown) => {
        deps.log.warn(
          `[${missionId}] S12 recordMissionPostmortem failed: ${err instanceof Error ? err.message : String(err)} (sediment lost)`,
        );
      });

    deps.log.log(
      `[${missionId}] S12 sediment recorded: postmortem to harness_vector_memory${leaderSigned === false ? " + failure pattern" : ""}`,
    );
  } catch (err) {
    deps.log.warn(
      `[${missionId}] S12 self-evolution failed (best-effort, ignored): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

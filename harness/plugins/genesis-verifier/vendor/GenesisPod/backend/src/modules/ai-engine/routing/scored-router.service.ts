/**
 * ScoredRouterService —— 项目唯一的语义打分路由 core
 *
 * 流程（务实 SOTA，无在线学习）：
 *   1. embed(goal) 拿 query 向量；不可用 → 降级 semanticApplied=false，relevance 全 0
 *   2. 并行 embed 候选描述（命中缓存零成本），cosine → relevance（主信号）
 *   3. topK 语义裁剪（候选 > topK 且语义可用时，先按 relevance 取前 topK 再多信号打分）
 *   4. total = relevance + Σ signalScorer；breakdown 全留痕（可观测）
 *   5. 确定性排序：total DESC → priority DESC → id lex（与 election tie-break 一致）
 *
 * 硬过滤（enabled / 类型 / BYOK 等）由调用方在传入 candidates 前做完，core 不管。
 */

import { Inject, Injectable, Logger } from "@nestjs/common";
import { cosineSimilarity, relevanceScore } from "./cosine.util";
import {
  EMBEDDING_PORT,
  type IEmbeddingPort,
  type IScoredRouter,
  type RankedCandidate,
  type RoutableCandidate,
  type RouteQuery,
  type RouteResult,
  type RouteScore,
  type SignalScorer,
} from "./abstractions/routing.types";

/** relevance 满分 40 → 默认带宽 5 = 8 档。相关性差 > 1 档即由相关性主导。 */
const DEFAULT_RELEVANCE_BAND_WIDTH = 5;

@Injectable()
export class ScoredRouterService implements IScoredRouter {
  private readonly logger = new Logger(ScoredRouterService.name);

  constructor(
    @Inject(EMBEDDING_PORT) private readonly embeddingPort: IEmbeddingPort,
  ) {}

  async route<T extends RoutableCandidate>(
    candidates: readonly T[],
    query: RouteQuery,
    scorers: readonly SignalScorer<T>[],
  ): Promise<RouteResult<T>> {
    if (candidates.length === 0) {
      return {
        ranked: [],
        chosen: null,
        reason: "no candidates",
        semanticApplied: false,
      };
    }

    // ===== Step 1 · query 向量（降级闸）=====
    const queryVec = await this.embeddingPort.embed(query.goal, "query");
    const semanticApplied = queryVec !== null;

    // ===== Step 2 · 并行算 relevance =====
    const relevances = await Promise.all(
      candidates.map(async (cand) => {
        if (queryVec === null) return 0; // 收窄 queryVec → number[]，无需非空断言
        const candVec = await this.embeddingPort.embed(
          cand.description,
          "document",
        );
        if (!candVec) return 0;
        return relevanceScore(cosineSimilarity(queryVec, candVec));
      }),
    );

    // ===== Step 3 · topK 语义裁剪（仅语义可用时）=====
    let workingIdx = candidates.map((_, i) => i);
    const topK = query.topK ?? 0;
    if (semanticApplied && topK > 0 && candidates.length > topK) {
      workingIdx = workingIdx
        .sort((a, b) => relevances[b] - relevances[a])
        .slice(0, topK);
    }

    // ===== Step 4 · 多信号打分 =====
    const ranked: RankedCandidate<T>[] = workingIdx.map((i) => {
      const cand = candidates[i];
      const breakdown: Record<string, number> = {};
      let signalTotal = 0;
      for (const scorer of scorers) {
        const s = scorer.score(cand, query);
        breakdown[scorer.key] = s;
        signalTotal += s;
      }
      const relevance = relevances[i];
      const score: RouteScore = {
        id: cand.id,
        total: Math.round((relevance + signalTotal) * 100) / 100,
        relevance,
        signalTotal: Math.round(signalTotal * 100) / 100,
        breakdown,
      };
      return { candidate: cand, score };
    });

    // ===== Step 5 · 两阶段词典序 =====
    // relevance 分档主导（跨档由相关性决定），signals 仅在同档内 tie-break，
    // 最后 priority / id 保证确定性。避免"高健康但不相关"的候选用信号分
    // 压过更相关的候选——这是加性混合的已知反模式。
    // !semanticApplied 时 relevance 全 0 → 同档 → 完全退化为信号打分。
    const bandWidth =
      query.relevanceBandWidth && query.relevanceBandWidth > 0
        ? query.relevanceBandWidth
        : DEFAULT_RELEVANCE_BAND_WIDTH;
    const bandOf = (r: RankedCandidate<T>): number =>
      Math.floor(r.score.relevance / bandWidth);
    ranked.sort((a, b) => {
      const bandDiff = bandOf(b) - bandOf(a);
      if (bandDiff !== 0) return bandDiff;
      const sigDiff = b.score.signalTotal - a.score.signalTotal;
      if (sigDiff !== 0) return sigDiff;
      const prioDiff =
        (b.candidate.signals?.priority ?? 50) -
        (a.candidate.signals?.priority ?? 50);
      if (prioDiff !== 0) return prioDiff;
      return a.candidate.id.localeCompare(b.candidate.id);
    });

    const chosen = ranked[0]?.candidate ?? null;
    const reason = this.buildReason(
      ranked[0],
      semanticApplied,
      candidates.length,
    );

    this.logger.debug(
      `[route] goal="${query.goal.slice(0, 40)}" candidates=${candidates.length} ` +
        `topK=${topK || "-"} semantic=${semanticApplied} → ${chosen?.id ?? "none"}`,
    );

    return { ranked, chosen, reason, semanticApplied };
  }

  private buildReason<T extends RoutableCandidate>(
    top: RankedCandidate<T> | undefined,
    semanticApplied: boolean,
    poolSize: number,
  ): string {
    if (!top) return "no candidates";
    const b = Object.entries(top.score.breakdown)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    return (
      `chosen=${top.candidate.id} ` +
      `relevance=${top.score.relevance}${semanticApplied ? "" : "(degraded)"} ` +
      `signalTotal=${top.score.signalTotal} [${b}] pool=${poolSize}`
    );
  }
}

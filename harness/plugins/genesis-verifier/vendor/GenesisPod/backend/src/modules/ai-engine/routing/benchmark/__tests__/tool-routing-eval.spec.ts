import { ScoredRouterService } from "../../scored-router.service";
import type { IEmbeddingPort } from "../../abstractions/routing.types";
import { EVAL_POOL, EVAL_CASES } from "../tool-routing-eval.fixture";
import {
  evaluateSemantic,
  evaluateAllTools,
  evaluateFirstK,
  evaluateBlindSample,
} from "../tool-routing-eval";

/**
 * 确定性 BoW embedder：共享词表（pool 描述 + case goals），向量 = 词频。
 * cosine ≈ 词重叠 → goal 与相关工具描述天然靠近。可复现、无外部依赖。
 * 注意：BoW 让语义路由偏乐观；真实 embedder 数字见 tool-routing-eval.ts 头注。
 */
function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z]+/g) ?? [];
}
function makeBowPort(corpus: string[]): IEmbeddingPort {
  const vocab = [...new Set(corpus.flatMap(tokenize))];
  const index = new Map(vocab.map((w, i) => [w, i]));
  return {
    async embed(text: string) {
      const v = new Array(vocab.length).fill(0);
      for (const t of tokenize(text)) {
        const i = index.get(t);
        if (i !== undefined) v[i] += 1;
      }
      return v;
    },
  };
}

const K = 5;

describe("tool-routing eval (stub BoW embedder)", () => {
  const corpus = [
    ...EVAL_POOL.map((p) => p.description),
    ...EVAL_CASES.map((c) => c.goal),
  ];
  const router = new ScoredRouterService(makeBowPort(corpus));

  it("semantic routing is meaningfully accurate at k=5", async () => {
    const m = await evaluateSemantic(router, EVAL_POOL, EVAL_CASES, K);
    // 命中期望工具：种子集上应相当高
    expect(m.recallAtK).toBeGreaterThanOrEqual(0.75);
    expect(m.hitAtK).toBeGreaterThanOrEqual(0.9);
    // token 节省（24 → 5）≈ 0.79
    expect(m.tokenReductionPct).toBeCloseTo(1 - K / EVAL_POOL.length, 2);
  });

  it("semantic beats goal-blind baselines at the SAME token budget (k=5)", async () => {
    const semantic = await evaluateSemantic(router, EVAL_POOL, EVAL_CASES, K);
    const firstK = evaluateFirstK(EVAL_POOL, EVAL_CASES, K);
    const blind = evaluateBlindSample(EVAL_POOL, EVAL_CASES, K);

    // 同样的 k（同样的 token 预算），语义远胜盲选 —— LLMRouterBench 式"赢过简单基线"
    expect(semantic.recallAtK).toBeGreaterThan(firstK.recallAtK + 0.2);
    expect(semantic.recallAtK).toBeGreaterThan(blind.recallAtK + 0.2);
  });

  it("all-tools baseline: recall 1 but zero token saving (trade-off frontier)", () => {
    const all = evaluateAllTools(EVAL_POOL, EVAL_CASES);
    expect(all.recallAtK).toBe(1);
    expect(all.tokenReductionPct).toBe(0);
    // 语义的价值 = 逼近 all-tools 的 recall，同时拿到 ~79% token 节省
  });
});

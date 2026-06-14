/**
 * Tool-routing 离线评测器
 *
 * 对照 LLMRouterBench 方法学：固定集 + 对标基线（all-tools / first-k / blind-sample）。
 * 指标：Recall@k（命中期望工具的比例）、Hit@k（≥1 命中的 case 比例）、token 节省%。
 *
 * 两种运行模式：
 *   - **stub embedder**（见 __tests__/tool-routing-eval.spec.ts）：BoW，确定可复现，
 *     用作回归门 + 验证"语义赢过盲选基线"的机制。BoW 让结果偏乐观，**不代表生产质量**。
 *   - **real embedder**：构造 `new ScoredRouterService(new EmbeddingRouterPort(embeddingService))`
 *     传入本评测器，并把 EVAL_POOL 的 description 换成 ToolRegistry 线上描述，得到
 *     生产代表性的 Recall@k / token 节省数字（需 embedding key，建议在有 BYOK 的环境跑）。
 */

import type { IScoredRouter, RoutableCandidate } from "../abstractions/routing.types";
import { defaultScorers } from "../signal-scorers";
import type { EvalPoolItem, EvalCase } from "./tool-routing-eval.fixture";

export interface EvalMetrics {
  readonly selector: string;
  readonly k: number;
  /** 平均 Recall@k（命中期望工具的比例），∈ [0,1] */
  readonly recallAtK: number;
  /** Hit@k：至少命中一个期望工具的 case 比例 */
  readonly hitAtK: number;
  /** token 节省%（结构性）：1 - k/poolSize */
  readonly tokenReductionPct: number;
  readonly n: number;
}

const round = (x: number): number => Math.round(x * 1000) / 1000;

function caseScore(
  selected: readonly string[],
  expected: readonly string[],
): { recall: number; hit: number } {
  if (expected.length === 0) return { recall: 1, hit: 1 };
  const sel = new Set(selected);
  const found = expected.filter((e) => sel.has(e)).length;
  return { recall: found / expected.length, hit: found > 0 ? 1 : 0 };
}

function aggregate(
  selector: string,
  k: number,
  poolSize: number,
  perCaseSelected: readonly (readonly string[])[],
  cases: readonly EvalCase[],
): EvalMetrics {
  let r = 0;
  let h = 0;
  cases.forEach((c, i) => {
    const { recall, hit } = caseScore(perCaseSelected[i], c.expected);
    r += recall;
    h += hit;
  });
  const n = cases.length;
  return {
    selector,
    k,
    recallAtK: round(r / n),
    hitAtK: round(h / n),
    tokenReductionPct: round(1 - k / poolSize),
    n,
  };
}

/** 语义路由（被测对象）：ScoredRouter 取 top-k */
export async function evaluateSemantic(
  router: IScoredRouter,
  pool: readonly EvalPoolItem[],
  cases: readonly EvalCase[],
  k: number,
): Promise<EvalMetrics> {
  const candidates: RoutableCandidate[] = pool.map((p) => ({
    id: p.id,
    description: p.description,
  }));
  const perCase: string[][] = [];
  for (const c of cases) {
    const res = await router.route(
      candidates,
      { goal: c.goal, topK: k },
      defaultScorers(),
    );
    perCase.push(res.ranked.map((r) => r.candidate.id));
  }
  return aggregate("semantic", k, pool.length, perCase, cases);
}

/** 基线：全选（recall 上界 1，token 节省 0）—— 当前默认 allowlist 行为 */
export function evaluateAllTools(
  pool: readonly EvalPoolItem[],
  cases: readonly EvalCase[],
): EvalMetrics {
  const all = pool.map((p) => p.id);
  return aggregate(
    "all-tools",
    pool.length,
    pool.length,
    cases.map(() => all),
    cases,
  );
}

/** 基线：注册序前 k（goal-blind） */
export function evaluateFirstK(
  pool: readonly EvalPoolItem[],
  cases: readonly EvalCase[],
  k: number,
): EvalMetrics {
  const firstK = pool.slice(0, k).map((p) => p.id);
  return aggregate(
    "first-k",
    k,
    pool.length,
    cases.map(() => firstK),
    cases,
  );
}

/** 基线：确定性盲选（步长采样，goal-blind，覆盖面比 first-k 略广） */
export function evaluateBlindSample(
  pool: readonly EvalPoolItem[],
  cases: readonly EvalCase[],
  k: number,
): EvalMetrics {
  const ids = pool.map((p) => p.id);
  const step = Math.max(1, Math.floor(pool.length / k));
  const sample: string[] = [];
  for (let i = 0; i < ids.length && sample.length < k; i += step) {
    sample.push(ids[i]);
  }
  return aggregate(
    "blind-sample",
    k,
    pool.length,
    cases.map(() => sample),
    cases,
  );
}

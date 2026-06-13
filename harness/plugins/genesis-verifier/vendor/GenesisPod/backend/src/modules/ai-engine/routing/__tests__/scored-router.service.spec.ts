import { ScoredRouterService } from "../scored-router.service";
import { defaultScorers } from "../signal-scorers";
import type { IEmbeddingPort, RoutableCandidate } from "../abstractions/routing.types";

/**
 * Bag-of-words 假 embedder：向量 = 固定词表上的词频。
 * cosine ≈ 词重叠度，让排序断言确定可预测。
 */
const VOCAB = [
  "academic",
  "paper",
  "research",
  "weather",
  "forecast",
  "temperature",
  "finance",
  "stock",
];
function bow(text: string): number[] {
  const lower = text.toLowerCase();
  return VOCAB.map((w) => (lower.match(new RegExp(w, "g")) ?? []).length);
}

class FakeEmbeddingPort implements IEmbeddingPort {
  calls = 0;
  constructor(private readonly mode: "ok" | "null" = "ok") {}
  async embed(text: string): Promise<number[] | null> {
    this.calls++;
    if (this.mode === "null") return null;
    return bow(text);
  }
}

const TOOLS: RoutableCandidate[] = [
  { id: "arxiv", description: "academic paper research search on arxiv" },
  { id: "pubmed", description: "academic medical paper research database" },
  { id: "weather-api", description: "weather forecast temperature lookup" },
  { id: "finance-api", description: "finance stock market data" },
];

describe("ScoredRouterService", () => {
  it("ranks semantically relevant candidates first", async () => {
    const router = new ScoredRouterService(new FakeEmbeddingPort());
    const res = await router.route(
      TOOLS,
      { goal: "find academic research papers" },
      defaultScorers(),
    );

    expect(res.semanticApplied).toBe(true);
    expect(res.chosen?.id).toMatch(/arxiv|pubmed/);
    // academic 工具应排在 weather/finance 之上
    const order = res.ranked.map((r) => r.candidate.id);
    expect(order.indexOf("arxiv")).toBeLessThan(order.indexOf("weather-api"));
    expect(order.indexOf("pubmed")).toBeLessThan(order.indexOf("finance-api"));
  });

  it("topK prunes the candidate set (token reduction)", async () => {
    const router = new ScoredRouterService(new FakeEmbeddingPort());
    const res = await router.route(
      TOOLS,
      { goal: "academic research papers", topK: 2 },
      defaultScorers(),
    );
    // 4 候选 → topK=2 → 只保留 2 个，且都是学术相关
    expect(res.ranked).toHaveLength(2);
    const ids = res.ranked.map((r) => r.candidate.id).sort();
    expect(ids).toEqual(["arxiv", "pubmed"]);
  });

  it("degrades to signal-only when embedding unavailable (no throw)", async () => {
    const router = new ScoredRouterService(new FakeEmbeddingPort("null"));
    const res = await router.route(
      TOOLS,
      { goal: "find academic research papers" },
      defaultScorers(),
    );
    expect(res.semanticApplied).toBe(false);
    // 仍返回结果（按信号打分 + 确定性 tie-break），不抛错
    expect(res.chosen).not.toBeNull();
    expect(res.ranked).toHaveLength(TOOLS.length);
    // 所有 relevance 为 0
    expect(res.ranked.every((r) => r.score.relevance === 0)).toBe(true);
  });

  it("relevance dominates: a healthy-but-irrelevant tool must NOT outrank a relevant one", async () => {
    // 回归用例：旧加性混合（total = relevance + signals）会让满健康的 weather-api
    // 用 +signal 反超不相关。两阶段词典序下 relevance 分档主导 → arxiv 必胜。
    const router = new ScoredRouterService(new FakeEmbeddingPort());
    const cands: RoutableCandidate[] = [
      // 相关但健康差（错误率高 → health 扣分）
      {
        id: "arxiv",
        description: "academic paper research search on arxiv",
        signals: { recentErrorRate: 0.4 },
      },
      // 完全不相关但满健康
      {
        id: "weather-api",
        description: "weather forecast temperature lookup",
        signals: { recentErrorRate: 0 },
      },
    ];
    const res = await router.route(
      cands,
      { goal: "find academic research papers" },
      defaultScorers(),
    );
    expect(res.chosen?.id).toBe("arxiv");
    expect(res.ranked.map((r) => r.candidate.id)).toEqual([
      "arxiv",
      "weather-api",
    ]);
  });

  it("signals break ties only within the same relevance band", async () => {
    // 两个相关性几乎相同（同档）的候选，由 signal（health）决定
    const router = new ScoredRouterService(new FakeEmbeddingPort());
    const cands: RoutableCandidate[] = [
      {
        id: "arxiv",
        description: "academic paper research",
        signals: { recentErrorRate: 0.4 }, // health 差
      },
      {
        id: "pubmed",
        description: "academic paper research",
        signals: { recentErrorRate: 0 }, // health 好
      },
    ];
    const res = await router.route(
      cands,
      { goal: "academic paper research" },
      defaultScorers(),
    );
    // 同档（描述相同 → relevance 相同）→ 健康好的 pubmed 胜出
    expect(res.chosen?.id).toBe("pubmed");
  });

  it("empty candidates → null chosen, no throw", async () => {
    const router = new ScoredRouterService(new FakeEmbeddingPort());
    const res = await router.route([], { goal: "anything" }, defaultScorers());
    expect(res.chosen).toBeNull();
    expect(res.ranked).toHaveLength(0);
  });

  it("deterministic tie-break by priority then id when scores equal", async () => {
    // 关掉语义（null）让 relevance 全 0；候选无 signals → 信号分相同 → tie-break 决定
    const router = new ScoredRouterService(new FakeEmbeddingPort("null"));
    const cands: RoutableCandidate[] = [
      { id: "b-tool", description: "x" },
      { id: "a-tool", description: "x" },
      { id: "c-tool", description: "x", signals: { priority: 90 } },
    ];
    const res = await router.route(cands, { goal: "x" }, defaultScorers());
    // priority 高的 c-tool 居首；其余按 id lex（a 在 b 前）
    expect(res.ranked.map((r) => r.candidate.id)).toEqual([
      "c-tool",
      "a-tool",
      "b-tool",
    ]);
  });
});

// Sediment from {app} (2026-04-29) — ai-engine/knowledge/rerank/
// 来源: ai-app/{app}/services/search/rerank/rerank.types.ts
// 泛化: 不再依赖 TI 的 DataSourceResult 类型，改成 generic Item，让任意 ai-app 复用。

/**
 * Rerank Module Types
 *
 * ★ RAG 两阶段检索第二阶段：对 fusion 后的候选集做精排。
 *
 * 背景：业界基准（Anthropic Contextual Retrieval / Cohere Rerank /
 * RAGAS）都要求 retrieval → rerank 两阶段：
 * - retrieval (fusion): 快，召回 top-N（N 较大，如 60）
 * - rerank: 慢但精准，从 N 选 top-K（K 较小，如 20）
 *
 * 本模块提供 RerankAdapter 抽象 + 默认 LlmRerankerAdapter 实现。
 */

/** Rerank 候选 item 必备字段（最小契约） */
export interface RerankableItem {
  title?: string | null;
  snippet?: string | null;
  url?: string | null;
  sourceType?: string | null;
}

/** Rerank 输入项（携带原始索引，方便回映射） */
export interface RerankCandidate<T extends RerankableItem = RerankableItem> {
  /** 原始 item（任意 ai-app 自己的检索结果类型，含 title/snippet/url/sourceType） */
  item: T;
  /** 原始在 fusion 列表中的位置 */
  originalIndex: number;
}

/** Rerank 输出项（附相关性分数） */
export interface RerankedItem<T extends RerankableItem = RerankableItem> {
  item: T;
  originalIndex: number;
  /**
   * Rerank 给出的相关性分数，0-1。
   * 仅当 RerankResult.reranked === true 时才是真 rerank 分数；
   * 否则（passthrough / fail-open）调用方不应把它当成可信分数使用。
   */
  rerankScore: number;
}

/**
 * Rerank 操作的返回值。
 *
 * reranked 语义至关重要：
 * - true  —— LLM 真正对候选进行了精排，items[*].rerankScore 是可信的相关性分数
 * - false —— 要么候选不足（passthrough），要么 LLM/解析失败（fail-open）。
 *            items 只是 "原 fusion 顺序前 topK"，下游**不应**把 rerankScore
 *            覆盖掉 fusion 的 relevanceScore，否则会损失 fusion 已经算好的
 *            多因子分数（相关性×0.35 + 源可信度×0.25+… + 时效 + 深度）。
 */
export interface RerankResult<T extends RerankableItem = RerankableItem> {
  /** 是否真正执行了 rerank（vs passthrough / fail-open） */
  reranked: boolean;
  /** 精排后的条目（或降级后的原序前 topK） */
  items: RerankedItem<T>[];
  /** reranked=false 时说明原因（如 'candidates_below_topk'、'llm_no_response'） */
  skipReason?: string;
}

/** Rerank 调用参数 */
export interface RerankRequest<T extends RerankableItem = RerankableItem> {
  /** 用于相关性判断的查询（通常是 baseQuery） */
  query: string;
  /** 候选列表（来自 fusion 的 scoredItems 前 K*multiplier 名） */
  candidates: RerankCandidate<T>[];
  /** 最终保留的 top K */
  topK: number;
  /** 超时（ms），超时 fail-open 返回原序 */
  timeoutMs?: number;
  /** 取消信号（会转发到 LLM 调用） */
  signal?: AbortSignal;
}

/** Rerank 适配器接口 */
export interface RerankAdapter {
  /** 适配器 ID（如 'llm' / 'cohere' / 'jina'） */
  readonly id: string;

  /**
   * 对候选列表精排并截取 top K。
   * 约定：
   * - 候选数 ≤ topK 时应返回 { reranked: false, items: <原序> }（无需 LLM 调用）
   * - 失败时 fail-open：返回 { reranked: false, items: <原序前 topK>, skipReason }
   * - 真 rerank 成功：返回 { reranked: true, items: <精排结果> }
   * - 不抛异常（错误由内部处理并记录日志）
   */
  rerank<T extends RerankableItem = RerankableItem>(
    request: RerankRequest<T>,
  ): Promise<RerankResult<T>>;
}

/** Rerank 配置（可放入 SearchPipelineOptions） */
export interface RerankConfig {
  /** 是否启用（默认 false，显式开启才跑） */
  enabled?: boolean;
  /** 精排后保留多少（默认 20） */
  topK?: number;
  /** 参与精排的候选池 = topK * candidateMultiplier（默认 3） */
  candidateMultiplier?: number;
  /** 超时，超时 fail-open（默认 15000ms） */
  timeoutMs?: number;
}

export const DEFAULT_RERANK_CONFIG: Required<
  Pick<RerankConfig, "topK" | "candidateMultiplier" | "timeoutMs">
> = {
  topK: 20,
  candidateMultiplier: 3,
  timeoutMs: 15_000,
};

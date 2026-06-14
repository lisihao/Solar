/**
 * ScoredRouter · 契约
 *
 * 项目唯一的"语义检索 + 多信号打分"通用路由原语。agent 无关 → 归 engine。
 * 被三处复用：
 *   - LLM   model-election（P2 接入，补 latency 信号）
 *   - Tools runner/tool-routing 的 SemanticToolSelector
 *   - Skills engine/skills 的 SemanticSkillRouter
 *
 * 设计蓝本 = ModelElectionService 的打分选举：硬过滤交给调用方，core 只做
 * `embed 候选描述 → top-k 语义检索 → 多信号重排 → 可观测`。**不含**在线学习
 * （务实 SOTA 边界，见 docs/architecture/platform-review/2026-06-02-scored-router-sota-design.md）。
 */

/**
 * 候选信号——可选的运营指标，喂给 SignalScorer。与 ElectionCandidate 对齐命名。
 */
export interface CandidateSignals {
  /** 近期错误率 [0,1]，越低越健康 */
  readonly recentErrorRate?: number;
  /** 成本档（与 DB AIModel.costTier 同词） */
  readonly costTier?: "basic" | "standard" | "strong" | "unknown";
  /** p95 延迟（ms）——SOTA latency 感知信号，LLM router P2 用 */
  readonly p95LatencyMs?: number;
  /** 运营优先级（与 election 一致，默认 50） */
  readonly priority?: number;
}

/**
 * 可被路由的候选——任何东西（model / tool / skill）都先归一到这个形状。
 */
export interface RoutableCandidate {
  readonly id: string;
  /** 用于语义 embedding 的文本（通常 = name + description） */
  readonly description: string;
  readonly signals?: CandidateSignals;
}

/**
 * 一次路由请求。
 */
export interface RouteQuery {
  /** 任务文本，embed 后做语义检索（topK 裁剪 + relevance 打分） */
  readonly goal: string;
  /**
   * 语义裁剪上限：候选数 > topK 时先按 relevance 取前 topK 再多信号打分。
   * 不传 / <=0 → 不裁剪，全量打分（小候选集用）。
   */
  readonly topK?: number;
  /** 成本策略，喂给 cost scorer */
  readonly costBias?: "cheap" | "balanced" | "quality";
  /** 多样性反坍缩：已被选过的 id 列表（含重复），喂给 diversity scorer */
  readonly previouslyChosen?: readonly string[];
  /**
   * relevance 分档宽度（两阶段词典序）。relevance 满分 40，默认带宽 5 → 8 档。
   * 同档内才让 signals 决定排序，跨档由 relevance 主导——避免"高健康但不相关"
   * 的候选用信号分压过更相关的候选。0 / 不传 → 用默认 5。
   */
  readonly relevanceBandWidth?: number;
}

/**
 * 单候选打分明细。relevance 是 core 内置（需 embedding），其余来自 SignalScorer。
 * breakdown 是开放字典：哪些 scorer 参与就有哪些键（对齐 election 的可观测风格）。
 */
export interface RouteScore {
  readonly id: string;
  /** relevance + signalTotal，仅供展示/可观测；排序用两阶段词典序，不是这个数 */
  readonly total: number;
  /** 语义相关性（主排序键，分档后比较） */
  readonly relevance: number;
  /** 信号分合计（档内 tie-break 键） */
  readonly signalTotal: number;
  readonly breakdown: Readonly<Record<string, number>>;
}

export interface RankedCandidate<T extends RoutableCandidate> {
  readonly candidate: T;
  readonly score: RouteScore;
}

export interface RouteResult<T extends RoutableCandidate> {
  readonly ranked: ReadonlyArray<RankedCandidate<T>>;
  /** ranked[0]；候选为空时 null */
  readonly chosen: T | null;
  /** 可观测：为什么选它（含 breakdown 摘要） */
  readonly reason: string;
  /** 本次是否真用上了语义（embedding 可用）。false = 降级为纯信号打分 */
  readonly semanticApplied: boolean;
}

/**
 * 信号打分器——纯函数式，只看候选的 signals + query，不碰 embedding。
 * relevance 不在此（由 core 用 embedding 算），这里是 health/cost/diversity/priority/latency。
 */
export interface SignalScorer<T extends RoutableCandidate = RoutableCandidate> {
  /** breakdown 里的键名 */
  readonly key: string;
  score(candidate: T, query: RouteQuery): number;
}

/**
 * Embedding 端口——core 只依赖这个抽象，不直接耦合 EmbeddingService。
 * 实现方负责缓存（候选描述静态，绝不每次重算）+ 失败返 null（降级而非抛错）。
 */
export interface IEmbeddingPort {
  /**
   * @returns 向量；不可用（服务挂 / 熔断 / 配置缺失）时返回 null，core 据此降级。
   */
  embed(text: string, kind: "query" | "document"): Promise<number[] | null>;
}

export const SCORED_ROUTER = Symbol("SCORED_ROUTER");
export const EMBEDDING_PORT = Symbol("EMBEDDING_PORT");

export interface IScoredRouter {
  route<T extends RoutableCandidate>(
    candidates: readonly T[],
    query: RouteQuery,
    scorers: readonly SignalScorer<T>[],
  ): Promise<RouteResult<T>>;
}

/**
 * Model Election · Types
 *
 * 环境感知选举的契约。输入：运行时已发现的模型候选池 + 本次调用的需求；
 * 输出：唯一选中的 modelId 及评分详情。
 *
 * 与 TaskProfile 的区别：
 *   TaskProfile 告诉"怎么配参数"（temperature / maxTokens）
 *   ElectionRequest 告诉"谁来执行"（modelId 选择）
 */

import type { AIModelType } from "@prisma/client";
import type { TaskProfile } from "../../types";
// v3.1 A0：AIModelConfig 单一源已迁至 types/model-config.types.ts
import type { AIModelConfig } from "../../types/model-config.types";

/**
 * Role 偏好提示。由 spec.identity.role.id（如 AG-01-LD / AG-03-SW / AG-07-FE）
 * 规范化而来。Election 只关心角色"类别"，不关心具体 id。
 */
export type ElectionRoleHint =
  | "leader" // 规划 / 分配子任务 —— 倾向推理模型
  | "researcher" // 搜索 / 综合研究 —— 倾向 STRONG，轻微偏非 reasoning
  | "writer" // 长文写作 —— 倾向 STRONG
  | "reviewer" // 质量评审 —— 倾向 STRONG / reasoning
  | "extractor" // 结构化抽取 —— BASIC 够用，cheap
  | "classifier" // 分类 / 意图 —— BASIC 够用，cheap
  | "default";

/**
 * 成本策略（Budget 感知）
 *   cheap   —— 偏向 costTier=cheap，在 OK 范围内省钱
 *   balanced —— 默认
 *   quality —— 偏向 costTier=premium / STRONG tier
 */
export type ElectionCostBias = "cheap" | "balanced" | "quality";

/**
 * Election 输入候选——通常由 RuntimeEnvironmentService.snapshot() 透出
 * （CHAT + REASONING + EMBEDDING + VISION 四个桶）。
 * 只传 modelId + 能力 hint；完整 AIModelConfig 由 service 自己回查 DB 拿到。
 */
export interface ElectionCandidate {
  readonly modelId: string;
  readonly provider: string;
  readonly modelType: AIModelType | "REASONING" | "VISION";
  /**
   * 健康状态三态（与 RuntimeEnvironmentService 对齐）：
   *   - "healthy" 已探测且健康
   *   - "unhealthy" 已探测且不健康（错误率 >= 50%）
   *   - "unknown" 无数据 / 未探测
   * 旧 boolean? 形式已废除——unknown 不再被当 healthy 误用。
   */
  readonly healthy?: "healthy" | "unhealthy" | "unknown";
  readonly recentErrorRate?: number;
  /**
   * 与 DB AIModel.costTier 对齐：basic / standard / strong / unknown。
   * 由管理员显式配置，不再是模型名 startsWith 启发式（cheap/premium 旧词废除）。
   */
  readonly costTier?: "basic" | "standard" | "strong" | "unknown";
}

export interface ElectionRequest {
  /** 需求的硬能力门槛 */
  readonly modelType: AIModelType;

  /** 候选池快照（RuntimeEnvironmentService 产出）。空数组 → fallback 走 DB 全表 */
  readonly candidates: ReadonlyArray<ElectionCandidate>;

  /** TaskProfile（决定 tier 目标分布） */
  readonly taskProfile?: TaskProfile;

  /** 调用者角色（推 leader 偏好 reasoning，writer 偏好 STRONG 等） */
  readonly role?: ElectionRoleHint;

  /** 调用者用户 id——BYOK 过滤用 */
  readonly userId?: string;

  /** 成本策略 */
  readonly costBias?: ElectionCostBias;

  /** 运营 hint：禁用这些 modelId（动态黑名单，如最近几分钟频繁失败的） */
  readonly excludeModelIds?: ReadonlyArray<string>;

  /**
   * Mission-scoped 多样性输入：本 mission 中已被选过的 modelId 列表（含重复）。
   * Election 在打分时会按出现次数衰减（diversityScore = -10 × occurrences），
   * 使无状态选举具备"用过越多越扣分"的宏观分布特性，避免 11 个 agent 全选
   * 同一 model 的坍缩。
   *
   * 由 mission orchestrator（如 SpecBasedAgent + MissionElectionTracker）
   * 维护并按调用顺序传入。空数组 → 等价于无 diversity bias。
   */
  readonly previouslyElected?: ReadonlyArray<string>;
}

/**
 * 单个候选的评分明细。用于日志和排查：为什么选了这个而不是那个。
 */
export interface ElectionScore {
  readonly modelId: string;
  readonly total: number;
  readonly breakdown: {
    readonly tier: number;
    readonly role: number;
    readonly cost: number;
    readonly health: number;
    readonly priority: number;
    readonly isDefault: number;
    /** 2026-05-10 §3：mission-scoped 多样性扣分（已被选过越多扣越多） */
    readonly diversity: number;
  };
  readonly rejected?: string;
}

export interface ElectionResult {
  readonly elected: AIModelConfig;
  readonly scores: ReadonlyArray<ElectionScore>;
  readonly reason: string;
}

export class NoEligibleModelError extends Error {
  constructor(
    public readonly modelType: AIModelType,
    public readonly detail: string,
  ) {
    super(
      `[ModelElection] No eligible model for ${modelType}: ${detail}. ` +
        `请在管理后台启用至少 1 个该 modelType 的模型并检查健康状态/BYOK 配置。`,
    );
    this.name = "NoEligibleModelError";
  }
}

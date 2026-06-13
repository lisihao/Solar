import type { EnvironmentSnapshot } from "../../guardrails/runtime/runtime-environment.types";

/**
 * IRuntimeEnvironment — Agent 执行时的"外部世界"快照
 *
 * Topic Insights 实地痛点：执行 mission 时需要知道
 *   - 用户当前是 BYOK 还是用平台 key
 *   - credit 余额够不够下一次 LLM 调用
 *   - 哪些 model 当前可用（订阅、配额、地域、A/B 灰度）
 *   - 处于哪个 workspace（多租户）
 *   - quota 实时余量（LLM tokens / search calls / image gen ...）
 *
 * 这些信息**必须在 Agent 执行期间随时查得到**——不是 spec 时给一次。
 * 因为：
 *   1. credit 余量在执行中会变（每次 LLM 调用都扣）
 *   2. model availability 会变（rate-limit、provider 故障）
 *   3. workspace quota 可能被同 workspace 其它 agent 同时消耗
 *
 * 设计原则：IRuntimeEnvironment 是**接口**，不是数据快照。
 * 实现方（业务层注入 RuntimeEnvironmentResolver）按需 lazy 查询。
 */

export type ByokStatus =
  | "platform" // 用平台共享 key
  | "personal" // 用户自己的 key
  | "assigned" // ★ 2026-05-29 W4a：管理员分配/授权给用户的 key（原误名 "donated"）
  | "none"; // 完全无 key 可用

export interface ICreditState {
  /** 当前可用余额（业务方定义单位，通常是 credit / token / cents） */
  balance: number;
  /** 软限额：低于此值开始降级（warn） */
  softLimit?: number;
  /** 硬限额：低于此值禁止新调用 */
  hardLimit?: number;
  /** 计费币种 */
  currency?: "USD" | "credit";
}

export interface IModelAvailability {
  modelId: string;
  /** 当前是否可用（rate-limit / 故障 / 灰度全考虑） */
  available: boolean;
  /** 不可用原因（业务方决定如何告诉用户） */
  unavailableReason?: "rate_limit" | "outage" | "no_quota" | "not_subscribed";
  /** 同 model 的备选列表（degrade target） */
  fallbackTo?: readonly string[];
}

export interface IQuotaSnapshot {
  /** key = quota 名（如 'llm_tokens_daily' / 'search_calls_per_min'） */
  readonly [key: string]: {
    used: number;
    limit: number;
    /** 重置时间（unix ms）；不设为永不重置 */
    resetAt?: number;
  };
}

/**
 * 失败降级建议 —— 由 RuntimeEnvironment 根据当前状态返回。
 * Agent 命中限额 / model 不可用时调 suggestFallback() 拿到此对象，
 * 决定是 retry / downgrade tier / 通知用户 / 直接 fail。
 */
export interface IFallbackHint {
  action: "retry" | "downgrade" | "notify_user" | "abort";
  reason: string;
  /** 推荐的下一个 model id（action=downgrade 才有） */
  fallbackModelId?: string;
  /** 等待多少 ms 后重试（action=retry 才有） */
  retryAfterMs?: number;
  /** 给用户的信息（action=notify_user 才有） */
  userMessage?: string;
}

/**
 * IRuntimeEnvironment —— 由业务层注入，Harness 调用方持有。
 *
 * 业务层只需实现 RuntimeEnvironmentResolver 服务，将 BillingContext /
 * ModelElectionService / CreditService 等已有能力适配为本接口。
 *
 * 全部 method 都返回 Promise —— 强制业务方做异步查询，不假设是缓存。
 */
export interface IRuntimeEnvironment {
  /** 当前 user/workspace（永远存在） */
  readonly userId: string;
  readonly workspaceId?: string;

  /** 一次拿全 BYOK 状态 */
  getByokStatus(): Promise<ByokStatus>;

  /** Credit / 余额 —— 调用前查 */
  getCreditState(): Promise<ICreditState>;

  /** Model 可用性 —— 单查或全查 */
  getModelAvailability(modelId: string): Promise<IModelAvailability>;
  listAvailableModels(): Promise<readonly IModelAvailability[]>;
  /** 可选：返回完整环境快照，供上层做环境感知模型选举 */
  getEnvironmentSnapshot?(): Promise<EnvironmentSnapshot>;

  /** Quota 快照 —— UI 展示用 + Agent 决策用 */
  getQuotaSnapshot(): Promise<IQuotaSnapshot>;

  /**
   * 关键：请求降级建议。
   *
   * Loop / Runner / Tool 在所有失败路径都应调用此方法（不只是 budget）。
   * 业务方按当前 BYOK / credit / quota / 模型可用性 综合判断给出 IFallbackHint。
   *
   * reason 与 HarnessFailureCode 对齐：
   *   - 老的基础设施级原因：rate_limit / no_credit / outage / no_quota / context_too_long
   *   - 新的 LLM 协议级原因：safety_refusal / truncated / parse_failure /
   *                          reasoning_exhaustion / model_not_found / empty_response
   *   - 新的执行级原因：tool_failure / verifier_low_score / schema_mismatch
   */
  suggestFallback(input: {
    failedModelId?: string;
    reason: // —— 基础设施级（老）——
      | "rate_limit"
      | "no_credit"
      | "outage"
      | "no_quota"
      | "context_too_long"
      // —— BYOK 专用 ——
      | "byok_quota_exceeded"
      // —— LLM 协议级（新增）——
      | "safety_refusal"
      | "truncated"
      | "parse_failure"
      | "reasoning_exhaustion"
      | "model_not_found"
      | "empty_response"
      // —— 执行级（新增）——
      | "tool_failure"
      | "verifier_low_score"
      | "schema_mismatch";
  }): Promise<IFallbackHint>;

  /**
   * 失效内部快照缓存（如刚检测到 BYOK quota 耗尽，强制下次 suggestFallback
   * 重新查 DB 拿最新模型 health 状态）。
   *
   * 可选：业务方未必有缓存层（无 op 即可）。
   */
  invalidate?(): void;
}

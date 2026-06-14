/**
 * Consolidation（主动反思）类型定义 — PR-I 2026-05-15 骨架
 *
 * 与 Anthropic Managed Agent 的 memory-consolidation 范式对齐：
 *   - 被动学习：单 mission 失败 → Postmortem → VectorMemory（已实现，见 lifecycle/learning）
 *   - 主动反思：跨多 mission 周期抽样 → 归纳通用规则 → RuleBase → 注入下轮 leader plan
 *
 * 本骨架定义接口与数据形态，service 实现见 reflection-mission-scheduler.service.ts /
 * consolidation-orchestrator.service.ts。
 */

/**
 * 反思触发器：定期 cron / 阈值达到 / 手动触发。
 */
export type ConsolidationTriggerKind = "cron" | "failure_threshold" | "manual";

export interface ConsolidationTrigger {
  kind: ConsolidationTriggerKind;
  /** Cron 表达式（kind=cron）或 触发原因（其他）*/
  detail?: string;
  triggeredAt: Date;
}

/**
 * 反思样本：被纳入本轮 Consolidation 分析的失败 mission 集合。
 */
export interface ConsolidationSample {
  /** 抽样窗口起止 */
  windowStart: Date;
  windowEnd: Date;
  /** 抽样的 mission ids */
  missionIds: string[];
  /** 抽样策略：random / stratified-by-failure-code / latest-N */
  strategy: "random" | "stratified" | "latest";
}

/**
 * 反思生成的通用规则——可注入下轮 mission 的 leader plan。
 *
 * 与单 mission Postmortem（一次性教训）区别：
 *   - Postmortem：单 mission 内的 root cause + immediate fix（短期）
 *   - ConsolidationRule：跨多 mission 归纳的 pattern + 通用 mitigation（长期）
 */
export interface ConsolidationRule {
  /** UUID */
  id: string;
  /**
   * Rule pattern — LLM 提炼的 "X 类失败模式"：
   *   e.g. "research stage 超时 + budget 50% 已耗 → 缩减 dimensions"
   */
  pattern: string;
  /** 建议的 mitigation：注入 leader plan 时给的指引 */
  mitigation: string;
  /**
   * 涉及的失败类别（failure_code）集合，用于按类匹配下轮 mission
   */
  failureCodes: string[];
  /** 本规则归纳依据的 mission ids（可追溯） */
  derivedFromMissionIds: string[];
  /** LLM 对这条规则的置信度 0-1 */
  confidence: number;
  /** 创建时间 */
  createdAt: Date;
  /**
   * 后续应用本规则的 mission 数 + 每次成功度（用于规则效用追踪 / 衰减）
   */
  applicationCount: number;
  successCount: number;
  /** 是否被 admin 禁用 */
  disabled: boolean;
}

/**
 * 本轮 Consolidation 运行结果。
 */
export interface ConsolidationRunResult {
  trigger: ConsolidationTrigger;
  sample: ConsolidationSample;
  /** 本轮新增 / 强化的 rules */
  newRules: ConsolidationRule[];
  /** 因低置信度 / 重复被 reject 的候选 */
  rejectedCandidates: number;
  /** LLM 调用 token 消耗 */
  tokensUsed: number;
  /** 用时 (ms) */
  durationMs: number;
}

/**
 * 注入下轮 mission leader plan 的规则集（取 top-K 按 failureCode 匹配 + confidence 排序）。
 */
export interface InjectedRuleSet {
  /** 命中的规则 */
  rules: Pick<ConsolidationRule, "id" | "pattern" | "mitigation">[];
  /** 注入 prompt 的文本片段 */
  promptSnippet: string;
}

/**
 * Consolidation 调度配置。
 */
export interface ConsolidationSchedulerConfig {
  /** Cron 周期，默认每 6h */
  cronExpression: string;
  /** 抽样窗口（小时），默认 24 */
  sampleWindowHours: number;
  /** 抽样上限，默认 20 */
  sampleSize: number;
  /** 单轮 LLM token budget，默认 50K */
  tokenBudget: number;
  /** 是否启用（admin 可关）*/
  enabled: boolean;
}

export const DEFAULT_CONSOLIDATION_CONFIG: ConsolidationSchedulerConfig = {
  cronExpression: "0 */6 * * *", // every 6h
  sampleWindowHours: 24,
  sampleSize: 20,
  tokenBudget: 50_000,
  // ★ 2026-05-25 默认关闭:consolidation/reflection 每 6h 后台跑 LLM,属静默后台消耗,
  //   必须显式 opt-in(DB 配置 enabled=true 或 admin 开启),绝不默认开。
  enabled: false,
};

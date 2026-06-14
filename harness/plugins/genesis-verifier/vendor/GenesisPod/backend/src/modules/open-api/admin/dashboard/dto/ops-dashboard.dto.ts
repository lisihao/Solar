/**
 * Ops Dashboard DTOs — 运营看板聚合契约
 *
 * 所有金额/积分口径说明：
 * - costUsd 来自 ai_engine_metrics.estimated_cost（USD，成本唯一真源）
 * - 带 Credits / Proxy 后缀的字段是积分口径（非货币），用于近似毛利观察，禁止当真实金额使用
 */

/** 漏斗：注册 → 激活 → 留存 → 付费代理 */
export interface OpsFunnelDto {
  /** 窗内注册用户数 */
  registered: number;
  /** 窗内产生有效产出动作（completed/saved/published 且 success!=false）的去重用户数 */
  activated: number;
  /** activated 用户中近 7 天又有任意事件的去重用户数 */
  retained: number;
  /** 窗内有积分消耗（CONSUME 类）的去重用户数（付费代理指标） */
  payingProxy: number;
}

/** 同期群留存：按注册周分组 */
export interface OpsCohortDto {
  /** 该 cohort 的注册周起始日（周一，YYYY-MM-DD） */
  cohortWeek: string;
  /** 该 cohort 的用户数 */
  size: number;
  /** retention[w] = 该 cohort 用户在注册后第 w 周有事件的占比（0..1），w0..w(weeks-1) */
  retention: number[];
}

/** 单用户成本/积分聚合（成本 desc 排序） */
export interface OpsUserCostDto {
  userId: string;
  /** 显示名（username ?? email），无则 null，前端 fallback 到 userId 短码 */
  userName: string | null;
  /** 该用户窗内 ai_engine_metrics 估算成本合计（USD） */
  costUsd: number;
  /** 该用户窗内 token 合计（input + output） */
  tokens: number;
  /** 该用户窗内积分消耗合计（CONSUME 类绝对值之和，积分口径） */
  spentCredits: number;
  /** 充值/获取积分（PURCHASE/EARN 类）- 消耗积分，毛利近似（积分口径，非货币） */
  marginProxyCredits: number;
}

/** Overview 守护栏指标 */
export interface OpsOverviewGuardrailDto {
  /** 激活用户的留存率（retained / activated，0..1） */
  activatedRetentionRate: number;
}

/** Overview 聚合 */
export interface OpsOverviewDto {
  /** 总用户数 */
  totalUsers: number;
  /** 今日活跃用户数（今天有任意事件的去重用户） */
  todayActive: number;
  /** 近 7 天去重活跃用户数 */
  weeklyActive: number;
  /** 窗内总成本（USD，来自 ai_engine_metrics） */
  totalCostUsd: number;
  /** 窗内积分消耗合计（CONSUME 类绝对值之和，积分口径） */
  totalSpentCredits: number;
  /** 人均积分消耗 = totalSpentCredits / 活跃付费用户数（积分口径） */
  arpuCredits: number;
  /** 付费率 = 有积分消耗的去重用户 / 活跃用户（0..1） */
  payingRate: number;
  /** 粘性 = todayActive / weeklyActive（0..1，DAU/WAU 近似） */
  stickiness: number;
  /** 守护栏指标 */
  guardrail: OpsOverviewGuardrailDto;
}

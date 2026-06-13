import { useApiGet } from '../core';

// ──────────────── 后端契约类型（GET /admin/dashboard/*） ────────────────

/** GET /admin/dashboard/overview（W5 既有 + 本波次增强字段） */
export interface OperationOverview {
  // —— W5 既有核心计数（保持兼容，全部 optional 以防后端未补齐时不崩） ——
  totalUsers?: number;
  activeUsers?: number;
  totalMissions?: number;
  totalCostUsd?: number;
  totalTokens?: number;
  totalCredits?: number;
  // —— 本波次增强（经营护栏指标） ——
  /** 客单价（积分口径，非货币）= 充值积分 / 付费代理用户数 */
  arpuCredits?: number;
  /** 付费率 = payingProxy / registered（0..1） */
  payingRate?: number;
  /** 黏性 = 今日活跃 / 近 7 天去重活跃（0..1） */
  stickiness?: number;
  /** 护栏指标 */
  guardrail?: {
    /** 激活后留存率（0..1） */
    activatedRetentionRate?: number;
  };
}

/** GET /admin/dashboard/funnel?days=30 */
export interface OperationFunnel {
  /** 窗内注册用户 */
  registered: number;
  /** 窗内有 completed/saved/published 且 success!=false 的去重用户 */
  activated: number;
  /** 已激活用户里近 7 天又有任意事件的 */
  retained: number;
  /** 窗内有积分消耗（CONSUME）的去重用户 */
  payingProxy: number;
}

/** GET /admin/dashboard/cohort?weeks=8 单条 cohort */
export interface OperationCohort {
  /** cohort 起始周（YYYY-MM-DD） */
  cohortWeek: string;
  /** 该 cohort 注册用户数 */
  size: number;
  /** retention[w] = 该 cohort 用户在第 w 周有事件的占比（0..1），w0..w(weeks-1） */
  retention: number[];
}

/** GET /admin/dashboard/userCost?days=30&limit=20 单行 */
export interface OperationUserCost {
  userId: string;
  /** 显示名（username ?? email），无则 null，前端 fallback 到 userId 短码 */
  userName: string | null;
  /** 货币成本（唯一真源 ai_engine_metrics 聚合） */
  costUsd: number;
  /** token 数（in+out） */
  tokens: number;
  /** 消耗积分（credit_transactions CONSUME 求和） */
  spentCredits: number;
  /** 毛利代理（充值积分 PURCHASE+EARN - 消耗积分），积分口径非货币 */
  marginProxyCredits: number;
}

/** GET /admin/dashboard/modules 单行（模块健康横表） */
export interface ModuleHealthRow {
  module: string;
  activeUsers: number;
  started: number;
  completed: number;
  failed: number;
  /** completed / started（started 为 0 时 0），可能是 0-1 或 0-100 */
  completionRate: number;
}

/** GET /admin/dashboard/topics 单行（热门主题） */
export interface TopicRow {
  topicKey: string;
  count: number;
}

// ──────────────── Hook ────────────────

export interface UseOperationMetricsOptions {
  /** 漏斗 / 成本时间窗（天），默认 30 */
  days?: number;
  /** cohort 周数，默认 8 */
  weeks?: number;
  /** userCost top N，默认 20 */
  costLimit?: number;
}

/**
 * 运营看板数据聚合 hook —— 串接后端 /admin/dashboard/* 全部端点。
 *
 * 失败降级：后端任一端点失败时，对应 data 为 undefined，组件侧用 ?? 兜底为空，
 * 整屏不因单端点失败而白屏（与后端 safeRows 0/空 降级口径一致）。
 */
export function useOperationMetrics(options: UseOperationMetricsOptions = {}) {
  const { days = 30, weeks = 8, costLimit = 20 } = options;

  const overview = useApiGet<OperationOverview>('/admin/dashboard/overview', {
    immediate: true,
  });

  const funnel = useApiGet<OperationFunnel>(
    `/admin/dashboard/funnel?days=${days}`,
    { immediate: true, deps: [days] }
  );

  const cohort = useApiGet<OperationCohort[]>(
    `/admin/dashboard/cohort?weeks=${weeks}`,
    { immediate: true, deps: [weeks] }
  );

  const userCost = useApiGet<OperationUserCost[]>(
    `/admin/dashboard/userCost?days=${days}&limit=${costLimit}`,
    { immediate: true, deps: [days, costLimit] }
  );

  const modules = useApiGet<ModuleHealthRow[]>(
    `/admin/dashboard/modules?days=${days}`,
    { immediate: true, deps: [days] }
  );

  const topics = useApiGet<TopicRow[]>(`/admin/dashboard/topics?days=${days}`, {
    immediate: true,
    deps: [days],
  });

  const refreshAll = () => {
    void overview.refresh();
    void funnel.refresh();
    void cohort.refresh();
    void userCost.refresh();
    void modules.refresh();
    void topics.refresh();
  };

  return {
    overview: overview.data,
    funnel: funnel.data,
    cohort: cohort.data ?? [],
    userCost: userCost.data ?? [],
    modules: modules.data ?? [],
    topics: topics.data ?? [],

    loading:
      overview.loading ||
      funnel.loading ||
      cohort.loading ||
      userCost.loading ||
      modules.loading ||
      topics.loading,
    error:
      overview.error ||
      funnel.error ||
      cohort.error ||
      userCost.error ||
      modules.error ||
      topics.error ||
      null,

    refreshAll,
  };
}

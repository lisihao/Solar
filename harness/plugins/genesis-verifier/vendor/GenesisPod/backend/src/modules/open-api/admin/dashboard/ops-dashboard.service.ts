import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import type {
  OpsFunnelDto,
  OpsCohortDto,
  OpsUserCostDto,
  OpsOverviewDto,
} from "./dto/ops-dashboard.dto";

/**
 * OpsDashboardService — 运营看板聚合服务
 *
 * 数据来源（snake_case 真实表，全部走 $queryRaw 参数化）：
 * - user_events(user_id, module, action, topic_key, success, created_at) —— 行为事件
 * - ai_engine_metrics(user_id, estimated_cost, input_tokens, output_tokens, created_at) —— 成本唯一真源
 * - users(id, created_at)
 * - credit_transactions(account_id, type, amount, created_at) ←→ credit_accounts(id, user_id)
 *
 * 设计原则：
 * - 所有查询失败一律降级为 0 / 空数组（safeRows / safeRow 封装），不让看板因单表缺失而 500
 * - 成本只用 ai_engine_metrics.estimated_cost（USD），积分口径字段带 Credits/Proxy 明示
 * - CreditTransactionType 无 CONSUME/PURCHASE/EARN，按真实枚举归类（见 CONSUME_TYPES / EARN_TYPES）
 */
@Injectable()
export class OpsDashboardService {
  private readonly logger = new Logger(OpsDashboardService.name);

  /** 消耗类积分交易（对应需求里的 "CONSUME"） */
  private static readonly CONSUME_TYPES = [
    "AI_ASK",
    "AI_TEAMS",
    "AI_OFFICE",
    "AI_SIMULATION",
    "AI_WRITING",
    "AI_IMAGE",
    "AI_SOCIAL",
    "AI_RESEARCH",
    "AI_INSIGHTS",
    "NOTEBOOK_RESEARCH",
    "AI_PLANNING",
    "EXPLORE",
    "LIBRARY",
    "NOTES",
    "COLLECTIONS",
  ];

  /** 充值/获取类积分交易（对应需求里的 "PURCHASE/EARN"） */
  private static readonly EARN_TYPES = [
    "INITIAL",
    "DAILY_CHECKIN",
    "TASK_REWARD",
    "REFERRAL_BONUS",
    "ADMIN_GRANT",
    "COMPENSATION",
    "DONATION_REWARD",
    "DONATION_USAGE_REWARD",
  ];

  /** 有效产出动作（激活判定） */
  private static readonly ACTIVATION_ACTIONS = [
    "completed",
    "saved",
    "published",
  ];

  constructor(private readonly prisma: PrismaService) {}

  // ----------------------------------------------------------------------------
  // 现有端点（保留不破坏）：overview / modules / topics
  // ----------------------------------------------------------------------------

  /**
   * /overview —— 运营总览（增强：arpuCredits / payingRate / stickiness / guardrail）
   */
  async getOverview(days = 30): Promise<OpsOverviewDto> {
    const since = this.sinceDate(days);
    const today = this.startOfToday();
    const sevenDaysAgo = this.sinceDate(7);

    const [
      totalUsers,
      todayActive,
      weeklyActive,
      totalCostUsd,
      totalSpentCredits,
      payingUsers,
      activated,
      retained,
    ] = await Promise.all([
      this.countUsers(),
      this.countActiveUsers(today),
      this.countActiveUsers(sevenDaysAgo),
      this.sumCostUsd(since),
      this.sumSpentCredits(since),
      this.countPayingUsers(since),
      this.countActivatedUsers(since),
      this.countRetainedUsers(since, sevenDaysAgo),
    ]);

    const payingRate =
      weeklyActive > 0 ? this.round(payingUsers / weeklyActive, 4) : 0;
    const arpuCredits =
      payingUsers > 0 ? this.round(totalSpentCredits / payingUsers, 2) : 0;
    const stickiness =
      weeklyActive > 0 ? this.round(todayActive / weeklyActive, 4) : 0;
    const activatedRetentionRate =
      activated > 0 ? this.round(retained / activated, 4) : 0;

    return {
      totalUsers,
      todayActive,
      weeklyActive,
      totalCostUsd: this.round(totalCostUsd, 6),
      totalSpentCredits,
      arpuCredits,
      payingRate,
      stickiness,
      guardrail: { activatedRetentionRate },
    };
  }

  /**
   * /modules —— 按模块聚合事件量（窗内）
   */
  async getModules(
    days = 30,
  ): Promise<Array<{ module: string; events: number; users: number }>> {
    const since = this.sinceDate(days);
    const rows = await this.safeRows<{
      module: string | null;
      events: bigint;
      users: bigint;
    }>(
      () => this.prisma.$queryRaw`
        SELECT module,
               count(*)::bigint AS events,
               count(DISTINCT user_id)::bigint AS users
        FROM user_events
        WHERE created_at >= ${since}
        GROUP BY module
        ORDER BY events DESC
      `,
    );
    return rows.map((r) => ({
      module: r.module ?? "unknown",
      events: this.toNumber(r.events),
      users: this.toNumber(r.users),
    }));
  }

  /**
   * /topics —— 按 topic_key 聚合事件量（窗内 top 50）
   */
  async getTopics(
    days = 30,
    limit = 50,
  ): Promise<Array<{ topicKey: string; events: number; users: number }>> {
    const since = this.sinceDate(days);
    const cap = this.clampLimit(limit, 50);
    const rows = await this.safeRows<{
      topic_key: string | null;
      events: bigint;
      users: bigint;
    }>(
      () => this.prisma.$queryRaw`
        SELECT topic_key,
               count(*)::bigint AS events,
               count(DISTINCT user_id)::bigint AS users
        FROM user_events
        WHERE created_at >= ${since} AND topic_key IS NOT NULL
        GROUP BY topic_key
        ORDER BY events DESC
        LIMIT ${cap}
      `,
    );
    return rows.map((r) => ({
      topicKey: r.topic_key ?? "unknown",
      events: this.toNumber(r.events),
      users: this.toNumber(r.users),
    }));
  }

  // ----------------------------------------------------------------------------
  // 新增端点：funnel / cohort / userCost
  // ----------------------------------------------------------------------------

  /**
   * /funnel —— 注册 → 激活 → 留存 → 付费代理
   */
  async getFunnel(days = 30): Promise<OpsFunnelDto> {
    const since = this.sinceDate(days);
    const sevenDaysAgo = this.sinceDate(7);

    const [registered, activated, retained, payingProxy] = await Promise.all([
      this.countRegistered(since),
      this.countActivatedUsers(since),
      this.countRetainedUsers(since, sevenDaysAgo),
      this.countPayingUsers(since),
    ]);

    return { registered, activated, retained, payingProxy };
  }

  /**
   * /cohort —— 按注册周分组的留存矩阵
   * retention[w] = 该 cohort 用户在注册后第 w 周（w0..w(weeks-1)）有事件的占比（0..1）
   */
  async getCohort(weeks = 8): Promise<OpsCohortDto[]> {
    const w = this.clampLimit(weeks, 8, 26);
    const since = this.sinceDate(w * 7);

    // 1) cohort 规模：按注册周（周一对齐）分组
    const cohortRows = await this.safeRows<{
      cohort_week: Date;
      size: bigint;
    }>(
      () => this.prisma.$queryRaw`
        SELECT date_trunc('week', created_at)::date AS cohort_week,
               count(*)::bigint AS size
        FROM users
        WHERE created_at >= ${since}
        GROUP BY cohort_week
        ORDER BY cohort_week ASC
      `,
    );

    if (cohortRows.length === 0) return [];

    // 2) 每个 cohort 各周活跃用户数：以注册周为基准计算 week offset
    const activityRows = await this.safeRows<{
      cohort_week: Date;
      week_offset: number;
      active_users: bigint;
    }>(
      () => this.prisma.$queryRaw`
        SELECT c.cohort_week,
               c.week_offset,
               count(DISTINCT c.user_id)::bigint AS active_users
        FROM (
          SELECT u.id AS user_id,
                 date_trunc('week', u.created_at)::date AS cohort_week,
                 floor(
                   extract(epoch FROM (date_trunc('week', e.created_at) - date_trunc('week', u.created_at)))
                   / (7 * 24 * 60 * 60)
                 )::int AS week_offset
          FROM users u
          JOIN user_events e ON e.user_id = u.id
          WHERE u.created_at >= ${since}
        ) c
        WHERE c.week_offset >= 0 AND c.week_offset < ${w}
        GROUP BY c.cohort_week, c.week_offset
      `,
    );

    // 3) 组装矩阵
    const sizeByWeek = new Map<string, number>();
    for (const row of cohortRows) {
      sizeByWeek.set(this.toIsoDate(row.cohort_week), this.toNumber(row.size));
    }

    const activeByWeekOffset = new Map<string, Map<number, number>>();
    for (const row of activityRows) {
      const key = this.toIsoDate(row.cohort_week);
      if (!activeByWeekOffset.has(key)) activeByWeekOffset.set(key, new Map());
      activeByWeekOffset
        .get(key)!
        .set(Number(row.week_offset), this.toNumber(row.active_users));
    }

    return cohortRows.map((row) => {
      const key = this.toIsoDate(row.cohort_week);
      const size = sizeByWeek.get(key) ?? 0;
      const offsets = activeByWeekOffset.get(key);
      const retention: number[] = [];
      for (let i = 0; i < w; i++) {
        const active = offsets?.get(i) ?? 0;
        retention.push(size > 0 ? this.round(active / size, 4) : 0);
      }
      return { cohortWeek: key, size, retention };
    });
  }

  /**
   * /userCost —— 单用户成本/积分聚合，按 costUsd desc 取 top limit
   */
  async getUserCost(days = 30, limit = 20): Promise<OpsUserCostDto[]> {
    const since = this.sinceDate(days);
    const cap = this.clampLimit(limit, 20, 200);

    // 1) 成本/token（唯一真源 ai_engine_metrics），按 user 聚合取 top
    const costRows = await this.safeRows<{
      user_id: string;
      cost_usd: number | null;
      tokens: bigint | null;
    }>(
      () => this.prisma.$queryRaw`
        SELECT user_id,
               COALESCE(sum(estimated_cost), 0)::float8 AS cost_usd,
               COALESCE(sum(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0)::bigint AS tokens
        FROM ai_engine_metrics
        WHERE created_at >= ${since} AND user_id IS NOT NULL
        GROUP BY user_id
        ORDER BY cost_usd DESC
        LIMIT ${cap}
      `,
    );

    if (costRows.length === 0) return [];

    const userIds = costRows.map((r) => r.user_id);

    // 2) 这批用户的积分消耗 / 充值（join credit_accounts 拿 user_id）
    const creditRows = await this.safeRows<{
      user_id: string;
      spent: bigint | null;
      earned: bigint | null;
    }>(
      () => this.prisma.$queryRaw`
        SELECT a.user_id,
               COALESCE(sum(CASE WHEN t.type::text = ANY(${OpsDashboardService.CONSUME_TYPES}::text[]) THEN abs(t.amount) ELSE 0 END), 0)::bigint AS spent,
               COALESCE(sum(CASE WHEN t.type::text = ANY(${OpsDashboardService.EARN_TYPES}::text[]) THEN t.amount ELSE 0 END), 0)::bigint AS earned
        FROM credit_transactions t
        JOIN credit_accounts a ON a.id = t.account_id
        WHERE t.created_at >= ${since} AND a.user_id = ANY(${userIds}::text[])
        GROUP BY a.user_id
      `,
    );

    const creditByUser = new Map<string, { spent: number; earned: number }>();
    for (const row of creditRows) {
      creditByUser.set(row.user_id, {
        spent: this.toNumber(row.spent),
        earned: this.toNumber(row.earned),
      });
    }

    // 3) 这批用户的显示名（username / email），避免表格里裸显 UUID
    const userRows = await this.safeRows<{
      id: string;
      username: string | null;
      email: string | null;
    }>(
      () => this.prisma.$queryRaw`
        SELECT id, username, email
        FROM users
        WHERE id = ANY(${userIds}::text[])
      `,
    );
    const userInfoMap = new Map<
      string,
      { username: string | null; email: string | null }
    >();
    for (const u of userRows) {
      userInfoMap.set(u.id, { username: u.username, email: u.email });
    }

    return costRows.map((r) => {
      const credit = creditByUser.get(r.user_id) ?? { spent: 0, earned: 0 };
      const info = userInfoMap.get(r.user_id);
      return {
        userId: r.user_id,
        userName: info?.username ?? info?.email ?? null,
        costUsd: this.round(Number(r.cost_usd ?? 0), 6),
        tokens: this.toNumber(r.tokens),
        spentCredits: credit.spent,
        marginProxyCredits: credit.earned - credit.spent,
      };
    });
  }

  // ----------------------------------------------------------------------------
  // 内部聚合基元（全部 safe，失败降级 0/空）
  // ----------------------------------------------------------------------------

  private async countUsers(): Promise<number> {
    const row = await this.safeRow<{ count: bigint }>(
      () => this.prisma.$queryRaw`SELECT count(*)::bigint AS count FROM users`,
    );
    return this.toNumber(row?.count);
  }

  private async countRegistered(since: Date): Promise<number> {
    const row = await this.safeRow<{ count: bigint }>(
      () => this.prisma.$queryRaw`
        SELECT count(*)::bigint AS count FROM users WHERE created_at >= ${since}
      `,
    );
    return this.toNumber(row?.count);
  }

  /** 某时间点以来有任意事件的去重用户数 */
  private async countActiveUsers(since: Date): Promise<number> {
    const row = await this.safeRow<{ count: bigint }>(
      () => this.prisma.$queryRaw`
        SELECT count(DISTINCT user_id)::bigint AS count
        FROM user_events
        WHERE created_at >= ${since}
      `,
    );
    return this.toNumber(row?.count);
  }

  /** 窗内有效产出动作（completed/saved/published 且 success!=false）的去重用户数 */
  private async countActivatedUsers(since: Date): Promise<number> {
    const row = await this.safeRow<{ count: bigint }>(
      () => this.prisma.$queryRaw`
        SELECT count(DISTINCT user_id)::bigint AS count
        FROM user_events
        WHERE created_at >= ${since}
          AND action = ANY(${OpsDashboardService.ACTIVATION_ACTIONS}::text[])
          AND success IS DISTINCT FROM false
      `,
    );
    return this.toNumber(row?.count);
  }

  /** 激活用户中近 7 天又有任意事件的去重用户数 */
  private async countRetainedUsers(
    since: Date,
    recentSince: Date,
  ): Promise<number> {
    const row = await this.safeRow<{ count: bigint }>(
      () => this.prisma.$queryRaw`
        SELECT count(DISTINCT a.user_id)::bigint AS count
        FROM (
          SELECT DISTINCT user_id
          FROM user_events
          WHERE created_at >= ${since}
            AND action = ANY(${OpsDashboardService.ACTIVATION_ACTIONS}::text[])
            AND success IS DISTINCT FROM false
        ) a
        JOIN user_events r ON r.user_id = a.user_id AND r.created_at >= ${recentSince}
      `,
    );
    return this.toNumber(row?.count);
  }

  /** 窗内有积分消耗（CONSUME 类）的去重用户数 */
  private async countPayingUsers(since: Date): Promise<number> {
    const row = await this.safeRow<{ count: bigint }>(
      () => this.prisma.$queryRaw`
        SELECT count(DISTINCT a.user_id)::bigint AS count
        FROM credit_transactions t
        JOIN credit_accounts a ON a.id = t.account_id
        WHERE t.created_at >= ${since}
          AND t.type::text = ANY(${OpsDashboardService.CONSUME_TYPES}::text[])
      `,
    );
    return this.toNumber(row?.count);
  }

  /** 窗内 ai_engine_metrics 估算成本合计（USD） */
  private async sumCostUsd(since: Date): Promise<number> {
    const row = await this.safeRow<{ total: number | null }>(
      () => this.prisma.$queryRaw`
        SELECT COALESCE(sum(estimated_cost), 0)::float8 AS total
        FROM ai_engine_metrics
        WHERE created_at >= ${since}
      `,
    );
    return Number(row?.total ?? 0);
  }

  /** 窗内积分消耗合计（CONSUME 类绝对值之和） */
  private async sumSpentCredits(since: Date): Promise<number> {
    const row = await this.safeRow<{ total: bigint | null }>(
      () => this.prisma.$queryRaw`
        SELECT COALESCE(sum(abs(amount)), 0)::bigint AS total
        FROM credit_transactions
        WHERE created_at >= ${since}
          AND type::text = ANY(${OpsDashboardService.CONSUME_TYPES}::text[])
      `,
    );
    return this.toNumber(row?.total);
  }

  // ----------------------------------------------------------------------------
  // 工具方法（safeRows / safeRow / round / toNumber / 日期窗口）
  // ----------------------------------------------------------------------------

  /** 执行原始查询，失败降级为空数组 */
  private async safeRows<T>(fn: () => Promise<unknown>): Promise<T[]> {
    try {
      const result = (await fn()) as T[];
      return Array.isArray(result) ? result : [];
    } catch (e) {
      this.logger.warn(
        `OpsDashboard query failed, degrading to []: ${String(e)}`,
      );
      return [];
    }
  }

  /** 执行原始查询，取第一行，失败降级为 null */
  private async safeRow<T>(fn: () => Promise<unknown>): Promise<T | null> {
    const rows = await this.safeRows<T>(fn);
    return rows[0] ?? null;
  }

  /** bigint / number / null 统一转 number（NaN 归 0） */
  private toNumber(value: bigint | number | null | undefined): number {
    if (value === null || value === undefined) return 0;
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  /** 保留 n 位小数 */
  private round(value: number, digits: number): number {
    if (!Number.isFinite(value)) return 0;
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  /** N 天前的时间点 */
  private sinceDate(days: number): Date {
    const safeDays = Number.isFinite(days) && days > 0 ? Math.floor(days) : 30;
    return new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);
  }

  /** 今日 00:00（本地时区） */
  private startOfToday(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /** 限制 limit 在 [1, max]，非法回退 fallback */
  private clampLimit(value: number, fallback: number, max = 100): number {
    if (!Number.isFinite(value) || value <= 0) return fallback;
    return Math.min(Math.floor(value), max);
  }

  /** Date → YYYY-MM-DD */
  private toIsoDate(value: Date | string): string {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toISOString().slice(0, 10);
  }
}

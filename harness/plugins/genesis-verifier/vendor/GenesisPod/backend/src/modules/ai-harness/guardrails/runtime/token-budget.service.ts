/**
 * Token Budget Service
 * Token 预算管理服务 - 跟踪和执行 Token 使用限额
 *
 * 存储层：Redis（通过 CacheService），TTL 24h 与 mission 生命周期对齐。
 * Key 格式：
 *   harness:token-budget:budget:{budgetId}   → TokenBudgetEntry (JSON object)
 *   harness:token-budget:history:{budgetId}  → TokenUsageRecord[] (JSON array, latest 1000)
 */

import { Injectable, Logger } from "@nestjs/common";
import { CacheService } from "@/common/cache/cache.service";

/** Token 预算 Redis key TTL（秒）= 24h */
const BUDGET_TTL_SEC = 24 * 3600;

/** 单个 budget 最多保留的历史条数 */
const MAX_HISTORY = 1000;

/**
 * Token 预算条目
 */
export interface TokenBudgetEntry {
  /** 预算 ID（通常是 missionId 或 sessionId） */
  id: string;
  /** 最大 Token 数 */
  maxTokens: number;
  /** 已使用 Token 数 */
  usedTokens: number;
  /** 创建时间（ISO string，序列化友好） */
  createdAt: Date;
  /** 最后更新时间（ISO string，序列化友好） */
  updatedAt: Date;
}

/**
 * Token 使用记录
 */
export interface TokenUsageRecord {
  /** 所属预算 ID */
  budgetId: string;
  /** 操作名称 */
  operation: string;
  /** 输入 Token 数 */
  inputTokens: number;
  /** 输出 Token 数 */
  outputTokens: number;
  /** 总 Token 数 */
  totalTokens: number;
  /** 记录时间（ISO string，序列化友好） */
  timestamp: Date;
}

/**
 * Token 预算检查结果
 */
export interface TokenBudgetCheckResult {
  /** 是否允许 */
  allowed: boolean;
  /** 剩余 Token 数 */
  remaining: number;
  /** 使用率（0-1） */
  usageRate: number;
  /** 拒绝原因（如果不允许） */
  reason?: string;
}

// ── Redis key helpers ──────────────────────────────────────────────────────

function budgetKey(budgetId: string): string {
  return `harness:token-budget:budget:${budgetId}`;
}

function historyKey(budgetId: string): string {
  return `harness:token-budget:history:${budgetId}`;
}

/** 单独的 usedTokens 计数器 key，用 Redis INCRBY 原子累加（2026-05-15 Round 1 P1 修复 race） */
function usedKey(budgetId: string): string {
  return `harness:token-budget:used:${budgetId}`;
}

// ── Date revival after cache round-trip ───────────────────────────────────

/**
 * CacheService 通过 JSON 序列化；Date 字段会变成字符串，需要手动还原。
 */
function reviveBudget(raw: TokenBudgetEntry): TokenBudgetEntry {
  return {
    ...raw,
    createdAt: new Date(raw.createdAt),
    updatedAt: new Date(raw.updatedAt),
  };
}

function reviveRecord(raw: TokenUsageRecord): TokenUsageRecord {
  return { ...raw, timestamp: new Date(raw.timestamp) };
}

/**
 * Token 预算服务
 *
 * 负责追踪各 Mission/Session 的 Token 消耗，执行预算上限约束。
 * 状态存储在 Redis（通过 CacheService），支持 multi-pod 一致计数。
 */
@Injectable()
export class MissionTokenLedger {
  private readonly logger = new Logger(MissionTokenLedger.name);

  constructor(private readonly cache: CacheService) {}

  // ── Private helpers ──────────────────────────────────────────────────────

  /**
   * 读取 budget。usedTokens 走独立 INCRBY 计数器（cache.incrby 原子安全），
   * 其他 metadata 走 JSON。如 INCRBY 计数器缺失（崩溃 / TTL 过期）则 fall back 到 entry.usedTokens。
   */
  private async readBudget(budgetId: string): Promise<TokenBudgetEntry | null> {
    const raw = await this.cache.get<TokenBudgetEntry>(budgetKey(budgetId));
    if (!raw) return null;
    const entry = reviveBudget(raw);
    const counter = await this.cache.get<number>(usedKey(budgetId));
    if (typeof counter === "number") {
      entry.usedTokens = counter;
    }
    return entry;
  }

  private async writeBudget(entry: TokenBudgetEntry): Promise<void> {
    await this.cache.set(budgetKey(entry.id), entry, BUDGET_TTL_SEC);
    // 同步初始化独立 INCRBY 计数器到 entry.usedTokens（create 时为 0；后续 consume 用 incrby）
    await this.cache.set(usedKey(entry.id), entry.usedTokens, BUDGET_TTL_SEC);
  }

  private async readHistory(budgetId: string): Promise<TokenUsageRecord[]> {
    const raw = await this.cache.get<TokenUsageRecord[]>(historyKey(budgetId));
    return raw ? raw.map(reviveRecord) : [];
  }

  private async writeHistory(
    budgetId: string,
    records: TokenUsageRecord[],
  ): Promise<void> {
    await this.cache.set(historyKey(budgetId), records, BUDGET_TTL_SEC);
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * 创建 Token 预算
   */
  async createBudget(id: string, maxTokens: number): Promise<TokenBudgetEntry> {
    const entry: TokenBudgetEntry = {
      id,
      maxTokens,
      usedTokens: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await this.writeBudget(entry);
    await this.writeHistory(id, []);
    this.logger.debug(
      `[TokenBudget] Created budget ${id} with limit ${maxTokens} tokens`,
    );
    return entry;
  }

  /**
   * 检查是否有足够预算
   */
  async check(
    budgetId: string,
    estimatedTokens: number,
  ): Promise<TokenBudgetCheckResult> {
    const budget = await this.readBudget(budgetId);
    if (!budget) {
      // 没有预算约束时默认允许
      return { allowed: true, remaining: Infinity, usageRate: 0 };
    }

    const remaining = budget.maxTokens - budget.usedTokens;
    const usageRate =
      budget.maxTokens > 0 ? budget.usedTokens / budget.maxTokens : 0;

    if (budget.usedTokens + estimatedTokens > budget.maxTokens) {
      return {
        allowed: false,
        remaining,
        usageRate,
        reason: `Token budget exceeded: ${budget.usedTokens + estimatedTokens} > ${budget.maxTokens}`,
      };
    }

    return { allowed: true, remaining, usageRate };
  }

  /**
   * 消耗 Token 预算
   */
  async consume(
    budgetId: string,
    operation: string,
    inputTokens: number,
    outputTokens: number,
  ): Promise<void> {
    const totalTokens = inputTokens + outputTokens;

    // 记录使用历史（append + trim to MAX_HISTORY）
    const record: TokenUsageRecord = {
      budgetId,
      operation,
      inputTokens,
      outputTokens,
      totalTokens,
      timestamp: new Date(),
    };
    const history = await this.readHistory(budgetId);
    history.push(record);
    if (history.length > MAX_HISTORY) {
      history.splice(0, history.length - MAX_HISTORY);
    }
    await this.writeHistory(budgetId, history);

    // 2026-05-15 Round 1 P1 修复：用 Redis INCRBY 原子累加 usedTokens，避免并发
    // read-modify-write 竞态（两个 consume 同时读旧值各 +N 然后各自写覆盖）。
    const budget = await this.readBudget(budgetId);
    if (budget) {
      const newUsed = await this.cache.incrby(usedKey(budgetId), totalTokens);
      // metadata（maxTokens / createdAt / updatedAt）仍走 JSON；不在并发热路径
      await this.cache.set(
        budgetKey(budgetId),
        { ...budget, usedTokens: newUsed, updatedAt: new Date() },
        BUDGET_TTL_SEC,
      );

      const usageRate = budget.maxTokens > 0 ? newUsed / budget.maxTokens : 0;
      if (usageRate >= 0.9) {
        this.logger.warn(
          `[TokenBudget] Budget ${budgetId} at ${(usageRate * 100).toFixed(1)}% usage (${newUsed}/${budget.maxTokens})`,
        );
      }
    }

    this.logger.debug(
      `[TokenBudget] Budget ${budgetId} consumed ${totalTokens} tokens for "${operation}"`,
    );
  }

  /**
   * 获取预算状态
   */
  async getBudget(budgetId: string): Promise<TokenBudgetEntry | null> {
    return this.readBudget(budgetId);
  }

  /**
   * 获取预算使用历史
   */
  async getUsageHistory(budgetId: string): Promise<TokenUsageRecord[]> {
    return this.readHistory(budgetId);
  }

  /**
   * 获取预算汇总统计
   */
  async getSummary(budgetId: string): Promise<{
    totalUsed: number;
    maxTokens: number;
    remaining: number;
    usageRate: number;
    operationCount: number;
  } | null> {
    const budget = await this.readBudget(budgetId);
    if (!budget) return null;

    const history = await this.readHistory(budgetId);
    const remaining = Math.max(0, budget.maxTokens - budget.usedTokens);

    return {
      totalUsed: budget.usedTokens,
      maxTokens: budget.maxTokens,
      remaining,
      usageRate:
        budget.maxTokens > 0 ? budget.usedTokens / budget.maxTokens : 0,
      operationCount: history.length,
    };
  }

  /**
   * 删除预算（任务完成后清理）
   */
  async deleteBudget(budgetId: string): Promise<void> {
    await this.cache.del(budgetKey(budgetId));
    await this.cache.del(historyKey(budgetId));
    await this.cache.del(usedKey(budgetId)); // P1 fix: 同步清 INCRBY 计数器
    this.logger.debug(`[TokenBudget] Deleted budget ${budgetId}`);
  }

  /**
   * 获取所有活跃预算数量
   *
   * 注意：Redis 模式下无法高效统计全局 key 数，此处始终返回 0。
   * 调用方不应依赖此值做生产逻辑判断（主要用于监控/日志）。
   */
  async getActiveBudgetCount(): Promise<number> {
    return 0;
  }
}

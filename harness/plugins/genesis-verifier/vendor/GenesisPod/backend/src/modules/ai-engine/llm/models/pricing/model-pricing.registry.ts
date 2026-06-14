/**
 * ModelPricingRegistry — 模型 → tier + per-token 价格 的中央表
 *
 * 用途：
 *   1. BudgetAccountant.accountLLM 时按 modelId 计算实际 costUsd
 *   2. BudgetAccountant.downgrade() 时按 tier 选下一个 modelId
 *   3. ReActLoop / Reflexion / PlanAct 共用，避免散落硬编码
 *
 * 数据源：**唯一来源是 DB `AIModel` 表**（priceInputPerMillion / priceOutputPerMillion
 * / priceCacheReadPerMillion / costTier）。OnApplicationBootstrap 时从 DB hydrate。
 * 不再持有 DEFAULT_TABLE 硬编码——模型每月新增，硬编码必然过时。BYOK 模型管理员
 * 在后台填好价格 + tier，注册表自然包含。
 *
 * Fallback 行为：
 *   - get(unknownModelId) → null（caller 决定怎么办，不假装数据存在）
 *   - estimateCost(unknownModelId) → null（**不再静默返 0**——0 USD 会让
 *     BudgetAccountant 永远算 0 成本，downgrade 永不触发，是假账）
 *   - pickModelForTier(tier) → 该 tier 下注册的第一个 modelId 或 null
 */

import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  Optional,
} from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";

// ★ ModelTier: pricing 层独立定义（符合 L2 不依赖 L2.5 harness）。
//   harness/guardrails/budget 同名 type 字面一致，互不依赖。
export type ModelTier = "strong" | "standard" | "basic";

export interface ModelPricing {
  readonly modelId: string;
  readonly tier: ModelTier;
  /** USD per 1M input tokens */
  readonly inputPricePerM: number;
  /** USD per 1M output tokens */
  readonly outputPricePerM: number;
  /** USD per 1M cache-write tokens (Anthropic). undefined if N/A. */
  readonly cacheWritePricePerM?: number;
  /** USD per 1M cache-read tokens. */
  readonly cacheReadPricePerM?: number;
  /**
   * DB 行存在（costTier 已配）但 input/output 价格均未配。
   * estimateCost 对此返回 null（与未注册同语义）而非按 0 价算出 $0 假账；
   * cost 面板可经 get() 读此标记显示「未计价」。
   */
  readonly unpriced?: boolean;
}

const VALID_TIERS: ReadonlySet<ModelTier> = new Set([
  "strong",
  "standard",
  "basic",
]);

@Injectable()
export class ModelPricingRegistry implements OnApplicationBootstrap {
  private readonly logger = new Logger(ModelPricingRegistry.name);
  private readonly byId = new Map<string, ModelPricing>();
  private readonly byTier = new Map<ModelTier, string[]>();
  /** 已警告过的未知 modelId，避免日志洪水 */
  private readonly warnedUnknown = new Set<string>();

  constructor(@Optional() private readonly prisma?: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.prisma) {
      this.logger.warn(
        "PrismaService missing — pricing table will start empty. " +
          "Caller must register() entries manually (test mode only).",
      );
      return;
    }
    await this.hydrateFromDb();
  }

  /**
   * 从 AIModel 表加载所有启用的模型 → 注册价格 + tier
   * 行为：
   *   - costTier 缺失 → 跳过（warn）。管理员需在后台填好。
   *   - priceInputPerMillion / priceOutputPerMillion 缺失 → 仍注册（tier 可用），
   *     但 estimateCost 会返回 null。
   */
  async hydrateFromDb(): Promise<void> {
    if (!this.prisma) return;
    try {
      const rows = await this.prisma.aIModel.findMany({
        where: { isEnabled: true },
        select: {
          modelId: true,
          costTier: true,
          priceInputPerMillion: true,
          priceOutputPerMillion: true,
          priceCacheReadPerMillion: true,
          priceCacheWritePerMillion: true,
        },
      });

      let registered = 0;
      let skipped = 0;
      for (const row of rows) {
        if (!row.costTier) {
          skipped += 1;
          continue;
        }
        const tier = row.costTier as ModelTier;
        if (!VALID_TIERS.has(tier)) {
          this.logger.warn(
            `[hydrateFromDb] modelId=${row.modelId} has invalid costTier="${row.costTier}" (expected strong/standard/basic). Skipped.`,
          );
          skipped += 1;
          continue;
        }
        this.register({
          modelId: row.modelId,
          tier,
          inputPricePerM: row.priceInputPerMillion
            ? Number(row.priceInputPerMillion)
            : 0,
          outputPricePerM: row.priceOutputPerMillion
            ? Number(row.priceOutputPerMillion)
            : 0,
          // null 区分「价格未配」与「显式免费(0)」：Decimal(0) 走上方 Number 分支
          unpriced:
            row.priceInputPerMillion == null &&
            row.priceOutputPerMillion == null,
          cacheReadPricePerM: row.priceCacheReadPerMillion
            ? Number(row.priceCacheReadPerMillion)
            : undefined,
          cacheWritePricePerM: row.priceCacheWritePerMillion
            ? Number(row.priceCacheWritePerMillion)
            : undefined,
        });
        registered += 1;
      }
      this.logger.log(
        `hydrateFromDb done: registered=${registered}, skipped=${skipped} (missing costTier). ` +
          `Tiers: strong=${this.byTier.get("strong")?.length ?? 0}, ` +
          `standard=${this.byTier.get("standard")?.length ?? 0}, ` +
          `basic=${this.byTier.get("basic")?.length ?? 0}`,
      );
    } catch (err) {
      this.logger.error(
        `hydrateFromDb failed: ${err instanceof Error ? err.message : String(err)}. ` +
          `Pricing table will be empty.`,
      );
    }
  }

  register(entry: ModelPricing): void {
    this.byId.set(entry.modelId, entry);
    const list = this.byTier.get(entry.tier) ?? [];
    if (!list.includes(entry.modelId)) {
      this.byTier.set(entry.tier, [...list, entry.modelId]);
    }
  }

  get(modelId: string): ModelPricing | null {
    return this.byId.get(modelId) ?? null;
  }

  /**
   * 估算一次 LLM 调用的 USD 成本。
   *
   * **未注册的 modelId 返回 null**（不再返 0）—— caller 必须显式处理"未知模型"语义：
   *   - BudgetAccountant 应该把 null 当成"无法计算"，不计入 costUsd 但记录 token
   *   - 用户/管理员看到 budget 没扣到钱时知道去 DB 配 costTier + price
   *
   * 如果还想要旧的"静默返 0"行为，请显式 `?? 0` 兜底（建议加 warn）。
   */
  estimateCost(
    modelId: string,
    promptTokens: number,
    completionTokens: number,
    cacheReadTokens = 0,
    cacheWriteTokens = 0,
  ): number | null {
    const p = this.byId.get(modelId);
    if (!p) {
      if (!this.warnedUnknown.has(modelId)) {
        this.logger.warn(
          `[estimateCost] modelId="${modelId}" not in pricing registry. ` +
            `Cost cannot be calculated. Admin: open /admin/ai/models, add row with ` +
            `modelId="${modelId}", costTier (basic|standard|strong), priceInputPerMillion, ` +
            `priceOutputPerMillion to enable budget tracking. Budget enforcement will treat ` +
            `this call as $0 until configured.`,
        );
        this.warnedUnknown.add(modelId);
      }
      return null;
    }
    // 行已注册（tier 可用于 downgrade）但价格未配 → 与未注册同语义返 null，
    // 否则按 0 价算出 $0 会让 cost 面板/预算把「未计价」当「免费」（静默假账）。
    if (p.unpriced) {
      if (!this.warnedUnknown.has(modelId)) {
        this.logger.warn(
          `[estimateCost] modelId="${modelId}" registered (costTier=${p.tier}) but has no ` +
            `priceInputPerMillion/priceOutputPerMillion configured. Returning null (unpriced) ` +
            `instead of $0. Admin: fill prices at /admin/ai/models to enable cost tracking.`,
        );
        this.warnedUnknown.add(modelId);
      }
      return null;
    }
    const netInputTokens = Math.max(0, promptTokens - cacheReadTokens);
    const inputCost = (netInputTokens / 1e6) * p.inputPricePerM;
    const outputCost =
      (Math.max(0, completionTokens) / 1e6) * p.outputPricePerM;
    const cacheReadCost =
      cacheReadTokens > 0 && p.cacheReadPricePerM != null
        ? (cacheReadTokens / 1e6) * p.cacheReadPricePerM
        : 0;
    const cacheWriteCost =
      cacheWriteTokens > 0 && p.cacheWritePricePerM != null
        ? (cacheWriteTokens / 1e6) * p.cacheWritePricePerM
        : 0;
    return inputCost + outputCost + cacheReadCost + cacheWriteCost;
  }

  /**
   * 选择某 tier 下首选模型（多个时取第一个注册的，对应 DB priority desc）。
   * 未注册任何模型时返回 null —— caller 应回退到 elected model 而不是硬编码。
   */
  pickModelForTier(tier: ModelTier): string | null {
    const list = this.byTier.get(tier);
    return list && list.length > 0 ? list[0] : null;
  }

  /**
   * 把 modelId 提升为某 tier 的首选（pickModelForTier 返回它）。
   * 调用方必须先 register() 一次再 promote。
   */
  promoteToPrimary(tier: ModelTier, modelId: string): void {
    if (!this.byId.has(modelId)) {
      throw new Error(
        `[ModelPricingRegistry] cannot promote unregistered modelId="${modelId}". Call register() first.`,
      );
    }
    const list = this.byTier.get(tier) ?? [];
    const without = list.filter((m) => m !== modelId);
    this.byTier.set(tier, [modelId, ...without]);
  }

  list(): readonly ModelPricing[] {
    return [...this.byId.values()];
  }
}

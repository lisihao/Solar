/**
 * ConcurrencyPlanner —— 跨 AI App 共用的并发度推断服务
 *
 * 公式：min(max, max(min, min + (providerCount - 1) * perProviderBoost))
 * - 1 provider  → 4
 * - 2 providers → 6
 * - 3+ providers → 8
 *
 * 任意 AI App 均可注入并使用，无需各自重复实现。模型池查询走
 * ChatFacade.getAvailableModels(CHAT)。
 */

import { Injectable, Logger } from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import { ChatFacade } from "@/modules/ai-harness/facade/domain/chat.facade";

export interface ConcurrencyPlanOptions {
  /** 最小并发度 — 默认 4（即使只有 1 个 provider 也用 4） */
  min?: number;
  /** 最大并发度 — 默认 8（多 provider 也不会无限上涨） */
  max?: number;
  /** 每多 1 个 provider 增加多少并发 — 默认 2 */
  perProviderBoost?: number;
  /** 用户显式指定的并发度 — 传值时直接采用（仍会被 min/max cap） */
  userOverride?: number;
}

export interface ConcurrencyPlan {
  concurrency: number;
  providerCount: number;
  providers: string[];
  /** 推断方式来源（matrix / user-override / fallback） */
  source: "matrix" | "user-override" | "fallback";
}

@Injectable()
export class ConcurrencyPlanner {
  private readonly log = new Logger(ConcurrencyPlanner.name);

  constructor(private readonly chatFacade: ChatFacade) {}

  /**
   * 推断当前可用模型池支撑的最优并发度。
   *
   * @example
   *   const plan = await planner.plan({ userOverride: input.concurrency });
   *   // → { concurrency: 6, providerCount: 2, providers: ['openai','anthropic'], source: 'matrix' }
   */
  async plan(opts: ConcurrencyPlanOptions = {}): Promise<ConcurrencyPlan> {
    const min = opts.min ?? 4;
    const max = opts.max ?? 8;
    const boost = opts.perProviderBoost ?? 2;

    // 用户显式 override 优先 —— 必须 ≥ 1，否则视为非法（DTO 层应当已 .min(1) 校验，
    // Planner 这里只防御性兜底；不再静默 clamp 0 → 1，避免用户感知不到的语义改写）
    if (opts.userOverride != null) {
      if (opts.userOverride < 1 || !Number.isFinite(opts.userOverride)) {
        throw new Error(
          `[ConcurrencyPlanner] userOverride 必须 ≥ 1 的有限数（收到 ${opts.userOverride}）；` +
            `请在 DTO 层用 z.number().min(1) 拦截非法值`,
        );
      }
      const clamped = Math.min(opts.userOverride, max);
      return {
        concurrency: clamped,
        providerCount: 0,
        providers: [],
        source: "user-override",
      };
    }

    try {
      const models = await this.chatFacade.getAvailableModels(AIModelType.CHAT);
      const uniqueProviders = new Set(models.map((m) => m.provider));
      const providerCount = uniqueProviders.size;
      const concurrency = Math.min(
        max,
        Math.max(min, min + Math.max(0, providerCount - 1) * boost),
      );
      this.log.log(
        `[plan] ${providerCount} providers (${[...uniqueProviders].join(", ")}) → concurrency=${concurrency}`,
      );
      return {
        concurrency,
        providerCount,
        providers: [...uniqueProviders],
        source: "matrix",
      };
    } catch (err) {
      this.log.warn(
        `[plan] getAvailableModels failed (${err instanceof Error ? err.message : String(err)}), falling back to min=${min}`,
      );
      return {
        concurrency: min,
        providerCount: 0,
        providers: [],
        source: "fallback",
      };
    }
  }
}

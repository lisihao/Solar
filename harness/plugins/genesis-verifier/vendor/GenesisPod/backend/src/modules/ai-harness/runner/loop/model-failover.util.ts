/**
 * model-failover.util.ts — 共享的模型级 failover 包装器（loop 复用）
 *
 * react-loop 自带 #66 inline 实现（不动）。simple-loop / plan-act-loop 的直调
 * chat() 全部经本 helper，让 failover 策略只剩一处实现，新增 loop 想接 failover
 * 照抄一行即可，结构上杜绝"某个 loop 漏接"。
 *
 * 同时覆盖两种失败形态：
 *   - chat() THROW（strictMode 路径）→ catch → 分类 → 换模型重试
 *   - chat() 返回 {isError:true}（guardrail / 系统 key 路径）→ inspectResult
 *     探测 → 分类 → 换模型重试
 *
 * 上限 MAX_MODEL_FAILOVERS 个不同模型。AbortError / 账户预算 / NO_MODEL_CONFIGURED
 * / schema 错误不触发（由 isModelLevelFailoverError 判定）。攻防：provider 不认
 * excludeModelIds 反复返回同一模型时，靠 next!==current + attempts 上限双闸防死循环。
 */

import { Logger } from "@nestjs/common";
import {
  isModelLevelFailoverError,
  MAX_MODEL_FAILOVERS,
} from "../executor/llm-executor";

/** 对一个"返回值"（非抛错）是否构成模型级失败的探测结果。 */
export interface ModelFailoverResultProbe {
  /** 该 RETURNED 结果本身是否是模型级失败（isError）。 */
  readonly failoverable: boolean;
  /** 结果背后的真实 modelId（用于排除）；可选。 */
  readonly modelId?: string;
  /** 用于分类 + 日志的错误消息。 */
  readonly message?: string;
}

export interface ExecuteWithModelFailoverOptions<T> {
  /** 用给定 model 覆盖执行一次 chat（undefined = caller 默认模型）。 */
  readonly attempt: (modelOverride: string | undefined) => Promise<T>;
  /**
   * failover provider；缺省 → 不 failover（单次执行）。
   * excludeProviders：已失败的 provider（out of credits / no key）——provider 应
   * 排除其全部模型，让 failover 跳到不同 provider，而非在死 provider 上耗尽 cap。
   */
  readonly provider?: (
    excludeModelIds: ReadonlyArray<string>,
    excludeProviders?: ReadonlyArray<string>,
  ) => Promise<string | null | undefined>;
  /** 探测 RETURNED 结果的 isError 路径；缺省视为永不 failover。 */
  readonly inspectResult?: (result: T) => ModelFailoverResultProbe;
  /** 最多换几个模型，默认 MAX_MODEL_FAILOVERS。 */
  readonly maxFailovers?: number;
  readonly agentId?: string;
  readonly logger?: Pick<Logger, "warn">;
}

/**
 * 执行 attempt(modelOverride)，遇模型级失败时换模型重试，返回首个成功结果。
 * 换模型全部用尽仍失败：throw 路径原样抛最后一个错；isError 路径返回最后一个结果
 * （让 caller 走它既有的 isError 处理）。
 */
export async function executeWithModelFailover<T>(
  opts: ExecuteWithModelFailoverOptions<T>,
): Promise<T> {
  const cap = opts.maxFailovers ?? MAX_MODEL_FAILOVERS;
  const agentId = opts.agentId ?? "agent";
  const failed: string[] = [];
  const failedProviders: string[] = [];
  let currentModel: string | undefined; // 首次 = caller 默认
  let attempts = 0;

  const pushFailed = (id: string | undefined) => {
    if (id && !failed.includes(id)) failed.push(id);
  };
  // 从错误消息抽 provider（如 `provider "xai"`）→ 跳过其全部模型。
  const pushProvider = (message: string) => {
    const m = /provider\s+"?([a-z0-9_-]+)"?/i.exec(message);
    if (m?.[1] && !failedProviders.includes(m[1])) failedProviders.push(m[1]);
  };
  const nextModel = async (reason: string): Promise<string | null> => {
    if (!opts.provider) return null;
    let next: string | null | undefined;
    try {
      next = await opts.provider(failed, failedProviders);
    } catch (e) {
      opts.logger?.warn(
        `[${agentId}] model-failover provider threw: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return null;
    }
    // next 必须是"新"模型——provider 不认 exclude 反复返回同一个时不再继续。
    if (next && next !== currentModel && !failed.includes(next)) {
      opts.logger?.warn(
        `[${agentId}] model-failover → ${next} ` +
          `(failed=${failed.length}/${cap}, reason: ${reason.slice(0, 120)})`,
      );
      return next;
    }
    return null;
  };

  for (;;) {
    attempts++;
    const canFailover = attempts <= cap;
    let result: T;
    try {
      result = await opts.attempt(currentModel);
    } catch (err) {
      if (canFailover && isModelLevelFailoverError(err)) {
        const errMsg = err instanceof Error ? err.message : String(err);
        pushFailed(currentModel);
        pushProvider(errMsg);
        const next = await nextModel(errMsg);
        if (next) {
          currentModel = next;
          continue;
        }
      }
      throw err;
    }

    // isError-RETURN 路径（未抛错但结果本身是模型级失败）
    const probe = opts.inspectResult?.(result);
    if (
      probe?.failoverable &&
      canFailover &&
      isModelLevelFailoverError(probe.message ?? "")
    ) {
      pushFailed(probe.modelId ?? currentModel);
      pushProvider(probe.message ?? "");
      const next = await nextModel(probe.message ?? "isError result");
      if (next) {
        currentModel = next;
        continue;
      }
    }
    return result;
  }
}

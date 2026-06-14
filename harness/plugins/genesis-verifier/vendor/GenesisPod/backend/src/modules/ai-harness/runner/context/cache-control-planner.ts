/**
 * CacheControlPlanner — 自动给 LLM 调用打 prompt-cache 标记
 *
 * Anthropic 5min/1h prompt-cache：repeated prefix 1/10 价。
 * Mission 内每轮 ReAct 的 system prompt + frozen tools list + 长 reminder
 * 完全重复，自动打 cache_control 后成本降一个数量级。
 *
 * 策略：
 *   1. system prompt：永远 cache（每轮重复，最稳定）
 *   2. tools 段：cache（变化频率低）
 *   3. high-priority reminder：cache（mission 内固定）
 *   4. messages 尾部：不 cache（每轮新增）
 *
 * Anthropic 限制：最多 4 个 cache breakpoint，本规划器最多输出 3 个，留 1 给业务方。
 */

import type { IContextEnvelope } from "../../agents/abstractions";

export interface CacheBreakpoint {
  /** 在 messages/system 中的位置（'system' / index 数字） */
  readonly anchor: "system" | number;
  /** Anthropic ttl: 5min 或 1h；默认 5min（更便宜） */
  readonly ttl?: "5m" | "1h";
}

export interface SharedCachePrefix {
  /** 整段 system prompt（拼接后） —— AiChatService 透传到 provider */
  readonly systemPromptText: string;
  /** Tool 描述列表，供 provider 算 cache key */
  readonly toolDefinitions?: unknown[];
  /** 多少 reminder 计入 cache prefix（这些 reminder 在 envelope.reminders 头部） */
  readonly cachedReminderCount: number;
  /** 总 cache breakpoint 数 */
  readonly breakpoints: readonly CacheBreakpoint[];
}

/**
 * 启发式：什么内容值得 cache？
 *   - system prompt 总长 > 256 chars（ Anthropic 最低门槛 ~1024 tokens）
 *   - reminders 中 priority='high' 且 transient!=true 的
 *   - tools 列表非空
 */
export class CacheControlPlanner {
  /**
   * 默认最低 cache 门槛（chars）—— Anthropic prompt-cache 要求 prefix ≥ 1024 tokens
   * （≈ 4096 chars 启发）。低于此不打 cache，避免 cache 成本反而高于直调。
   */
  private static readonly MIN_PREFIX_CHARS = 4096;

  plan(envelope: IContextEnvelope): SharedCachePrefix | null {
    const systemText = envelope.system ?? "";
    // 把 high-priority + 非 transient reminder 拼接到 cache prefix
    const cachableReminders = envelope.reminders.filter(
      (r) => r.priority === "high" && !r.transient,
    );
    const cachedReminderText = cachableReminders
      .map((r) => `[${r.source}] ${r.content}`)
      .join("\n\n");
    const fullPrefix =
      systemText + (cachedReminderText ? `\n\n${cachedReminderText}` : "");

    if (fullPrefix.length < CacheControlPlanner.MIN_PREFIX_CHARS) {
      return null; // 太短不值得 cache
    }

    const breakpoints: CacheBreakpoint[] = [{ anchor: "system", ttl: "5m" }];

    return {
      systemPromptText: fullPrefix,
      toolDefinitions:
        envelope.tools.length > 0 ? envelope.tools.slice() : undefined,
      cachedReminderCount: cachableReminders.length,
      breakpoints,
    };
  }
}

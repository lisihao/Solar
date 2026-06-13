/**
 * PriorityPruner — 按优先级 + transient 标记裁剪 reminders
 *
 * 触发条件：envelope 的 reminder 数量超过配置上限（默认 16）。
 * 裁剪规则：
 *   1. transient 且年代久远的优先删
 *   2. 按 priority 升序（low 先删，high 后删）
 *   3. 保留最新 K 条（即使是 low 优先级），避免丢失最近上下文
 */

import { Injectable, Optional, Inject } from "@nestjs/common";
import type {
  IContextEnvelope,
  ISystemReminder,
} from "../../agents/abstractions";
import { ContextEnvelope } from "../../agents/core/context-envelope";

export const PRUNER_CONFIG_TOKEN = "HARNESS_PRUNER_CONFIG";

export interface PrunerConfig {
  maxReminders?: number;
  /** 总是保留最后 N 条 reminders */
  keepLastN?: number;
}

const DEFAULTS = {
  maxReminders: 16,
  keepLastN: 4,
};

const PRIORITY_ORDER: Record<ISystemReminder["priority"], number> = {
  low: 1,
  medium: 2,
  high: 3,
};

@Injectable()
export class PriorityPruner {
  constructor(
    @Optional()
    @Inject(PRUNER_CONFIG_TOKEN)
    private readonly config: PrunerConfig = {},
  ) {}

  /** 返回裁剪后的 envelope；如果没有触发裁剪，返回原 envelope */
  prune(envelope: IContextEnvelope): IContextEnvelope {
    const max = this.config.maxReminders ?? DEFAULTS.maxReminders;
    const keepLast = this.config.keepLastN ?? DEFAULTS.keepLastN;
    const reminders = envelope.reminders;

    if (reminders.length <= max) return envelope;

    // Always keep the last N
    const tail = reminders.slice(-keepLast);
    const head = reminders.slice(0, -keepLast);

    // Score head items: higher = more likely to keep
    const scored = head.map((r, idx) => ({
      reminder: r,
      originalIndex: idx,
      // Score: priority + recency bonus - transient penalty
      score:
        PRIORITY_ORDER[r.priority] * 10 + idx * 0.1 - (r.transient ? 5 : 0),
    }));

    // Keep (max - keepLast) highest-scored from head
    scored.sort((a, b) => b.score - a.score);
    const keepCount = Math.max(0, max - keepLast);
    const keptHead = scored
      .slice(0, keepCount)
      .sort((a, b) => a.originalIndex - b.originalIndex)
      .map((s) => s.reminder);

    const kept = [...keptHead, ...tail];

    return this.rebuild(envelope, kept);
  }

  private rebuild(
    envelope: IContextEnvelope,
    reminders: readonly ISystemReminder[],
  ): IContextEnvelope {
    if (envelope instanceof ContextEnvelope) {
      return new ContextEnvelope(
        {
          system: envelope.system,
          messages: envelope.messages,
          reminders,
          tools: envelope.tools,
          memory: envelope.memory,
          budget: envelope.budget,
          metadata: envelope.metadata,
        },
        envelope.id,
      );
    }
    return {
      ...envelope,
      reminders,
    };
  }
}

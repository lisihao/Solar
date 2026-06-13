/**
 * MemoryContextBindingService — Harness 与 MemoryCoordinator 之间的绑定层
 *
 * 职责：
 *   - preExecute()：recall 相关记忆，格式化为 system reminder 写入 envelope
 *   - postExecute()：把 agent output 持久化到 long-term memory
 *
 * 设计原则：绑定，不重写。所有实际存储由 MemoryCoordinatorService 承担。
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import type {
  IContextEnvelope,
  IMemoryBinding,
  ISystemReminder,
} from "../../agents/abstractions";
import { ContextEnvelope } from "../../agents/core/context-envelope";
import { MemoryCoordinatorService } from "../../../ai-harness/memory/coordinator/memory-coordinator.service";

export interface RecallOptions {
  query: string;
  /** 最多召回几条，默认 5 */
  limit?: number;
  /** 只查询指定层，默认全部 */
  layers?: Array<1 | 2 | 3 | 4>;
}

export interface StoreOptions {
  type: "conversation" | "working" | "preference" | "knowledge" | "summary";
  key: string;
  value: unknown;
  importance?: number;
  tags?: string[];
  ttl?: number;
}

@Injectable()
export class MemoryContextBindingService {
  private readonly logger = new Logger(MemoryContextBindingService.name);

  constructor(
    @Optional() private readonly coordinator?: MemoryCoordinatorService,
  ) {}

  /**
   * 在 Agent 执行前调用：召回相关记忆，返回注入后的新 envelope。
   */
  async preExecute(
    envelope: IContextEnvelope,
    options: RecallOptions,
  ): Promise<IContextEnvelope> {
    if (!this.coordinator || !envelope.memory.userId) {
      return envelope;
    }

    try {
      const context = await this.coordinator.recall(
        {
          query: options.query,
          limit: options.limit ?? 5,
          layers: options.layers,
        },
        envelope.memory.userId,
        envelope.memory.sessionId,
      );

      if (context.fragments.length === 0) {
        return envelope;
      }

      const content = this.formatRecalled(context.fragments);
      const reminder: ISystemReminder = {
        source: "memory-context-binding",
        priority: "medium",
        content,
      };

      // Prefer using the concrete ContextEnvelope.withReminder if available
      if (envelope instanceof ContextEnvelope) {
        return envelope.withReminder(
          reminder.content,
          reminder.priority,
          reminder.source,
        ).envelope;
      }

      // Fallback: construct a new envelope preserving immutability
      return {
        ...envelope,
        reminders: [...envelope.reminders, reminder],
      };
    } catch (err) {
      this.logger.warn(
        `[preExecute] recall failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return envelope;
    }
  }

  /**
   * 在 Agent 执行后调用：把最终输出 fire-and-forget 存入 memory。
   * 失败不抛错，避免影响主流程。
   */
  async postExecute(
    memory: IMemoryBinding,
    options: StoreOptions,
  ): Promise<void> {
    if (!this.coordinator || !memory.userId) return;
    try {
      await this.coordinator.store(
        {
          type: options.type,
          key: options.key,
          value: options.value,
          importance: options.importance,
          tags: options.tags,
          ttl: options.ttl,
        },
        memory.userId,
        memory.sessionId,
      );
    } catch (err) {
      this.logger.warn(
        `[postExecute] store failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private formatRecalled(
    fragments: readonly {
      layer: 1 | 2 | 3 | 4;
      key: string;
      value: unknown;
      relevanceScore: number;
      // PR-D 新增可选字段（MemoryCoordinator 提供时启用加权）
      createdAt?: number | Date;
      confidence?: number;
    }[],
  ): string {
    // PR-D: 综合加权（relevance × confidence × freshness）
    const now = Date.now();
    const weighted = fragments.map((f) => {
      const ageDays =
        f.createdAt != null
          ? Math.max(
              0,
              (now - new Date(f.createdAt).getTime()) / (1000 * 60 * 60 * 24),
            )
          : 0;
      // freshness decay: 30 天半衰期
      const freshness = Math.exp(-0.023 * ageDays);
      const confidence = f.confidence ?? 1;
      const score = f.relevanceScore * confidence * freshness;
      return { f, score };
    });
    // 按综合分降序，过滤极低分（< 0.1 视为噪音）
    weighted.sort((a, b) => b.score - a.score);
    const filtered = weighted.filter((w) => w.score > 0.1);

    const lines: string[] = ["## Relevant memories recalled:"];
    for (const { f, score } of filtered) {
      const value =
        typeof f.value === "string" ? f.value : JSON.stringify(f.value);
      const snippet = value.length > 200 ? `${value.slice(0, 200)}…` : value;
      lines.push(
        `- [L${f.layer} · w=${score.toFixed(2)}] ${f.key}: ${snippet}`,
      );
    }
    return lines.join("\n");
  }
}

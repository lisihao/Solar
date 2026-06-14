/**
 * MemoryAutoIndexer —— Mission 完成时自动 index agent trajectory 到 vector memory
 *
 * 触发：业务方在 PostMissionEnd hook 调 indexer.indexAgentTrajectory(agent)
 * （不直接挂 hook 防止单元测试复杂；业务层显式调用更可控）
 *
 * 抽取策略：
 *   1. 从 envelope.messages 取最后 3 条 assistant 消息（结论 / 总结）
 *   2. 从 events 取 reflection / output 事件
 *   3. 拼接 → embed → 入库（带 mission metadata）
 *
 * 容量保护：单 trajectory 最多 index 5 条（避免单 mission 占爆 namespace）
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import type { IAgent, IAgentEvent } from "../../agents/abstractions";
import { PrismaVectorStore } from "../vector/prisma-vector-store";
import { InMemoryVectorStore } from "../vector/in-memory-vector-store";
import {
  type IEmbeddingProvider,
  NoopEmbeddingProvider,
} from "../vector/embedding-provider";

export interface IndexOptions {
  /** 业务自定义 source 标识 */
  source?: string;
  /** 命名空间策略：默认 userId；业务可改 workspaceId / 'global' */
  namespace?: string;
  /** 业务标签（'mission', 'success' 等） */
  tags?: readonly string[];
  /** 业务自定义 metadata */
  metadata?: Record<string, unknown>;
  /** confidence 0..1（成功 mission 1.0；失败可设 0.3） */
  confidence?: number;
  /** 单次最多 index 几条（默认 5） */
  maxEntries?: number;
}

@Injectable()
export class MemoryAutoIndexer {
  private readonly log = new Logger(MemoryAutoIndexer.name);
  private readonly embedder: IEmbeddingProvider;

  constructor(
    @Optional() private readonly prismaStore?: PrismaVectorStore,
    @Optional() private readonly inMemStore?: InMemoryVectorStore,
    @Optional() embedder?: IEmbeddingProvider,
  ) {
    this.embedder = embedder ?? new NoopEmbeddingProvider(8);
  }

  /**
   * 从 agent 当前 envelope + 已发出的事件流（caller 提供）抽取要点入库。
   * 返回入库条目数。
   */
  async indexAgentTrajectory(
    agent: IAgent,
    events: readonly IAgentEvent[],
    options: IndexOptions = {},
  ): Promise<number> {
    const namespace =
      options.namespace ??
      agent.getEnvelope().memory.userId ??
      agent.getEnvelope().memory.workspaceId ??
      "anonymous";
    const maxEntries = options.maxEntries ?? 5;
    const candidates = this.extractCandidates(agent, events);
    if (candidates.length === 0) return 0;
    const top = candidates.slice(0, maxEntries);

    // 批量 embed
    const embeddings = await this.embedder.embedBatch(top.map((c) => c.text));

    const entries = top.map((c, i) => ({
      namespace,
      source: options.source ?? `agent:${agent.identity.role.id}`,
      entryKey: c.entryKey,
      content: c.text.slice(0, 2000),
      embedding: embeddings[i],
      confidence: options.confidence ?? 1.0,
      tags: [...(options.tags ?? [])],
      metadata: {
        ...(options.metadata ?? {}),
        agentId: agent.id,
        roleId: agent.identity.role.id,
        kind: c.kind,
      },
    }));

    // 优先 Prisma；fallback InMemory；都没就 warn
    if (this.prismaStore) {
      const n = await this.prismaStore
        .addBatch(entries)
        .catch((err: unknown) => {
          this.log.warn(
            `[auto-index] prisma batch failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          return 0;
        });
      return n;
    }
    if (this.inMemStore) {
      for (const e of entries) {
        this.inMemStore.add({
          key: e.entryKey,
          value: e.content,
          embedding: e.embedding,
          namespace: e.namespace,
          createdAt: Date.now(),
          metadata: e.metadata,
        });
      }
      return entries.length;
    }
    this.log.warn(
      `[auto-index] no vector store wired (prisma or inmem) — skip ${entries.length} entries`,
    );
    return 0;
  }

  // ── helpers ──────────────────────────────────────────

  private extractCandidates(
    agent: IAgent,
    events: readonly IAgentEvent[],
  ): { entryKey: string; text: string; kind: string }[] {
    const out: { entryKey: string; text: string; kind: string }[] = [];

    // 1. 最后 N 条 assistant 消息（agent 的结论）
    const messages = agent.getEnvelope().messages;
    const assistantMsgs = messages.filter((m) => m.role === "assistant");
    for (const m of assistantMsgs.slice(-3)) {
      if (m.content && m.content.length > 50) {
        out.push({
          entryKey: `msg:${m.timestamp ?? Date.now()}`,
          text: m.content,
          kind: "assistant_message",
        });
      }
    }

    // 2. reflection / output 事件
    for (const ev of events) {
      if (ev.type === "reflection") {
        const text = JSON.stringify(ev.payload);
        if (text.length > 50) {
          out.push({
            entryKey: `reflection:${ev.timestamp}`,
            text,
            kind: "reflection",
          });
        }
      } else if (ev.type === "output") {
        const payload = ev.payload as { output?: unknown };
        const text =
          typeof payload.output === "string"
            ? payload.output
            : JSON.stringify(payload.output);
        if (text && text.length > 30) {
          out.push({
            entryKey: `output:${ev.timestamp}`,
            text,
            kind: "final_output",
          });
        }
      }
    }
    return out;
  }
}

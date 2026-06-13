/**
 * EmbeddingRouterPort —— IEmbeddingPort 的生产实现
 *
 * 职责：
 *   1. 把 EmbeddingService 适配成 core 依赖的窄端口
 *   2. **候选描述 embedding 缓存**（静态文本，绝不每次重算——否则路由比直连还贵，
 *      自毁"省钱"卖点）。内存有界 LRU，key = kind + 文本 hash。
 *   3. 失败（服务挂 / 熔断 / 401 / 配置缺失）→ 返回 null，让 core 降级为纯信号打分，
 *      **不抛错**（对齐 election 的 last-resort 哲学）。
 */

import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "crypto";
import { EmbeddingService } from "../rag/embedding";
import type { IEmbeddingPort } from "./abstractions/routing.types";

/** 有界 LRU：插入序淘汰，容量到顶删最旧。够用、零依赖（对齐 ownership-registry 风格）。 */
class BoundedCache<V> {
  private readonly map = new Map<string, V>();
  constructor(private readonly capacity: number) {}

  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      // 命中刷新到队尾（LRU）
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  get size(): number {
    return this.map.size;
  }
}

@Injectable()
export class EmbeddingRouterPort implements IEmbeddingPort {
  private readonly logger = new Logger(EmbeddingRouterPort.name);
  // 候选描述（document）可能成百上千，给大一点；query 复用同一缓存空间。
  private readonly cache = new BoundedCache<number[]>(4096);

  constructor(private readonly embeddingService: EmbeddingService) {}

  async embed(
    text: string,
    kind: "query" | "document",
  ): Promise<number[] | null> {
    const trimmed = text.trim();
    if (trimmed.length === 0) return null;

    const cacheKey = `${kind}:${createHash("sha256")
      .update(trimmed)
      .digest("hex")}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    try {
      const res = await this.embeddingService.generateEmbedding(trimmed, {
        taskType: kind === "query" ? "query" : "document",
        // 路由 embedding 与 RAG 入库并发，关内层重试交给 embedding 自身熔断兜底
        maxRetries: 1,
      });
      const vec = res.embedding;
      if (!vec || vec.length === 0) return null;
      this.cache.set(cacheKey, vec);
      return vec;
    } catch (err) {
      // 降级而非抛错：embedding 不可用时 core 走纯信号打分
      this.logger.debug(
        `[routing] embed(${kind}) failed, degrading to signal-only: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /** 测试 / 可观测用 */
  get cacheSize(): number {
    return this.cache.size;
  }
}

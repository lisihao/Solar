/**
 * InMemoryVectorStore — PR-I 修复 #11: 不依赖外部 coordinator 的轻量向量记忆
 *
 * 设计：
 *   - 接受 embedding 函数（业务方注入；默认用 ai-engine/rag/embedding）
 *   - cosine similarity 检索；K-NN
 *   - LRU 容量控制（默认 10_000 条）
 *   - 按 sessionId / userId 隔离 namespace
 *
 * 不替代 MemoryCoordinatorService（那是企业级，含多层、合规、TTL）。
 * 本 store 用于 Harness 内 fallback，让没接 coordinator 的 App 也能拥有语义召回。
 */

import { Injectable } from "@nestjs/common";

export interface VectorEntry {
  readonly key: string;
  readonly value: unknown;
  readonly embedding: readonly number[];
  readonly namespace: string; // userId or sessionId
  readonly createdAt: number;
  readonly metadata?: Record<string, unknown>;
}

export interface RecallHit {
  readonly entry: VectorEntry;
  readonly similarity: number;
}

function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

@Injectable()
export class InMemoryVectorStore {
  private readonly entries: VectorEntry[] = [];
  /**
   * NestJS DI 不支持 plain-object constructor 参数；
   * 容量用 setCapacity() 在 OnModuleInit 时覆盖（默认 10K）。
   */
  private capacity = 10_000;

  setCapacity(capacity: number): void {
    if (capacity > 0) this.capacity = capacity;
  }

  add(entry: VectorEntry): void {
    this.entries.push(entry);
    // 可后续：FIFO 淘汰（push 即升序），用 shift 而非 sort，O(N) → O(1) 摊销
    while (this.entries.length > this.capacity) {
      this.entries.shift();
    }
  }

  /**
   * K-NN 检索。namespace 为空时全局检索；非空只检索匹配 namespace。
   */
  recall(
    queryEmbedding: readonly number[],
    options: {
      k?: number;
      namespace?: string;
      minSimilarity?: number;
    } = {},
  ): readonly RecallHit[] {
    const k = options.k ?? 5;
    const minSim = options.minSimilarity ?? 0.5;
    const candidates = options.namespace
      ? this.entries.filter((e) => e.namespace === options.namespace)
      : this.entries;
    const scored = candidates.map((entry) => ({
      entry,
      similarity: cosine(queryEmbedding, entry.embedding),
    }));
    return scored
      .filter((h) => h.similarity >= minSim)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, k);
  }

  size(): number {
    return this.entries.length;
  }

  clear(namespace?: string): void {
    if (!namespace) {
      this.entries.length = 0;
      return;
    }
    for (let i = this.entries.length - 1; i >= 0; i -= 1) {
      if (this.entries[i].namespace === namespace) this.entries.splice(i, 1);
    }
  }
}

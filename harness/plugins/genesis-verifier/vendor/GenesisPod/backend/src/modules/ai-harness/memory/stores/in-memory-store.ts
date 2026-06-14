/**
 * AI Engine - In-Memory Store
 * 内存记忆存储实现
 */

import { v4 as uuid } from "uuid";
import {
  IMemoryStore,
  IConversationMemory,
  IWorkingMemory,
  MemoryEntry,
  MemoryType,
  MemorySearchOptions,
  MemorySearchResult,
  ConversationMessage,
} from "../abstractions/memory.interface";

/**
 * 内存记忆存储
 * 注意：使用工厂模式注册，不需要 @Injectable() 装饰器
 */
export class InMemoryStore implements IMemoryStore {
  readonly id: string;
  private readonly entries = new Map<string, MemoryEntry>();

  constructor(id?: string) {
    this.id = id || uuid();
  }

  async add(
    entry: Omit<MemoryEntry, "id" | "timestamp">,
  ): Promise<MemoryEntry> {
    const newEntry: MemoryEntry = {
      ...entry,
      id: uuid(),
      timestamp: new Date(),
    };
    this.entries.set(newEntry.id, newEntry);
    return newEntry;
  }

  async addBatch(
    entries: Omit<MemoryEntry, "id" | "timestamp">[],
  ): Promise<MemoryEntry[]> {
    return Promise.all(entries.map((entry) => this.add(entry)));
  }

  async get(id: string): Promise<MemoryEntry | null> {
    return this.entries.get(id) || null;
  }

  async update(
    id: string,
    updates: Partial<MemoryEntry>,
  ): Promise<MemoryEntry | null> {
    const entry = this.entries.get(id);
    if (!entry) return null;

    const updated = { ...entry, ...updates };
    this.entries.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return this.entries.delete(id);
  }

  async search(options: MemorySearchOptions): Promise<MemorySearchResult[]> {
    let results = Array.from(this.entries.values());

    // 类型过滤
    if (options.types && options.types.length > 0) {
      results = results.filter((e) => options.types!.includes(e.type));
    }

    // 时间范围过滤
    if (options.timeRange) {
      if (options.timeRange.start) {
        results = results.filter(
          (e) => e.timestamp >= options.timeRange!.start!,
        );
      }
      if (options.timeRange.end) {
        results = results.filter((e) => e.timestamp <= options.timeRange!.end!);
      }
    }

    // 关键词搜索
    if (options.query) {
      const query = options.query.toLowerCase();
      results = results.filter((e) => e.content.toLowerCase().includes(query));
    }

    // 向量搜索（简单余弦相似度）
    let scoredResults: MemorySearchResult[];
    if (options.embedding && results.some((e) => e.embedding)) {
      scoredResults = results
        .filter((e) => e.embedding)
        .map((entry) => ({
          entry,
          score: this.cosineSimilarity(options.embedding!, entry.embedding!),
        }))
        .filter((r) => r.score >= (options.minScore || 0))
        .sort((a, b) => b.score - a.score);
    } else {
      // 按时间排序
      scoredResults = results
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
        .map((entry) => ({ entry, score: 1 }));
    }

    // 限制数量
    if (options.limit) {
      scoredResults = scoredResults.slice(0, options.limit);
    }

    return scoredResults;
  }

  async getRecent(limit: number, types?: MemoryType[]): Promise<MemoryEntry[]> {
    let entries = Array.from(this.entries.values());

    if (types && types.length > 0) {
      entries = entries.filter((e) => types.includes(e.type));
    }

    return entries
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  async cleanup(): Promise<number> {
    const now = new Date();
    let count = 0;

    for (const [id, entry] of this.entries) {
      if (entry.expiresAt && entry.expiresAt < now) {
        this.entries.delete(id);
        count++;
      }
    }

    return count;
  }

  async clear(): Promise<void> {
    this.entries.clear();
  }

  async count(types?: MemoryType[]): Promise<number> {
    if (!types || types.length === 0) {
      return this.entries.size;
    }

    let count = 0;
    for (const entry of this.entries.values()) {
      if (types.includes(entry.type)) {
        count++;
      }
    }
    return count;
  }

  /**
   * 计算余弦相似度
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }
}

/**
 * 会话记忆实现
 * 注意：使用工厂模式注册，不需要 @Injectable() 装饰器
 */
export class ConversationMemory implements IConversationMemory {
  readonly sessionId: string;
  private messages: ConversationMessage[] = [];

  constructor(sessionId?: string) {
    this.sessionId = sessionId || uuid();
  }

  async addMessage(message: ConversationMessage): Promise<void> {
    this.messages.push({
      ...message,
      id: message.id || uuid(),
      timestamp: message.timestamp || new Date(),
    });
  }

  async getMessages(limit?: number): Promise<ConversationMessage[]> {
    if (limit) {
      return this.messages.slice(-limit);
    }
    return [...this.messages];
  }

  async getContextWindow(maxTokens: number): Promise<ConversationMessage[]> {
    // 简单实现：估算 token 数，从最新消息开始取
    const result: ConversationMessage[] = [];
    let tokenCount = 0;

    for (let i = this.messages.length - 1; i >= 0; i--) {
      const message = this.messages[i];
      const messageTokens = this.estimateTokens(message.content);

      if (tokenCount + messageTokens > maxTokens) {
        break;
      }

      result.unshift(message);
      tokenCount += messageTokens;
    }

    return result;
  }

  async summarize(): Promise<string> {
    // 简单实现：返回消息数量摘要
    // 实际应用中应该调用 LLM 生成摘要
    const userMessages = this.messages.filter((m) => m.role === "user").length;
    const assistantMessages = this.messages.filter(
      (m) => m.role === "assistant",
    ).length;
    return `Conversation with ${userMessages} user messages and ${assistantMessages} assistant responses.`;
  }

  async clear(): Promise<void> {
    this.messages = [];
  }

  private estimateTokens(text: string): number {
    // 简单估算
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = text.length - chineseChars;
    return Math.ceil(chineseChars * 2 + otherChars / 4);
  }
}

/**
 * 工作记忆实现
 */
export class WorkingMemory implements IWorkingMemory {
  private readonly data = new Map<string, unknown>();

  set(key: string, value: unknown): void {
    this.data.set(key, value);
  }

  get<T>(key: string): T | undefined {
    return this.data.get(key) as T | undefined;
  }

  has(key: string): boolean {
    return this.data.has(key);
  }

  delete(key: string): boolean {
    return this.data.delete(key);
  }

  clear(): void {
    this.data.clear();
  }

  keys(): string[] {
    return Array.from(this.data.keys());
  }

  toObject(): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    for (const [key, value] of this.data) {
      obj[key] = value;
    }
    return obj;
  }
}

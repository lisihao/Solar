/**
 * AI Engine - Memory Interface
 * 记忆系统接口定义
 */

import { JsonObject } from "@/modules/ai-engine/facade/index";

/**
 * 记忆条目
 */
export interface MemoryEntry {
  id: string;
  type: MemoryType;
  content: string;
  embedding?: number[];
  metadata?: JsonObject;
  timestamp: Date;
  expiresAt?: Date;
}

/**
 * 记忆类型
 */
export type MemoryType =
  | "conversation" // 对话记忆
  | "fact" // 事实记忆
  | "episode" // 情景记忆
  | "summary" // 摘要记忆
  | "preference" // 偏好记忆
  | string; // 自定义类型

/**
 * 记忆搜索选项
 */
export interface MemorySearchOptions {
  /**
   * 搜索查询
   */
  query?: string;

  /**
   * 向量搜索
   */
  embedding?: number[];

  /**
   * 记忆类型过滤
   */
  types?: MemoryType[];

  /**
   * 时间范围
   */
  timeRange?: {
    start?: Date;
    end?: Date;
  };

  /**
   * 元数据过滤
   */
  metadata?: Record<string, unknown>;

  /**
   * 最大返回数量
   */
  limit?: number;

  /**
   * 最小相似度阈值
   */
  minScore?: number;
}

/**
 * 记忆搜索结果
 */
export interface MemorySearchResult {
  entry: MemoryEntry;
  score: number;
}

/**
 * 记忆存储接口
 */
export interface IMemoryStore {
  /**
   * 存储 ID
   */
  readonly id: string;

  /**
   * 添加记忆
   */
  add(entry: Omit<MemoryEntry, "id" | "timestamp">): Promise<MemoryEntry>;

  /**
   * 批量添加记忆
   */
  addBatch(
    entries: Omit<MemoryEntry, "id" | "timestamp">[],
  ): Promise<MemoryEntry[]>;

  /**
   * 获取记忆
   */
  get(id: string): Promise<MemoryEntry | null>;

  /**
   * 更新记忆
   */
  update(
    id: string,
    updates: Partial<MemoryEntry>,
  ): Promise<MemoryEntry | null>;

  /**
   * 删除记忆
   */
  delete(id: string): Promise<boolean>;

  /**
   * 搜索记忆
   */
  search(options: MemorySearchOptions): Promise<MemorySearchResult[]>;

  /**
   * 获取最近记忆
   */
  getRecent(limit: number, types?: MemoryType[]): Promise<MemoryEntry[]>;

  /**
   * 清理过期记忆
   */
  cleanup(): Promise<number>;

  /**
   * 清空所有记忆
   */
  clear(): Promise<void>;

  /**
   * 获取记忆数量
   */
  count(types?: MemoryType[]): Promise<number>;
}

/**
 * 会话记忆接口
 */
export interface IConversationMemory {
  /**
   * 会话 ID
   */
  readonly sessionId: string;

  /**
   * 添加消息
   */
  addMessage(message: ConversationMessage): Promise<void>;

  /**
   * 获取消息历史
   */
  getMessages(limit?: number): Promise<ConversationMessage[]>;

  /**
   * 获取上下文窗口内的消息
   */
  getContextWindow(maxTokens: number): Promise<ConversationMessage[]>;

  /**
   * 生成摘要
   */
  summarize(): Promise<string>;

  /**
   * 清空会话
   */
  clear(): Promise<void>;
}

/**
 * 会话消息
 */
export interface ConversationMessage {
  id?: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCallId?: string;
  timestamp?: Date;
  metadata?: JsonObject;
}

/**
 * 工作记忆接口
 */
export interface IWorkingMemory {
  /**
   * 设置值
   */
  set(key: string, value: unknown): void;

  /**
   * 获取值
   */
  get<T>(key: string): T | undefined;

  /**
   * 检查是否存在
   */
  has(key: string): boolean;

  /**
   * 删除值
   */
  delete(key: string): boolean;

  /**
   * 清空
   */
  clear(): void;

  /**
   * 获取所有键
   */
  keys(): string[];

  /**
   * 转换为对象
   */
  toObject(): Record<string, unknown>;
}

/**
 * 向量存储接口
 */
export interface IVectorStore {
  /**
   * 存储 ID
   */
  readonly id: string;

  /**
   * 添加向量
   */
  add(id: string, embedding: number[], metadata?: JsonObject): Promise<void>;

  /**
   * 批量添加向量
   */
  addBatch(
    items: Array<{ id: string; embedding: number[]; metadata?: JsonObject }>,
  ): Promise<void>;

  /**
   * 搜索相似向量
   */
  search(
    embedding: number[],
    limit: number,
    minScore?: number,
  ): Promise<VectorSearchResult[]>;

  /**
   * 删除向量
   */
  delete(id: string): Promise<boolean>;

  /**
   * 清空
   */
  clear(): Promise<void>;
}

/**
 * 向量搜索结果
 */
export interface VectorSearchResult {
  id: string;
  score: number;
  metadata?: JsonObject;
}

/**
 * 嵌入适配器接口
 */
export interface IEmbeddingAdapter {
  /**
   * 适配器 ID
   */
  readonly id: string;

  /**
   * 模型 ID
   */
  readonly model: string;

  /**
   * 向量维度
   */
  readonly dimensions: number;

  /**
   * 生成嵌入向量
   */
  embed(text: string): Promise<number[]>;

  /**
   * 批量生成嵌入向量
   */
  embedBatch(texts: string[]): Promise<number[][]>;
}

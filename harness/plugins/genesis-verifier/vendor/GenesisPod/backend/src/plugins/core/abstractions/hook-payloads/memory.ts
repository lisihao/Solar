/**
 * Memory hook payloads（v5.1 §11.4 CORE_HOOKS / standards/19）
 *
 * 命名规则：
 *   "harness.memory.write" → MemoryWritePayload
 *   "harness.memory.read"  → MemoryReadPayload
 */
import type { HookMeta } from "./hook-meta";

export interface MemoryWritePayload {
  readonly __version: 1;
  readonly key: string;
  /** memory 内容业务类型不透明引用 */
  readonly value: unknown;
  /** memory 类型标签（working / vector / checkpoint，业务无关分类）*/
  readonly memoryType?: string;
  readonly meta: HookMeta;
}

export interface MemoryReadPayload {
  readonly __version: 1;
  readonly key: string;
  readonly memoryType?: string;
  readonly meta: HookMeta;
}

/**
 * A2ATaskStore — A2A task contextId / message 历史的持久化存储（G3）
 *
 * 背景：A2ARpcService 此前把 contextByTask / historyByTask 放在进程内 Map，
 * 重启即丢、跨 pod 不可见 —— 违背 A2A long-running task 语义。本 store 复用
 * MissionRuntimeStateStore 同款模式：注入 CacheService（Redis）时走 Redis（跨 pod
 * 持久），未注入时优雅回退进程内 Map（单实例，行为同旧）。无 flag —— 按依赖可用性降级。
 *
 * 失败容忍：写失败仅 warn 不抛（A2A 主流程不因 cache 抖动中断）；读失败回退空。
 */
import { Injectable, Logger, Optional } from "@nestjs/common";
import { CacheService } from "@/common/cache/cache.service";
import type { Message } from "./a2a-spec.types";

const PREFIX_CTX = "a2a:task:ctx:";
const PREFIX_HIST = "a2a:task:hist:";
/** 24h —— 覆盖最长 A2A task 生命周期，与 mission runtime state TTL 对齐 */
const TTL_SECONDS = 24 * 3600;

@Injectable()
export class A2ATaskStore {
  private readonly logger = new Logger(A2ATaskStore.name);
  /** 单实例回退（CacheService 未注入时） */
  private readonly memContext = new Map<string, string>();
  private readonly memHistory = new Map<string, Message[]>();

  constructor(@Optional() private readonly cache?: CacheService) {
    if (!this.cache) {
      this.logger.warn(
        "CacheService not injected — A2A task state in in-memory mode (single-instance; lost on restart, invisible cross-pod)",
      );
    }
  }

  async setContext(taskId: string, contextId: string): Promise<void> {
    if (!this.cache) {
      this.memContext.set(taskId, contextId);
      return;
    }
    try {
      await this.cache.set(PREFIX_CTX + taskId, contextId, TTL_SECONDS);
    } catch (err) {
      this.logger.warn(
        `setContext cache write failed (${taskId}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async getContext(taskId: string): Promise<string | undefined> {
    if (!this.cache) return this.memContext.get(taskId);
    try {
      return (await this.cache.get<string>(PREFIX_CTX + taskId)) ?? undefined;
    } catch {
      return undefined;
    }
  }

  async appendHistory(taskId: string, message: Message): Promise<void> {
    if (!this.cache) {
      const hist = this.memHistory.get(taskId) ?? [];
      hist.push(message);
      this.memHistory.set(taskId, hist);
      return;
    }
    try {
      // read-modify-write：单 task 的 message 通常顺序到达，无需 CAS
      const hist =
        (await this.cache.get<Message[]>(PREFIX_HIST + taskId)) ?? [];
      hist.push(message);
      await this.cache.set(PREFIX_HIST + taskId, hist, TTL_SECONDS);
    } catch (err) {
      this.logger.warn(
        `appendHistory cache write failed (${taskId}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async getHistory(taskId: string): Promise<Message[]> {
    if (!this.cache) return this.memHistory.get(taskId) ?? [];
    try {
      return (await this.cache.get<Message[]>(PREFIX_HIST + taskId)) ?? [];
    } catch {
      return [];
    }
  }
}

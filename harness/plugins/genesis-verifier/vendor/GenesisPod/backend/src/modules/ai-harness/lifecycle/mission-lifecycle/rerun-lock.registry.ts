/**
 * RerunLockRegistry — 防同 mission 同 todo 并发重跑（分布式 Redis SET 版）
 *
 * 用户连点 2 次"重跑此任务"会创建 2 个并发重跑流，互相覆盖产物。
 * 用 Redis SET 锁住，SADD 返回 0 表示已存在 → 拒绝第二次调用。
 *
 * 设计：
 *   - 存储层：Redis SADD/SREM/SISMEMBER/SMEMBERS（多 pod 原子安全）
 *   - Key：harness:rerun-lock:{missionId}（Redis Set，成员 = todoId）
 *   - TTL：30 分钟（防 pod 重启泄漏锁）+ 业务侧主动 release()
 *   - 降级：REDIS_URL 未配置时 CacheService 自动走 in-memory 模拟
 *   - 原子语义：SADD 返回 1 = 新加（加锁成功），0 = 已存在（加锁失败）
 */

import { Injectable, Logger } from "@nestjs/common";
import { CacheService } from "@/common/cache/cache.service";

const LOCK_TTL_SECONDS = 30 * 60; // 30 分钟防泄漏
const KEY_PREFIX = "harness:rerun-lock";

function lockKey(missionId: string): string {
  return `${KEY_PREFIX}:${missionId}`;
}

@Injectable()
export class RerunLockRegistry {
  private readonly log = new Logger(RerunLockRegistry.name);

  constructor(private readonly cache: CacheService) {}

  /**
   * 原子加锁：SADD 新加返回 true，已存在返回 false。
   * 加锁成功后同时刷新 key TTL（30 min），防 pod crash 泄漏。
   */
  async acquire(missionId: string, todoId: string): Promise<boolean> {
    const added = await this.cache.sadd(lockKey(missionId), todoId);
    if (added === 1) {
      await this.cache.expire(lockKey(missionId), LOCK_TTL_SECONDS);
      return true;
    }
    this.log.warn(
      `[rerun-lock] denied — mission=${missionId} todo=${todoId} already running`,
    );
    return false;
  }

  /**
   * 释放单个 todo 锁（SREM）。
   */
  async release(missionId: string, todoId: string): Promise<void> {
    await this.cache.srem(lockKey(missionId), todoId);
  }

  /**
   * 释放 mission 下所有 todo 锁（DEL 整个 key）。
   * 通常在 mission 取消/完成时调用。
   */
  async releaseAll(missionId: string): Promise<void> {
    await this.cache.del(lockKey(missionId));
  }

  /**
   * 查询 todo 是否被锁（SISMEMBER）。
   */
  async isLocked(missionId: string, todoId: string): Promise<boolean> {
    return this.cache.sismember(lockKey(missionId), todoId);
  }

  /**
   * 返回 mission 下当前所有被锁的 todoId（SMEMBERS）。
   * 用于调试/监控。
   */
  async listLocked(missionId: string): Promise<string[]> {
    return this.cache.smembers(lockKey(missionId));
  }
}

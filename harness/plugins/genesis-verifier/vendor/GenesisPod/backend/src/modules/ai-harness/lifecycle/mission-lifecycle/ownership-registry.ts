/**
 * MissionOwnershipRegistry — 单一 ownership 接口
 *
 * controller 启动 mission 时 assign(missionId, userId)；
 * gateway/replay/cost 查 ownership 防止越权访问他人 mission。
 *
 * 简化：内存 LRU。容量 5000 mission，按 createdAt FIFO 淘汰。已结束 mission 通过
 * release() 主动清理。
 *
 * 2026-05-15 PR-E.P2 caller audit 结论：**所有 caller 已实现 DB fallback，多 pod 安全**
 *
 * 验证（业务侧 caller 已实现的 DB fallback 模式，详见各业务模块 audit 文档）：
 *   - WebSocket gateway：registry miss → await store.getById fallback + 区分
 *     SERVICE_UNAVAILABLE / MISSION_NOT_FOUND 错误码
 *   - REST controller GET：store.getById 优先，ownership 仅做 starting 占位
 *     （store 未命中时不返回 mission）—— 不会 fail-open
 *   - assertOwnership helper：registry miss → await store fallback；DB 命中后
 *     re-assign 内存（下次 hot path）
 *
 * 因此本 Registry 的 in-memory LRU 是**性能 cache**（避免每次 DB 查），跨 pod 一致性
 * 由各业务模块的 mission 表（userId 字段）作为单一权威源 + caller 层 fallback 保证。
 * 无需迁 Redis（YAGNI），无 fail-open 风险。
 *
 * ★ 职责边界（RB4）：本 Registry 是 ownership 查询的唯一接口（内存 LRU + DB fallback）。
 *   不参与 mission 活性判定，不参与孤儿回收，不依赖也不影响心跳系统。
 */

import { Injectable, Logger } from "@nestjs/common";

@Injectable()
export class MissionOwnershipRegistry {
  private readonly log = new Logger(MissionOwnershipRegistry.name);
  private readonly byId = new Map<
    string,
    { userId: string; createdAt: number }
  >();
  private readonly capacity = 5000;

  assign(missionId: string, userId: string): void {
    const existing = this.byId.get(missionId);
    // 仅在 owner 真正变更时告警（潜在冲突）；同 owner 重复 assign
    // （如 replay 反复查看同一 mission）是正常路径，不刷 WARN。
    if (existing && existing.userId !== userId) {
      this.log.warn(
        `mission ${missionId} reassigned to a different owner (${existing.userId} → ${userId})`,
      );
    }
    this.byId.set(missionId, { userId, createdAt: Date.now() });
    this.evictIfNeeded();
  }

  getOwner(missionId: string): string | undefined {
    return this.byId.get(missionId)?.userId;
  }

  release(missionId: string): void {
    this.byId.delete(missionId);
  }

  size(): number {
    return this.byId.size;
  }

  private evictIfNeeded(): void {
    if (this.byId.size <= this.capacity) return;
    // FIFO：删最旧的 1/10 entries
    const entries = [...this.byId.entries()].sort(
      (a, b) => a[1].createdAt - b[1].createdAt,
    );
    const toEvict = entries.slice(0, Math.floor(this.capacity / 10));
    for (const [id] of toEvict) this.byId.delete(id);
  }
}

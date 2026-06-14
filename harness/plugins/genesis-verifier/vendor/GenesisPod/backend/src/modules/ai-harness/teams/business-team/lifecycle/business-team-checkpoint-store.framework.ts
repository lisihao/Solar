/**
 * BusinessAgentTeam — Mission Checkpoint Store Framework (P6 Wave 1, 2026-05-24)
 *
 * @migrated-from ai-app/playground/services/mission/lifecycle/prisma-mission-checkpoint.store.ts
 *
 * 抽出 mission checkpoint 持久化通用机制 —— 实现 `MissionCheckpointStore<TPayload>` 接口。
 *
 * 机制 (framework):
 *   - reserved JSON key 双写（save: upsertJsonKey; clear: removeJsonKey）
 *   - savedAt ISO 序列化 + load 时 isNaN 验证（防外部脚本污染）
 *   - 累积 save 失败计数 + degraded 阈值告警（默认 3 次）
 *   - listResumable 应用层 cutoff 过滤
 *
 * 业务 (hooks):
 *   - JSON 容器读写策略（哪张表 / 哪个字段 / SQL 实现）
 *   - 业务方决定 reserved key 名（默认 `__checkpoint`）
 */

import { Logger } from "@nestjs/common";
import type {
  MissionCheckpointSnapshot,
  MissionCheckpointStore,
} from "../../../memory/mission-checkpoint/checkpoint-store.interface";
import {
  DEFAULT_CHECKPOINT_KEY,
  DEFAULT_DEGRADED_THRESHOLD,
  type CheckpointStoreHooks,
  type PersistedCheckpoint,
} from "./abstractions/checkpoint-store.contract";

export abstract class BusinessTeamCheckpointStoreFramework<
  TPayload,
> implements MissionCheckpointStore<TPayload> {
  protected readonly log: Logger;
  private readonly saveFailures = new Map<string, number>();
  private readonly reservedKey: string;
  private readonly degradedThreshold: number;

  constructor(
    protected readonly hooks: CheckpointStoreHooks<TPayload>,
    loggerNamespace: string,
  ) {
    this.log = new Logger(loggerNamespace);
    this.reservedKey = hooks.reservedKey ?? DEFAULT_CHECKPOINT_KEY;
    this.degradedThreshold =
      hooks.degradedThreshold ?? DEFAULT_DEGRADED_THRESHOLD;
  }

  getSaveFailures(missionId: string): number {
    return this.saveFailures.get(missionId) ?? 0;
  }

  isDegraded(missionId: string): boolean {
    return this.getSaveFailures(missionId) >= this.degradedThreshold;
  }

  resetSaveFailures(missionId: string): void {
    this.saveFailures.delete(missionId);
  }

  async save(snapshot: MissionCheckpointSnapshot<TPayload>): Promise<void> {
    const persisted: PersistedCheckpoint<TPayload> = {
      savedAt: snapshot.savedAt.toISOString(),
      payload: snapshot.payload,
      completedKeys: snapshot.completedKeys,
      status: snapshot.status,
    };
    try {
      await this.hooks.upsertJsonKey(
        snapshot.missionId,
        this.reservedKey,
        persisted,
      );
      this.saveFailures.delete(snapshot.missionId);
    } catch (err: unknown) {
      const count = (this.saveFailures.get(snapshot.missionId) ?? 0) + 1;
      this.saveFailures.set(snapshot.missionId, count);
      this.log.warn(
        `[checkpoint.save ${snapshot.missionId}] update failed (#${count}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      if (count === this.degradedThreshold) {
        this.log.error(
          `[checkpoint.save ${snapshot.missionId}] DEGRADED — ${count} consecutive failures; mission resume capability lost`,
        );
      }
    }
  }

  async load(
    missionId: string,
  ): Promise<MissionCheckpointSnapshot<TPayload> | null> {
    const json = await this.hooks
      .loadJsonContainer(missionId)
      .catch((err: unknown) => {
        this.log.warn(
          `[checkpoint.load ${missionId}] load failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return null;
      });
    if (!json) return null;
    const persisted = json[this.reservedKey] as
      | PersistedCheckpoint<TPayload>
      | undefined;
    if (!persisted) return null;
    const savedAt = new Date(persisted.savedAt);
    if (isNaN(savedAt.getTime())) {
      this.log.warn(
        `[checkpoint.load ${missionId}] savedAt invalid (${String(persisted.savedAt)}), treating as no checkpoint`,
      );
      return null;
    }
    return {
      missionId,
      savedAt,
      payload: persisted.payload,
      completedKeys: [...(persisted.completedKeys ?? [])],
      status: persisted.status,
    };
  }

  async clear(missionId: string): Promise<void> {
    const json = await this.hooks
      .loadJsonContainer(missionId)
      .catch((err: unknown) => {
        this.log.warn(
          `[checkpoint.clear ${missionId}] load failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return null;
      });
    if (!json) return;
    if (!(this.reservedKey in json)) return;
    await this.hooks
      .removeJsonKey(missionId, this.reservedKey)
      .catch((err: unknown) => {
        this.log.warn(
          `[checkpoint.clear ${missionId}] update failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
  }

  async listResumable(
    userId: string,
    olderThan?: Date,
  ): Promise<MissionCheckpointSnapshot<TPayload>[]> {
    const cutoff = olderThan?.getTime() ?? 0;
    const rows = await this.hooks
      .listRunningWithJson(userId)
      .catch((err: unknown) => {
        this.log.warn(
          `[checkpoint.listResumable user=${userId}] failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return [] as Array<{
          readonly missionId: string;
          readonly json: Record<string, unknown> | null;
        }>;
      });
    const out: MissionCheckpointSnapshot<TPayload>[] = [];
    for (const row of rows) {
      const json = row.json ?? {};
      const persisted = json[this.reservedKey] as
        | PersistedCheckpoint<TPayload>
        | undefined;
      if (!persisted) continue;
      const savedAt = new Date(persisted.savedAt);
      if (isNaN(savedAt.getTime())) continue;
      if (savedAt.getTime() < cutoff) continue;
      out.push({
        missionId: row.missionId,
        savedAt,
        payload: persisted.payload,
        completedKeys: [...(persisted.completedKeys ?? [])],
        status: persisted.status,
      });
    }
    return out;
  }
}

/**
 * InMemoryMissionCheckpointStore —— 测试 / 演示用内存实现
 *
 * 生产环境业务侧应实现自己的 store（落 DB 表）。
 */

import type {
  MissionCheckpointSnapshot,
  MissionCheckpointStore,
} from "./checkpoint-store.interface";

interface InMemoryEntry<T> {
  userId?: string;
  snapshot: MissionCheckpointSnapshot<T>;
}

export class InMemoryMissionCheckpointStore<
  TPayload = unknown,
> implements MissionCheckpointStore<TPayload> {
  private readonly entries = new Map<string, InMemoryEntry<TPayload>>();

  setUserBinding(missionId: string, userId: string): void {
    const existing = this.entries.get(missionId);
    if (existing) existing.userId = userId;
    else
      this.entries.set(missionId, {
        userId,
        snapshot: {
          missionId,
          savedAt: new Date(0),
          payload: undefined as unknown as TPayload,
          completedKeys: [],
          status: "running",
        },
      });
  }

  async save(snapshot: MissionCheckpointSnapshot<TPayload>): Promise<void> {
    const existing = this.entries.get(snapshot.missionId);
    this.entries.set(snapshot.missionId, {
      userId: existing?.userId,
      snapshot,
    });
  }

  async load(
    missionId: string,
  ): Promise<MissionCheckpointSnapshot<TPayload> | null> {
    const entry = this.entries.get(missionId);
    return entry?.snapshot ?? null;
  }

  async clear(missionId: string): Promise<void> {
    this.entries.delete(missionId);
  }

  async listResumable(
    userId: string,
    olderThan?: Date,
  ): Promise<MissionCheckpointSnapshot<TPayload>[]> {
    const cutoff = olderThan?.getTime() ?? 0;
    const results: MissionCheckpointSnapshot<TPayload>[] = [];
    for (const entry of this.entries.values()) {
      if (entry.userId !== userId) continue;
      const s = entry.snapshot;
      if (s.status !== "running" && s.status !== "paused") continue;
      if (s.savedAt.getTime() < cutoff) continue;
      results.push(s);
    }
    return results;
  }
}

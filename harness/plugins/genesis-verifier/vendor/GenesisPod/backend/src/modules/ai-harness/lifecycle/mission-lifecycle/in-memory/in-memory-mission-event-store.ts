/**
 * InMemoryMissionEventStore — IMissionEventStore 内存实现（v5.1 R1-C）
 */
import type { IMissionEventStore, MissionEventRecord } from "../abstractions";

export class InMemoryMissionEventStore implements IMissionEventStore {
  private readonly byMission = new Map<string, MissionEventRecord[]>();

  async append(event: MissionEventRecord): Promise<void> {
    const arr = this.byMission.get(event.missionId) ?? [];
    arr.push(event);
    this.byMission.set(event.missionId, arr);
  }

  async appendBatch(events: ReadonlyArray<MissionEventRecord>): Promise<void> {
    for (const e of events) {
      await this.append(e);
    }
  }

  async listByMission(
    missionId: string,
    opts: { limit?: number; sinceTs?: number } = {},
  ): Promise<MissionEventRecord[]> {
    const all = (this.byMission.get(missionId) ?? [])
      .filter((e) => (opts.sinceTs === undefined ? true : e.ts > opts.sinceTs))
      .sort((a, b) => a.ts - b.ts);
    return opts.limit !== undefined ? all.slice(0, opts.limit) : all;
  }

  async deleteByMission(missionId: string): Promise<void> {
    this.byMission.delete(missionId);
  }

  /** 测试用 */
  clearForTest(): void {
    this.byMission.clear();
  }
}

/**
 * InMemoryMissionStore — IMissionStore 内存实现（v5.1 R1-C）
 *
 * 用途：
 *   - spec / dev 环境
 *   - ai-app 在没接入数据库前的占位
 *   - PlaygroundMissionStore 实现 prisma 适配后，可参考此类的语义对齐
 */
import type {
  IMissionStore,
  MissionCreateInput,
  MissionRecord,
  MissionStatusUpdate,
  PastDecision,
} from "../abstractions";

export class InMemoryMissionStore<
  TBusiness = Record<string, unknown>,
> implements IMissionStore<TBusiness> {
  private readonly missions = new Map<string, MissionRecord<TBusiness>>();

  async create(input: MissionCreateInput): Promise<MissionRecord<TBusiness>> {
    if (this.missions.has(input.missionId)) {
      throw new Error(
        `[InMemoryMissionStore] mission "${input.missionId}" already exists`,
      );
    }
    const record: MissionRecord<TBusiness> = {
      missionId: input.missionId,
      userId: input.userId,
      tenantId: input.tenantId,
      pipelineId: input.pipelineId,
      status: "running",
      input: input.input,
      startedAt: new Date(),
      crossStageState: {},
      roleDecisions: {},
    };
    this.missions.set(input.missionId, record);
    return record;
  }

  async getById(missionId: string): Promise<MissionRecord<TBusiness> | null> {
    return this.missions.get(missionId) ?? null;
  }

  async listByUser(
    userId: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<MissionRecord<TBusiness>[]> {
    const all = Array.from(this.missions.values())
      .filter((m) => m.userId === userId)
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    const offset = opts.offset ?? 0;
    const limit = opts.limit ?? all.length;
    return all.slice(offset, offset + limit);
  }

  async updateStatus(
    missionId: string,
    update: MissionStatusUpdate,
  ): Promise<void> {
    const m = this.missions.get(missionId);
    if (!m) {
      throw new Error(
        `[InMemoryMissionStore] mission "${missionId}" not found`,
      );
    }
    this.missions.set(missionId, {
      ...m,
      status: update.status,
      completedAt: update.completedAt ?? m.completedAt,
      result: update.result ?? m.result,
      error: update.error ?? m.error,
    });
  }

  async setLastCompletedStepId(
    missionId: string,
    stepId: string,
  ): Promise<void> {
    const m = this.missions.get(missionId);
    if (!m) {
      throw new Error(
        `[InMemoryMissionStore] mission "${missionId}" not found`,
      );
    }
    this.missions.set(missionId, { ...m, lastCompletedStepId: stepId });
  }

  async appendDecision(
    missionId: string,
    roleId: string,
    decision: PastDecision,
  ): Promise<void> {
    const m = this.missions.get(missionId);
    if (!m) {
      throw new Error(
        `[InMemoryMissionStore] mission "${missionId}" not found`,
      );
    }
    const newDecisions = {
      ...m.roleDecisions,
      [roleId]: [...(m.roleDecisions[roleId] ?? []), decision],
    };
    this.missions.set(missionId, { ...m, roleDecisions: newDecisions });
  }

  async getDecisions(
    missionId: string,
    roleId: string,
  ): Promise<ReadonlyArray<PastDecision>> {
    const m = this.missions.get(missionId);
    if (!m) return [];
    return m.roleDecisions[roleId] ?? [];
  }

  async saveCrossStageState(
    missionId: string,
    state: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const m = this.missions.get(missionId);
    if (!m) {
      throw new Error(
        `[InMemoryMissionStore] mission "${missionId}" not found`,
      );
    }
    this.missions.set(missionId, { ...m, crossStageState: { ...state } });
  }

  async getCrossStageState(
    missionId: string,
  ): Promise<Readonly<Record<string, unknown>>> {
    const m = this.missions.get(missionId);
    return m?.crossStageState ?? {};
  }

  /** 测试用 */
  clearForTest(): void {
    this.missions.clear();
  }

  size(): number {
    return this.missions.size;
  }
}

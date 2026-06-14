/**
 * BusinessAgentTeam — Mission Store contract (P6 Wave 1, 2026-05-24)
 *
 * @migrated-from ai-app/playground/services/mission/lifecycle/mission-store.service.ts
 *
 * Mission CRUD / heartbeat / stage 进度 / orphan cleanup 通用机制。
 *
 * 业务方注入：
 *   - Prisma delegate（业务表名 agent_playground_missions / social_missions / ...）
 *   - failureCode 列名 / status 字符串约定
 *   - create payload shape（业务字段）
 */

/** 机制层的 mission heartbeat row pick（业务方 select 这些列）。 */
export interface MissionHeartbeatRow {
  readonly id: string;
  readonly userId: string;
}

/** Generic create payload —— 业务方扩展。 */
export interface MissionCreateBaseInput {
  readonly id: string;
  readonly userId: string;
  readonly workspaceId?: string;
}

/**
 * 业务方提供的 mission store hooks。
 *
 * 机制：
 *   - refreshHeartbeat / clearHeartbeat / cleanupOrphanRunningMissionsAtomic / markStageComplete / countRunningByUser
 *
 * 业务字段（hooks 注入）：
 *   - Prisma delegate 实例（业务表）
 *   - row missing 判定（Prisma error code 通常 P2003/P2025）
 *   - 应急 abort 钩子（mission row 蒸发时触发）
 *   - orphan cleanup 时的 failureCode + errorMessage 文案（业务专属）
 */
export interface MissionStoreHooks<
  TCreateInput extends MissionCreateBaseInput,
> {
  /** 业务方负责 create（含表 / 业务字段 / status='running' 初始化）。 */
  readonly createMission: (input: TCreateInput) => Promise<void>;
  /** 写 heartbeat（update where id；业务方决定列名 heartbeatAt / podId）。 */
  readonly writeHeartbeat: (missionId: string, podId: string) => Promise<void>;
  /** 清 heartbeat（条件 where{id, userId}）。 */
  readonly resetHeartbeat: (missionId: string, userId: string) => Promise<void>;
  /** 查询 stale-heartbeat running mission。 */
  readonly findOrphanRunning: (
    cutoff: Date,
    limit: number,
  ) => Promise<readonly MissionHeartbeatRow[]>;
  /**
   * P-DUR2 (2026-05-30): 多 pod 安全的**原子认领**单个 orphan。
   *
   * 实现必须用条件 updateMany(WHERE id, status='running') 并返回更新行数：
   *   - count === 1 → 本 pod 认领赢家（返回 true）：唯一被授权续跑该 mission 的 pod
   *   - count === 0 → 其它 pod 已抢先标记（返回 false）：本 pod 跳过续跑
   *
   * framework 的 `cleanupOrphanRunningMissionsAtomic` 逐 orphan 调用本 hook，
   * 只返回本 pod 抢到的赢家集合，消除多 pod 重复 rerun（重复烧 credit）。
   */
  readonly claimOrphanFailed: (missionId: string) => Promise<boolean>;
  /** stage 进度推进 (where status='running')。 */
  readonly writeStageProgress: (
    missionId: string,
    stageNumber: number,
  ) => Promise<void>;
  /** countRunningByUser 直查。 */
  readonly countRunning: (userId: string) => Promise<number>;
  /** 业务侧 row missing 判定（Prisma P2003 / P2025）。 */
  readonly isMissionRowMissing: (err: unknown) => boolean;
  /** 业务侧应急 abort（row missing 时触发）。 */
  readonly emergencyAbort: (missionId: string, reason: string) => void;
  /** Logger namespace（业务方自定义，如 `<app>-mission-store`）。 */
  readonly loggerNamespace: string;
  /** Orphan cleanup 批 size 默认 200。 */
  readonly orphanBatchSize?: number;
}

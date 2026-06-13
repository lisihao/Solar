/**
 * IMissionStore — mission 持久化端口（v5.1 §3.4 / §3.5 R1-C）
 *
 * 设计：
 *   - 每 ai-app 自有表（不做 generic mission_runs 表，per v1 评审 P0-3）
 *   - 业务专属字段（如 consumer.topic / depth）由 TMission 泛型决定
 *   - statefulRoleStates / crossStageState 持久化是 R1-C 关键扩展
 *     （v5.1 P0-F：crashed mission 可 resume）
 *
 * Adapter 实现：
 *   - 各 ai-app 自家 MissionStore（包装其 prisma mission 表，e.g. {app}_missions）
 *   - InMemoryMissionStore（spec / dev 用）
 */

export interface MissionCreateInput {
  readonly missionId: string;
  readonly userId?: string;
  readonly tenantId?: string;
  readonly pipelineId: string;
  /** 业务输入（json schema 由 ai-app 决定）*/
  readonly input: unknown;
}

export interface MissionStatusUpdate {
  readonly status: "running" | "completed" | "failed" | "cancelled";
  readonly completedAt?: Date;
  readonly result?: unknown;
  readonly error?: unknown;
}

export interface MissionRecord<TBusiness = Record<string, unknown>> {
  readonly missionId: string;
  readonly userId?: string;
  readonly tenantId?: string;
  readonly pipelineId: string;
  readonly status: "running" | "completed" | "failed" | "cancelled";
  readonly input: unknown;
  readonly result?: unknown;
  readonly error?: unknown;
  readonly startedAt: Date;
  readonly completedAt?: Date;
  /** v5.1 P0-F：跨 stage 副作用（CrossStageState.toJSON()）*/
  readonly crossStageState: Readonly<Record<string, unknown>>;
  /** v5.1 P0-F：stateful role decisions（Record<roleId, PastDecision[]>）*/
  readonly roleDecisions: Readonly<Record<string, ReadonlyArray<PastDecision>>>;
  /** mission 已完成的最后一个 stepId（resume 用）*/
  readonly lastCompletedStepId?: string;
  /** ai-app 自定义业务字段（不参与 generic 接口）*/
  readonly business?: TBusiness;
}

export interface PastDecision {
  readonly phase: string;
  readonly decision: string;
  readonly rationale?: string;
  readonly timestamp: number;
}

/**
 * IMissionStore — pure CRUD + state hydration（generic 端口）
 *
 * 业务专属 method（如 consumer.appendDimensions）通过 store extension 加，
 * 不进 generic 接口。
 */
export interface IMissionStore<TBusiness = Record<string, unknown>> {
  // ── lifecycle ──
  create(input: MissionCreateInput): Promise<MissionRecord<TBusiness>>;
  getById(missionId: string): Promise<MissionRecord<TBusiness> | null>;
  listByUser(
    userId: string,
    opts?: { limit?: number; offset?: number },
  ): Promise<MissionRecord<TBusiness>[]>;
  updateStatus(missionId: string, update: MissionStatusUpdate): Promise<void>;

  // ── stage progress（resume 用）──
  setLastCompletedStepId(missionId: string, stepId: string): Promise<void>;

  // ── stateful state（v5.1 §3.4 P0-F）──
  appendDecision(
    missionId: string,
    roleId: string,
    decision: PastDecision,
  ): Promise<void>;
  getDecisions(
    missionId: string,
    roleId: string,
  ): Promise<ReadonlyArray<PastDecision>>;
  saveCrossStageState(
    missionId: string,
    state: Readonly<Record<string, unknown>>,
  ): Promise<void>;
  getCrossStageState(
    missionId: string,
  ): Promise<Readonly<Record<string, unknown>>>;
}

/**
 * IMissionEventStore — mission event 持久化端口（v5.1 §3.4）
 *
 * 用途：
 *   - 前端 replay：拉取所有 event 重建 UI
 *   - billing / audit：跨 mission 检索特定 event
 *
 * 业务无关：event.type / payload 由 caller 定义（ai-app 自己定 27+ event types）；
 * store 只负责按 missionId + ts 索引。
 */
export interface MissionEventRecord {
  readonly missionId: string;
  /** event id（自增或 UUID）*/
  readonly eventId: string;
  readonly type: string;
  readonly payload: unknown;
  readonly ts: number;
  readonly agentId?: string;
}

export interface IMissionEventStore {
  /** 单条 append（fire-and-forget OK，但应保证顺序）*/
  append(event: MissionEventRecord): Promise<void>;
  /** 批量 append（高频事件场景） */
  appendBatch(events: ReadonlyArray<MissionEventRecord>): Promise<void>;
  /** 拉取 mission 全部 event（按 ts 升序，replay 用）*/
  listByMission(
    missionId: string,
    opts?: { limit?: number; sinceTs?: number },
  ): Promise<MissionEventRecord[]>;
  /** 删除某 mission 的全部 event（mission 删除时调用）*/
  deleteByMission(missionId: string): Promise<void>;
}

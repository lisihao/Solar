/**
 * BusinessAgentTeam — Mission Store 抽象接口
 *
 * 2026-05-08 PR-E2：从业务侧 reference mission store @migrated-from
 * 提取核心 lifecycle 方法签名作为框架接口。reference impl
 * store 是 reference 实现（含 28 public 方法 + 业务 schema），其他 BusinessAgentTeam
 * 实例（research / TI / writing 反向迁移时）只需实现本接口的核心 lifecycle 部分，
 * 业务专属方法（saveReportVersion / appendLeaderJournal 等）由各业务方扩展。
 *
 * 框架依赖原则：harness 后续 framework（E3 RerunGuard / E4 BusinessAgentTeamFactory）
 * 通过 IBusinessTeamMissionStore 接口注入业务 store，避免直接依赖 reference impl 具体类。
 *
 * **暂不强制 implements**：mission-store.service.ts 通过 TypeScript structural
 * typing 隐式 satisfies 本接口（所有方法签名一致）。未来 mission-store 重构拆分
 * 时再显式 `implements IBusinessTeamMissionStore` 锁定契约。
 *
 * ─── Rev 5 / S0-8 — 与 Z1 `IMissionStore<TBusiness>` 关系（doc-only,closes T1）───
 *
 * 本接口（Z3）与 `ai-harness/lifecycle/mission-lifecycle/abstractions/mission-store.interface.ts`
 * 的 `IMissionStore<TBusiness>`（Z1）**不冲突,而是同一 store 概念的两个视角**:
 *
 *   - **Z1 `IMissionStore<TBusiness>`**: 通用 generic CRUD 端口
 *     （create / getById / listByUser / updateStatus / setLastCompletedStepId /
 *     appendDecision / getDecisions / saveCrossStageState / getCrossStageState）
 *     —— v5.1 §3.4 R1-C 抽象,关心"mission record 怎么读写"
 *
 *   - **Z3 `IBusinessTeamMissionStore`(本接口)**: BusinessAgentTeam lifecycle 视角的
 *     **互补集合**(refreshHeartbeat / clearHeartbeat / markStageComplete / countRunningByUser /
 *     markFailed / markReopened) —— **method 名与 Z1 不重叠**,
 *     Z3 framework 关心"mission 在生命周期上发生什么"。
 *
 * benchmark consumer 的 mission store(reference 实现，@migrated-from 业务侧 mission store)
 * **同时 satisfies 两者**(structural typing),分别对应:
 *
 *   - 被 R1 generic 调用方(reproducible CRUD)使用 → Z1 接口
 *   - 被 Z3 framework(`MissionRuntimeShellFramework` / `RerunGuard` / `MissionLivenessGuard` 调度)使用 → Z3 接口
 *
 * S2-7 计划在 Stage 2 阶段用类型层 `IMissionStore<TBusiness> & IBusinessTeamMissionStore`
 * intersection 固化"同一 store 的两个视角"(非 Pick<> 子集 — 两接口 method 名互补不重叠)。
 *
 * 详见 `docs/architecture/ai-harness/facade/sediment-topology.md` §5 T1 与对应业务边界审计记录。 @migrated-from
 */

/**
 * Mission store 核心 lifecycle 接口。
 *
 * 业务方（reference impl / research / 等）的 mission store 必须 satisfies 这些方法
 * 签名以接入 BusinessAgentTeam 框架（mission-runtime-shell / RerunGuard 等）。
 *
 * 字段：
 *   - missionId: 统一用 string（UUID v4 是约定，但接口不约束格式）
 *   - userId: 用于 depth-defense（updateMany where{id, userId}）
 *   - podId: heartbeat 写入时附加的 pod 标识（区分 zombie pod）
 */
export interface IBusinessTeamMissionStore {
  /**
   * 刷新 mission 的 heartbeat 字段（每 30s 一次，由 mission-runtime-shell 调度）。
   * 用于 MissionLivenessGuard 判定 mission 是否真在跑。
   */
  refreshHeartbeat(missionId: string, podId: string): Promise<void>;

  /**
   * 清除 heartbeat（status 转 final 态时调用，让 RerunGuard 判定 not-in-flight）。
   */
  clearHeartbeat(missionId: string, userId: string): Promise<void>;

  /**
   * 标记 mission 当前已完成的最大 stage 编号（用于 dispatcher 重启 / cascade rerun）。
   */
  markStageComplete(missionId: string, stageNumber: number): Promise<void>;

  /**
   * 当前用户运行中 mission 数（用于并发限流 / rerun guard）。
   */
  countRunningByUser(userId: string): Promise<number>;

  /**
   * 当前用户**最旧**的 running mission id（createdAt 升序首个），无则 null。
   * 用于"撞并发上限时自动顶替最旧"（auto-supersede）—— 让用户新建不被 400 卡死。
   */
  findOldestRunningMissionId(userId: string): Promise<string | null>;

  /**
   * 标记 mission 失败（终态）。
   *
   * 隔离语义:
   *   - `args.userId` 传入时走 `updateMany where { id, userId }` 严格隔离
   *   - 缺失时走 `update + assertOwnership` 兼容路径
   *
   * `args.errorMessage` 截断契约(S0-7 codified):
   *   - 由**业务方实现侧**截断,framework / caller **不**截断
   *   - reference impl:
   *     2000 chars(UTF-16 code units),超出 truncate 末尾保留 `…[truncated]` 标记
   *   - 其他 BusinessAgentTeam impl 可选不同上限,但必须保证 DB 列 NVARCHAR/TEXT 容纳
   *   - 上限选择应平衡:足够保留诊断信息(stack / message)且不撑爆 DB 行
   *
   * @param missionId - mission 唯一 ID
   * @param args.userId - 可选,depth-defense 隔离
   * @param args.errorMessage - 可选,失败原因诊断文本(实现侧负责截断)
   */
  markFailed(
    missionId: string,
    args: { userId?: string; errorMessage?: string },
  ): Promise<void>;

  /**
   * 把 failed / quality-failed mission 反向 transition 回 running（rerun 起点）。
   * 用乐观锁（updateMany where status in [...]）+ 检查 affectedRows 防 TOCTOU。
   */
  markReopened(missionId: string, userId: string): Promise<void>;
}

/**
 * BusinessAgentTeam — RerunGuard 抽象接口
 *
 * 2026-05-08 PR-E3：从 ai-app/playground/services/mission/rerun/ @migrated-from
 * rerun-guard.service.ts 提取核心方法签名。reference impl RerunGuardService 是
 * reference 实现（含 SQL LIKE 业务事件查询 / store.markFailed / emit
 * zombie-cleanup），其他 BusinessAgentTeam 实例反向迁移时只需 satisfies 本
 * 接口签名即可接入 framework。
 *
 * 框架资产（已上提到 harness）：
 *   - decideMissionInFlight：9-cell 决策矩阵纯函数（heartbeat-decision.ts）
 *   - HEARTBEAT_FRESH_THRESHOLD_MS_DEFAULT / BUSINESS_EVENT_FRESH_THRESHOLD_MS_DEFAULT
 *
 * 业务侧仍持有：
 *   - 业务事件 prefix 列表（每个业务 namespace 不同）
 *   - eventTableName（业务表 schema）
 *   - markFailed / clearHeartbeat / emit zombie-cleanup 执行（走业务 store + emit）
 */

/**
 * RerunGuard 核心方法签名。
 *
 * 业务方（reference impl / research / 等）的 rerun guard 必须 satisfies 这些方法
 * 签名以接入 BusinessAgentTeam 框架（rerun orchestrator / local rerun 调用方）。
 */
export interface IBusinessRerunGuard {
  /**
   * 唯一 in-flight 判定（**纯读，无副作用**）。
   *
   * 直接调 checkInFlight 的调用方只能用于观测 / 决策，不能假设它会修复任何状态。
   * 写操作只在 ensureRerunable 中（zombieCleanup）。
   */
  checkInFlight(
    missionId: string,
    userId: string,
  ): Promise<{
    inFlight: boolean;
    zombieDetected: boolean;
    status: string;
    heartbeatAgeMs: number | null;
    latestBusinessEventAgeMs: number | null;
    reason?: string;
  }>;

  /**
   * 入站强校验。所有 rerun entrypoint 调此处。
   *
   * - inFlight=true → 抛 BadRequest，调用方拒绝用户操作
   * - zombieDetected=true → 主动 cleanup（markFailed + clearHeartbeat），用户行为优先
   * - 其余 → 正常返回
   *
   * DB 异常 fail-closed：抛 BadRequest "rerun guard 服务异常"。
   */
  ensureRerunable(missionId: string, userId: string): Promise<void>;
}

/**
 * CtxHydrator 接口（structural typing 占位）。
 *
 * 2026-05-08 PR-E3 决策：暂不强制；业务 ctx schema 各异（reference impl 的 dimensions /
 * researcherResults 与 research 的 reportArtifact、与 writing 的 chapterDrafts 完全
 * 不同），泛型抽象现阶段只是空壳。等第二个 ai-app 真有 hydrator 需求时按"业务方
 * 注入 ctx 类型 + harness 提供 hydrate skeleton"模式重做。
 */

/**
 * StageRerunDispatcher 接口（structural typing 占位）。
 *
 * 2026-05-08 PR-E3 决策：暂不强制；dispatcher 与业务 PIPELINE.steps 强耦合（每个
 * stage 函数签名 / 参数 / 写库 schema 都不同），泛型抽象现阶段会引入跨业务幽灵
 * 类型。等第二个 ai-app 真有 stage rerun 需求时再做"通用 cascade chain runner +
 * 业务 stage handler registry"分层抽象。
 */

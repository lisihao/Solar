/**
 * BusinessAgentTeam — 一站装配规约（aggregation type）
 *
 * 2026-05-08 PR-E4：把 E0/E1/E2/E3 的 4 个核心 adapter 聚合为单一规约接口。
 * 业务方（playground / research / writing / TI / ...）实现 BusinessAgentTeamSpec @migrated-from
 * 即得"完整 BusinessAgentTeam 装配契约"，未来 BusinessAgentTeamFactory（真有
 * 2 个 consumer 时再做）会按本规约的 4 个字段装配。
 *
 * 当前阶段（YAGNI / 1 consumer）：
 *   - 不引入 BusinessAgentTeamFactory 类（NestJS DI 已经做了所有连线工作）
 *   - 业务模块自己 register provider，构造时手工注入 4 个 adapter
 *   - reference impl 是 reference 实现：satisfies 本规约 via structural typing
 *
 * 第二个 consumer（research/writing 反向迁移）出现时：
 *   - 抽 BusinessAgentTeamFactory.assemble(spec): TeamRuntime 类
 *   - 抽 BusinessTeamRegistry / BusinessTeamModuleBuilder（NestJS Dynamic Module）
 *   - 那时本规约的 4 个字段语义已稳定，不需要重新设计
 */

import type { IMissionRuntimeAdapter } from "./mission-runtime-shell.interface";
import type { IBusinessTeamMissionStore } from "./mission-store.interface";
import type { IBusinessRerunGuard } from "./rerun-guard.interface";
import type { EventRelayFramework } from "../events/event-relay.framework";

/**
 * BusinessAgentTeam 装配规约。
 *
 * 业务方（mission 模块）实现本接口的 4 个字段即得 framework 完整接入：
 *   - eventNamespace: 事件 type 字符串前缀（如 "my-app" / "research"）
 *   - missionRuntimeAdapter: E0 mission lifecycle adapter（business 决策注入）
 *   - eventRelay: E1 event relay 实例（framework extends 业务 namespace）
 *   - missionStore: E2 lifecycle store（satisfies IBusinessTeamMissionStore）
 *   - rerunGuard: E3 rerun guard（satisfies IBusinessRerunGuard）
 */
export interface BusinessAgentTeamSpec<TInput = unknown> {
  /**
   * 业务事件命名空间。所有 event type 字符串走 `${namespace}.xxx` 模板
   * （由 EventRelayFramework 内部拼接）。
   *
   * 命名约定：lowercase + kebab-case，与 module key 一致（如 "my-app"）。
   */
  readonly eventNamespace: string;

  /**
   * E0：mission runtime shell adapter。
   * 决定 wallTimeMs / credits / budgetMultiplier / createMissionRow / heartbeat
   * 等业务侧 lifecycle 决策。
   */
  readonly missionRuntimeAdapter: IMissionRuntimeAdapter<TInput>;

  /**
   * E1：event relay 实例。framework 提供 emit / tickCost / IAgentEvent 翻译，
   * 业务方 extends 注入 namespace。
   */
  readonly eventRelay: EventRelayFramework;

  /**
   * E2：mission lifecycle store。framework rerun-guard / dispatcher 通过本契约
   * 调 markFailed / clearHeartbeat / markReopened 等核心 lifecycle 方法。
   * 业务方仍可在 store 上扩展 ~20+ 业务专属方法（saveReportVersion 等）。
   */
  readonly missionStore: IBusinessTeamMissionStore;

  /**
   * E3：rerun guard。framework 提供 9-cell heartbeat decision 纯函数，
   * 业务方实现 checkInFlight + ensureRerunable 走 SQL LIKE 查询 + 业务事件分类。
   */
  readonly rerunGuard: IBusinessRerunGuard;
}

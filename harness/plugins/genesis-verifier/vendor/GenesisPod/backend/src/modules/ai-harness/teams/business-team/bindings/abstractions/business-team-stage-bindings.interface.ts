/**
 * BusinessAgentTeam — Stage Bindings Framework 接口
 *
 * 业务团队"stage 入参装配 + stage deps 装配"协议；framework 提供薄骨架，
 * 业务侧实现 `buildCtx` / `buildDeps`（每个业务团队的 MissionContext / CommonDeps
 * 形状不同 —— framework 不规约具体字段名）。
 *
 * 2026-05-24 (P4) 抽取自 ai-app 业务侧 stage bindings service:
 *   - ai-app/playground/services/mission/workflow/mission-stage-bindings.service.ts  @migrated-from
 *
 * 设计：
 *   - **TCtxArgs / TCtx / TDeps 全 generic** —— framework 不规约 plan / researcher
 *     / reportArtifact 等业务字段，业务侧用自己的类型；
 *   - subclass 通常 `@Injectable()` + 在 constructor 注入业务专属 service collection，
 *     在 `buildCtx` / `buildDeps` 内部把构造好的 ctx + deps 返回；
 *   - framework 暴露 `markStageDegraded` 通用 hook signature（业务侧 emit 自己的
 *     `{namespace}.stage:degraded` 事件，框架不替业务选择 namespace）。
 */

export interface BusinessTeamStageBindings<TCtxArgs, TCtx, TDeps> {
  /**
   * 装配 stage 入参 context（业务侧把 mission lifecycle 必备字段如 billing/pool/
   * leader/budgetMultiplier 平铺到 TCtx，再加业务专属字段如 plan/researcherResults）。
   */
  buildCtx(args: TCtxArgs): TCtx;

  /**
   * 装配 stage deps —— stage adapter 通过 deps 调业务 service / 共享 invoker /
   * eventBus / store。framework 不规约具体 deps 字段，业务侧自己决定包哪些。
   */
  buildDeps(): TDeps;
}

/**
 * `markStageDegraded` 通用 hook signature —— stage 内部软失败上报。
 *
 * 业务侧实现时 emit `{namespace}.stage:degraded` 事件（namespace 由各业务团队
 * 自己选）；framework 不提供 default 实现，避免硬编码 namespace 字符串。
 * 此 type 仅供业务侧定义自己的 deps interface 时复用 signature。
 */
export type MarkStageDegradedFn = (
  missionId: string,
  userId: string,
  stepId: string,
  reason: string,
) => Promise<void>;

/**
 * BusinessAgentTeam — Rerun Runtime Builder Contract
 *
 * 2026-05-24 (P5 Wave 1)：cascade rerun 跑的不是初次 mission 跑期那套 wallTimer +
 * heartbeatTimer + storeCreate，而是"复用已有 mission 行 + 起一次 abort/billing/pool
 * session + cascade 结束 cleanup"。这套 session 装配机制对所有 BusinessAgentTeam
 * 同形：
 *
 *   机制（framework 提供）：
 *     - 起 session 前主动检测 stale AbortController + abort 旧（orphan-prevention）
 *     - 起 fresh AbortController via MissionAbortRegistry
 *     - cleanup 一次性保证（已 cleaned guard）+ abortRegistry.unregister
 *     - composeMissionContext: hydrated + runtime 字段 → composed MissionContext
 *     - writeBackToHydrated:  cascade 跑后把产物字段拷回 hydrated（不污染 runtime 5 字段）
 *
 *   业务（runtime composer hook）：
 *     - billing 怎么造（userId + workspaceId + 业务 credits service）
 *     - pool 怎么造（resolveMissionCredits 业务实现 / DepthBudgetTiers）
 *     - leader / Supervisor 怎么造（业务团队角色）
 *     - 业务 composed context 形状（每业务方各异）
 *     - writeBack 时哪些字段拷回（每业务的 phase 字段不同）
 */

/**
 * Runtime session 接口 — framework 暴露最小契约，业务子类可扩展额外字段。
 *
 * `cleanup` 必须 idempotent（multi-call safe），caller（cascade dispatcher）
 * 在 finally 中调用以保证 abortRegistry 不泄露。
 */
export interface BusinessTeamRerunRuntimeSession {
  readonly missionId: string;
  readonly userId: string;
  cleanup(): void;
}

/**
 * Runtime composer hook — 业务方提供 session 怎么造 / context 怎么合 / 产物怎么写回。
 *
 * @template THydrated business 自己的 hydrated ctx
 * @template TComposed business 自己的 composed ctx（含 runtime 5 字段）
 * @template TSession business 自己的 RuntimeSession（≥ BusinessTeamRerunRuntimeSession）
 */
export interface RerunRuntimeComposerHooks<
  THydrated,
  TComposed,
  TSession extends BusinessTeamRerunRuntimeSession,
> {
  /**
   * 起 session：business 在内部 register abortController / 造 billing / pool / leader。
   * Framework 不直接调 abortRegistry — 由业务方调，framework 仅提供 stale-protect helper。
   */
  buildSession(args: { ctx: THydrated; workspaceId?: string }): TSession;

  /**
   * Hydrated + Session → Composed MissionContext。business 把 hydrated 字段 spread
   * 进 composed 并注入 runtime 字段（billing/pool/leader/budgetMultiplier/t0）。
   */
  composeMissionContext(ctx: THydrated, session: TSession): TComposed;

  /**
   * Cascade 跑完一个 stage 后，把 composed 上产物字段拷回 hydrated（让下个 stage 看见）。
   * 业务实现：只拷 phase / invariant 字段，剔除 runtime 5 字段（billing/pool/leader/
   * budgetMultiplier）— framework 提供 strip helper 但不强制。
   */
  writeBackToHydrated(composed: TComposed, hydrated: THydrated): THydrated;
}

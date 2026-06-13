/**
 * BusinessAgentTeam — Ctx Hydrator Schema Provider Contract
 *
 * 2026-05-24 (P5 Wave 1)：每个 BusinessAgentTeam 都要从 DB 重建出 cascade rerun 所需的
 * hydrated context（mission 行 + 子表 join → mutable ctx 对象）。机制 vs 业务字段：
 *
 *   机制（framework 提供）：
 *     - 主行 ownership / 不存在 → NotFound 短路
 *     - mission.report_full DoS 字节硬上限 size guard（zod parse / JSON serialize）
 *     - schemaVersion 缺失 → reject legacy data
 *     - DB query 失败 → 抛 BadRequest
 *     - 标志 ctx.__hydrated = true 让 caller 可识别
 *
 *   业务（schema provider hook）：
 *     - 主行 schema：哪些列要读、什么 type
 *     - 子表 schema：哪个表名（{app}_research_results / {app}_signals / ...）、
 *       怎么 join（DISTINCT ON 列 / orderBy / join key）
 *     - report payload zod schema（如果有结构化 artifact）
 *     - businessInput rebuild（snapshot → typed input）
 *     - 最终 ctx 形状（每业务的 HydratedMissionContext 不同）
 *
 * 这一层抽象让 social/radar 接入时只需提供 schema provider，不必重写 hydrate 骨架。
 */

/**
 * 主行抓取的最小 shape — framework 只关心 ownership / schemaVersion / report_full size。
 * 业务侧 detail 实际形状由 schemaProvider.fetchDetail 返回（typed 给 schemaProvider 内部用）。
 */
export interface CtxHydratorDetailMinimal {
  /** 主键存在 / null → throw NotFoundException */
  readonly id?: string;
  /** snapshot 缺失（pre-snapshot legacy）→ throw BadRequest "不支持重跑" */
  readonly configSnapshot?: unknown;
  /** report payload size guard 用（可选） */
  readonly reportFull?: unknown;
}

/**
 * Schema provider — 业务方提供"怎么从 DB 重建 hydrated ctx"的全部具象逻辑。
 *
 * Framework 只调这些 hook，不知道 SQL 表名 / Prisma model / business 字段名。
 *
 * @template TDetail business 主行 detail（如 PlaygroundMissionDetail / SocialMissionDetail）
 * @template THydrated business 自己的 HydratedMissionContext
 */
export interface CtxHydratorSchemaProvider<TDetail, THydrated> {
  /**
   * 抓 mission 主行（含 ownership 校验）。null → caller 抛 NotFound。
   */
  fetchDetail(missionId: string, userId: string): Promise<TDetail | null>;

  /**
   * 检验 configSnapshot 存在性 + schema version；缺失或非法 → 返回 reject reason，
   * caller 抛 BadRequest "不支持重跑"。
   */
  assertSnapshotSupported(
    detail: TDetail,
  ): { ok: true } | { ok: false; reason: string };

  /**
   * 从 detail + missionId + userId 重建 hydrated ctx（含主行字段、子表 join、
   * report payload zod parse、产物 reconstruct）。
   *
   * 业务可在此内部走自己的 prisma query / zod parse。Framework 不解释。
   */
  buildHydrated(args: {
    detail: TDetail;
    missionId: string;
    userId: string;
  }): Promise<THydrated>;

  /**
   * 可选：报告 reportFull 字节硬上限（DoS 防护）。framework 在 fetchDetail
   * 后用 JSON.stringify 估测，超限则抛 BadRequest。默认 2MB（reference impl v1.2 类别 E5 同源）。
   */
  readonly maxReportFullBytes?: number;
}

/** Framework helper 给业务抛错时统一带 context 信息 */
export interface HydrationErrorContext {
  readonly missionId: string;
  readonly userId: string;
}

/**
 * BusinessAgentTeam — Mission Update Helper contract (P6 Wave 1, 2026-05-24)
 *
 * @migrated-from ai-app/playground/services/mission/lifecycle/mission-update.helper.ts
 *
 * 抽出 user-initiated mission 元数据修改通用机制：
 *   - userId 传入 → updateMany where{id, userId}（深度防御）
 *   - userId 缺失 → update where{id}（兼容路径，upstream controller 已 assertOwnership）
 *   - error 静默 warn 不阻塞业务
 */

/** Framework 接受的 update data shape（业务方决定字段名）。 */
export type UpdateInputData = Record<string, unknown>;

/** Field reset 时的 snake → camel 映射表（业务专属）。 */
export type FieldNameMap = Readonly<Record<string, string>>;

/**
 * 业务方提供的 update helper hooks。
 *
 * 机制：
 *   - runUpdate (双分支 updateMany + userId / update 兼容)
 * 业务字段：
 *   - DB delegate（业务表）
 *   - field name map（业务列名）
 */
export interface UpdateHelperHooks {
  /** updateMany where{id, userId} —— userId 传入时调用。 */
  readonly updateManyByOwner: (
    missionId: string,
    userId: string,
    data: UpdateInputData,
  ) => Promise<void>;
  /** update where{id} —— userId 缺失时兼容路径（upstream assertOwnership）。 */
  readonly updateAnyById: (
    missionId: string,
    data: UpdateInputData,
  ) => Promise<void>;
  /** Logger namespace。 */
  readonly loggerNamespace: string;
}

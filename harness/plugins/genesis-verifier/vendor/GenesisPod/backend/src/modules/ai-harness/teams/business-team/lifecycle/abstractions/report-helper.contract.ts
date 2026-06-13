/**
 * BusinessAgentTeam — Report Helper contract (P6 Wave 1, 2026-05-24)
 *
 * @migrated-from ai-app/playground/services/mission/lifecycle/mission-report.helper.ts
 *
 * 抽出 report version 化通用机制：
 *   - saveReportVersion: 在 transaction 内 aggregate next version + create row（Serializable）
 *   - listReportVersions: orderBy generatedAt desc + select 投影
 *   - getReportVersion: findUnique by missionId_version
 *
 * 业务方注入：
 *   - Prisma delegate（业务可能用 missionReportVersion 表，也可能自建）
 *   - 业务专属 trigger label 默认值（如 `${trigger}-${date}`）
 *   - 业务专属 finalScore / leaderSigned 等可选字段映射（generic param）
 */

/** Report version base row（业务方扩展自己的字段）。 */
export interface ReportVersionListItem {
  readonly id: string;
  readonly version: number;
  readonly versionLabel: string | null;
  readonly reportTitle: string | null;
  readonly reportSummary: string | null;
  readonly triggerType: string;
  readonly generatedAt: Date;
}

/** 业务方提供的 report helper IO hooks。 */
export interface ReportHelperHooks<TVersionRow extends ReportVersionListItem> {
  /** Aggregate 当前 max version（事务内调用）。 */
  readonly aggregateMaxVersion: (
    missionId: string,
    tx: unknown,
  ) => Promise<number>;
  /** Create 新 version 行（事务内调用）。 */
  readonly createVersion: (
    args: {
      readonly missionId: string;
      readonly version: number;
      readonly versionLabel: string;
      readonly reportFull: unknown;
      readonly reportTitle: string | null;
      readonly reportSummary: string | null;
      readonly triggerType: string;
      readonly extra?: Record<string, unknown>;
    },
    tx: unknown,
  ) => Promise<void>;
  /** 包 Serializable transaction。 */
  readonly runSerializable: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
  /** Find 单个 version 行（业务方做 select 投影）。 */
  readonly findVersion: (
    missionId: string,
    version: number,
  ) => Promise<TVersionRow | null>;
  /** List 所有 version 行。 */
  readonly listVersions: (missionId: string) => Promise<readonly TVersionRow[]>;
  /** Logger namespace。 */
  readonly loggerNamespace: string;
}

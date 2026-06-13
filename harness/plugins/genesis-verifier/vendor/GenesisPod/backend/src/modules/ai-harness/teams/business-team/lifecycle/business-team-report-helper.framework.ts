/**
 * BusinessAgentTeam — Mission Report Helper Framework (P6 Wave 1, 2026-05-24)
 *
 * @migrated-from ai-app/playground/services/mission/lifecycle/mission-report.helper.ts
 *
 * 抽出 report version 化通用机制：
 *   - saveReportVersion: Serializable transaction 内 aggregate next version + create
 *   - listReportVersions / getReportVersion 委托业务方查询
 *
 * 业务方注入：
 *   - Prisma delegate 名 (missionReportVersion 或业务自建表)
 *   - report title slice 上限 (默认 500)
 *   - 业务专属 extra fields (finalScore / leaderSigned 等)
 */

import { Logger } from "@nestjs/common";
import type {
  ReportHelperHooks,
  ReportVersionListItem,
} from "./abstractions/report-helper.contract";

/** Title 截断上限（业务方可在 saveReportVersion args 覆写）。 */
const DEFAULT_TITLE_SLICE = 500;

export abstract class BusinessTeamReportHelperFramework<
  TVersionRow extends ReportVersionListItem,
> {
  protected readonly log: Logger;

  constructor(protected readonly reportHooks: ReportHelperHooks<TVersionRow>) {
    this.log = new Logger(reportHooks.loggerNamespace);
  }

  /**
   * 写新 report version 行。
   *
   * 在 Serializable transaction 内 aggregate max version + create，
   * 防并发拿同 version。失败返回 0。
   *
   * 业务方在 hooks.createVersion 内决定 extra 字段（finalScore / leaderSigned 等）。
   */
  async saveReportVersion(args: {
    missionId: string;
    triggerType: string;
    report?: { title?: string; summary?: string; [k: string]: unknown };
    versionLabel?: string;
    extra?: Record<string, unknown>;
  }): Promise<number> {
    try {
      return await this.reportHooks.runSerializable(async (tx) => {
        const maxVersion = await this.reportHooks.aggregateMaxVersion(
          args.missionId,
          tx,
        );
        const nextVersion = maxVersion + 1;
        const reportTitle =
          args.report?.title?.slice(0, DEFAULT_TITLE_SLICE) ?? null;
        const reportSummary = args.report?.summary ?? null;
        await this.reportHooks.createVersion(
          {
            missionId: args.missionId,
            version: nextVersion,
            versionLabel:
              args.versionLabel ??
              `${args.triggerType}-${new Date().toISOString().slice(0, 10)}`,
            reportFull: args.report ?? null,
            reportTitle,
            reportSummary,
            triggerType: args.triggerType.slice(0, 40),
            extra: args.extra,
          },
          tx,
        );
        return nextVersion;
      });
    } catch (err: unknown) {
      this.log.warn(
        `[saveReportVersion ${args.missionId}] failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return 0;
    }
  }

  async listReportVersions(missionId: string): Promise<readonly TVersionRow[]> {
    return this.reportHooks.listVersions(missionId).catch((err: unknown) => {
      this.log.warn(
        `[listReportVersions ${missionId}] failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return [] as readonly TVersionRow[];
    });
  }

  async getReportVersion(
    missionId: string,
    version: number,
  ): Promise<TVersionRow | null> {
    return this.reportHooks
      .findVersion(missionId, version)
      .catch((err: unknown) => {
        this.log.warn(
          `[getReportVersion ${missionId} v${version}] failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return null;
      });
  }
}

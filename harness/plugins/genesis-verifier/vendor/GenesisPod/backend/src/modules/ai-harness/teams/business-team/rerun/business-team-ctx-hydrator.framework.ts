/**
 * BusinessAgentTeam — Ctx Hydrator Framework（P5 Wave 1，2026-05-24）
 *
 * @migrated-from ai-app/playground/services/mission/rerun/ctx-hydrator.service.ts
 *
 * 抽出 ctx hydrate 骨架：fetch main row → ownership / NotFound / size guard /
 * snapshot version 校验 → 委托 schemaProvider.buildHydrated 重建业务 ctx。
 *
 * 机制（framework）：
 *   - NotFoundException 短路（business store 返 null）
 *   - report_full DoS 字节硬上限（默认 2MB）
 *   - configSnapshot 缺失 → BadRequestException "不支持重跑"
 *   - 错误统一带 missionId / userId context
 *
 * 业务（schema provider）：
 *   - fetchDetail / assertSnapshotSupported / buildHydrated
 *   - 每业务 ctx shape 不同，由 schemaProvider 完全控制
 */

import { BadRequestException, Logger, NotFoundException } from "@nestjs/common";
import type {
  CtxHydratorDetailMinimal,
  CtxHydratorSchemaProvider,
} from "./abstractions/ctx-hydrator-schema.contract";

/** 默认 report_full 字节硬上限（reference impl v1.2 类别 E5 同源） */
const MAX_REPORT_FULL_BYTES_DEFAULT = 2_000_000;

export abstract class BusinessTeamCtxHydratorFramework<
  TDetail extends CtxHydratorDetailMinimal,
  THydrated,
> {
  protected readonly log: Logger;

  constructor(
    protected readonly schemaProvider: CtxHydratorSchemaProvider<
      TDetail,
      THydrated
    >,
    namespace: string,
  ) {
    this.log = new Logger(`${namespace}-ctx-hydrator`);
  }

  /**
   * Hydrate 主入口：fetch detail → 校验 ownership/snapshot/size → delegate buildHydrated。
   *
   * 不做 in-flight 判定（归属 RerunGuardFramework）；纯产物重建。
   */
  async hydrate(missionId: string, userId: string): Promise<THydrated> {
    const detail = await this.schemaProvider.fetchDetail(missionId, userId);
    if (!detail) {
      throw new NotFoundException(
        `mission ${missionId} not found or not owned by ${userId}`,
      );
    }

    // report_full size guard（业务 detail 可能没此字段，跳过即可）
    if (detail.reportFull != null) {
      const serialized = JSON.stringify(detail.reportFull);
      const maxBytes =
        this.schemaProvider.maxReportFullBytes ?? MAX_REPORT_FULL_BYTES_DEFAULT;
      if (serialized.length > maxBytes) {
        throw new BadRequestException(
          `mission ${missionId} report_full size ${serialized.length} > ${maxBytes} (DoS 防护)`,
        );
      }
    }

    // configSnapshot 缺失 → legacy data，拒绝重跑
    const snapshotCheck = this.schemaProvider.assertSnapshotSupported(detail);
    if (!snapshotCheck.ok) {
      throw new BadRequestException(
        `mission ${missionId} ${snapshotCheck.reason}`,
      );
    }

    return this.schemaProvider.buildHydrated({ detail, missionId, userId });
  }
}

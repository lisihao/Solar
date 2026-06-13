/**
 * BusinessAgentTeam — Mission Update Helper Framework (P6 Wave 1, 2026-05-24)
 *
 * @migrated-from ai-app/playground/services/mission/lifecycle/mission-update.helper.ts
 *
 * 抽出 user-initiated mission 元数据 update 通用机制：
 *   - runUpdate 双分支（userId 传入 / 缺失）
 *   - resetFields 通用 snake→camel 映射 + value=null 注入
 *
 * 业务方注入：
 *   - DB delegate（updateMany / update）
 *   - field name map（业务列名 snake_case → camelCase）
 */

import { Logger } from "@nestjs/common";
import type {
  FieldNameMap,
  UpdateHelperHooks,
  UpdateInputData,
} from "./abstractions/update-helper.contract";

export abstract class BusinessTeamUpdateHelperFramework {
  protected readonly log: Logger;

  constructor(protected readonly updateHooks: UpdateHelperHooks) {
    this.log = new Logger(updateHooks.loggerNamespace);
  }

  /**
   * 通用 mission update 双分支统一。
   *
   * userId 传入 → updateMany + where{id, userId}（深度防御）
   * userId 缺失 → update + where{id}（兼容路径，upstream controller 已 assertOwnership）
   *
   * 任何 error → warn 不抛（业务方一致地 fire-and-forget user update）。
   */
  protected async runUpdate(
    missionId: string,
    userId: string | undefined,
    data: UpdateInputData,
    label: string,
  ): Promise<void> {
    try {
      if (userId) {
        await this.updateHooks.updateManyByOwner(missionId, userId, data);
      } else {
        this.log.warn(
          `[${label} ${missionId}] missing userId — falling back to update where{id}; ` +
            `caller must rely on upstream controller assertOwnership`,
        );
        await this.updateHooks.updateAnyById(missionId, data);
      }
    } catch (err: unknown) {
      this.log.warn(
        `[${label} ${missionId}] failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Reset N 个字段为 null。统一 snake_case → camelCase 映射 + status 跳过。
   *
   * @param fields - snake_case 字段名
   * @param fieldMap - 业务专属字段映射表
   */
  protected async resetFieldsFrameworkCore(
    missionId: string,
    fields: ReadonlyArray<string>,
    fieldMap: FieldNameMap,
    userId?: string,
  ): Promise<void> {
    if (fields.length === 0) return;
    const data: Record<string, null> = {};
    for (const f of fields) {
      if (f === "status") continue;
      const camel = fieldMap[f];
      if (camel) data[camel] = null;
    }
    if (Object.keys(data).length === 0) return;
    await this.runUpdate(missionId, userId, data, "resetFields");
  }
}

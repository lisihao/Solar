/**
 * BusinessAgentTeam — Mission Store Framework (P6 Wave 1, 2026-05-24)
 *
 * @migrated-from ai-app/playground/services/mission/lifecycle/mission-store.service.ts
 *
 * 抽出 mission 表通用 CRUD / heartbeat / stage / orphan cleanup 机制。
 *
 * 机制：
 *   - refreshHeartbeat (write where id; row missing → emergencyAbort)
 *   - clearHeartbeat / countRunning / markStageComplete
 *   - cleanupOrphanRunningMissionsAtomic (cutoff + batch 200 + 多 pod 原子认领)
 *
 * 业务（hooks）：
 *   - Prisma delegate IO（业务表名）
 *   - failureCode + errorMessage 文案（业务专属）
 *   - row missing 判定 + emergencyAbort 钩子
 */

import { Logger } from "@nestjs/common";
import type {
  MissionCreateBaseInput,
  MissionHeartbeatRow,
  MissionStoreHooks,
} from "./abstractions/mission-store.contract";

const DEFAULT_ORPHAN_BATCH = 200;

export abstract class BusinessTeamMissionStoreFramework<
  TCreateInput extends MissionCreateBaseInput,
> {
  protected readonly log: Logger;
  /** Per-instance set: prevent duplicate emergency-abort signals for the same mission. */
  protected readonly emergencyAborted = new Set<string>();
  private readonly orphanBatchSize: number;

  constructor(protected readonly storeHooks: MissionStoreHooks<TCreateInput>) {
    this.log = new Logger(storeHooks.loggerNamespace);
    this.orphanBatchSize = storeHooks.orphanBatchSize ?? DEFAULT_ORPHAN_BATCH;
  }

  /** 业务方暴露：mission row 创建。 */
  async create(input: TCreateInput): Promise<void> {
    await this.storeHooks.createMission(input);
  }

  /** 写 heartbeat。Row missing → emergency abort。 */
  async refreshHeartbeat(missionId: string, podId: string): Promise<void> {
    try {
      await this.storeHooks.writeHeartbeat(missionId, podId);
    } catch (err: unknown) {
      if (this.storeHooks.isMissionRowMissing(err)) {
        this.triggerEmergencyAbort(missionId, "heartbeat row missing");
        return;
      }
      this.log.error(
        `[heartbeat ${missionId}] failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  async clearHeartbeat(missionId: string, userId: string): Promise<void> {
    try {
      await this.storeHooks.resetHeartbeat(missionId, userId);
    } catch (err: unknown) {
      this.log.warn(
        `[clearHeartbeat ${missionId}] failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Stage 进度推进 (WHERE status='running')。 */
  async markStageComplete(
    missionId: string,
    stageNumber: number,
  ): Promise<void> {
    try {
      await this.storeHooks.writeStageProgress(missionId, stageNumber);
    } catch (err: unknown) {
      if (this.storeHooks.isMissionRowMissing(err)) {
        this.triggerEmergencyAbort(
          missionId,
          `markStageComplete s${stageNumber}`,
        );
        return;
      }
      this.log.error(
        `[markStageComplete ${missionId} s${stageNumber}] failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  async countRunningByUser(userId: string): Promise<number> {
    return this.storeHooks.countRunning(userId);
  }

  /**
   * P-DUR2 (2026-05-30): 多 pod 安全的 orphan cleanup —— **原子认领**版。
   *
   * 清理 status='running' 且 heartbeat stale 的 mission。Framework 算 cutoff + 限 batch；
   * 业务方负责具体 select（`findOrphanRunning`）+ 原子认领（`claimOrphanFailed`）。
   *
   * 返回 `{ orphans, claimedWinners }`：
   *   - `orphans`：本 pod 扫到的全部 stale-running orphan（只读快照，给调用方做观测）
   *   - `claimedWinners`：本 pod 用 `claimOrphanFailed` **原子抢到**（count===1）的 orphan
   *     子集 —— 调用方应**只对这些**做续跑（rerun），消除多 pod 重复 rerun。
   *
   * 注：N 个 pod 并发对同一 orphan 调本方法，DB 条件写（WHERE status='running'）保证
   * 只有一个 pod 的 updateMany 命中 1 行，其余命中 0 行 → 只有一个 pod 进 winners。
   */
  async cleanupOrphanRunningMissionsAtomic(thresholdMs: number): Promise<{
    orphans: MissionHeartbeatRow[];
    claimedWinners: MissionHeartbeatRow[];
  }> {
    try {
      const cutoff = new Date(Date.now() - thresholdMs);
      const orphans = await this.storeHooks.findOrphanRunning(
        cutoff,
        this.orphanBatchSize,
      );
      if (orphans.length === 0) return { orphans: [], claimedWinners: [] };

      const claim = this.storeHooks.claimOrphanFailed;
      const claimedWinners: MissionHeartbeatRow[] = [];
      for (const o of orphans) {
        // 逐 orphan 原子认领：count===1 本 pod 赢，count===0 其它 pod 抢先。
        const won = await claim(o.id).catch((err: unknown) => {
          this.log.warn(
            `[cleanupOrphanRunningMissionsAtomic] claim ${o.id} failed (treat as lost): ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          return false;
        });
        if (won) claimedWinners.push(o);
      }
      return { orphans: [...orphans], claimedWinners };
    } catch (err: unknown) {
      this.log.error(
        `[cleanupOrphanRunningMissionsAtomic] failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return { orphans: [], claimedWinners: [] };
    }
  }

  /** Emergency abort wrapper —— 防重 + log。 */
  protected triggerEmergencyAbort(missionId: string, reason: string): void {
    if (this.emergencyAborted.has(missionId)) return;
    this.emergencyAborted.add(missionId);
    this.log.error(
      `[emergency-abort] mission=${missionId} reason="${reason}" — DB row missing, ` +
        `proactively aborting in-flight orchestrator to prevent FK / heartbeat error storm.`,
    );
    this.storeHooks.emergencyAbort(missionId, reason);
  }
}

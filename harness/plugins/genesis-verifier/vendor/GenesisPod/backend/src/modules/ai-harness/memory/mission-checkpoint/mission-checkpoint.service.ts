/**
 * MissionCheckpointService — 通用 mission/job checkpoint 管理
 *
 * 沉淀自：ai-app/{app}/services/monitoring/research-checkpoint.service.ts
 * 剥离了对 prisma.researchMission 的硬耦合，改为依赖 MissionCheckpointStore 接口。
 *
 * 用途：
 *   - 长任务（mission > 5 min）中断时保留进度
 *   - 服务启动时自动恢复 EXECUTING 状态的任务
 *   - 用户主动 pause / resume 流程
 *
 * 通用策略：
 *   1. saveCheckpoint：业务侧每完成一批关键步骤后调用一次
 *   2. canResume：判断 mission 是否在可恢复窗口（<24h 默认）
 *   3. resumeFromCheckpoint：返回 completedKeys 让业务侧跳过已完成步骤
 *
 * 注：本服务不做实际任务调度，只管理 checkpoint 数据。调度由 CheckpointAwareExecutor
 *    或业务侧自行完成。
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import type {
  MissionCheckpointSnapshot,
  MissionCheckpointStore,
} from "./checkpoint-store.interface";

const DEFAULT_RESUME_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

export interface MissionResumeDecision<TPayload> {
  canResume: boolean;
  reason?: "no-checkpoint" | "expired" | "wrong-status" | "ok";
  snapshot: MissionCheckpointSnapshot<TPayload> | null;
  /** 从 checkpoint 算出的可跳过步骤集合 */
  completedKeys: Set<string>;
}

@Injectable()
export class MissionCheckpointService<TPayload = unknown> {
  private readonly log = new Logger(MissionCheckpointService.name);

  constructor(
    private readonly store: MissionCheckpointStore<TPayload>,
    private readonly resumeWindowMs: number = DEFAULT_RESUME_WINDOW_MS,
    /** B (2026-05-05): CHECKPOINT_SAVE/LOAD hook seam — plugin 可加密 / 切 backend */
    @Optional()
    private readonly hookBus?: import("@/plugins/core/hook-bus").HookBus,
  ) {}

  async save(
    missionId: string,
    payload: TPayload,
    completedKeys: string[],
    status: MissionCheckpointSnapshot["status"] = "running",
  ): Promise<void> {
    try {
      const terminal = async () => {
        await this.store.save({
          missionId,
          savedAt: new Date(),
          payload,
          completedKeys,
          status,
        });
      };
      if (this.hookBus) {
        await this.hookBus.fire(
          "harness.checkpoint.save",
          {
            missionId,
            stage: status,
            snapshot: payload,
            completedKeys,
          },
          terminal,
        );
      } else {
        await terminal();
      }
      this.log.debug(
        `[checkpoint] saved mission=${missionId} keys=${completedKeys.length} status=${status}`,
      );
    } catch (err) {
      // checkpoint 失败不能阻断主流程
      this.log.warn(
        `[checkpoint] save failed mission=${missionId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async load(
    missionId: string,
  ): Promise<MissionCheckpointSnapshot<TPayload> | null> {
    try {
      const terminal = () => this.store.load(missionId);
      if (this.hookBus) {
        return await this.hookBus.fire(
          "harness.checkpoint.load",
          { missionId },
          terminal,
        );
      }
      return await terminal();
    } catch (err) {
      this.log.warn(
        `[checkpoint] load failed mission=${missionId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  async canResume(missionId: string): Promise<MissionResumeDecision<TPayload>> {
    const snap = await this.load(missionId);
    if (!snap) {
      return {
        canResume: false,
        reason: "no-checkpoint",
        snapshot: null,
        completedKeys: new Set(),
      };
    }
    // ★ 全覆盖审计修 (2026-05-06): canResume 只看 snapshot 自身的 savedAt age，
    //   不再 reject 'quality-failed'/'failed' 状态——这些 mission 可能需要从
    //   checkpoint resume 以便补充内容再试；仅 'completed'/'cancelled' 是真终态
    //   且无需 resume（P1 修复：解耦 snapshot status 与 mission.status）。
    if (snap.status === "completed" || snap.status === "cancelled") {
      return {
        canResume: false,
        reason: "wrong-status",
        snapshot: snap,
        completedKeys: new Set(snap.completedKeys),
      };
    }
    const ageMs = Date.now() - snap.savedAt.getTime();
    if (ageMs > this.resumeWindowMs) {
      return {
        canResume: false,
        reason: "expired",
        snapshot: snap,
        completedKeys: new Set(snap.completedKeys),
      };
    }
    return {
      canResume: true,
      reason: "ok",
      snapshot: snap,
      completedKeys: new Set(snap.completedKeys),
    };
  }

  async clear(missionId: string): Promise<void> {
    try {
      await this.store.clear(missionId);
    } catch (err) {
      this.log.warn(
        `[checkpoint] clear failed mission=${missionId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async listResumable(
    userId: string,
  ): Promise<MissionCheckpointSnapshot<TPayload>[]> {
    const cutoff = new Date(Date.now() - this.resumeWindowMs);
    try {
      return await this.store.listResumable(userId, cutoff);
    } catch (err) {
      this.log.warn(
        `[checkpoint] listResumable failed user=${userId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  /**
   * 给业务侧的便捷判断：某个 key 是否已在 checkpoint 中完成。
   */
  isCompleted(decision: MissionResumeDecision<TPayload>, key: string): boolean {
    return decision.completedKeys.has(key);
  }

  /**
   * ★ P0-R5-2 (2026-04-30): rerun 闭环 — 把 fromMissionId 的 checkpoint 复制到
   *   toMissionId（新建的 rerun mission）让其跳过已完成 stage。
   *   过期 / status=completed/cancelled 的 checkpoint 不复制（rerun 应当从头跑）。
   *   返回值：是否成功复制（false 表示无可恢复 checkpoint，新 mission 从 S1 全跑）。
   */
  async cloneCheckpoint(
    fromMissionId: string,
    toMissionId: string,
  ): Promise<boolean> {
    const decision = await this.canResume(fromMissionId);
    if (!decision.canResume || !decision.snapshot) {
      this.log.debug(
        `[checkpoint.clone] from=${fromMissionId} → to=${toMissionId} skipped (reason=${decision.reason})`,
      );
      return false;
    }
    await this.save(
      toMissionId,
      decision.snapshot.payload,
      decision.snapshot.completedKeys,
      "running",
    );
    this.log.log(
      `[checkpoint.clone] from=${fromMissionId} → to=${toMissionId} keys=${decision.snapshot.completedKeys.length}`,
    );
    return true;
  }
}

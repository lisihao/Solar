/**
 * MissionAbortRegistry —— 管理 mission 级 AbortController
 *
 * 上游：mission-pipeline-baseline.md §9.4 / Q11 (取消支持)
 *
 * 用法：
 *   - mission 启动时 register(missionId, controller)
 *   - cancelMission HTTP endpoint 调 abort(missionId)
 *   - mission 结束（成功/失败/取消）调 unregister(missionId)
 *   - orchestrator 把 controller.signal 透传给 AgentRunner.run({ signal })
 */

import { Injectable, Logger, OnApplicationShutdown } from "@nestjs/common";

/**
 * ★ C1 / G2（2026-05-22）：mission abort 原因 canonical enum（single source of truth）。
 * 取代此前 `abort(id, reason?: string)` 的裸字符串——传字符串现在 tsc 即红（L1 类型主防线）。
 * string enum，值 === 既有字符串字面量 → 零行为变化，仅加类型约束。
 * AbortReason 是 MissionFailureCode 的真子集（C2 映射恒等 + source=runtime）。
 */
export enum MissionAbortReason {
  user_cancelled = "user_cancelled",
  budget_exhausted = "budget_exhausted",
  mission_wall_time_exceeded = "mission_wall_time_exceeded",
  // ★ 2026-06-11：liveness "无进度"回收时主动中断 in-flight。心跳改为跟随真实进度
  //   后（#1），"无活动"不再等于"worker 已死"——可能是活着但卡住/空转仍在烧钱，必须
  //   abort 止血。abort 幂等：worker 死/异 pod 则 no-op，活则中断。映射 runtime_crashed。
  mission_no_activity = "mission_no_activity",
  mission_row_missing = "mission_row_missing",
  rerun_replacing_stale = "rerun_replacing_stale",
  superseded = "superseded",
  orchestrator_shutdown = "orchestrator_shutdown",
}

@Injectable()
export class MissionAbortRegistry implements OnApplicationShutdown {
  private readonly log = new Logger(MissionAbortRegistry.name);
  private readonly map = new Map<string, AbortController>();

  register(missionId: string): AbortController {
    const c = new AbortController();
    this.map.set(missionId, c);
    return c;
  }

  abort(missionId: string, reason: MissionAbortReason): boolean {
    const c = this.map.get(missionId);
    if (!c) return false;
    // ★ P2-2 (2026-04-29): abort 是幂等的，二次调用 signal 已 aborted；跳过重复日志
    if (c.signal.aborted) return false;
    try {
      c.abort(reason);
      this.log.log(`[abort] mission=${missionId} reason=${reason}`);
      return true;
    } catch (err) {
      this.log.warn(
        `[abort] mission=${missionId} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  unregister(missionId: string): void {
    this.map.delete(missionId);
  }

  getSignal(missionId: string): AbortSignal | undefined {
    return this.map.get(missionId)?.signal;
  }

  /** Phase P16-1: trace + monitoring */
  isAborted(missionId: string): boolean {
    return this.map.get(missionId)?.signal?.aborted ?? false;
  }

  size(): number {
    return this.map.size;
  }

  /** dev-only：列出当前活跃的 mission（debug） */
  listActive(): string[] {
    return Array.from(this.map.keys());
  }

  /**
   * ★ E17 (2026-05-25) graceful shutdown —— pod 收到 SIGTERM（滚动部署 / 缩容）时
   * NestJS 触发本钩子（需 main.ts app.enableShutdownHooks()）。
   *
   * 行为：把本 pod 所有在跑 mission 立即 abort(orchestrator_shutdown) → orchestrator
   * loop 顶 check 命中 → in-flight LLM / tool 立刻停，避免 drain 窗口继续烧钱；pipeline
   * finally 走 finalize 标失败（unregister 后 map.size 递减）。随后给一个有限 drain
   * 窗口（≤3s）让 finalize 落库；窗口内没落完的由 liveness-guard 兜底回收。
   *
   * 取代此前"无 graceful、靠 liveness ≥5min stale 回收"（审计 E17 / P0-#3，
   * orchestrator_shutdown 此前 0 调用者）。
   */
  async onApplicationShutdown(signal?: string): Promise<void> {
    const active = this.listActive();
    if (active.length === 0) return;
    this.log.warn(
      `[shutdown] signal=${signal ?? "?"} aborting ${active.length} in-flight mission(s) (orchestrator_shutdown)`,
    );
    for (const missionId of active) {
      this.abort(missionId, MissionAbortReason.orchestrator_shutdown);
    }
    // 有限 drain：等 pipeline finally → finalize → unregister 把 map 清空，最多 ~3s
    const deadlineMs = Date.now() + 3000;
    while (this.map.size > 0 && Date.now() < deadlineMs) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (this.map.size > 0) {
      this.log.warn(
        `[shutdown] ${this.map.size} mission(s) 未在 grace 窗口内 finalize；交由 liveness-guard 回收`,
      );
    }
  }
}

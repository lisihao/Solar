/**
 * MissionLifecycleManager — Mission 生命周期统一接口。
 *
 * 所有把 mission 推到终态的来源（dispatcher / liveness / abort / controller）
 * 调 finalize() 提交 MissionTerminalIntent，由 arbiter 的条件写
 * （WHERE status='running'）做原子仲裁——首写者赢，后到者 no-op。
 *
 * 本 service 在 ai-harness/lifecycle 层，不知 {app} 业务表结构。
 * store 操作由 app 层实现 MissionTerminalArbiter 注入。
 */

import { Injectable, Logger } from "@nestjs/common";
import { MissionAbortRegistry, MissionAbortReason } from "./abort-registry";
import { MissionFailureCode } from "./abstractions/mission-failure";

/**
 * ★ C0 / G1（2026-05-22）：最小平台 mission 状态值域（single source of truth）。
 * 不改既有 IMissionStore 的 status 字面量（保 'completed' 不改 'succeeded'，RM6）。
 * 平台 lifecycle 不掺业务语义（quality-failed 等是业务 outcome，留 app failureCode，G6）。
 */
export type MissionLifecycleStatus =
  | "starting"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/** 终态子集（running→terminal 的目标态）。 */
export type MissionTerminalStatus = "completed" | "failed" | "cancelled";

/**
 * 终态意图——所有想把 mission 推到终态的来源（dispatcher / liveness / abort / controller）
 * 都提交这个意图给 MissionLifecycleManager.finalize，由它单点仲裁，而非各自直写 DB。
 *
 * TExtra：app 专属富载荷（report / verdicts / metrics / tokens / cost 等）。平台不解释，
 * 由该 app 的 MissionTerminalArbiter 落库。泛型保类型安全（不退化成 any 字典）。
 * failureCode 已升为 canonical MissionFailureCode（C2，不再裸 string）；完成态留空。
 */
export interface MissionTerminalIntent<
  TExtra = Readonly<Record<string, unknown>>,
> {
  readonly status: MissionTerminalStatus;
  readonly reason?: MissionAbortReason;
  readonly failureCode?: MissionFailureCode;
  readonly errorMessage?: string;
  readonly extra?: TExtra;
}

/**
 * ★ C0 终态仲裁端口（ai-app 层提供实现，harness 不知 app 表结构）。
 * 实现**必须**用条件写 `UPDATE ... WHERE status='running'`（首写者赢，原子）：
 *   - 返回 true  = 本次写赢了（行此前仍 running，已切到 intent.status）
 *   - 返回 false = 本次写输了（行已被别的来源推到终态，本次 no-op，不得覆盖）
 * 这是 C0"先有单写 owner + 首写赢"承诺的落地点：杜绝 budget→cancelled→失联 这类层层改写。
 */
export interface MissionTerminalArbiter<
  TExtra = Readonly<Record<string, unknown>>,
> {
  applyTerminalIfRunning(
    missionId: string,
    intent: MissionTerminalIntent<TExtra>,
  ): Promise<boolean>;
}

@Injectable()
export class MissionLifecycleManager {
  private readonly log = new Logger(MissionLifecycleManager.name);

  constructor(private readonly abortRegistry: MissionAbortRegistry) {}

  /**
   * ★ C0 / G1：**唯一终态写入口**。所有把 mission 推到 completed/failed/cancelled 的来源
   * （dispatcher 正常完成 / dispatcher 失败 / liveness 回收 / abort / controller 取消）都
   * 调这一个方法提交意图，由它单点仲裁，禁止各自直写 DB。
   *
   * 仲裁靠 arbiter 的条件写（WHERE status='running'）：首写赢、后到者 no-op，不覆盖首写原因。
   * 这直接打穿"真因 budget_exhausted 被层层改写成 cancelled/失联"的并发竞争。
   *
   * @returns won=true 本次赢得终态写；won=false 已被别的来源终结（本次 no-op）。
   */
  async finalize<TExtra = Readonly<Record<string, unknown>>>(args: {
    missionId: string;
    intent: MissionTerminalIntent<TExtra>;
    arbiter: MissionTerminalArbiter<TExtra>;
    /** 是否同时触发 abort signal（user cancel / budget / wall-time 场景置 true）。幂等。 */
    abort?: boolean;
    /** 仅在赢得仲裁后执行的副作用（事件广播 / 清理）。输了不执行。异常被吞（非致命）。 */
    onWon?: () => Promise<void>;
  }): Promise<{ won: boolean }> {
    const { missionId, intent, arbiter, abort, onWon } = args;

    // 1. abort signal —— 让 in-flight LLM / tool call 立即中断（幂等，多次 abort 无害）
    if (abort) {
      this.abortRegistry.abort(
        missionId,
        intent.reason ?? MissionAbortReason.user_cancelled,
      );
    }

    // 2. 条件写仲裁（首写者赢）
    const won = await arbiter.applyTerminalIfRunning(missionId, intent);
    if (!won) {
      this.log.log(
        `[finalize ${missionId}] lost race → already terminal; intent='${intent.status}' no-op (不覆盖首写)`,
      );
      return { won: false };
    }
    this.log.log(
      `[finalize ${missionId}] won → '${intent.status}'${
        intent.failureCode ? ` code=${intent.failureCode}` : ""
      }`,
    );

    // 3. 赢家副作用（广播等），吞异常不影响终态
    if (onWon) {
      try {
        await onWon();
      } catch (err) {
        this.log.warn(
          `[finalize ${missionId}] onWon side-effect failed (non-fatal): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return { won: true };
  }
}

/**
 * MissionLifecycleManager.finalize —— C0/G1 单一终态写入口 + 条件写仲裁 测试
 *
 * 核心不变量（基线 C0）：终态写收口到 finalize 一个入口，靠 arbiter 的条件写
 * （WHERE status='running'）做原子仲裁——首写者赢，后到者 no-op、不覆盖首写原因。
 * 这直接打穿"真因 budget_exhausted 被层层改写成 cancelled/失联"的并发竞争。
 */

import {
  MissionLifecycleManager,
  type MissionTerminalArbiter,
  type MissionTerminalIntent,
} from "../mission-lifecycle-manager";
import { MissionAbortRegistry, MissionAbortReason } from "../abort-registry";
import { MissionFailureCode } from "../abstractions/mission-failure";

/**
 * 内存版条件写 arbiter，模拟 `UPDATE ... WHERE status='running'` 的原子语义：
 * 第一个把 running→terminal 的调用赢（返回 true），之后行已终态，再写一律 false。
 * Node 单线程 + 同步 set 保证这里的"首写赢"与 DB 行级条件写同语义。
 */
class InMemoryArbiter implements MissionTerminalArbiter {
  private terminal: MissionTerminalIntent | null = null;
  applyCalls = 0;

  // eslint-disable-next-line @typescript-eslint/require-await
  async applyTerminalIfRunning(
    _missionId: string,
    intent: MissionTerminalIntent,
  ): Promise<boolean> {
    this.applyCalls += 1;
    if (this.terminal !== null) return false; // 已终态 → 输
    this.terminal = intent; // 首写赢，原子切到终态
    return true;
  }

  get finalIntent(): MissionTerminalIntent | null {
    return this.terminal;
  }
}

describe("MissionLifecycleManager.finalize (C0/G1)", () => {
  let manager: MissionLifecycleManager;

  beforeEach(() => {
    manager = new MissionLifecycleManager(new MissionAbortRegistry());
  });

  it("赢得仲裁 → won=true 且 onWon 执行", async () => {
    const arbiter = new InMemoryArbiter();
    const onWon = jest.fn().mockResolvedValue(undefined);
    const res = await manager.finalize({
      missionId: "m1",
      intent: { status: "completed" },
      arbiter,
      onWon,
    });
    expect(res.won).toBe(true);
    expect(onWon).toHaveBeenCalledTimes(1);
    expect(arbiter.finalIntent?.status).toBe("completed");
  });

  it("输掉仲裁（已终态）→ won=false 且 onWon 不执行（不覆盖首写）", async () => {
    const arbiter = new InMemoryArbiter();
    await manager.finalize({
      missionId: "m1",
      intent: {
        status: "failed",
        failureCode: MissionFailureCode.budget_exhausted,
      },
      arbiter,
    });
    const onWon = jest.fn().mockResolvedValue(undefined);
    const res = await manager.finalize({
      missionId: "m1",
      intent: {
        status: "cancelled",
        reason: MissionAbortReason.user_cancelled,
      },
      arbiter,
      onWon,
    });
    expect(res.won).toBe(false);
    expect(onWon).not.toHaveBeenCalled();
    // 终态仍是首写的 failed/budget_exhausted，未被 cancelled 覆盖
    expect(arbiter.finalIntent?.status).toBe("failed");
    expect(arbiter.finalIntent?.failureCode).toBe(
      MissionFailureCode.budget_exhausted,
    );
  });

  it("★ 三方失败来源并发抢终态 → 只一个赢、首写原因不被覆盖（C0 核心打穿验证）", async () => {
    const arbiter = new InMemoryArbiter();
    // dispatcher budget_exhausted + controller user_cancelled + liveness fallback 几乎同时
    const intents: MissionTerminalIntent[] = [
      { status: "failed", failureCode: MissionFailureCode.budget_exhausted },
      { status: "cancelled", reason: MissionAbortReason.user_cancelled },
      {
        status: "failed",
        failureCode: MissionFailureCode.runtime_crashed,
        reason: MissionAbortReason.orchestrator_shutdown,
      },
    ];
    const results = await Promise.all(
      intents.map((intent) =>
        manager.finalize({ missionId: "race", intent, arbiter }),
      ),
    );
    const wonCount = results.filter((r) => r.won).length;
    expect(wonCount).toBe(1); // 恰好一个赢
    expect(arbiter.applyCalls).toBe(3); // 三个都尝试了
    // 最终终态是某一个 intent（首写），且之后不再变
    expect(arbiter.finalIntent).not.toBeNull();
  });

  it("abort=true 触发 abort signal（cancel/budget/walltime 场景）", async () => {
    const abortRegistry = new MissionAbortRegistry();
    const abortSpy = jest.spyOn(abortRegistry, "abort");
    const m = new MissionLifecycleManager(abortRegistry);
    const arbiter = new InMemoryArbiter();
    await m.finalize({
      missionId: "m2",
      intent: {
        status: "cancelled",
        reason: MissionAbortReason.user_cancelled,
      },
      arbiter,
      abort: true,
    });
    expect(abortSpy).toHaveBeenCalledWith("m2", "user_cancelled");
  });

  it("onWon 抛错被吞，不影响 won 结果（终态已落）", async () => {
    const arbiter = new InMemoryArbiter();
    const res = await manager.finalize({
      missionId: "m3",
      intent: { status: "completed" },
      arbiter,
      onWon: () => Promise.reject(new Error("broadcast boom")),
    });
    expect(res.won).toBe(true);
    expect(arbiter.finalIntent?.status).toBe("completed");
  });
});

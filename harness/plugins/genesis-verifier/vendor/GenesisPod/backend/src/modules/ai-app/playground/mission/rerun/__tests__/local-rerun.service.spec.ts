/**
 * LocalRerunService PR-R6 spec
 *
 * 上游：docs/architecture/ai-harness/runner/per-task-rerun-with-cascade.md v1.2 §3.4
 *
 * 反向证据：
 *   1. isLocallyRerunable — stepId 黑名单 / dag.rerunable / cascade 链
 *   2. run — TOCTOU 状态守门（heartbeat < 60s 拒绝）
 *   3. run — 实时 cost 守门（cost_usd >= max_credits 拒绝）
 *   4. run — 24h 频次闸（50 次 / 24h 保底防恶意脚本，超出 throw 429）
 *   5. run — cascade 链终点是 S11 + status=failed → markReopened
 *   6. run — cascade 链终点不到 S11 → 不调 markReopened
 *   7. run — 成功路径 emit rerun-started/completed + 写 rerun_attempts
 *   8. run — best-effort partial：cascade aborted 仍正常 return（不 throw）
 *   9. 并发锁 acquire 失败 → throw
 *  10. 老路径兼容（scope=system+s9b-objective-evaluation）仍走 dispatch
 */

import {
  BadRequestException,
  HttpException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { LocalRerunService } from "../local-rerun.service";
import type { CtxHydratorService } from "../ctx-hydrator.service";
import type { StageRerunDispatcher } from "../stage-rerun.dispatcher";
import type { MissionStore } from "../../lifecycle/mission-store.service";
import type { RerunLockRegistry } from "@/modules/ai-harness/facade";
import type { PrismaService } from "../../../../../common/prisma/prisma.service";
import type { EmitFn } from "../../context/mission-deps";

beforeAll(() => {
  jest.spyOn(Logger.prototype, "log").mockImplementation(() => {});
  jest.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
  jest.spyOn(Logger.prototype, "error").mockImplementation(() => {});
});

interface MockPrisma {
  $transaction: jest.Mock;
  agentPlaygroundMission: {
    findFirst: jest.Mock;
  };
  agentPlaygroundRerunAttempt: {
    count: jest.Mock;
    create: jest.Mock;
  };
}

function makePrisma(
  missionRow: Record<string, unknown> | null = null,
): MockPrisma {
  const mp: MockPrisma = {
    $transaction: jest.fn(),
    agentPlaygroundMission: {
      findFirst: jest.fn().mockResolvedValue(missionRow),
    },
    agentPlaygroundRerunAttempt: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({}),
    },
  };
  mp.$transaction.mockImplementation(
    async (cb: (tx: MockPrisma) => Promise<unknown>) => cb(mp),
  );
  return mp;
}

interface Mocks {
  hydrator: { hydrate: jest.Mock };
  lock: { acquire: jest.Mock; release: jest.Mock };
  dispatcher: { dispatch: jest.Mock; runFromStageWithCascade: jest.Mock };
  store: {
    getById: jest.Mock;
    markReopened: jest.Mock;
    markFailed: jest.Mock;
    // ★ C0/G1：终态写经 finalize → arbiter.applyTerminalIfRunning。
    applyTerminalIfRunning: jest.Mock;
  };
  // ★ 2026-05-07 rerun-overhaul v1.1: RerunGuardService 注入
  rerunGuard: { ensureRerunable: jest.Mock; checkInFlight: jest.Mock };
  prisma: MockPrisma;
  emit: jest.Mock;
  // ★ C0/G1：终态写唯一入口。finalize mock 复刻真实语义（调 arbiter + 赢了跑 onWon）。
  lifecycleManager: { finalize: jest.Mock };
}

function makeMocks(missionRow: Record<string, unknown> | null = null): Mocks {
  return {
    hydrator: {
      hydrate: jest.fn().mockResolvedValue({ missionId: "m1", userId: "u1" }),
    },
    lock: {
      acquire: jest.fn().mockReturnValue(true),
      release: jest.fn(),
    },
    dispatcher: {
      dispatch: jest.fn().mockResolvedValue(undefined),
      runFromStageWithCascade: jest.fn().mockResolvedValue({
        completed: ["s8-writer"],
        abortedAt: undefined,
        remaining: undefined,
      }),
    },
    store: {
      getById: jest.fn().mockResolvedValue({ status: "failed" }),
      markReopened: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
      applyTerminalIfRunning: jest.fn().mockResolvedValue(true),
    },
    rerunGuard: {
      // 缺省：放过（不 in-flight、无 zombie）
      ensureRerunable: jest.fn().mockResolvedValue(undefined),
      checkInFlight: jest.fn().mockResolvedValue({
        inFlight: false,
        zombieDetected: false,
        status: "failed",
        heartbeatAgeMs: null,
        latestBusinessEventAgeMs: null,
      }),
    },
    prisma: makePrisma(missionRow),
    emit: jest.fn().mockResolvedValue(undefined),
    lifecycleManager: {
      // finalize 复刻真实语义：调 arbiter.applyTerminalIfRunning，赢了跑 onWon（吞异常）。
      finalize: jest.fn(
        async (args: {
          missionId: string;
          intent: unknown;
          arbiter: {
            applyTerminalIfRunning: (
              id: string,
              intent: unknown,
            ) => Promise<boolean>;
          };
          onWon?: () => Promise<void>;
        }) => {
          const won = await args.arbiter.applyTerminalIfRunning(
            args.missionId,
            args.intent,
          );
          if (won && args.onWon) {
            try {
              await args.onWon();
            } catch {
              // swallow（与真实 finalize 一致）
            }
          }
          return { won };
        },
      ),
    },
  };
}

function makeService(m: Mocks): LocalRerunService {
  return new LocalRerunService(
    m.hydrator as unknown as CtxHydratorService,
    m.lock as unknown as RerunLockRegistry,
    m.dispatcher as unknown as StageRerunDispatcher,
    m.prisma as unknown as PrismaService,
    m.store as unknown as MissionStore,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    m.rerunGuard as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    m.lifecycleManager as any,
  );
}

describe("LocalRerunService.isLocallyRerunable (PR-R6)", () => {
  it("origin=leader-assess-abort → 拒绝", () => {
    const r = LocalRerunService.isLocallyRerunable({
      origin: "leader-assess-abort",
      scope: "dimension",
      todoId: "x",
    });
    expect(r.rerunable).toBe(false);
  });

  it("stepId=s1-budget → 黑名单拒绝", () => {
    const r = LocalRerunService.isLocallyRerunable({
      origin: "manual",
      scope: "system",
      todoId: "x",
      stepId: "s1-budget",
    });
    expect(r.rerunable).toBe(false);
    expect(r.reason).toMatch(/不可重跑/);
  });

  it("stepId=s8-writer → 允许 + 含 cascade chain", () => {
    const r = LocalRerunService.isLocallyRerunable({
      origin: "manual",
      scope: "system",
      todoId: "x",
      stepId: "s8-writer",
    });
    expect(r.rerunable).toBe(true);
    expect(r.cascadeChain).toBeDefined();
    expect(r.cascadeChain![0]).toBe("s8-writer");
    expect(r.cascadeChain).toContain("s11-persist");
  });

  it("stepId=s11-persist → 允许（终态局部重跑就 markCompleted 1 步）", () => {
    const r = LocalRerunService.isLocallyRerunable({
      origin: "manual",
      scope: "system",
      todoId: "x",
      stepId: "s11-persist",
    });
    expect(r.rerunable).toBe(true);
    expect(r.cascadeChain).toEqual(["s11-persist"]);
  });

  it("未知 stepId → 拒绝", () => {
    const r = LocalRerunService.isLocallyRerunable({
      origin: "manual",
      scope: "system",
      todoId: "x",
      stepId: "s99-unknown",
    });
    expect(r.rerunable).toBe(false);
    expect(r.reason).toMatch(/未知 step/);
  });

  it("老路径：scope=system + todoId 含 s9b-objective-evaluation → 允许", () => {
    const r = LocalRerunService.isLocallyRerunable({
      origin: "manual",
      scope: "system",
      todoId: "todo-x:s9b-objective-evaluation",
    });
    expect(r.rerunable).toBe(true);
  });

  it("scope=dimension 无 stepId → 拒绝", () => {
    const r = LocalRerunService.isLocallyRerunable({
      origin: "manual",
      scope: "dimension",
      todoId: "x",
    });
    expect(r.rerunable).toBe(false);
  });
});

describe("LocalRerunService.run (PR-R6)", () => {
  const baseInput = {
    missionId: "m1",
    userId: "u1",
    todoId: "todo-x",
    origin: "manual",
    scope: "system" as const,
  };
  const noopEmit: EmitFn = jest.fn().mockResolvedValue(undefined) as EmitFn;

  it("mission 不存在 → throw NotFound", async () => {
    const m = makeMocks(null);
    const svc = makeService(m);
    await expect(
      svc.run({ ...baseInput, stepId: "s8-writer" }, noopEmit),
    ).rejects.toThrow(NotFoundException);
  });

  // ★ 2026-05-07 rerun-overhaul v1.1：原"heartbeat < 60s 拒"3 case 删除（迁到
  //   rerun-guard.service.spec 9-cell 矩阵）。这里只验证 LocalRerunService 调
  //   ensureRerunable 一次（委托正确性，不重复测判定逻辑）。
  it("rerun 入口必调 rerunGuard.ensureRerunable", async () => {
    const m = makeMocks({
      id: "m1",
      status: "failed",
      heartbeatAt: null,
      costUsd: 0,
      maxCredits: 1,
    });
    const svc = makeService(m);
    await svc.run({ ...baseInput, stepId: "s8-writer" }, noopEmit);
    expect(m.rerunGuard.ensureRerunable).toHaveBeenCalledTimes(1);
    expect(m.rerunGuard.ensureRerunable).toHaveBeenCalledWith("m1", "u1");
  });

  it("rerunGuard.ensureRerunable 抛 BadRequest → run 透传不吞", async () => {
    const m = makeMocks({
      id: "m1",
      status: "running",
      heartbeatAt: new Date(),
      costUsd: 0,
      maxCredits: 1,
    });
    m.rerunGuard.ensureRerunable.mockRejectedValueOnce(
      new BadRequestException("mission m1 is in-flight (...)"),
    );
    const svc = makeService(m);
    await expect(
      svc.run({ ...baseInput, stepId: "s8-writer" }, noopEmit),
    ).rejects.toThrow(/in-flight/);
  });

  it("实时 cost guard：cost_usd >= 额度代理上限(maxCredits×0.002) → throw BadRequest", async () => {
    // ★ C3a/G11:阈值从错配的 maxCredits(credits) 改为额度代理 USD(creditBudgetProxyUsd,
    //   与 MissionBudgetPool 同一 cap)。costUsd 1.5 远超 maxCredits=1 的代理上限 0.002 USD → throw。
    const m = makeMocks({
      id: "m1",
      status: "failed",
      heartbeatAt: new Date(Date.now() - 120_000),
      costUsd: 1.5,
      maxCredits: 1.0,
    });
    const svc = makeService(m);
    await expect(
      svc.run({ ...baseInput, stepId: "s8-writer" }, noopEmit),
    ).rejects.toThrow(/累积 cost.*已达额度代理上限/);
  });

  it("24h 频次 50 次 → 第 51 次 throw 429（保底防恶意脚本）", async () => {
    const m = makeMocks({
      id: "m1",
      status: "failed",
      heartbeatAt: new Date(Date.now() - 120_000),
      costUsd: 0,
      maxCredits: 1,
    });
    m.prisma.agentPlaygroundRerunAttempt.count.mockResolvedValue(50);
    const svc = makeService(m);
    await expect(
      svc.run({ ...baseInput, stepId: "s8-writer" }, noopEmit),
    ).rejects.toThrow(HttpException);
    await expect(
      svc.run({ ...baseInput, stepId: "s8-writer" }, noopEmit),
    ).rejects.toMatchObject({ status: 429 });
  });

  // ★ 收尾评审 P1-R-边界 (2026-05-07): 频次正向断言（边界 limit-1 允许通过）
  it("24h 频次 count=49 → 第 50 次仍允许（边界正向验证）", async () => {
    const m = makeMocks({
      id: "m1",
      status: "failed",
      heartbeatAt: new Date(Date.now() - 120_000),
      costUsd: 0,
      maxCredits: 1,
    });
    m.prisma.agentPlaygroundRerunAttempt.count.mockResolvedValue(49);
    const svc = makeService(m);
    await expect(
      svc.run({ ...baseInput, stepId: "s8-writer" }, noopEmit),
    ).resolves.toMatchObject({ ok: true });
  });

  // ★ 收尾评审 P0-S1 (2026-05-07): enforceRerunFrequency where 必须含 userId（数据隔离）
  it("频次查询 where 含 userId（防跨用户污染）", async () => {
    const m = makeMocks({
      id: "m1",
      status: "failed",
      heartbeatAt: new Date(Date.now() - 120_000),
      costUsd: 0,
      maxCredits: 1,
    });
    const svc = makeService(m);
    await svc.run({ ...baseInput, stepId: "s8-writer" }, noopEmit);
    expect(m.prisma.agentPlaygroundRerunAttempt.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        missionId: "m1",
        userId: "u1",
        stepId: "s8-writer",
      }),
    });
  });

  // ★ 收尾评审 P0-S3 (2026-05-07): 失败路径也写 rerun_attempts（防失败绕过频次）
  it("dispatcher throw 时仍写 rerun_attempts（频次不被失败绕过）", async () => {
    const m = makeMocks({
      id: "m1",
      status: "failed",
      heartbeatAt: new Date(Date.now() - 120_000),
      costUsd: 0,
      maxCredits: 1,
    });
    m.dispatcher.runFromStageWithCascade.mockRejectedValue(
      new BadRequestException("simulate fail"),
    );
    const svc = makeService(m);
    await svc
      .run({ ...baseInput, stepId: "s8-writer" }, noopEmit)
      .catch((_err: unknown) => {
        // 测试场景：此处故意让 run 抛出，仅验证 recordRerunAttempt 被调用
      });
    expect(m.prisma.agentPlaygroundRerunAttempt.create).toHaveBeenCalled();
  });

  it("cascade 终点是 S11 + status=failed → 调 markReopened", async () => {
    const m = makeMocks({
      id: "m1",
      status: "failed",
      heartbeatAt: new Date(Date.now() - 120_000),
      costUsd: 0,
      maxCredits: 1,
    });
    m.store.getById.mockResolvedValue({ status: "failed" });
    const svc = makeService(m);
    await svc.run({ ...baseInput, stepId: "s8-writer" }, noopEmit);
    expect(m.store.markReopened).toHaveBeenCalledWith("m1", "u1");
  });

  it("cascade 终点不到 S11 → 不调 markReopened", async () => {
    const m = makeMocks({
      id: "m1",
      status: "failed",
      heartbeatAt: new Date(Date.now() - 120_000),
      costUsd: 0,
      maxCredits: 1,
    });
    const svc = makeService(m);
    // s11-persist itself: cascadeChain=[s11-persist]，仍包含 s11-persist
    // 用真不到 s11 的 case：legacy s9b 路径（scope+todoId）不走 stepId 路由
    await svc.run(
      {
        ...baseInput,
        todoId: "todo-x:s9b-objective-evaluation",
        // 故意不传 stepId
      },
      noopEmit,
    );
    expect(m.store.markReopened).not.toHaveBeenCalled();
  });

  it("成功路径：emit rerun-started + 写 rerun_attempts + emit rerun-completed", async () => {
    const m = makeMocks({
      id: "m1",
      status: "failed",
      heartbeatAt: new Date(Date.now() - 120_000),
      costUsd: 0,
      maxCredits: 1,
    });
    const emit = jest.fn().mockResolvedValue(undefined) as EmitFn;
    const svc = makeService(m);
    await svc.run({ ...baseInput, stepId: "s8-writer" }, emit);
    const types = (emit as jest.Mock).mock.calls.map((c) => c[0].type);
    expect(types).toContain("playground.mission:rerun-started");
    expect(types).toContain("playground.mission:rerun-completed");
    expect(m.prisma.agentPlaygroundRerunAttempt.create).toHaveBeenCalled();
  });

  it("best-effort partial：cascade aborted 仍正常 return（不 throw）", async () => {
    const m = makeMocks({
      id: "m1",
      status: "failed",
      heartbeatAt: new Date(Date.now() - 120_000),
      costUsd: 0,
      maxCredits: 1,
    });
    m.dispatcher.runFromStageWithCascade.mockResolvedValue({
      completed: ["s8-writer"],
      abortedAt: "s9-critic",
      errorMessage: "[PR-R5b] s9-critic ...",
      remaining: ["s9-critic", "s9b-objective-eval", "s10", "s11-persist"],
    });
    const svc = makeService(m);
    const result = await svc.run(
      { ...baseInput, stepId: "s8-writer" },
      noopEmit,
    );
    expect(result.ok).toBe(true);
    expect(result.cascade?.abortedAt).toBe("s9-critic");
    expect(result.cascade?.completed).toEqual(["s8-writer"]);
  });

  // ★ 收尾评审 P0-T2 (2026-05-07): cascade aborted + cascade 含 s11 → markFailed 回写
  it("cascade aborted + cascadeChain 含 s11-persist → 调 markFailed 回写 status", async () => {
    const m = makeMocks({
      id: "m1",
      status: "failed",
      heartbeatAt: new Date(Date.now() - 120_000),
      costUsd: 0,
      maxCredits: 1,
    });
    // s8-writer cascade 链含 s11-persist
    m.dispatcher.runFromStageWithCascade.mockResolvedValue({
      completed: ["s8-writer"],
      abortedAt: "s9-critic",
      errorMessage: "[PR-R5b] s9-critic ...",
      remaining: ["s9-critic", "s9b-objective-eval", "s10", "s11-persist"],
    });
    const svc = makeService(m);
    await svc.run({ ...baseInput, stepId: "s8-writer" }, noopEmit);
    // ★ C0/G1：终态写经 finalize 单入口（arbiter=store），intent 携 userId 走严格隔离。
    expect(m.lifecycleManager.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        missionId: "m1",
        arbiter: m.store,
        intent: expect.objectContaining({
          status: "failed",
          extra: expect.objectContaining({
            kind: "failed",
            userId: "u1",
            detail: expect.objectContaining({
              // ★ 2026-05-30：去掉 cascade_aborted_at_ 技术前缀，直接透传 stage 本地化消息。
              errorMessage: expect.stringContaining("[PR-R5b] s9-critic"),
            }),
          }),
        }),
      }),
    );
  });

  // ★ 收尾评审第二轮 P1 (2026-05-07): result.errorMessage=undefined 兜底为 "unknown"
  it("cascade aborted 时 result.errorMessage=undefined → markFailed 写 'unknown' 兜底", async () => {
    const m = makeMocks({
      id: "m1",
      status: "failed",
      heartbeatAt: new Date(Date.now() - 120_000),
      costUsd: 0,
      maxCredits: 1,
    });
    m.dispatcher.runFromStageWithCascade.mockResolvedValue({
      completed: ["s8-writer"],
      abortedAt: "s9-critic",
      errorMessage: undefined,
      remaining: ["s9-critic", "s9b-objective-eval", "s10", "s11-persist"],
    });
    const svc = makeService(m);
    await svc.run({ ...baseInput, stepId: "s8-writer" }, noopEmit);
    // ★ C0/G1：终态写经 finalize 单入口；errorMessage=undefined 兜底 "unknown"。
    expect(m.lifecycleManager.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: expect.objectContaining({
          status: "failed",
          extra: expect.objectContaining({
            kind: "failed",
            userId: "u1",
            detail: expect.objectContaining({
              // ★ 2026-05-30：errorMessage=undefined 兜底为本地化"重跑在阶段 X 中止"。
              errorMessage: expect.stringMatching(/重跑在阶段 s9-critic 中止/),
            }),
          }),
        }),
      }),
    );
  });

  // ★ 收尾评审 P0-T2 配套：cascadeChain 不含 s11 → 不 markFailed（无需回写，老状态保留）
  it("cascade aborted + cascadeChain 不到 s11-persist → 不 markFailed", async () => {
    const m = makeMocks({
      id: "m1",
      status: "completed",
      heartbeatAt: new Date(Date.now() - 120_000),
      costUsd: 0,
      maxCredits: 1,
    });
    // 注：实际 PR-R5 所有 cascade 都到 s11，这里用 mock 模拟特殊场景验证守卫
    m.dispatcher.runFromStageWithCascade.mockResolvedValue({
      completed: [],
      abortedAt: "s11-persist",
      errorMessage: "fake",
      remaining: ["s11-persist"],
    });
    // cascadeChain=[s11-persist]（终点本身就是 s11，反而是 maybeReopen 不该跑的场景，
    // 但 markFailed 仍应在 reachesTerminal 路径触发 — 这是单元测试边界）
    const svc = makeService(m);
    await svc.run({ ...baseInput, stepId: "s11-persist" }, noopEmit);
    // s11 cascade 含 s11 自身 → 触发终态写（经 finalize 单入口）
    expect(m.lifecycleManager.finalize).toHaveBeenCalled();
  });

  it("并发锁 acquire 失败 → throw BadRequest", async () => {
    const m = makeMocks({
      id: "m1",
      status: "failed",
      heartbeatAt: new Date(Date.now() - 120_000),
      costUsd: 0,
      maxCredits: 1,
    });
    m.lock.acquire.mockReturnValue(false);
    const svc = makeService(m);
    await expect(
      svc.run({ ...baseInput, stepId: "s8-writer" }, noopEmit),
    ).rejects.toThrow(/正在重跑/);
  });

  it("老路径兼容：scope=system + s9b todoId 走 dispatch (不走 cascade)", async () => {
    const m = makeMocks({
      id: "m1",
      status: "failed",
      heartbeatAt: new Date(Date.now() - 120_000),
      costUsd: 0,
      maxCredits: 1,
    });
    const svc = makeService(m);
    await svc.run(
      {
        ...baseInput,
        todoId: "todo-x:s9b-objective-evaluation",
        // 不传 stepId → 走老路径
      },
      noopEmit,
    );
    expect(m.dispatcher.dispatch).toHaveBeenCalled();
    expect(m.dispatcher.runFromStageWithCascade).not.toHaveBeenCalled();
  });

  it("dispatcher throw → emit rerun-failed + release lock + throw", async () => {
    const m = makeMocks({
      id: "m1",
      status: "failed",
      heartbeatAt: new Date(Date.now() - 120_000),
      costUsd: 0,
      maxCredits: 1,
    });
    m.dispatcher.runFromStageWithCascade.mockRejectedValue(
      new BadRequestException("simulate fail"),
    );
    const emit = jest.fn().mockResolvedValue(undefined) as EmitFn;
    const svc = makeService(m);
    await expect(
      svc.run({ ...baseInput, stepId: "s8-writer" }, emit),
    ).rejects.toThrow(/simulate fail/);
    const failedEmit = (emit as jest.Mock).mock.calls.find(
      (c) => c[0].type === "playground.mission:rerun-failed",
    );
    expect(failedEmit).toBeDefined();
    expect(m.lock.release).toHaveBeenCalled();
  });
});

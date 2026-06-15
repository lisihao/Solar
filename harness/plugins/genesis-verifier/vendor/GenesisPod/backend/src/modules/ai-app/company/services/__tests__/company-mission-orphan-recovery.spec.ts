/**
 * company orphan 恢复 spec（P0 耐久）。
 *
 * 验证 boot 时 recoverOrphanMissions：
 *   1. 可恢复（有 __checkpoint.lastStepId + __dispatch.capabilityId）→ 同 missionId 重跑
 *      （runHeroMission 被调，能力核经 loadCheckpoint 续跑）。
 *   2. 不可恢复（无 checkpoint）→ finalizeIfNotCancelled 写 failed + emit mission:failed（杀僵尸）。
 *   3. 原子认领失败（claim count!==1，多 pod 竞争）→ 跳过（不重复续跑/不重复 fail）。
 *
 * 不依赖 NestJS DI：手动构造 service + mock prisma.companyMission。
 */
import { CompanyMissionService } from "../company-mission.service";

interface PrismaMissionMock {
  findFirst: jest.Mock;
  findMany: jest.Mock;
  updateMany: jest.Mock;
  update: jest.Mock;
  findUnique: jest.Mock;
}

function makeService(missionOverrides: Partial<PrismaMissionMock> = {}): {
  service: CompanyMissionService;
  companyMission: PrismaMissionMock;
  emit: jest.SpyInstance;
  runHeroSpy: jest.SpyInstance;
} {
  const companyMission: PrismaMissionMock = {
    findFirst: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    update: jest.fn().mockResolvedValue({}),
    findUnique: jest.fn().mockResolvedValue(null),
    ...missionOverrides,
  };
  const prisma = { companyMission };
  const eventBus = { emit: jest.fn().mockResolvedValue(undefined) };
  const service = new CompanyMissionService(
    prisma as never,
    eventBus as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  // runHeroMission 是 resume 落点；spy 掉避免真跑 runViaCapability。
  const runHeroSpy = jest
    .spyOn(
      service as unknown as { runHeroMission: () => Promise<void> },
      "runHeroMission",
    )
    .mockResolvedValue(undefined);
  // service.emit 是事件 wrapper（封装 eventBus）；直接 spy 它断言 (type, missionId, ...) 调用。
  const emit = jest
    .spyOn(service as unknown as { emit: () => Promise<void> }, "emit")
    .mockResolvedValue(undefined);
  return { service, companyMission, emit, runHeroSpy };
}

function callRecover(service: CompanyMissionService): Promise<void> {
  return (
    service as unknown as { recoverOrphanMissions: () => Promise<void> }
  ).recoverOrphanMissions();
}

describe("company orphan 恢复（recoverOrphanMissions）", () => {
  it("手动继续失败任务 → 同 missionId 从 checkpoint 续跑", async () => {
    const failedMission = {
      id: "m-manual-resume",
      userId: "u1",
      heroId: "h1",
      title: "深度研究 Y",
      status: "failed",
      progress: 70,
      result: {
        __checkpoint: { lastStepId: "S8-writer" },
        __dispatch: {
          capabilityId: "deep-insight-solar",
          preferredModelId: "gpt-5.5",
          extra: { depth: "deep", language: "zh-CN" },
        },
      },
    };
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const { service, runHeroSpy } = makeService({
      findFirst: jest.fn().mockResolvedValue(failedMission),
      findUnique: jest
        .fn()
        .mockResolvedValue({ ...failedMission, status: "queued" }),
      updateMany,
    });

    const resumed = await service.resumeHeroMission("u1", "m-manual-resume");

    expect(resumed.id).toBe("m-manual-resume");
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "m-manual-resume", userId: "u1", status: "failed" },
      data: { status: "queued", progress: 70 },
    });
    expect(runHeroSpy).toHaveBeenCalledWith(
      "m-manual-resume",
      "u1",
      "deep-insight-solar",
      "深度研究 Y",
      "gpt-5.5",
      { depth: "deep", language: "zh-CN" },
    );
  });

  it("手动继续失败任务但无 checkpoint → 拒绝继续", async () => {
    const { service, runHeroSpy } = makeService({
      findFirst: jest.fn().mockResolvedValue({
        id: "m-no-checkpoint",
        userId: "u1",
        title: "T",
        status: "failed",
        progress: 0,
        result: { __dispatch: { capabilityId: "deep-insight" } },
      }),
    });

    await expect(
      service.resumeHeroMission("u1", "m-no-checkpoint"),
    ).rejects.toThrow("缺少可恢复 checkpoint");
    expect(runHeroSpy).not.toHaveBeenCalled();
  });

  it("刷新列表发现 running 但本 pod 无 worker → 自动从 checkpoint 接回", async () => {
    const detached = {
      id: "m-detached-running",
      userId: "u1",
      heroId: "h1",
      title: "断线任务",
      status: "running",
      progress: 0,
      result: {
        __checkpoint: { lastStepId: "s2-leader-plan" },
        __dispatch: {
          capabilityId: "deep-insight",
          preferredModelId: "deepseek-v4-pro",
          extra: { depth: "deep" },
        },
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const { service, runHeroSpy } = makeService({
      findMany: jest.fn().mockResolvedValue([detached]),
      findFirst: jest.fn().mockResolvedValue(detached),
      findUnique: jest.fn().mockResolvedValue({ ...detached, status: "queued" }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    });

    const missions = await service.listMissions("u1");
    await Promise.resolve();

    expect(missions).toHaveLength(1);
    expect(runHeroSpy).toHaveBeenCalledWith(
      "m-detached-running",
      "u1",
      "deep-insight",
      "断线任务",
      "deepseek-v4-pro",
      { depth: "deep" },
    );
  });

  it("可恢复（checkpoint + dispatch）→ 同 missionId 重跑", async () => {
    const orphan = {
      id: "m-resume",
      userId: "u1",
      title: "深度研究 X",
      progress: 50,
      result: {
        __checkpoint: { lastStepId: "s5-reconciler" },
        __dispatch: {
          capabilityId: "deep-insight",
          preferredModelId: "",
          extra: { depth: "deep" },
        },
      },
    };
    const { service, runHeroSpy, emit } = makeService({
      findMany: jest.fn().mockResolvedValue([orphan]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }), // 认领成功
    });
    await callRecover(service);
    // 续跑：runHeroMission(id, userId, capabilityId, title, model, extra)
    expect(runHeroSpy).toHaveBeenCalledTimes(1);
    expect(runHeroSpy).toHaveBeenCalledWith(
      "m-resume",
      "u1",
      "deep-insight",
      "深度研究 X",
      "",
      { depth: "deep" },
    );
    // 续跑路径不 emit failed。
    expect(
      emit.mock.calls.find((c) => c[0] === "company.mission:failed"),
    ).toBeUndefined();
  });

  it("可恢复（只有 inFlightStepId + dispatch）→ 同 missionId 重跑", async () => {
    const orphan = {
      id: "m-inflight-resume",
      userId: "u1",
      title: "Solar 长步骤",
      progress: 5,
      result: {
        __checkpoint: {
          lastStepId: "__mission_start__",
          inFlightStepId: "s2-leader-plan",
          topic: "T",
          crossState: {},
        },
        __dispatch: {
          capabilityId: "deep-insight-solar",
          preferredModelId: "",
          extra: { depth: "deep" },
        },
      },
    };
    const { service, runHeroSpy, emit } = makeService({
      findMany: jest.fn().mockResolvedValue([orphan]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    });
    await callRecover(service);
    expect(runHeroSpy).toHaveBeenCalledTimes(1);
    expect(runHeroSpy).toHaveBeenCalledWith(
      "m-inflight-resume",
      "u1",
      "deep-insight-solar",
      "Solar 长步骤",
      "",
      { depth: "deep" },
    );
    expect(
      emit.mock.calls.find((c) => c[0] === "company.mission:failed"),
    ).toBeUndefined();
  });

  it("不可恢复（无 checkpoint）→ mark failed + emit（杀僵尸）", async () => {
    const orphan = {
      id: "m-fail",
      userId: "u2",
      title: "T",
      progress: 10,
      result: {}, // 无 __checkpoint
    };
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const { service, runHeroSpy, emit } = makeService({
      findMany: jest.fn().mockResolvedValue([orphan]),
      updateMany,
    });
    await callRecover(service);
    expect(runHeroSpy).not.toHaveBeenCalled();
    // finalizeIfNotCancelled 写 failed（updateMany 第二次调用，data.status==='failed'）。
    const failedWrite = updateMany.mock.calls.find(
      (c) => c[0]?.data?.status === "failed",
    );
    expect(failedWrite).toBeDefined();
    // emit mission:failed。
    expect(
      emit.mock.calls.find((c) => c[0] === "company.mission:failed"),
    ).toBeDefined();
  });

  it("认领失败（claim count!==1，多 pod 竞争）→ 跳过", async () => {
    const orphan = {
      id: "m-lost",
      userId: "u3",
      title: "T",
      progress: 0,
      result: {
        __checkpoint: { lastStepId: "s3-researcher-collect" },
        __dispatch: { capabilityId: "deep-insight" },
      },
    };
    const { service, runHeroSpy, emit } = makeService({
      findMany: jest.fn().mockResolvedValue([orphan]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }), // 被别的 pod 抢了
    });
    await callRecover(service);
    expect(runHeroSpy).not.toHaveBeenCalled();
    expect(
      emit.mock.calls.find((c) => c[0] === "company.mission:failed"),
    ).toBeUndefined();
  });

  it("无 stale orphan → 不动任何 mission", async () => {
    const { service, runHeroSpy, emit } = makeService({
      findMany: jest.fn().mockResolvedValue([]),
    });
    await callRecover(service);
    expect(runHeroSpy).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });
});

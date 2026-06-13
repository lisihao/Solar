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

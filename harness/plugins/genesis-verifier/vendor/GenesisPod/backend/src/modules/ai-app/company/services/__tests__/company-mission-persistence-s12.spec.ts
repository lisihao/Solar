/**
 * company-mission-persistence-s12.spec.ts
 *
 * 覆盖三个新 MissionPersistencePort 可选方法：
 *   - recordPlanDimensions: 落 result.steps（仅空时写，已有不覆盖）
 *   - recordPostmortem:     调 CompanyMissionPostmortemHelper.recordMissionPostmortem（写 harness_vector_memory）
 *   - recallPostmortems:    调 helper.listRecentPostmortems，映射返回形状
 *
 * Fix C13: findRecentMissionId 仅匹配 capability mission（result.capabilityId 非 NULL），
 *   chat mission（无 capabilityId）不触发 S12 catch-up 轮询。
 */

import { Prisma } from "@prisma/client";
import { CompanyMissionPersistenceAdapter } from "../company-mission-persistence.adapter";
import { CompanyMissionPostmortemHelper } from "../company-mission-postmortem.helper";

// ── helpers ────────────────────────────────────────────────────────────────────

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    companyMission: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      ...overrides,
    },
    harnessVectorMemory: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

function makeHelper(
  prisma: ReturnType<typeof makePrisma>,
  overrides: Partial<CompanyMissionPostmortemHelper> = {},
): CompanyMissionPostmortemHelper {
  const helper = new CompanyMissionPostmortemHelper(
    prisma as never,
    undefined, // no embedding service
  );
  return Object.assign(helper, overrides);
}

function makeAdapter(
  prisma: ReturnType<typeof makePrisma>,
  helper: CompanyMissionPostmortemHelper,
) {
  return new CompanyMissionPersistenceAdapter(prisma as never, helper);
}

// ── recordPlanDimensions ───────────────────────────────────────────────────────

describe("CompanyMissionPersistenceAdapter.recordPlanDimensions", () => {
  it("落 result.steps 当 steps 为空时", async () => {
    const prisma = makePrisma();
    prisma.companyMission.findUnique = jest.fn().mockResolvedValue({
      status: "running",
      result: {}, // 空 result，无 steps
    });

    const helper = makeHelper(prisma);
    const adapter = makeAdapter(prisma, helper);

    await adapter.recordPlanDimensions("m1", [
      { id: "d1", name: "Dimension A", rationale: "why A" },
      { id: "d2", name: "Dimension B" },
    ]);

    expect(prisma.companyMission.update).toHaveBeenCalledTimes(1);
    const data = prisma.companyMission.update.mock.calls[0][0].data.result;
    const parsed = typeof data === "string" ? JSON.parse(data) : data;
    expect(parsed.steps).toHaveLength(2);
    expect(parsed.steps[0].label).toBe("Dimension A");
    expect(parsed.steps[1].label).toBe("Dimension B");
    expect(parsed.dimensions).toEqual(["Dimension A", "Dimension B"]);
  });

  it("已有 steps 时不覆盖（首写赢）", async () => {
    const prisma = makePrisma();
    prisma.companyMission.findUnique = jest.fn().mockResolvedValue({
      status: "running",
      result: { steps: [{ label: "existing", status: "completed" }] },
    });

    const helper = makeHelper(prisma);
    const adapter = makeAdapter(prisma, helper);

    await adapter.recordPlanDimensions("m1", [{ name: "New Dim" }]);

    expect(prisma.companyMission.update).not.toHaveBeenCalled();
  });

  it("非运行中状态时不写", async () => {
    const prisma = makePrisma();
    prisma.companyMission.findUnique = jest.fn().mockResolvedValue({
      status: "done",
      result: {},
    });

    const helper = makeHelper(prisma);
    const adapter = makeAdapter(prisma, helper);

    await adapter.recordPlanDimensions("m1", [{ name: "Dim X" }]);

    expect(prisma.companyMission.update).not.toHaveBeenCalled();
  });

  it("best-effort：DB 异常时 warn 不抛", async () => {
    const prisma = makePrisma();
    prisma.companyMission.findUnique = jest
      .fn()
      .mockRejectedValue(new Error("db down"));

    const helper = makeHelper(prisma);
    const adapter = makeAdapter(prisma, helper);

    await expect(
      adapter.recordPlanDimensions("m1", [{ name: "Dim" }]),
    ).resolves.toBeUndefined();
  });
});

// ── recordPostmortem ───────────────────────────────────────────────────────────

describe("CompanyMissionPersistenceAdapter.recordPostmortem", () => {
  it("调 helper.recordMissionPostmortem → 写 harness_vector_memory", async () => {
    const prisma = makePrisma();
    const helper = makeHelper(prisma);
    const spy = jest
      .spyOn(helper, "recordMissionPostmortem")
      .mockResolvedValue(undefined);

    const adapter = makeAdapter(prisma, helper);

    await adapter.recordPostmortem({
      missionId: "m1",
      userId: "u1",
      topic: "AI trends",
      summary: "Summary here",
      recommendations: ["rec1", "rec2"],
      leaderSigned: true,
      qualityScore: 85,
      tokensUsed: 1000,
      costUsd: 0.02,
      source: "deep-insight:mission",
      tags: ["company", "mission-postmortem"],
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const arg = spy.mock.calls[0][0];
    expect(arg.missionId).toBe("m1");
    expect(arg.userId).toBe("u1");
    expect(arg.topic).toBe("AI trends");
    expect(arg.recommendations).toEqual(["rec1", "rec2"]);
    expect(arg.leaderSigned).toBe(true);
    expect(arg.qualityScore).toBe(85);
    expect(arg.source).toBe("deep-insight:mission");
  });

  it("best-effort：helper 抛时 warn 不抛", async () => {
    const prisma = makePrisma();
    const helper = makeHelper(prisma);
    jest
      .spyOn(helper, "recordMissionPostmortem")
      .mockRejectedValue(new Error("vector db down"));

    const adapter = makeAdapter(prisma, helper);

    await expect(
      adapter.recordPostmortem({
        missionId: "m1",
        userId: "u1",
        topic: "test",
        summary: "s",
        recommendations: [],
        leaderSigned: null,
        qualityScore: null,
        tokensUsed: 0,
        costUsd: 0,
        source: "deep-insight:mission",
        tags: [],
      }),
    ).resolves.toBeUndefined();
  });
});

// ── recallPostmortems ──────────────────────────────────────────────────────────

describe("CompanyMissionPersistenceAdapter.recallPostmortems", () => {
  it("返回 helper.listRecentPostmortems 的映射结果（createdAt → ISO string）", async () => {
    const prisma = makePrisma();
    const helper = makeHelper(prisma);
    const createdAt = new Date("2026-06-01T00:00:00Z");
    jest.spyOn(helper, "listRecentPostmortems").mockResolvedValue([
      {
        missionId: "m1",
        topic: "AI trends",
        summary: "Summary",
        recommendations: ["rec1"],
        leaderSigned: true,
        qualityScore: 80,
        createdAt,
      },
    ]);

    const adapter = makeAdapter(prisma, helper);

    const result = await adapter.recallPostmortems({
      userId: "u1",
      topic: "AI",
      limit: 3,
    });

    expect(result).toHaveLength(1);
    expect(result[0].missionId).toBe("m1");
    expect(result[0].topic).toBe("AI trends");
    expect(result[0].recommendations).toEqual(["rec1"]);
    expect(result[0].leaderSigned).toBe(true);
    expect(result[0].qualityScore).toBe(80);
    expect(result[0].createdAt).toBe("2026-06-01T00:00:00.000Z");
  });

  it("空结果时返回空数组", async () => {
    const prisma = makePrisma();
    const helper = makeHelper(prisma);
    jest.spyOn(helper, "listRecentPostmortems").mockResolvedValue([]);

    const adapter = makeAdapter(prisma, helper);

    const result = await adapter.recallPostmortems({
      userId: "u1",
      topic: "x",
    });
    expect(result).toEqual([]);
  });

  it("best-effort：helper 抛时 warn 不抛，回退空数组", async () => {
    const prisma = makePrisma();
    const helper = makeHelper(prisma);
    jest
      .spyOn(helper, "listRecentPostmortems")
      .mockRejectedValue(new Error("db down"));

    const adapter = makeAdapter(prisma, helper);

    const result = await adapter.recallPostmortems({
      userId: "u1",
      topic: "x",
    });
    expect(result).toEqual([]);
  });
});

// ── Fix C13: findRecentMissionId 仅匹配 capability mission ───────────────────────

describe("CompanyMissionPostmortemHelper.findRecentMissionId — 仅匹配 capability mission", () => {
  it("查询包含 capabilityId JSONB path filter（不匹配 chat mission）", async () => {
    // 验证：helper 的 findFirst where 子句包含 result path filter，
    // 确保 chat mission（result 无 capabilityId）不会被选中触发 S12 catch-up 轮询。
    const prisma = makePrisma();
    prisma.companyMission.findFirst = jest.fn().mockResolvedValue(null);
    // 添加 findMany mock（listVectorMemories 回退路径）
    prisma.harnessVectorMemory.findMany = jest.fn().mockResolvedValue([]);

    const helper = makeHelper(prisma);
    await helper.listRecentPostmortems("u1", 3);

    // findFirst 被调用，且 where 包含 result path filter
    expect(prisma.companyMission.findFirst).toHaveBeenCalledTimes(1);
    const whereArg = (prisma.companyMission.findFirst as jest.Mock).mock
      .calls[0][0].where;
    expect(whereArg.result).toEqual({
      path: ["capabilityId"],
      not: Prisma.JsonNull,
    });
  });

  it("chat mission（findFirst 返回 null）→ 不触发 S12 catch-up（listVectorMemories 只调一次）", async () => {
    // 模拟：findFirst 返回 null（chat mission 被过滤掉，近期无 capability mission）
    const prisma = makePrisma();
    prisma.companyMission.findFirst = jest.fn().mockResolvedValue(null);
    prisma.harnessVectorMemory.findMany = jest.fn().mockResolvedValue([]);

    const helper = makeHelper(prisma);
    const listSpy = jest.spyOn(
      helper as unknown as { fetchPostmortems: () => Promise<[]> },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      "fetchPostmortems" as any,
    );

    await helper.listRecentPostmortems("u1", 3);

    // recentMissionId === null → 直接返回，不进轮询循环 → fetchPostmortems 只调 1 次
    expect(listSpy).toHaveBeenCalledTimes(1);
  });

  it("capability mission（findFirst 返回 id）且 postmortem 已落库 → 一次取到，不轮询", async () => {
    const prisma = makePrisma();
    prisma.companyMission.findFirst = jest
      .fn()
      .mockResolvedValue({ id: "m-cap-1" });
    // postmortem 已在 findMany 第一次返回中存在 → 无需轮询
    prisma.harnessVectorMemory.findMany = jest.fn().mockResolvedValue([
      {
        tags: ["company", "mission-postmortem", "signed"],
        metadata: {
          missionId: "m-cap-1",
          topic: "AI trends",
          recommendations: [],
          qualityScore: 90,
        },
        content: "summary",
        createdAt: new Date(),
      },
    ]);

    const helper = makeHelper(prisma);
    const result = await helper.listRecentPostmortems("u1", 3);

    expect(result).toHaveLength(1);
    expect(result[0].missionId).toBe("m-cap-1");
    // harnessVectorMemory.findMany 只调一次（无轮询）
    expect(prisma.harnessVectorMemory.findMany).toHaveBeenCalledTimes(1);
  });
});

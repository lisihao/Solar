/**
 * RadarMissionStore rejected 终态单元测试（C0/G1 后经 applyTerminalIfRunning arbiter）
 *
 * 2026-05-17 R3 评审 P0：markRejected 方法缺失让 framework reject 的 mission 卡 running。
 * 2026-05-22 C0/G1：markRejected 降为私有 writeRejected，统一经 finalize → arbiter
 * （intent.extra.kind='rejected'，平台 status='failed'/outcome=failure G6，DB 落 'rejected'）。
 * 本 spec 锁定 rejected 落库：
 *   - 仅作用于 status='running' 的 mission（updateMany where 守）
 *   - 写入 status='rejected' + completedAt + durationMs + error (≤4000)
 *   - 不消耗用户额度（不写 metrics）
 *   - 不存在的 mission 静默忽略（updateMany 行为）
 *   - reason >4000 字符自动截断
 */

import { Test } from "@nestjs/testing";
import { PrismaService } from "@/common/prisma/prisma.service";
import { RadarMissionStore } from "../radar-mission-store.service";

/** 经唯一终态写入口 arbiter 提交 rejected intent（替代旧 store.markRejected 直调）。 */
function reject(store: RadarMissionStore, id: string, reason: string) {
  return store.applyTerminalIfRunning(id, {
    status: "failed",
    extra: { kind: "rejected", reason },
  });
}

describe("RadarMissionStore rejected (arbiter)", () => {
  let store: RadarMissionStore;
  let prisma: {
    radarRun: {
      findUnique: jest.Mock;
      updateMany: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      radarRun: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        RadarMissionStore,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    store = moduleRef.get(RadarMissionStore);
  });

  it("writes status='rejected' with completedAt + durationMs + error", async () => {
    const startedAt = new Date("2026-05-17T09:00:00Z");
    prisma.radarRun.findUnique.mockResolvedValueOnce({ startedAt });
    prisma.radarRun.updateMany.mockResolvedValueOnce({ count: 1 });

    await reject(store, "mid-1", "budget exceeded");

    expect(prisma.radarRun.updateMany).toHaveBeenCalledTimes(1);
    const arg = prisma.radarRun.updateMany.mock.calls[0]?.[0];
    expect(arg.where).toEqual({ id: "mid-1", status: "running" });
    expect(arg.data.status).toBe("rejected");
    expect(arg.data.completedAt).toBeInstanceOf(Date);
    expect(arg.data.durationMs).toBeGreaterThanOrEqual(0);
    expect(arg.data.error).toBe("budget exceeded");
  });

  it("truncates reason to 4000 chars", async () => {
    prisma.radarRun.findUnique.mockResolvedValueOnce({ startedAt: new Date() });
    prisma.radarRun.updateMany.mockResolvedValueOnce({ count: 1 });

    const longReason = "x".repeat(5000);
    await reject(store, "mid-1", longReason);

    const arg = prisma.radarRun.updateMany.mock.calls[0]?.[0];
    expect((arg.data.error as string).length).toBe(4000);
  });

  it("uses now as startedAt fallback when mission row not found", async () => {
    prisma.radarRun.findUnique.mockResolvedValueOnce(null);
    prisma.radarRun.updateMany.mockResolvedValueOnce({ count: 0 });

    await reject(store, "missing-id", "framework rejected");

    const arg = prisma.radarRun.updateMany.mock.calls[0]?.[0];
    expect(arg.data.durationMs).toBeGreaterThanOrEqual(0);
    expect(arg.data.error).toBe("framework rejected");
  });

  it("only targets running rows (status guard prevents overwriting terminal states)", async () => {
    prisma.radarRun.findUnique.mockResolvedValueOnce({ startedAt: new Date() });
    prisma.radarRun.updateMany.mockResolvedValueOnce({ count: 0 });

    await reject(store, "mid-1", "test");

    expect(prisma.radarRun.updateMany.mock.calls[0]?.[0].where.status).toBe(
      "running",
    );
  });

  it("does NOT write metrics field (rejected = mission never ran, no cost)", async () => {
    prisma.radarRun.findUnique.mockResolvedValueOnce({ startedAt: new Date() });
    prisma.radarRun.updateMany.mockResolvedValueOnce({ count: 1 });

    await reject(store, "mid-1", "test");

    const data = prisma.radarRun.updateMany.mock.calls[0]?.[0].data;
    expect(data.metrics).toBeUndefined();
  });
});

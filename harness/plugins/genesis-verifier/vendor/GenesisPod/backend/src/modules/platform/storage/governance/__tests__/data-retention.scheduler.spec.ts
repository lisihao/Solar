import { DataRetentionScheduler } from "../data-retention.scheduler";
import type { PrismaService } from "../../../../../common/prisma/prisma.service";
import type { ConfigService } from "@nestjs/config";

describe("DataRetentionScheduler", () => {
  const mk = (env: Record<string, string> = {}) => {
    const table = () => ({
      deleteMany: jest.fn().mockResolvedValue({ count: 7 }),
      count: jest.fn().mockResolvedValue(7),
    });
    const prisma = {
      harnessAgentEvent: table(),
      harnessCheckpoint: table(),
      agentPlaygroundMissionEvent: table(),
      aIEngineMetric: table(),
      secretAccessLog: table(),
    } as unknown as PrismaService;
    const config = {
      get: (k: string) => env[k],
    } as unknown as ConfigService;
    return { svc: new DataRetentionScheduler(prisma, config), prisma };
  };

  it("dry-run 模式只统计不删除", async () => {
    const { svc, prisma } = mk({ DATA_RETENTION_DRY_RUN: "true" });
    await svc.sweep();
    const p = prisma as unknown as Record<
      string,
      { deleteMany: jest.Mock; count: jest.Mock }
    >;
    for (const t of [
      "harnessAgentEvent",
      "harnessCheckpoint",
      "agentPlaygroundMissionEvent",
      "aIEngineMetric",
      "secretAccessLog",
    ]) {
      expect(p[t].count).toHaveBeenCalled();
      expect(p[t].deleteMany).not.toHaveBeenCalled();
    }
  });

  it("真实模式按 age 删除，checkpoint 仅删终态 agent（running 永不动）", async () => {
    const { svc, prisma } = mk();
    await svc.sweep();
    const p = prisma as unknown as Record<string, { deleteMany: jest.Mock }>;
    expect(p.harnessAgentEvent.deleteMany).toHaveBeenCalled();
    const ckptWhere = p.harnessCheckpoint.deleteMany.mock.calls[0][0].where;
    expect(ckptWhere.agentState).toEqual({
      in: ["completed", "failed", "cancelled"],
    });
    expect(ckptWhere.takenAt.lt).toBeInstanceOf(Date);
  });

  it("保留天数可被环境变量覆盖", async () => {
    const { svc, prisma } = mk({ RETENTION_HARNESS_EVENTS_DAYS: "7" });
    const before = Date.now();
    await svc.sweep();
    const p = prisma as unknown as Record<string, { deleteMany: jest.Mock }>;
    const cutoff: Date =
      p.harnessAgentEvent.deleteMany.mock.calls[0][0].where.emittedAt.lt;
    const diffDays = (before - cutoff.getTime()) / (24 * 3600 * 1000);
    expect(diffDays).toBeGreaterThan(6.9);
    expect(diffDays).toBeLessThan(7.1);
  });

  it("单表失败不阻塞其余表", async () => {
    const { svc, prisma } = mk();
    const p = prisma as unknown as Record<string, { deleteMany: jest.Mock }>;
    p.harnessAgentEvent.deleteMany.mockRejectedValue(new Error("db busy"));
    await expect(svc.sweep()).resolves.toBeUndefined();
    expect(p.secretAccessLog.deleteMany).toHaveBeenCalled();
  });
});

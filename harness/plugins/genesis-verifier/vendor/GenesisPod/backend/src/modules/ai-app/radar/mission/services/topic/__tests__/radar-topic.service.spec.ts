/**
 * RadarTopicService.listByUser 单元测试
 *
 * 2026-05-16 R-Hero：listByUser 加 q 搜索 + _count include 返回 counts。
 * 主要覆盖：
 *  - _count include 是否正确生成单次 query
 *  - counts 结构（sources / items / runs）正确解构 + 不带 _count 残留
 *  - q 走 OR contains (name + description)，模式 insensitive
 *  - status 过滤
 *  - cursor pagination + hasMore
 *  - limit 1-100 边界
 *  - 空 q 不参与 where
 */

import { Test } from "@nestjs/testing";
import { RadarTopicStatus } from "@prisma/client";
import { PrismaService } from "../../../../../../../common/prisma/prisma.service";
import { RadarTopicService } from "../radar-topic.service";

describe("RadarTopicService.listByUser", () => {
  let service: RadarTopicService;
  let prisma: { radarTopic: { findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      radarTopic: { findMany: jest.fn() },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        RadarTopicService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(RadarTopicService);
  });

  function makeRow(
    id: string,
    overrides: Partial<{
      sources: number;
      items: number;
      runs: number;
    }> = {},
  ) {
    return {
      id,
      userId: "u-1",
      name: `topic ${id}`,
      description: null,
      entityType: null,
      keywords: ["k"],
      refreshCron: "0 */6 * * *",
      status: RadarTopicStatus.ACTIVE,
      nextDueAt: new Date(),
      lastRunAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      _count: {
        sources: overrides.sources ?? 0,
        items: overrides.items ?? 0,
        runs: overrides.runs ?? 0,
      },
    };
  }

  it("issues findMany with _count.select for sources/items/runs (no N+1)", async () => {
    prisma.radarTopic.findMany.mockResolvedValueOnce([]);
    await service.listByUser("u-1");
    expect(prisma.radarTopic.findMany).toHaveBeenCalledTimes(1);
    const arg = prisma.radarTopic.findMany.mock.calls[0]?.[0];
    expect(arg.include).toEqual({
      _count: { select: { sources: true, items: true, runs: true } },
    });
  });

  it("maps _count → counts and strips _count from topic", async () => {
    prisma.radarTopic.findMany.mockResolvedValueOnce([
      makeRow("a", { sources: 3, items: 42, runs: 7 }),
    ]);
    const res = await service.listByUser("u-1");
    expect(res.items).toHaveLength(1);
    const item = res.items[0] as Record<string, unknown> & {
      counts: { sources: number; items: number; runs: number };
    };
    expect(item.counts).toEqual({ sources: 3, items: 42, runs: 7 });
    expect((item as Record<string, unknown>)._count).toBeUndefined();
    expect(item.id).toBe("a");
  });

  it("applies q to OR (name + description) contains insensitive", async () => {
    prisma.radarTopic.findMany.mockResolvedValueOnce([]);
    await service.listByUser("u-1", { q: "GPT-5" });
    const arg = prisma.radarTopic.findMany.mock.calls[0]?.[0];
    expect(arg.where).toMatchObject({
      userId: "u-1",
      OR: [
        { name: { contains: "GPT-5", mode: "insensitive" } },
        { description: { contains: "GPT-5", mode: "insensitive" } },
      ],
    });
  });

  it("trims q and skips OR when blank-only", async () => {
    prisma.radarTopic.findMany.mockResolvedValueOnce([]);
    await service.listByUser("u-1", { q: "   " });
    const arg = prisma.radarTopic.findMany.mock.calls[0]?.[0];
    expect(arg.where.OR).toBeUndefined();
  });

  it("applies status filter when given", async () => {
    prisma.radarTopic.findMany.mockResolvedValueOnce([]);
    await service.listByUser("u-1", { status: RadarTopicStatus.PAUSED });
    expect(prisma.radarTopic.findMany.mock.calls[0]?.[0].where).toMatchObject({
      userId: "u-1",
      status: RadarTopicStatus.PAUSED,
    });
  });

  it("clamps limit to [1, 100]", async () => {
    prisma.radarTopic.findMany.mockResolvedValue([]);

    await service.listByUser("u-1", { limit: 0 });
    expect(prisma.radarTopic.findMany.mock.calls[0]?.[0].take).toBe(2); // 1 + 1

    await service.listByUser("u-1", { limit: 1000 });
    expect(prisma.radarTopic.findMany.mock.calls[1]?.[0].take).toBe(101);

    await service.listByUser("u-1", { limit: 50 });
    expect(prisma.radarTopic.findMany.mock.calls[2]?.[0].take).toBe(51);
  });

  it("default limit = 30 when not specified", async () => {
    prisma.radarTopic.findMany.mockResolvedValueOnce([]);
    await service.listByUser("u-1");
    expect(prisma.radarTopic.findMany.mock.calls[0]?.[0].take).toBe(31);
  });

  it("hasMore true + nextCursor = last sliced id when rows.length > limit", async () => {
    const rows = Array.from({ length: 4 }, (_, i) => makeRow(`t${i}`));
    prisma.radarTopic.findMany.mockResolvedValueOnce(rows);
    const res = await service.listByUser("u-1", { limit: 3 });
    expect(res.items).toHaveLength(3);
    expect(res.nextCursor).toBe("t2");
  });

  it("hasMore false + nextCursor null when rows.length <= limit", async () => {
    const rows = [makeRow("a"), makeRow("b")];
    prisma.radarTopic.findMany.mockResolvedValueOnce(rows);
    const res = await service.listByUser("u-1", { limit: 5 });
    expect(res.items).toHaveLength(2);
    expect(res.nextCursor).toBeNull();
  });

  it("applies cursor + skip:1 when cursor provided", async () => {
    prisma.radarTopic.findMany.mockResolvedValueOnce([]);
    await service.listByUser("u-1", { cursor: "after-id" });
    const arg = prisma.radarTopic.findMany.mock.calls[0]?.[0];
    expect(arg.cursor).toEqual({ id: "after-id" });
    expect(arg.skip).toBe(1);
  });

  it("orders by createdAt desc", async () => {
    prisma.radarTopic.findMany.mockResolvedValueOnce([]);
    await service.listByUser("u-1");
    expect(prisma.radarTopic.findMany.mock.calls[0]?.[0].orderBy).toEqual({
      createdAt: "desc",
    });
  });

  it("returns empty items + null cursor on empty db", async () => {
    prisma.radarTopic.findMany.mockResolvedValueOnce([]);
    const res = await service.listByUser("u-1");
    expect(res.items).toEqual([]);
    expect(res.nextCursor).toBeNull();
  });
});

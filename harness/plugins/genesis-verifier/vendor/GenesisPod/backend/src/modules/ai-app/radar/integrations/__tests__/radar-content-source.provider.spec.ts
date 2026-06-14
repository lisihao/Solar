import { RadarContentSourceProvider } from "../radar-content-source.provider";
import type { PrismaService } from "../../../../../common/prisma/prisma.service";

describe("RadarContentSourceProvider", () => {
  const findMany = jest.fn();
  const count = jest.fn();
  const prisma = {
    radarItem: { findMany, count },
  } as unknown as PrismaService;
  const provider = new RadarContentSourceProvider(prisma);

  const dbItem = (over: Record<string, unknown> = {}) => ({
    id: "item-1",
    title: "HBM4 量产指引下修",
    aiSummary: "SK hynix 财报会披露节奏调整。".repeat(20),
    url: "https://example.com/a",
    author: "analyst",
    publishedAt: new Date("2026-06-01T00:00:00Z"),
    relevanceScore: 88,
    qualityScore: 75,
    content: "正文内容",
    topicId: "topic-1",
    topic: { name: "下一代算力底座" },
    source: { type: "RSS", label: "TrendForce" },
    ...over,
  });

  beforeEach(() => {
    findMany.mockReset();
    count.mockReset();
  });

  it("descriptor 暴露 AI_RADAR 标识", () => {
    expect(provider.id).toBe("AI_RADAR");
    expect(provider.contentKinds).toContain("article");
  });

  describe("listItems", () => {
    it("强制 accepted=true + topic.userId 隔离，preview 截断 200 字", async () => {
      findMany.mockResolvedValue([dbItem()]);
      count.mockResolvedValue(1);
      const res = await provider.listItems("user-1", {});
      const where = findMany.mock.calls[0][0].where;
      expect(where.accepted).toBe(true);
      expect(where.topic).toEqual({ userId: "user-1" });
      expect(res.items[0].preview!.length).toBeLessThanOrEqual(200);
      expect(res.items[0].contentKind).toBe("article");
    });

    it("超过一页时返回 nextCursor", async () => {
      findMany.mockResolvedValue(
        Array.from({ length: 6 }, (_, i) => dbItem({ id: `i-${i}` })),
      );
      count.mockResolvedValue(20);
      const res = await provider.listItems("user-1", { limit: 5 });
      expect(res.items).toHaveLength(5);
      expect(res.nextCursor).toBe("5");
    });
  });

  describe("fetchBundle", () => {
    it("空 id 列表直接返回空，不查库", async () => {
      const res = await provider.fetchBundle([], "user-1");
      expect(res).toEqual([]);
      expect(findMany).not.toHaveBeenCalled();
    });

    it("查询强制 userId 隔离，body 为 markdown 组装", async () => {
      findMany.mockResolvedValue([dbItem()]);
      const res = await provider.fetchBundle(["item-1"], "user-1");
      const where = findMany.mock.calls[0][0].where;
      expect(where.topic).toEqual({ userId: "user-1" });
      expect(where.id).toEqual({ in: ["item-1"] });
      expect(res[0].sourceType).toBe("AI_RADAR");
      expect(res[0].bodyMime).toBe("text/markdown");
      expect(res[0].body).toContain("# HBM4 量产指引下修");
      expect(res[0].body).toContain("雷达话题：下一代算力底座");
      expect(res[0].body).toContain("## 原文内容");
    });
  });
});

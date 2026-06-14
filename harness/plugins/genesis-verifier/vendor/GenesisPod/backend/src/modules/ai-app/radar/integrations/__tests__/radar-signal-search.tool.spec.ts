import { RadarSignalSearchTool } from "../radar-signal-search.tool";
import type { PrismaService } from "../../../../../common/prisma/prisma.service";
import type { ToolContext } from "@/modules/ai-engine/facade";

describe("RadarSignalSearchTool", () => {
  const findMany = jest.fn();
  const prisma = {
    radarItem: { findMany },
  } as unknown as PrismaService;
  const tool = new RadarSignalSearchTool(prisma);

  const ctx = (userId?: string): ToolContext =>
    ({ executionId: "exec-1", toolId: tool.id, userId }) as ToolContext;

  const dbItem = (over: Record<string, unknown> = {}) => ({
    id: "item-1",
    title: "HBM4 量产指引下修",
    aiSummary: "SK hynix 财报会披露 HBM4 量产节奏调整",
    url: "https://example.com/a",
    publishedAt: new Date("2026-06-01T00:00:00Z"),
    relevanceScore: 88,
    topic: { name: "下一代算力底座" },
    source: { type: "RSS", label: "TrendForce" },
    ...over,
  });

  beforeEach(() => findMany.mockReset());

  describe("validateInput", () => {
    it("拒绝空 / 非字符串 / 超长 query", () => {
      expect(tool.validateInput({ query: "" })).toBe(false);
      expect(tool.validateInput({ query: "   " })).toBe(false);
      expect(tool.validateInput({ query: 1 as unknown as string })).toBe(false);
      expect(tool.validateInput({ query: "x".repeat(2001) })).toBe(false);
    });

    it("拒绝越界 days / topK", () => {
      expect(tool.validateInput({ query: "hbm", days: 0 })).toBe(false);
      expect(tool.validateInput({ query: "hbm", days: 91 })).toBe(false);
      expect(tool.validateInput({ query: "hbm", topK: 0 })).toBe(false);
      expect(tool.validateInput({ query: "hbm", topK: 21 })).toBe(false);
    });

    it("接受合法输入", () => {
      expect(
        tool.validateInput({ query: "HBM4 量产", days: 30, topK: 8 }),
      ).toBe(true);
    });
  });

  describe("doExecute", () => {
    it("context 无 userId 时返回空结果 + 回落 note，不查库", async () => {
      const out = await tool["doExecute"]({ query: "hbm" }, ctx(undefined));
      expect(out.success).toBe(true);
      expect(out.results).toEqual([]);
      expect(out.note).toContain("fall back");
      expect(findMany).not.toHaveBeenCalled();
    });

    it("查询条件强制 accepted=true + topic.userId（行级隔离）", async () => {
      findMany.mockResolvedValue([dbItem()]);
      await tool["doExecute"]({ query: "HBM4 量产" }, ctx("user-1"));
      const where = findMany.mock.calls[0][0].where;
      expect(where.accepted).toBe(true);
      expect(where.topic).toEqual({ userId: "user-1" });
      expect(where.publishedAt.gte).toBeInstanceOf(Date);
    });

    it("自然语言 query 拆词做 OR 匹配，过滤单字符词", async () => {
      findMany.mockResolvedValue([]);
      await tool["doExecute"]({ query: "HBM4 量产 延期 a" }, ctx("user-1"));
      const where = findMany.mock.calls[0][0].where;
      const orTerms = (where.OR as Array<Record<string, unknown>>).map((o) =>
        JSON.stringify(o),
      );
      expect(orTerms.some((s) => s.includes("HBM4"))).toBe(true);
      expect(orTerms.some((s) => s.includes("量产"))).toBe(true);
      /* 单字符 "a" 被过滤 */
      expect(orTerms.some((s) => s.includes('"a"'))).toBe(false);
    });

    it("命中时映射输出字段（含 source label 回落 type）", async () => {
      findMany.mockResolvedValue([
        dbItem(),
        dbItem({ id: "item-2", source: { type: "X", label: null } }),
      ]);
      const out = await tool["doExecute"]({ query: "HBM4" }, ctx("user-1"));
      expect(out.success).toBe(true);
      expect(out.totalResults).toBe(2);
      expect(out.results[0]).toMatchObject({
        itemId: "item-1",
        title: "HBM4 量产指引下修",
        topicName: "下一代算力底座",
        sourceLabel: "TrendForce",
        relevanceScore: 88,
      });
      expect(out.results[1].sourceLabel).toBe("X");
    });

    it("零命中时返回 success:true + 回落 note（不发假 error）", async () => {
      findMany.mockResolvedValue([]);
      const out = await tool["doExecute"]({ query: "量子计算" }, ctx("user-1"));
      expect(out.success).toBe(true);
      expect(out.totalResults).toBe(0);
      expect(out.note).toContain("fall back");
    });

    it("prisma 抛错时返回 success:false + error 信息", async () => {
      findMany.mockRejectedValue(new Error("db down"));
      const out = await tool["doExecute"]({ query: "hbm4" }, ctx("user-1"));
      expect(out.success).toBe(false);
      expect(out.error).toBe("db down");
    });
  });
});

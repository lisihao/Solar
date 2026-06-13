/**
 * RuntimeEnvironmentService 单元测试（P1-5）
 *
 * 覆盖：
 *  - 各 registry 缺失时的 degradation（warn log + 空数组）
 *  - 完整注入时 snapshot 正确聚合
 *  - tablesExist 通用 API
 *  - 缓存 + force refresh
 */

import { RuntimeEnvironmentService } from "../runtime/runtime-environment.service";

function mkRegistry<T extends { id: string }>(items: T[]) {
  return {
    getAllIds: () => items.map((i) => i.id),
    getAll: () => items,
  } as any;
}

describe("RuntimeEnvironmentService", () => {
  describe("graceful degradation on missing deps", () => {
    it("all deps missing → empty snapshot with zero crashes", async () => {
      const svc = new RuntimeEnvironmentService();
      const snap = await svc.snapshot({ userId: "u1" });
      expect(snap.agents).toEqual([]);
      expect(snap.tools).toEqual([]);
      expect(snap.skills).toEqual([]);
      expect(snap.models.CHAT).toEqual([]);
    });

    it("only agent registry → agents populated, rest empty", async () => {
      const agentRegistry = mkRegistry([{ id: "agent-1" }, { id: "agent-2" }]);
      const svc = new RuntimeEnvironmentService(
        undefined,
        agentRegistry,
        undefined,
        undefined,
      );
      const snap = await svc.snapshot({ userId: "u1" });
      expect(snap.agents).toEqual(["agent-1", "agent-2"]);
      expect(snap.tools).toEqual([]);
      expect(snap.skills).toEqual([]);
    });

    it("only skill registry → skills populated", async () => {
      const skillRegistry = mkRegistry([{ id: "sk-1" }, { id: "sk-2" }]);
      const svc = new RuntimeEnvironmentService(
        undefined,
        undefined,
        undefined,
        skillRegistry,
      );
      const snap = await svc.snapshot({ userId: "u1" });
      expect(snap.skills).toEqual(["sk-1", "sk-2"]);
    });

    it("tool registry populates tools with three-state healthy", async () => {
      // ★ 三态语义（PR 修：删假绿灯）：
      //   - enabled=false → "unhealthy"（操作员显式禁用）
      //   - enabled=true 但无 ToolCircuitBreaker 注入 → "unknown"（不再造假绿灯）
      const toolRegistry = {
        getAll: () => [
          { id: "t1", name: "Tool 1", category: "search", enabled: true },
          { id: "t2", name: "Tool 2", category: "rag", enabled: false },
        ],
      } as any;
      const svc = new RuntimeEnvironmentService(
        undefined,
        undefined,
        toolRegistry,
        undefined,
      );
      const snap = await svc.snapshot({ userId: "u1" });
      expect(snap.tools).toHaveLength(2);
      expect(snap.tools.find((t) => t.toolId === "t1")?.healthy).toBe(
        "unknown",
      );
      expect(snap.tools.find((t) => t.toolId === "t2")?.healthy).toBe(
        "unhealthy",
      );
    });
  });

  describe("caching", () => {
    it("caches snapshot per userId within TTL", async () => {
      const agentRegistry = { getAllIds: jest.fn(() => ["a"]) } as any;
      const svc = new RuntimeEnvironmentService(
        undefined,
        agentRegistry,
        undefined,
        undefined,
      );
      await svc.snapshot({ userId: "u1" });
      await svc.snapshot({ userId: "u1" });
      // cache hit second time → getAllIds only called once
      expect(agentRegistry.getAllIds).toHaveBeenCalledTimes(1);
    });

    it("force=true bypasses cache", async () => {
      const agentRegistry = { getAllIds: jest.fn(() => ["a"]) } as any;
      const svc = new RuntimeEnvironmentService(
        undefined,
        agentRegistry,
        undefined,
        undefined,
      );
      await svc.snapshot({ userId: "u1" });
      await svc.snapshot({ userId: "u1", force: true });
      expect(agentRegistry.getAllIds).toHaveBeenCalledTimes(2);
    });

    it("invalidate(userId) clears single user cache", async () => {
      const agentRegistry = { getAllIds: jest.fn(() => ["a"]) } as any;
      const svc = new RuntimeEnvironmentService(
        undefined,
        agentRegistry,
        undefined,
        undefined,
      );
      await svc.snapshot({ userId: "u1" });
      await svc.snapshot({ userId: "u2" });
      svc.invalidate("u1");
      await svc.snapshot({ userId: "u1" });
      await svc.snapshot({ userId: "u2" });
      // u1: 2 calls (fresh + invalidated fresh); u2: 1 call (second hit cache)
      expect(agentRegistry.getAllIds).toHaveBeenCalledTimes(3);
    });

    it("invalidate() clears all", async () => {
      const agentRegistry = { getAllIds: jest.fn(() => ["a"]) } as any;
      const svc = new RuntimeEnvironmentService(
        undefined,
        agentRegistry,
        undefined,
        undefined,
      );
      await svc.snapshot({ userId: "u1" });
      await svc.snapshot({ userId: "u2" });
      svc.invalidate();
      await svc.snapshot({ userId: "u1" });
      await svc.snapshot({ userId: "u2" });
      expect(agentRegistry.getAllIds).toHaveBeenCalledTimes(4);
    });
  });

  describe("tablesExist", () => {
    it("returns all false when prisma not injected", async () => {
      const svc = new RuntimeEnvironmentService();
      const res = await svc.tablesExist(["t1", "t2"]);
      expect(res).toEqual({ t1: false, t2: false });
    });

    it("empty names returns empty object without prisma call", async () => {
      const prisma = { $queryRawUnsafe: jest.fn() } as any;
      const svc = new RuntimeEnvironmentService(
        prisma,
        undefined,
        undefined,
        undefined,
      );
      const res = await svc.tablesExist([]);
      expect(res).toEqual({});
      expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    });

    it("queries information_schema and maps present tables", async () => {
      const prisma = {
        $queryRawUnsafe: jest
          .fn()
          .mockResolvedValue([{ table_name: "t1" }, { table_name: "t3" }]),
      } as any;
      const svc = new RuntimeEnvironmentService(
        prisma,
        undefined,
        undefined,
        undefined,
      );
      const res = await svc.tablesExist(["t1", "t2", "t3"]);
      expect(res).toEqual({ t1: true, t2: false, t3: true });
    });

    it("prisma error → all false with warn log", async () => {
      const prisma = {
        $queryRawUnsafe: jest.fn().mockRejectedValue(new Error("db down")),
      } as any;
      const svc = new RuntimeEnvironmentService(
        prisma,
        undefined,
        undefined,
        undefined,
      );
      const res = await svc.tablesExist(["t1"]);
      expect(res).toEqual({ t1: false });
    });
  });
});

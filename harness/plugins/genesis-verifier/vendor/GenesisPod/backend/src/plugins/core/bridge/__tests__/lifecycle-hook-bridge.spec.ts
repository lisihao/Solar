/**
 * LifecycleHookBridge spec (v5.1 R0.5 PR-6)
 */
import { LifecycleHookBridge } from "../lifecycle-hook-bridge";
import { HookBus } from "../../hook-bus";
import { CORE_HOOKS } from "../../abstractions/hooks";

function silentSupervisor() {
  return { onPluginError: () => {}, isCircuitOpen: () => false };
}

describe("LifecycleHookBridge (v5.1 R0.5 PR-6)", () => {
  describe("双轨：HookBus 未注入时 no-op", () => {
    it("fireMissionStart 不抛错", async () => {
      const b = new LifecycleHookBridge();
      await expect(
        b.fireMissionStart({ missionId: "m1", missionContext: {} }),
      ).resolves.toBeUndefined();
    });

    it("fireMemoryWrite / fireMemoryRead 不抛错", async () => {
      const b = new LifecycleHookBridge();
      await expect(
        b.fireMemoryWrite({ key: "k", value: { x: 1 } }),
      ).resolves.toBeUndefined();
      await expect(b.fireMemoryRead({ key: "k" })).resolves.toBeUndefined();
    });
  });

  describe("注入 HookBus 后 fire 对应 hook", () => {
    it("fireMissionStart → MISSION_START plugin 监听到，含 missionId / missionContext", async () => {
      const bus = new HookBus(silentSupervisor());
      const seen = [];
      bus.register(
        CORE_HOOKS.MISSION_START,
        async (ctx) => {
          seen.push(ctx.payload);
          return ctx.next();
        },
        { pluginId: "obs", required: false, capabilities: [] },
      );

      const b = new LifecycleHookBridge();
      b.setHookBus(bus);
      await b.fireMissionStart({
        missionId: "mission-1",
        missionContext: { userId: "u1" },
      });

      expect(seen).toHaveLength(1);
      const first = seen[0];
      expect(first.__version).toBe(1);
      expect(first.missionId).toBe("mission-1");
      expect(first.missionContext).toEqual({ userId: "u1" });
    });

    it("fireMissionEnd → MISSION_END plugin 监听到 status + result", async () => {
      const bus = new HookBus(silentSupervisor());
      let payload: unknown = null;
      bus.register(
        CORE_HOOKS.MISSION_END,
        async (ctx) => {
          payload = ctx.payload;
          return ctx.next();
        },
        { pluginId: "audit", required: false, capabilities: [] },
      );

      const b = new LifecycleHookBridge();
      b.setHookBus(bus);
      await b.fireMissionEnd({
        missionId: "mission-1",
        status: "completed",
        result: { score: 0.9 },
      });

      expect(payload).toMatchObject({
        missionId: "mission-1",
        status: "completed",
        result: { score: 0.9 },
      });
    });

    it("fireMemoryWrite / fireMemoryRead → 各自 hook 触发", async () => {
      const bus = new HookBus(silentSupervisor());
      const writeSeen = [];
      const readSeen = [];

      bus.register(
        CORE_HOOKS.MEMORY_WRITE,
        async (ctx) => {
          writeSeen.push(ctx.payload.key);
          return ctx.next();
        },
        { pluginId: "w", required: false, capabilities: [] },
      );
      bus.register(
        CORE_HOOKS.MEMORY_READ,
        async (ctx) => {
          readSeen.push(ctx.payload.key);
          return ctx.next();
        },
        { pluginId: "r", required: false, capabilities: [] },
      );

      const b = new LifecycleHookBridge();
      b.setHookBus(bus);
      await b.fireMemoryWrite({ key: "k1", value: "v1" });
      await b.fireMemoryRead({ key: "k1" });

      expect(writeSeen).toEqual(["k1"]);
      expect(readSeen).toEqual(["k1"]);
    });
  });

  describe("plugin 异常吞掉不传染调用方", () => {
    it("plugin throw 不影响 fireMissionStart 返回", async () => {
      const bus = new HookBus(silentSupervisor());
      bus.register(
        CORE_HOOKS.MISSION_START,
        async () => {
          throw new Error("plugin internal error");
        },
        { pluginId: "buggy", required: false, capabilities: [] },
      );

      const b = new LifecycleHookBridge();
      b.setHookBus(bus);
      await expect(
        b.fireMissionStart({ missionId: "m1", missionContext: {} }),
      ).resolves.toBeUndefined();
    });
  });

  describe("payload 序列化安全", () => {
    it("fireMissionStart 含 function 字段也能正常 fire（function 被 strip）", async () => {
      const bus = new HookBus(silentSupervisor());
      let observed: unknown = null;
      bus.register(
        CORE_HOOKS.MISSION_START,
        async (ctx) => {
          observed = ctx.payload.missionContext;
          return ctx.next();
        },
        { pluginId: "obs", required: false, capabilities: [] },
      );

      const b = new LifecycleHookBridge();
      b.setHookBus(bus);
      await b.fireMissionStart({
        missionId: "m1",
        missionContext: {
          userId: "u",
          // function 不能被 structuredClone，验证 toJsonSafe 处理
          callback: () => "x",
        },
      });
      expect(observed).toEqual({ userId: "u" }); // function 被 strip
    });
  });
});

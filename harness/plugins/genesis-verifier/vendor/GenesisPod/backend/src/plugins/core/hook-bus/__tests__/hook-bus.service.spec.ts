/**
 * HookBus spec (v5.1 R0.5 PR-2)
 *
 * 覆盖：
 * - onion middleware 顺序（priority 高在外）
 * - zero-cost fast-path（无 handler 时直接 terminal）
 * - abort 短路 + reason 传递
 * - replacePayload capability gate (CRIT-1)
 * - payload immutability (CRIT-1: plugin mutate ctx.payload 触发 TypeError)
 * - payload version 兼容性跳过 (HIGH-3)
 * - supervisor: optional plugin 异常跳过到 next；required 致命
 * - capability 违规直接致命
 * - circuit 熔断的 plugin 跳过
 */
import { HookBus, IPluginSupervisor } from "../hook-bus.service";
import {
  HookAbortError,
  PluginCapabilityError,
} from "../../abstractions/hook-context.interface";

interface FakeSupervisor extends IPluginSupervisor {
  errors: Array<{ pluginId: string; err: unknown }>;
  open: Set<string>;
}

function makeFakeSupervisor(): FakeSupervisor {
  const errors: Array<{ pluginId: string; err: unknown }> = [];
  const open = new Set<string>();
  return {
    errors,
    open,
    onPluginError(pluginId, err) {
      errors.push({ pluginId, err });
    },
    isCircuitOpen(pluginId) {
      return open.has(pluginId);
    },
  };
}

function makeBus(): { bus: HookBus; sup: FakeSupervisor } {
  const sup = makeFakeSupervisor();
  const bus = new HookBus(sup, { warnOnVersionMismatch: false });
  return { bus, sup };
}

describe("HookBus (v5.1 R0.5 PR-2)", () => {
  describe("zero-cost fast-path", () => {
    it("无 handler 时直接调用 terminal，不创建 ctx", async () => {
      const { bus } = makeBus();
      const terminal = jest.fn().mockResolvedValue("terminal-result");
      const result = await bus.fire(
        "engine.llm.request",
        { __version: 1 },
        terminal,
      );
      expect(result).toBe("terminal-result");
      expect(terminal).toHaveBeenCalledTimes(1);
    });
  });

  describe("onion middleware 顺序", () => {
    it("priority 高的 handler 在外层（先执行 next 前的逻辑）", async () => {
      const { bus } = makeBus();
      const order: string[] = [];

      bus.register(
        "engine.llm.request",
        async (ctx) => {
          order.push("low-before");
          await ctx.next();
          order.push("low-after");
          return "low-result";
        },
        { pluginId: "low", required: false, capabilities: [], priority: 0 },
      );

      bus.register(
        "engine.llm.request",
        async (ctx) => {
          order.push("high-before");
          await ctx.next();
          order.push("high-after");
          return "high-result";
        },
        { pluginId: "high", required: false, capabilities: [], priority: 100 },
      );

      const terminal = async () => {
        order.push("terminal");
        return "ok";
      };

      await bus.fire("engine.llm.request", { __version: 1 }, terminal);

      expect(order).toEqual([
        "high-before",
        "low-before",
        "terminal",
        "low-after",
        "high-after",
      ]);
    });
  });

  describe("abort 短路", () => {
    it("abort 抛 HookAbortError，含 reason 和 abortPayload", async () => {
      const { bus } = makeBus();
      bus.register(
        "engine.llm.request",
        async (ctx) => {
          ctx.abort("cache-hit", { cached: "response" });
        },
        { pluginId: "cache", required: false, capabilities: [] },
      );

      const terminal = jest.fn();
      await expect(
        bus.fire("engine.llm.request", { __version: 1 }, terminal),
      ).rejects.toMatchObject({
        name: "HookAbortError",
        reason: "cache-hit",
        pluginId: "cache",
        abortPayload: { cached: "response" },
      });
      expect(terminal).not.toHaveBeenCalled();
    });
  });

  describe("payload immutability (CRIT-1)", () => {
    it("plugin 试图 mutate ctx.payload 触发 TypeError（深 freeze）", async () => {
      const { bus } = makeBus();
      let mutationError: unknown = null;

      bus.register(
        "engine.llm.request",
        async (ctx) => {
          try {
            (ctx.payload as { __version: number }).__version = 999;
          } catch (err) {
            mutationError = err;
          }
          return ctx.next();
        },
        { pluginId: "evil", required: false, capabilities: [] },
      );

      await bus.fire(
        "engine.llm.request",
        { __version: 1, request: { msg: "hello" } },
        async () => "ok",
      );

      expect(mutationError).toBeInstanceOf(TypeError);
    });

    it("nested object 也被 freeze（深 freeze 防绕过）", async () => {
      const { bus } = makeBus();
      let nestedMutationError: unknown = null;

      bus.register(
        "engine.llm.request",
        async (ctx) => {
          try {
            const payload = ctx.payload as { request: { msg: string } };
            payload.request.msg = "hacked";
          } catch (err) {
            nestedMutationError = err;
          }
          return ctx.next();
        },
        { pluginId: "evil", required: false, capabilities: [] },
      );

      await bus.fire(
        "engine.llm.request",
        { __version: 1, request: { msg: "hello" } },
        async () => "ok",
      );

      expect(nestedMutationError).toBeInstanceOf(TypeError);
    });
  });

  describe("replacePayload capability gate (CRIT-1)", () => {
    it("plugin 持有 write:llm-payload 时可以 replacePayload", async () => {
      const { bus } = makeBus();
      let observedAfterReplace: unknown = null;

      bus.register(
        "engine.llm.request",
        async (ctx) => {
          ctx.replacePayload({ __version: 1, request: { msg: "rewritten" } });
          return ctx.next();
        },
        {
          pluginId: "guardrail",
          required: false,
          capabilities: ["write:llm-payload"],
          priority: 100,
        },
      );

      bus.register(
        "engine.llm.request",
        async (ctx) => {
          observedAfterReplace = ctx.payload;
          return ctx.next();
        },
        {
          pluginId: "downstream",
          required: false,
          capabilities: [],
          priority: 0,
        },
      );

      await bus.fire(
        "engine.llm.request",
        { __version: 1, request: { msg: "original" } },
        async () => "ok",
      );

      expect(observedAfterReplace).toMatchObject({
        request: { msg: "rewritten" },
      });
    });

    it("plugin 未声明 write:llm-payload 时 replacePayload 抛 PluginCapabilityError", async () => {
      const { bus } = makeBus();

      bus.register(
        "engine.llm.request",
        async (ctx) => {
          ctx.replacePayload({ __version: 1, request: { msg: "hack" } });
          return ctx.next();
        },
        {
          pluginId: "evil",
          required: false,
          capabilities: [], // 没有 write:llm-payload
        },
      );

      await expect(
        bus.fire(
          "engine.llm.request",
          { __version: 1, request: { msg: "x" } },
          async () => "ok",
        ),
      ).rejects.toBeInstanceOf(PluginCapabilityError);
    });

    it("hook 不属于已知 write 域时（如 engine.unknown.event），replacePayload 也拒绝", async () => {
      const { bus } = makeBus();
      bus.register(
        "engine.unknown.event",
        async (ctx) => {
          ctx.replacePayload({ __version: 1 });
          return ctx.next();
        },
        {
          pluginId: "evil",
          required: false,
          capabilities: [
            "write:llm-payload",
            "write:tool-payload",
            "write:memory",
          ],
        },
      );
      await expect(
        bus.fire("engine.unknown.event", { __version: 1 }, async () => "ok"),
      ).rejects.toBeInstanceOf(PluginCapabilityError);
    });
  });

  describe("payload version 兼容性", () => {
    it("plugin 不支持当前 payload version 时被跳过", async () => {
      const { bus } = makeBus();
      const seenByPlugin: number[] = [];

      bus.register(
        "engine.llm.request",
        async (ctx) => {
          seenByPlugin.push((ctx.payload as { __version: number }).__version);
          return ctx.next();
        },
        {
          pluginId: "v1-only",
          required: false,
          capabilities: [],
          supportedPayloadVersions: [1],
        },
      );

      // v2 payload —— plugin 应被跳过
      await bus.fire("engine.llm.request", { __version: 2 }, async () => "ok");
      expect(seenByPlugin).toEqual([]);

      // v1 payload —— plugin 应被调用
      await bus.fire("engine.llm.request", { __version: 1 }, async () => "ok");
      expect(seenByPlugin).toEqual([1]);
    });
  });

  describe("supervisor: optional vs required", () => {
    it("optional plugin 异常被 supervisor 捕获，跳到 next handler", async () => {
      const { bus, sup } = makeBus();
      const order: string[] = [];

      bus.register(
        "engine.llm.request",
        async () => {
          order.push("evil-throws");
          throw new Error("boom");
        },
        {
          pluginId: "evil",
          required: false,
          capabilities: [],
          priority: 100,
        },
      );

      bus.register(
        "engine.llm.request",
        async (ctx) => {
          order.push("good-runs");
          return ctx.next();
        },
        { pluginId: "good", required: false, capabilities: [], priority: 0 },
      );

      const terminal = async () => {
        order.push("terminal");
        return "ok";
      };

      const result = await bus.fire(
        "engine.llm.request",
        { __version: 1 },
        terminal,
      );
      expect(result).toBe("ok");
      expect(order).toEqual(["evil-throws", "good-runs", "terminal"]);
      expect(sup.errors).toHaveLength(1);
      expect(sup.errors[0].pluginId).toBe("evil");
    });

    it("required plugin 异常致命传播", async () => {
      const { bus, sup } = makeBus();

      bus.register(
        "engine.llm.request",
        async () => {
          throw new Error("critical");
        },
        { pluginId: "critical-plugin", required: true, capabilities: [] },
      );

      await expect(
        bus.fire("engine.llm.request", { __version: 1 }, async () => "ok"),
      ).rejects.toThrow("critical");
      expect(sup.errors).toHaveLength(1);
    });
  });

  describe("capability 违规直接致命", () => {
    it("PluginCapabilityError 始终传播，不被 optional 静默吞掉", async () => {
      const { bus } = makeBus();
      bus.register(
        "engine.llm.request",
        async (ctx) => {
          ctx.replacePayload({ __version: 1 });
          return ctx.next();
        },
        { pluginId: "evil", required: false, capabilities: [] },
      );

      await expect(
        bus.fire("engine.llm.request", { __version: 1 }, async () => "ok"),
      ).rejects.toBeInstanceOf(PluginCapabilityError);
    });
  });

  describe("circuit-open plugin 跳过", () => {
    it("supervisor 报告 circuit open 的 plugin 不进入 chain", async () => {
      const { bus, sup } = makeBus();
      const order: string[] = [];

      bus.register(
        "engine.llm.request",
        async (ctx) => {
          order.push("open-plugin");
          return ctx.next();
        },
        {
          pluginId: "circuit-open",
          required: false,
          capabilities: [],
          priority: 100,
        },
      );
      bus.register(
        "engine.llm.request",
        async (ctx) => {
          order.push("normal-plugin");
          return ctx.next();
        },
        { pluginId: "normal", required: false, capabilities: [], priority: 0 },
      );

      sup.open.add("circuit-open");

      await bus.fire("engine.llm.request", { __version: 1 }, async () => "ok");
      expect(order).toEqual(["normal-plugin"]);
    });
  });

  describe("unregisterPlugin", () => {
    it("解除 plugin 在所有 hook 上的注册", () => {
      const { bus } = makeBus();
      const noop = async () => undefined;
      bus.register("engine.llm.request", noop, {
        pluginId: "p1",
        required: false,
        capabilities: [],
      });
      bus.register("engine.tool.before", noop, {
        pluginId: "p1",
        required: false,
        capabilities: [],
      });
      bus.register("engine.llm.request", noop, {
        pluginId: "p2",
        required: false,
        capabilities: [],
      });

      bus.unregisterPlugin("p1");
      const desc = bus.describe();
      expect(desc["engine.llm.request"]).toEqual([
        { pluginId: "p2", priority: 0 },
      ]);
      expect(desc["engine.tool.before"]).toBeUndefined();
    });
  });

  describe("HookAbortError 透传", () => {
    it("即使 plugin required=false，HookAbortError 也直接抛（不被 supervisor 误吞）", async () => {
      const { bus, sup } = makeBus();
      bus.register(
        "engine.llm.request",
        async (ctx) => {
          ctx.abort("rate-limited");
        },
        { pluginId: "rl", required: false, capabilities: [] },
      );

      await expect(
        bus.fire("engine.llm.request", { __version: 1 }, async () => "ok"),
      ).rejects.toBeInstanceOf(HookAbortError);
      // abort 不算 plugin 错误，supervisor 不应记录
      expect(sup.errors).toHaveLength(0);
    });
  });
});

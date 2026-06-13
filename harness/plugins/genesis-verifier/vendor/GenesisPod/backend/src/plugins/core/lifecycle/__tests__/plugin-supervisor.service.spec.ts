/**
 * PluginSupervisor spec (v5.1 R0.5 PR-3)
 */
import {
  PluginSupervisor,
  type ISupervisedPlugin,
} from "../plugin-supervisor.service";

function silent() {
  return {
    warn: () => {},
    error: () => {},
  };
}

function makePlugin(
  id: string,
  health?: () => Promise<{
    status: "healthy" | "degraded" | "unhealthy";
    message?: string;
  }>,
): ISupervisedPlugin {
  const p: ISupervisedPlugin = { id };
  if (health) {
    Object.assign(p, { healthCheck: health });
  }
  return p;
}

describe("PluginSupervisor (v5.1 R0.5 PR-3)", () => {
  describe("circuit breaker", () => {
    it("初始 closed，错误次数未达阈值时不熔断", () => {
      const sup = new PluginSupervisor(
        { failureThreshold: 3, cooldownMs: 100 },
        { logger: silent() },
      );
      sup.register(makePlugin("p1"));
      sup.onPluginError("p1", new Error("e1"));
      sup.onPluginError("p1", new Error("e2"));
      expect(sup.isCircuitOpen("p1")).toBe(false);
      expect(sup.describe()["p1"]).toEqual({ state: "closed", errorCount: 2 });
    });

    it("达到阈值后熔断，HookBus 视角 isCircuitOpen=true", () => {
      const opened: string[] = [];
      const sup = new PluginSupervisor(
        { failureThreshold: 3, cooldownMs: 100 },
        {
          logger: silent(),
          onCircuitOpen: (id) => opened.push(id),
        },
      );
      sup.register(makePlugin("p1"));
      sup.onPluginError("p1", new Error("e1"));
      sup.onPluginError("p1", new Error("e2"));
      sup.onPluginError("p1", new Error("e3"));
      expect(sup.isCircuitOpen("p1")).toBe(true);
      expect(opened).toEqual(["p1"]);
    });

    it("cooldown 后切到 half-open，错误重置", async () => {
      const sup = new PluginSupervisor(
        { failureThreshold: 2, cooldownMs: 30 },
        { logger: silent() },
      );
      sup.register(makePlugin("p1"));
      sup.onPluginError("p1", new Error("e1"));
      sup.onPluginError("p1", new Error("e2"));
      expect(sup.describe()["p1"]).toEqual({ state: "open", errorCount: 2 });

      await new Promise((r) => setTimeout(r, 60));
      expect(sup.describe()["p1"]).toEqual({
        state: "half-open",
        errorCount: 0,
      });
    });

    it("half-open 期再出错立刻重新熔断", async () => {
      const sup = new PluginSupervisor(
        { failureThreshold: 2, cooldownMs: 30 },
        { logger: silent() },
      );
      sup.register(makePlugin("p1"));
      sup.onPluginError("p1", new Error("e1"));
      sup.onPluginError("p1", new Error("e2"));
      await new Promise((r) => setTimeout(r, 60));
      expect(sup.describe()["p1"].state).toBe("half-open");

      sup.onPluginError("p1", new Error("probe-fail"));
      expect(sup.isCircuitOpen("p1")).toBe(true);
    });

    it("isCircuitOpen 对未注册 plugin 返回 false", () => {
      const sup = new PluginSupervisor({}, { logger: silent() });
      expect(sup.isCircuitOpen("nonexistent")).toBe(false);
    });
  });

  describe("健康检查", () => {
    it("unhealthy 计入错误计数", async () => {
      const sup = new PluginSupervisor(
        { failureThreshold: 2, cooldownMs: 100 },
        { logger: silent() },
      );
      sup.register(
        makePlugin("p1", async () => ({
          status: "unhealthy",
          message: "broken",
        })),
      );

      await sup.runHealthCheck();
      expect(sup.describe()["p1"].errorCount).toBe(1);
      await sup.runHealthCheck();
      expect(sup.isCircuitOpen("p1")).toBe(true);
    });

    it("healthCheck 抛错也计为错误", async () => {
      const sup = new PluginSupervisor(
        { failureThreshold: 1, cooldownMs: 100 },
        { logger: silent() },
      );
      sup.register(
        makePlugin("p1", async () => {
          throw new Error("hc fail");
        }),
      );
      await sup.runHealthCheck();
      expect(sup.isCircuitOpen("p1")).toBe(true);
    });

    it("healthy / 无 healthCheck 不影响错误计数", async () => {
      const sup = new PluginSupervisor(
        { failureThreshold: 1, cooldownMs: 100 },
        { logger: silent() },
      );
      sup.register(makePlugin("p1", async () => ({ status: "healthy" })));
      sup.register(makePlugin("p2"));
      await sup.runHealthCheck();
      expect(sup.isCircuitOpen("p1")).toBe(false);
      expect(sup.isCircuitOpen("p2")).toBe(false);
    });

    it("已熔断 plugin 跳过 healthCheck（不会再额外计数）", async () => {
      let calls = 0;
      const sup = new PluginSupervisor(
        { failureThreshold: 1, cooldownMs: 100 },
        { logger: silent() },
      );
      sup.register(
        makePlugin("p1", async () => {
          calls++;
          return { status: "unhealthy" };
        }),
      );

      await sup.runHealthCheck(); // calls=1，触发熔断
      expect(sup.isCircuitOpen("p1")).toBe(true);
      await sup.runHealthCheck(); // 跳过
      expect(calls).toBe(1);
    });
  });

  describe("unregister", () => {
    it("反注册后状态被清空", () => {
      const sup = new PluginSupervisor({}, { logger: silent() });
      sup.register(makePlugin("p1"));
      sup.onPluginError("p1", new Error("e"));
      sup.unregister("p1");
      expect(sup.describe()["p1"]).toBeUndefined();
    });
  });
});

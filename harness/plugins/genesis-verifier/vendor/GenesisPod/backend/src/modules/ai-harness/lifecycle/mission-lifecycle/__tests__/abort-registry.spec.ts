import { MissionAbortRegistry, MissionAbortReason } from "../abort-registry";

describe("MissionAbortRegistry", () => {
  let registry: MissionAbortRegistry;

  beforeEach(() => {
    registry = new MissionAbortRegistry();
  });

  it("register: returns an AbortController", () => {
    const ctrl = registry.register("m1");
    expect(ctrl).toBeInstanceOf(AbortController);
  });

  it("register: creates independent controllers for different missions", () => {
    const c1 = registry.register("m1");
    const c2 = registry.register("m2");
    expect(c1).not.toBe(c2);
  });

  it("getSignal: returns signal for registered mission", () => {
    registry.register("m1");
    const signal = registry.getSignal("m1");
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("getSignal: returns undefined for unregistered mission", () => {
    expect(registry.getSignal("nonexistent")).toBeUndefined();
  });

  it("abort: returns true and aborts signal for registered mission", () => {
    registry.register("m1");
    const result = registry.abort("m1");
    expect(result).toBe(true);
    expect(registry.getSignal("m1")!.aborted).toBe(true);
  });

  it("abort: returns false for unregistered mission", () => {
    const result = registry.abort("nonexistent");
    expect(result).toBe(false);
  });

  it("abort: custom reason is passed to abort", () => {
    registry.register("m1");
    registry.abort("m1", "test_reason");
    expect(registry.isAborted("m1")).toBe(true);
  });

  it("isAborted: returns false before abort", () => {
    registry.register("m1");
    expect(registry.isAborted("m1")).toBe(false);
  });

  it("isAborted: returns true after abort", () => {
    registry.register("m1");
    registry.abort("m1");
    expect(registry.isAborted("m1")).toBe(true);
  });

  it("isAborted: returns false for nonexistent mission", () => {
    expect(registry.isAborted("ghost")).toBe(false);
  });

  it("unregister: removes mission from registry", () => {
    registry.register("m1");
    registry.unregister("m1");
    expect(registry.getSignal("m1")).toBeUndefined();
    expect(registry.size()).toBe(0);
  });

  it("size: returns current count", () => {
    expect(registry.size()).toBe(0);
    registry.register("m1");
    registry.register("m2");
    expect(registry.size()).toBe(2);
  });

  it("listActive: returns all active mission ids", () => {
    registry.register("m1");
    registry.register("m2");
    const active = registry.listActive();
    expect(active).toContain("m1");
    expect(active).toContain("m2");
    expect(active).toHaveLength(2);
  });

  it("listActive: does not include unregistered missions", () => {
    registry.register("m1");
    registry.unregister("m1");
    expect(registry.listActive()).not.toContain("m1");
  });

  it("aborted signal propagates correctly", () => {
    const ctrl = registry.register("m1");
    const signal = ctrl.signal;
    expect(signal.aborted).toBe(false);
    registry.abort("m1");
    expect(signal.aborted).toBe(true);
  });

  // ── E17 graceful shutdown (2026-05-25) ──
  describe("onApplicationShutdown", () => {
    it("aborts all in-flight missions with orchestrator_shutdown", async () => {
      const c1 = registry.register("m1");
      const c2 = registry.register("m2");
      // 模拟 pipeline finally：abort 后立即 unregister，让 drain 循环退出
      c1.signal.addEventListener("abort", () => registry.unregister("m1"));
      c2.signal.addEventListener("abort", () => registry.unregister("m2"));

      await registry.onApplicationShutdown("SIGTERM");

      expect(c1.signal.aborted).toBe(true);
      expect(c2.signal.aborted).toBe(true);
      expect(c1.signal.reason).toBe(MissionAbortReason.orchestrator_shutdown);
      expect(registry.size()).toBe(0);
    });

    it("no active missions → fast no-op (skips drain window)", async () => {
      const start = Date.now();
      await registry.onApplicationShutdown("SIGTERM");
      expect(Date.now() - start).toBeLessThan(100);
    });

    it("bounded drain — returns within ~3s even if missions never finalize", async () => {
      registry.register("stuck"); // 永不 unregister
      const start = Date.now();
      await registry.onApplicationShutdown("SIGTERM");
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(2900);
      expect(elapsed).toBeLessThan(4000);
      expect(registry.isAborted("stuck")).toBe(true);
    });
  });
});

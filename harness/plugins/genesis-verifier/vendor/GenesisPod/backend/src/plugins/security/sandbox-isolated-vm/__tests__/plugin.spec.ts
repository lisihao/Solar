/**
 * sandbox-isolated-vm plugin spec (v5.1 R0.5 PR-10)
 */
import {
  SandboxIsolatedVmPlugin,
  InMemorySandboxRunner,
  SANDBOX_ISOLATED_VM_MANIFEST,
} from "../index";
import { HookBus } from "@/plugins/core/hook-bus";
import { CORE_HOOKS, HookAbortError } from "@/plugins/core/abstractions";
import { PluginResolver } from "@/plugins/core/registry";
import type {
  IPluginContext,
  IPluginLogger,
  IPluginConfigView,
  IHookRegistrar,
  IMetricsEmitter,
  IPluginEventBus,
  IPluginManifest,
} from "@/plugins/core/abstractions";

function silentSupervisor() {
  return { onPluginError: () => {}, isCircuitOpen: () => false };
}

function makeFakeContext(bus: HookBus, capabilities: string[]): IPluginContext {
  const logger: IPluginLogger = {
    log: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };
  const config: IPluginConfigView = { value: {}, profile: "test" };
  const metrics: IMetricsEmitter = {
    counter: () => {},
    gauge: () => {},
    histogram: () => {},
  };
  const events: IPluginEventBus = {
    publish: () => {},
    subscribe: () => () => {},
  };
  const hooks: IHookRegistrar = {
    register: (hookId, handler, options) => {
      bus.register(hookId, handler, {
        pluginId: "security/sandbox-isolated-vm",
        required: false,
        capabilities,
        priority: options?.priority,
      });
    },
  };
  return {
    manifest: {
      id: "security/sandbox-isolated-vm",
      version: "1.0.0",
      coreVersionRange: "^1.0.0",
      description: "test",
      category: "security",
      stability: "stable",
      hooks: [],
      capabilities: [],
      phase: "bootstrap",
      required: false,
    },
    logger,
    config,
    hooks,
    metrics,
    events,
    getService: () => {
      throw new Error("not stubbed");
    },
  };
}

describe("SandboxIsolatedVmPlugin (v5.1 R0.5 PR-10)", () => {
  it("manifest 含 read:tool-payload + replaces=sandbox + overridable=false + tags=security-class", () => {
    const p = new SandboxIsolatedVmPlugin();
    expect(p.manifest.id).toBe("security/sandbox-isolated-vm");
    expect(p.manifest.replaces).toBe("sandbox");
    expect(p.manifest.capabilities).toContain("read:tool-payload");
    expect(p.manifest.overridable).toBe(false);
    expect(p.manifest.tags).toContain("security-class");
    // 不申请外部服务（沙箱是纯计算容器）
    expect(p.manifest.capabilities).not.toContain("service:redis");
    expect(p.manifest.capabilities).not.toContain("service:http");
  });

  it("正常 terminal 在沙箱内执行成功", async () => {
    const plugin = new SandboxIsolatedVmPlugin(new InMemorySandboxRunner());
    const bus = new HookBus(silentSupervisor());
    const ctx = makeFakeContext(bus, plugin.manifest.capabilities);
    await plugin.init(ctx, { timeoutMs: 5000 });

    const r = await bus.fire(
      CORE_HOOKS.TOOL_WRAP,
      {
        __version: 1,
        call: { toolId: "calc", input: {}, contextMeta: {} },
        signal: new AbortController().signal,
        meta: { missionId: "m1", timestamp: 0 },
      },
      async () => "tool-result",
    );
    expect(r).toBe("tool-result");
  });

  it("terminal 超时 → abort('timeout', { toolId, timeoutMs })", async () => {
    const plugin = new SandboxIsolatedVmPlugin(new InMemorySandboxRunner());
    const bus = new HookBus(silentSupervisor());
    const ctx = makeFakeContext(bus, plugin.manifest.capabilities);
    await plugin.init(ctx, { timeoutMs: 30 });

    let captured = null;
    try {
      await bus.fire(
        CORE_HOOKS.TOOL_WRAP,
        {
          __version: 1,
          call: { toolId: "slow-tool", input: {}, contextMeta: {} },
          signal: new AbortController().signal,
          meta: { missionId: "m1", timestamp: 0 },
        },
        // terminal 故意慢于 timeout
        async () =>
          new Promise((resolve) => setTimeout(() => resolve("late"), 200)),
      );
    } catch (err) {
      if (err instanceof HookAbortError) captured = err;
    }
    expect(captured?.reason).toBe("timeout");
    expect(captured?.abortPayload).toMatchObject({
      toolId: "slow-tool",
      timeoutMs: 30,
    });
  });

  it("terminal 抛错 → abort('sandbox-error', { toolId, message })", async () => {
    const plugin = new SandboxIsolatedVmPlugin(new InMemorySandboxRunner());
    const bus = new HookBus(silentSupervisor());
    const ctx = makeFakeContext(bus, plugin.manifest.capabilities);
    await plugin.init(ctx, { timeoutMs: 5000 });

    let captured = null;
    try {
      await bus.fire(
        CORE_HOOKS.TOOL_WRAP,
        {
          __version: 1,
          call: { toolId: "buggy", input: {}, contextMeta: {} },
          signal: new AbortController().signal,
          meta: { missionId: "m1", timestamp: 0 },
        },
        async () => {
          throw new Error("tool internal error");
        },
      );
    } catch (err) {
      if (err instanceof HookAbortError) captured = err;
    }
    expect(captured?.reason).toBe("sandbox-error");
    expect(captured?.abortPayload).toMatchObject({
      toolId: "buggy",
      message: "tool internal error",
    });
  });

  it("bypassToolIds 列出的 toolId 跳过沙箱", async () => {
    const runner = new InMemorySandboxRunner();
    const runSpy = jest.spyOn(runner, "run");
    const plugin = new SandboxIsolatedVmPlugin(runner);
    const bus = new HookBus(silentSupervisor());
    const ctx = makeFakeContext(bus, plugin.manifest.capabilities);
    await plugin.init(ctx, {
      timeoutMs: 5000,
      bypassToolIds: ["trusted-tool"],
    });

    const r = await bus.fire(
      CORE_HOOKS.TOOL_WRAP,
      {
        __version: 1,
        call: { toolId: "trusted-tool", input: {}, contextMeta: {} },
        signal: new AbortController().signal,
        meta: { missionId: "m1", timestamp: 0 },
      },
      async () => "trusted-result",
    );
    expect(r).toBe("trusted-result");
    // bypass：runner.run 未被调用
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("replaces='sandbox' + 第二个同 replaces plugin → PluginResolver 抛冲突", () => {
    const a = SANDBOX_ISOLATED_VM_MANIFEST;
    const b: IPluginManifest = {
      ...SANDBOX_ISOLATED_VM_MANIFEST,
      id: "security/sandbox-vm2",
      replaces: "sandbox",
    };
    const r = new PluginResolver();
    expect(() => r.resolve([a, b])).toThrow(
      /multiple plugins replace "sandbox"/,
    );
  });

  it("healthCheck 返回 healthy", async () => {
    const p = new SandboxIsolatedVmPlugin();
    const h = await p.healthCheck();
    expect(h.status).toBe("healthy");
  });
});

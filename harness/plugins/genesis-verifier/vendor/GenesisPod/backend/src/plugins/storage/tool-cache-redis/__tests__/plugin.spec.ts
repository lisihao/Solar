/**
 * tool-cache-redis plugin spec (v5.1 R0.5 PR-8)
 */
import { ToolCacheRedisPlugin, InMemoryRedisClient } from "../index";
import { HookBus } from "@/plugins/core/hook-bus";
import { CORE_HOOKS, HookAbortError } from "@/plugins/core/abstractions";
import type {
  IPluginContext,
  IPluginLogger,
  IPluginConfigView,
  IHookRegistrar,
  IMetricsEmitter,
  IPluginEventBus,
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
        pluginId: "storage/tool-cache-redis",
        required: false,
        capabilities,
        priority: options?.priority,
      });
    },
  };
  return {
    manifest: {
      id: "storage/tool-cache-redis",
      version: "1.0.0",
      coreVersionRange: "^1.0.0",
      description: "test",
      category: "storage",
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

describe("ToolCacheRedisPlugin (v5.1 R0.5 PR-8)", () => {
  it("manifest 含 service:redis + read:tool-payload + replaces=tool-cache", () => {
    const p = new ToolCacheRedisPlugin();
    expect(p.manifest.id).toBe("storage/tool-cache-redis");
    expect(p.manifest.replaces).toBe("tool-cache");
    expect(p.manifest.capabilities).toContain("service:redis");
    expect(p.manifest.capabilities).toContain("read:tool-payload");
    // 不应申请 write:tool-payload（cache plugin 永不修改 payload）
    expect(p.manifest.capabilities).not.toContain("write:tool-payload");
  });

  it("cache miss → next() 透传，写 cache", async () => {
    const redis = new InMemoryRedisClient();
    const plugin = new ToolCacheRedisPlugin(redis);
    const bus = new HookBus(silentSupervisor());
    const ctx = makeFakeContext(bus, plugin.manifest.capabilities);
    await plugin.init(ctx, { ttl: 60 });

    const beforePayload = {
      __version: 1,
      call: {
        toolId: "web-search",
        input: { q: "hello" },
        contextMeta: { executionId: "e1" },
      },
      meta: { missionId: "m1", timestamp: 1000 },
    };

    let terminalRan = false;
    await bus.fire(CORE_HOOKS.TOOL_BEFORE, beforePayload, async () => {
      terminalRan = true;
      return undefined;
    });
    expect(terminalRan).toBe(true);

    // TOOL_AFTER 写缓存
    await bus.fire(
      CORE_HOOKS.TOOL_AFTER,
      {
        __version: 1,
        call: beforePayload.call,
        result: { success: true, data: "results" },
        cacheHit: false,
        meta: { missionId: "m1", timestamp: 1000 },
      },
      async () => undefined,
    );
    expect(redis.keys()).toHaveLength(1);
  });

  it("cache hit → abort('cache-hit', cached)", async () => {
    const redis = new InMemoryRedisClient();
    const plugin = new ToolCacheRedisPlugin(redis);
    const bus = new HookBus(silentSupervisor());
    const ctx = makeFakeContext(bus, plugin.manifest.capabilities);
    await plugin.init(ctx, { ttl: 60 });

    const beforePayload = {
      __version: 1,
      call: {
        toolId: "web-search",
        input: { q: "x" },
        contextMeta: { executionId: "e1" },
      },
      meta: { missionId: "m1", timestamp: 1000 },
    };
    // 预填 cache
    await bus.fire(
      CORE_HOOKS.TOOL_AFTER,
      {
        __version: 1,
        call: beforePayload.call,
        result: { success: true, data: "cached-results" },
        cacheHit: false,
        meta: { missionId: "m1", timestamp: 1000 },
      },
      async () => undefined,
    );

    // 第二次请求应被 cache 命中 abort
    let terminalRan = false;
    await expect(
      bus.fire(CORE_HOOKS.TOOL_BEFORE, beforePayload, async () => {
        terminalRan = true;
        return undefined;
      }),
    ).rejects.toMatchObject({
      name: "HookAbortError",
      reason: "cache-hit",
    });
    expect(terminalRan).toBe(false);
  });

  it("abortPayload 包含正确的 cached result", async () => {
    const redis = new InMemoryRedisClient();
    const plugin = new ToolCacheRedisPlugin(redis);
    const bus = new HookBus(silentSupervisor());
    const ctx = makeFakeContext(bus, plugin.manifest.capabilities);
    await plugin.init(ctx, { ttl: 60 });

    const call = {
      toolId: "t",
      input: { q: "y" },
      contextMeta: { executionId: "e1" },
    };
    const meta = { missionId: "m1", timestamp: 1000 };
    const cachedResult = { success: true, data: "v" };

    // 预填
    await bus.fire(
      CORE_HOOKS.TOOL_AFTER,
      { __version: 1, call, result: cachedResult, cacheHit: false, meta },
      async () => undefined,
    );

    let captured = null;
    try {
      await bus.fire(
        CORE_HOOKS.TOOL_BEFORE,
        { __version: 1, call, meta },
        async () => undefined,
      );
    } catch (err) {
      if (err instanceof HookAbortError) {
        captured = err.abortPayload;
      }
    }
    expect(captured).toEqual(cachedResult);
  });

  it("失败 result 不写缓存（result.success=false）", async () => {
    const redis = new InMemoryRedisClient();
    const plugin = new ToolCacheRedisPlugin(redis);
    const bus = new HookBus(silentSupervisor());
    const ctx = makeFakeContext(bus, plugin.manifest.capabilities);
    await plugin.init(ctx, {});

    await bus.fire(
      CORE_HOOKS.TOOL_AFTER,
      {
        __version: 1,
        call: { toolId: "t", input: {}, contextMeta: {} },
        result: { success: false, error: { code: "X" } },
        cacheHit: false,
        meta: { missionId: "m1", timestamp: 1000 },
      },
      async () => undefined,
    );
    expect(redis.keys()).toHaveLength(0);
  });

  it("abortReason !== cache-hit 时不写缓存（rate-limited / timeout）", async () => {
    const redis = new InMemoryRedisClient();
    const plugin = new ToolCacheRedisPlugin(redis);
    const bus = new HookBus(silentSupervisor());
    const ctx = makeFakeContext(bus, plugin.manifest.capabilities);
    await plugin.init(ctx, {});

    await bus.fire(
      CORE_HOOKS.TOOL_AFTER,
      {
        __version: 1,
        call: { toolId: "t", input: {}, contextMeta: {} },
        result: { success: true, data: "x" },
        abortReason: "rate-limited",
        meta: { missionId: "m1", timestamp: 1000 },
      },
      async () => undefined,
    );
    expect(redis.keys()).toHaveLength(0);
  });

  it("enabledToolIds 白名单：未在白名单的 toolId 不缓存", async () => {
    const redis = new InMemoryRedisClient();
    const plugin = new ToolCacheRedisPlugin(redis);
    const bus = new HookBus(silentSupervisor());
    const ctx = makeFakeContext(bus, plugin.manifest.capabilities);
    await plugin.init(ctx, { enabledToolIds: ["allowed-tool"] });

    await bus.fire(
      CORE_HOOKS.TOOL_AFTER,
      {
        __version: 1,
        call: { toolId: "other-tool", input: {}, contextMeta: {} },
        result: { success: true },
        cacheHit: false,
        meta: { missionId: "m1", timestamp: 1000 },
      },
      async () => undefined,
    );
    expect(redis.keys()).toHaveLength(0);

    await bus.fire(
      CORE_HOOKS.TOOL_AFTER,
      {
        __version: 1,
        call: { toolId: "allowed-tool", input: {}, contextMeta: {} },
        result: { success: true },
        cacheHit: false,
        meta: { missionId: "m1", timestamp: 1000 },
      },
      async () => undefined,
    );
    expect(redis.keys()).toHaveLength(1);
  });

  it("cache key 含 missionId + toolId + input hash（业务无关 namespace）", async () => {
    const redis = new InMemoryRedisClient();
    const plugin = new ToolCacheRedisPlugin(redis);
    const bus = new HookBus(silentSupervisor());
    const ctx = makeFakeContext(bus, plugin.manifest.capabilities);
    await plugin.init(ctx, { keyPrefix: "tc" });

    await bus.fire(
      CORE_HOOKS.TOOL_AFTER,
      {
        __version: 1,
        call: { toolId: "search", input: { q: "a" }, contextMeta: {} },
        result: { success: true },
        cacheHit: false,
        meta: { missionId: "m1", timestamp: 0 },
      },
      async () => undefined,
    );
    const keys = redis.keys();
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^tc:m1:search:[a-f0-9]{16}$/);
  });

  it("redis outage 时 fail-open（不抛错，透传 next）", async () => {
    // 制造一个会抛错的 redis client
    const brokenRedis = {
      get: async () => {
        throw new Error("redis down");
      },
      set: async () => {
        throw new Error("redis down");
      },
      del: async () => {
        throw new Error("redis down");
      },
    };
    const plugin = new ToolCacheRedisPlugin(brokenRedis);
    const bus = new HookBus(silentSupervisor());
    const ctx = makeFakeContext(bus, plugin.manifest.capabilities);
    await plugin.init(ctx, {});

    let terminalRan = false;
    await bus.fire(
      CORE_HOOKS.TOOL_BEFORE,
      {
        __version: 1,
        call: { toolId: "t", input: {}, contextMeta: {} },
        meta: { missionId: "m1", timestamp: 0 },
      },
      async () => {
        terminalRan = true;
        return undefined;
      },
    );
    expect(terminalRan).toBe(true); // fail-open
  });

  it("healthCheck 探测 redis 可用性", async () => {
    const plugin = new ToolCacheRedisPlugin(new InMemoryRedisClient());
    const h = await plugin.healthCheck();
    expect(h.status).toBe("healthy");

    const broken = {
      get: async () => {
        throw new Error("down");
      },
      set: async () => {
        throw new Error("down");
      },
      del: async () => {},
    };
    const plugin2 = new ToolCacheRedisPlugin(broken);
    const h2 = await plugin2.healthCheck();
    expect(h2.status).toBe("unhealthy");
  });
});

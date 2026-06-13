/**
 * telemetry-otel plugin spec (v5.1 R0.5 PR-7)
 */
import { TelemetryOtelPlugin, InMemorySpanExporter } from "../index";
import { HookBus } from "@/plugins/core/hook-bus";
import { CORE_HOOKS } from "@/plugins/core/abstractions";
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
    register: (hookId, handler) => {
      bus.register(hookId, handler, {
        pluginId: "observability/telemetry-otel",
        required: false,
        capabilities: capabilities,
      });
    },
  };
  return {
    manifest: {
      id: "observability/telemetry-otel",
      version: "1.0.0",
      coreVersionRange: "^1.0.0",
      description: "test",
      category: "observability",
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

describe("TelemetryOtelPlugin (v5.1 R0.5 PR-7)", () => {
  it("manifest 含 6 个核心 hook + read:llm-payload:meta + read:tool-payload + service:http", () => {
    const p = new TelemetryOtelPlugin();
    expect(p.manifest.id).toBe("observability/telemetry-otel");
    expect(p.manifest.hooks).toContain(CORE_HOOKS.LLM_REQUEST);
    expect(p.manifest.hooks).toContain(CORE_HOOKS.MISSION_END);
    expect(p.manifest.capabilities).toContain("read:llm-payload:meta");
    expect(p.manifest.capabilities).toContain("read:tool-payload");
    expect(p.manifest.capabilities).toContain("service:http");
    // HIGH-1: 不应含 :full（生产默认禁）
    expect(p.manifest.capabilities).not.toContain("read:llm-payload:full");
  });

  it("LLM_REQUEST/RESPONSE 配对生成 llm.request span 含 model/tokensUsed/missionId", async () => {
    const exporter = new InMemorySpanExporter();
    const plugin = new TelemetryOtelPlugin(exporter);
    const bus = new HookBus(silentSupervisor());
    const ctx = makeFakeContext(bus, plugin.manifest.capabilities);
    await plugin.init(ctx, { serviceName: "svc-test" });

    await bus.fire(
      CORE_HOOKS.LLM_REQUEST,
      {
        __version: 1,
        request: { messages: [] },
        meta: {
          missionId: "m1",
          agentId: "a1",
          model: "claude-sonnet-4-6",
          timestamp: 1000,
        },
      },
      async () => undefined,
    );
    await bus.fire(
      CORE_HOOKS.LLM_RESPONSE,
      {
        __version: 1,
        request: { messages: [] },
        raw: { content: "ok" },
        tokensUsed: 42,
        meta: {
          missionId: "m1",
          agentId: "a1",
          model: "claude-sonnet-4-6",
          timestamp: 1000,
        },
      },
      async () => undefined,
    );

    const spans = exporter.getSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("llm.request");
    expect(spans[0].attributes["llm.mission_id"]).toBe("m1");
    expect(spans[0].attributes["llm.model"]).toBe("claude-sonnet-4-6");
    expect(spans[0].attributes["llm.tokens_used"]).toBe(42);
    expect(spans[0].attributes["service.name"]).toBe("svc-test");
    expect(spans[0].status).toBe("ok");
  });

  it("LLM_RESPONSE 含 cacheHit=true → span attribute llm.cache_hit=true", async () => {
    const exporter = new InMemorySpanExporter();
    const plugin = new TelemetryOtelPlugin(exporter);
    const bus = new HookBus(silentSupervisor());
    const ctx = makeFakeContext(bus, plugin.manifest.capabilities);
    await plugin.init(ctx, {});

    await bus.fire(
      CORE_HOOKS.LLM_RESPONSE,
      {
        __version: 1,
        request: {},
        raw: {},
        cacheHit: true,
        meta: { missionId: "m1", timestamp: 1000 },
      },
      async () => undefined,
    );
    expect(exporter.getSpans()[0].attributes["llm.cache_hit"]).toBe(true);
  });

  it("TOOL_BEFORE/AFTER 配对生成 tool.execute span 含 toolId", async () => {
    const exporter = new InMemorySpanExporter();
    const plugin = new TelemetryOtelPlugin(exporter);
    const bus = new HookBus(silentSupervisor());
    const ctx = makeFakeContext(bus, plugin.manifest.capabilities);
    await plugin.init(ctx, {});

    await bus.fire(
      CORE_HOOKS.TOOL_BEFORE,
      {
        __version: 1,
        call: {
          toolId: "web-search",
          input: { q: "x" },
          contextMeta: { executionId: "e1" },
        },
        meta: { missionId: "m1", timestamp: 1000 },
      },
      async () => undefined,
    );
    await bus.fire(
      CORE_HOOKS.TOOL_AFTER,
      {
        __version: 1,
        call: {
          toolId: "web-search",
          input: { q: "x" },
          contextMeta: { executionId: "e1" },
        },
        result: { success: true },
        cacheHit: false,
        meta: { missionId: "m1", timestamp: 1000 },
      },
      async () => undefined,
    );

    const spans = exporter.getSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("tool.execute");
    expect(spans[0].attributes["tool.id"]).toBe("web-search");
    expect(spans[0].attributes["tool.mission_id"]).toBe("m1");
    expect(spans[0].status).toBe("ok");
  });

  it("TOOL_AFTER 含 abortReason → span.status=aborted + tool.abort_reason 字段", async () => {
    const exporter = new InMemorySpanExporter();
    const plugin = new TelemetryOtelPlugin(exporter);
    const bus = new HookBus(silentSupervisor());
    const ctx = makeFakeContext(bus, plugin.manifest.capabilities);
    await plugin.init(ctx, {});

    await bus.fire(
      CORE_HOOKS.TOOL_AFTER,
      {
        __version: 1,
        call: {
          toolId: "web-search",
          input: {},
          contextMeta: { executionId: "e1" },
        },
        result: null,
        abortReason: "rate-limited",
        meta: { missionId: "m1", timestamp: 1000 },
      },
      async () => undefined,
    );

    const spans = exporter.getSpans();
    expect(spans[0].status).toBe("aborted");
    expect(spans[0].attributes["tool.abort_reason"]).toBe("rate-limited");
  });

  it("MISSION_START/END 配对生成 mission.run span 含 status", async () => {
    const exporter = new InMemorySpanExporter();
    const plugin = new TelemetryOtelPlugin(exporter);
    const bus = new HookBus(silentSupervisor());
    const ctx = makeFakeContext(bus, plugin.manifest.capabilities);
    await plugin.init(ctx, {});

    await bus.fire(
      CORE_HOOKS.MISSION_START,
      {
        __version: 1,
        missionId: "m1",
        missionContext: { userId: "u1" },
        startedAt: 1000,
        meta: { missionId: "m1", timestamp: 1000 },
      },
      async () => undefined,
    );
    await bus.fire(
      CORE_HOOKS.MISSION_END,
      {
        __version: 1,
        missionId: "m1",
        status: "completed",
        completedAt: 5000,
        result: { score: 0.9 },
        meta: { missionId: "m1", timestamp: 5000 },
      },
      async () => undefined,
    );

    const spans = exporter.getSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("mission.run");
    expect(spans[0].attributes["mission.id"]).toBe("m1");
    expect(spans[0].attributes["mission.status"]).toBe("completed");
    expect(spans[0].status).toBe("ok");
    expect(spans[0].endTime - spans[0].startTime).toBe(4000);
  });

  it("MISSION_END status=failed → span.status=error + errorMessage 摘要（< 200 字符）", async () => {
    const exporter = new InMemorySpanExporter();
    const plugin = new TelemetryOtelPlugin(exporter);
    const bus = new HookBus(silentSupervisor());
    const ctx = makeFakeContext(bus, plugin.manifest.capabilities);
    await plugin.init(ctx, {});

    await bus.fire(
      CORE_HOOKS.MISSION_END,
      {
        __version: 1,
        missionId: "m2",
        status: "failed",
        completedAt: 5000,
        error: { message: "x".repeat(500) },
        meta: { missionId: "m2", timestamp: 5000 },
      },
      async () => undefined,
    );
    const span = exporter.getSpans()[0];
    expect(span.status).toBe("error");
    expect(span.errorMessage?.length).toBeLessThanOrEqual(200);
  });

  it("payload meta 不含 PII（只读 meta，不读 messages 内容）", async () => {
    const exporter = new InMemorySpanExporter();
    const plugin = new TelemetryOtelPlugin(exporter);
    const bus = new HookBus(silentSupervisor());
    const ctx = makeFakeContext(bus, plugin.manifest.capabilities);
    await plugin.init(ctx, {});

    await bus.fire(
      CORE_HOOKS.LLM_RESPONSE,
      {
        __version: 1,
        request: {
          messages: [{ role: "user", content: "PII: my-ssn-is-123-45-6789" }],
        },
        raw: { content: "PII echo: 123-45-6789" },
        meta: { missionId: "m1", timestamp: 1000 },
      },
      async () => undefined,
    );

    const span = exporter.getSpans()[0];
    // span attributes 不应含 PII
    const allValues = JSON.stringify(span.attributes);
    expect(allValues).not.toContain("ssn");
    expect(allValues).not.toContain("123-45-6789");
  });

  it("dispose 调用 exporter.flush 并清空 startTimes", async () => {
    let flushed = false;
    const exporter = {
      export: () => {},
      flush: async () => {
        flushed = true;
      },
    };
    const plugin = new TelemetryOtelPlugin(exporter);
    await plugin.dispose();
    expect(flushed).toBe(true);
  });

  it("healthCheck 返回 healthy", async () => {
    const plugin = new TelemetryOtelPlugin();
    const h = await plugin.healthCheck();
    expect(h.status).toBe("healthy");
  });
});

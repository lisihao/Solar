/**
 * ToolPipeline + HookBus 双轨等价 spec (v5.1 R0.5 PR-4)
 *
 * 验证：
 * - HookBus 注入时，TOOL_BEFORE 包裹整个旧流程；TOOL_AFTER 在 terminal 内 fire
 * - HookBus 未注入时，行为与旧路径完全一致（已有 28 spec 守护）
 * - abort('cache-hit') 由 plugin 触发短路时仍 fire TOOL_AFTER（HIGH-3）
 * - HookAbortError 透传给业务层
 */
import { ToolPipeline } from "../tool-pipeline";
import { HookBus } from "@/plugins/core/hook-bus";
import { CORE_HOOKS, HookAbortError } from "@/plugins/core/abstractions";
import type {
  ITool,
  ToolContext,
  ToolResult,
} from "../../abstractions/tool.interface";

function silentSupervisor() {
  return {
    onPluginError: () => {},
    isCircuitOpen: () => false,
  };
}

function fakeTool<TInput = unknown, TOutput = unknown>(
  output: TOutput,
): ITool<TInput, TOutput> {
  return {
    id: "fake-tool",
    name: "fake",
    description: "fake tool",
    sideEffect: "none",
    execute: async (): Promise<ToolResult<TOutput>> => ({
      success: true,
      data: output,
      metadata: {
        executionId: "exec-1",
        startTime: new Date(),
        endTime: new Date(),
        duration: 1,
      },
    }),
  } as unknown as ITool<TInput, TOutput>;
}

function fakeContext(): ToolContext {
  return {
    executionId: "ctx-1",
    toolId: "fake-tool",
    createdAt: new Date(),
  };
}

describe("ToolPipeline hook-bus 双轨 (v5.1 R0.5 PR-4)", () => {
  it("无 HookBus 时旧路径直接跑（行为零变化）", async () => {
    const pipe = new ToolPipeline(); // no hookBus
    const tool = fakeTool("hello");
    const r = await pipe.execute(tool, "input", fakeContext());
    expect(r.success).toBe(true);
    expect(r.data).toBe("hello");
  });

  it("注入 HookBus 时，无 plugin 注册仍然跑通（fast-path）", async () => {
    const bus = new HookBus(silentSupervisor());
    const pipe = new ToolPipeline(undefined, bus);
    const r = await pipe.execute(fakeTool("ok"), "x", fakeContext());
    expect(r.success).toBe(true);
    expect(r.data).toBe("ok");
  });

  it("TOOL_BEFORE plugin 监听到调用", async () => {
    const bus = new HookBus(silentSupervisor());
    const beforeSeen: string[] = [];
    bus.register(
      CORE_HOOKS.TOOL_BEFORE,
      async (ctx) => {
        beforeSeen.push("before");
        return ctx.next();
      },
      { pluginId: "obs", required: false, capabilities: [] },
    );
    const pipe = new ToolPipeline(undefined, bus);
    await pipe.execute(fakeTool("x"), "input", fakeContext());
    expect(beforeSeen).toEqual(["before"]);
  });

  it("TOOL_AFTER plugin 在 terminal 之后被调用，能拿到 result", async () => {
    const bus = new HookBus(silentSupervisor());
    let afterResult: unknown = null;
    bus.register(
      CORE_HOOKS.TOOL_AFTER,
      async (ctx) => {
        afterResult = (ctx.payload as { result: unknown }).result;
        return ctx.next();
      },
      { pluginId: "obs", required: false, capabilities: [] },
    );
    const pipe = new ToolPipeline(undefined, bus);
    await pipe.execute(fakeTool("hello"), "i", fakeContext());
    expect(afterResult).toMatchObject({ success: true, data: "hello" });
  });

  it("plugin abort('cache-hit') 短路时仍 fire TOOL_AFTER（HIGH-3）", async () => {
    const bus = new HookBus(silentSupervisor());
    let afterFired = false;
    let afterAbortReason: string | undefined;

    bus.register(
      CORE_HOOKS.TOOL_BEFORE,
      async (ctx) => {
        ctx.abort("cache-hit", { cached: "from-plugin" });
      },
      { pluginId: "cache", required: false, capabilities: [], priority: 100 },
    );
    bus.register(
      CORE_HOOKS.TOOL_AFTER,
      async (ctx) => {
        afterFired = true;
        afterAbortReason = (ctx.payload as { abortReason?: string })
          .abortReason;
        return ctx.next();
      },
      { pluginId: "audit", required: false, capabilities: [] },
    );

    const pipe = new ToolPipeline(undefined, bus);
    await expect(
      pipe.execute(fakeTool("would-not-run"), "i", fakeContext()),
    ).rejects.toBeInstanceOf(HookAbortError);

    expect(afterFired).toBe(true);
    expect(afterAbortReason).toBe("cache-hit");
  });
});

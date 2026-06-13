/**
 * sandbox-isolated-vm plugin 实现（v5.1 R0.5 PR-10）
 *
 * 监听 TOOL_WRAP（v5.1 P0-1）：
 *   plugin handler 包裹 ctx.next()（terminal = 真实 tool 执行）
 *   把 next() 调用放进 sandbox runner 跑，命中 timeout / memory 限制 → abort('timeout')
 *   sandbox 异常（fn 抛错）→ 透传给 ctx，让上层 ToolPipeline 处理
 *
 * 配置：
 *   timeoutMs（默认 30000）
 *   memoryLimitMb（默认 256）
 *   bypassToolIds（可信 tool 跳过沙箱，默认空）
 */
import type {
  IPlugin,
  IPluginContext,
  HookHandler,
  PluginHealth,
  ToolWrapPayload,
} from "@/plugins/core/abstractions";
import { CORE_HOOKS } from "@/plugins/core/abstractions";
import { SANDBOX_ISOLATED_VM_MANIFEST } from "./manifest";
import {
  type ISandboxRunner,
  InMemorySandboxRunner,
} from "./sandbox-runner.interface";

export interface SandboxIsolatedVmConfig {
  /** 默认 30s */
  readonly timeoutMs?: number;
  /** 默认 256MB */
  readonly memoryLimitMb?: number;
  /** 这些 toolId 跳过沙箱（可信内置 tool）*/
  readonly bypassToolIds?: ReadonlyArray<string>;
}

export class SandboxIsolatedVmPlugin implements IPlugin<SandboxIsolatedVmConfig> {
  readonly manifest = SANDBOX_ISOLATED_VM_MANIFEST;

  private runner: ISandboxRunner;
  private timeoutMs = 30000;
  private memoryLimitMb = 256;
  private bypassToolIds: ReadonlySet<string> | null = null;
  private logger?: IPluginContext["logger"];

  constructor(runner?: ISandboxRunner) {
    this.runner = runner ?? new InMemorySandboxRunner();
  }

  setRunner(runner: ISandboxRunner): void {
    this.runner = runner;
  }

  async init(
    ctx: IPluginContext,
    config: SandboxIsolatedVmConfig,
  ): Promise<void> {
    this.logger = ctx.logger;
    this.timeoutMs = config.timeoutMs ?? 30000;
    this.memoryLimitMb = config.memoryLimitMb ?? 256;
    this.bypassToolIds =
      config.bypassToolIds && config.bypassToolIds.length > 0
        ? new Set(config.bypassToolIds)
        : null;

    ctx.hooks.register(CORE_HOOKS.TOOL_WRAP, this.onToolWrap, {
      priority: 50, // 中等优先级：在 cache 之后（cache 命中时不进入 wrap）
    });
  }

  async healthCheck(): Promise<PluginHealth> {
    return { status: "healthy" };
  }

  // ── hook handler ──

  private onToolWrap: HookHandler<ToolWrapPayload> = async (ctx) => {
    const callTyped = ctx.payload.call as { toolId?: string } | undefined;
    const toolId = callTyped?.toolId ?? "unknown";

    // 可信 tool 直接放行（不进沙箱，性能优先）
    if (this.bypassToolIds?.has(toolId)) {
      return ctx.next();
    }

    // 把 ctx.next()（真实 tool 执行）放进 sandbox runner
    const sandboxResult = await this.runner.run(() => ctx.next(), {
      timeoutMs: this.timeoutMs,
      memoryLimitMb: this.memoryLimitMb,
    });

    if (sandboxResult.success) {
      return sandboxResult.result;
    }

    // 失败：超时 / 内存超限 → abort
    if (sandboxResult.timedOut) {
      this.logger?.warn(
        `[sandbox-isolated-vm] tool ${toolId} timed out after ${this.timeoutMs}ms`,
      );
      return ctx.abort("timeout", {
        toolId,
        timeoutMs: this.timeoutMs,
      });
    }
    if (sandboxResult.memoryExceeded) {
      this.logger?.warn(
        `[sandbox-isolated-vm] tool ${toolId} exceeded memory limit ${this.memoryLimitMb}MB`,
      );
      return ctx.abort("memory-exceeded", {
        toolId,
        memoryLimitMb: this.memoryLimitMb,
      });
    }
    // 其他错误：sandbox 内异常 → abort('sandbox-error') 让上层走 abort 路径
    return ctx.abort("sandbox-error", {
      toolId,
      message: sandboxResult.error ?? "unknown",
    });
  };
}

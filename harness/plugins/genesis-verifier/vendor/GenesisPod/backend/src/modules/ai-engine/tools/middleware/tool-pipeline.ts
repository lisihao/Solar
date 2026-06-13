/**
 * AI Engine - Tool Pipeline
 * 工具执行管道
 *
 * v5.1 R0.5 PR-4: 双轨接 plugins/core HookBus
 *   - 新路径：fire(TOOL_BEFORE) → 旧 middleware 链（terminal） → fire(TOOL_AFTER)
 *   - 旧路径：HookBus 未注入时直接跑旧 middleware 链（行为零变化）
 *   - HookAbortError("cache-hit") 由上层 plugin 触发短路，仍 fire TOOL_AFTER（HIGH-3）
 */

import { v4 as uuid } from "uuid";
import { ITool, ToolContext, ToolResult } from "../abstractions/tool.interface";
import { IToolMiddleware, IMiddlewareChain } from "./middleware.interface";
import { ToolError } from "@/modules/ai-engine/tools/abstractions/tool.error";
import { ToolResultCacheService } from "../cache/tool-result-cache.service";
import { HookBus } from "@/plugins/core/hook-bus";
import {
  CORE_HOOKS,
  type ToolBeforePayload,
  type ToolWrapPayload,
  type ToolAfterPayload,
} from "@/plugins/core/abstractions";
import { HookAbortError } from "@/plugins/core/abstractions";

/**
 * 工具执行管道
 * 管理中间件链并执行工具
 */
export class ToolPipeline implements IMiddlewareChain {
  private middlewares: IToolMiddleware[] = [];

  constructor(
    private readonly cacheService?: ToolResultCacheService,
    /** v5.1 PR-4: 可选 HookBus；未注入时旧行为不变（双轨期默认）*/
    private readonly hookBus?: HookBus,
  ) {}

  /**
   * 添加中间件
   */
  use(middleware: IToolMiddleware): this {
    this.middlewares.push(middleware);
    // 按优先级排序
    this.middlewares.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
    return this;
  }

  /**
   * 移除中间件
   */
  remove(name: string): boolean {
    const index = this.middlewares.findIndex((m) => m.name === name);
    if (index !== -1) {
      this.middlewares.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * 获取所有中间件
   */
  getAll(): IToolMiddleware[] {
    return [...this.middlewares];
  }

  /**
   * 执行工具（带中间件链 + 可选 plugin HookBus 双轨包装）
   *
   * v5.1 PR-4 双轨：
   *   - hookBus 注入 → fire(TOOL_BEFORE) ⊃ 旧 middleware ⊃ fire(TOOL_AFTER)
   *   - hookBus 未注入 → 直接跑 runLegacyPipeline（旧逻辑，零行为变化）
   */
  async execute<TInput, TOutput>(
    tool: ITool<TInput, TOutput>,
    input: TInput,
    context: ToolContext,
  ): Promise<ToolResult<TOutput>> {
    if (this.hookBus) {
      return this.executeWithHooks(tool, input, context);
    }
    return this.runLegacyPipeline(tool, input, context);
  }

  /** PR-4: 双轨期 hook 包装路径 */
  private async executeWithHooks<TInput, TOutput>(
    tool: ITool<TInput, TOutput>,
    input: TInput,
    context: ToolContext,
  ): Promise<ToolResult<TOutput>> {
    if (!context.executionId) {
      context.executionId = uuid();
    }
    const missionId =
      (context.metadata?.missionId as string | undefined) ?? context.taskId;

    // payload 仅含可结构化克隆数据（不含 tool 函数 / context 引用）
    // plugin 需要 tool 实例时通过 ServiceProxyRegistry + toolId 查 ToolRegistry
    const safeContextMeta = {
      executionId: context.executionId,
      toolId: context.toolId,
      taskId: context.taskId,
      metadata: context.metadata,
    };
    const beforePayload: ToolBeforePayload = {
      __version: 1,
      call: { toolId: tool.id, input, contextMeta: safeContextMeta },
      meta: { missionId, timestamp: Date.now() },
    };

    // TOOL_WRAP plugin（timeout / sandbox / retry）需要的 AbortSignal
    const wrapAbortController = new AbortController();

    try {
      const result = await this.hookBus!.fire(
        CORE_HOOKS.TOOL_BEFORE,
        beforePayload,
        async () => {
          // v5.1 P0-1: TOOL_WRAP 包裹 terminal 执行（带 AbortSignal）
          // wrap plugin（timeout/sandbox/retry）可在 terminal 执行期间监听 abort
          const wrapPayload: ToolWrapPayload = {
            __version: 1,
            call: { toolId: tool.id, input, contextMeta: safeContextMeta },
            signal: wrapAbortController.signal,
            meta: { missionId, timestamp: Date.now() },
          };
          const r = await this.hookBus!.fire(
            CORE_HOOKS.TOOL_WRAP,
            wrapPayload,
            async () => this.runLegacyPipeline(tool, input, context),
          );

          // fire TOOL_AFTER inside terminal (capture cache flag etc.)
          const afterPayload: ToolAfterPayload = {
            __version: 1,
            call: { toolId: tool.id, input, contextMeta: safeContextMeta },
            result: this.toJsonSafe(r),
            cacheHit: Boolean(
              (r.metadata as { extra?: { fromCache?: boolean } } | undefined)
                ?.extra?.fromCache,
            ),
            meta: { missionId, timestamp: Date.now() },
          };
          return this.hookBus!.fire(
            CORE_HOOKS.TOOL_AFTER,
            afterPayload,
            async () => r,
          );
        },
      );
      return result;
    } catch (err) {
      // v5.1 HIGH-3: abort 路径仍 fire TOOL_AFTER 让 billing/audit plugin 记录
      if (err instanceof HookAbortError) {
        const afterPayload: ToolAfterPayload = {
          __version: 1,
          call: { toolId: tool.id, input, contextMeta: safeContextMeta },
          result: this.toJsonSafe(err.abortPayload),
          abortReason: err.reason,
          meta: { missionId, timestamp: Date.now() },
        };
        await this.hookBus!.fire(
          CORE_HOOKS.TOOL_AFTER,
          afterPayload,
          async () => err.abortPayload,
        ).catch(() => undefined);
        // 透传给业务层
        throw err;
      }
      throw err;
    }
  }

  /**
   * 将业务对象转换为可 structuredClone 的纯数据
   * 移除函数引用 / class 实例，只保留 JSON 兼容字段
   */
  private toJsonSafe(obj: unknown): unknown {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== "object") return obj;
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch {
      return undefined;
    }
  }

  /** 旧逻辑：保持双轨期行为零变化 */
  private async runLegacyPipeline<TInput, TOutput>(
    tool: ITool<TInput, TOutput>,
    input: TInput,
    context: ToolContext,
  ): Promise<ToolResult<TOutput>> {
    let currentInput: unknown = input;
    const startTime = new Date();

    // 确保有执行 ID
    if (!context.executionId) {
      context.executionId = uuid();
    }

    // Resolve missionId from context (consumer sets metadata.missionId)
    const missionId =
      (context.metadata?.missionId as string | undefined) ?? context.taskId;

    // Determine whether this tool's results are cacheable
    const cacheable = this.cacheService?.isCacheable(tool.sideEffect) ?? false;
    const cacheKey = cacheable
      ? this.cacheService!.buildKey(missionId, tool.id, input)
      : "";

    try {
      // 执行所有 before 中间件
      for (const middleware of this.middlewares) {
        if (middleware.before) {
          const result = await middleware.before(currentInput, context, tool);
          if (result !== undefined) {
            currentInput = result;
          }
        }
      }

      // Cache lookup: skip tool.execute() on hit
      if (cacheable) {
        const cached =
          await this.cacheService!.tryGet<ToolResult<TOutput>>(cacheKey);
        if (cached !== null) {
          // Stamp fromCache flag and return immediately (skip after-middlewares)
          cached.metadata = {
            ...cached.metadata,
            extra: { ...(cached.metadata.extra ?? {}), fromCache: true },
          };
          return cached;
        }
      }

      // 执行工具
      let result = await tool.execute(currentInput as TInput, context);

      // Write successful result to cache
      if (cacheable && result.success) {
        await this.cacheService!.set(cacheKey, result);
      }

      // 执行所有 after 中间件（逆序）
      for (let i = this.middlewares.length - 1; i >= 0; i--) {
        const middleware = this.middlewares[i];
        if (middleware.after) {
          result = (await middleware.after(
            result,
            context,
            tool,
          )) as ToolResult<TOutput>;
        }
      }

      return result;
    } catch (error) {
      // 执行错误处理中间件
      for (const middleware of this.middlewares) {
        if (middleware.onError) {
          const recovery = await middleware.onError(
            error as Error,
            currentInput,
            context,
            tool,
          );
          if (recovery) {
            return recovery as ToolResult<TOutput>;
          }
        }
      }

      // 没有中间件处理，返回错误结果
      const toolError = ToolError.fromError(error, tool.id);
      return {
        success: false,
        error: {
          code: toolError.code,
          message: toolError.message,
          details: toolError.details,
          retryable: toolError.retryable,
        },
        metadata: {
          executionId: context.executionId,
          startTime,
          endTime: new Date(),
          duration: Date.now() - startTime.getTime(),
        },
      };
    }
  }
}

/**
 * 创建默认的工具管道
 */
export function createDefaultPipeline(): ToolPipeline {
  const pipeline = new ToolPipeline();

  // 可以在这里添加默认中间件
  // pipeline.use(new ValidationMiddleware());
  // pipeline.use(new TimeoutMiddleware());
  // pipeline.use(new LoggingMiddleware());

  return pipeline;
}

/**
 * 工具执行器
 * 封装工具注册表和管道
 */
export class ToolExecutor {
  constructor(private readonly pipeline: ToolPipeline) {}

  /**
   * 执行工具
   */
  async execute<TInput, TOutput>(
    tool: ITool<TInput, TOutput>,
    input: TInput,
    options?: Partial<ToolContext>,
  ): Promise<ToolResult<TOutput>> {
    const context: ToolContext = {
      executionId: uuid(),
      toolId: tool.id,
      createdAt: new Date(),
      ...options,
    };

    return this.pipeline.execute(tool, input, context);
  }
}

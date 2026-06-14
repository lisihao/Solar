/**
 * AI Engine - Timeout Middleware
 * 超时中间件
 */

import { ToolError } from "@/modules/ai-engine/tools/abstractions/tool.error";
import { ITool, ToolContext, ToolResult } from "../abstractions/tool.interface";
import { IToolMiddleware } from "./middleware.interface";

/**
 * 超时中间件配置
 */
export interface TimeoutMiddlewareConfig {
  /**
   * 默认超时时间（毫秒）
   */
  defaultTimeout?: number;

  /**
   * 按工具 ID 配置的超时时间
   */
  timeoutByTool?: Record<string, number>;
}

/**
 * 超时中间件
 * 为工具执行添加超时控制
 */
export class TimeoutMiddleware implements IToolMiddleware {
  readonly name = "timeout";
  readonly priority = 20;

  private activeTimers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly config: TimeoutMiddlewareConfig = {}) {
    this.config = {
      defaultTimeout: 30000,
      ...config,
    };
  }

  async before(
    _input: unknown,
    context: ToolContext,
    tool: ITool,
  ): Promise<void> {
    // 设置超时时间到 context
    const timeout = this.getTimeout(tool, context);
    context.timeout = timeout;
  }

  /**
   * 包装执行以添加超时
   */
  wrapExecution<TInput, TOutput>(
    tool: ITool<TInput, TOutput>,
    _input: TInput,
    context: ToolContext,
    executor: () => Promise<ToolResult<TOutput>>,
  ): Promise<ToolResult<TOutput>> {
    const timeout = this.getTimeout(tool, context);

    return new Promise((resolve) => {
      let resolved = false;

      // 设置超时定时器
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve({
            success: false,
            error: {
              code: "TOOL_TIMEOUT",
              message: `Tool '${tool.id}' timed out after ${timeout}ms`,
              retryable: true,
            },
            metadata: {
              executionId: context.executionId,
              startTime: context.createdAt,
              endTime: new Date(),
              duration: timeout,
            },
          });
        }
      }, timeout);

      this.activeTimers.set(context.executionId, timer);

      // 执行实际逻辑
      executor()
        .then((result) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            this.activeTimers.delete(context.executionId);
            resolve(result);
          }
        })
        .catch((error) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            this.activeTimers.delete(context.executionId);
            const toolError = ToolError.fromError(error, tool.id);
            resolve({
              success: false,
              error: {
                code: toolError.code,
                message: toolError.message,
                retryable: toolError.retryable,
              },
              metadata: {
                executionId: context.executionId,
                startTime: context.createdAt,
                endTime: new Date(),
                duration: Date.now() - context.createdAt.getTime(),
              },
            });
          }
        });
    });
  }

  /**
   * 取消超时定时器
   */
  cancelTimeout(executionId: string): void {
    const timer = this.activeTimers.get(executionId);
    if (timer) {
      clearTimeout(timer);
      this.activeTimers.delete(executionId);
    }
  }

  private getTimeout(tool: ITool, context: ToolContext): number {
    // 优先级：context.timeout > 按工具配置 > 工具默认 > 全局默认
    if (context.timeout) {
      return context.timeout;
    }
    if (this.config.timeoutByTool?.[tool.id]) {
      return this.config.timeoutByTool[tool.id];
    }
    if (tool.defaultTimeout) {
      return tool.defaultTimeout;
    }
    return this.config.defaultTimeout!;
  }
}

/**
 * 创建超时中间件
 */
export function createTimeoutMiddleware(
  config?: TimeoutMiddlewareConfig,
): TimeoutMiddleware {
  return new TimeoutMiddleware(config);
}

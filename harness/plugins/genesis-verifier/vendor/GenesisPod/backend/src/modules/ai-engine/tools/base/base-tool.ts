/**
 * AI Engine - Base Tool
 * 工具基类实现
 */

import { v4 as uuid } from "uuid";
import { ValidationResult, JsonObject } from "@/modules/ai-engine/facade/index";
import { ToolError } from "@/modules/ai-engine/tools/abstractions/tool.error";
import {
  ITool,
  ToolContext,
  ToolResult,
  ToolCategory,
  JSONSchema,
  FunctionDefinition,
  CompactToolSummary,
  ToolId,
} from "../abstractions/tool.interface";

/**
 * 基础工具抽象类
 * 提供最小化的工具实现框架
 */
export abstract class BaseTool<
  TInput = unknown,
  TOutput = unknown,
> implements ITool<TInput, TOutput> {
  /**
   * 工具 ID
   */
  abstract readonly id: ToolId;

  /**
   * 工具名称
   */
  abstract readonly name: string;

  /**
   * 工具描述
   */
  abstract readonly description: string;

  /**
   * 工具类别
   */
  abstract readonly category: ToolCategory;

  /**
   * 输入 Schema
   */
  abstract readonly inputSchema: JSONSchema;

  /**
   * 输出 Schema
   */
  abstract readonly outputSchema: JSONSchema;

  /**
   * 工具版本
   */
  readonly version: string = "1.0.0";

  /**
   * 工具标签
   */
  readonly tags: string[] = [];

  /**
   * 默认超时时间（毫秒）
   */
  readonly defaultTimeout: number = 30000;

  /**
   * 是否支持取消
   */
  readonly cancellable: boolean = true;

  /**
   * 是否启用
   */
  readonly enabled: boolean = true;

  /**
   * 核心执行逻辑（子类必须实现）
   * @param input 输入参数
   * @param context 执行上下文
   * @returns 输出结果
   */
  protected abstract doExecute(
    input: TInput,
    context: ToolContext,
  ): Promise<TOutput>;

  /**
   * 执行工具
   * 提供基本的执行框架，包括：
   * - 取消检查
   * - 结果包装
   * - 错误处理
   */
  async execute(
    input: TInput,
    context: ToolContext,
  ): Promise<ToolResult<TOutput>> {
    const startTime = new Date();
    const executionId = context.executionId || uuid();

    try {
      // 检查取消信号
      if (context.signal?.aborted) {
        throw ToolError.cancelled(this.id);
      }

      // 执行核心逻辑
      const data = await this.doExecute(input, context);

      // 返回成功结果
      return {
        success: true,
        data,
        metadata: this.buildMetadata(executionId, startTime, context),
      };
    } catch (error) {
      // 转换错误
      const toolError = ToolError.fromError(error, this.id);

      return {
        success: false,
        error: {
          code: toolError.code,
          message: toolError.message,
          details: toolError.details as JsonObject,
          retryable: toolError.retryable,
        },
        metadata: this.buildMetadata(executionId, startTime, context),
      };
    }
  }

  /**
   * 验证输入（子类可覆盖）
   * @param input 输入参数
   * @returns 验证结果（ValidationResult 或 boolean）
   */
  validateInput(_input: TInput): ValidationResult | boolean {
    // 默认实现：始终通过
    // 子类可以覆盖此方法提供自定义验证
    return { valid: true };
  }

  /**
   * 转换为 Function Calling 格式
   */
  toFunctionDefinition(): FunctionDefinition {
    return {
      name: this.id,
      description: this.description,
      parameters: this.inputSchema,
    };
  }

  /**
   * 转换为精简摘要格式（节省 Token）
   * 描述限制在 100 字符以内
   */
  toCompactSummary(): CompactToolSummary {
    // 截断描述到 100 字符
    const brief =
      this.description.length > 100
        ? this.description.substring(0, 97) + "..."
        : this.description;

    return {
      id: this.id,
      name: this.name,
      brief,
      category: this.category,
      tags: this.tags.length > 0 ? this.tags : undefined,
    };
  }

  /**
   * 构建执行元数据
   */
  protected buildMetadata(
    executionId: string,
    startTime: Date,
    context: ToolContext,
  ) {
    const endTime = new Date();
    return {
      executionId,
      startTime,
      endTime,
      duration: endTime.getTime() - startTime.getTime(),
      retryCount: context.retryCount,
    };
  }

  /**
   * 检查取消信号
   * @throws 如果已取消
   */
  protected checkCancellation(context: ToolContext): void {
    if (context.signal?.aborted) {
      throw ToolError.cancelled(this.id);
    }
  }

  /**
   * 创建超时 Promise
   */
  protected createTimeoutPromise(timeout: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(ToolError.timeout(this.id, timeout));
      }, timeout);
    });
  }

  /**
   * 带超时执行
   */
  protected async executeWithTimeout<T>(
    promise: Promise<T>,
    timeout: number,
  ): Promise<T> {
    return Promise.race([promise, this.createTimeoutPromise(timeout)]);
  }
}

/**
 * 简单工具创建器
 * 用于快速创建简单工具
 */
export function createTool<TInput, TOutput>(options: {
  id: ToolId;
  name: string;
  description: string;
  category: ToolCategory;
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  execute: (input: TInput, context: ToolContext) => Promise<TOutput>;
  validate?: (input: TInput) => ValidationResult;
  defaultTimeout?: number;
  tags?: string[];
}): ITool<TInput, TOutput> {
  return {
    id: options.id,
    name: options.name,
    description: options.description,
    category: options.category,
    inputSchema: options.inputSchema,
    outputSchema: options.outputSchema,
    defaultTimeout: options.defaultTimeout ?? 30000,
    cancellable: true,
    enabled: true,
    tags: options.tags,

    async execute(
      input: TInput,
      context: ToolContext,
    ): Promise<ToolResult<TOutput>> {
      const startTime = new Date();
      const executionId = context.executionId || uuid();

      try {
        const data = await options.execute(input, context);
        return {
          success: true,
          data,
          metadata: {
            executionId,
            startTime,
            endTime: new Date(),
            duration: Date.now() - startTime.getTime(),
          },
        };
      } catch (error) {
        const toolError = ToolError.fromError(error, options.id);
        return {
          success: false,
          error: {
            code: toolError.code,
            message: toolError.message,
            retryable: toolError.retryable,
          },
          metadata: {
            executionId,
            startTime,
            endTime: new Date(),
            duration: Date.now() - startTime.getTime(),
          },
        };
      }
    },

    validateInput: options.validate ?? (() => ({ valid: true })),

    toFunctionDefinition(): FunctionDefinition {
      return {
        name: options.id,
        description: options.description,
        parameters: options.inputSchema,
      };
    },

    toCompactSummary(): CompactToolSummary {
      const brief =
        options.description.length > 100
          ? options.description.substring(0, 97) + "..."
          : options.description;
      return {
        id: options.id,
        name: options.name,
        brief,
        category: options.category,
        tags: options.tags,
      };
    },
  };
}


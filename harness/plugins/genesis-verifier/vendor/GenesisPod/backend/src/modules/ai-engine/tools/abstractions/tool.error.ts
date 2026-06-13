/**
 * AI Engine - Tool Error
 * 工具错误类
 */

import { JsonObject } from "@/modules/ai-engine/facade/abstractions/common.types";
import { EngineError } from "@/modules/ai-engine/facade/abstractions/engine.error";
import { ToolErrorCode } from "@/modules/ai-engine/facade/abstractions/error-codes.constants";

/**
 * 工具错误
 */
export class ToolError extends EngineError {
  /**
   * 工具 ID
   */
  readonly toolId?: string;

  /**
   * 工具名称
   */
  readonly toolName?: string;

  constructor(
    message: string,
    code: string = ToolErrorCode.UNKNOWN,
    options?: {
      toolId?: string;
      toolName?: string;
      details?: JsonObject;
      cause?: Error;
      retryable?: boolean;
    },
  ) {
    const details: JsonObject = { ...options?.details };
    if (options?.toolId) details.toolId = options.toolId;
    if (options?.toolName) details.toolName = options.toolName;

    super(message, code, {
      details: Object.keys(details).length > 0 ? details : undefined,
      cause: options?.cause,
      retryable: options?.retryable,
    });
    this.toolId = options?.toolId;
    this.toolName = options?.toolName;
  }

  /**
   * 工具未找到
   */
  static notFound(toolId: string): ToolError {
    return new ToolError(
      `Tool '${toolId}' not found`,
      ToolErrorCode.NOT_FOUND,
      { toolId, retryable: false },
    );
  }

  /**
   * 工具未注册
   */
  static notRegistered(toolId: string): ToolError {
    return new ToolError(
      `Tool '${toolId}' is not registered`,
      ToolErrorCode.NOT_REGISTERED,
      { toolId, retryable: false },
    );
  }

  /**
   * 输入无效
   */
  static invalidInput(
    toolId: string,
    reason: string,
    details?: JsonObject,
  ): ToolError {
    return new ToolError(
      `Invalid input for tool '${toolId}': ${reason}`,
      ToolErrorCode.INVALID_INPUT,
      { toolId, details, retryable: false },
    );
  }

  /**
   * 缺少参数
   */
  static missingParameter(toolId: string, parameterName: string): ToolError {
    return new ToolError(
      `Missing required parameter '${parameterName}' for tool '${toolId}'`,
      ToolErrorCode.MISSING_PARAMETER,
      { toolId, details: { parameterName }, retryable: false },
    );
  }

  /**
   * 执行失败
   */
  static executionFailed(
    toolId: string,
    reason: string,
    cause?: Error,
  ): ToolError {
    return new ToolError(
      `Tool '${toolId}' execution failed: ${reason}`,
      ToolErrorCode.EXECUTION_FAILED,
      { toolId, cause, retryable: false },
    );
  }

  /**
   * 执行超时
   */
  static timeout(toolId: string, timeout: number): ToolError {
    return new ToolError(
      `Tool '${toolId}' timed out after ${timeout}ms`,
      ToolErrorCode.TIMEOUT,
      { toolId, details: { timeout }, retryable: true },
    );
  }

  /**
   * 执行取消
   */
  static cancelled(toolId: string): ToolError {
    return new ToolError(
      `Tool '${toolId}' execution was cancelled`,
      ToolErrorCode.CANCELLED,
      { toolId, retryable: false },
    );
  }

  /**
   * 速率限制
   */
  static rateLimited(toolId: string, retryAfter?: number): ToolError {
    return new ToolError(
      `Tool '${toolId}' is rate limited${retryAfter ? `, retry after ${retryAfter}ms` : ""}`,
      ToolErrorCode.RATE_LIMITED,
      {
        toolId,
        details: retryAfter !== undefined ? { retryAfter } : undefined,
        retryable: true,
      },
    );
  }

  /**
   * 外部服务错误
   */
  static externalServiceError(
    toolId: string,
    serviceName: string,
    cause?: Error,
  ): ToolError {
    return new ToolError(
      `External service '${serviceName}' error in tool '${toolId}'`,
      ToolErrorCode.EXTERNAL_SERVICE_ERROR,
      { toolId, details: { serviceName }, cause, retryable: true },
    );
  }

  /**
   * 网络错误
   */
  static networkError(toolId: string, cause?: Error): ToolError {
    return new ToolError(
      `Network error in tool '${toolId}'`,
      ToolErrorCode.NETWORK_ERROR,
      { toolId, cause, retryable: true },
    );
  }

  /**
   * API 错误
   */
  static apiError(
    toolId: string,
    statusCode: number,
    message: string,
  ): ToolError {
    return new ToolError(
      `API error in tool '${toolId}': ${statusCode} - ${message}`,
      ToolErrorCode.API_ERROR,
      { toolId, details: { statusCode }, retryable: statusCode >= 500 },
    );
  }

  /**
   * 资源未找到
   */
  static resourceNotFound(
    toolId: string,
    resourceType: string,
    resourceId: string,
  ): ToolError {
    return new ToolError(
      `Resource '${resourceType}:${resourceId}' not found in tool '${toolId}'`,
      ToolErrorCode.RESOURCE_NOT_FOUND,
      { toolId, details: { resourceType, resourceId }, retryable: false },
    );
  }

  /**
   * 从普通错误创建
   */
  static override fromError(
    error: unknown,
    code: string = ToolErrorCode.UNKNOWN,
    details?: JsonObject,
  ): ToolError {
    if (error instanceof ToolError) {
      return error;
    }

    const toolId = details?.toolId as string | undefined;

    if (error instanceof Error) {
      return new ToolError(error.message, code, {
        toolId,
        cause: error,
        details,
      });
    }

    return new ToolError(
      typeof error === "string" ? error : "Unknown tool error",
      code,
      { toolId, details },
    );
  }

  /**
   * 从普通错误创建（带 toolId）
   */
  static fromToolError(
    error: unknown,
    toolId?: string,
    code: string = ToolErrorCode.UNKNOWN,
  ): ToolError {
    return ToolError.fromError(error, code, toolId ? { toolId } : undefined);
  }
}


/**
 * Short Term Memory Tool
 * 短期记忆工具 - 会话级别的临时记忆存储
 *
 * 功能:
 * - get: 获取记忆
 * - set: 设置记忆
 * - append: 追加到数组
 * - clear: 清空记忆
 * - list: 列出所有记忆
 *
 * 特点:
 * - 基于 sessionId 隔离
 * - 支持 TTL 过期
 * - 适用于会话上下文、临时状态等
 */

import { Injectable } from "@nestjs/common";
import { BaseTool } from "@/modules/ai-engine/tools/base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "@/modules/ai-engine/tools/abstractions/tool.interface";

import { ShortTermMemoryService } from "../stores/short-term-memory.service";

// ============================================================================
// Types
// ============================================================================

/**
 * 操作类型
 */
export enum MemoryOperation {
  GET = "get",
  SET = "set",
  APPEND = "append",
  DELETE = "delete",
  CLEAR = "clear",
  LIST = "list",
}

/**
 * 短期记忆工具输入
 */
export interface ShortTermMemoryInput {
  /**
   * 操作类型
   */
  operation: MemoryOperation;

  /**
   * 记忆键名
   */
  key?: string;

  /**
   * 记忆值（用于 set 和 append）
   */
  value?: unknown;

  /**
   * TTL 过期时间（秒）
   */
  ttl?: number;

  /**
   * 会话 ID（可选，默认从 context 获取）
   */
  sessionId?: string;
}

/**
 * 短期记忆工具输出
 */
export interface ShortTermMemoryOutput {
  /**
   * 操作是否成功
   */
  success: boolean;

  /**
   * 操作类型
   */
  operation: MemoryOperation;

  /**
   * 返回的数据（用于 get 和 list）
   */
  data?: unknown;

  /**
   * 错误信息
   */
  error?: string;

  /**
   * 会话 ID
   */
  sessionId: string;
}

// ============================================================================
// Tool Implementation
// ============================================================================

@Injectable()
export class ShortTermMemoryTool extends BaseTool<
  ShortTermMemoryInput,
  ShortTermMemoryOutput
> {
  readonly id = "short-term-memory";
  readonly category: ToolCategory = "memory";
  readonly tags = ["memory", "short-term", "session", "context"];
  readonly name = "短期记忆";
  readonly description =
    "会话级别的临时记忆存储。支持 get、set、append、delete、clear、list 操作。适用于存储会话上下文、临时状态、对话历史等短期数据。";

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      operation: {
        type: "string",
        description: "操作类型",
        enum: Object.values(MemoryOperation),
      },
      key: {
        type: "string",
        description: "记忆键名（除了 clear 和 list 操作外必填）",
      },
      value: {
        type: "object",
        description: "记忆值（用于 set 和 append 操作）",
      },
      ttl: {
        type: "number",
        description: "过期时间（秒），0 表示永不过期，默认 3600（1小时）",
        default: 3600,
      },
      sessionId: {
        type: "string",
        description: "会话 ID，默认从执行上下文获取",
      },
    },
    required: ["operation"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      success: {
        type: "boolean",
        description: "操作是否成功",
      },
      operation: {
        type: "string",
        description: "执行的操作类型",
      },
      data: {
        type: "object",
        description: "返回的数据",
      },
      error: {
        type: "string",
        description: "错误信息",
      },
      sessionId: {
        type: "string",
        description: "会话 ID",
      },
    },
  };

  constructor(private readonly memoryService: ShortTermMemoryService) {
    super();
    // defaultTimeout set in class property // 5 秒超时
  }

  validateInput(input: ShortTermMemoryInput) {
    // 验证操作类型
    if (!Object.values(MemoryOperation).includes(input.operation)) {
      return false;
    }

    // 除了 clear 和 list 操作外，key 是必须的
    if (
      input.operation !== MemoryOperation.CLEAR &&
      input.operation !== MemoryOperation.LIST
    ) {
      if (!input.key || typeof input.key !== "string") {
        return false;
      }
    }

    // set 和 append 操作必须有 value
    if (
      (input.operation === MemoryOperation.SET ||
        input.operation === MemoryOperation.APPEND) &&
      input.value === undefined
    ) {
      return false;
    }

    return true;
  }

  protected async doExecute(
    input: ShortTermMemoryInput,
    context: ToolContext,
  ): Promise<ShortTermMemoryOutput> {
    // 获取 sessionId（优先使用输入的，否则使用 taskId）
    const sessionId = input.sessionId ?? context.executionId;

    try {
      switch (input.operation) {
        case MemoryOperation.GET: {
          const data = await this.memoryService.getWithSession(
            sessionId,
            input.key!,
          );
          return {
            success: true,
            operation: input.operation,
            data,
            sessionId,
          };
        }

        case MemoryOperation.SET: {
          await this.memoryService.setWithSession(
            sessionId,
            input.key!,
            input.value,
            input.ttl,
          );
          return {
            success: true,
            operation: input.operation,
            sessionId,
          };
        }

        case MemoryOperation.APPEND: {
          await this.memoryService.appendWithSession(
            sessionId,
            input.key!,
            input.value,
            input.ttl,
          );
          return {
            success: true,
            operation: input.operation,
            sessionId,
          };
        }

        case MemoryOperation.DELETE: {
          const deleted = await this.memoryService.deleteWithSession(
            sessionId,
            input.key!,
          );
          return {
            success: deleted,
            operation: input.operation,
            data: { deleted },
            sessionId,
          };
        }

        case MemoryOperation.CLEAR: {
          await this.memoryService.clearSession(sessionId);
          return {
            success: true,
            operation: input.operation,
            sessionId,
          };
        }

        case MemoryOperation.LIST: {
          const items = await this.memoryService.listSession(sessionId);
          return {
            success: true,
            operation: input.operation,
            data: { items, count: items.length },
            sessionId,
          };
        }

        default:
          return {
            success: false,
            operation: input.operation,
            error: `Unknown operation: ${input.operation}`,
            sessionId,
          };
      }
    } catch (error) {
      return {
        success: false,
        operation: input.operation,
        error: error instanceof Error ? error.message : "Unknown error",
        sessionId,
      };
    }
  }
}

/**
 * Long Term Memory Tool
 * 长期记忆工具 - 持久化记忆存储和检索
 *
 * 功能:
 * - store: 存储记忆
 * - retrieve: 检索记忆
 * - search: 语义搜索
 * - delete: 删除记忆
 * - list: 列出记忆
 * - update: 更新元数据
 *
 * 特点:
 * - 基于 userId 隔离
 * - 支持持久化存储
 * - 支持按 type、importance、tags 过滤
 * - 支持语义搜索（未来扩展）
 */

import { Injectable } from "@nestjs/common";
import { BaseTool } from "@/modules/ai-engine/tools/base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "@/modules/ai-engine/tools/abstractions/tool.interface";

import { LongTermMemoryService } from "../stores";

// ============================================================================
// Types
// ============================================================================

/**
 * 操作类型
 */
export enum LongTermMemoryOperation {
  STORE = "store",
  RETRIEVE = "retrieve",
  SEARCH = "search",
  DELETE = "delete",
  LIST = "list",
  UPDATE = "update",
}

/**
 * 长期记忆工具输入
 */
export interface LongTermMemoryInput {
  /**
   * 操作类型
   */
  operation: LongTermMemoryOperation;

  /**
   * 记忆键名
   */
  key?: string;

  /**
   * 记忆值（用于 store）
   */
  value?: unknown;

  /**
   * 记忆类型（如：preference, knowledge, history）
   */
  type?: string;

  /**
   * 重要程度 (0-10)
   */
  importance?: number;

  /**
   * 标签
   */
  tags?: string[];

  /**
   * TTL 过期时间（秒）
   */
  ttl?: number;

  /**
   * 搜索查询（用于 search）
   */
  query?: string;

  /**
   * 搜索/列表选项
   */
  options?: {
    limit?: number;
    offset?: number;
    threshold?: number;
    sortBy?: "createdAt" | "updatedAt" | "importance";
    sortOrder?: "asc" | "desc";
  };

  /**
   * 用户 ID（可选，默认从 context 获取）
   */
  userId?: string;
}

/**
 * 长期记忆工具输出
 */
export interface LongTermMemoryOutput {
  /**
   * 操作是否成功
   */
  success: boolean;

  /**
   * 操作类型
   */
  operation: LongTermMemoryOperation;

  /**
   * 返回的数据
   */
  data?: unknown;

  /**
   * 错误信息
   */
  error?: string;

  /**
   * 用户 ID
   */
  userId: string;
}

// ============================================================================
// Tool Implementation
// ============================================================================

@Injectable()
export class LongTermMemoryTool extends BaseTool<
  LongTermMemoryInput,
  LongTermMemoryOutput
> {
  readonly id = "long-term-memory";
  readonly category: ToolCategory = "memory";
  readonly tags = ["memory", "long-term", "persistent", "history"];
  readonly name = "长期记忆";
  readonly description =
    "持久化记忆存储和检索。支持 store、retrieve、search、delete、list、update 操作。适用于存储知识库、用户偏好、历史记录等需要长期保存的数据。支持按类型、重要性、标签过滤和排序。";

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      operation: {
        type: "string",
        description: "操作类型",
        enum: Object.values(LongTermMemoryOperation),
      },
      key: {
        type: "string",
        description: "记忆键名（用于 store、retrieve、delete、update 操作）",
      },
      value: {
        type: "object",
        description: "记忆值（用于 store 操作）",
      },
      type: {
        type: "string",
        description:
          "记忆类型（如：preference、knowledge、history），用于分类和过滤",
      },
      importance: {
        type: "number",
        description: "重要程度 (0-10)，用于排序和过滤",
        default: 5,
      },
      tags: {
        type: "array",
        description: "标签列表，用于分类和过滤",
        items: { type: "string" },
      },
      ttl: {
        type: "number",
        description: "过期时间（秒），0 表示永不过期，默认永不过期",
      },
      query: {
        type: "string",
        description: "搜索查询（用于 search 操作）",
      },
      options: {
        type: "object",
        description: "搜索/列表选项",
        properties: {
          limit: {
            type: "number",
            description: "最大结果数，默认 10",
            default: 10,
          },
          offset: {
            type: "number",
            description: "偏移量，默认 0",
            default: 0,
          },
          threshold: {
            type: "number",
            description: "搜索相似度阈值 (0-1)，默认 0.5",
            default: 0.5,
          },
          sortBy: {
            type: "string",
            description: "排序字段",
            enum: ["createdAt", "updatedAt", "importance"],
            default: "updatedAt",
          },
          sortOrder: {
            type: "string",
            description: "排序方向",
            enum: ["asc", "desc"],
            default: "desc",
          },
        },
      },
      userId: {
        type: "string",
        description: "用户 ID，默认从执行上下文获取",
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
      userId: {
        type: "string",
        description: "用户 ID",
      },
    },
  };

  constructor(private readonly memoryService: LongTermMemoryService) {
    super();
    // defaultTimeout set in class property // 10 秒超时
  }

  validateInput(input: LongTermMemoryInput) {
    // 验证操作类型
    if (!Object.values(LongTermMemoryOperation).includes(input.operation)) {
      return false;
    }

    // store、retrieve、delete、update 操作必须有 key
    if (
      [
        LongTermMemoryOperation.STORE,
        LongTermMemoryOperation.RETRIEVE,
        LongTermMemoryOperation.DELETE,
        LongTermMemoryOperation.UPDATE,
      ].includes(input.operation)
    ) {
      if (!input.key || typeof input.key !== "string") {
        return false;
      }
    }

    // store 操作必须有 value
    if (
      input.operation === LongTermMemoryOperation.STORE &&
      input.value === undefined
    ) {
      return false;
    }

    // search 操作必须有 query
    if (
      input.operation === LongTermMemoryOperation.SEARCH &&
      (!input.query || typeof input.query !== "string")
    ) {
      return false;
    }

    return true;
  }

  protected async doExecute(
    input: LongTermMemoryInput,
    context: ToolContext,
  ): Promise<LongTermMemoryOutput> {
    // 获取 userId（优先使用输入的，否则使用 context.userId）
    const userId = input.userId ?? context.userId ?? "default";

    try {
      switch (input.operation) {
        case LongTermMemoryOperation.STORE: {
          await this.memoryService.setWithUser(
            userId,
            input.key!,
            input.value,
            {
              ttl: input.ttl,
              type: input.type,
              importance: input.importance,
              tags: input.tags,
            },
          );
          return {
            success: true,
            operation: input.operation,
            data: {
              key: input.key,
              type: input.type,
              importance: input.importance,
              tags: input.tags,
            },
            userId,
          };
        }

        case LongTermMemoryOperation.RETRIEVE: {
          const data = await this.memoryService.getWithUser(userId, input.key!);
          return {
            success: true,
            operation: input.operation,
            data,
            userId,
          };
        }

        case LongTermMemoryOperation.SEARCH: {
          const results = await this.memoryService.search(input.query!, {
            userId,
            limit: input.options?.limit,
            threshold: input.options?.threshold,
            tags: input.tags,
            type: input.type,
          });
          return {
            success: true,
            operation: input.operation,
            data: { results, count: results.length },
            userId,
          };
        }

        case LongTermMemoryOperation.DELETE: {
          const deleted = await this.memoryService.deleteWithUser(
            userId,
            input.key!,
          );
          return {
            success: deleted,
            operation: input.operation,
            data: { deleted },
            userId,
          };
        }

        case LongTermMemoryOperation.LIST: {
          const items = await this.memoryService.list({
            userId,
            offset: input.options?.offset,
            limit: input.options?.limit,
            sortBy: input.options?.sortBy,
            sortOrder: input.options?.sortOrder,
            tags: input.tags,
            type: input.type,
          });
          return {
            success: true,
            operation: input.operation,
            data: { items, count: items.length },
            userId,
          };
        }

        case LongTermMemoryOperation.UPDATE: {
          await this.memoryService.updateMetadata(
            input.key!,
            {
              importance: input.importance,
              tags: input.tags,
            },
            userId,
          );
          return {
            success: true,
            operation: input.operation,
            data: {
              key: input.key,
              importance: input.importance,
              tags: input.tags,
            },
            userId,
          };
        }

        default:
          return {
            success: false,
            operation: input.operation,
            error: `Unknown operation: ${input.operation}`,
            userId,
          };
      }
    } catch (error) {
      return {
        success: false,
        operation: input.operation,
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
      };
    }
  }
}

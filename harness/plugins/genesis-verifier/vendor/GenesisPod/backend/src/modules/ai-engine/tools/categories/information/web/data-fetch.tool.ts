/**
 * Data Fetch Tool
 * 数据获取工具 - 从内部资源获取数据
 */

import { Injectable } from "@nestjs/common";
import { BaseTool } from "../../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../../abstractions/tool.interface";

import { PrismaService } from "@/common/prisma/prisma.service";

// ============================================================================
// Types
// ============================================================================

export interface DataFetchInput {
  /**
   * 数据源类型
   */
  sourceType: "resource" | "file" | "database";

  /**
   * 资源 ID（当 sourceType 为 resource 时）
   */
  resourceId?: string;

  /**
   * 资源 ID 列表（批量获取）
   */
  resourceIds?: string[];

  /**
   * 文件路径（当 sourceType 为 file 时）
   */
  filePath?: string;

  /**
   * 数据库查询（当 sourceType 为 database 时）
   */
  query?: {
    table: string;
    filters?: Record<string, unknown>;
    limit?: number;
  };

  /**
   * 是否包含内容
   */
  includeContent?: boolean;
}

export interface DataFetchOutput {
  /**
   * 获取的数据
   */
  data: unknown;

  /**
   * 数据类型
   */
  dataType: string;

  /**
   * 记录数量
   */
  count: number;

  /**
   * 是否成功
   */
  success: boolean;

  /**
   * 错误信息
   */
  error?: string;
}

// ============================================================================
// Tool Implementation
// ============================================================================

@Injectable()
export class DataFetchTool extends BaseTool<DataFetchInput, DataFetchOutput> {
  readonly id = "data-fetch";
  readonly sideEffect = "none" as const;
  readonly category: ToolCategory = "information";
  readonly tags = ["web", "api", "json", "data", "general"];
  readonly name = "数据获取";
  readonly description =
    "从内部数据源获取数据。支持获取资源库中的资源、文件内容或数据库记录。适用于需要访问已存储数据的场景。";

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      sourceType: {
        type: "string",
        description: "数据源类型",
        enum: ["resource", "file", "database"],
      },
      resourceId: {
        type: "string",
        description: "资源 ID（获取单个资源）",
      },
      resourceIds: {
        type: "array",
        description: "资源 ID 列表（批量获取）",
        items: { type: "string" },
      },
      filePath: {
        type: "string",
        description: "文件路径（获取文件内容）",
      },
      query: {
        type: "object",
        description: "数据库查询参数",
        properties: {
          table: { type: "string", description: "表名" },
          filters: { type: "object", description: "过滤条件" },
          limit: { type: "number", description: "限制数量" },
        },
      },
      includeContent: {
        type: "boolean",
        description: "是否包含完整内容",
        default: true,
      },
    },
    required: ["sourceType"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      data: {
        type: "object",
        description: "获取的数据",
      },
      dataType: {
        type: "string",
        description: "数据类型",
      },
      count: {
        type: "number",
        description: "记录数量",
      },
      success: {
        type: "boolean",
        description: "获取是否成功",
      },
      error: {
        type: "string",
        description: "错误信息（如果失败）",
      },
    },
  };

  constructor(private readonly prisma: PrismaService) {
    super();
    // defaultTimeout set in class property // 30 秒超时
  }

  validateInput(input: DataFetchInput) {
    if (!input.sourceType) {
      return false;
    }

    switch (input.sourceType) {
      case "resource":
        return !!(input.resourceId || input.resourceIds?.length);
      case "file":
        return !!input.filePath;
      case "database":
        return !!input.query?.table;
      default:
        return false;
    }
  }

  protected async doExecute(
    input: DataFetchInput,
    _context: ToolContext,
  ): Promise<DataFetchOutput> {
    const { sourceType, includeContent = true } = input;

    try {
      switch (sourceType) {
        case "resource":
          return await this.fetchResources(input, includeContent);
        case "file":
          return await this.fetchFile(input);
        case "database":
          return await this.fetchFromDatabase(input);
        default:
          return {
            data: null,
            dataType: "unknown",
            count: 0,
            success: false,
            error: `Unsupported source type: ${sourceType}`,
          };
      }
    } catch (error) {
      return {
        data: null,
        dataType: "unknown",
        count: 0,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * 获取资源数据
   */
  private async fetchResources(
    input: DataFetchInput,
    includeContent: boolean,
  ): Promise<DataFetchOutput> {
    const ids =
      input.resourceIds || (input.resourceId ? [input.resourceId] : []);

    if (ids.length === 0) {
      return {
        data: [],
        dataType: "resource",
        count: 0,
        success: true,
      };
    }

    const resources = await this.prisma.resource.findMany({
      where: {
        id: { in: ids },
      },
      select: {
        id: true,
        title: true,
        sourceType: true,
        sourceUrl: true,
        aiSummary: true,
        content: includeContent,
        metadata: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      data: resources.length === 1 ? resources[0] : resources,
      dataType: "resource",
      count: resources.length,
      success: true,
    };
  }

  /**
   * 获取文件内容
   */
  private async fetchFile(_input: DataFetchInput): Promise<DataFetchOutput> {
    // 文件获取暂时返回不支持
    return {
      data: null,
      dataType: "file",
      count: 0,
      success: false,
      error: "File fetch not implemented yet",
    };
  }

  /**
   * 从数据库获取数据
   */
  private async fetchFromDatabase(
    input: DataFetchInput,
  ): Promise<DataFetchOutput> {
    const { query } = input;
    if (!query) {
      return {
        data: null,
        dataType: "database",
        count: 0,
        success: false,
        error: "Query not provided",
      };
    }

    // 安全限制：只允许查询特定表
    const allowedTables = ["resource", "topic"];
    if (!allowedTables.includes(query.table.toLowerCase())) {
      return {
        data: null,
        dataType: "database",
        count: 0,
        success: false,
        error: `Table not allowed: ${query.table}`,
      };
    }

    const limit = Math.min(query.limit || 100, 1000);

    // 使用显式 switch-case 查询，避免动态字符串访问 Prisma 模型
    let data: unknown[];
    switch (query.table.toLowerCase()) {
      case "resource":
        data = await this.prisma.resource.findMany({
          where: query.filters || {},
          take: limit,
        });
        break;
      case "topic":
        data = await this.prisma.topic.findMany({
          where: query.filters || {},
          take: limit,
        });
        break;
      default:
        return {
          data: null,
          dataType: "database",
          count: 0,
          success: false,
          error: `Table '${query.table}' is not accessible`,
        };
    }

    return {
      data,
      dataType: "database",
      count: data.length,
      success: true,
    };
  }
}

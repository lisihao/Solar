/**
 * Database Query Tool
 * 数据库查询工具 - 执行只读 SQL 查询
 */

import { Injectable, Logger } from "@nestjs/common";
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

/**
 * 数据库查询输入参数
 */
export interface DatabaseQueryInput {
  /**
   * SQL 查询语句（仅支持 SELECT）
   */
  query: string;

  /**
   * 查询参数（用于参数化查询）
   */
  params?: Record<string, unknown>;

  /**
   * 最大返回行数，默认 100
   */
  limit?: number;

  /**
   * 查询超时时间（秒），默认 30
   */
  timeout?: number;
}

/**
 * 查询结果列定义
 */
export interface ColumnInfo {
  /**
   * 列名
   */
  name: string;

  /**
   * 数据类型
   */
  type: string;
}

/**
 * 数据库查询输出结果
 */
export interface DatabaseQueryOutput {
  /**
   * 查询是否成功
   */
  success: boolean;

  /**
   * 列信息
   */
  columns: ColumnInfo[];

  /**
   * 结果行数据
   */
  rows: Record<string, unknown>[];

  /**
   * 返回的行数
   */
  rowCount: number;

  /**
   * 执行的查询语句（已清理）
   */
  executedQuery: string;

  /**
   * 执行时间（毫秒）
   */
  executionTime?: number;
}

// ============================================================================
// Tool Implementation
// ============================================================================

/**
 * 数据库查询工具
 *
 * 功能：
 * - 执行只读 SQL 查询（仅支持 SELECT）
 * - 查询安全验证（防止 DROP、DELETE、UPDATE 等危险操作）
 * - 支持参数化查询
 * - 返回结构化结果（列信息 + 行数据）
 *
 * 使用场景：
 * - Agent 需要查询应用数据库中的数据
 * - 统计分析和报表生成
 * - 数据验证和检查
 *
 * 安全限制：
 * - 仅允许 SELECT 语句
 * - 不允许修改数据（INSERT、UPDATE、DELETE）
 * - 不允许修改结构（CREATE、DROP、ALTER）
 * - 限制返回行数
 * - 设置查询超时
 */
@Injectable()
export class DatabaseQueryTool extends BaseTool<
  DatabaseQueryInput,
  DatabaseQueryOutput
> {
  private readonly logger = new Logger(DatabaseQueryTool.name);
  readonly id = "database-query";
  readonly sideEffect = "none" as const;
  readonly category: ToolCategory = "information";
  readonly tags = ["knowledge", "database", "sql", "internal", "structured"];
  readonly name = "数据库查询";
  readonly description =
    "执行只读 SQL 查询，从数据库获取结构化数据。仅支持 SELECT 语句，不允许修改数据。适用于数据统计、报表生成、数据验证等场景。返回列信息和行数据。";

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "SQL 查询语句，仅支持 SELECT。例如：SELECT * FROM users WHERE created_at > $1 LIMIT 10",
      },
      params: {
        type: "object",
        description:
          "查询参数，用于参数化查询，防止 SQL 注入。键为参数名，值为参数值。",
      },
      limit: {
        type: "number",
        description: "最大返回行数，默认 100，最大 1000",
        default: 100,
      },
      timeout: {
        type: "number",
        description: "查询超时时间（秒），默认 30 秒",
        default: 30,
      },
    },
    required: ["query"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      success: {
        type: "boolean",
        description: "查询是否成功执行",
      },
      columns: {
        type: "array",
        description: "结果集的列信息",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "列名" },
            type: { type: "string", description: "数据类型" },
          },
        },
      },
      rows: {
        type: "array",
        description: "查询结果行数据",
        items: {
          type: "object",
          description: "每一行的数据，键为列名，值为对应的值",
        },
      },
      rowCount: {
        type: "number",
        description: "返回的行数",
      },
      executedQuery: {
        type: "string",
        description: "实际执行的查询语句",
      },
      executionTime: {
        type: "number",
        description: "查询执行时间（毫秒）",
      },
    },
  };

  // 危险的 SQL 关键字列表（不允许执行）
  private readonly DANGEROUS_KEYWORDS = [
    "INSERT",
    "UPDATE",
    "DELETE",
    "DROP",
    "CREATE",
    "ALTER",
    "TRUNCATE",
    "GRANT",
    "REVOKE",
    "EXEC",
    "EXECUTE",
    "CALL",
    "MERGE",
    "REPLACE",
  ];

  constructor(private readonly prisma: PrismaService) {
    super();
    // defaultTimeout set in class property // 30 秒超时
  }

  /**
   * 验证输入参数
   */
  validateInput(input: DatabaseQueryInput) {
    // 验证查询语句
    if (!input.query || typeof input.query !== "string") {
      this.logger.error("Invalid query: must be a non-empty string");
      return false;
    }

    const query = input.query.trim();

    if (query.length === 0) {
      this.logger.error("Invalid query: query is empty");
      return false;
    }

    if (query.length > 10000) {
      this.logger.error("Invalid query: query too long (max 10000 characters)");
      return false;
    }

    // 验证查询语句是否为 SELECT
    const normalizedQuery = query.toUpperCase();
    if (!normalizedQuery.startsWith("SELECT")) {
      this.logger.error("Invalid query: only SELECT statements are allowed");
      return false;
    }

    // 检查是否包含危险关键字
    for (const keyword of this.DANGEROUS_KEYWORDS) {
      const regex = new RegExp(`\\b${keyword}\\b`, "i");
      if (regex.test(query)) {
        this.logger.error(
          `Invalid query: dangerous keyword detected: ${keyword}`,
        );
        return false;
      }
    }

    // 验证 limit
    if (input.limit !== undefined) {
      if (
        typeof input.limit !== "number" ||
        input.limit < 1 ||
        input.limit > 1000
      ) {
        this.logger.error("Invalid limit: must be between 1 and 1000");
        return false;
      }
    }

    // 验证 timeout
    if (input.timeout !== undefined) {
      if (
        typeof input.timeout !== "number" ||
        input.timeout < 1 ||
        input.timeout > 300
      ) {
        this.logger.error("Invalid timeout: must be between 1 and 300 seconds");
        return false;
      }
    }

    return true;
  }

  /**
   * 执行数据库查询
   */
  protected async doExecute(
    input: DatabaseQueryInput,
    _context: ToolContext,
  ): Promise<DatabaseQueryOutput> {
    const { query, params = {}, limit = 100 } = input;

    this.logger.log(`Executing database query: ${query.substring(0, 100)}...`);

    const startTime = Date.now();

    try {
      // 清理查询语句
      let cleanedQuery = query.trim();

      // 如果查询中没有 LIMIT 子句，添加 LIMIT
      if (!/LIMIT\s+\d+/i.test(cleanedQuery)) {
        cleanedQuery = `${cleanedQuery} LIMIT ${limit}`;
      }

      // 将参数对象转换为数组（按照 $1, $2, ... 的顺序）
      const paramValues = this.extractParamValues(cleanedQuery, params);

      // 执行查询
      const rawResults = await this.prisma.$queryRawUnsafe<
        Record<string, unknown>[]
      >(cleanedQuery, ...paramValues);

      const executionTime = Date.now() - startTime;

      // 提取列信息
      const columns = this.extractColumns(rawResults);

      this.logger.log(
        `Query executed successfully: ${rawResults.length} rows returned in ${executionTime}ms`,
      );

      return {
        success: true,
        columns,
        rows: rawResults,
        rowCount: rawResults.length,
        executedQuery: cleanedQuery,
        executionTime,
      };
    } catch (error) {
      this.logger.error(
        `Database query failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new Error(
        `Query execution failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * 从参数对象中提取参数值数组
   * 支持 $1, $2, ... 风格的参数化查询
   */
  private extractParamValues(
    query: string,
    params: Record<string, unknown>,
  ): unknown[] {
    const paramValues: unknown[] = [];

    // 查找查询中的所有参数占位符 ($1, $2, ...)
    const paramPattern = /\$(\d+)/g;
    const matches = query.matchAll(paramPattern);

    const maxParamIndex = Array.from(matches).reduce((max, match) => {
      const index = parseInt(match[1], 10);
      return Math.max(max, index);
    }, 0);

    // 根据参数索引提取值
    for (let i = 1; i <= maxParamIndex; i++) {
      const paramKey = i.toString();
      if (params[paramKey] !== undefined) {
        paramValues.push(params[paramKey]);
      } else {
        // 如果参数缺失，使用 null
        paramValues.push(null);
      }
    }

    return paramValues;
  }

  /**
   * 从查询结果中提取列信息
   */
  private extractColumns(rows: Record<string, unknown>[]): ColumnInfo[] {
    if (rows.length === 0) {
      return [];
    }

    const firstRow = rows[0];
    const columns: ColumnInfo[] = [];

    for (const [key, value] of Object.entries(firstRow)) {
      columns.push({
        name: key,
        type: this.inferType(value),
      });
    }

    return columns;
  }

  /**
   * 推断值的数据类型
   */
  private inferType(value: unknown): string {
    if (value === null || value === undefined) {
      return "null";
    }

    if (typeof value === "string") {
      return "string";
    }

    if (typeof value === "number") {
      return Number.isInteger(value) ? "integer" : "number";
    }

    if (typeof value === "boolean") {
      return "boolean";
    }

    if (value instanceof Date) {
      return "datetime";
    }

    if (Array.isArray(value)) {
      return "array";
    }

    if (typeof value === "object") {
      return "object";
    }

    return "unknown";
  }
}

/**
 * SQL Executor Tool
 * SQL 查询执行工具 - 执行 SQL 查询并返回结构化结果
 */

import { Injectable, Logger } from "@nestjs/common";
import { BaseTool } from "../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../abstractions/tool.interface";

import { PrismaService } from "@/common/prisma/prisma.service";

// ============================================================================
// Types
// ============================================================================

export interface SQLExecutorInput {
  /**
   * SQL 查询语句
   */
  query: string;

  /**
   * 查询参数（用于参数化查询，防止 SQL 注入）
   */
  parameters?: Record<string, unknown>;

  /**
   * 执行选项
   */
  options?: {
    /**
     * 超时时间（毫秒），默认 30000
     */
    timeout?: number;

    /**
     * 最大返回行数，默认 1000
     */
    maxRows?: number;

    /**
     * 是否只读模式，默认 true（建议始终为 true）
     */
    readOnly?: boolean;
  };
}

export interface SQLExecutorOutput {
  /**
   * 是否执行成功
   */
  success: boolean;

  /**
   * 查询结果（SELECT）
   */
  rows?: Array<Record<string, unknown>>;

  /**
   * 影响的行数（INSERT/UPDATE/DELETE）
   */
  rowCount?: number;

  /**
   * 列信息
   */
  columns?: Array<{
    name: string;
    type: string;
  }>;

  /**
   * 错误信息（如果有）
   */
  error?: string;

  /**
   * 执行时间（毫秒）
   */
  executionTime: number;

  /**
   * 元数据
   */
  metadata?: {
    /**
     * 查询类型（SELECT, INSERT, UPDATE, DELETE 等）
     */
    queryType: string;

    /**
     * 是否被截断
     */
    truncated: boolean;
  };
}

// ============================================================================
// Tool Implementation
// ============================================================================

@Injectable()
export class SQLExecutorTool extends BaseTool<
  SQLExecutorInput,
  SQLExecutorOutput
> {
  private readonly logger = new Logger(SQLExecutorTool.name);

  readonly id = "sql-executor";
  readonly sideEffect = "destructive" as const;
  readonly category: ToolCategory = "execution";
  readonly tags = ["execution", "sql", "database", "query", "structured"];
  readonly name = "SQL 查询执行";
  readonly description =
    "执行 SQL 查询并返回结构化结果。支持参数化查询以防止 SQL 注入。默认只读模式，适用于数据查询和分析场景。";

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "SQL 查询语句。使用 :paramName 命名参数或 $1, $2 位置参数。",
      },
      parameters: {
        type: "object",
        description: "查询参数，键对应命名参数名称，值将被安全地传递给数据库",
      },
      options: {
        type: "object",
        description: "执行选项",
        properties: {
          timeout: {
            type: "number",
            description: "超时时间（毫秒），默认 30000",
            default: 30000,
          },
          maxRows: {
            type: "number",
            description: "最大返回行数，默认 1000",
            default: 1000,
          },
          readOnly: {
            type: "boolean",
            description: "是否只读模式，默认 true",
            default: true,
          },
        },
      },
    },
    required: ["query"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      success: {
        type: "boolean",
        description: "是否执行成功",
      },
      rows: {
        type: "array",
        description: "查询结果",
        items: {
          type: "object",
        },
      },
      rowCount: {
        type: "number",
        description: "影响的行数",
      },
      columns: {
        type: "array",
        description: "列信息",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            type: { type: "string" },
          },
        },
      },
      error: {
        type: "string",
        description: "错误信息",
      },
      executionTime: {
        type: "number",
        description: "执行时间（毫秒）",
      },
      metadata: {
        type: "object",
        description: "元数据",
        properties: {
          queryType: { type: "string" },
          truncated: { type: "boolean" },
        },
      },
    },
  };

  constructor(private readonly prisma: PrismaService) {
    super();
    // defaultTimeout set in class property // 60 秒超时
  }

  validateInput(input: SQLExecutorInput) {
    if (!input.query || typeof input.query !== "string") {
      return false;
    }

    const query = input.query.trim();
    if (query.length === 0) {
      return false;
    }

    // 检查是否为安全的 SQL 查询
    if (!this.isQuerySafe(query, input.options?.readOnly ?? true)) {
      this.logger.warn("Unsafe SQL query detected");
      return false;
    }

    return true;
  }

  protected async doExecute(
    input: SQLExecutorInput,
    _context: ToolContext,
  ): Promise<SQLExecutorOutput> {
    const { query, parameters, options } = input;
    const maxRows = options?.maxRows || 1000;
    const readOnly = options?.readOnly ?? true;

    this.logger.log(
      `Executing SQL query (readOnly: ${readOnly}, maxRows: ${maxRows})`,
    );

    const startTime = Date.now();

    try {
      // 检测查询类型
      const queryType = this.detectQueryType(query);

      // 如果是只读模式，只允许 SELECT 查询
      if (readOnly && queryType !== "SELECT") {
        throw new Error(
          `Read-only mode: only SELECT queries are allowed. Got: ${queryType}`,
        );
      }

      // 构建参数化查询
      const { sql, values } = this.buildParameterizedQuery(
        query,
        parameters || {},
      );

      // 执行查询
      const result = await this.executeQuery(sql, values, maxRows);
      const executionTime = Date.now() - startTime;

      this.logger.log(
        `SQL execution completed: success=true, rows=${result.rows?.length || 0}, time=${executionTime}ms`,
      );

      return {
        success: true,
        ...result,
        executionTime,
        metadata: {
          queryType,
          truncated: (result.rows?.length || 0) >= maxRows,
        },
      };
    } catch (error: unknown) {
      const executionTime = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(`SQL execution failed: ${errorMessage}`);

      return {
        success: false,
        error: errorMessage,
        executionTime,
        metadata: {
          queryType: this.detectQueryType(query),
          truncated: false,
        },
      };
    }
  }

  /**
   * 执行 SQL 查询
   */
  private async executeQuery(
    query: string,
    values: unknown[],
    maxRows: number,
  ): Promise<Partial<SQLExecutorOutput>> {
    try {
      // 使用 Prisma 的 $queryRawUnsafe 执行参数化 SQL
      // 参数值作为独立参数传递，确保不会被解释为 SQL 代码
      const result = await this.prisma.$queryRawUnsafe(query, ...values);
      const rows: Array<Record<string, unknown>> = Array.isArray(result)
        ? result
        : [];

      // 限制返回行数
      const limitedRows = rows.slice(0, maxRows);

      // 提取列信息（从第一行）
      const columns =
        limitedRows.length > 0
          ? Object.keys(limitedRows[0]).map((name) => ({
              name,
              type: typeof limitedRows[0][name],
            }))
          : [];

      return {
        rows: limitedRows,
        rowCount: rows.length,
        columns,
      };
    } catch (error: unknown) {
      throw error;
    }
  }

  /**
   * 检测查询类型
   */
  private detectQueryType(query: string): string {
    const trimmedQuery = query.trim().toUpperCase();

    if (trimmedQuery.startsWith("SELECT")) return "SELECT";
    if (trimmedQuery.startsWith("INSERT")) return "INSERT";
    if (trimmedQuery.startsWith("UPDATE")) return "UPDATE";
    if (trimmedQuery.startsWith("DELETE")) return "DELETE";
    if (trimmedQuery.startsWith("CREATE")) return "CREATE";
    if (trimmedQuery.startsWith("ALTER")) return "ALTER";
    if (trimmedQuery.startsWith("DROP")) return "DROP";
    if (trimmedQuery.startsWith("TRUNCATE")) return "TRUNCATE";

    return "UNKNOWN";
  }

  /**
   * 移除 SQL 注释，防止通过注释绕过安全检查
   */
  private stripSQLComments(query: string): string {
    // Remove single-line comments (-- ...)
    let result = query.replace(/--[^\n]*/g, "");
    // Remove multi-line comments (/* ... */)
    result = result.replace(/\/\*[\s\S]*?\*\//g, "");
    return result.trim();
  }

  /**
   * 检查 SQL 查询是否安全
   */
  private isQuerySafe(query: string, readOnly: boolean): boolean {
    // Strip SQL comments before analysis to prevent comment-based bypass
    const strippedQuery = this.stripSQLComments(query);
    const upperQuery = strippedQuery.toUpperCase();

    // 只读模式：只允许 SELECT 和 WITH (CTE)
    if (readOnly) {
      const allowedKeywords = ["SELECT", "WITH"];
      const startsWithAllowed = allowedKeywords.some((keyword) =>
        upperQuery.trim().startsWith(keyword),
      );

      if (!startsWithAllowed) {
        this.logger.warn(
          `Read-only mode violation: query does not start with SELECT or WITH`,
        );
        return false;
      }
    }

    // 危险关键字检查（适用于所有模式）
    const dangerousKeywords = [
      "DROP DATABASE",
      "DROP SCHEMA",
      "DROP TABLE",
      "TRUNCATE",
      "GRANT",
      "REVOKE",
      "SHUTDOWN",
      "EXEC",
      "EXECUTE",
      "xp_",
      "sp_",
      "ALTER ROLE",
      "CREATE ROLE",
      "COPY ",
      "\\\\COPY",
    ];

    for (const keyword of dangerousKeywords) {
      if (upperQuery.includes(keyword)) {
        this.logger.warn(`Dangerous keyword detected: ${keyword}`);
        return false;
      }
    }

    // 检查是否包含多个语句（在去除注释后检测分号）
    const semicolonCount = (strippedQuery.match(/;/g) || []).length;
    if (semicolonCount > 1) {
      this.logger.warn("Multiple statements detected");
      return false;
    }

    return true;
  }

  /**
   * 构建参数化查询
   * 将命名参数 (:paramName) 转换为 PostgreSQL 位置参数 ($1, $2, ...)
   * 并返回对应的值数组
   */
  private buildParameterizedQuery(
    query: string,
    parameters: Record<string, unknown>,
  ): { sql: string; values: unknown[] } {
    const values: unknown[] = [];
    let sql = query;

    // 处理命名参数 :paramName
    const namedParamRegex = /:(\w+)\b/g;
    const matches = [...query.matchAll(namedParamRegex)];

    // 使用 Map 追踪唯一参数名 → 位置索引，避免重复参数
    const paramIndexMap = new Map<string, number>();

    matches.forEach((match) => {
      const paramName = match[1];
      if (paramName in parameters) {
        if (!paramIndexMap.has(paramName)) {
          values.push(parameters[paramName]);
          paramIndexMap.set(paramName, values.length);
        }
      }
    });

    // 使用全局正则替换所有出现的命名参数
    for (const [paramName, index] of paramIndexMap.entries()) {
      const paramRegex = new RegExp(`:${paramName}\\b`, "g");
      sql = sql.replace(paramRegex, `$${index}`);
    }

    // 如果查询已经包含位置参数 $1, $2，且没有提供命名参数
    // 则直接使用 parameters 对象的值（按键的数字顺序）
    if (values.length === 0 && sql.includes("$")) {
      const positionalRegex = /\$(\d+)\b/g;
      const positionalMatches = [...sql.matchAll(positionalRegex)];
      const maxIndex = Math.max(
        ...positionalMatches.map((m) => parseInt(m[1], 10)),
        0,
      );

      // 按位置索引收集参数值
      for (let i = 1; i <= maxIndex; i++) {
        const key = String(i);
        if (key in parameters) {
          values.push(parameters[key]);
        } else {
          // 如果没有对应的位置参数，尝试从 Object.values 获取
          const paramValues = Object.values(parameters);
          if (i - 1 < paramValues.length) {
            values.push(paramValues[i - 1]);
          }
        }
      }
    }

    return { sql, values };
  }
}

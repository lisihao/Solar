/**
 * Data Cleaning Tool
 * 数据清洗工具 - 去重、处理缺失值、标准化格式
 */

import { Injectable, Logger } from "@nestjs/common";
import { BaseTool } from "../../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../../abstractions/tool.interface";

// ============================================================================
// Types
// ============================================================================

export interface CleaningRule {
  /**
   * 规则类型
   */
  type:
    | "remove_duplicates"
    | "handle_missing"
    | "normalize"
    | "trim"
    | "replace"
    | "transform";

  /**
   * 应用字段（可选，不指定则应用到所有字段）
   */
  field?: string;

  /**
   * 规则参数
   */
  params?: {
    /**
     * 缺失值处理策略
     */
    strategy?: "drop" | "fill" | "interpolate" | "default";

    /**
     * 填充值（strategy = fill）
     */
    fillValue?: unknown;

    /**
     * 默认值（strategy = default）
     */
    defaultValue?: unknown;

    /**
     * 标准化格式（normalize）
     */
    format?: "lowercase" | "uppercase" | "titlecase" | "date" | "number";

    /**
     * 替换规则（replace）
     */
    from?: string | RegExp;
    to?: string;

    /**
     * 转换函数名称（transform）
     */
    transformer?: "email" | "phone" | "url" | "slug";
  };
}

export interface DataCleaningInput {
  /**
   * 待清洗的数据
   */
  data: unknown;

  /**
   * 清洗规则
   */
  cleaningRules: CleaningRule[];

  /**
   * 输出格式
   */
  outputFormat?: "json" | "csv" | "array";
}

export interface CleaningStatistics {
  /**
   * 原始记录数
   */
  originalCount: number;

  /**
   * 清洗后记录数
   */
  cleanedCount: number;

  /**
   * 删除的重复项数
   */
  duplicatesRemoved: number;

  /**
   * 处理的缺失值数
   */
  missingValuesHandled: number;

  /**
   * 标准化的字段数
   */
  fieldsNormalized: number;
}

export interface DataCleaningOutput {
  /**
   * 清洗后的数据
   */
  data: unknown;

  /**
   * 清洗统计
   */
  statistics: CleaningStatistics;

  /**
   * 应用的规则数量
   */
  rulesApplied: number;
}

// ============================================================================
// Tool Implementation
// ============================================================================

@Injectable()
export class DataCleaningTool extends BaseTool<
  DataCleaningInput,
  DataCleaningOutput
> {
  private readonly logger = new Logger(DataCleaningTool.name);

  readonly id = "data-cleaning";
  readonly sideEffect = "none" as const;
  readonly category: ToolCategory = "processing";
  readonly tags = ["processing", "data", "cleaning", "etl", "preprocessing"];
  readonly name = "数据清洗";
  readonly description =
    "清洗和预处理数据。支持去除重复项、处理缺失值（填充/删除/插值）、标准化格式、数据转换等操作。适用于数据预处理、ETL 流程、数据质量改善等场景。";

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      data: {
        type: "object",
        description: "待清洗的数据（支持对象、数组、嵌套结构）",
      },
      cleaningRules: {
        type: "array",
        description: "清洗规则列表",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              description: "规则类型",
              enum: [
                "remove_duplicates",
                "handle_missing",
                "normalize",
                "trim",
                "replace",
                "transform",
              ],
            },
            field: {
              type: "string",
              description: "应用字段（可选）",
            },
            params: {
              type: "object",
              description: "规则参数",
            },
          },
        },
      },
      outputFormat: {
        type: "string",
        description: "输出格式",
        enum: ["json", "csv", "array"],
        default: "json",
      },
    },
    required: ["data", "cleaningRules"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      data: {
        type: "object",
        description: "清洗后的数据",
      },
      statistics: {
        type: "object",
        description: "清洗统计",
        properties: {
          originalCount: { type: "number", description: "原始记录数" },
          cleanedCount: { type: "number", description: "清洗后记录数" },
          duplicatesRemoved: { type: "number", description: "删除的重复项数" },
          missingValuesHandled: {
            type: "number",
            description: "处理的缺失值数",
          },
          fieldsNormalized: { type: "number", description: "标准化的字段数" },
        },
      },
      rulesApplied: {
        type: "number",
        description: "应用的规则数量",
      },
    },
  };

  constructor() {
    super();
    // defaultTimeout set in class property // 60 秒超时
  }

  validateInput(input: DataCleaningInput) {
    if (
      !input.data ||
      !input.cleaningRules ||
      input.cleaningRules.length === 0
    ) {
      return false;
    }

    return true;
  }

  protected async doExecute(
    input: DataCleaningInput,
    _context: ToolContext,
  ): Promise<DataCleaningOutput> {
    const { data, cleaningRules, outputFormat = "json" } = input;

    this.logger.log(
      `[doExecute] Cleaning data with ${cleaningRules.length} rules...`,
    );

    let cleanedData = JSON.parse(JSON.stringify(data)); // Deep clone
    const statistics: CleaningStatistics = {
      originalCount: this.countRecords(data),
      cleanedCount: 0,
      duplicatesRemoved: 0,
      missingValuesHandled: 0,
      fieldsNormalized: 0,
    };

    try {
      // 应用清洗规则
      for (const rule of cleaningRules) {
        cleanedData = await this.applyCleaningRule(
          cleanedData,
          rule,
          statistics,
        );
      }

      // 更新最终统计
      statistics.cleanedCount = this.countRecords(cleanedData);

      // 格式化输出
      if (outputFormat === "csv") {
        cleanedData = this.convertToCSV(cleanedData);
      } else if (outputFormat === "array") {
        cleanedData = this.convertToArray(cleanedData);
      }

      const result: DataCleaningOutput = {
        data: cleanedData,
        statistics,
        rulesApplied: cleaningRules.length,
      };

      this.logger.log(
        `[doExecute] Cleaning complete. Original: ${statistics.originalCount}, Cleaned: ${statistics.cleanedCount}`,
      );

      return result;
    } catch (error) {
      this.logger.error(
        `[doExecute] Cleaning failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  // ==========================================================================
  // Cleaning Rules
  // ==========================================================================

  private async applyCleaningRule(
    data: unknown,
    rule: CleaningRule,
    statistics: CleaningStatistics,
  ): Promise<unknown> {
    switch (rule.type) {
      case "remove_duplicates":
        return this.removeDuplicates(data, rule, statistics);

      case "handle_missing":
        return this.handleMissing(data, rule, statistics);

      case "normalize":
        return this.normalize(data, rule, statistics);

      case "trim":
        return this.trimWhitespace(data, rule, statistics);

      case "replace":
        return this.replace(data, rule, statistics);

      case "transform":
        return this.transform(data, rule, statistics);

      default:
        this.logger.warn(`[applyCleaningRule] Unknown rule type: ${rule.type}`);
        return data;
    }
  }

  // ==========================================================================
  // Remove Duplicates
  // ==========================================================================

  private removeDuplicates(
    data: unknown,
    rule: CleaningRule,
    statistics: CleaningStatistics,
  ): unknown {
    if (Array.isArray(data)) {
      const originalLength = data.length;
      const seen = new Set<string>();
      const unique = data.filter((item) => {
        const key = rule.field
          ? JSON.stringify(this.getFieldValue(item, rule.field))
          : JSON.stringify(item);

        if (seen.has(key)) {
          return false;
        }

        seen.add(key);
        return true;
      });

      statistics.duplicatesRemoved += originalLength - unique.length;
      return unique;
    }

    return data;
  }

  // ==========================================================================
  // Handle Missing Values
  // ==========================================================================

  private handleMissing(
    data: unknown,
    rule: CleaningRule,
    statistics: CleaningStatistics,
  ): unknown {
    const strategy = rule.params?.strategy || "drop";

    if (Array.isArray(data)) {
      return data
        .map((item) =>
          this.handleMissingInObject(item, rule, statistics, strategy),
        )
        .filter((item) => item !== null);
    } else if (typeof data === "object" && data !== null) {
      return this.handleMissingInObject(data, rule, statistics, strategy);
    }

    return data;
  }

  private handleMissingInObject(
    obj: unknown,
    rule: CleaningRule,
    statistics: CleaningStatistics,
    strategy: string,
  ): unknown {
    if (!obj || typeof obj !== "object") return obj;

    const result = { ...(obj as Record<string, unknown>) };

    for (const key in result) {
      const value = result[key];
      const isMissing = value === null || value === undefined || value === "";

      if (rule.field && key !== rule.field) {
        continue;
      }

      if (isMissing) {
        statistics.missingValuesHandled++;

        switch (strategy) {
          case "drop":
            return null; // Mark for removal

          case "fill":
            result[key] = rule.params?.fillValue ?? "";
            break;

          case "default":
            result[key] = rule.params?.defaultValue ?? null;
            break;

          case "interpolate":
            // Simple interpolation: use empty string for now
            result[key] = "";
            break;
        }
      }
    }

    return result;
  }

  // ==========================================================================
  // Normalize
  // ==========================================================================

  private normalize(
    data: unknown,
    rule: CleaningRule,
    statistics: CleaningStatistics,
  ): unknown {
    const format = rule.params?.format;

    if (Array.isArray(data)) {
      return data.map((item) =>
        this.normalizeItem(item, rule, format, statistics),
      );
    } else if (typeof data === "object" && data !== null) {
      return this.normalizeItem(data, rule, format, statistics);
    }

    return data;
  }

  private normalizeItem(
    item: unknown,
    rule: CleaningRule,
    format: string | undefined,
    statistics: CleaningStatistics,
  ): unknown {
    if (!item || typeof item !== "object") return item;

    const result = { ...(item as Record<string, unknown>) };

    for (const key in result) {
      if (rule.field && key !== rule.field) {
        continue;
      }

      const value = result[key];

      if (typeof value === "string") {
        statistics.fieldsNormalized++;

        switch (format) {
          case "lowercase":
            result[key] = value.toLowerCase();
            break;

          case "uppercase":
            result[key] = value.toUpperCase();
            break;

          case "titlecase":
            result[key] = value.replace(/\w\S*/g, (txt) => {
              return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
            });
            break;

          case "date":
            const date = new Date(value);
            if (!isNaN(date.getTime())) {
              result[key] = date.toISOString();
            }
            break;

          case "number":
            const num = parseFloat(value);
            if (!isNaN(num)) {
              result[key] = num;
            }
            break;
        }
      }
    }

    return result;
  }

  // ==========================================================================
  // Trim Whitespace
  // ==========================================================================

  private trimWhitespace(
    data: unknown,
    rule: CleaningRule,
    statistics: CleaningStatistics,
  ): unknown {
    if (Array.isArray(data)) {
      return data.map((item) => this.trimItem(item, rule, statistics));
    } else if (typeof data === "object" && data !== null) {
      return this.trimItem(data, rule, statistics);
    }

    return data;
  }

  private trimItem(
    item: unknown,
    rule: CleaningRule,
    statistics: CleaningStatistics,
  ): unknown {
    if (!item || typeof item !== "object") return item;

    const result = { ...(item as Record<string, unknown>) };

    for (const key in result) {
      if (rule.field && key !== rule.field) {
        continue;
      }

      if (typeof result[key] === "string") {
        result[key] = result[key].trim();
        statistics.fieldsNormalized++;
      }
    }

    return result;
  }

  // ==========================================================================
  // Replace
  // ==========================================================================

  private replace(
    data: unknown,
    rule: CleaningRule,
    statistics: CleaningStatistics,
  ): unknown {
    if (Array.isArray(data)) {
      return data.map((item) => this.replaceItem(item, rule, statistics));
    } else if (typeof data === "object" && data !== null) {
      return this.replaceItem(data, rule, statistics);
    }

    return data;
  }

  private replaceItem(
    item: unknown,
    rule: CleaningRule,
    statistics: CleaningStatistics,
  ): unknown {
    if (!item || typeof item !== "object") return item;

    const result = { ...(item as Record<string, unknown>) };
    const from = rule.params?.from;
    const to = rule.params?.to ?? "";

    if (!from) return result;

    for (const key in result) {
      if (rule.field && key !== rule.field) {
        continue;
      }

      if (typeof result[key] === "string") {
        if (typeof from === "string") {
          result[key] = result[key].replace(new RegExp(from, "g"), to);
        } else {
          result[key] = result[key].replace(from, to);
        }
        statistics.fieldsNormalized++;
      }
    }

    return result;
  }

  // ==========================================================================
  // Transform
  // ==========================================================================

  private transform(
    data: unknown,
    rule: CleaningRule,
    statistics: CleaningStatistics,
  ): unknown {
    if (Array.isArray(data)) {
      return data.map((item) => this.transformItem(item, rule, statistics));
    } else if (typeof data === "object" && data !== null) {
      return this.transformItem(data, rule, statistics);
    }

    return data;
  }

  private transformItem(
    item: unknown,
    rule: CleaningRule,
    statistics: CleaningStatistics,
  ): unknown {
    if (!item || typeof item !== "object") return item;

    const result = { ...(item as Record<string, unknown>) };
    const transformer = rule.params?.transformer;

    for (const key in result) {
      if (rule.field && key !== rule.field) {
        continue;
      }

      const value = result[key];

      if (typeof value === "string") {
        statistics.fieldsNormalized++;

        switch (transformer) {
          case "email":
            result[key] = value.toLowerCase().trim();
            break;

          case "phone":
            result[key] = value.replace(/\D/g, "");
            break;

          case "url":
            try {
              const url = new URL(value);
              result[key] = url.href;
            } catch {
              // Keep original if invalid URL
            }
            break;

          case "slug":
            result[key] = value
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-|-$/g, "");
            break;
        }
      }
    }

    return result;
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  private getFieldValue(obj: unknown, field: string): unknown {
    const keys = field.split(".");
    let current: unknown = obj;

    for (const key of keys) {
      if (current === null || current === undefined) {
        return undefined;
      }
      if (typeof current === "object" && current !== null) {
        current = (current as Record<string, unknown>)[key];
      } else {
        return undefined;
      }
    }

    return current;
  }

  private countRecords(data: unknown): number {
    if (Array.isArray(data)) {
      return data.length;
    } else if (typeof data === "object" && data !== null) {
      return 1;
    }
    return 0;
  }

  private convertToCSV(data: unknown): string {
    if (!Array.isArray(data) || data.length === 0) {
      return "";
    }

    const firstItem = data[0];
    if (!firstItem || typeof firstItem !== "object") {
      return "";
    }

    const headers = Object.keys(firstItem);
    const rows = data.map((item) => {
      if (!item || typeof item !== "object") return "";
      const record = item as Record<string, unknown>;
      return headers
        .map((h) => {
          const val = record[h];
          return val !== null && val !== undefined ? String(val) : "";
        })
        .join(",");
    });

    return [headers.join(","), ...rows].join("\n");
  }

  private convertToArray(data: unknown): unknown[] {
    if (Array.isArray(data)) {
      return data;
    } else if (typeof data === "object" && data !== null) {
      return [data];
    }
    return [];
  }
}

/**
 * Data Validation Tool
 * 数据验证工具 - 支持 JSON Schema 验证和自定义验证规则
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

export interface ValidationRule {
  /**
   * 规则类型
   */
  type: "required" | "format" | "range" | "custom";

  /**
   * 字段路径
   */
  field: string;

  /**
   * 规则参数
   */
  params?: {
    /**
     * 格式类型（email, url, date, phone 等）
     */
    format?: string;

    /**
     * 最小值
     */
    min?: number;

    /**
     * 最大值
     */
    max?: number;

    /**
     * 正则表达式
     */
    pattern?: string;

    /**
     * 自定义错误消息
     */
    message?: string;
  };
}

export interface DataValidationInput {
  /**
   * 待验证的数据
   */
  data: unknown;

  /**
   * JSON Schema（可选）
   */
  schema?: JSONSchema;

  /**
   * 自定义验证规则（可选）
   */
  rules?: ValidationRule[];

  /**
   * 严格模式
   */
  strict?: boolean;
}

export interface ValidationError {
  /**
   * 字段路径
   */
  field: string;

  /**
   * 错误消息
   */
  message: string;

  /**
   * 错误类型
   */
  type: "error" | "warning";

  /**
   * 实际值
   */
  value?: unknown;
}

export interface DataValidationOutput {
  /**
   * 验证是否通过
   */
  valid: boolean;

  /**
   * 错误列表
   */
  errors: ValidationError[];

  /**
   * 警告列表
   */
  warnings: ValidationError[];

  /**
   * 验证摘要
   */
  summary: {
    /**
     * 总字段数
     */
    totalFields: number;

    /**
     * 错误数
     */
    errorCount: number;

    /**
     * 警告数
     */
    warningCount: number;
  };
}

// ============================================================================
// Tool Implementation
// ============================================================================

@Injectable()
export class DataValidationTool extends BaseTool<
  DataValidationInput,
  DataValidationOutput
> {
  private readonly logger = new Logger(DataValidationTool.name);

  readonly id = "data-validation";
  readonly sideEffect = "none" as const;
  readonly category: ToolCategory = "processing";
  readonly tags = ["processing", "data", "validation", "schema", "check"];
  readonly name = "数据验证";
  readonly description =
    "验证数据的合法性和完整性。支持 JSON Schema 标准验证、自定义验证规则、格式校验等。适用于数据质量检查、表单验证、API 响应验证等场景。";

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      data: {
        type: "object",
        description: "待验证的数据",
      },
      schema: {
        type: "object",
        description: "JSON Schema 定义（可选）",
      },
      rules: {
        type: "array",
        description: "自定义验证规则（可选）",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              description: "规则类型",
              enum: ["required", "format", "range", "custom"],
            },
            field: {
              type: "string",
              description: "字段路径（支持点分隔符）",
            },
            params: {
              type: "object",
              description: "规则参数",
            },
          },
        },
      },
      strict: {
        type: "boolean",
        description: "严格模式（不允许额外字段）",
        default: false,
      },
    },
    required: ["data"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      valid: {
        type: "boolean",
        description: "验证是否通过",
      },
      errors: {
        type: "array",
        description: "错误列表",
        items: {
          type: "object",
          properties: {
            field: { type: "string", description: "字段路径" },
            message: { type: "string", description: "错误消息" },
            type: { type: "string", description: "错误类型" },
            value: { type: "string", description: "实际值" },
          },
        },
      },
      warnings: {
        type: "array",
        description: "警告列表",
      },
      summary: {
        type: "object",
        description: "验证摘要",
        properties: {
          totalFields: { type: "number", description: "总字段数" },
          errorCount: { type: "number", description: "错误数" },
          warningCount: { type: "number", description: "警告数" },
        },
      },
    },
  };

  constructor() {
    super();
    // defaultTimeout set in class property // 30 秒超时
  }

  validateInput(input: DataValidationInput) {
    if (!input.data) {
      return false;
    }

    // 至少需要 schema 或 rules 之一
    if (!input.schema && (!input.rules || input.rules.length === 0)) {
      return false;
    }

    return true;
  }

  protected async doExecute(
    input: DataValidationInput,
    _context: ToolContext,
  ): Promise<DataValidationOutput> {
    const { data, schema, rules = [], strict = false } = input;

    this.logger.log(`[doExecute] Validating data...`);

    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    try {
      // 1. JSON Schema 验证
      if (schema) {
        const schemaErrors = await this.validateAgainstSchema(
          data,
          schema,
          strict,
        );
        errors.push(...schemaErrors);
      }

      // 2. 自定义规则验证
      if (rules.length > 0) {
        const ruleErrors = await this.validateAgainstRules(data, rules);
        errors.push(...ruleErrors.errors);
        warnings.push(...ruleErrors.warnings);
      }

      // 3. 计算总字段数
      const totalFields = this.countFields(data);

      const result: DataValidationOutput = {
        valid: errors.length === 0,
        errors,
        warnings,
        summary: {
          totalFields,
          errorCount: errors.length,
          warningCount: warnings.length,
        },
      };

      this.logger.log(
        `[doExecute] Validation complete. Valid: ${result.valid}, Errors: ${errors.length}, Warnings: ${warnings.length}`,
      );

      return result;
    } catch (error) {
      this.logger.error(
        `[doExecute] Validation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  // ==========================================================================
  // JSON Schema Validation
  // ==========================================================================

  private async validateAgainstSchema(
    data: unknown,
    schema: JSONSchema,
    strict: boolean,
  ): Promise<ValidationError[]> {
    const Ajv = await import("ajv");
    const addFormats = await import("ajv-formats");

    const ajvOptions: {
      allErrors: boolean;
      strict?: boolean;
    } = {
      allErrors: true,
    };
    if (strict) {
      ajvOptions.strict = true;
    }
    const ajv = new Ajv.default(ajvOptions);

    addFormats.default(
      ajv as unknown as Parameters<typeof addFormats.default>[0],
    );

    const validate = ajv.compile(schema);
    const valid = validate(data);

    if (valid) {
      return [];
    }

    const errors: ValidationError[] = [];

    if (validate.errors) {
      for (const error of validate.errors) {
        const errorRecord = error as unknown as Record<string, unknown>;
        errors.push({
          field:
            (errorRecord.instancePath as string) ||
            (errorRecord.dataPath as string) ||
            "root",
          message: error.message || "Validation failed",
          type: "error",
          value: errorRecord.data,
        });
      }
    }

    return errors;
  }

  // ==========================================================================
  // Custom Rules Validation
  // ==========================================================================

  private async validateAgainstRules(
    data: unknown,
    rules: ValidationRule[],
  ): Promise<{ errors: ValidationError[]; warnings: ValidationError[] }> {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    for (const rule of rules) {
      const value = this.getNestedValue(data, rule.field);

      switch (rule.type) {
        case "required": {
          if (value === undefined || value === null || value === "") {
            errors.push({
              field: rule.field,
              message:
                rule.params?.message || `Field '${rule.field}' is required`,
              type: "error",
              value,
            });
          }
          break;
        }

        case "format": {
          if (value && !this.validateFormat(value, rule.params?.format)) {
            errors.push({
              field: rule.field,
              message:
                rule.params?.message ||
                `Field '${rule.field}' has invalid format`,
              type: "error",
              value,
            });
          }
          break;
        }

        case "range": {
          if (typeof value === "number") {
            const min = rule.params?.min;
            const max = rule.params?.max;

            if (min !== undefined && value < min) {
              errors.push({
                field: rule.field,
                message:
                  rule.params?.message ||
                  `Field '${rule.field}' must be >= ${min}`,
                type: "error",
                value,
              });
            }

            if (max !== undefined && value > max) {
              errors.push({
                field: rule.field,
                message:
                  rule.params?.message ||
                  `Field '${rule.field}' must be <= ${max}`,
                type: "error",
                value,
              });
            }
          }
          break;
        }

        case "custom": {
          if (rule.params?.pattern) {
            const pattern = new RegExp(rule.params.pattern);
            if (value && !pattern.test(String(value))) {
              errors.push({
                field: rule.field,
                message:
                  rule.params?.message ||
                  `Field '${rule.field}' does not match pattern`,
                type: "error",
                value,
              });
            }
          }
          break;
        }
      }
    }

    return { errors, warnings };
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * 获取嵌套对象的值
   */
  private getNestedValue(obj: unknown, path: string): unknown {
    const keys = path.split(".");
    let current: unknown = obj;

    for (const key of keys) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[key];
    }

    return current;
  }

  /**
   * 验证格式
   */
  private validateFormat(value: unknown, format?: string): boolean {
    if (!format) return true;

    const str = String(value);

    switch (format) {
      case "email":
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);

      case "url":
        try {
          new URL(str);
          return true;
        } catch {
          return false;
        }

      case "date":
        return !isNaN(Date.parse(str));

      case "phone":
        return (
          /^[\d\s\-+()]+$/.test(str) && str.replace(/\D/g, "").length >= 10
        );

      case "uuid":
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          str,
        );

      default:
        return true;
    }
  }

  /**
   * 计算对象中的字段总数
   */
  private countFields(obj: unknown, visited = new WeakSet()): number {
    if (obj === null || obj === undefined) {
      return 0;
    }

    if (typeof obj !== "object") {
      return 1;
    }

    // 防止循环引用
    if (visited.has(obj)) {
      return 0;
    }

    visited.add(obj);

    if (Array.isArray(obj)) {
      return obj.reduce(
        (sum, item) => sum + this.countFields(item, visited),
        0,
      );
    }

    let count = 0;
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        count +=
          1 + this.countFields((obj as Record<string, unknown>)[key], visited);
      }
    }

    return count;
  }
}

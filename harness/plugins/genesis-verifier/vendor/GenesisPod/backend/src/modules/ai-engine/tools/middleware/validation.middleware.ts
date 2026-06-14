/**
 * AI Engine - Validation Middleware
 * 验证中间件
 */

import { Logger } from "@nestjs/common";
import { z } from "zod";
import { ValidationError } from "@/modules/ai-engine/facade/abstractions/engine.error";
import {
  ITool,
  ToolContext,
  ToolResult,
  JSONSchema,
} from "../abstractions/tool.interface";
import { ValidationResult } from "@/modules/ai-engine/facade/index";
import { IToolMiddleware } from "./middleware.interface";

/**
 * Output validation 三档 mode（2026-05-01）：
 * - strict (默认): schema 不一致直接 throw ValidationError
 * - lenient: 仅 warn，返回原始 result（兼容旧行为）
 * - coerce: 尝试补 optional 字段默认值；required 缺失则 fallthrough strict
 *
 * env 解析：
 * - STRICT_OUTPUT_VALIDATION_MODE=lenient|strict|coerce 优先
 * - STRICT_OUTPUT_VALIDATION=0 兼容映射到 lenient（生产逃生阀）
 * - 默认 strict
 */
type ValidationMode = "lenient" | "strict" | "coerce";

function getValidationMode(): ValidationMode {
  const m = process.env.STRICT_OUTPUT_VALIDATION_MODE?.toLowerCase();
  if (m === "lenient" || m === "coerce" || m === "strict") return m;
  if (process.env.STRICT_OUTPUT_VALIDATION === "0") return "lenient";
  return "strict";
}

/**
 * 验证中间件配置
 */
export interface ValidationMiddlewareConfig {
  /**
   * 是否启用输入验证
   */
  validateInput?: boolean;

  /**
   * 是否启用输出验证
   */
  validateOutput?: boolean;

  /**
   * 是否允许额外属性
   */
  allowAdditionalProperties?: boolean;

  /**
   * 自定义验证器
   */
  customValidator?: (input: unknown, schema: JSONSchema) => ValidationResult;
}

/**
 * 验证中间件
 * 在工具执行前验证输入，执行后验证输出
 */
export class ValidationMiddleware implements IToolMiddleware {
  readonly name = "validation";
  readonly priority = 10; // 高优先级，最先执行

  constructor(private readonly config: ValidationMiddlewareConfig = {}) {
    this.config = {
      validateInput: true,
      // Default strict; STRICT_OUTPUT_VALIDATION=0 disables (production escape hatch)
      validateOutput: process.env.STRICT_OUTPUT_VALIDATION !== "0",
      allowAdditionalProperties: true,
      ...config,
    };
  }

  async before(
    input: unknown,
    _context: ToolContext,
    tool: ITool,
  ): Promise<void> {
    if (!this.config.validateInput) {
      return;
    }

    // 使用工具自带的验证方法
    if (tool.validateInput) {
      const result = tool.validateInput(input);
      // 支持返回 boolean 或 ValidationResult
      const isValid = typeof result === "boolean" ? result : result.valid;
      if (!isValid) {
        const errors =
          typeof result === "boolean"
            ? [{ path: "", message: "Validation failed", type: "unknown" }]
            : result.errors?.map(
                (e: { path: string; message: string; type: string }) => ({
                  path: e.path,
                  message: e.message,
                  type: e.type,
                }),
              ) || [
                { path: "", message: "Validation failed", type: "unknown" },
              ];
        throw new ValidationError(
          errors,
          `Input validation failed for tool '${tool.id}'`,
        );
      }
    }

    // 使用 Schema 验证
    const schemaResult = this.validateAgainstSchema(input, tool.inputSchema);
    if (!schemaResult.valid) {
      throw new ValidationError(
        schemaResult.errors || [],
        `Schema validation failed for tool '${tool.id}'`,
      );
    }

    // 自定义验证器
    if (this.config.customValidator) {
      const customResult = this.config.customValidator(input, tool.inputSchema);
      if (!customResult.valid) {
        throw new ValidationError(
          customResult.errors || [],
          `Custom validation failed for tool '${tool.id}'`,
        );
      }
    }
  }

  async after(
    result: ToolResult,
    _context: ToolContext,
    tool: ITool,
  ): Promise<ToolResult> {
    if (!this.config.validateOutput || !result.success) {
      return result;
    }

    const schemaResult = this.validateAgainstSchema(
      result.data,
      tool.outputSchema,
    );
    if (schemaResult.valid) {
      return result;
    }

    const mode = getValidationMode();

    if (mode === "lenient") {
      Logger.warn(
        `Output validation warning for tool '${tool.id}': ${JSON.stringify(schemaResult.errors)}`,
        "ValidationMiddleware",
      );
      return result;
    }

    if (mode === "coerce") {
      const coerced = this.tryCoerce(result.data, tool.outputSchema);
      if (coerced !== null) {
        Logger.warn(
          `Output coerced for tool '${tool.id}': ${JSON.stringify(schemaResult.errors)}`,
          "ValidationMiddleware",
        );
        return { ...result, data: coerced };
      }
      // coerce 失败 fallthrough 到 strict reject（required 字段缺失补不出来）
    }

    // strict（默认）+ coerce 兜底失败
    throw new ValidationError(
      schemaResult.errors ?? [],
      `Output validation failed for tool '${tool.id}'`,
    );
  }

  /**
   * coerce mode：补 optional 字段默认值。
   * required 缺失返回 null（让上层 fallthrough strict reject）。
   */
  private tryCoerce(data: unknown, schema: JSONSchema): unknown | null {
    if (!data || typeof data !== "object" || !schema.properties) return null;
    const obj = data as Record<string, unknown>;
    const result: Record<string, unknown> = { ...obj };
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (key in result) continue;
      // required 缺失 → 不能 coerce
      if (schema.required?.includes(key)) return null;
      // 推断默认值（仅 optional 字段）
      const propType = (propSchema as { type?: string }).type;
      if (propType === "string") result[key] = "";
      else if (propType === "number" || propType === "integer") result[key] = 0;
      else if (propType === "boolean") result[key] = false;
      else if (propType === "array") result[key] = [];
      else if (propType === "object") result[key] = {};
    }
    return result;
  }

  /**
   * JSON Schema → zod schema 转译（支持项目现有子集）
   *
   * 支持：type / properties / required / items /
   *       minLength / maxLength / minimum / maximum / enum
   *
   * 遇到不支持的字段（如 $ref）→ fallback z.unknown()，不 throw。
   * 行数约 60 行。
   */
  private jsonSchemaToZod(schema: JSONSchema): z.ZodTypeAny {
    // 含 $ref 或其他不支持字段 → fallback z.unknown()
    if (schema.$ref !== undefined) {
      return z.unknown();
    }

    const types = schema.type
      ? Array.isArray(schema.type)
        ? schema.type
        : [schema.type]
      : [];

    // 无 type 声明 → 任意值（与手写 validateValue 一致）
    if (types.length === 0) {
      return z.unknown();
    }

    const buildSingleType = (t: string): z.ZodTypeAny => {
      switch (t) {
        case "string": {
          let s = z.string();
          if (schema.minLength !== undefined) s = s.min(schema.minLength);
          if (schema.maxLength !== undefined) s = s.max(schema.maxLength);
          if (schema.enum !== undefined) {
            const vals = schema.enum as string[];
            return z.enum(vals as [string, ...string[]]);
          }
          return s;
        }
        case "number":
        case "integer": {
          let n = t === "integer" ? z.number().int() : z.number();
          if (schema.minimum !== undefined) n = n.min(schema.minimum);
          if (schema.maximum !== undefined) n = n.max(schema.maximum);
          return n;
        }
        case "boolean":
          return z.boolean();
        case "null":
          return z.null();
        case "array": {
          const itemSchema = schema.items
            ? this.jsonSchemaToZod(schema.items)
            : z.unknown();
          return z.array(itemSchema);
        }
        case "object": {
          const shape: Record<string, z.ZodTypeAny> = {};
          // Add known properties from schema.properties
          if (schema.properties) {
            for (const [key, propSchema] of Object.entries(schema.properties)) {
              const isRequired = schema.required?.includes(key) ?? false;
              const zodProp = this.jsonSchemaToZod(propSchema);
              shape[key] = isRequired ? zodProp : zodProp.optional();
            }
          }
          // Add required fields that are not in properties
          // Use a non-undefined-accepting type so absent keys fail
          if (schema.required) {
            for (const key of schema.required) {
              if (!(key in shape)) {
                shape[key] = z.unknown().refine((v) => v !== undefined, {
                  message: `Required property '${key}' is missing`,
                });
              }
            }
          }
          return z.object(shape).passthrough();
        }
        default:
          return z.unknown();
      }
    };

    if (types.length === 1) {
      return buildSingleType(types[0]);
    }
    // 多 type → z.union
    const schemas = types.map((t) => buildSingleType(t)) as [
      z.ZodTypeAny,
      z.ZodTypeAny,
      ...z.ZodTypeAny[],
    ];
    return z.union(schemas);
  }

  /**
   * JSON Schema 验证 — zod 为主路径，fallback 到手写 validateValue。
   *
   * 当 jsonSchemaToZod 返回 z.unknown()（即含不支持字段，如 $ref）时，
   * 退到旧的手写路径，保持渐进式迁移。
   */
  private validateAgainstSchema(
    data: unknown,
    schema: JSONSchema,
  ): ValidationResult {
    const zodSchema = this.jsonSchemaToZod(schema);

    // fallback：z.unknown() 表示无法转译，退到手写实现
    if (zodSchema instanceof z.ZodUnknown) {
      const errors: Array<{ path: string; message: string; type: string }> = [];
      this.validateValue(data, schema, "", errors);
      return {
        valid: errors.length === 0,
        errors: errors.length > 0 ? errors : undefined,
      };
    }

    const result = zodSchema.safeParse(data);
    if (result.success) {
      return { valid: true };
    }

    // 把 ZodError 转成 { path, message, type } 格式
    const errors = result.error.issues.map((issue) => ({
      path: issue.path.join(".") || "root",
      message: issue.message,
      type: issue.code,
    }));
    return { valid: false, errors };
  }

  private validateValue(
    value: unknown,
    schema: JSONSchema,
    path: string,
    errors: Array<{ path: string; message: string; type: string }>,
  ): void {
    // 类型检查
    if (schema.type) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      const actualType = this.getType(value);

      if (
        !types.includes(actualType) &&
        !(actualType === "null" && types.includes("null"))
      ) {
        errors.push({
          path: path || "root",
          message: `Expected ${types.join(" or ")}, got ${actualType}`,
          type: "type",
        });
        return;
      }
    }

    // 对象属性检查
    if (
      schema.type === "object" &&
      typeof value === "object" &&
      value !== null
    ) {
      const obj = value as Record<string, unknown>;

      // 必填字段检查
      if (schema.required) {
        for (const key of schema.required) {
          if (!(key in obj)) {
            errors.push({
              path: path ? `${path}.${key}` : key,
              message: `Required property '${key}' is missing`,
              type: "required",
            });
          }
        }
      }

      // 属性验证
      if (schema.properties) {
        for (const [key, propSchema] of Object.entries(schema.properties)) {
          if (key in obj) {
            this.validateValue(
              obj[key],
              propSchema,
              path ? `${path}.${key}` : key,
              errors,
            );
          }
        }
      }
    }

    // 数组项检查
    if (schema.type === "array" && Array.isArray(value) && schema.items) {
      for (let i = 0; i < value.length; i++) {
        this.validateValue(value[i], schema.items, `${path}[${i}]`, errors);
      }
    }

    // 字符串长度检查
    if (typeof value === "string") {
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        errors.push({
          path: path || "root",
          message: `String length must be >= ${schema.minLength}`,
          type: "minLength",
        });
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        errors.push({
          path: path || "root",
          message: `String length must be <= ${schema.maxLength}`,
          type: "maxLength",
        });
      }
    }

    // 数字范围检查
    if (typeof value === "number") {
      if (schema.minimum !== undefined && value < schema.minimum) {
        errors.push({
          path: path || "root",
          message: `Value must be >= ${schema.minimum}`,
          type: "minimum",
        });
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        errors.push({
          path: path || "root",
          message: `Value must be <= ${schema.maximum}`,
          type: "maximum",
        });
      }
    }

    // 枚举检查
    if (schema.enum !== undefined && !schema.enum.includes(value)) {
      errors.push({
        path: path || "root",
        message: `Value must be one of: ${schema.enum.join(", ")}`,
        type: "enum",
      });
    }
  }

  private getType(value: unknown): string {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    return typeof value;
  }
}

/**
 * 创建验证中间件
 */
export function createValidationMiddleware(
  config?: ValidationMiddlewareConfig,
): IToolMiddleware {
  return new ValidationMiddleware(config);
}

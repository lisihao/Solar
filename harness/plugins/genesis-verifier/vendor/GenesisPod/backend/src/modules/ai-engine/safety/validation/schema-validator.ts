/**
 * AI Engine - Schema Validator
 * JSON Schema 验证器实现
 */

import { Injectable } from "@nestjs/common";
import {
  ValidationResult,
  ValidationIssue,
} from "@/modules/ai-engine/facade/index";

/**
 * JSON Schema 定义（简化版）
 */
export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  additionalProperties?: boolean | JsonSchema;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  not?: JsonSchema;
  default?: unknown;
  description?: string;
}

/**
 * 验证错误
 */
export interface ValidationError {
  path: string;
  message: string;
  keyword: string;
  params?: Record<string, unknown>;
}

/**
 * Schema 验证器
 */
@Injectable()
export class SchemaValidator {
  /**
   * 验证数据
   */
  validate(data: unknown, schema: JsonSchema): ValidationResult {
    const errors: ValidationError[] = [];
    this.validateValue(data, schema, "", errors);

    return {
      valid: errors.length === 0,
      errors: errors.map(
        (e): ValidationIssue => ({
          path: e.path,
          message: e.message,
          type: e.keyword,
        }),
      ),
    };
  }

  /**
   * 验证值
   */
  private validateValue(
    value: unknown,
    schema: JsonSchema,
    path: string,
    errors: ValidationError[],
  ): void {
    // 类型验证
    if (schema.type) {
      if (!this.validateType(value, schema.type)) {
        errors.push({
          path,
          message: `${path || "value"} should be ${schema.type}`,
          keyword: "type",
          params: { type: schema.type },
        });
        return;
      }
    }

    // 枚举验证
    if (schema.enum) {
      if (!schema.enum.includes(value)) {
        errors.push({
          path,
          message: `${path || "value"} should be one of ${schema.enum.join(", ")}`,
          keyword: "enum",
          params: { enum: schema.enum },
        });
      }
    }

    // 对象验证
    if (
      schema.type === "object" &&
      typeof value === "object" &&
      value !== null
    ) {
      this.validateObject(
        value as Record<string, unknown>,
        schema,
        path,
        errors,
      );
    }

    // 数组验证
    if (schema.type === "array" && Array.isArray(value)) {
      this.validateArray(value, schema, path, errors);
    }

    // 字符串验证
    if (schema.type === "string" && typeof value === "string") {
      this.validateString(value, schema, path, errors);
    }

    // 数字验证
    if (
      (schema.type === "number" || schema.type === "integer") &&
      typeof value === "number"
    ) {
      this.validateNumber(value, schema, path, errors);
    }

    // 复合 schema
    if (schema.oneOf) {
      this.validateOneOf(value, schema.oneOf, path, errors);
    }
    if (schema.anyOf) {
      this.validateAnyOf(value, schema.anyOf, path, errors);
    }
    if (schema.allOf) {
      this.validateAllOf(value, schema.allOf, path, errors);
    }
    if (schema.not) {
      this.validateNot(value, schema.not, path, errors);
    }
  }

  /**
   * 验证类型
   */
  private validateType(value: unknown, type: string | string[]): boolean {
    const types = Array.isArray(type) ? type : [type];

    return types.some((t) => {
      switch (t) {
        case "string":
          return typeof value === "string";
        case "number":
          return typeof value === "number" && !isNaN(value);
        case "integer":
          return typeof value === "number" && Number.isInteger(value);
        case "boolean":
          return typeof value === "boolean";
        case "array":
          return Array.isArray(value);
        case "object":
          return (
            typeof value === "object" && value !== null && !Array.isArray(value)
          );
        case "null":
          return value === null;
        default:
          return true;
      }
    });
  }

  /**
   * 验证对象
   */
  private validateObject(
    obj: Record<string, unknown>,
    schema: JsonSchema,
    path: string,
    errors: ValidationError[],
  ): void {
    // 必填字段
    if (schema.required) {
      for (const field of schema.required) {
        if (!(field in obj)) {
          errors.push({
            path: `${path}.${field}`,
            message: `${path}.${field} is required`,
            keyword: "required",
            params: { field },
          });
        }
      }
    }

    // 属性验证
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in obj) {
          this.validateValue(obj[key], propSchema, `${path}.${key}`, errors);
        }
      }
    }

    // 额外属性
    if (schema.additionalProperties === false && schema.properties) {
      const allowed = new Set(Object.keys(schema.properties));
      for (const key of Object.keys(obj)) {
        if (!allowed.has(key)) {
          errors.push({
            path: `${path}.${key}`,
            message: `${path}.${key} is not allowed`,
            keyword: "additionalProperties",
          });
        }
      }
    }
  }

  /**
   * 验证数组
   */
  private validateArray(
    arr: unknown[],
    schema: JsonSchema,
    path: string,
    errors: ValidationError[],
  ): void {
    if (schema.items) {
      arr.forEach((item, index) => {
        this.validateValue(item, schema.items!, `${path}[${index}]`, errors);
      });
    }
  }

  /**
   * 验证字符串
   */
  private validateString(
    str: string,
    schema: JsonSchema,
    path: string,
    errors: ValidationError[],
  ): void {
    if (schema.minLength !== undefined && str.length < schema.minLength) {
      errors.push({
        path,
        message: `${path || "value"} should have at least ${schema.minLength} characters`,
        keyword: "minLength",
        params: { minLength: schema.minLength },
      });
    }

    if (schema.maxLength !== undefined && str.length > schema.maxLength) {
      errors.push({
        path,
        message: `${path || "value"} should have at most ${schema.maxLength} characters`,
        keyword: "maxLength",
        params: { maxLength: schema.maxLength },
      });
    }

    if (schema.pattern) {
      const regex = new RegExp(schema.pattern);
      if (!regex.test(str)) {
        errors.push({
          path,
          message: `${path || "value"} should match pattern ${schema.pattern}`,
          keyword: "pattern",
          params: { pattern: schema.pattern },
        });
      }
    }

    if (schema.format) {
      if (!this.validateFormat(str, schema.format)) {
        errors.push({
          path,
          message: `${path || "value"} should be a valid ${schema.format}`,
          keyword: "format",
          params: { format: schema.format },
        });
      }
    }
  }

  /**
   * 验证数字
   */
  private validateNumber(
    num: number,
    schema: JsonSchema,
    path: string,
    errors: ValidationError[],
  ): void {
    if (schema.minimum !== undefined && num < schema.minimum) {
      errors.push({
        path,
        message: `${path || "value"} should be >= ${schema.minimum}`,
        keyword: "minimum",
        params: { minimum: schema.minimum },
      });
    }

    if (schema.maximum !== undefined && num > schema.maximum) {
      errors.push({
        path,
        message: `${path || "value"} should be <= ${schema.maximum}`,
        keyword: "maximum",
        params: { maximum: schema.maximum },
      });
    }
  }

  /**
   * 验证格式
   */
  private validateFormat(str: string, format: string): boolean {
    switch (format) {
      case "email":
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
      case "uri":
        try {
          new URL(str);
          return true;
        } catch {
          return false;
        }
      case "date":
        return !isNaN(Date.parse(str));
      case "uuid":
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          str,
        );
      default:
        return true;
    }
  }

  /**
   * 验证 oneOf
   */
  private validateOneOf(
    value: unknown,
    schemas: JsonSchema[],
    path: string,
    errors: ValidationError[],
  ): void {
    const validCount = schemas.filter((s) => {
      const tempErrors: ValidationError[] = [];
      this.validateValue(value, s, path, tempErrors);
      return tempErrors.length === 0;
    }).length;

    if (validCount !== 1) {
      errors.push({
        path,
        message: `${path || "value"} should match exactly one schema`,
        keyword: "oneOf",
      });
    }
  }

  /**
   * 验证 anyOf
   */
  private validateAnyOf(
    value: unknown,
    schemas: JsonSchema[],
    path: string,
    errors: ValidationError[],
  ): void {
    const valid = schemas.some((s) => {
      const tempErrors: ValidationError[] = [];
      this.validateValue(value, s, path, tempErrors);
      return tempErrors.length === 0;
    });

    if (!valid) {
      errors.push({
        path,
        message: `${path || "value"} should match at least one schema`,
        keyword: "anyOf",
      });
    }
  }

  /**
   * 验证 allOf
   */
  private validateAllOf(
    value: unknown,
    schemas: JsonSchema[],
    path: string,
    errors: ValidationError[],
  ): void {
    for (const schema of schemas) {
      this.validateValue(value, schema, path, errors);
    }
  }

  /**
   * 验证 not
   */
  private validateNot(
    value: unknown,
    schema: JsonSchema,
    path: string,
    errors: ValidationError[],
  ): void {
    const tempErrors: ValidationError[] = [];
    this.validateValue(value, schema, path, tempErrors);

    if (tempErrors.length === 0) {
      errors.push({
        path,
        message: `${path || "value"} should not match the schema`,
        keyword: "not",
      });
    }
  }
}

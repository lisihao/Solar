/**
 * PromptTemplate —— 类型化变量替换 + 多层组合 + 版本控制
 *
 * Topic Insights 当前 8 个 .prompt.ts 文件 ~140KB，全是字符串模板 +
 * 手写 ${variable} 替换，无类型检查、无版本管理、无 A/B。
 *
 * 本模块提供：
 *   - 类型化变量（Zod 推断）
 *   - 多层 fragment 组合（base + extension + override）
 *   - 版本号 + checksum，支持 rollback / diff
 *   - A/B 路由（按 userId hash 分流）
 */

import { createHash } from "crypto";
import { z } from "zod";

export interface PromptVariableSpec {
  readonly name: string;
  readonly type: "string" | "number" | "boolean" | "array" | "object";
  readonly required?: boolean;
  /** 描述（生成文档用） */
  readonly description?: string;
  /** 默认值 */
  readonly defaultValue?: unknown;
}

export interface PromptTemplateInit {
  readonly id: string;
  readonly version: string; // semver e.g. '1.2.3'
  readonly description?: string;
  /** 模板字符串 —— 用 {{varName}} 占位 */
  readonly template: string;
  readonly variables: readonly PromptVariableSpec[];
  /** 可继承的 base template id */
  readonly extendsId?: string;
  /** 自定义 schema（覆盖 variables 自动 schema） */
  readonly schema?: z.ZodType<Record<string, unknown>>;
  /** A/B variant 标识；同 id 多 variant 共存 */
  readonly variant?: string;
  /** A/B 权重（默认 100） */
  readonly weight?: number;
}

export class PromptTemplate {
  readonly id: string;
  readonly version: string;
  readonly description?: string;
  readonly template: string;
  readonly variables: readonly PromptVariableSpec[];
  readonly extendsId?: string;
  readonly variant?: string;
  readonly weight: number;
  private readonly _schema: z.ZodType<Record<string, unknown>>;
  private readonly _checksum: string;

  constructor(init: PromptTemplateInit) {
    // 建议修 #5: variable name 不能含 '.'，否则与模板路径语法 {{a.b}} 冲突
    for (const v of init.variables) {
      if (v.name.includes(".")) {
        throw new Error(
          `[prompt:${init.id}] variable name "${v.name}" contains '.', ` +
            `which conflicts with template path syntax {{a.b}}. ` +
            `Use snake_case / camelCase; for object lookup write {{user.email}}.`,
        );
      }
    }
    this.id = init.id;
    this.version = init.version;
    this.description = init.description;
    this.template = init.template;
    this.variables = init.variables;
    this.extendsId = init.extendsId;
    this.variant = init.variant;
    this.weight = init.weight ?? 100;
    this._schema = init.schema ?? this.buildSchemaFromVariables();
    this._checksum = createHash("sha256")
      .update(`${this.id}|${this.version}|${this.template}`)
      .digest("hex")
      .slice(0, 16);
  }

  get checksum(): string {
    return this._checksum;
  }

  /** 类型化渲染 —— 失败抛错（Zod issues） */
  render(variables: Record<string, unknown>): string {
    const parsed = this._schema.safeParse(variables);
    if (!parsed.success) {
      throw new Error(
        `[prompt:${this.id}@${this.version}] variable validation failed: ${parsed.error.issues
          .map((i) => `${i.path.join(".")}:${i.message}`)
          .join("; ")}`,
      );
    }
    return this.template.replace(
      /\{\{\s*([a-zA-Z_][\w.]*)\s*\}\}/g,
      (_match, key: string) => {
        const value = this.resolvePath(parsed.data, key);
        if (value == null) return "";
        if (typeof value === "string") return value;
        try {
          return JSON.stringify(value);
        } catch {
          return String(value);
        }
      },
    );
  }

  private resolvePath(data: Record<string, unknown>, path: string): unknown {
    const parts = path.split(".");
    let cur: unknown = data;
    for (const p of parts) {
      if (cur == null || typeof cur !== "object") return undefined;
      cur = (cur as Record<string, unknown>)[p];
    }
    return cur;
  }

  private buildSchemaFromVariables(): z.ZodType<Record<string, unknown>> {
    const shape: Record<string, z.ZodType> = {};
    for (const v of this.variables) {
      let s: z.ZodType;
      switch (v.type) {
        case "string":
          s = z.string();
          break;
        case "number":
          s = z.number();
          break;
        case "boolean":
          s = z.boolean();
          break;
        case "array":
          s = z.array(z.unknown());
          break;
        case "object":
          s = z.record(z.unknown());
          break;
        default:
          s = z.unknown();
      }
      if (!v.required) s = s.optional();
      shape[v.name] = s;
    }
    return z.object(shape).passthrough();
  }
}

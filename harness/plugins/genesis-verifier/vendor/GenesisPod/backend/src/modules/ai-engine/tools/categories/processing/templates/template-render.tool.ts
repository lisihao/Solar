/**
 * Template Render Tool
 * 模板渲染工具 - 使用变量渲染模板（Handlebars 风格）
 */

import { Injectable, Logger } from "@nestjs/common";
import { BaseTool } from "../../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../../abstractions/tool.interface";
import { APP_CONFIG } from "../../../../../../common/config/app.config";
import {
  registerRadarEmailHelpers,
  type HbsLike,
} from "../../../../../../common/handlebars/radar-email-helpers";

// ============================================================================
// Types
// ============================================================================

interface HandlebarsInstance {
  compile(
    template: string,
    options?: { strict?: boolean; noEscape?: boolean },
  ): (context: Record<string, unknown>) => string;
  registerHelper(name: string, helper: (...args: never[]) => unknown): void;
}

export interface TemplateRenderInput {
  /**
   * 模板字符串
   */
  template: string;

  /**
   * 变量数据
   */
  variables: Record<string, unknown>;

  /**
   * 输出格式
   */
  format?: "text" | "html" | "markdown" | "json";

  /**
   * 渲染选项
   */
  options?: {
    /**
     * 严格模式（未定义变量抛出错误）
     */
    strict?: boolean;

    /**
     * 自动转义 HTML
     */
    escapeHtml?: boolean;

    /**
     * 允许部分渲染
     */
    partial?: boolean;

    /**
     * 自定义分隔符
     */
    delimiters?: {
      start: string;
      end: string;
    };
  };
}

export interface TemplateRenderOutput {
  /**
   * 渲染结果
   */
  result: string;

  /**
   * 使用的变量列表
   */
  usedVariables: string[];

  /**
   * 未定义的变量列表
   */
  undefinedVariables: string[];

  /**
   * 渲染统计
   */
  statistics: {
    /**
     * 模板长度
     */
    templateLength: number;

    /**
     * 输出长度
     */
    outputLength: number;

    /**
     * 变量数量
     */
    variableCount: number;

    /**
     * 渲染时间（毫秒）
     */
    renderTime: number;
  };
}

// ============================================================================
// Tool Implementation
// ============================================================================

@Injectable()
export class TemplateRenderTool extends BaseTool<
  TemplateRenderInput,
  TemplateRenderOutput
> {
  private readonly logger = new Logger(TemplateRenderTool.name);

  readonly id = "template-render";
  readonly sideEffect = "none" as const;
  readonly category: ToolCategory = "processing";
  readonly tags = ["processing", "template", "render", "handlebars", "jinja"];
  readonly name = "模板渲染";
  readonly description =
    "使用变量渲染模板内容。支持 Handlebars 风格语法、条件逻辑、循环、自定义辅助函数等。支持文本、HTML、Markdown、JSON 等多种格式。适用于邮件模板、文档生成、代码生成等场景。";

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      template: {
        type: "string",
        description:
          "模板字符串（支持 {{variable}}、{{#if}}、{{#each}} 等语法）",
      },
      variables: {
        type: "object",
        description: "变量数据（键值对）",
      },
      format: {
        type: "string",
        description: "输出格式",
        enum: ["text", "html", "markdown", "json"],
        default: "text",
      },
      options: {
        type: "object",
        description: "渲染选项",
        properties: {
          strict: {
            type: "boolean",
            description: "严格模式（未定义变量抛出错误）",
            default: false,
          },
          escapeHtml: {
            type: "boolean",
            description: "自动转义 HTML",
            default: true,
          },
          partial: {
            type: "boolean",
            description: "允许部分渲染",
            default: false,
          },
          delimiters: {
            type: "object",
            description: "自定义分隔符",
            properties: {
              start: {
                type: "string",
                description: "起始分隔符",
                default: "{{",
              },
              end: { type: "string", description: "结束分隔符", default: "}}" },
            },
          },
        },
      },
    },
    required: ["template", "variables"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      result: {
        type: "string",
        description: "渲染结果",
      },
      usedVariables: {
        type: "array",
        description: "使用的变量列表",
        items: { type: "string" },
      },
      undefinedVariables: {
        type: "array",
        description: "未定义的变量列表",
        items: { type: "string" },
      },
      statistics: {
        type: "object",
        description: "渲染统计",
        properties: {
          templateLength: { type: "number", description: "模板长度" },
          outputLength: { type: "number", description: "输出长度" },
          variableCount: { type: "number", description: "变量数量" },
          renderTime: { type: "number", description: "渲染时间（毫秒）" },
        },
      },
    },
  };

  constructor() {
    super();
    // defaultTimeout set in class property // 30 秒超时
  }

  validateInput(input: TemplateRenderInput) {
    if (!input.template || !input.variables) {
      return false;
    }

    return true;
  }

  protected async doExecute(
    input: TemplateRenderInput,
    _context: ToolContext,
  ): Promise<TemplateRenderOutput> {
    const { template, variables, format = "text", options = {} } = input;

    this.logger.log(`[doExecute] Rendering template (format: ${format})...`);

    const startTime = Date.now();

    try {
      const handlebars = await import("handlebars");

      // 配置 Handlebars
      const hbs = handlebars.create();

      // 注册自定义辅助函数
      this.registerHelpers(hbs as unknown as HandlebarsInstance);

      // 设置选项
      if (options.escapeHtml === false) {
        // Disable HTML escaping
      }

      // 编译模板
      const compiledTemplate = hbs.compile(template, {
        strict: options.strict || false,
        noEscape: !options.escapeHtml,
      });

      // 渲染模板
      let result = compiledTemplate(variables);

      // 跟踪使用的变量
      const usedVariables: Set<string> = new Set();
      const undefinedVariables: Set<string> = new Set();

      this.extractVariables(template, options.delimiters).forEach((varName) => {
        usedVariables.add(varName);

        if (this.getNestedValue(variables, varName) === undefined) {
          undefinedVariables.add(varName);
        }
      });

      // 格式化输出
      if (format === "json") {
        try {
          result = JSON.stringify(JSON.parse(result), null, 2);
        } catch {
          // If not valid JSON, keep as is
        }
      } else if (format === "markdown") {
        // Add markdown-specific formatting if needed
      } else if (format === "html") {
        // HTML is already handled by escapeHtml option
      }

      const renderTime = Date.now() - startTime;

      const output: TemplateRenderOutput = {
        result,
        usedVariables: Array.from(usedVariables),
        undefinedVariables: Array.from(undefinedVariables),
        statistics: {
          templateLength: template.length,
          outputLength: result.length,
          variableCount: usedVariables.size,
          renderTime,
        },
      };

      this.logger.log(
        `[doExecute] Rendering complete. Variables: ${usedVariables.size}, Undefined: ${undefinedVariables.size}, Time: ${renderTime}ms`,
      );

      return output;
    } catch (error) {
      this.logger.error(
        `[doExecute] Rendering failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  // ==========================================================================
  // Custom Helpers
  // ==========================================================================

  private registerHelpers(hbs: HandlebarsInstance): void {
    // Date formatting
    hbs.registerHelper("formatDate", function (...args: never[]) {
      const argsUnknown = args as unknown as unknown[];
      const date = argsUnknown[0];
      const format = argsUnknown[1] as string;
      const d = new Date(date as string | number | Date);
      if (isNaN(d.getTime())) return date;

      if (format === "iso") return d.toISOString();
      if (format === "short") return d.toLocaleDateString();
      if (format === "long") return d.toLocaleString();

      return d.toString();
    });

    // Number formatting
    hbs.registerHelper("formatNumber", function (...args: never[]) {
      const argsUnknown = args as unknown as unknown[];
      const num = argsUnknown[0];
      const decimals = (argsUnknown[1] as number | undefined) ?? 2;
      const n = parseFloat(String(num));
      if (isNaN(n)) return num;

      return n.toFixed(decimals);
    });

    // String operations
    hbs.registerHelper("uppercase", function (...args: never[]) {
      const str = (args as unknown as unknown[])[0];
      return typeof str === "string" ? str.toUpperCase() : "";
    });

    hbs.registerHelper("lowercase", function (...args: never[]) {
      const str = (args as unknown as unknown[])[0];
      return typeof str === "string" ? str.toLowerCase() : "";
    });

    hbs.registerHelper("capitalize", function (...args: never[]) {
      const str = (args as unknown as unknown[])[0];
      if (typeof str !== "string") return "";
      return str ? str.charAt(0).toUpperCase() + str.slice(1) : "";
    });

    // Conditional helpers
    hbs.registerHelper("eq", function (...args: never[]) {
      const argsUnknown = args as unknown as unknown[];
      const [a, b] = argsUnknown;
      return a === b;
    });

    hbs.registerHelper("ne", function (...args: never[]) {
      const argsUnknown = args as unknown as unknown[];
      const [a, b] = argsUnknown;
      return a !== b;
    });

    hbs.registerHelper("gt", function (...args: never[]) {
      const argsUnknown = args as unknown as number[];
      const [a, b] = argsUnknown;
      return a > b;
    });

    hbs.registerHelper("lt", function (...args: never[]) {
      const argsUnknown = args as unknown as number[];
      const [a, b] = argsUnknown;
      return a < b;
    });

    hbs.registerHelper("gte", function (...args: never[]) {
      const argsUnknown = args as unknown as number[];
      const [a, b] = argsUnknown;
      return a >= b;
    });

    hbs.registerHelper("lte", function (...args: never[]) {
      const argsUnknown = args as unknown as number[];
      const [a, b] = argsUnknown;
      return a <= b;
    });

    hbs.registerHelper("and", function (...args: never[]) {
      const argsArray = args as unknown as unknown[];
      return argsArray.slice(0, -1).every((arg) => arg);
    });

    hbs.registerHelper("or", function (...args: never[]) {
      const argsArray = args as unknown as unknown[];
      return argsArray.slice(0, -1).some((arg) => arg);
    });

    hbs.registerHelper("not", function (...args: never[]) {
      const value = (args as unknown as unknown[])[0];
      return !value;
    });

    // Array helpers
    hbs.registerHelper("length", function (...args: never[]) {
      const arr = (args as unknown as unknown[])[0];
      return Array.isArray(arr) ? arr.length : 0;
    });

    hbs.registerHelper("join", function (...args: never[]) {
      const argsUnknown = args as unknown as unknown[];
      const arr = argsUnknown[0];
      const separator = (argsUnknown[1] as string | undefined) ?? ", ";
      return Array.isArray(arr) ? arr.join(separator) : "";
    });

    hbs.registerHelper("first", function (...args: never[]) {
      const arr = (args as unknown as unknown[])[0];
      return Array.isArray(arr) ? arr[0] : undefined;
    });

    hbs.registerHelper("last", function (...args: never[]) {
      const arr = (args as unknown as unknown[])[0];
      return Array.isArray(arr) ? arr[arr.length - 1] : undefined;
    });

    // JSON helpers
    hbs.registerHelper("json", function (...args: never[]) {
      const obj = (args as unknown as unknown[])[0];
      return JSON.stringify(obj, null, 2);
    });

    hbs.registerHelper("jsonInline", function (...args: never[]) {
      const obj = (args as unknown as unknown[])[0];
      return JSON.stringify(obj);
    });

    // Math helpers
    hbs.registerHelper("add", function (...args: never[]) {
      const argsUnknown = args as unknown as number[];
      const [a, b] = argsUnknown;
      return a + b;
    });

    hbs.registerHelper("subtract", function (...args: never[]) {
      const argsUnknown = args as unknown as number[];
      const [a, b] = argsUnknown;
      return a - b;
    });

    hbs.registerHelper("multiply", function (...args: never[]) {
      const argsUnknown = args as unknown as number[];
      const [a, b] = argsUnknown;
      return a * b;
    });

    hbs.registerHelper("divide", function (...args: never[]) {
      const argsUnknown = args as unknown as number[];
      const [a, b] = argsUnknown;
      return b !== 0 ? a / b : 0;
    });

    // Default value helper
    hbs.registerHelper("default", function (...args: never[]) {
      const argsUnknown = args as unknown as unknown[];
      const [value, defaultValue] = argsUnknown;
      return value !== undefined && value !== null ? value : defaultValue;
    });

    // ==========================================================================
    // Radar email helpers — security contract (§7.3.3-bis)
    //
    // F4 FU3 整改：urlEncode / truncate / tierBadge / evidenceSources 4 helpers
    // 从 common/handlebars/radar-email-helpers 统一注册（与 platform/email 端
    // 同源），避免实现漂移
    // ==========================================================================
    registerRadarEmailHelpers(hbs as HbsLike);

    // detailUrl: LLM 工具端签名是单参 (signalId)，从 APP_CONFIG 取 base，URL
    // 模式 `/ai-radar/signal/${id}`（无 topicId）。与 platform/email 端 3 参签
    // 名 by design 不一致 —— 保留本地实现
    const UUID_RE =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    hbs.registerHelper("detailUrl", function (...args: never[]) {
      const signalId = (args as unknown as unknown[])[0];
      if (typeof signalId !== "string" || !UUID_RE.test(signalId)) return "";
      return `${APP_CONFIG.urls.frontend}/ai-radar/signal/${signalId}`;
    });
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * 提取模板中的变量
   */
  private extractVariables(
    template: string,
    delimiters?: { start: string; end: string },
  ): string[] {
    const start = delimiters?.start || "{{";
    const end = delimiters?.end || "}}";

    const pattern = new RegExp(
      `${this.escapeRegex(start)}\\s*([^}#/\\s]+)\\s*${this.escapeRegex(end)}`,
      "g",
    );

    const variables: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(template)) !== null) {
      const varName = match[1].trim();
      // Skip helper functions
      if (
        !varName.startsWith("if") &&
        !varName.startsWith("each") &&
        !varName.startsWith("unless") &&
        !varName.startsWith("with")
      ) {
        variables.push(varName);
      }
    }

    return variables;
  }

  /**
   * 转义正则表达式特殊字符
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * 获取嵌套对象的值
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const keys = path.split(".");
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
}

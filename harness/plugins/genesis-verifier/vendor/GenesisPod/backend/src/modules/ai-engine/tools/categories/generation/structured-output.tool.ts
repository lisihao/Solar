/**
 * Structured Output Tool
 * 结构化输出工具 - 生成 JSON/YAML/XML 等格式化数据
 */

import { Injectable } from "@nestjs/common";
import { BaseTool } from "../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../abstractions/tool.interface";

import { AIModelType } from "@prisma/client";
import { AiChatService } from "@/modules/ai-engine/llm/chat/ai-chat.service";

// ============================================================================
// Types
// ============================================================================

export interface StructuredOutputInput {
  /**
   * 生成提示词（描述需要生成的结构化数据）
   */
  prompt: string;

  /**
   * 输出格式
   */
  format: "json" | "yaml" | "xml";

  /**
   * 数据模式定义（可选，JSON Schema 或描述）
   */
  schema?: string | Record<string, unknown>;

  /**
   * 模板（可选，用于模板化生成）
   */
  template?: string;

  /**
   * 上下文数据（可选）
   */
  context?: Record<string, unknown> | string;

  /**
   * 是否验证输出
   */
  validate?: boolean;

  /**
   * 是否格式化输出（美化）
   */
  prettify?: boolean;

  /**
   * 温度参数（0-1）
   */
  temperature?: number;
}

export interface StructuredOutputOutput {
  /**
   * 生成的结构化数据（字符串格式）
   */
  output: string;

  /**
   * 解析后的数据对象（如果是 JSON）
   */
  data?: unknown;

  /**
   * 输出格式
   */
  format: string;

  /**
   * 是否验证通过
   */
  validated?: boolean;

  /**
   * 验证错误（如果有）
   */
  validationErrors?: string[];

  /**
   * 是否成功
   */
  success: boolean;

  /**
   * 错误信息
   */
  error?: string;

  /**
   * 元数据
   */
  metadata?: {
    tokensUsed?: number;
    model?: string;
    hasSchema?: boolean;
    hasTemplate?: boolean;
  };
}

// ============================================================================
// Tool Implementation
// ============================================================================

@Injectable()
export class StructuredOutputTool extends BaseTool<
  StructuredOutputInput,
  StructuredOutputOutput
> {
  readonly id = "structured-output";
  readonly sideEffect = "none" as const;
  readonly category: ToolCategory = "generation";
  readonly tags = ["generation", "structured", "json", "schema"];
  readonly name = "结构化输出";
  readonly description =
    "生成结构化数据输出，支持 JSON、YAML、XML 格式。可指定数据模式和模板，支持数据验证。适用于 API 响应、配置文件、数据导出等场景。";

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "生成提示词，描述需要生成的结构化数据内容",
      },
      format: {
        type: "string",
        description: "输出格式",
        enum: ["json", "yaml", "xml"],
        default: "json",
      },
      schema: {
        type: "string",
        description: "数据模式定义（JSON Schema 或文本描述），用于约束输出结构",
      },
      template: {
        type: "string",
        description: "输出模板，支持变量替换",
      },
      context: {
        type: "object",
        description: "上下文数据，提供额外的参考信息",
      },
      validate: {
        type: "boolean",
        description: "是否验证输出结构",
        default: true,
      },
      prettify: {
        type: "boolean",
        description: "是否格式化输出（美化缩进）",
        default: true,
      },
      temperature: {
        type: "number",
        description: "温度参数（0-1），控制生成的随机性，默认 0.3",
        default: 0.3,
      },
    },
    required: ["prompt", "format"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      output: {
        type: "string",
        description: "生成的结构化数据（字符串格式）",
      },
      data: {
        type: "object",
        description: "解析后的数据对象（JSON 格式时提供）",
      },
      format: {
        type: "string",
        description: "输出格式",
      },
      validated: {
        type: "boolean",
        description: "是否通过验证",
      },
      validationErrors: {
        type: "array",
        description: "验证错误列表",
        items: { type: "string" },
      },
      success: {
        type: "boolean",
        description: "生成是否成功",
      },
      error: {
        type: "string",
        description: "错误信息（如果失败）",
      },
      metadata: {
        type: "object",
        description: "元数据信息",
        properties: {
          tokensUsed: { type: "number" },
          model: { type: "string" },
          hasSchema: { type: "boolean" },
          hasTemplate: { type: "boolean" },
        },
      },
    },
  };

  constructor(private readonly aiChatService: AiChatService) {
    super();
    // defaultTimeout set in class property // 60 秒超时
  }

  validateInput(input: StructuredOutputInput) {
    return (
      typeof input.prompt === "string" &&
      input.prompt.trim().length > 0 &&
      input.prompt.length <= 50000 &&
      ["json", "yaml", "xml"].includes(input.format) &&
      (!input.temperature || (input.temperature >= 0 && input.temperature <= 1))
    );
  }

  protected async doExecute(
    input: StructuredOutputInput,
    _context: ToolContext,
  ): Promise<StructuredOutputOutput> {
    const {
      prompt,
      format,
      schema,
      template,
      context,
      validate = true,
      prettify = true,
      temperature = 0.3,
    } = input;

    try {
      // 构建系统提示
      const systemPrompt = this.buildSystemPrompt(format, schema, template);

      // 构建用户提示
      const userPrompt = this.buildUserPrompt(
        prompt,
        format,
        context,
        schema,
        template,
      );

      // 调用 AI 服务生成内容
      const response = await this.aiChatService.chat({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        modelType: AIModelType.CHAT,
        taskProfile: {
          creativity:
            temperature <= 0.3 ? "low" : temperature <= 0.5 ? "medium" : "high",
          outputLength: "medium",
        },
      });

      let rawOutput = response.content.trim();

      // 清理输出（移除 markdown 代码块标记）
      rawOutput = this.cleanOutput(rawOutput);

      // 解析和验证
      let parsedData: unknown = undefined;
      let validated = false;
      let validationErrors: string[] = [];

      if (format === "json") {
        try {
          parsedData = JSON.parse(rawOutput);
          validated = true;

          // 如果提供了 schema，进行验证
          if (validate && schema) {
            const schemaValidation = this.validateAgainstSchema(
              parsedData,
              schema,
            );
            validated = schemaValidation.valid;
            validationErrors = schemaValidation.errors;
          }
        } catch (error) {
          validationErrors.push(
            `Invalid JSON: ${error instanceof Error ? error.message : "Parse error"}`,
          );
          validated = false;
        }
      } else if (format === "yaml") {
        // 基本 YAML 验证（检查格式）
        validated = this.isValidYAML(rawOutput);
        if (!validated) {
          validationErrors.push("Invalid YAML format");
        }
      } else if (format === "xml") {
        // 基本 XML 验证
        validated = this.isValidXML(rawOutput);
        if (!validated) {
          validationErrors.push("Invalid XML format");
        }
      }

      // 格式化输出
      let finalOutput = rawOutput;
      if (prettify) {
        if (format === "json" && parsedData) {
          finalOutput = JSON.stringify(parsedData, null, 2);
        }
        // YAML 和 XML 通常已经格式化良好
      }

      return {
        output: finalOutput,
        data: parsedData,
        format,
        validated,
        validationErrors:
          validationErrors.length > 0 ? validationErrors : undefined,
        success: true,
        metadata: {
          tokensUsed: response.usage?.totalTokens,
          model: response.model,
          hasSchema: !!schema,
          hasTemplate: !!template,
        },
      };
    } catch (error) {
      return {
        output: "",
        format,
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Structured output generation failed",
      };
    }
  }

  /**
   * 构建系统提示
   */
  private buildSystemPrompt(
    format: string,
    schema?: string | Record<string, unknown>,
    template?: string,
  ): string {
    let systemPrompt = `你是一个专业的结构化数据生成助手。你需要根据用户的要求生成 ${format.toUpperCase()} 格式的数据。

重要规则：
1. 只输出 ${format.toUpperCase()} 格式的数据，不要包含任何解释性文字
2. 确保输出的数据格式正确，可以被解析
3. 数据结构要清晰、完整、符合规范
4. 不要使用 markdown 代码块标记（如 \`\`\`json）`;

    if (schema) {
      systemPrompt += `\n5. 严格遵循提供的数据模式（Schema）`;
    }

    if (template) {
      systemPrompt += `\n6. 使用提供的模板作为基础结构`;
    }

    return systemPrompt;
  }

  /**
   * 构建用户提示
   */
  private buildUserPrompt(
    prompt: string,
    format: string,
    context?: Record<string, unknown> | string,
    schema?: string | Record<string, unknown>,
    template?: string,
  ): string {
    let userPrompt = `请生成以下内容的 ${format.toUpperCase()} 格式数据：\n\n${prompt}`;

    if (context) {
      const contextStr =
        typeof context === "string"
          ? context
          : JSON.stringify(context, null, 2);
      userPrompt += `\n\n参考上下文：\n${contextStr}`;
    }

    if (schema) {
      const schemaStr =
        typeof schema === "string" ? schema : JSON.stringify(schema, null, 2);
      userPrompt += `\n\n数据模式（Schema）：\n${schemaStr}`;
    }

    if (template) {
      userPrompt += `\n\n输出模板：\n${template}`;
    }

    userPrompt += `\n\n请直接输出 ${format.toUpperCase()} 数据，不要包含任何额外说明。`;

    return userPrompt;
  }

  /**
   * 清理输出（移除 markdown 标记等）
   */
  private cleanOutput(output: string): string {
    // 移除 markdown 代码块
    output = output.replace(/```(?:json|yaml|xml)?\n?/g, "");
    output = output.replace(/```\n?/g, "");

    // 移除开头和结尾的空白
    output = output.trim();

    return output;
  }

  /**
   * 根据 schema 验证数据（简化版）
   */
  private validateAgainstSchema(
    data: unknown,
    schema: string | Record<string, unknown>,
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    try {
      // 如果 schema 是字符串，尝试解析
      let schemaObj: Record<string, unknown>;
      if (typeof schema === "string") {
        try {
          schemaObj = JSON.parse(schema);
        } catch {
          // 如果不是 JSON，作为描述性 schema 跳过验证
          return { valid: true, errors: [] };
        }
      } else {
        schemaObj = schema;
      }

      // 简单的类型检查
      if (schemaObj.type) {
        const expectedType = schemaObj.type as string;
        const actualType = Array.isArray(data) ? "array" : typeof data;

        if (expectedType === "object" && actualType !== "object") {
          errors.push(`Expected type 'object', got '${actualType}'`);
        } else if (expectedType === "array" && !Array.isArray(data)) {
          errors.push(`Expected type 'array', got '${actualType}'`);
        }
      }

      // 检查必需字段
      if (
        schemaObj.required &&
        Array.isArray(schemaObj.required) &&
        typeof data === "object" &&
        data !== null
      ) {
        const dataObj = data as Record<string, unknown>;
        for (const field of schemaObj.required) {
          if (!(field in dataObj)) {
            errors.push(`Missing required field: ${field}`);
          }
        }
      }

      return {
        valid: errors.length === 0,
        errors,
      };
    } catch (error) {
      return {
        valid: false,
        errors: [`Schema validation error: ${error}`],
      };
    }
  }

  /**
   * 验证 YAML 格式（简单检查）
   */
  private isValidYAML(yaml: string): boolean {
    // 基本的 YAML 格式检查
    if (!yaml.trim()) return false;

    // 检查是否有基本的 YAML 结构（键值对或列表）
    const hasKeyValue = /^\s*[\w-]+\s*:/m.test(yaml);
    const hasList = /^\s*-\s+/m.test(yaml);

    return hasKeyValue || hasList;
  }

  /**
   * 验证 XML 格式（简单检查）
   */
  private isValidXML(xml: string): boolean {
    // 基本的 XML 格式检查
    if (!xml.trim()) return false;

    // 检查是否有 XML 标签
    const hasOpeningTag = /<[\w-]+[^>]*>/g.test(xml);
    const hasClosingTag = /<\/[\w-]+>/g.test(xml);

    // 简单的标签匹配检查
    if (!hasOpeningTag && !hasClosingTag) return false;

    // 检查根元素
    const rootMatch = xml.match(/<([\w-]+)[^>]*>/);
    if (!rootMatch) return false;

    const rootTag = rootMatch[1];
    const closingRootRegex = new RegExp(`</${rootTag}>`);

    return closingRootRegex.test(xml);
  }
}

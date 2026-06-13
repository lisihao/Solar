/**
 * Code Generation Tool
 * 代码生成工具 - 复用 AiChatService
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

export interface CodeGenerationInput {
  /**
   * 代码生成需求描述
   */
  prompt: string;

  /**
   * 编程语言
   */
  language: string;

  /**
   * 参考代码（可选）
   */
  referenceCode?: string;

  /**
   * 代码类型
   */
  codeType?: "function" | "class" | "module" | "snippet" | "complete";

  /**
   * 是否包含注释
   */
  includeComments?: boolean;

  /**
   * 是否包含测试代码
   */
  includeTests?: boolean;
}

export interface CodeGenerationOutput {
  /**
   * 生成的代码
   */
  code: string;

  /**
   * 代码语言
   */
  language: string;

  /**
   * 代码说明
   */
  explanation?: string;

  /**
   * 测试代码（如果请求）
   */
  testCode?: string;

  /**
   * 是否成功
   */
  success: boolean;

  /**
   * 失败时的明细原因（LLM/网络/parse 真因）
   */
  error?: string;
}

// ============================================================================
// Tool Implementation
// ============================================================================

@Injectable()
export class CodeGenerationTool extends BaseTool<
  CodeGenerationInput,
  CodeGenerationOutput
> {
  readonly id = "code-generation";
  readonly sideEffect = "none" as const;
  readonly category: ToolCategory = "generation";
  readonly tags = ["generation", "code", "programming", "developer"];
  readonly name = "代码生成";
  readonly description =
    "使用 AI 生成代码。支持多种编程语言，可生成函数、类、完整模块等。支持添加注释和测试代码。";

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "代码生成需求描述，详细说明需要实现的功能",
      },
      language: {
        type: "string",
        description: "编程语言，如 typescript, python, java, go 等",
      },
      referenceCode: {
        type: "string",
        description: "参考代码，用于风格参考或基于现有代码修改",
      },
      codeType: {
        type: "string",
        description: "代码类型",
        enum: ["function", "class", "module", "snippet", "complete"],
        default: "function",
      },
      includeComments: {
        type: "boolean",
        description: "是否包含详细注释",
        default: true,
      },
      includeTests: {
        type: "boolean",
        description: "是否生成测试代码",
        default: false,
      },
    },
    required: ["prompt", "language"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      code: {
        type: "string",
        description: "生成的代码",
      },
      language: {
        type: "string",
        description: "代码语言",
      },
      explanation: {
        type: "string",
        description: "代码功能说明",
      },
      testCode: {
        type: "string",
        description: "测试代码（如果请求）",
      },
      success: {
        type: "boolean",
        description: "生成是否成功",
      },
    },
  };

  constructor(private readonly aiChatService: AiChatService) {
    super();
    // defaultTimeout set in class property // 60 秒超时
  }

  validateInput(input: CodeGenerationInput) {
    return (
      typeof input.prompt === "string" &&
      input.prompt.trim().length > 0 &&
      typeof input.language === "string" &&
      input.language.trim().length > 0
    );
  }

  protected async doExecute(
    input: CodeGenerationInput,
    _context: ToolContext,
  ): Promise<CodeGenerationOutput> {
    const {
      prompt,
      language,
      referenceCode,
      codeType = "function",
      includeComments = true,
      includeTests = false,
    } = input;

    // 构建系统提示词
    const systemPrompt = `你是一个专业的 ${language} 开发者。
请根据用户需求生成高质量的代码。

要求：
- 代码应该清晰、高效、可维护
- 遵循 ${language} 的最佳实践和命名规范
${includeComments ? "- 添加清晰的注释说明代码功能" : "- 只保留必要的注释"}
- 代码类型: ${codeType}
${includeTests ? "- 同时生成对应的单元测试代码" : ""}

输出格式：
1. 先输出主要代码块（用 \`\`\`${language} 包裹）
2. 然后简要说明代码功能
${includeTests ? "3. 最后输出测试代码块（用 ```test 标记）" : ""}`;

    // 构建用户提示词
    let userPrompt = prompt;
    if (referenceCode) {
      userPrompt = `参考代码：
\`\`\`${language}
${referenceCode}
\`\`\`

需求：${prompt}`;
    }

    try {
      const response = await this.aiChatService.chat({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        modelType: AIModelType.CHAT,
        taskProfile: {
          creativity: "low", // 代码生成使用较低温度
          outputLength: "medium",
        },
      });

      // 解析响应
      const { code, explanation, testCode } = this.parseCodeResponse(
        response.content,
        language,
      );

      return {
        code,
        language,
        explanation,
        testCode: includeTests ? testCode : undefined,
        success: true,
      };
    } catch (error) {
      // ★ P0-LIVE-TOOL-EMPTY-ERR (2026-04-30): catch 完全吞 error，LLM 看到
      //   {success: false} 不知所以然反复重试浪费 token。透传 LLM/网络/parse
      //   真因到 error 字段。
      return {
        code: "",
        language,
        success: false,
        error:
          error instanceof Error
            ? `Code generation failed: ${error.message}`
            : `Code generation failed: ${String(error)}`,
      };
    }
  }

  /**
   * 解析代码响应
   */
  private parseCodeResponse(
    content: string,
    language: string,
  ): {
    code: string;
    explanation: string;
    testCode?: string;
  } {
    // 提取主要代码块
    const codeBlockRegex = new RegExp(
      `\`\`\`(?:${language})?\\s*\\n([\\s\\S]*?)\`\`\``,
      "i",
    );
    const codeMatch = content.match(codeBlockRegex);
    const code = codeMatch ? codeMatch[1].trim() : content;

    // 提取测试代码
    const testBlockRegex = /```(?:test|spec|testing)\s*\n([\s\S]*?)```/i;
    const testMatch = content.match(testBlockRegex);
    const testCode = testMatch ? testMatch[1].trim() : undefined;

    // 提取说明（代码块之外的文本）
    let explanation = content
      .replace(/```[\s\S]*?```/g, "")
      .trim()
      .split("\n")
      .filter((line) => line.trim())
      .join("\n");

    // 如果没有提取到说明，生成默认说明
    if (!explanation) {
      explanation = `生成的 ${language} 代码`;
    }

    return { code, explanation, testCode };
  }
}

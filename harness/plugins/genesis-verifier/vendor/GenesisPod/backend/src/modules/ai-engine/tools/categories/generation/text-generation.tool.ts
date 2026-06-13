/**
 * Text Generation Tool
 * 文本生成工具 - 复用 AiChatService
 */

import { Injectable } from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import { BaseTool } from "../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../abstractions/tool.interface";

import { AiChatService } from "@/modules/ai-engine/llm/chat/ai-chat.service";

// ============================================================================
// Types
// ============================================================================

export interface TextGenerationInput {
  /**
   * 生成提示词
   */
  prompt: string;

  /**
   * 系统提示词（可选）
   */
  systemPrompt?: string;

  /**
   * 上下文信息（可选）
   */
  context?: string;

  /**
   * 最大输出 token 数
   */
  maxTokens?: number;

  /**
   * 温度参数（0-1）
   */
  temperature?: number;

  /**
   * 输出格式
   */
  outputFormat?: "text" | "json" | "markdown";
}

export interface TextGenerationOutput {
  /**
   * 生成的文本
   */
  text: string;

  /**
   * 使用的 token 数
   */
  tokensUsed?: number;

  /**
   * 是否成功
   */
  success: boolean;

  /**
   * 使用的模型
   */
  model?: string;

  /**
   * 失败时的明细原因（LLM/网络/parse 真因）
   */
  error?: string;
}

// ============================================================================
// Tool Implementation
// ============================================================================

@Injectable()
export class TextGenerationTool extends BaseTool<
  TextGenerationInput,
  TextGenerationOutput
> {
  readonly id = "text-generation";
  readonly sideEffect = "none" as const;
  readonly category: ToolCategory = "generation";
  readonly tags = ["generation", "text", "writing", "completion"];
  readonly name = "文本生成";
  readonly description =
    "使用 AI 模型生成文本内容。适用于撰写文章、总结、翻译、改写等文本处理任务。支持设置系统提示和上下文。";

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "生成提示词，描述需要生成的内容",
      },
      systemPrompt: {
        type: "string",
        description: "系统提示词，定义 AI 的角色和行为",
      },
      context: {
        type: "string",
        description: "上下文信息，提供相关背景资料",
      },
      maxTokens: {
        type: "number",
        description: "最大输出 token 数，默认 2000",
        default: 2000,
      },
      temperature: {
        type: "number",
        description: "温度参数（0-1），越高越有创意，默认 0.7",
        default: 0.7,
      },
      outputFormat: {
        type: "string",
        description: "输出格式",
        enum: ["text", "json", "markdown"],
        default: "text",
      },
    },
    required: ["prompt"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "生成的文本内容",
      },
      tokensUsed: {
        type: "number",
        description: "使用的 token 数量",
      },
      success: {
        type: "boolean",
        description: "生成是否成功",
      },
      model: {
        type: "string",
        description: "使用的模型名称",
      },
    },
  };

  constructor(private readonly aiChatService: AiChatService) {
    super();
    // defaultTimeout set in class property // 60 秒超时
  }

  validateInput(input: TextGenerationInput) {
    return (
      typeof input.prompt === "string" &&
      input.prompt.trim().length > 0 &&
      input.prompt.length <= 50000
    );
  }

  protected async doExecute(
    input: TextGenerationInput,
    _context: ToolContext,
  ): Promise<TextGenerationOutput> {
    const {
      prompt,
      systemPrompt,
      context,
      maxTokens,
      temperature,
      outputFormat = "text",
    } = input;

    // 构建完整提示词
    let fullPrompt = prompt;
    if (context) {
      fullPrompt = `上下文信息：\n${context}\n\n${prompt}`;
    }

    // 添加格式要求
    if (outputFormat === "json") {
      fullPrompt += "\n\n请以有效的 JSON 格式输出结果。";
    } else if (outputFormat === "markdown") {
      fullPrompt += "\n\n请以 Markdown 格式输出结果。";
    }

    // 构建消息
    const messages: Array<{
      role: "system" | "user" | "assistant";
      content: string;
    }> = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: fullPrompt });

    // outputFormat → outputLength 映射
    const outputLength =
      outputFormat === "json"
        ? "short"
        : outputFormat === "markdown"
          ? "long"
          : "medium";

    try {
      // 调用 AI 服务（遵循 AI 调用规范：必须传 modelType + taskProfile）
      const response = await this.aiChatService.chat({
        messages,
        modelType: AIModelType.CHAT,
        taskProfile: { creativity: "medium", outputLength },
        // 显式传入的参数优先级高于 taskProfile
        ...(maxTokens !== undefined && { maxTokens }),
        ...(temperature !== undefined && { temperature }),
      });

      return {
        text: response.content,
        tokensUsed: response.usage?.totalTokens,
        success: true,
        model: response.model,
      };
    } catch (error) {
      // ★ P0-LIVE-TOOL-EMPTY-ERR (2026-04-30): 同 code-generation.
      return {
        text: "",
        success: false,
        error:
          error instanceof Error
            ? `Text generation failed: ${error.message}`
            : `Text generation failed: ${String(error)}`,
      };
    }
  }
}
